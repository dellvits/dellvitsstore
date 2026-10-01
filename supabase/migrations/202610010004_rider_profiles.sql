-- Riders gain a vehicle, identity documents, an emergency contact, a payout account and private
-- notes for administrators.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS vehicle_type TEXT NOT NULL DEFAULT 'motorbike';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS vehicle_number TEXT NOT NULL DEFAULT '';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS cnic TEXT NOT NULL DEFAULT '';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS license_number TEXT NOT NULL DEFAULT '';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS emergency_name TEXT NOT NULL DEFAULT '';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS emergency_phone TEXT NOT NULL DEFAULT '';
-- Where the rider's commission is usually paid.
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS payout_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS payout_bank TEXT NOT NULL DEFAULT '';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS payout_title TEXT NOT NULL DEFAULT '';
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS payout_account TEXT NOT NULL DEFAULT '';
-- Visible to administrators only.
ALTER TABLE rider_settings ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

COMMIT;
