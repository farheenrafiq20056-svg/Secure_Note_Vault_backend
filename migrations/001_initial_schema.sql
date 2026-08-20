-- ==============================================================================
-- ASSIGNMENT TASK 1: PostgreSQL Schema & Relational Queries
-- 1. CREATE TABLE with Foreign Key constraints & cascade delete
-- 2. Complex SELECT query with INNER JOIN and aggregated metrics
-- ==============================================================================

-- Task 1.1: CREATE TABLE with Foreign Key Constraints
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    content_encrypted TEXT NOT NULL,
    nonce VARCHAR(64) NOT NULL,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Foreign key constraint with cascading delete to prevent orphaned records
    CONSTRAINT fk_notes_user
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    note_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_audit_note
        FOREIGN KEY (note_id)
        REFERENCES notes(id)
        ON DELETE SET NULL
);

-- Task 1.2: SELECT with JOIN query
-- Retrieves notes alongside the owner's account metadata and count of audit events
SELECT 
    n.id AS note_id,
    n.title,
    n.is_favorite,
    n.created_at AS note_created_at,
    u.id AS user_id,
    u.email AS user_email,
    COUNT(al.id) AS total_audit_events
FROM notes n
INNER JOIN users u ON n.user_id = u.id
LEFT JOIN audit_logs al ON al.note_id = n.id
WHERE u.id = '00000000-0000-0000-0000-000000000000'::UUID
GROUP BY n.id, n.title, n.is_favorite, n.created_at, u.id, u.email
ORDER BY n.created_at DESC;
