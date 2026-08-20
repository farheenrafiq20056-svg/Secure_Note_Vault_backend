-- ==============================================================================
-- ASSIGNMENT TASK 3 (SQL Variant): Schema Migration - Add is_favorite & tags
-- Demonstrates non-destructive table alteration with forward (UP) and rollback (DOWN)
-- ==============================================================================

-- --- MIGRATION UP (upgrade) ---
-- Adds `is_favorite` boolean column with default false
ALTER TABLE notes 
ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

-- Adds `tags` text array column with default empty array
ALTER TABLE notes 
ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Creates an index on is_favorite for high-performance filtering
CREATE INDEX IF NOT EXISTS idx_notes_user_favorite ON notes(user_id, is_favorite);

-- --- MIGRATION DOWN (downgrade / rollback) ---
-- Drop index first
-- DROP INDEX IF EXISTS idx_notes_user_favorite;
-- Drop columns safely
-- ALTER TABLE notes DROP COLUMN IF EXISTS tags;
-- ALTER TABLE notes DROP COLUMN IF EXISTS is_favorite;
