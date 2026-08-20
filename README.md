# Secure Notes Vault – Backend

A production-grade, security-hardened backend built with **Node.js, Express, TypeScript, and PostgreSQL with Prisma ORM**. Designed for zero-knowledge note confidentiality, robust session authentication, and database migration engineering.

---

## 1. Architectural Overview & Security Model

All cryptographic and authentication mechanisms execute exclusively on the server:

1. **Authentication & Password Hashing**:
   - Implemented via `bcrypt` with **12 salt rounds**.
   - Raw plaintext passwords are never logged, persisted, or stored.
2. **Key Derivation (PBKDF2)**:
   - At login, a 256-bit symmetric encryption key is derived using PBKDF2-HMAC-SHA256 (`100,000` iterations) with user credential entropy and user UUID salt.
   - The derived key is retained **only in volatile RAM** during an active session. When the user logs out, the key buffer is wiped (`buffer.fill(0)`) and destroyed.
3. **Authenticated Encryption (AES-256-GCM)**:
   - Note contents are encrypted before database insertion using AES-256-GCM with a unique 12-byte initialization vector (IV / Nonce) and a 16-byte authentication tag for integrity verification.
   - The database stores only `contentEncrypted` and `nonce`. Even with full database access, an attacker cannot read the notes without active session authentication.
4. **Session Management**:
   - Session tokens are 256-bit cryptographically secure random identifiers stored in `HttpOnly`, `Secure`, and `SameSite=Lax` cookies.
5. **Authorization Guards**:
   - Every read, update, and delete operation enforces strict tenant isolation: `note.userId === session.userId`.

---

## 2. Database Selection Justification

### Chosen: PostgreSQL with Prisma ORM (Relational Architecture)

| Criteria | PostgreSQL + Prisma (Chosen) | MongoDB + Mongoose |
| :--- | :--- | :--- |
| **Integrity & Constraints** | Strict schema validation, foreign key integrity (`ON DELETE CASCADE`), and check constraints. | Schemaless flexibility, but foreign keys must be managed manually in application code. |
| **ACID Transactions** | First-class Multi-Version Concurrency Control (MVCC) and robust multi-table transactions across `notes` and `audit_logs`. | Multi-document transactions require replica set deployment and incur performance overhead. |
| **Audit Trails & Relations** | Relational mapping between `users`, `notes`, and `audit_logs` ensures complete traceability. | Requires nested subdocuments or manual `$lookup` aggregations. |
| **Migrations** | Declarative schema migrations with deterministic up/down transitions (`prisma migrate` / SQL). | Migrations must be written as ad-hoc scripts. |

---

## 3. University Assignment Mapping (Tasks 1 – 9)

### Task 1: PostgreSQL Schema & Relational Query
*Files: `migrations/001_initial_schema.sql`, `prisma/schema.prisma`*
- **CREATE TABLE with FK & Cascade Delete**:
  ```sql
  CREATE TABLE notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      title VARCHAR(255) NOT NULL,
      content_encrypted TEXT NOT NULL,
      nonce VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  ```
- **SELECT with INNER JOIN & Aggregations**:
  ```sql
  SELECT n.id, n.title, u.email, COUNT(al.id) AS total_audit_events
  FROM notes n
  INNER JOIN users u ON n.user_id = u.id
  LEFT JOIN audit_logs al ON al.note_id = n.id
  WHERE u.id = 'YOUR-UUID-HERE'
  GROUP BY n.id, n.title, u.email
  ORDER BY n.created_at DESC;
  ```

---

### Task 2: MongoDB Operations
*File: `src/db/mongo_examples.ts`*
- **`insertOne()`**: Inserts an encrypted note document into the `notes` collection with metadata.
- **`find()` with Filter**: Queries notes matching user ownership and tag filters:
  ```typescript
  const notes = await collection.find(
    { userId: userObjectId, tags: { $in: ['urgent'] }, isFavorite: true },
    { projection: { title: 1, isFavorite: 1, createdAt: 1 } }
  ).sort({ createdAt: -1 }).toArray();
  ```

---

### Task 3: Schema Migration with Upgrade / Downgrade
*Files: `migrations/002_add_is_favorite_to_notes.sql`, `migrations/003_alembic_notes_migration.py`*
- **Upgrade**: Adds `is_favorite` (Boolean) and `tags` (Array) with default values and index.
- **Downgrade**: Drops the index and columns in reverse order without data corruption.

