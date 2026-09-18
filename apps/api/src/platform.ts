import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, all, one, run, transaction, type Row } from './db.js';
import { requireRole, hashPassword, publicUser, type AuthRequest } from './security.js';
import { cardGateway } from './cards.js';

export const permissions = [
  'overview',
  'orders',
  'products',
  'outlets',
  'riders',
  'locations',
  'ads',
  'messages',
  'categories',
  'content',
  'coupons',
  'payments',
  'customers',
  'audit',
  'settings',
] as const;
db.exec(`
CREATE TABLE IF NOT EXISTS admin_access(user_id TEXT PRIMARY KEY REFERENCES users(id),super INTEGER NOT NULL DEFAULT 0,permissions TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS platform_records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS area_settings(location_id TEXT PRIMARY KEY REFERENCES locations(id),active INTEGER NOT NULL DEFAULT 1,radius REAL NOT NULL DEFAULT 8,fee INTEGER NOT NULL DEFAULT 15000);
CREATE TABLE IF NOT EXISTS rider_state(user_id TEXT PRIMARY KEY REFERENCES users(id),available INTEGER NOT NULL DEFAULT 1,capacity INTEGER NOT NULL DEFAULT 5,lat REAL,lng REAL,accuracy REAL,updated_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,target TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_details(order_id TEXT PRIMARY KEY REFERENCES orders(id),discount INTEGER NOT NULL DEFAULT 0,coupon_code TEXT NOT NULL DEFAULT '',payment_name TEXT NOT NULL,payment_type TEXT NOT NULL,payment_instructions TEXT NOT NULL DEFAULT '',payment_status TEXT NOT NULL DEFAULT 'due');
CREATE TABLE IF NOT EXISTS coupon_uses(order_id TEXT PRIMARY KEY REFERENCES orders(id),coupon_id TEXT NOT NULL);
`);
if (!one("SELECT key FROM settings WHERE key='platform_migrated'")) {
  transaction(() => {
    const first = one("SELECT id FROM users WHERE role='admin' ORDER BY created_at,id LIMIT 1");
    if (first)
      run(
        'INSERT OR IGNORE INTO admin_access VALUES(?,1,?)',
        first.id,
        JSON.stringify(permissions),
      );
    // Carry forward existing merchant categories; never create example inventory.
    for (const c of all(
      'SELECT DISTINCT category FROM products UNION SELECT DISTINCT category FROM outlets',
    )) {
      run(
        'INSERT OR IGNORE INTO platform_records VALUES(?,?,?)',
        'categories',
        c.category,
        JSON.stringify({ name: c.category, description: '', image: '', active: true, position: 0 }),
      );
    }
    run(
      'INSERT OR IGNORE INTO platform_records VALUES(?,?,?)',
      'payments',
      'cod',
      JSON.stringify({
        name: 'Cash on delivery',
        type: 'cod',
        instructions: 'Pay your rider when your order arrives.',
        active: true,
        position: 0,
      }),
    );
    run("INSERT INTO settings VALUES('platform_migrated','true')");
  });
}
export function access(user?: Row) {
  const a =
    user?.role === 'admin' ? one('SELECT * FROM admin_access WHERE user_id=?', user.id) : undefined;
  return {
    is_super_admin: !!a?.super,
    permissions: a ? (JSON.parse(a.permissions) as string[]) : [],
  };
}
export function can(user: Row | undefined, permission: string) {
  const a = access(user);
  return a.is_super_admin || a.permissions.includes(permission);
}
export function records(kind: string, activeOnly = false): Row[] {
  return all('SELECT * FROM platform_records WHERE kind=?', kind)
    .map((r) => ({ ...JSON.parse(r.data), id: r.id }))
    .filter((r) => !activeOnly || r.active)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}
