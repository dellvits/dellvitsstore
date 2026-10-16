-- Phones that use the app without signing in also get announcements meant for everyone and for
-- customers. Such a phone is kept with no account; signing in moves it to the account.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

ALTER TABLE device_tokens ALTER COLUMN user_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_tokens_guest ON device_tokens(token) WHERE user_id IS NULL;

COMMIT;
