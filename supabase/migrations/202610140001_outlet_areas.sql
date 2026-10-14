-- Outlets can serve the whole country ("Nation Wide") or any number of delivery areas, instead of
-- only the area their pickup address is in. outlets.location_id stays as the pickup area.
-- Existing outlets keep serving just their pickup area.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- 1 means the outlet shows in every delivery area and outlet_areas is ignored.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS nationwide INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS outlet_areas(
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY(outlet_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_outlet_areas_location ON outlet_areas(location_id);
ALTER TABLE outlet_areas ENABLE ROW LEVEL SECURITY;

-- An outlet that is not nation wide and has no areas yet serves its pickup area.
INSERT INTO outlet_areas(outlet_id, location_id)
SELECT o.id, o.location_id FROM outlets o
WHERE o.nationwide = 0 AND NOT EXISTS (SELECT 1 FROM outlet_areas a WHERE a.outlet_id = o.id)
ON CONFLICT DO NOTHING;

COMMIT;
