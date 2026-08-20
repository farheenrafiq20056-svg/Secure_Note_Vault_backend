/**
 * Authentication and Session Management Service
 * 
 * Implements:
 * 1. Secure password hashing with bcrypt (12 salt rounds)
 * 2. Opaque, cryptographically secure 256-bit session tokens
 * 3. In-memory per-session key store (ensuring encryption keys exist only in volatile RAM)
 * 
 * Assignment Task 7: Session Hijacking Mitigations
 * - Mitigation 1: HttpOnly flag prevents XSS theft via document.cookie; Secure flag prevents plaintext transmission.
 * - Mitigation 2: SameSite=Strict/Lax prevents Cross-Site Request Forgery (CSRF).
 * - Mitigation 3: In-memory session validation with expiration and immediate invalidation on logout.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { deriveKeyFromPassword } from './encryption.js';

const BCRYPT_SALT_ROUNDS = 12;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  derivedEncryptionKey: Buffer; // Held in volatile memory only during active session
  createdAt: number;
  expiresAt: number;
}

// Volatile in-memory session and key store (Never written to disk or database)
class SessionStore {
  private sessions: Map<string, SessionData> = new Map();

  createSession(userId: string, email: string, rawPassword: string): string {
    // 256-bit cryptographically secure random session token
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    // Derive symmetric key from user's password + userId as salt
    const derivedKey = deriveKeyFromPassword(rawPassword, userId);

    const session: SessionData = {
      sessionId: token,
      userId,
      email,
      derivedEncryptionKey: derivedKey,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS
    };

    this.sessions.set(token, session);
    return token;
  }

  getSession(token: string): SessionData | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    // Check expiration
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  destroySession(token: string): void {
    const session = this.sessions.get(token);
    if (session) {
      // Overwrite the encryption key buffer with zeroes before garbage collection
      session.derivedEncryptionKey.fill(0);
      this.sessions.delete(token);
    }
  }

  destroyAllUserSessions(userId: string): void {
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        session.derivedEncryptionKey.fill(0);
        this.sessions.delete(token);
      }
    }
  }
}

export const sessionStore = new SessionStore();

/**
 * Hash plaintext password using bcrypt with 12 salt rounds
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Compare plaintext password with stored bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Cookie configuration for session tokens
 * Assignment Task 7: HttpOnly + Secure + SameSite attributes
 */
export const SESSION_COOKIE_NAME = 'vault_session';

export function getSessionCookieOptions(isProduction: boolean = process.env.NODE_ENV === 'production') {
  return {
    httpOnly: true, // Prevents JavaScript access (defends against XSS cookie theft)
    secure: isProduction, // Transmitted only over HTTPS connections in production
    sameSite: 'lax' as const, // Prevents CSRF attacks while allowing safe top-level navigations
    path: '/',
    maxAge: SESSION_TTL_MS
  };
}