---

### Task 4: Zero-Downtime Data Migration Pattern
**Scenario**: Splitting `full_name` column into `first_name` and `last_name` in a 24/7 production environment without downtime.

**The 4-Phase Migration Strategy**:
1. **Phase 1: Schema Expansion**: Add nullable `first_name` and `last_name` columns to `users`.
2. **Phase 2: Dual-Writing (Application Code)**: Deploy code where user writes update both `full_name` AND `first_name`/`last_name`. Reads still query `full_name`.
3. **Phase 3: Background Backfill**: Execute an asynchronous batch script that iterates across existing records:
   ```sql
   UPDATE users 
   SET first_name = split_part(full_name, ' ', 1),
       last_name = substr(full_name, length(split_part(full_name, ' ', 1)) + 2)
   WHERE first_name IS NULL AND full_name IS NOT NULL;
   ```
4. **Phase 4: Read Switch & Cleanup**: Switch application reads to `first_name`/`last_name`, verify zero null values, enforce `NOT NULL` constraints, and drop the deprecated `full_name` column.

---

### Task 5: SQL Clause Precedence & Logical Execution
*File: `src/db/assignment_queries.sql`*

Query demonstrating `WHERE`, `GROUP BY`, `HAVING`, and `ORDER BY`:
```sql
SELECT u.id, u.email, COUNT(n.id) AS favorite_note_count
FROM users u
INNER JOIN notes n ON u.id = n.user_id
WHERE n.is_favorite = TRUE AND n.created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
GROUP BY u.id, u.email
HAVING COUNT(n.id) >= 2
ORDER BY favorite_note_count DESC;
```

**Logical Query Execution Order**:
1. `FROM / JOIN` (Identify tables & resolve relations)
2. `WHERE` (Filter source rows prior to aggregation)
3. `GROUP BY` (Partition filtered rows into buckets)
4. `HAVING` (Filter aggregate buckets by condition `COUNT(n.id) >= 2`)
5. `SELECT` (Project expressions and column aliases)
6. `ORDER BY` (Sort final projected rows)

---

### Task 6: Idempotency (PUT vs POST)
- **POST `/api/notes` (Non-Idempotent)**:
  - Repeated executions create multiple new note entities with unique IDs.
  - State changes on every invocation.
- **PUT `/api/notes/:id` (Idempotent)**:
  - Replaces or updates the specific note at `:id`.
  - Sending the exact same payload $N$ times results in the exact same final state in the database as sending it once.

---

### Task 7: Session Hijacking Mitigations
1. **Cookie Flags**:
   - `HttpOnly`: Disallows JavaScript access to cookies (`document.cookie`), preventing XSS exfiltration.
   - `Secure`: Ensures cookies are only transmitted over TLS/HTTPS.
   - `SameSite=Lax/Strict`: Neutralizes Cross-Site Request Forgery (CSRF).
2. **Volatile Key Retention & Expiration**:
   - Decryption keys are never stored on client or database; held only in server RAM with strict TTLs and zeroing on logout.
3. **Session Invalidation**:
   - Explicit `/api/auth/logout` invalidates session tokens immediately on the server.

---

### Task 8: ACID Transactions
*Implementation: `src/db/prisma.ts` (`createNoteWithAuditLog`)*
- **Atomicity**: The note creation and audit log insertion happen together. If either fails, all mutations are rolled back.
- **Consistency**: Foreign keys and schema invariants are guaranteed before commit.
- **Isolation**: Concurrent transactions cannot read uncommitted note ciphertext.
- **Durability**: Committed data survives system crashes.

---

### Task 9: Decoupling Identity with UUIDs (`userId`)
- Using immutable UUIDs (`id` / `userId`) as primary keys decouples identity from mutable attributes (such as email addresses or display names).
- If a user changes their email, zero foreign key cascades or updates are needed across `notes` or `audit_logs`.

---

## 4. How to Run Locally

```bash
# 1. Navigate to backend directory
cd backend

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env

# 4. Generate Prisma client & execute migrations (if Postgres is running)
npx prisma generate
npx prisma migrate dev

# 5. Start development server
npm run dev
```