export function areaSettings(id: string) {
  return (
    one('SELECT * FROM area_settings WHERE location_id=?', id) || {
      active: 1,
      radius: 8,
      fee: 15000,
    }
  );
}
/** Gateway credentials that must never leave the server. */
const secretKeys = ['secret_key', 'webhook_secret'];
/** Enabled payment methods, safe for customers: gateway credentials are removed. */
export function paymentMethods() {
  return records('payments', true).map(({ merchant_id, api_base_url, ...m }) =>
    Object.fromEntries(Object.entries(m).filter(([k]) => !secretKeys.includes(k))),
  );
}
/** All methods for the admin panel: secrets are replaced by whether they are set. */
function adminPaymentMethods() {
  return records('payments').map((m) => ({
    ...m,
    ...Object.fromEntries(secretKeys.flatMap((k) => [[k, ''], [k + '_set', !!m[k]]])),
    ...(m.type === 'card' ? { gateway_connected: !!cardGateway(m) } : {}),
  }));
}
export function couponDiscount(code: string, subtotal: number) {
  if (!code) return { discount: 0, coupon: null };
  const c = records('coupons', true).find((c) => c.code === code.trim().toUpperCase());
  const date = new Date().toISOString();
  if (
    !c ||
    (c.starts_at && c.starts_at > date) ||
    (c.ends_at && c.ends_at < date) ||
    subtotal < c.minimum ||
    one('SELECT COUNT(*) n FROM coupon_uses WHERE coupon_id=?', c.id)!.n >= c.limit
  )
    throw Object.assign(
      new Error('This coupon is unavailable, expired, or its minimum has not been reached.'),
      { status: 400 },
    );
  return {
    discount: Math.min(
      subtotal,
      c.type === 'percent' ? Math.round((subtotal * c.value) / 100) : c.value,
    ),
    coupon: c,
  };
}
export const cardNetworks = ['Visa', 'Mastercard', 'UnionPay', 'PayPak', 'American Express'] as const;
const text = z.string().trim().min(1).max(200);
const image = z
  .string()
  .max(500)
  .refine(
    (v) => !v || /^\/(images|api\/media)\/[\w.-]+\.(webp|png|jpg|jpeg)$/.test(v),
    'Upload a local image.',
  );
