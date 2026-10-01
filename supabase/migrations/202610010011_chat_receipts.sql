-- Chat receipts: when each side last received and last read the other side's messages, so a
-- message can show sent, delivered and seen.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS user_delivered_at TEXT;
ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS user_read_at TEXT;
ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS staff_delivered_at TEXT;
ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS staff_read_at TEXT;

COMMIT;
