/**
 * Secure Notes Vault Backend Entry Point
 * 
 * Express server configuration:
 * - CORS setup for frontend origins with credentials enabled (cookies)
 * - JSON and cookie parsing
 * - Modular route mounting for /api/auth and /api/notes
 * - Global error sanitization middleware
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.js';
import { notesRouter } from './routes/notes.js';
import { errorHandler } from './lib/middleware.js';

dotenv.config();

export const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Middlewares
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin || origin.includes('localhost') || origin.includes('run.app') || origin === CLIENT_URL) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true, // Allow cookies across origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Secure Notes Vault Backend',
    timestamp: new Date().toISOString(),
    crypto: 'AES-256-GCM + PBKDF2',
    auth: 'HttpOnly Secure Session Cookies'
  });
});

// Mount Routes
app.use('/api/auth', authRouter);
app.use('/api/notes', notesRouter);

// Global Error Handler
app.use(errorHandler);

// Start server if run standalone
if (process.env.NODE_ENV !== 'test' && !process.env.AIS_EMBEDDED) {
  app.listen(PORT, () => {
    console.log(`[Secure Notes Vault Backend] Listening on port ${PORT}`);
  });
}
