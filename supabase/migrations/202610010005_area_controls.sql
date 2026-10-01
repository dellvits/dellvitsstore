-- Delivery areas gain a minimum order, a free-delivery threshold and delivery hours.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- Paisa; 0 means the area sets no minimum of its own.
ALTER TABLE area_settings ADD COLUMN IF NOT EXISTS minimum_order INTEGER NOT NULL DEFAULT 0
  CHECK (minimum_order >= 0);
-- Paisa; orders with at least this subtotal pay no delivery fee. 0 means the fee always applies.
ALTER TABLE area_settings ADD COLUMN IF NOT EXISTS free_delivery_over INTEGER NOT NULL DEFAULT 0
  CHECK (free_delivery_over >= 0);
-- Pakistan time as HH:MM; both empty means delivery runs around the clock.
ALTER TABLE area_settings ADD COLUMN IF NOT EXISTS opens_at TEXT NOT NULL DEFAULT '';
ALTER TABLE area_settings ADD COLUMN IF NOT EXISTS closes_at TEXT NOT NULL DEFAULT '';

COMMIT;
