import type { Express, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicRoute } from './atomic-route.js';
import { all, one, run, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify } from './notifications.js';
import { productInArea } from './platform.js';

/**
 * Find my product: customers describe something they want (pictures, name, description and the
 * price, colour, quality, quantity and area they need). Products already on Dellvit are compared
 * at once, and every product added or listed later is compared with the open requests, so the
 * customer hears as soon as it arrives. Administrators see what people are looking for.
 */

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const now = () => new Date().toISOString();
const safeImage = (v: string) => /^\/(images|api\/media)\/[\w.-]+\.(webp|png|jpg|jpeg)$/.test(v);

/** Words that say nothing about the product itself. */
const filler = new Set(
  'a an and the for with of to in on at by or my me i im want wanted need needs looking look find search buy new good best please any some'.split(
    ' ',
  ),
);
/** The meaningful words of a text, lower case, with a plural "s" dropped so shoe and shoes match. */
export function words(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((w) => w.length > 1 && !filler.has(w))
        .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
    ),
  ];
}
const effective = (p: Row) => Math.round((p.price * (100 - p.discount)) / 100);

/**
 * How well a product answers a request, from 0 (not at all) upwards. Most of the words in the
 * requested name must appear in the product's name, description or category; the price must be
 * within the customer's budget; a matching colour or quality ranks it higher.
 */
export function score(w: Row, p: Row): number {
  const wanted = words(w.name);
  if (!wanted.length) return 0;
  if (w.max_price > 0 && effective(p) > w.max_price) return 0;
  const text = ' ' + words(`${p.name} ${p.description} ${p.category} ${p.unit} ${p.deal || ''}`).join(' ') + ' ';
  const has = (x: string) => text.includes(' ' + x);
  const share = wanted.filter(has).length / wanted.length;
  if (share < 0.6) return 0;
  let s = share;
  if (w.color && words(w.color).some(has)) s += 0.2;
  if (w.quality && words(w.quality).some(has)) s += 0.1;
  if (words(w.description || '').filter(has).length >= 2) s += 0.1;
  return s;
}

/** Products that can be bought now and could answer a request: in stock, listed, in its area. */
async function candidates(w: Row, productId?: string): Promise<Row[]> {
  const terms = words(w.name).slice(0, 8);
  if (!terms.length) return [];
  const args: unknown[] = [];
  let sql =
    'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.active=1 AND o.active=1 AND p.stock>0 AND p.deleted_at IS NULL';
  if (productId) {
    sql += ' AND p.id=?';
    args.push(productId);
  } else {
    sql += ` AND (${terms.map(() => '(p.name ILIKE ? OR p.description ILIKE ? OR p.category ILIKE ?)').join(' OR ')})`;
    for (const t of terms) args.push(`%${t}%`, `%${t}%`, `%${t}%`);
  }
  if (w.location_id) {
    sql += ' AND ' + productInArea;
    args.push(w.location_id, w.location_id);
  }
  return await all(sql + ' LIMIT 300', ...args);
}

/** Saves the products newly found for a request and tells the customer about them. */
async function remember(w: Row, found: Row[]) {
  const known: string[] = JSON.parse(w.matches || '[]');
  const fresh = found.filter((p) => !known.includes(p.id));
  if (!fresh.length) return 0;
  await run(
    'UPDATE product_wishes SET matches=?,matched_at=? WHERE id=?',
    JSON.stringify([...known, ...fresh.map((p) => p.id)].slice(-50)),
    now(),
    w.id,
  );
  const first = fresh[0];
  await notify([w.user_id], {
    type: 'wish',
    title: 'Your desired product is on Dellvit now',
    body:
      fresh.length === 1
        ? `${first.name} from ${first.outlet_name} matches “${w.name}”.`
        : `${fresh.length} products match “${w.name}”, such as ${first.name}.`,
    link: fresh.length === 1 ? '/products/' + first.id : '/account?tab=wishes',
  });
  return fresh.length;
}

