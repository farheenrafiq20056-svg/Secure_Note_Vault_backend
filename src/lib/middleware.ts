/**
 * Security & Session Middleware for Express
 * 
 * Implements:
 * 1. Session verification via signed/unsigned HttpOnly cookies
 * 2. Authorization enforcement (ensures authenticated state on protected routes)
 * 3. Error sanitization (prevents leakage of database schema or stack traces to client)
 */

import { Request, Response, NextFunction } from 'express';
import { sessionStore, SESSION_COOKIE_NAME, SessionData } from './auth.js';

// Extend Express Request interface with authenticated session
declare global {
  namespace Express {
    interface Request {
      userSession?: SessionData;
      userId?: string;
    }
  }
}

/**
 * Authentication Middleware:
 * Inspects HttpOnly cookie for a valid active session.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE_NAME];

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized: Authentication session required.',
      code: 'UNAUTHORIZED'
    });
    return;
  }

  const session = sessionStore.getSession(token);
  if (!session) {
    // Clear stale cookie
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.status(401).json({
      error: 'Session expired or invalid. Please log in again.',
      code: 'SESSION_EXPIRED'
    });
    return;
  }

  // Attach session context to request
  req.userSession = session;
  req.userId = session.userId;
  next();
}

/**
 * Global Error Sanitization Middleware:
 * Prevents server internals or database exception traces from being leaked to clients.
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  console.error('[Backend Security Error Handler]', {
    message: err.message,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  const statusCode = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    error: isProd && statusCode === 500 ? 'An unexpected server error occurred.' : err.message,
    code: err.code || 'INTERNAL_ERROR'
  });
}
