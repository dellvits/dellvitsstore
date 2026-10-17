-- Riders and outlets can sign up themselves. Until an administrator approves them their account
-- has the role 'applicant': it verifies its email, sends its details and waits, and nothing that
-- looks for riders or outlets (dispatch, the store, the rider list) sees it.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer', 'admin', 'outlet', 'rider', 'applicant'));

CREATE TABLE IF NOT EXISTS partner_applications(
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- What the account becomes once approved.
  kind TEXT NOT NULL CHECK (kind IN ('rider', 'outlet')),
  -- draft: details not sent yet; pending: waiting for review; rejected: sent back with a note.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'rejected', 'approved')),
  -- JSON: what the applicant filled in (CNIC, vehicle, business details and so on).
  details TEXT NOT NULL DEFAULT '{}',
  -- The administrator's reason when the application is sent back.
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_applications_status ON partner_applications(status, submitted_at);
ALTER TABLE partner_applications ENABLE ROW LEVEL SECURITY;

COMMIT;
