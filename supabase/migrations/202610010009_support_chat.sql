-- Support chat between signed-in customers, outlets and riders and the support team, with file
-- attachments, and a status for contact form messages.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- Contact form messages are worked through: new, read, resolved.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

-- One conversation per account. The unread counters and the last message are kept here so the
-- inbox and the header badge need no counting.
CREATE TABLE IF NOT EXISTS support_threads(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  staff_unread INTEGER NOT NULL DEFAULT 0,
  user_unread INTEGER NOT NULL DEFAULT 0,
  last_text TEXT NOT NULL DEFAULT '',
  last_staff INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_messages(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES support_threads(user_id),
  sender_id TEXT NOT NULL,
  staff INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  -- The stored file, when one is attached, and the name it was uploaded with.
  file TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS support_messages_thread ON support_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS support_threads_recent ON support_threads(last_at);
ALTER TABLE support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

COMMIT;
