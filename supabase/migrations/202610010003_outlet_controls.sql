-- Outlets gain ordering controls (opening hours, minimum order, featured), a storefront description,
-- and private settlement details for administrators.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- Shown on the storefront.
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS featured INTEGER NOT NULL DEFAULT 0;
-- Paisa; 0 means only the store-wide minimum applies.
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS minimum_order INTEGER NOT NULL DEFAULT 0
  CHECK (minimum_order >= 0);
-- Pakistan time as HH:MM; both empty means the outlet is open around the clock.
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS opens_at TEXT NOT NULL DEFAULT '';
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS closes_at TEXT NOT NULL DEFAULT '';

-- Visible to administrators only.
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT '';
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS payout_bank TEXT NOT NULL DEFAULT '';
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS payout_title TEXT NOT NULL DEFAULT '';
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS payout_account TEXT NOT NULL DEFAULT '';
ALTER TABLE outlet_settings ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

COMMIT;
