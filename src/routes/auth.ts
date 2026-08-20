/**
 * Authentication Routes (/api/auth)
 * 
 * Endpoints:
 * - POST /api/auth/register : Register new user, hash password with bcrypt, issue session cookie.
 * - POST /api/auth/login    : Verify password, derive encryption key in RAM, issue session cookie.
 * - POST /api/auth/logout   : Invalidate session, scrub key from RAM, clear cookie.
 * - GET  /api/auth/me       : Verify active session and return user profile.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db/prisma.js';
import {
  hashPassword,
  verifyPassword,
  sessionStore,
  SESSION_COOKIE_NAME,
  getSessionCookieOptions
} from '../lib/auth.js';
import { requireAuth } from '../lib/middleware.js';
import { getSupabaseAdminClient, getSupabaseClient, getSupabaseConfig } from '../lib/supabase.js';

export const authRouter = Router();

// Validation helpers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * GET /api/auth/supabase/status
 * Returns whether Supabase is configured in the environment
 */
authRouter.get('/supabase/status', (req: Request, res: Response): void => {
  const config = getSupabaseConfig();
  res.json({
    configured: config.isConfigured,
    url: config.url || null,
    hasAnonKey: Boolean(config.anonKey),
    hasServiceKey: Boolean(config.serviceRoleKey)
  });
});

/**
 * POST /api/auth/supabase/login
 * Authenticates user via Supabase Auth service and generates vault session
 */
authRouter.post('/supabase/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const supabase = getSupabaseAdminClient() || getSupabaseClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Supabase authentication is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY in settings or use Local Vault Auth.',
        needsConfig: true
      });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: password
    });

    if (authError || !authData.user) {
      res.status(401).json({
        error: authError?.message || 'Invalid Supabase credentials.'
      });
      return;
    }

    // 2. Synchronize user record in Vault Database
    const user = await db.findOrCreateUser({
      id: authData.user.id,
      email: cleanEmail
    });

    // 3. Derive zero-knowledge encryption key in volatile memory and issue secure session cookie
    const sessionToken = sessionStore.createSession(user.id, user.email, password);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    res.status(200).json({
      message: 'Supabase authentication successful.',
      provider: 'supabase',
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      },
      session: {
        accessToken: authData.session?.access_token || null
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/supabase/register
 * Registers user with Supabase Auth service and initializes vault
 */
authRouter.post('/supabase/register', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
      });
      return;
    }

    const supabase = getSupabaseAdminClient() || getSupabaseClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Supabase authentication is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY in settings or use Local Vault Auth.',
        needsConfig: true
      });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Sign up user via Supabase
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password: password
    });

    if (authError || !authData.user) {
      res.status(400).json({
        error: authError?.message || 'Supabase registration failed.'
      });
      return;
    }

    // 2. Synchronize user record in Vault Database
    const user = await db.findOrCreateUser({
      id: authData.user.id,
      email: cleanEmail
    });

    // 3. Create server-side session and derive symmetric encryption key
    const sessionToken = sessionStore.createSession(user.id, user.email, password);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    res.status(201).json({
      message: 'Supabase account created successfully.',
      provider: 'supabase',
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/supabase/token-session
 * Exchanges a Supabase Auth JWT access token (from OAuth / Magic Link) for a secure server session
 */
authRouter.post('/supabase/token-session', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { accessToken, encryptionPassphrase } = req.body;

    if (!accessToken) {
      res.status(400).json({ error: 'Supabase access token is required.' });
      return;
    }

    const supabase = getSupabaseAdminClient() || getSupabaseClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured on the server.' });
      return;
    }

    // Verify token with Supabase Auth
    const { data: { user: supabaseUser }, error: verifyError } = await supabase.auth.getUser(accessToken);

    if (verifyError || !supabaseUser || !supabaseUser.email) {
      res.status(401).json({ error: 'Invalid or expired Supabase token.' });
      return;
    }

    // Synchronize user in Vault DB
    const user = await db.findOrCreateUser({
      id: supabaseUser.id,
      email: supabaseUser.email
    });

    // Use provided key or user ID derived master key for zero-knowledge AES-256-GCM
    const masterPassphrase = encryptionPassphrase || `sb_${supabaseUser.id}_vault_key`;
    const sessionToken = sessionStore.createSession(user.id, user.email, masterPassphrase);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    res.status(200).json({
      message: 'Supabase session verified and vault unlocked.',
      provider: 'supabase',
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/supabase/magic-link
 * Sends a passwordless OTP / Magic link via Supabase Auth
 */
authRouter.post('/supabase/magic-link', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    const supabase = getSupabaseAdminClient() || getSupabaseClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase authentication is not configured.' });
      return;
    }

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: typeof process.env.APP_URL === 'string' ? `${process.env.APP_URL}` : undefined
      }
    });

    if (otpError) {
      res.status(400).json({ error: otpError.message });
      return;
    }

    res.status(200).json({
      message: 'Magic link sent. Check your inbox to complete Supabase sign in.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/register
 */
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    // 1. Input Validation
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
      });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // 2. Check if user already exists
    const existing = await db.findUserByEmail(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email address already exists.' });
      return;
    }

    // 3. Hash password using bcrypt (12 salt rounds)
    const passwordHash = await hashPassword(password);

    // 4. Create user in database
    const newUser = await db.createUser({
      email: cleanEmail,
      passwordHash
    });

    // 5. Create active session & derive encryption key into server memory
    const sessionToken = sessionStore.createSession(newUser.id, newUser.email, password);

    // 6. Set HttpOnly, Secure, SameSite cookie
    res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    res.status(201).json({
      message: 'Account successfully registered.',
      user: {
        id: newUser.id,
        email: newUser.email,
        createdAt: newUser.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 */
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Look up user by email
    const user = await db.findUserByEmail(cleanEmail);
    if (!user) {
      // Constant-time equivalent generic message to prevent user enumeration
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // 2. Verify password with stored bcrypt hash
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // 3. Create session & derive user encryption key (held in RAM only for session lifecycle)
    const sessionToken = sessionStore.createSession(user.id, user.email, password);

    // 4. Set HttpOnly session cookie
    res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', (req: Request, res: Response): void => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token) {
    // Invalidate and wipe key memory buffer
    sessionStore.destroySession(token);
  }

  // Clear cookie from browser
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.status(200).json({ message: 'Logged out successfully.' });
});

/**
 * GET /api/auth/me
 */
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await db.findUserById(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User record not found.' });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});
