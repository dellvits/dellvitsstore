-- Products can be Nation Wide or sold in any number of delivery areas, like outlets.
-- One checkout can hold products from several outlets: it becomes one order per outlet, joined
-- by checkout_id. The blog, its comments, and "Find my product" requests from customers.
-- Safe to run more than once. Run with npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- 1 means the product shows in every delivery area and product_areas is ignored.
-- products.location_id stays as the product's main area (the first one chosen).
ALTER TABLE products ADD COLUMN IF NOT EXISTS nationwide INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS product_areas(
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY(product_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_product_areas_location ON product_areas(location_id);
ALTER TABLE product_areas ENABLE ROW LEVEL SECURITY;
-- Existing products keep selling in the one area they had.
INSERT INTO product_areas(product_id, location_id)
SELECT p.id, p.location_id FROM products p
WHERE p.nationwide = 0 AND NOT EXISTS (SELECT 1 FROM product_areas a WHERE a.product_id = p.id)
ON CONFLICT DO NOTHING;

-- Orders placed together in one checkout share this id (the first order's id).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_checkout ON orders(checkout_id);

CREATE TABLE IF NOT EXISTS blog_posts(
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  -- Cleaned HTML from the editor.
  content TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  -- JSON list of tags.
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  featured INTEGER NOT NULL DEFAULT 0,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  -- JSON: meta title and description, keywords, canonical address, share image, noindex, sitemap.
  seo TEXT NOT NULL DEFAULT '{}',
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0,
  -- When it goes live; a published post with a future date is scheduled.
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- JSON: when it was last posted to Facebook and Instagram, and the post ids.
  shared TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_live ON blog_posts(status, published_at);
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS blog_comments(
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'spam')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_comments_post ON blog_comments(post_id, status, created_at);
ALTER TABLE blog_comments ENABLE ROW LEVEL SECURITY;

-- "Find my product": what a customer is looking for. Products added later are compared with
-- the open requests and the customer is told when one matches.
CREATE TABLE IF NOT EXISTS product_wishes(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- JSON list of image addresses.
  images TEXT NOT NULL DEFAULT '[]',
  -- Most the customer wants to pay, in paisa; 0 means any price.
  max_price INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  -- open: still looking; found: the customer marked it found; closed: no longer wanted.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'found', 'closed')),
  -- JSON list of matching product ids, newest last; the customer was told about each.
  matches TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  matched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_wishes_user ON product_wishes(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_product_wishes_status ON product_wishes(status);
ALTER TABLE product_wishes ENABLE ROW LEVEL SECURITY;

COMMIT;
