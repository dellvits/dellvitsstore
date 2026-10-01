-- Advertising becomes a list of ads, each with its own design, page position, delivery areas and
-- schedule, and with daily view and click counts.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- One row per ad per day (Pakistan time).
CREATE TABLE IF NOT EXISTS ad_stats(
  ad_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(ad_id, day)
);
ALTER TABLE ad_stats ENABLE ROW LEVEL SECURITY;

-- The single home page banner used until now becomes the first ad, where it has always been shown.
INSERT INTO platform_records(kind, id, data)
SELECT 'ads', 'homepage-banner',
  (jsonb_build_object(
    'name', COALESCE(NULLIF(value::jsonb->>'title', ''), 'Homepage banner'),
    'advertiser', '',
    'button', 'Explore now',
    'format', 'banner',
    'theme', 'brand',
    'placements', jsonb_build_array('bottom'),
    'devices', 'all',
    'location_ids', jsonb_build_array(),
    'starts_at', '',
    'ends_at', '',
    'max_views', 0,
    'notes', '',
    'position', 0
  ) || value::jsonb)::text
FROM settings
WHERE key = 'ad' AND value LIKE '{%'
ON CONFLICT DO NOTHING;
DELETE FROM settings WHERE key = 'ad';

COMMIT;
