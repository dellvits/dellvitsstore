-- Customers who forget their password get a 6-digit code by email. A correct code is swapped for
-- a short-lived reset token, and that token sets the new password. Only hashes are stored.
-- Kept apart from email_codes so a sign-up code can never reset a password, or the reverse.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

CREATE TABLE IF NOT EXISTS password_resets(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  code_hash TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL,
  -- How many codes went out in the hour that began at window_at.
  sends INTEGER NOT NULL DEFAULT 1,
  window_at TEXT NOT NULL,
  -- Set once the code is entered correctly; the code itself is then cleared.
  token_hash TEXT,
  token_expires_at TEXT
);
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;

COMMIT;