const link = z
  .string()
  .max(500)
  .refine((v) => !v || /^\/(?!\/)[\w/?=&%#.-]*$/.test(v), 'Use a website path, such as /search.');
const base = {
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(999).default(0),
};
const schemas: Record<string, z.ZodType> = {
  settings: z.object({
    ...base,
    name: text,
    support_email: z.email(),
    support_phone: z.string().regex(/^\+?[\d ()-]{7,20}$/),
    support_address: z.string().max(500),
    about_title: text,
    about_description: z.string().max(4000),
    checkout_enabled: z.boolean(),
    minimum_order: z.number().int().min(0).max(10000000),
    show_trust: z.boolean(),
    show_categories: z.boolean(),
    show_nearby: z.boolean(),
    show_how: z.boolean(),
    show_why: z.boolean(),
    show_ad: z.boolean(),
    show_outlets: z.boolean().default(true),
    show_category_products: z.boolean().default(true),
  }),
  categories: z.object({
    ...base,
    name: text,
    description: z.string().max(500).default(''),
    image,
    show_on_home: z.boolean().default(true),
  }),
  content: z.object({
    ...base,
    name: text,
    type: z.enum(['hero', 'section', 'banner']),
    description: z.string().max(2000).default(''),
    image,
    link,
    button: z.string().max(80).default('Explore'),
  }),
  coupons: z
    .object({
      ...base,
      name: text,
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9_-]{3,30}$/),
      type: z.enum(['percent', 'fixed']),
      value: z.number().int().positive().max(10000000),
      minimum: z.number().int().min(0),
      limit: z.number().int().positive().max(1000000),
      starts_at: z.union([z.iso.datetime(), z.literal('')]),
      ends_at: z.union([z.iso.datetime(), z.literal('')]),
    })
    .refine((v) => v.type !== 'percent' || v.value <= 100, 'Percent must be 100 or less.')
    .refine((v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at, 'End must follow start.'),
  payments: z
    .object({
      ...base,
      name: text,
      type: z.enum(['cod', 'bank', 'wallet', 'raast', 'card']),
      logo: image.default(''),
      instructions: z.string().max(2000).default(''),
      bank_name: z.string().trim().max(100).default(''),
      account_title: z.string().trim().max(100).default(''),
      account_number: z
        .string()
        .max(40)
        .default('')
        .transform((v) => v.replace(/[\s-]/g, '')),
      iban: z
        .string()
        .max(40)
        .default('')
        .transform((v) => v.replace(/\s/g, '').toUpperCase()),
      branch_code: z.string().trim().max(20).default(''),
      provider: z.string().trim().max(40).default(''),
      mobile_number: z.string().max(20).default('').transform(pkMobile),
      raast_id: z
        .string()
        .max(40)
        .default('')
        .transform((v) => (/^PK/i.test(v.trim()) ? v.replace(/\s/g, '').toUpperCase() : pkMobile(v))),
      card_networks: z.array(z.enum(cardNetworks)).max(cardNetworks.length).default([]),
      // Card gateway integration settings.
      gateway: z.string().trim().max(60).default(''),
      environment: z.enum(['sandbox', 'live']).default('sandbox'),
      merchant_id: z.string().trim().max(200).default(''),
      public_key: z.string().trim().max(500).default(''),
      secret_key: z.string().trim().max(1000).default(''),
      webhook_secret: z.string().trim().max(1000).default(''),
      api_base_url: z
        .string()
        .trim()
        .max(500)
        .default('')
        .refine((v) => !v || /^https:\/\/[^\s]+$/i.test(v), 'The API URL must start with https://.'),
      three_d_secure: z.boolean().default(true),
      require_proof: z.boolean().default(false),
    })
    .superRefine((v, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (v.type === 'cod') return;
      if (v.type === 'card') {
        if (!v.gateway) issue('gateway', 'Choose the card payment gateway.');
        if (!v.card_networks.length) issue('card_networks', 'Choose at least one accepted card.');
        if (!v.merchant_id && !v.public_key)
          issue('public_key', 'Enter the merchant ID or public key from your gateway.');
        if (!v.secret_key) issue('secret_key', 'Enter the secret key from your gateway.');
        return;
      }
      if (!v.account_title) issue('account_title', 'Enter the account title.');
      if (v.type === 'bank') {
        if (!v.bank_name) issue('bank_name', 'Enter the bank name.');
        if (!v.account_number && !v.iban) issue('iban', 'Enter an account number or IBAN.');
        if (v.account_number && !/^\d{6,24}$/.test(v.account_number))
          issue('account_number', 'Account numbers contain 6–24 digits.');
        if (v.iban && !IBAN.test(v.iban))
          issue('iban', 'A Pakistani IBAN has 24 characters, for example PK36SCBL0000001123456702.');
      }
      if (v.type === 'wallet') {
        if (!walletProviders.includes(v.provider)) issue('provider', 'Choose a wallet provider.');
        if (!MOBILE.test(v.mobile_number))
          issue('mobile_number', 'Enter the wallet mobile number as 03XXXXXXXXX.');
      }
      if (v.type === 'raast' && !MOBILE.test(v.raast_id) && !IBAN.test(v.raast_id))
        issue('raast_id', 'Use a Raast ID (03XXXXXXXXX mobile number) or an IBAN.');
    }),
};
/** Keep in sync with wallets in apps/web/lib/paymentProviders.ts */
export const walletProviders = [
  'JazzCash',
  'Easypaisa',
  'SadaPay',
  'NayaPay',
  'UPaisa',
  'Konnect by HBL',
  'Zindigi',
  'SimSim',
  'MCB Lite',
  'Alfa by Bank Alfalah',
  'Other',
];
const IBAN = /^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/;
const MOBILE = /^03\d{9}$/;
function pkMobile(v: string) {
  const d = v.replace(/[\s()-]/g, '');
  return d.startsWith('+92') ? '0' + d.slice(3) : d.startsWith('92') && d.length === 12 ? '0' + d.slice(2) : d;
}
export const isOnline = (type?: string) => !!type && type !== 'cod';
export function installPlatform(app: Express) {
  app.use('/api', (req: AuthRequest, res, next) => {
    if (req.user?.role !== 'admin') return next();
    const parts = req.path.split('/').filter(Boolean);
    let p: string | undefined;
    if (parts[0] === 'admin')
      p =
        parts[1] === 'records'
          ? parts[2]
          : (
              {
                summary: 'overview',
                ad: 'ads',
                documents: 'outlets',
                staff: 'staff',
                'area-settings': 'locations',
                'rider-controls': 'riders',
                tracking: 'riders',
                cash: 'riders',
                payouts: 'riders',
              } as Record<string, string>
            )[parts[1]] || parts[1];
    if (parts[0] === 'orders') p = 'orders';
    if (parts[0] === 'manage') p = parts[1] === 'images' ? 'images' : 'products';
    const allowed =
      p === 'images'
        ? ['products', 'outlets', 'ads', 'content', 'categories', 'payments'].some((x) =>
            can(req.user, x),
          )
        : p === 'staff'
          ? access(req.user).is_super_admin
          : !p || can(req.user, p);
    if (!allowed)
      return res
        .status(403)
        .json({ error: 'Your administrator has not granted access to this module.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && p) {
      const json = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode < 400)
          run(
            'INSERT INTO audit_log VALUES(?,?,?,?,?)',
            randomUUID(),
            req.user!.id,
            req.method,
            req.path,
            new Date().toISOString(),
          );
        return json(body);
      };
    }
    next();
  });
  app.get('/api/site', (_req, res) =>
    res.json({
      categories: records('categories', true),
      content: records('content', true),
      payments: paymentMethods(),
      settings: records('settings', true)[0] || null,
    }),
  );
  app.get('/api/categories', (_req, res) => res.json(records('categories', true)));
  app.get('/api/payments', (_req, res) => res.json(paymentMethods()));
  app.post('/api/quote', (req, res) => {
    const p = z
      .object({
        items: z
          .array(z.object({ product_id: text, quantity: z.number().int().min(1).max(99) }))
          .min(1)
          .max(50),
        location_id: text,
        coupon_code: z.string().max(30).default(''),
      })
      .parse(req.body);
    let subtotal = 0;
    for (const i of p.items) {
      const x = one('SELECT * FROM products WHERE id=? AND active=1', i.product_id);
      if (!x || x.location_id !== p.location_id)
        return res.status(400).json({ error: 'An item is unavailable in this area.' });
      subtotal += Math.round((x.price * (100 - x.discount)) / 100) * i.quantity;
    }
    const area = areaSettings(p.location_id);
    const { discount } = couponDiscount(p.coupon_code, subtotal);
    res.json({ subtotal, delivery_fee: area.fee, discount, total: subtotal + area.fee - discount });
  });
  app.get('/api/admin/records/:kind', requireRole('admin'), (req, res) => {
    if (!schemas[String(req.params.kind)]) return res.sendStatus(404);
    res.json(req.params.kind === 'payments' ? adminPaymentMethods() : records(String(req.params.kind)));
  });
  app.put('/api/admin/records/:kind/:id', requireRole('admin'), (req, res) => {
    const kind = String(req.params.kind),
      id = String(req.params.id);
    if (!schemas[kind]) return res.sendStatus(404);
    const body = { ...req.body };
    if (kind === 'payments') {
      // Secrets are never sent back to the browser, so a blank field keeps the saved value.
      const saved = records(kind).find((m) => m.id === id);
      for (const k of secretKeys) if (!body[k] && saved?.[k]) body[k] = saved[k];
      if (body.type !== 'card')
        for (const k of ['gateway', 'merchant_id', 'public_key', 'api_base_url', ...secretKeys])
          delete body[k];
    }
    const p = schemas[kind].parse(body) as Row;
    if (kind === 'settings' && id !== 'global')
      return res.status(400).json({ error: 'Use the global settings record.' });
    if (kind === 'coupons' && records(kind).some((c) => c.id !== id && c.code === p.code))
      return res.status(409).json({ error: 'Coupon code already exists.' });
    if (kind === 'payments') {
      const old = records(kind).find((m) => m.id === id);
      if (old && (old.type === 'manual' ? 'bank' : old.type) !== p.type)
        return res
          .status(400)
          .json({ error: 'The payment type cannot be changed. Create a new method instead.' });
      if (p.type === 'card' && records(kind).some((m) => m.id !== id && m.type === 'card'))
        return res.status(409).json({
          error: 'Only one card payment method is allowed. Edit or delete the existing one.',
        });
    }
    if (kind === 'categories') {
      if (records(kind).some((c) => c.id !== id && c.name.toLowerCase() === p.name.toLowerCase()))
        return res.status(409).json({ error: 'Category already exists.' });
      const old = records(kind).find((c) => c.id === id);
      transaction(() => {
        if (old) {
          run('UPDATE products SET category=? WHERE category=?', p.name, old.name);
          run('UPDATE outlets SET category=? WHERE category=?', p.name, old.name);
        }
        run(
          'INSERT INTO platform_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
          kind,
          id,
          JSON.stringify(p),
        );
      });
    } else
      run(
        'INSERT INTO platform_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
        kind,
        id,
        JSON.stringify(p),
      );
    res.json(
      kind === 'payments'
        ? adminPaymentMethods().find((m) => m.id === id)
        : { ...p, id },
    );
  });
  app.patch('/api/admin/records/:kind/:id', requireRole('admin'), (req, res) => {
    const kind = String(req.params.kind),
      id = String(req.params.id);
    if (!schemas[kind] || kind === 'settings') return res.sendStatus(404);
    const p = z.object({ active: z.boolean() }).parse(req.body);
    const row = one('SELECT data FROM platform_records WHERE kind=? AND id=?', kind, id);
    if (!row) return res.sendStatus(404);
    run(
      'UPDATE platform_records SET data=? WHERE kind=? AND id=?',
      JSON.stringify({ ...JSON.parse(row.data), active: p.active }),
      kind,
      id,
    );
    res.json({ ok: true });
  });
  app.delete('/api/admin/records/:kind/:id', requireRole('admin'), (req, res) => {
    const kind = String(req.params.kind),
      id = String(req.params.id);
    if (!schemas[kind] || kind === 'settings') return res.sendStatus(404);
    const record = records(kind).find((r) => r.id === id);
    if (!record) return res.sendStatus(404);
    if (
      kind === 'categories' &&
      one(
        'SELECT 1 FROM products WHERE category=? UNION SELECT 1 FROM outlets WHERE category=?',
        record.name,
        record.name,
      )
    )
      return res
        .status(409)
        .json({ error: 'Products or outlets still use this category. Disable it instead.' });
    run('DELETE FROM platform_records WHERE kind=? AND id=?', kind, id);
    res.json({ ok: true });
  });
  app.get('/api/admin/staff', requireRole('admin'), (_req, res) =>
    res.json({
      permissions,
      users: all("SELECT * FROM users WHERE role='admin'").map((u) => ({
        ...publicUser(u),
        ...access(u),
      })),
    }),
  );
  app.put('/api/admin/staff/:id', requireRole('admin'), (req: AuthRequest, res) => {
    const p = z
      .object({
        name: text,
        email: z.email().transform((v) => v.toLowerCase()),
        password: z.string().min(12).max(100).optional(),
        active: z.boolean(),
        permissions: z.array(z.enum(permissions)).max(permissions.length),
      })
      .parse(req.body);
    const id = String(req.params.id),
      old = one('SELECT * FROM users WHERE id=?', id);
    if (old && (old.role !== 'admin' || access(old).is_super_admin))
      return res
        .status(403)
        .json({ error: 'The super administrator cannot be changed here. Use account settings.' });
    if (!old && !p.password)
      return res.status(400).json({ error: 'A password is required for new administrators.' });
    transaction(() => {
      if (old)
        run(
          'UPDATE users SET name=?,email=?,active=?,password_hash=? WHERE id=?',
          p.name,
          p.email,
          Number(p.active),
          p.password ? hashPassword(p.password) : old.password_hash,
          id,
        );
      else
        run(
          "INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,'admin',?,?)",
          id,
          p.name,
          p.email,
          hashPassword(p.password!),
          Number(p.active),
          new Date().toISOString(),
        );
      run(
        'INSERT INTO admin_access VALUES(?,0,?) ON CONFLICT(user_id) DO UPDATE SET permissions=excluded.permissions',
        id,
        JSON.stringify(p.permissions),
      );
      run('DELETE FROM sessions WHERE user_id=?', id);
    });
    res.json({ ok: true });
  });
  app.get('/api/admin/audit', requireRole('admin'), (_req, res) =>
    res.json(
      all(
        'SELECT a.*,u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY created_at DESC LIMIT 200',
      ),
    ),
  );
  app.get('/api/admin/customers', requireRole('admin'), (_req, res) =>
    res.json(
      all(
        "SELECT u.id,u.name,u.email,u.phone,u.active,u.created_at,COUNT(o.id) orders,COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total ELSE 0 END),0) spent FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' GROUP BY u.id ORDER BY u.created_at DESC",
      ),
    ),
  );
  app.patch('/api/admin/customers/:id', requireRole('admin'), (req, res) => {
    const p = z.object({ active: z.boolean() }).parse(req.body);
    run(
      "UPDATE users SET active=? WHERE id=? AND role='customer'",
      Number(p.active),
      String(req.params.id),
    );
    if (!p.active) run('DELETE FROM sessions WHERE user_id=?', String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/admin/area-settings', requireRole('admin'), (_req, res) =>
    res.json(all('SELECT * FROM locations').map((l) => ({ ...l, ...areaSettings(l.id) }))),
  );
  app.put('/api/admin/area-settings/:id', requireRole('admin'), (req, res) => {
    const p = z
      .object({
        active: z.boolean(),
        radius: z.number().min(0.1).max(100),
        fee: z.number().int().min(0).max(10000000),
      })
      .parse(req.body);
    run(
      'INSERT INTO area_settings VALUES(?,?,?,?) ON CONFLICT(location_id) DO UPDATE SET active=excluded.active,radius=excluded.radius,fee=excluded.fee',
      String(req.params.id),
      Number(p.active),
      p.radius,
      p.fee,
    );
    res.json({ ok: true });
  });
  app.get('/api/admin/tracking', requireRole('admin'), (_req, res) =>
    res.json(
      all(
        "SELECT u.id,u.name,u.phone,u.active,u.location_id,s.available,s.capacity,s.lat,s.lng,s.accuracy,s.updated_at,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status NOT IN ('delivered','cancelled')) load FROM users u LEFT JOIN rider_state s ON s.user_id=u.id WHERE u.role='rider'",
      ),
    ),
  );
  app.put('/api/admin/rider-controls/:id', requireRole('admin'), (req, res) => {
    const p = z
      .object({ available: z.boolean(), capacity: z.number().int().min(1).max(50) })
      .parse(req.body);
    const id = String(req.params.id);
    if (!one("SELECT id FROM users WHERE id=? AND role='rider'", id)) return res.sendStatus(404);
    run(
      'INSERT INTO rider_state(user_id,available,capacity) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET available=excluded.available,capacity=excluded.capacity',
      id,
      Number(p.available),
      p.capacity,
    );
    res.json({ ok: true });
  });
  app.get('/api/rider/state', requireRole('rider'), (req: AuthRequest, res) =>
    res.json(
      one('SELECT * FROM rider_state WHERE user_id=?', req.user!.id) || {
        available: 1,
        capacity: 5,
      },
    ),
  );
  app.patch('/api/rider/state', requireRole('rider'), (req: AuthRequest, res) => {
    const p = z.object({ available: z.boolean() }).parse(req.body);
    run(
      'INSERT INTO rider_state(user_id,available) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET available=excluded.available',
      req.user!.id,
      Number(p.available),
    );
    if (!p.available)
      run(
        'UPDATE rider_state SET lat=NULL,lng=NULL,accuracy=NULL,updated_at=NULL WHERE user_id=?',
        req.user!.id,
      );
    res.json({ ok: true });
  });
  app.post('/api/rider/location', requireRole('rider'), (req: AuthRequest, res) => {
    const p = z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100000),
      })
      .parse(req.body);
    if (
      !one(
        "SELECT id FROM orders WHERE rider_id=? AND status NOT IN ('delivered','cancelled')",
        req.user!.id,
      )
    )
      return res
        .status(409)
        .json({ error: 'Location is shared only while you have an active delivery.' });
    run(
      'INSERT INTO rider_state(user_id,lat,lng,accuracy,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,updated_at=excluded.updated_at',
      req.user!.id,
      p.lat,
      p.lng,
      p.accuracy,
      new Date().toISOString(),
    );
    res.json({ ok: true });
  });
}
