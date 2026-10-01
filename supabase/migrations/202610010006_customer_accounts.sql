-- Customers verify their email with a 6-digit code before they can sign in, and administrators
-- can manage customer accounts: notes, last sign-in, and deletion that keeps order history.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- Accounts that exist before this change are treated as verified, so nobody is locked out. The
-- backfill runs only when the column is first added: a re-run never verifies pending sign-ups.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'dellvit' AND table_name = 'users' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified_at TEXT;
    UPDATE users SET email_verified_at = created_at;
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TEXT;
-- Visible to administrators only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_notes TEXT NOT NULL DEFAULT '';
-- Set when an administrator deletes a customer who has orders: the account is closed and its
-- personal details are erased, while the orders keep their own copy of the delivery details.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TEXT;

-- One pending email code per account. Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS email_codes(user_id TEXT PRIMARY KEY REFERENCES users(id),code_hash TEXT NOT NULL,expires_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,sent_at TEXT NOT NULL);
ALTER TABLE email_codes ENABLE ROW LEVEL SECURITY;

COMMIT;
