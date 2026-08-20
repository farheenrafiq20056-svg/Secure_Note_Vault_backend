/**
 * Notes API Routes (/api/notes)
 * 
 * Cryptographic & Architectural Guarantees:
 * 1. Authorization: Verifies note ownership (note.userId === session.userId) on every single operation.
 * 2. Cryptography: Content is encrypted with AES-256-GCM using the user's session key before persistence.
 * 3. ACID Transactions: Insert, update, and delete actions are committed alongside audit_log records atomically.
 * 4. Idempotency: PUT /api/notes/:id delivers predictable, identical state under repeat invocations.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db/prisma.js';
import { requireAuth } from '../lib/middleware.js';
import { encryptNoteContent, decryptNoteContent } from '../lib/encryption.js';

export const notesRouter = Router();

// Apply authentication middleware to all note routes
notesRouter.use(requireAuth);

/**
 * GET /api/notes
 * Returns note headers (id, title, isFavorite, tags, timestamps) for the authenticated user.
 * Plaintext and ciphertext content payloads are NOT returned in the summary listing.
 */
notesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const userNotes = await db.findNotesByUserId(userId);

    res.status(200).json({
      notes: userNotes
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notes
 * Non-idempotent creation: Creates a new note record with encrypted content.
 * Atomically creates an audit log entry in the same transaction (Assignment Task 8: ACID).
 */
notesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const sessionKey = req.userSession!.derivedEncryptionKey;
    const { title, content, isFavorite, tags } = req.body;

    // Validation
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Note title cannot be empty.' });
      return;
    }

    const noteContent = typeof content === 'string' ? content : '';

    // 1. Encrypt plaintext content with AES-256-GCM using in-memory derived key
    const encryptedPayload = encryptNoteContent(noteContent, sessionKey);

    // 2. Atomically persist note + audit_log in a single transaction
    const { note } = await db.createNoteWithAuditLog({
      userId,
      title: title.trim(),
      contentEncrypted: encryptedPayload.contentEncrypted,
      nonce: encryptedPayload.nonce,
      isFavorite: Boolean(isFavorite),
      tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : []
    });

    // 3. Return 201 Created with decrypted content for confirmation
    res.status(201).json({
      message: 'Note securely created and encrypted.',
      note: {
        id: note.id,
        title: note.title,
        content: noteContent, // Decrypted content
        isFavorite: note.isFavorite,
        tags: note.tags,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notes/:id
 * Retrieves a single note, verifies ownership, and decrypts content on the fly.
 */
notesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const sessionKey = req.userSession!.derivedEncryptionKey;
    const { id } = req.params;

    const note = await db.findNoteById(id);

    if (!note) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }

    // Authorization check: User can only access their own notes
    if (note.userId !== userId) {
      res.status(403).json({ error: 'Forbidden: You do not have permission to access this note.' });
      return;
    }

    // Decrypt content using in-memory session key
    let decryptedContent = '';
    try {
      decryptedContent = decryptNoteContent(
        {
          contentEncrypted: note.contentEncrypted,
          nonce: note.nonce
        },
        sessionKey
      );
    } catch (cryptoErr) {
      res.status(500).json({ error: 'Failed to decrypt note content. Authentication tag mismatch.' });
      return;
    }

    res.status(200).json({
      note: {
        id: note.id,
        title: note.title,
        content: decryptedContent,
        isFavorite: note.isFavorite,
        tags: note.tags,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notes/:id
 * Idempotent update: Re-encrypts note content and updates title/favorite/tags.
 * Assignment Task 6: Demonstrates Idempotency (repeated identical PUT calls yield identical state).
 */
notesRouter.put('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const sessionKey = req.userSession!.derivedEncryptionKey;
    const { id } = req.params;
    const { title, content, isFavorite, tags } = req.body;

    const existingNote = await db.findNoteById(id);
    if (!existingNote) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }

    // Authorization verification
    if (existingNote.userId !== userId) {
      res.status(403).json({ error: 'Forbidden: You do not have permission to modify this note.' });
      return;
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Note title cannot be empty.' });
      return;
    }

    const noteContent = typeof content === 'string' ? content : '';

    // Re-encrypt with fresh nonce (IV)
    const encryptedPayload = encryptNoteContent(noteContent, sessionKey);

    const updatedNote = await db.updateNoteWithAuditLog(id, userId, {
      title: title.trim(),
      contentEncrypted: encryptedPayload.contentEncrypted,
      nonce: encryptedPayload.nonce,
      isFavorite: isFavorite !== undefined ? Boolean(isFavorite) : existingNote.isFavorite,
      tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : existingNote.tags
    });

    res.status(200).json({
      message: 'Note successfully updated.',
      note: {
        id: updatedNote.id,
        title: updatedNote.title,
        content: noteContent,
        isFavorite: updatedNote.isFavorite,
        tags: updatedNote.tags,
        createdAt: updatedNote.createdAt,
        updatedAt: updatedNote.updatedAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/notes/:id
 * Deletes the note record and logs the deletion in audit logs.
 */
notesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const existingNote = await db.findNoteById(id);
    if (!existingNote) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }

    // Authorization check
    if (existingNote.userId !== userId) {
      res.status(403).json({ error: 'Forbidden: You do not have permission to delete this note.' });
      return;
    }

    await db.deleteNoteWithAuditLog(id, userId);

    res.status(200).json({
      message: 'Note successfully deleted.',
      id
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notes/audit/logs
 * Provides the user with visibility into security events recorded on their vault.
 */
notesRouter.get('/audit/logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const logs = await db.getAuditLogsForUser(userId);

    res.status(200).json({
      auditLogs: logs
    });
  } catch (err) {
    next(err);
  }
});
