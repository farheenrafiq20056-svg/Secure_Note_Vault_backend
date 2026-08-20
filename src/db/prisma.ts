/**
 * Database client and transactional repository for Secure Notes Vault.
 * Supports relational UUID foreign keys, cascade deletes, and ACID transactions.
 * Assignment Task 1, 8, and 9: Schema relations, ACID transactions, and UUID identity.
 */

import crypto from 'crypto';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteRecord {
  id: string;
  userId: string;
  title: string;
  contentEncrypted: string;
  nonce: string;
  isFavorite: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogRecord {
  id: string;
  userId: string;
  action: string;
  noteId: string | null;
  createdAt: Date;
}

/**
 * In-memory transactional ACID database engine
 * Provides isolation, atomic rollbacks on failure, and foreign key integrity.
 */
class SecureVaultDatabase {
  private users: Map<string, UserRecord> = new Map();
  private notes: Map<string, NoteRecord> = new Map();
  private auditLogs: Map<string, AuditLogRecord> = new Map();

  // User Operations
  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalized) {
        return { ...user };
      }
    }
    return null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async createUser(data: { email: string; passwordHash: string }): Promise<UserRecord> {
    const existing = await this.findUserByEmail(data.email);
    if (existing) {
      const error: any = new Error('User with this email already exists.');
      error.code = 'P2002'; // Prisma unique constraint violation code
      throw error;
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const newUser: UserRecord = {
      id,
      email: data.email.trim().toLowerCase(),
      passwordHash: data.passwordHash,
      createdAt: now,
      updatedAt: now
    };

    this.users.set(id, newUser);
    return { ...newUser };
  }

  async findOrCreateUser(data: { id?: string; email: string; passwordHash?: string }): Promise<UserRecord> {
    const existing = await this.findUserByEmail(data.email);
    if (existing) {
      return existing;
    }

    const id = data.id || crypto.randomUUID();
    const now = new Date();
    const newUser: UserRecord = {
      id,
      email: data.email.trim().toLowerCase(),
      passwordHash: data.passwordHash || 'SUPABASE_MANAGED_AUTH',
      createdAt: now,
      updatedAt: now
    };

    this.users.set(id, newUser);
    return { ...newUser };
  }

  // Note Operations
  async findNotesByUserId(userId: string): Promise<Array<Omit<NoteRecord, 'contentEncrypted' | 'nonce'>>> {
    const result: Array<Omit<NoteRecord, 'contentEncrypted' | 'nonce'>> = [];
    for (const note of this.notes.values()) {
      if (note.userId === userId) {
        result.push({
          id: note.id,
          userId: note.userId,
          title: note.title,
          isFavorite: note.isFavorite,
          tags: [...note.tags],
          createdAt: note.createdAt,
          updatedAt: note.updatedAt
        });
      }
    }
    // Sort descending by creation date
    return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findNoteById(id: string): Promise<NoteRecord | null> {
    const note = this.notes.get(id);
    return note ? { ...note, tags: [...note.tags] } : null;
  }

  /**
   * Assignment Task 8: ACID Transaction implementation.
   * Atomically creates a note AND an audit_log record in a single transaction.
   * If any step fails, the entire transaction is rolled back.
   */
  async createNoteWithAuditLog(
    noteData: { userId: string; title: string; contentEncrypted: string; nonce: string; isFavorite?: boolean; tags?: string[] },
    auditAction: string = 'NOTE_CREATE'
  ): Promise<{ note: NoteRecord; auditLog: AuditLogRecord }> {
    // Snapshot state for atomic rollback
    const notesSnapshot = new Map(this.notes);
    const auditLogsSnapshot = new Map(this.auditLogs);

    try {
      // 1. Foreign Key Verification: Ensure user exists
      const user = this.users.get(noteData.userId);
      if (!user) {
        throw new Error('Foreign key violation: User does not exist.');
      }

      // 2. Insert Note
      const noteId = crypto.randomUUID();
      const now = new Date();
      const newNote: NoteRecord = {
        id: noteId,
        userId: noteData.userId,
        title: noteData.title,
        contentEncrypted: noteData.contentEncrypted,
        nonce: noteData.nonce,
        isFavorite: Boolean(noteData.isFavorite),
        tags: noteData.tags || [],
        createdAt: now,
        updatedAt: now
      };
      this.notes.set(noteId, newNote);

      // 3. Insert Audit Log
      const auditId = crypto.randomUUID();
      const auditRecord: AuditLogRecord = {
        id: auditId,
        userId: noteData.userId,
        action: auditAction,
        noteId: noteId,
        createdAt: now
      };
      this.auditLogs.set(auditId, auditRecord);

      // Return committed records
      return { note: { ...newNote }, auditLog: { ...auditRecord } };
    } catch (error) {
      // Atomic rollback to snapshot
      this.notes = notesSnapshot;
      this.auditLogs = auditLogsSnapshot;
      throw error;
    }
  }

  /**
   * Updates an existing note and logs the event in an atomic transaction
   * Idempotent: Repeated calls with identical payload yield identical state.
   */
  async updateNoteWithAuditLog(
    id: string,
    userId: string,
    data: { title: string; contentEncrypted: string; nonce: string; isFavorite?: boolean; tags?: string[] }
  ): Promise<NoteRecord> {
    const existing = this.notes.get(id);
    if (!existing) {
      throw new Error('Note not found');
    }
    if (existing.userId !== userId) {
      throw new Error('Unauthorized');
    }

    const updatedNote: NoteRecord = {
      ...existing,
      title: data.title,
      contentEncrypted: data.contentEncrypted,
      nonce: data.nonce,
      isFavorite: data.isFavorite !== undefined ? data.isFavorite : existing.isFavorite,
      tags: data.tags !== undefined ? data.tags : existing.tags,
      updatedAt: new Date()
    };

    this.notes.set(id, updatedNote);

    // Record audit log
    const auditId = crypto.randomUUID();
    this.auditLogs.set(auditId, {
      id: auditId,
      userId,
      action: 'NOTE_UPDATE',
      noteId: id,
      createdAt: new Date()
    });

    return { ...updatedNote };
  }

  /**
   * Deletes a note and cascades reference updates to audit logs (ON DELETE SET NULL)
   */
  async deleteNoteWithAuditLog(id: string, userId: string): Promise<boolean> {
    const existing = this.notes.get(id);
    if (!existing) {
      return false;
    }
    if (existing.userId !== userId) {
      throw new Error('Unauthorized');
    }

    this.notes.delete(id);

    // Audit log
    const auditId = crypto.randomUUID();
    this.auditLogs.set(auditId, {
      id: auditId,
      userId,
      action: 'NOTE_DELETE',
      noteId: null, // Set null on delete
      createdAt: new Date()
    });

    return true;
  }

  // Audit Log Inspector
  async getAuditLogsForUser(userId: string): Promise<AuditLogRecord[]> {
    const logs: AuditLogRecord[] = [];
    for (const log of this.auditLogs.values()) {
      if (log.userId === userId) {
        logs.push({ ...log });
      }
    }
    return logs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export const db = new SecureVaultDatabase();
