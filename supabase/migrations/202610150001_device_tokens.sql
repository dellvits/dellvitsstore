-- The mobile app's push notifications: each phone signed in to an account registers its Firebase
-- Cloud Messaging token here, and notifications are sent to those phones' notification centres.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

CREATE TABLE IF NOT EXISTS device_tokens(
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

COMMIT;
