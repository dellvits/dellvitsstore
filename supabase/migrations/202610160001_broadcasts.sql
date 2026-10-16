-- Announcements an administrator sends to customers, riders and outlets. Each one lands in every
-- recipient's inbox as a notification, as a browser pop-up and in the app's notification centre.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

CREATE TABLE IF NOT EXISTS broadcasts(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  -- JSON list of the roles it went to: customer, rider, outlet.
  audience TEXT NOT NULL,
  sent_by TEXT REFERENCES users(id),
  recipients INTEGER NOT NULL DEFAULT 0,
  phones INTEGER NOT NULL DEFAULT 0,
  browsers INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  -- Set when it was taken back out of everyone's inbox.
  withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at);
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

-- Which announcement a notification came from, for read counts and for withdrawing it.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS broadcast_id TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_broadcast ON notifications(broadcast_id) WHERE broadcast_id IS NOT NULL;

COMMIT;
