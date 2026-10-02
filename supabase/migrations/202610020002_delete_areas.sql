-- Administrators can delete delivery areas. One that no order, outlet or product refers to is
-- removed outright. One with history is closed and hidden for good instead, so orders keep theirs.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_at TEXT;

COMMIT;
