-- Administrators can delete outlets and products. One that no order refers to is removed outright.
-- One with past orders is closed and hidden for good instead, so the orders keep their history.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TEXT;

COMMIT;
