import express, { type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { one, all, run, transaction, type Row } from './db.js';
import {
  session,
  newSession,
  requireRole,
  hashPassword,
  verifyPassword,
  publicUser,
  type AuthRequest,
} from './security.js';
export const app = express();
const origin = process.env.WEB_ORIGIN || 'http://localhost:3000';
const uploadDir = resolve(process.env.UPLOAD_DIR || './data/uploads');
mkdirSync(uploadDir, { recursive: true });
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(session);
app.use('/api', (req, res, next) => {
  if (/^\/(session|auth|profile|orders|manage|admin)(\/|$)/.test(req.path)) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req: AuthRequest, res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== origin
  )
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.cookies?.dellvit_session &&
    !req.headers.authorization &&
    !req.headers.origin
  )
    return res.status(403).json({ error: 'Browser requests require an Origin header.' });
  next();
});
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});
const writeLimit = rateLimit({
  windowMs: 60000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Please wait a moment before trying again.' },
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});
const id = () => randomUUID();
const now = () => new Date().toISOString();
const str = (n = 200) => z.string().trim().min(1).max(n);
const email = z
  .email()
  .max(200)
  .transform((s) => s.toLowerCase());
const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d ()-]{7,20}$/, 'Enter a valid phone number.');
const location = z
  .string()
  .refine(
    (v) => !!one('SELECT id FROM locations WHERE id=?', v),
    'Choose a supported delivery area.',
  );
