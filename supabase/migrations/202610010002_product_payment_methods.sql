-- Each product chooses which payment methods checkout offers for it, and carries an optional SKU
-- and a per-order quantity limit.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- Existing products keep every method checkout offered them before this change. The column starts
-- empty (NULL) so a re-run never re-adds methods an administrator later removed from a product.
ALTER TABLE products ADD COLUMN IF NOT EXISTS payment_methods TEXT;
UPDATE products
SET payment_methods = COALESCE(
  (
    SELECT json_agg(id ORDER BY id)::text
    FROM platform_records
    WHERE kind = 'payments' AND (data::jsonb ->> 'type') <> 'card'
  ),
  '[]'
)
WHERE payment_methods IS NULL;
ALTER TABLE products ALTER COLUMN payment_methods SET DEFAULT '[]';
ALTER TABLE products ALTER COLUMN payment_methods SET NOT NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
-- 99 matches the cart's previous ceiling, so existing products behave as before.
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_per_order INTEGER NOT NULL DEFAULT 99
  CHECK (max_per_order BETWEEN 1 AND 99);

COMMIT;
