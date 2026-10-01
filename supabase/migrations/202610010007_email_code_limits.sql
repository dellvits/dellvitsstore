-- Verification codes are rate limited per account: the server counts how many were sent in the
-- current hour.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS sends INTEGER NOT NULL DEFAULT 1;
-- When the hour being counted began; empty on rows from before this change.
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS window_at TEXT;

COMMIT;
