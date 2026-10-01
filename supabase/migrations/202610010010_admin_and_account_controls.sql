-- Administrator job titles, a list of signed-in devices for every account, and per-account
-- notification preferences.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- What the administrator does, e.g. "Support agent"; shown on the Admin access page.
ALTER TABLE admin_access ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- When and from which browser a session was started, so an account can review its devices.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Notification types the account has silenced: a JSON list such as ["payout"].
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_muted TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS audit_log_recent ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS notifications_inbox ON notifications(user_id, created_at);

COMMIT;