/** Compares one open request with every product on Dellvit; answers how many new matches it found. */
async function matchWish(w: Row) {
  const found = (await candidates(w))
    .map((p) => ({ p, s: score(w, p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 20)
    .map((x) => x.p);
  return await remember(w, found);
}

/** Compares a product that was just added or listed again with every open request. */
export async function matchProduct(productId: string) {
  const p = await one(
    'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.id=? AND p.active=1 AND o.active=1 AND p.stock>0',
    productId,
  );
  if (!p) return;
  for (const w of await all("SELECT * FROM product_wishes WHERE status='open'"))
    if (score(w, p) > 0 && (await candidates(w, p.id)).length) await remember(w, [p]);
}

/** Requests with the products that matched them, as they are now. */
async function present(rows: Row[], admin = false) {
  const ids = [...new Set(rows.flatMap((w) => JSON.parse(w.matches || '[]') as string[]))];
  const products = new Map(
    (ids.length
      ? await all(
          `SELECT p.id,p.name,p.price,p.discount,p.images,p.stock,p.active,p.unit,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.deleted_at IS NULL AND p.id IN (${ids.map(() => '?').join(',')})`,
          ...ids,
        )
      : []
    ).map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        price: p.price,
        discount: p.discount,
        effective_price: effective(p),
        image: JSON.parse(p.images || '[]')[0] || '',
        unit: p.unit,
        outlet_name: p.outlet_name,
        available: !!p.active && p.stock > 0,
      },
    ]),
  );
  return rows.map(({ matches, ...w }) => ({
    ...w,
    images: JSON.parse(w.images || '[]'),
    ...(admin ? {} : { user_id: undefined }),
    // Newest match first.
    matches: (JSON.parse(matches || '[]') as string[])
      .reverse()
      .map((id) => products.get(id))
      .filter(Boolean),
  }));
}

const wishSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(2000).default(''),
  images: z.array(z.string().refine(safeImage, 'Upload the pictures again.')).max(6).default([]),
  // In paisa; 0 means any price.
  max_price: z.number().int().min(0).max(1_000_000_000).default(0),
  color: z.string().trim().max(60).default(''),
  quality: z.string().trim().max(60).default(''),
  quantity: z.number().int().min(1).max(100000).default(1),
  location_id: z.string().max(100).nullable().default(null),
  notes: z.string().trim().max(1000).default(''),
});