const uuid = z.string().max(100);
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function safeImage(v: string) {
  return /^\/(images|api\/media)\/[\w.-]+\.(webp|png|jpg|jpeg)$/.test(v);
}
function product(p: Row): Row {
  return {
    ...p,
    images: JSON.parse(p.images),
    effective_price: Math.round((p.price * (100 - p.discount)) / 100),
  };
}
function myOutlet(req: AuthRequest) {
  return one('SELECT * FROM outlets WHERE user_id=?', req.user!.id);
}
function allowedProduct(req: AuthRequest, p: Row) {
  if (req.user!.role === 'outlet' && myOutlet(req)?.id !== p.outlet_id)
    fail('This product belongs to another outlet.', 403);
}
function addEvent(orderId: string, status: string) {
  run('INSERT INTO order_events VALUES(?,?,?,?)', id(), orderId, status, now());
}
function orderVisible(req: AuthRequest, o: Row) {
  if (req.user?.role === 'admin') return true;
  if (req.user?.role === 'rider') return o.rider_id === req.user.id;
  if (req.user?.role === 'outlet') return o.outlet_id === myOutlet(req)?.id;
  return (
    (req.user && o.user_id === req.user.id) || (!o.user_id && o.guest_session === req.sessionHash)
  );
}
function serializeOrder(o: Row, req: AuthRequest) {
  const { guest_session, otp, otp_attempts, otp_locked_until, idempotency_key, ...safe } = o;
  const own =
    (req.user?.role === 'customer' && o.user_id === req.user.id) ||
    (!o.user_id && o.guest_session === req.sessionHash);
  const outlet = one('SELECT name,address,lat,lng,phone FROM outlets WHERE id=?', o.outlet_id);
  const rider = o.rider_id ? one('SELECT name,phone FROM users WHERE id=?', o.rider_id) : null;
  return {
    ...safe,
    ...(own ? { otp } : {}),
    outlet,
    rider,
    items: all('SELECT * FROM order_items WHERE order_id=?', o.id),
    events: all(
      'SELECT status,created_at FROM order_events WHERE order_id=? ORDER BY created_at',
      o.id,
    ),
  };
}
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'dellvit-api' }));
app.get('/api/locations', (_req, res) => res.json(all('SELECT * FROM locations')));
app.get('/api/session', (req: AuthRequest, res) => {
  if (!req.sessionHash) newSession(req, res, null);
  res.json({ user: req.user ? publicUser(req.user) : null });
});
app.post('/api/auth/register', authLimit, (req: AuthRequest, res) => {
  const p = z
    .object({
      name: str(100),
      email,
      phone,
      password: z.string().min(10).max(100),
      address: str(500),
      location_id: location,
    })
    .parse(req.body);
  if (one('SELECT id FROM users WHERE email=?', p.email))
    fail('An account already uses this email.', 409);
  const uid = id();
  run(
    'INSERT INTO users(id,name,email,phone,address,location_id,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    uid,
    p.name,
    p.email,
    p.phone,
    p.address,
    p.location_id,
    hashPassword(p.password),
    'customer',
    now(),
  );
  if (req.sessionHash)
    run(
      'UPDATE orders SET user_id=?,guest_session=NULL WHERE guest_session=? AND user_id IS NULL',
      uid,
      req.sessionHash,
    );
  if (req.sessionHash) run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
  const token = newSession(req, res, uid);
  res
    .status(201)
    .json({
      user: publicUser(one('SELECT * FROM users WHERE id=?', uid)!),
      ...(req.headers['x-client'] === 'mobile' ? { token } : {}),
    });
});
app.post('/api/auth/login', authLimit, (req: AuthRequest, res) => {
  const p = z.object({ login: str(), password: z.string().max(100) }).parse(req.body);
  const u = one('SELECT * FROM users WHERE email=? OR login_id=?', p.login.toLowerCase(), p.login);
  if (!u || !verifyPassword(p.password, u.password_hash) || !u.active)
    fail('Email / ID or password is incorrect.', 401);
  if (req.sessionHash) {
    if (u.role === 'customer')
      run(
        'UPDATE orders SET user_id=?,guest_session=NULL WHERE guest_session=? AND user_id IS NULL',
        u.id,
        req.sessionHash,
      );
    run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
  }
  const token = newSession(req, res, u.id);
  res.json({ user: publicUser(u), ...(req.headers['x-client'] === 'mobile' ? { token } : {}) });
});
app.post('/api/auth/logout', (req: AuthRequest, res) => {
  if (req.sessionHash) run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
  res.clearCookie('dellvit_session', { path: '/' }).json({ ok: true });
});
app.patch(
  '/api/profile',
  requireRole('customer', 'outlet', 'rider', 'admin'),
  (req: AuthRequest, res) => {
    const p = z
      .object({ name: str(100), phone, address: str(500), location_id: location })
      .parse(req.body);
    run(
      'UPDATE users SET name=?,phone=?,address=?,location_id=? WHERE id=?',
      p.name,
      p.phone,
      p.address,
      p.location_id,
      req.user!.id,
    );
    res.json(publicUser(one('SELECT * FROM users WHERE id=?', req.user!.id)!));
  },
);
app.post(
  '/api/auth/password',
  requireRole('customer', 'admin', 'outlet', 'rider'),
  authLimit,
  (req: AuthRequest, res) => {
    const p = z
      .object({ current: z.string().max(100), password: z.string().min(10).max(100) })
      .parse(req.body);
    if (!verifyPassword(p.current, req.user!.password_hash))
      fail('Current password is incorrect.', 400);
    run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(p.password), req.user!.id);
    run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', req.user!.id, req.sessionHash);
    res.json({ ok: true });
  },
);
app.get('/api/products', (req, res) => {
  const { location: loc, q, category, outlet } = req.query;
  let sql =
    'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.active=1 AND o.active=1';
  const args: any[] = [];
  if (loc) {
    sql += ' AND p.location_id=?';
    args.push(String(loc));
  }
  if (category && category !== 'All') {
    sql += ' AND p.category=?';
    args.push(String(category));
  }
  if (outlet) {
    sql += ' AND p.outlet_id=?';
    args.push(String(outlet));
  }
  if (q) {
    sql += ' AND (p.name LIKE ? OR p.description LIKE ? OR o.name LIKE ?)';
    const s = '%' + String(q).slice(0, 100) + '%';
    args.push(s, s, s);
  }
  res.json(all(sql, ...args).map(product));
});
app.get('/api/products/:id', (req, res) => {
  const p = one(
    'SELECT p.*,o.name outlet_name,o.address pickup_address FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.id=? AND p.active=1 AND o.active=1',
    String(req.params.id),
  );
  if (!p) fail('Product not found.', 404);
  res.json(product(p));
});
app.get('/api/outlets', (req, res) =>
  res.json(
    req.query.location
      ? all(
          'SELECT id,name,location_id,address,phone,image,category,active FROM outlets WHERE active=1 AND location_id=?',
          String(req.query.location),
        )
      : all(
          'SELECT id,name,location_id,address,phone,image,category,active FROM outlets WHERE active=1',
        ),
  ),
);
app.get('/api/outlets/:id', (req, res) => {
  const o = one(
    'SELECT id,name,location_id,address,phone,image,category FROM outlets WHERE id=? AND active=1',
    String(req.params.id),
  );
  if (!o) fail('Outlet not found.', 404);
  res.json(o);
});
app.get('/api/ad', (_req, res) =>
  res.json(JSON.parse(one('SELECT value FROM settings WHERE key=?', 'ad')?.value || 'null')),
);
app.post('/api/contact', writeLimit, (req, res) => {
  const p = z.object({ name: str(100), email, message: str(3000) }).parse(req.body);
  run('INSERT INTO messages VALUES(?,?,?,?,?)', id(), p.name, p.email, p.message, now());
  res.status(201).json({ ok: true });
});
const delivery = z.object({
  name: str(100),
  email,
  phone,
  address: str(500),
  location_id: location,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().max(2000).default(''),
});
const cart = z.object({
  items: z
    .array(z.object({ product_id: uuid, quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  delivery,
  payment_method: z.literal('cod').default('cod'),
  idempotency_key: z.string().uuid(),
});
app.post('/api/orders', writeLimit, (req: AuthRequest, res) => {
  const p = cart.parse(req.body);
  if (req.user && req.user.role !== 'customer')
    fail('Use a customer account to place an order.', 403);
  if (!req.sessionHash) newSession(req, res, null);
  const result = transaction(() => {
    const prior = one('SELECT * FROM orders WHERE idempotency_key=?', p.idempotency_key);
    if (prior) {
      if (!orderVisible(req, prior)) fail('Checkout key already used.', 409);
      return prior;
    }
    const ids = new Set(p.items.map((i) => i.product_id));
    if (ids.size !== p.items.length) fail('Duplicate cart items are not allowed.');
    const lines: Row[] = p.items.map((item): Row => {
      const x = one(
        'SELECT p.*,o.active outlet_active FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.id=?',
        item.product_id,
      );
      if (!x || !x.active || !x.outlet_active) fail('An item is no longer available.');
      if (x.location_id !== p.delivery.location_id)
        fail('Every item must be available in your delivery area.');
      if (x.stock < item.quantity) fail(`${x.name} has only ${x.stock} available.`, 409);
      return { ...product(x), quantity: item.quantity };
    });
    if (new Set(lines.map((x) => x.outlet_id)).size !== 1)
      fail('Please order from one outlet at a time.');
    const center = one('SELECT * FROM locations WHERE id=?', p.delivery.location_id)!;
    const km = Math.hypot((p.delivery.lat - center.lat) * 111, (p.delivery.lng - center.lng) * 92);
    if (km > 8) fail('Delivery pin is outside the selected area (8 km).');
    const outlet = lines[0].outlet_id;
    const subtotal = lines.reduce((s, x) => s + x.effective_price * x.quantity, 0);
    const fee = 15000;
    const oid = id();
    const rider = one(
      "SELECT u.id,COUNT(o.id) load FROM users u LEFT JOIN orders o ON o.rider_id=u.id AND o.status NOT IN ('delivered','cancelled') WHERE u.role='rider' AND u.active=1 AND u.location_id=? GROUP BY u.id ORDER BY load ASC LIMIT 1",
      p.delivery.location_id,
    );
    const ref = 'DLV-' + Date.now().toString(36).toUpperCase() + '-' + randomInt(100, 1000);
    const otp = String(randomInt(100000, 1000000));
    const due = new Date(
      Date.now() + Math.max(...lines.map((x) => x.delivery_minutes)) * 60000,
    ).toISOString();
    run(
      'INSERT INTO orders(id,reference,user_id,guest_session,outlet_id,rider_id,name,email,phone,address,location_id,lat,lng,notes,payment_method,subtotal,delivery_fee,total,status,otp,created_at,deliver_by,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      oid,
      ref,
      req.user?.id || null,
      req.user ? null : req.sessionHash!,
      outlet,
      rider?.id || null,
      p.delivery.name,
      p.delivery.email,
      p.delivery.phone,
      p.delivery.address,
      p.delivery.location_id,
      p.delivery.lat,
      p.delivery.lng,
      p.delivery.notes,
      'cod',
      subtotal,
      fee,
      subtotal + fee,
      'placed',
      otp,
      now(),
      due,
      p.idempotency_key,
    );
    for (const x of lines) {
      run('UPDATE products SET stock=stock-? WHERE id=?', x.quantity, x.id);
      run(
        'INSERT INTO order_items VALUES(?,?,?,?,?,?,?)',
        id(),
        oid,
        x.id,
        x.name,
        x.quantity,
        x.effective_price,
        x.images[0],
      );
    }
    addEvent(oid, 'placed');
    return one('SELECT * FROM orders WHERE id=?', oid)!;
  });
  res.status(201).json(serializeOrder(result, req));
});
app.get('/api/orders', (req: AuthRequest, res) => {
  let rows: Row[] = [];
  if (req.user?.role === 'admin') rows = all('SELECT * FROM orders ORDER BY created_at DESC');
  else if (req.user?.role === 'outlet')
    rows = all(
      'SELECT * FROM orders WHERE outlet_id=? ORDER BY created_at DESC',
      myOutlet(req)?.id || '',
    );
  else if (req.user?.role === 'rider')
    rows = all('SELECT * FROM orders WHERE rider_id=? ORDER BY created_at DESC', req.user.id);
  else if (req.user)
    rows = all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC', req.user.id);
  else if (req.sessionHash)
    rows = all(
      'SELECT * FROM orders WHERE guest_session=? ORDER BY created_at DESC',
      req.sessionHash,
    );
  res.json(rows.map((o) => serializeOrder(o, req)));
});
app.get('/api/orders/:id', (req: AuthRequest, res) => {
  const o = one('SELECT * FROM orders WHERE id=?', String(req.params.id));
  if (!o || !orderVisible(req, o)) fail('Order not found.', 404);
  res.json(serializeOrder(o, req));
});
app.patch(
  '/api/orders/:id/status',
  requireRole('admin', 'outlet', 'rider', 'customer'),
  (req: AuthRequest, res) => {
    const { status } = z
      .object({ status: z.enum(['confirmed', 'preparing', 'ready', 'picked_up', 'cancelled']) })
      .parse(req.body);
    const o = one('SELECT * FROM orders WHERE id=?', String(req.params.id));
    if (!o || !orderVisible(req, o)) fail('Order not found.', 404);
    const transitions: Record<string, string> = {
      placed: 'confirmed',
      confirmed: 'preparing',
      preparing: 'ready',
      ready: 'picked_up',
    };
    const role = req.user!.role;
    if (status === 'cancelled') {
      if (!['placed', 'confirmed'].includes(o.status) || !['admin', 'customer'].includes(role))
        fail('This order can no longer be cancelled.');
    } else {
      if (transitions[o.status] !== status) fail('Invalid order status transition.');
      if (
        status === 'picked_up'
          ? !['admin', 'rider'].includes(role)
          : !['admin', 'outlet'].includes(role)
      )
        fail('You cannot make this status change.', 403);
    }
    transaction(() => {
      run('UPDATE orders SET status=? WHERE id=?', status, o.id);
      if (status === 'cancelled')
        for (const item of all('SELECT * FROM order_items WHERE order_id=?', o.id))
          run('UPDATE products SET stock=stock+? WHERE id=?', item.quantity, item.product_id);
      addEvent(o.id, status);
    });
    res.json(serializeOrder(one('SELECT * FROM orders WHERE id=?', o.id)!, req));
  },
);
app.post('/api/orders/:id/verify', requireRole('rider'), authLimit, (req: AuthRequest, res) => {
  const { otp } = z
    .object({ otp: z.string().regex(/^\d{6}$/), cash_received: z.literal(true) })
    .parse(req.body);
  const o = one(
    'SELECT * FROM orders WHERE id=? AND rider_id=?',
    String(req.params.id),
    req.user!.id,
  );
  if (!o) fail('Order not found.', 404);
  if (o.status !== 'picked_up') fail('Pick up the order before verifying delivery.');
  if (o.otp_locked_until && o.otp_locked_until > now())
    fail('Too many incorrect codes. Try again in 15 minutes.', 429);
  if (o.otp !== otp) {
    const attempts = (o.otp_locked_until ? 0 : o.otp_attempts) + 1;
    run(
      'UPDATE orders SET otp_attempts=?,otp_locked_until=? WHERE id=?',
      attempts,
      attempts >= 5 ? new Date(Date.now() + 900000).toISOString() : null,
      o.id,
    );
    fail('The delivery code is incorrect.');
  }
  transaction(() => {
    run("UPDATE orders SET status='delivered',delivered_at=? WHERE id=?", now(), o.id);
    addEvent(o.id, 'delivered');
  });
  res.json({ ok: true });
});
app.get('/api/manage/products', requireRole('admin', 'outlet'), (req: AuthRequest, res) =>
  res.json(
    (req.user!.role === 'admin'
      ? all('SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id')
      : all(
          'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.outlet_id=?',
          myOutlet(req)?.id || '',
        )
    ).map(product),
  ),
);
const productSchema = z.object({
  name: str(150),
  description: str(2000),
  category: z.enum(['Food', 'Groceries', 'Parcels', 'More']),
  price: z.number().int().min(100).max(100000000),
  stock: z.number().int().min(0).max(100000),
  unit: str(100),
  location_id: location,
  discount: z.number().int().min(0).max(90),
  deal: z.string().max(150).default(''),
  images: z.array(z.string().refine(safeImage, 'Upload a product image.')).min(1).max(6),
  includes: str(1000),
  excludes: str(1000),
  delivery_minutes: z.number().int().min(10).max(240),
  outlet_id: uuid,
  active: z.number().int().min(0).max(1).default(1),
});
function saveProduct(req: AuthRequest, res: Response, editing: boolean) {
  const p = productSchema.parse(req.body);
  const pid = editing ? String(req.params.id) : id();
  if (editing) {
    const old = one('SELECT * FROM products WHERE id=?', pid);
    if (!old) fail('Product not found.', 404);
    allowedProduct(req, old);
  }
  allowedProduct(req, p);
  if (!one('SELECT id FROM outlets WHERE id=?', p.outlet_id)) fail('Outlet not found.');
  const values = [
    p.outlet_id,
    p.name,
    p.description,
    p.category,
    p.price,
    p.stock,
    p.unit,
    p.location_id,
    p.discount,
    p.deal,
    JSON.stringify(p.images),
    p.includes,
    p.excludes,
    p.delivery_minutes,
    p.active,
  ];
  if (editing)
    run(
      'UPDATE products SET outlet_id=?,name=?,description=?,category=?,price=?,stock=?,unit=?,location_id=?,discount=?,deal=?,images=?,includes=?,excludes=?,delivery_minutes=?,active=? WHERE id=?',
      ...values,
      pid,
    );
  else run('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', pid, ...values);
  res.json(product(one('SELECT * FROM products WHERE id=?', pid)!));
}
app.post('/api/manage/products', requireRole('admin', 'outlet'), (req: AuthRequest, res) =>
  saveProduct(req, res, false),
);
app.put('/api/manage/products/:id', requireRole('admin', 'outlet'), (req: AuthRequest, res) =>
  saveProduct(req, res, true),
);
app.delete('/api/manage/products/:id', requireRole('admin', 'outlet'), (req: AuthRequest, res) => {
  const p = one('SELECT * FROM products WHERE id=?', String(req.params.id));
  if (!p) fail('Product not found.', 404);
  allowedProduct(req, p);
  run('UPDATE products SET active=0 WHERE id=?', p.id);
  res.json({ ok: true });
});
app.post(
  '/api/manage/images',
  requireRole('admin', 'outlet'),
  writeLimit,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) fail('Choose an image.');
    const f = id() + '.webp';
    try {
      await sharp(req.file.buffer, { limitInputPixels: 24000000 })
        .rotate()
        .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(resolve(uploadDir, f));
    } catch {
      fail('Upload a valid PNG, JPEG or WebP image.');
    }
    res.status(201).json({ url: '/api/media/' + f });
  },
);
app.get('/api/media/:name', (req, res) => {
  const name = String(req.params.name);
  if (!/^[\da-f-]+\.webp$/.test(name)) fail('File not found.', 404);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.sendFile(resolve(uploadDir, name));
});
app.get('/api/manage/outlet', requireRole('outlet'), (req: AuthRequest, res) =>
  res.json(myOutlet(req)),
);
app.use('/api/admin', requireRole('admin'));
const locationSchema = z.object({
  name: str(150),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
app.post('/api/admin/locations', (req, res) => {
  const p = locationSchema.parse(req.body);
  const lid = id();
  run('INSERT INTO locations VALUES(?,?,?,?)', lid, p.name, p.lat, p.lng);
  res.status(201).json({ id: lid, ...p });
});
app.put('/api/admin/locations/:id', (req, res) => {
  const p = locationSchema.parse(req.body);
  if (!one('SELECT id FROM locations WHERE id=?', String(req.params.id)))
    fail('Delivery area not found.', 404);
  run(
    'UPDATE locations SET name=?,lat=?,lng=? WHERE id=?',
    p.name,
    p.lat,
    p.lng,
    String(req.params.id),
  );
  res.json({ id: String(req.params.id), ...p });
});
app.get('/api/admin/summary', (_req, res) =>
  res.json({
    orders: one('SELECT COUNT(*) n FROM orders')!.n,
    revenue: one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='delivered'")!.n,
    active_orders: one(
      "SELECT COUNT(*) n FROM orders WHERE status NOT IN ('delivered','cancelled')",
    )!.n,
    outlets: one('SELECT COUNT(*) n FROM outlets WHERE active=1')!.n,
  }),
);
app.get('/api/admin/outlets', (_req, res) => res.json(all('SELECT * FROM outlets')));
const outletSchema = z.object({
  name: str(150),
  phone,
  email,
  location_id: location,
  address: str(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  customer_id: z.string().regex(/^[A-Z0-9-]{3,30}$/),
  password: z.string().min(10).max(100).optional(),
  image: z.string().refine(safeImage),
  category: z.enum(['Food', 'Groceries', 'Parcels', 'More']),
  active: z.number().int().min(0).max(1).default(1),
});
function saveOutlet(req: AuthRequest, res: Response, edit: boolean) {
  const p = outletSchema.parse(req.body);
  const oid = edit ? String(req.params.id) : id();
  const old = edit ? one('SELECT * FROM outlets WHERE id=?', oid) : null;
  if (edit && !old) fail('Outlet not found.', 404);
  if (!edit && !p.password) fail('Set a password for the outlet account.');
  const uid = old?.user_id || id();
  transaction(() => {
    if (edit) {
      run(
        'UPDATE users SET name=?,email=?,phone=?,address=?,location_id=?,login_id=?,active=? WHERE id=?',
        p.name,
        p.email,
        p.phone,
        p.address,
        p.location_id,
        p.customer_id,
        p.active,
        uid,
      );
      if (p.password)
        run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(p.password), uid);
      run(
        'UPDATE outlets SET name=?,phone=?,email=?,location_id=?,address=?,lat=?,lng=?,customer_id=?,active=?,image=?,category=? WHERE id=?',
        p.name,
        p.phone,
        p.email,
        p.location_id,
        p.address,
        p.lat,
        p.lng,
        p.customer_id,
        p.active,
        p.image,
        p.category,
        oid,
      );
    } else {
      run(
        'INSERT INTO users(id,name,email,phone,address,location_id,password_hash,role,login_id,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        uid,
        p.name,
        p.email,
        p.phone,
        p.address,
        p.location_id,
        hashPassword(p.password!),
        'outlet',
        p.customer_id,
        p.active,
        now(),
      );
      run(
        'INSERT INTO outlets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        oid,
        p.name,
        p.phone,
        p.email,
        p.location_id,
        p.address,
        p.lat,
        p.lng,
        p.customer_id,
        uid,
        p.active,
        p.image,
        p.category,
      );
    }
  });
  res.json(one('SELECT * FROM outlets WHERE id=?', oid));
}
app.post('/api/admin/outlets', (req: AuthRequest, res) => saveOutlet(req, res, false));
app.put('/api/admin/outlets/:id', (req: AuthRequest, res) => saveOutlet(req, res, true));
app.get('/api/admin/riders', (_req, res) =>
  res.json(
    all(
      "SELECT id,name,email,phone,address,location_id,login_id,active FROM users WHERE role='rider'",
    ),
  ),
);
const riderSchema = z.object({
  name: str(100),
  email,
  phone,
  address: str(500),
  location_id: location,
  login_id: z.string().regex(/^[A-Z0-9-]{3,30}$/),
  password: z.string().min(10).max(100).optional(),
  active: z.number().int().min(0).max(1).default(1),
});
function saveRider(req: AuthRequest, res: Response, edit: boolean) {
  const p = riderSchema.parse(req.body);
  const uid = edit ? String(req.params.id) : id();
  if (edit && !one("SELECT id FROM users WHERE id=? AND role='rider'", uid))
    fail('Rider not found.', 404);
  if (!edit && !p.password) fail('Set a rider password.');
  if (edit) {
    run(
      'UPDATE users SET name=?,email=?,phone=?,address=?,location_id=?,login_id=?,active=? WHERE id=?',
      p.name,
      p.email,
      p.phone,
      p.address,
      p.location_id,
      p.login_id,
      p.active,
      uid,
    );
    if (p.password)
      run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(p.password), uid);
  } else
    run(
      'INSERT INTO users(id,name,email,phone,address,location_id,password_hash,role,login_id,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      uid,
      p.name,
      p.email,
      p.phone,
      p.address,
      p.location_id,
      hashPassword(p.password!),
      'rider',
      p.login_id,
      p.active,
      now(),
    );
  res.json(publicUser(one('SELECT * FROM users WHERE id=?', uid)!));
}
app.post('/api/admin/riders', (req: AuthRequest, res) => saveRider(req, res, false));
app.put('/api/admin/riders/:id', (req: AuthRequest, res) => saveRider(req, res, true));
app.patch('/api/admin/orders/:id/assign', (req, res) => {
  const { rider_id } = z.object({ rider_id: uuid }).parse(req.body);
  const o = one('SELECT * FROM orders WHERE id=?', String(req.params.id));
  if (!o) fail('Order not found.', 404);
  if (['delivered', 'cancelled'].includes(o.status))
    fail('A completed order cannot be reassigned.');
  const r = one("SELECT * FROM users WHERE id=? AND role='rider' AND active=1", rider_id);
  if (!r || r.location_id !== o.location_id) fail('Choose an active rider in the delivery area.');
  run('UPDATE orders SET rider_id=? WHERE id=?', rider_id, o.id);
  res.json({ ok: true });
});
app.get('/api/admin/outlets/:id/documents', (req, res) =>
  res.json(
    all('SELECT id,name,mime,created_at FROM documents WHERE outlet_id=?', String(req.params.id)),
  ),
);
app.post('/api/admin/outlets/:id/documents', writeLimit, upload.single('file'), (req, res) => {
  if (!one('SELECT id FROM outlets WHERE id=?', String(req.params.id)))
    fail('Outlet not found.', 404);
  if (!req.file) fail('Choose a PDF document.');
  if (req.file.buffer.subarray(0, 5).toString() !== '%PDF-')
    fail('Only PDF documents are accepted.');
  const did = id();
  const filename = did + '.pdf';
  writeFileSync(resolve(uploadDir, filename), req.file.buffer);
  run(
    'INSERT INTO documents VALUES(?,?,?,?,?,?)',
    did,
    String(req.params.id),
    req.file.originalname.slice(0, 200),
    filename,
    'application/pdf',
    now(),
  );
  res.status(201).json({ id: did });
});
app.get('/api/admin/documents/:id', (req, res) => {
  const d = one('SELECT * FROM documents WHERE id=?', String(req.params.id));
  if (!d) fail('Document not found.', 404);
  res.setHeader('Cache-Control', 'no-store');
  res.download(resolve(uploadDir, d.filename), d.name);
});
app.delete('/api/admin/documents/:id', (req, res) => {
  const d = one('SELECT * FROM documents WHERE id=?', String(req.params.id));
  if (!d) fail('Document not found.', 404);
  if (existsSync(resolve(uploadDir, d.filename))) unlinkSync(resolve(uploadDir, d.filename));
  run('DELETE FROM documents WHERE id=?', d.id);
  res.json({ ok: true });
});
app.get('/api/admin/messages', (_req, res) =>
  res.json(all('SELECT * FROM messages ORDER BY created_at DESC')),
);
app.put('/api/admin/ad', (req, res) => {
  const p = z
    .object({
      title: str(100),
      description: str(300),
      label: str(40),
      link: z
        .string()
        .max(300)
        .refine(
          (s) => /^\/(?!\/)[\w/?=&%-]*$/.test(s) || /^https:\/\/[^\s]+$/.test(s),
          'Use a relative path or HTTPS URL.',
        ),
      image: z.string().refine(safeImage),
      active: z.boolean(),
    })
    .parse(req.body);
  run(
    'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    'ad',
    JSON.stringify(p),
  );
  res.json(p);
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((err: any, _req: AuthRequest, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: 'Upload one file up to 8 MB.' });
  if (err.code?.startsWith('ERR_SQLITE') || err.code?.startsWith('SQLITE')) {
    if (String(err.message).includes('UNIQUE'))
      return res.status(409).json({ error: 'That email or account ID is already in use.' });
  }
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
