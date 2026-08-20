-- Migration 2: Schema Evolution - Add isFavorite and tags
-- Database: PostgreSQL
-- Assignment Task 3: Adding columns to an existing table in an ongoing production schema

ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