export function installWishes(app: Express, { writeLimit }: { writeLimit: RequestHandler }) {
  app.get('/api/wishes', requireRole('customer'), async (req: AuthRequest, res) => {
    const rows = await all(
      'SELECT * FROM product_wishes WHERE user_id=? ORDER BY created_at DESC',
      req.user!.id,
    );
    // Open requests are compared again, so products whose price or stock changed are caught too.
    let changed = false;
    for (const w of rows.filter((w) => w.status === 'open')) changed = (await matchWish(w)) > 0 || changed;
    res.json(
      await present(
        changed
          ? await all('SELECT * FROM product_wishes WHERE user_id=? ORDER BY created_at DESC', req.user!.id)
          : rows,
      ),
    );
  });
  app.post(
    '/api/wishes',
    requireRole('customer'),
    writeLimit,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = wishSchema.parse(req.body);
      if (p.location_id && !(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', p.location_id)))
        p.location_id = null;
      const open = await one(
        "SELECT COUNT(*) n FROM product_wishes WHERE user_id=? AND status='open'",
        req.user!.id,
      );
      if (Number(open?.n) >= 20)
        fail('You have 20 open requests. Close one you no longer need before adding another.');
      const id = randomUUID();
      await run(
        'INSERT INTO product_wishes(id,user_id,name,description,images,max_price,color,quality,quantity,location_id,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        id,
        req.user!.id,
        p.name,
        p.description,
        JSON.stringify(p.images),
        p.max_price,
        p.color,
        p.quality,
        p.quantity,
        p.location_id,
        p.notes,
        now(),
      );
      const w = (await one('SELECT * FROM product_wishes WHERE id=?', id))!;
      const found = await matchWish(w);
      res
        .status(201)
        .json({ ...(await present([(await one('SELECT * FROM product_wishes WHERE id=?', id))!]))[0], found });
    }),
  );
  app.put(
    '/api/wishes/:id',
    requireRole('customer'),
    writeLimit,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = wishSchema.parse(req.body);
      const w = await one(
        'SELECT * FROM product_wishes WHERE id=? AND user_id=?',
        String(req.params.id),
        req.user!.id,
      );
      if (!w) fail('Request not found.', 404);
      await run(
        'UPDATE product_wishes SET name=?,description=?,images=?,max_price=?,color=?,quality=?,quantity=?,location_id=?,notes=? WHERE id=?',
        p.name,
        p.description,
        JSON.stringify(p.images),
        p.max_price,
        p.color,
        p.quality,
        p.quantity,
        p.location_id || null,
        p.notes,
        w.id,
      );
      const next = (await one('SELECT * FROM product_wishes WHERE id=?', w.id))!;
      if (next.status === 'open') await matchWish(next);
      res.json((await present([(await one('SELECT * FROM product_wishes WHERE id=?', w.id))!]))[0]);
    }),
  );
  app.patch(
    '/api/wishes/:id',
    requireRole('customer'),
    atomicRoute(async (req: AuthRequest, res) => {
      const { status } = z.object({ status: z.enum(['open', 'found', 'closed']) }).parse(req.body);
      const r = await run(
        'UPDATE product_wishes SET status=? WHERE id=? AND user_id=?',
        status,
        String(req.params.id),
        req.user!.id,
      );
      if (!r.changes) fail('Request not found.', 404);
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/wishes/:id',
    requireRole('customer'),
    atomicRoute(async (req: AuthRequest, res) => {
      await run(
        'DELETE FROM product_wishes WHERE id=? AND user_id=?',
        String(req.params.id),
        req.user!.id,
      );
      res.json({ ok: true });
    }),
  );

  /** Every request, with who asked, and the words people search for most. */
  app.get('/api/admin/wishes', requireRole('admin'), async (_req, res) => {
    const rows = await all(
      'SELECT w.*,u.name customer_name,u.email customer_email,u.phone customer_phone,l.name area_name FROM product_wishes w JOIN users u ON u.id=w.user_id LEFT JOIN locations l ON l.id=w.location_id ORDER BY w.created_at DESC LIMIT 2000',
    );
    const counts = new Map<string, number>();
    for (const w of rows) for (const x of words(w.name)) counts.set(x, (counts.get(x) || 0) + 1);
    res.json({
      wishes: await present(rows, true),
      top: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([word, count]) => ({ word, count })),
    });
  });
  /** Suggests a product to a customer by hand, for a direct sale. */
  app.post(
    '/api/admin/wishes/:id/suggest',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const { product_id } = z.object({ product_id: z.string().min(1).max(100) }).parse(req.body);
      const w = await one('SELECT * FROM product_wishes WHERE id=?', String(req.params.id));
      if (!w) fail('Request not found.', 404);
      const p = await one(
        'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.id=? AND p.active=1 AND p.deleted_at IS NULL',
        product_id,
      );
      if (!p) fail('Choose a listed product.');
      if (!(await remember(w, [p]))) fail('The customer already has this product in their matches.');
      res.json({ ok: true });
    }),
  );
  app.patch(
    '/api/admin/wishes/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const { status } = z.object({ status: z.enum(['open', 'found', 'closed']) }).parse(req.body);
      const r = await run('UPDATE product_wishes SET status=? WHERE id=?', status, String(req.params.id));
      if (!r.changes) fail('Request not found.', 404);
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/admin/wishes/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      await run('DELETE FROM product_wishes WHERE id=?', String(req.params.id));
      res.json({ ok: true });
    }),
  );
}
