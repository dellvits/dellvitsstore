import { atomicRoute } from './atomic-route.js';
import { PostgresRateLimitStore } from './rate-limit-store.js';
import {
  installPlatform,
  areaSettings,
  areaColumns,
  areaFields,
  saveAreaSettings,
  deliveryFee,
  couponDiscount,
  paymentMethods,
  allPaymentMethods,
  productPaymentIds,
  records,
  isOnline,
  adDay,
  maintenanceGuard,
} from './platform.js';
import { installSupport, deleteSupport } from './support.js';
import { installNotifications, notify, adminsWith, outletUser } from './notifications.js';
import {
  installRiders,
  commissionSchema,
  riderDefaults,
  vehicleTypes,
  payoutMethods,
  saveRiderSettings,
  recordEarning,
} from './riders.js';
import {
  installPayments,
  paymentSnapshot,
  paymentSubmission,
  validateSubmission,
} from './payments.js';
import {
  installWorkflow,
  addEvent,
  createFlow,
  flow,
  markPaymentVerified,
  flowView,
  canCancel,
  cancelOrder,
  notifyCancelled,
} from './workflow.js';
import {
  installFinance,
  recordSettlement,
  outletSettings,
  outletDefaults,
  outletOwnSettings,
  saveOutletSettings,
  outletPublicColumns,
  outletOpen,
  withinHours,
} from './finance.js';
import express, { type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID, randomInt } from 'node:crypto';
import { objects } from './storage.js';
import { z } from 'zod';
import { range, between } from './range.js';
import {
  installAccounts,
  needsVerification,
  sendVerificationCode,
  startSession,
  verifyResponse,
} from './accounts.js';
import { mailReady } from './mail.js';
import { one, all, run, transaction, afterCommit, type Row } from './db.js';
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
// WEB_ORIGIN may list several comma-separated origins, e.g. the custom domain and its www/vercel.app aliases.
const origins = (process.env.WEB_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: origins, credentials: true }));
app.use(
  express.json({ limit: '100kb' }),
);
app.use(cookieParser());
app.use(session);
app.use('/api', (req, res, next) => {
  if (
    /^\/(session|auth|profile|orders|manage|admin|rider|notifications|payment-proofs)(\/|$)/.test(
      req.path,
    )
  )
    res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req: AuthRequest, res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin &&
    !origins.includes(req.headers.origin)
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
app.use('/api', maintenanceGuard);
installPlatform(app);
const authLimit = rateLimit({
  store: new PostgresRateLimitStore('auth:'),
  windowMs: 15 * 60000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});
const writeLimit = rateLimit({
  store: new PostgresRateLimitStore('write:'),
  windowMs: 60000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Please wait a moment before trying again.' },
});
// Ad views and clicks are counted from the storefront; this keeps one visitor from inflating them.
const trackLimit = rateLimit({
  store: new PostgresRateLimitStore('track:'),
  windowMs: 60000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Please wait a moment before trying again.' },
});
const upload = multer({
  storage: multer.memoryStorage(),
  // Leave room for multipart framing under Vercel Functions' request body limit.
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});
installNotifications(app);
installAccounts(app, authLimit);
installRiders(app);
installPayments(app, { upload: upload.single('file') });
installSupport(app, { upload: upload.single('file'), writeLimit });
installWorkflow(app);
installFinance(app);
const money = (paisa: number) => 'PKR ' + (paisa / 100).toLocaleString('en-PK');
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
    async (v) => !!(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', v)),
    'Choose a supported delivery area.',
  );
const uuid = z.string().max(100);
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function safeImage(v: string) {
  return /^\/(images|api\/media)\/[\w.-]+\.(webp|png|jpg|jpeg)$/.test(v);
}
async function product(p: Row): Promise<Row> {
  return {
    ...p,
    images: await JSON.parse(p.images),
    payment_methods: productPaymentIds(p),
    effective_price: Math.round((p.price * (100 - p.discount)) / 100),
  };
}
async function myOutlet(req: AuthRequest) {
  return await one('SELECT * FROM outlets WHERE user_id=?', req.user!.id);
}
async function allowedProduct(req: AuthRequest, p: Row) {
  if (req.user!.role === 'outlet' && (await myOutlet(req))?.id !== p.outlet_id)
    fail('This product belongs to another outlet.', 403);
}
async function orderVisible(req: AuthRequest, o: Row) {
  if (req.user?.role === 'admin') return true;
  // Outlets and riders see an order only once an administrator has sent it to them.
  if (req.user?.role === 'rider') return o.rider_id === req.user.id && !!(await flow(o.id)).sent_at;
  if (req.user?.role === 'outlet')
    return o.outlet_id === (await myOutlet(req))?.id && !!(await flow(o.id)).sent_at;
  return (
    (req.user && o.user_id === req.user.id) || (!o.user_id && o.guest_session === req.sessionHash)
  );
}
/** Serializes orders in five parallel queries, however many orders there are. */
async function serializeOrders(orders: Row[], req: AuthRequest) {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const marks = ids.map(() => '?').join(',');
  const [links, details, flows, items, events] = await Promise.all([
    all(
      `SELECT o.id,t.id outlet_found,t.name outlet_name,t.address outlet_address,t.lat outlet_lat,t.lng outlet_lng,t.phone outlet_phone,u.id rider_found,u.name rider_name,u.phone rider_phone,s.lat rider_lat,s.lng rider_lng,s.accuracy rider_accuracy,s.updated_at rider_updated_at FROM orders o LEFT JOIN outlets t ON t.id=o.outlet_id LEFT JOIN users u ON u.id=o.rider_id LEFT JOIN rider_state s ON s.user_id=o.rider_id WHERE o.id IN (${marks})`,
      ...ids,
    ),
    all(`SELECT * FROM order_details WHERE order_id IN (${marks})`, ...ids),
    all(`SELECT * FROM order_flow WHERE order_id IN (${marks})`, ...ids),
    all(`SELECT * FROM order_items WHERE order_id IN (${marks})`, ...ids),
    all(
      `SELECT order_id,status,created_at,note,actor FROM order_events WHERE order_id IN (${marks}) ORDER BY created_at,sort_order`,
      ...ids,
    ),
  ]);
  const byOrder = (rows: Row[], key = 'order_id') => new Map(rows.map((r) => [r[key], r]));
  const grouped = (rows: Row[]) => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const list = map.get(r.order_id);
      if (list) list.push(r);
      else map.set(r.order_id, [r]);
    }
    return map;
  };
  const link = byOrder(links, 'id'),
    detail = byOrder(details),
    flowOf = byOrder(flows),
    itemsOf = grouped(items),
    eventsOf = grouped(events);
  const role = req.user?.role || 'customer';
  const staff = role !== 'customer';
  return await Promise.all(
    orders.map(async (o) => {
      const { guest_session, otp, otp_attempts, otp_locked_until, idempotency_key, ...safe } = o;
      const own =
        (req.user?.role === 'customer' && o.user_id === req.user.id) ||
        (!o.user_id && o.guest_session === req.sessionHash);
      const l = link.get(o.id) || {};
      const d = detail.get(o.id);
      const privatePayment = own || req.user?.role === 'admin';
      const payment = d
        ? {
            discount: d.discount,
            coupon_code: d.coupon_code,
            payment_name: d.payment_name,
            payment_type: d.payment_type === 'manual' ? 'bank' : d.payment_type,
            payment_instructions: d.payment_instructions,
            payment_status: d.payment_status,
            payment_note: d.payment_note,
            payment_updated_at: d.payment_updated_at,
            payment_details: JSON.parse(d.payment_details || '{}'),
            ...(privatePayment
              ? {
                  transaction_id: d.transaction_id,
                  payer_name: d.payer_name,
                  payer_account: d.payer_account,
                  proof_url: d.proof_id ? '/api/payment-proofs/' + d.proof_id : null,
                }
              : {}),
          }
        : {};
      return {
        ...safe,
        ...payment,
        // Orders from before the workflow tables get their flow row on first read.
        ...flowView(flowOf.get(o.id) || (await flow(o.id)), o, role),
        outlet_id: o.outlet_id,
        rider_location:
          !['delivered', 'cancelled'].includes(o.status) && o.rider_id && l.rider_lat != null
            ? {
                lat: l.rider_lat,
                lng: l.rider_lng,
                accuracy: l.rider_accuracy,
                updated_at: l.rider_updated_at,
              }
            : null,
        ...(own ? { otp } : {}),
        outlet: l.outlet_found
          ? {
              name: l.outlet_name,
              address: l.outlet_address,
              lat: l.outlet_lat,
              lng: l.outlet_lng,
              phone: l.outlet_phone,
            }
          : undefined,
        rider: o.rider_id && l.rider_found ? { name: l.rider_name, phone: l.rider_phone } : null,
        items: itemsOf.get(o.id) || [],
        events: (eventsOf.get(o.id) || [])
          .filter(
            (e) =>
              staff ||
              ![
                'rider_rejected',
                'cancel_requested',
                'cancel_request_dismissed',
                'reminder',
              ].includes(e.status),
          )
          .map(({ order_id, ...e }) => e),
      };
    }),
  );
}
const serializeOrder = async (o: Row, req: AuthRequest) => (await serializeOrders([o], req))[0];
app.get('/api/health', async (_req, res) => {
  await one('SELECT key FROM settings LIMIT 1');
  res.json({ ok: true, service: 'dellvit-api' });
});
app.get('/api/locations', async (_req, res) =>
  res.json(
    await all(
      `SELECT l.*,${areaColumns} FROM locations l LEFT JOIN area_settings a ON a.location_id=l.id WHERE l.deleted_at IS NULL AND COALESCE(a.active,1)=1 ORDER BY l.name`,
    ),
  ),
);
app.get('/api/session', async (req: AuthRequest, res) => {
  if (!req.sessionHash) await newSession(req, res, null);
  res.json({ user: req.user ? await publicUser(req.user) : null });
});
app.post(
  '/api/auth/register',
  authLimit,
  atomicRoute(async (req: AuthRequest, res) => {
    const p = await z
      .object({
        name: str(100),
        email,
        phone,
        password: z.string().min(10).max(100),
        address: str(500),
        location_id: location,
      })
      .parseAsync(req.body);
    const existing = await one('SELECT * FROM users WHERE email=?', p.email);
    if (existing && existing.active && needsVerification(existing)) {
      // The sign-up was started but never finished: send the visitor on to the code page.
      const { retry_in } = await sendVerificationCode(existing);
      return res
        .status(409)
        .json(
          verifyResponse(
            existing,
            'This email is registered but not verified yet. Enter the code we emailed you.',
            retry_in,
          ),
        );
    }
    if (existing) fail('An account already uses this email.', 409);
    if ((await records('settings', true))[0]?.signup_enabled === false)
      fail('New accounts cannot be created right now. Please try again later.', 403);
    if (!(await mailReady()))
      fail('Sign-up is unavailable because email is not set up yet. Please contact support.', 503);
    const uid = id();
    await run(
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
    // No session yet: the account opens once the emailed code is entered.
    const { retry_in } = await sendVerificationCode({ id: uid, name: p.name, email: p.email });
    res.status(201).json({ verify: true, email: p.email, retry_in });
  }),
);
app.post(
  ['/api/auth/login', '/api/auth/admin-login'],
  authLimit,
  atomicRoute(async (req: AuthRequest, res) => {
    const p = await z.object({ login: str(), password: z.string().max(100) }).parseAsync(req.body);
    const u = await one(
      'SELECT * FROM users WHERE email=? OR login_id=?',
      p.login.toLowerCase(),
      p.login,
    );
    if (!u || !verifyPassword(p.password, u.password_hash) || !u.active)
      fail('Email / ID or password is incorrect.', 401);
    if (req.path.endsWith('/admin-login') !== (u.role === 'admin'))
      fail('Use the separate sign-in page for your account type.', 403);
    if (needsVerification(u)) {
      // Answered without throwing so the fresh code is saved and emailed.
      const { retry_in } = await sendVerificationCode(u);
      return res
        .status(403)
        .json(
          verifyResponse(
            u,
            'Verify your email to finish creating your account. We sent you a 6-digit code.',
            retry_in,
          ),
        );
    }
    res.json(await startSession(req, res, u));
  }),
);
app.post(
  '/api/auth/logout',
  atomicRoute(async (req: AuthRequest, res) => {
    if (req.sessionHash) await run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
    res.clearCookie('dellvit_session', { path: '/' }).json({ ok: true });
  }),
);
app.patch(
  '/api/profile',
  requireRole('customer', 'outlet', 'rider', 'admin'),
  atomicRoute(async (req: AuthRequest, res) => {
    // Customers deliver to their address; staff accounts may leave it and the area empty.
    const customer = req.user!.role === 'customer';
    const p = await z
      .object({
        name: str(100),
        phone: customer ? phone : z.union([phone, z.literal('')]).default(''),
        address: customer ? str(500) : z.string().trim().max(500).default(''),
        location_id: customer ? location : z.union([location, z.literal('')]).nullable().optional(),
      })
      .parseAsync(req.body);
    await run(
      'UPDATE users SET name=?,phone=?,address=?,location_id=? WHERE id=?',
      p.name,
      p.phone,
      p.address,
      p.location_id === undefined ? req.user!.location_id : p.location_id || null,
      req.user!.id,
    );
    res.json(await publicUser((await one('SELECT * FROM users WHERE id=?', req.user!.id))!));
  }),
);
app.post(
  '/api/auth/password',
  requireRole('customer', 'admin', 'outlet', 'rider'),
  authLimit,
  atomicRoute(async (req: AuthRequest, res) => {
    const p = await z
      .object({ current: z.string().max(100), password: z.string().min(10).max(100) })
      .parseAsync(req.body);
    if (!verifyPassword(p.current, req.user!.password_hash))
      fail('Current password is incorrect.', 400);
    await run(
      'UPDATE users SET password_hash=? WHERE id=?',
      hashPassword(p.password),
      req.user!.id,
    );
    await run(
      'DELETE FROM sessions WHERE user_id=? AND token_hash<>?',
      req.user!.id,
      req.sessionHash,
    );
    res.json({ ok: true });
  }),
);
app.get('/api/products', async (req, res) => {
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
    sql += ' AND (p.name ILIKE ? OR p.description ILIKE ? OR o.name ILIKE ?)';
    const s = '%' + String(q).slice(0, 100) + '%';
    args.push(s, s, s);
  }
  res.json(await Promise.all((await all(sql, ...args)).map(product)));
});
app.get('/api/products/:id', async (req, res) => {
  const p = await one(
    'SELECT p.*,o.name outlet_name,o.address pickup_address FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.id=? AND p.active=1 AND o.active=1',
    String(req.params.id),
  );
  if (!p) fail('Product not found.', 404);
  res.json(await product(p));
});
/** Active outlets as the storefront shows them; `open` says whether they take orders right now. */
const publicOutlets = `SELECT o.id,o.name,o.location_id,o.address,o.phone,o.image,o.category,o.active,${outletPublicColumns} FROM outlets o LEFT JOIN outlet_settings s ON s.outlet_id=o.id WHERE o.active=1`;
const withOpen = (o: Row) => ({ ...o, open: outletOpen(o) });
app.get('/api/outlets', async (req, res) =>
  res.json(
    (req.query.location
      ? await all(
          publicOutlets + ' AND o.location_id=? ORDER BY featured DESC,o.name',
          String(req.query.location),
        )
      : await all(publicOutlets + ' ORDER BY featured DESC,o.name')
    ).map(withOpen),
  ),
);
app.get('/api/outlets/:id', async (req, res) => {
  const o = await one(publicOutlets + ' AND o.id=?', String(req.params.id));
  if (!o) fail('Outlet not found.', 404);
  res.json(withOpen(o));
});
/** Counts ads a visitor has seen, and one they clicked. Unknown ads are ignored. */
app.post('/api/ads/track', trackLimit, async (req, res) => {
  const p = z
    .object({
      views: z.array(z.string().min(1).max(100)).max(20).default([]),
      click: z.string().min(1).max(100).optional(),
    })
    .parse(req.body);
  const views = [...new Set(p.views)];
  const ids = [...new Set([...views, ...(p.click ? [p.click] : [])])];
  const marks = (list: string[]) => list.map(() => '?').join(',');
  if (ids.length)
    await run(
      `INSERT INTO ad_stats AS s(ad_id,day,views,clicks)
       SELECT id,CAST(? AS TEXT),CASE WHEN ${views.length ? `id IN (${marks(views)})` : '1=0'} THEN 1 ELSE 0 END,CASE WHEN id=? THEN 1 ELSE 0 END
       FROM platform_records WHERE kind='ads' AND id IN (${marks(ids)})
       ON CONFLICT(ad_id,day) DO UPDATE SET views=s.views+excluded.views,clicks=s.clicks+excluded.clicks`,
      adDay(),
      ...views,
      p.click || '',
      ...ids,
    );
  res.json({ ok: true });
});
app.post(
  '/api/contact',
  writeLimit,
  atomicRoute(async (req, res) => {
    const p = await z.object({ name: str(100), email, message: str(3000) }).parseAsync(req.body);
    if ((await records('settings', true))[0]?.contact_form_enabled === false)
      fail('The contact form is closed right now. Please call or email us instead.', 403);
    await run('INSERT INTO messages VALUES(?,?,?,?,?)', id(), p.name, p.email, p.message, now());
    await notify(await adminsWith('messages'), {
      type: 'message',
      title: 'New contact message',
      body: `${p.name}: ${p.message.slice(0, 120)}`,
      link: '/admin?tab=messages',
    });
    res.status(201).json({ ok: true });
  }),
);
/** Homepage feed for one delivery area: nearby picks, home categories and outlets. */
app.get('/api/home', async (req, res) => {
  const loc = String(req.query.location || '');
  if (!loc || !(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', loc)))
    return res.json({ nearby: [], categories: [], outlets: [] });
  const base =
    'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.active=1 AND o.active=1 AND p.location_id=?';
  res.json({
    nearby: await Promise.all(
      (
        await all(base + ' ORDER BY p.stock>0 DESC,p.discount DESC,p.sort_order DESC LIMIT 8', loc)
      ).map(product),
    ),
    categories: (
      await Promise.all(
        (await records('categories', true))
          .filter((c) => c.show_on_home !== false)
          .map(async (c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            image: c.image,
            products: await Promise.all(
              (
                await all(
                  base +
                    ' AND p.category=? ORDER BY p.stock>0 DESC,p.sort_order DESC LIMIT ' +
                    Math.min(24, Math.max(1, Math.round(Number(c.home_limit)) || 8)),
                  loc,
                  c.name,
                )
              ).map(product),
            ),
          })),
      )
    ).filter((c) => c.products.length),
    outlets: (
      await all(
        `SELECT o.id,o.name,o.location_id,o.address,o.phone,o.image,o.category,${outletPublicColumns},(SELECT COUNT(*) FROM products p WHERE p.outlet_id=o.id AND p.active=1) products,(SELECT MIN(delivery_minutes) FROM products p WHERE p.outlet_id=o.id AND p.active=1) delivery_minutes FROM outlets o LEFT JOIN outlet_settings s ON s.outlet_id=o.id WHERE o.active=1 AND o.location_id=? ORDER BY featured DESC,products DESC`,
        loc,
      )
    ).map(withOpen),
  });
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
  payment_method: str(100).default('cod'),
  payment: paymentSubmission.optional(),
  coupon_code: z.string().max(30).default(''),
  idempotency_key: z.string().uuid(),
});
app.post('/api/orders', writeLimit, async (req: AuthRequest, res) => {
  if (!req.user) fail('Please log in or create an account to place an order.', 401);
  if (req.user.role !== 'customer') fail('Use a customer account to place an order.', 403);
  const p = await cart.parseAsync(req.body);
  let created = false;
  const result = await transaction(async () => {
    const prior = await one('SELECT * FROM orders WHERE idempotency_key=?', p.idempotency_key);
    if (prior) {
      if (!(await orderVisible(req, prior))) fail('Checkout key already used.', 409);
      return prior;
    }
    const ids = new Set(p.items.map((i) => i.product_id));
    if (ids.size !== p.items.length) fail('Duplicate cart items are not allowed.');
    const lines: Row[] = await Promise.all(
      p.items.map(async (item): Promise<Row> => {
        const x = await one(
          'SELECT p.*,o.active outlet_active FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.id=?',
          item.product_id,
        );
        if (!x || !x.active || !x.outlet_active) fail('An item is no longer available.');
        if (x.location_id !== p.delivery.location_id)
          fail('Every item must be available in your delivery area.');
        if (x.stock < item.quantity) fail(`${x.name} has only ${x.stock} available.`, 409);
        if (item.quantity > x.max_per_order)
          fail(`You can order up to ${x.max_per_order} of ${x.name} at a time.`);
        return { ...(await product(x)), quantity: item.quantity };
      }),
    );
    if (new Set(lines.map((x) => x.outlet_id)).size !== 1)
      fail('Please order from one outlet at a time.');
    const shop = await outletSettings(lines[0].outlet_id);
    if (!shop.accepting)
      fail('This outlet is not accepting orders right now. Please try again later.');
    if (!withinHours(shop))
      fail(`This outlet takes orders from ${shop.opens_at} to ${shop.closes_at}. Please order then.`);
    const center = (await one('SELECT * FROM locations WHERE id=?', p.delivery.location_id))!;
    const km = Math.hypot((p.delivery.lat - center.lat) * 111, (p.delivery.lng - center.lng) * 92);
    const area = await areaSettings(center.id);
    if (!area.active) fail('Delivery is paused in this area.');
    if (!withinHours(area))
      fail(`Delivery in this area runs from ${area.opens_at} to ${area.closes_at}. Please order then.`);
    if (km > area.radius) fail(`Delivery pin must be within ${area.radius} km of the area centre.`);
    const payment = (await paymentMethods()).find((m) => m.id === p.payment_method);
    if (!payment) fail('Choose an enabled payment method.');
    if (lines.some((x) => !x.payment_methods.includes(payment.id)))
      fail(
        lines.length > 1
          ? `${payment.name} is not accepted for every item in your cart.`
          : `${payment.name} is not accepted for this item.`,
      );
    await validateSubmission(payment, p.payment, req.user!.id);
    const outlet = lines[0].outlet_id;
    const subtotal = lines.reduce((s, x) => s + x.effective_price * x.quantity, 0);
    const siteSettings = (await records('settings', true))[0];
    if (siteSettings?.checkout_enabled === false)
      fail(siteSettings.checkout_message || 'Ordering is temporarily paused. Please try again later.');
    if (siteSettings && subtotal < siteSettings.minimum_order)
      fail(`The minimum order subtotal is PKR ${(siteSettings.minimum_order / 100).toFixed(2)}.`);
    if (subtotal < shop.minimum_order)
      fail(`The minimum order for this outlet is PKR ${(shop.minimum_order / 100).toFixed(2)}.`);
    if (subtotal < area.minimum_order)
      fail(`The minimum order in this area is PKR ${(area.minimum_order / 100).toFixed(2)}.`);
    const fee = deliveryFee(area, subtotal);
    const { discount, coupon } = await couponDiscount(p.coupon_code, subtotal, {
      userId: req.user!.id,
      locationId: center.id,
      fee,
    });
    const oid = id();
    const ref = 'DLV-' + Date.now().toString(36).toUpperCase() + '-' + randomInt(100, 1000);
    const otp = String(randomInt(100000, 1000000));
    const due = new Date(
      Date.now() + Math.max(...lines.map((x) => x.delivery_minutes)) * 60000,
    ).toISOString();
    await run(
      'INSERT INTO orders(id,reference,user_id,guest_session,outlet_id,rider_id,name,email,phone,address,location_id,lat,lng,notes,payment_method,subtotal,delivery_fee,total,status,otp,created_at,deliver_by,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      oid,
      ref,
      req.user!.id,
      null,
      outlet,
      // Riders are assigned by an administrator when the order is sent for confirmation.
      null,
      p.delivery.name,
      p.delivery.email,
      p.delivery.phone,
      p.delivery.address,
      p.delivery.location_id,
      p.delivery.lat,
      p.delivery.lng,
      p.delivery.notes,
      p.payment_method,
      subtotal,
      fee,
      subtotal + fee - discount,
      'placed',
      otp,
      now(),
      due,
      p.idempotency_key,
    );
    const online = isOnline(payment.type);
    await run(
      'INSERT INTO order_details(order_id,discount,coupon_code,payment_name,payment_type,payment_instructions,payment_status,transaction_id,payer_name,payer_account,proof_id,payment_details,payment_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      oid,
      discount,
      coupon?.code || '',
      payment.name,
      payment.type,
      payment.instructions || '',
      online ? 'submitted' : 'due',
      online ? p.payment!.transaction_id : '',
      online ? p.payment!.payer_name : '',
      online ? p.payment!.payer_account : '',
      online ? p.payment!.proof_id || null : null,
      JSON.stringify(paymentSnapshot(payment)),
      online ? now() : null,
    );
    created = true;
    if (coupon) await run('INSERT INTO coupon_uses VALUES(?,?)', oid, coupon.id);
    for (const x of lines) {
      await run('UPDATE products SET stock=stock-? WHERE id=?', x.quantity, x.id);
      await run(
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
    await createFlow(oid);
    await addEvent(oid, 'placed', '', 'customer');
    // Cash on delivery needs no upfront check; online payments are verified separately.
    if (!online) await markPaymentVerified(oid);
    return (await one('SELECT * FROM orders WHERE id=?', oid))!;
  });
  if (created) {
    const o = result;
    const d = (await one(
      'SELECT payment_type,payment_name,payment_status FROM order_details WHERE order_id=?',
      o.id,
    ))!;
    const amount = money(o.total);
    const pendingNote = isOnline(d.payment_type) ? ' · payment under review' : '';
    await notify([o.user_id], {
      type: 'order',
      title: 'Order placed',
      body: `${o.reference} · ${amount}${pendingNote}`,
      link: '/orders/' + o.id,
    });
    const verified = !!(await flow(o.id)).payment_verified_at;
    await notify(await adminsWith('orders'), {
      type: 'order',
      title: 'New order',
      body: `${o.reference} from ${o.name} · ${amount} · ${verified ? 'assign a rider and send it' : 'awaiting payment verification'}`,
      link: '/admin?tab=orders',
    });
    if (isOnline(d.payment_type))
      await notify(await adminsWith('payments'), {
        type: 'payment',
        title: 'Payment to verify',
        body: `${o.reference} · ${d.payment_name} · ${amount}`,
        link: '/admin?tab=payments',
      });
  }
  res.status(201).json(await serializeOrder(result, req));
});
app.get('/api/orders', async (req: AuthRequest, res) => {
  let rows: Row[] = [];
  if (req.user?.role === 'admin') rows = await all('SELECT * FROM orders ORDER BY created_at DESC');
  else if (req.user?.role === 'outlet')
    rows = await all(
      'SELECT o.* FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.outlet_id=? AND f.sent_at IS NOT NULL ORDER BY o.created_at DESC',
      (await myOutlet(req))?.id || '',
    );
  else if (req.user?.role === 'rider')
    rows = await all(
      'SELECT o.* FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.rider_id=? AND f.sent_at IS NOT NULL ORDER BY o.created_at DESC',
      req.user.id,
    );
  else if (req.user)
    rows = await all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC', req.user.id);
  else if (req.sessionHash)
    rows = await all(
      'SELECT * FROM orders WHERE guest_session=? ORDER BY created_at DESC',
      req.sessionHash,
    );
  res.json(await serializeOrders(rows, req));
});
app.get('/api/orders/:id', async (req: AuthRequest, res) => {
  const o = await one('SELECT * FROM orders WHERE id=?', String(req.params.id));
  if (!o || !(await orderVisible(req, o))) fail('Order not found.', 404);
  res.json(await serializeOrder(o, req));
});
app.patch(
  '/api/orders/:id/status',
  requireRole('admin', 'outlet', 'rider', 'customer'),
  atomicRoute(async (req: AuthRequest, res) => {
    const { status, reason } = await z
      .object({
        status: z.enum(['confirmed', 'preparing', 'ready', 'picked_up', 'cancelled']),
        reason: z.string().trim().max(300).default(''),
      })
      .parseAsync(req.body);
    const o = await one('SELECT * FROM orders WHERE id=?', String(req.params.id));
    if (!o || !(await orderVisible(req, o))) fail('Order not found.', 404);
    const role = req.user!.role;
    if (o.status === 'delivered') fail('A completed order cannot be modified.');
    if (status === 'cancelled') {
      if (o.status === 'cancelled') fail('This order is already cancelled.');
      if (!canCancel(o.status, role))
        fail(
          role === 'outlet' && o.status === 'preparing'
            ? 'Send a cancellation request to Dellvit instead.'
            : 'This order can no longer be cancelled.',
          ['admin', 'customer'].includes(role) ? 400 : 403,
        );
      if (role === 'admin' && !reason) fail('Enter a reason for the cancellation.');
      const why = reason || (role === 'customer' ? 'Cancelled at the customer’s request.' : '');
      await transaction(async () => await cancelOrder(o, role, why));
      await notifyCancelled(o, role, why);
      return res.json(
        await serializeOrder((await one('SELECT * FROM orders WHERE id=?', o.id))!, req),
      );
    }
    // Every step has exactly one owner: the outlet prepares, the rider picks up.
    const steps: Record<string, { from: string; role: string }> = {
      preparing: { from: 'confirmed', role: 'outlet' },
      ready: { from: 'preparing', role: 'outlet' },
      picked_up: { from: 'ready', role: 'rider' },
    };
    if (status === 'confirmed')
      fail('Orders are confirmed automatically once the outlet and rider accept them.');
    const step = steps[status];
    if (role !== step.role)
      fail(
        step.role === 'outlet'
          ? 'Only the outlet can update preparation.'
          : 'Only the assigned rider can confirm pickup.',
        403,
      );
    if (o.status !== step.from) fail('Invalid order status transition.');
    if (status === 'picked_up' && (await flow(o.id)).rider_status !== 'accepted')
      fail('Accept the delivery before confirming pickup.');
    await transaction(async () => {
      await run('UPDATE orders SET status=? WHERE id=?', status, o.id);
      if (status === 'ready')
        await run(
          "UPDATE order_flow SET cancel_request='',cancel_request_at=NULL WHERE order_id=?",
          o.id,
        );
      await addEvent(o.id, status, '', role);
    });
    const messages: Record<string, [string, string]> = {
      preparing: ['Being prepared', 'Your order is being prepared.'],
      ready: ['Ready for pickup', 'Your order is packed and waiting for the rider.'],
      picked_up: ['On the way', 'Your rider has picked up your order.'],
    };
    await notify([o.user_id], {
      type: 'order',
      title: messages[status][0],
      body: `${o.reference} · ${messages[status][1]}`,
      link: '/orders/' + o.id,
    });
    if (status === 'ready' && o.rider_id)
      await notify([o.rider_id], {
        type: 'delivery',
        title: 'Order ready for pickup',
        body: `${o.reference} is ready at the outlet.`,
        link: '/portal/rider',
      });
    if (status === 'picked_up')
      await notify([await outletUser(o.outlet_id)], {
        type: 'order',
        title: 'Order picked up',
        body: `${o.reference} was collected by ${req.user!.name}.`,
        link: '/portal/outlet?tab=orders',
      });
    res.json(await serializeOrder((await one('SELECT * FROM orders WHERE id=?', o.id))!, req));
  }),
);
app.post(
  '/api/orders/:id/verify',
  requireRole('rider'),
  authLimit,
  atomicRoute(async (req: AuthRequest, res) => {
    const { otp } = await z
      .object({ otp: z.string().regex(/^\d{6}$/), cash_received: z.literal(true) })
      .parseAsync(req.body);
    const o = await one(
      'SELECT * FROM orders WHERE id=? AND rider_id=?',
      String(req.params.id),
      req.user!.id,
    );
    if (!o) fail('Order not found.', 404);
    const payment = await one('SELECT * FROM order_details WHERE order_id=?', o.id);
    if (isOnline(payment?.payment_type) && payment!.payment_status !== 'paid')
      fail('An administrator must confirm the online payment before delivery.');
    if (o.status !== 'picked_up') fail('Pick up the order before verifying delivery.');
    if (o.otp_locked_until && o.otp_locked_until > now())
      fail('Too many incorrect codes. Try again in 15 minutes.', 429);
    if (o.otp !== otp) {
      const attempts = (o.otp_locked_until ? 0 : o.otp_attempts) + 1;
      await run(
        'UPDATE orders SET otp_attempts=?,otp_locked_until=? WHERE id=?',
        attempts,
        attempts >= 5 ? new Date(Date.now() + 900000).toISOString() : null,
        o.id,
      );
      return res.status(400).json({ error: 'The delivery code is incorrect.' });
    }
    await transaction(async () => {
      await run("UPDATE orders SET status='delivered',delivered_at=? WHERE id=?", now(), o.id);
      await run("UPDATE order_details SET payment_status='paid' WHERE order_id=?", o.id);
      await addEvent(o.id, 'delivered', '', 'rider');
      await recordEarning(o, isOnline(payment?.payment_type) ? 0 : o.total);
      await recordSettlement((await one('SELECT * FROM orders WHERE id=?', o.id))!);
    });
    await notify([o.user_id], {
      type: 'order',
      title: 'Delivered',
      body: `${o.reference} has been delivered. Enjoy!`,
      link: '/orders/' + o.id,
    });
    await notify([await outletUser(o.outlet_id)], {
      type: 'order',
      title: 'Order delivered',
      body: `${o.reference} reached the customer.`,
      link: '/portal/outlet',
    });
    const earned = await one('SELECT amount FROM rider_earnings WHERE order_id=?', o.id);
    if (earned)
      await notify([o.rider_id], {
        type: 'earning',
        title: 'Commission earned',
        body: `${money(earned.amount)} for ${o.reference}.`,
        link: '/portal/rider?tab=earnings',
      });
    res.json({ ok: true });
  }),
);
app.get('/api/manage/product-outlets', requireRole('admin'), async (_req, res) =>
  res.json(await all('SELECT id,name,location_id FROM outlets WHERE active=1')),
);
app.get('/api/manage/products', requireRole('admin', 'outlet'), async (req: AuthRequest, res) =>
  res.json(
    await Promise.all(
      (req.user!.role === 'admin'
        ? await all(
            'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.deleted_at IS NULL',
          )
        : await all(
            'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.outlet_id=? AND p.deleted_at IS NULL',
            (await myOutlet(req))?.id || '',
          )
      ).map(product),
    ),
  ),
);
const productSchema = z.object({
  name: str(150),
  description: str(2000),
  category: str(100).refine(
    async (v) => (await records('categories', true)).some((c) => c.name === v),
    'Choose an active category.',
  ),
  price: z.number().int().min(100).max(100000000),
  stock: z.number().int().min(0).max(100000),
  max_per_order: z.number().int().min(1).max(99).default(99),
  unit: str(100),
  location_id: location,
  sku: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\w.\/-]*$/, 'SKUs use letters, numbers, dashes, dots and slashes.')
    .default(''),
  discount: z.number().int().min(0).max(90),
  deal: z.string().trim().max(150).default(''),
  images: z.array(z.string().refine(safeImage, 'Upload a product image.')).min(1).max(6),
  includes: z.string().trim().max(1000).default(''),
  excludes: z.string().trim().max(1000).default(''),
  delivery_minutes: z.number().int().min(10).max(240),
  payment_methods: z.array(z.string().max(100)).max(50).default([]),
  outlet_id: uuid,
  active: z.number().int().min(0).max(1).default(1),
});
/** Columns written by the product form, in the order saveProduct passes their values. */
const productColumns = [
  'outlet_id',
  'name',
  'description',
  'category',
  'price',
  'stock',
  'max_per_order',
  'unit',
  'sku',
  'location_id',
  'discount',
  'deal',
  'images',
  'includes',
  'excludes',
  'delivery_minutes',
  'payment_methods',
  'active',
];
async function saveProduct(req: AuthRequest, res: Response, editing: boolean) {
  const p = await productSchema.parseAsync(req.body);
  const pid = editing ? String(req.params.id) : id();
  if (editing) {
    const old = await one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL', pid);
    if (!old) fail('Product not found.', 404);
    await allowedProduct(req, old);
  }
  await allowedProduct(req, p);
  if (!(await one('SELECT id FROM outlets WHERE id=? AND deleted_at IS NULL', p.outlet_id)))
    fail('Outlet not found.');
  if (
    p.sku &&
    (await one(
      'SELECT id FROM products WHERE outlet_id=? AND sku=? AND id<>?',
      p.outlet_id,
      p.sku,
      pid,
    ))
  )
    fail('Another product from this outlet already uses this SKU.', 409);
  // Methods deleted while the form was open are dropped rather than rejected.
  const known = new Set((await records('payments')).map((m) => m.id));
  const methods = [...new Set(p.payment_methods)].filter((m) => known.has(m));
  if (!methods.length) fail('Choose at least one payment method for this product.');
  const values = [
    p.outlet_id,
    p.name,
    p.description,
    p.category,
    p.price,
    p.stock,
    p.max_per_order,
    p.unit,
    p.sku,
    p.location_id,
    p.discount,
    p.deal,
    JSON.stringify(p.images),
    p.includes,
    p.excludes,
    p.delivery_minutes,
    JSON.stringify(methods),
    p.active,
  ];
  if (editing)
    await run(
      `UPDATE products SET ${productColumns.map((c) => c + '=?').join(',')} WHERE id=?`,
      ...values,
      pid,
    );
  else
    await run(
      `INSERT INTO products(id,${productColumns.join(',')}) VALUES(?,${productColumns.map(() => '?').join(',')})`,
      pid,
      ...values,
    );
  res.json(await product((await one('SELECT * FROM products WHERE id=?', pid))!));
}
/** Payment methods a product form can offer: enabled and disabled, without account details. */
app.get('/api/manage/payment-methods', requireRole('admin', 'outlet'), async (_req, res) =>
  res.json(
    (await allPaymentMethods()).map(({ id, name, type, provider, bank_name, logo, active }) => ({
      id,
      name,
      type: type === 'manual' ? 'bank' : type,
      provider,
      bank_name,
      logo,
      active: !!active,
    })),
  ),
);
app.post(
  '/api/manage/products',
  requireRole('admin', 'outlet'),
  atomicRoute(async (req: AuthRequest, res) => await saveProduct(req, res, false)),
);
app.put(
  '/api/manage/products/:id',
  requireRole('admin', 'outlet'),
  atomicRoute(async (req: AuthRequest, res) => await saveProduct(req, res, true)),
);
app.delete(
  '/api/manage/products/:id',
  requireRole('admin', 'outlet'),
  atomicRoute(async (req: AuthRequest, res) => {
    const p = await one(
      'SELECT * FROM products WHERE id=? AND deleted_at IS NULL',
      String(req.params.id),
    );
    if (!p) fail('Product not found.', 404);
    await allowedProduct(req, p);
    await run('UPDATE products SET active=0 WHERE id=?', p.id);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/manage/images',
  requireRole('admin', 'outlet'),
  writeLimit,
  upload.single('file'),
  atomicRoute(async (req, res) => {
    if (!req.file) fail('Choose an image.');
    const f = id() + '.webp';
    let image: Buffer;
    try {
      image = await sharp(req.file.buffer, { limitInputPixels: 24000000 })
        .rotate()
        .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      fail('Upload a valid PNG, JPEG or WebP image.');
    }
    await objects.put('images/' + f, image!, 'image/webp');
    res.status(201).json({ url: '/api/media/' + f });
  }),
);
app.get('/api/media/:name', async (req, res) => {
  const name = String(req.params.name);
  if (!/^[\da-f-]+\.webp$/.test(name)) fail('File not found.', 404);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  const image = await objects.get('images/' + name);
  if (!image) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.type('image/webp').send(image.body);
});
app.get('/api/manage/outlet', requireRole('outlet'), async (req: AuthRequest, res) => {
  const o = await myOutlet(req);
  res.json(o ? { ...o, ...(await outletOwnSettings(o.id)) } : null);
});
app.use('/api/admin', requireRole('admin'));
// An area is saved in one request: its name and centre, plus any settings sent with them.
const locationSchema = z.object({
  name: str(150),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ...areaFields,
});
app.post(
  '/api/admin/locations',
  atomicRoute(async (req, res) => {
    const { name, lat, lng, ...settings } = await locationSchema.parseAsync(req.body);
    const lid = id();
    await run('INSERT INTO locations VALUES(?,?,?,?)', lid, name, lat, lng);
    await saveAreaSettings(lid, settings);
    res.status(201).json({ id: lid, name, lat, lng, ...(await areaSettings(lid)) });
  }),
);
app.put(
  '/api/admin/locations/:id',
  atomicRoute(async (req, res) => {
    const { name, lat, lng, ...settings } = await locationSchema.parseAsync(req.body);
    const lid = String(req.params.id);
    if (!(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', lid))) fail('Delivery area not found.', 404);
    await run('UPDATE locations SET name=?,lat=?,lng=? WHERE id=?', name, lat, lng, lid);
    await saveAreaSettings(lid, settings);
    res.json({ id: lid, name, lat, lng, ...(await areaSettings(lid)) });
  }),
);
/**
 * Deleting an area never loses an order. An area with an order in progress, or with outlets or
 * products that are not deleted, cannot go. Accounts in it are left without an area. With no
 * history the area is removed outright; with past orders or deleted outlets and products it is
 * closed and hidden for good.
 */
app.delete(
  '/api/admin/locations/:id',
  atomicRoute(async (req, res) => {
    const lid = String(req.params.id);
    if (!(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', lid))) fail('Delivery area not found.', 404);
    const used = (await one(
      "SELECT (SELECT COUNT(*) FROM orders WHERE location_id=? AND status NOT IN ('delivered','cancelled')) active,(SELECT COUNT(*) FROM outlets WHERE location_id=? AND deleted_at IS NULL) outlets,(SELECT COUNT(*) FROM products WHERE location_id=? AND deleted_at IS NULL) products,(SELECT COUNT(*) FROM orders WHERE location_id=?)+(SELECT COUNT(*) FROM outlets WHERE location_id=?)+(SELECT COUNT(*) FROM products WHERE location_id=?) history",
      ...Array.from({ length: 6 }, () => lid),
    ))!;
    const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const active = Number(used.active);
    if (active)
      fail(
        `This area has ${count(active, 'order')} in progress. Finish or cancel ${active === 1 ? 'it' : 'them'} first.`,
        409,
      );
    const reasons = [
      Number(used.outlets) && count(Number(used.outlets), 'outlet'),
      Number(used.products) && count(Number(used.products), 'product'),
    ].filter(Boolean);
    if (reasons.length)
      fail(
        `This area still has ${reasons.join(' and ')}. Move them to another area or delete them first.`,
        409,
      );
    await run('UPDATE users SET location_id=NULL WHERE location_id=?', lid);
    const kept = Number(used.history) > 0;
    if (kept) {
      await saveAreaSettings(lid, { active: false });
      await run('UPDATE locations SET deleted_at=? WHERE id=?', now(), lid);
    } else {
      await run('DELETE FROM area_settings WHERE location_id=?', lid);
      await run('DELETE FROM locations WHERE id=?', lid);
    }
    res.json({ ok: true, kept });
  }),
);
app.get('/api/admin/outlets', async (_req, res) => {
  // Two queries however many outlets there are.
  const settings = new Map(
    (await all('SELECT * FROM outlet_settings')).map((s) => [s.outlet_id, s]),
  );
  res.json(
    (
      await all(
        'SELECT o.*,(SELECT COUNT(*) FROM products p WHERE p.outlet_id=o.id AND p.active=1) products,(SELECT COUNT(*) FROM orders x WHERE x.outlet_id=o.id) orders,(SELECT COALESCE(SUM(subtotal),0) FROM order_settlements t WHERE t.outlet_id=o.id) sales,(SELECT COALESCE(SUM(outlet_payable),0) FROM order_settlements t WHERE t.outlet_id=o.id) payable FROM outlets o WHERE o.deleted_at IS NULL ORDER BY o.name',
      )
    ).map((o) => {
      const s = { ...outletDefaults, ...settings.get(o.id) };
      return { ...o, ...s, open: outletOpen(s) };
    }),
  );
});
const flag = z.number().int().min(0).max(1);
/** A time of day as HH:MM, or empty for none. */
const hour = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]);
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
  category: str(100).refine(
    async (v) => (await records('categories', true)).some((c) => c.name === v),
    'Choose an active category.',
  ),
  active: z.number().int().min(0).max(1).default(1),
  commission_rate: z.number().min(0).max(100).optional(),
  accepting: flag.optional(),
  featured: flag.optional(),
  description: z.string().trim().max(500).optional(),
  minimum_order: z.number().int().min(0).max(10000000).optional(),
  opens_at: hour.optional(),
  closes_at: hour.optional(),
  owner_name: z.string().trim().max(100).optional(),
  payout_bank: z.string().trim().max(100).optional(),
  payout_title: z.string().trim().max(100).optional(),
  payout_account: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
});
async function saveOutlet(req: AuthRequest, res: Response, edit: boolean) {
  const p = await outletSchema.parseAsync(req.body);
  const oid = edit ? String(req.params.id) : id();
  const old = edit
    ? await one('SELECT * FROM outlets WHERE id=? AND deleted_at IS NULL', oid)
    : null;
  if (edit && !old) fail('Outlet not found.', 404);
  if (!edit && !p.password) fail('Set a password for the outlet account.');
  const before = await outletSettings(oid);
  const opens = p.opens_at ?? before.opens_at,
    closes = p.closes_at ?? before.closes_at;
  if (!opens !== !closes) fail('Set both an opening and a closing time, or leave both empty.');
  if (opens && opens === closes) fail('Opening and closing times must differ.');
  // A new outlet starts on its category's commission unless one is given.
  const categoryRate = edit
    ? undefined
    : (await records('categories')).find((c) => c.name === p.category)?.commission_rate;
  const uid = old?.user_id || id();
  await transaction(async () => {
    if (edit) {
      await run(
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
        await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(p.password), uid);
      await run(
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
      await run(
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
      await run(
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
    await saveOutletSettings(oid, {
      commission_rate: p.commission_rate ?? categoryRate ?? undefined,
      accepting: p.accepting,
      featured: p.featured,
      description: p.description,
      minimum_order: p.minimum_order,
      opens_at: p.opens_at,
      closes_at: p.closes_at,
      owner_name: p.owner_name,
      payout_bank: p.payout_bank,
      payout_title: p.payout_title,
      payout_account: p.payout_account,
      notes: p.notes,
    });
  });
  res.json({
    ...(await one('SELECT * FROM outlets WHERE id=?', oid)),
    ...(await outletSettings(oid)),
  });
}
app.post(
  '/api/admin/outlets',
  atomicRoute(async (req: AuthRequest, res) => await saveOutlet(req, res, false)),
);
app.put(
  '/api/admin/outlets/:id',
  atomicRoute(async (req: AuthRequest, res) => await saveOutlet(req, res, true)),
);
/** The switches in the outlet table: change one flag without re-validating the whole outlet. */
app.patch(
  '/api/admin/outlets/:id',
  atomicRoute(async (req: AuthRequest, res) => {
    const p = z
      .object({ active: flag.optional(), accepting: flag.optional(), featured: flag.optional() })
      .parse(req.body);
    const oid = String(req.params.id);
    const o = await one('SELECT user_id FROM outlets WHERE id=? AND deleted_at IS NULL', oid);
    if (!o) fail('Outlet not found.', 404);
    if (p.active !== undefined) {
      await run('UPDATE outlets SET active=? WHERE id=?', p.active, oid);
      await run('UPDATE users SET active=? WHERE id=?', p.active, o.user_id);
    }
    if (p.accepting !== undefined || p.featured !== undefined)
      await saveOutletSettings(oid, { accepting: p.accepting, featured: p.featured });
    const s = await outletSettings(oid);
    res.json({ ok: true, accepting: s.accepting, featured: s.featured, open: outletOpen(s) });
  }),
);
/**
 * Deleting a product never loses an order. A product nobody ordered is removed outright. One with
 * past orders is taken off sale and hidden for good; its orders keep the name, price and picture
 * they were placed with.
 */
app.delete(
  '/api/admin/products/:id',
  atomicRoute(async (req, res) => {
    const p = await one(
      'SELECT id FROM products WHERE id=? AND deleted_at IS NULL',
      String(req.params.id),
    );
    if (!p) fail('Product not found.', 404);
    const kept = !!(await one('SELECT 1 FROM order_items WHERE product_id=? LIMIT 1', p.id));
    if (kept)
      await run("UPDATE products SET active=0,sku='',deleted_at=? WHERE id=?", now(), p.id);
    else await run('DELETE FROM products WHERE id=?', p.id);
    res.json({ ok: true, kept });
  }),
);
/**
 * Deleting an outlet never loses an order either. Its sign-in, private documents, support chat and
 * unordered products always go. With no orders the outlet is removed outright; with past orders it
 * is closed and hidden for good, and the orders keep their history. An outlet with an order in
 * progress cannot be deleted.
 */
app.delete(
  '/api/admin/outlets/:id',
  atomicRoute(async (req, res) => {
    const o = await one(
      'SELECT id,user_id FROM outlets WHERE id=? AND deleted_at IS NULL',
      String(req.params.id),
    );
    if (!o) fail('Outlet not found.', 404);
    const orders = (await one(
      "SELECT COUNT(*) total,(SELECT COUNT(*) FROM orders WHERE outlet_id=? AND status NOT IN ('delivered','cancelled')) active FROM orders WHERE outlet_id=?",
      o.id,
      o.id,
    ))!;
    const active = Number(orders.active);
    if (active)
      fail(
        `This outlet has ${active} order${active === 1 ? '' : 's'} in progress. Finish or cancel ${active === 1 ? 'it' : 'them'} first.`,
        409,
      );
    const documents = await all('SELECT filename FROM documents WHERE outlet_id=?', o.id);
    await run('DELETE FROM documents WHERE outlet_id=?', o.id);
    for (const table of ['sessions', 'notifications', 'push_subscriptions', 'email_codes', 'password_resets'])
      await run(`DELETE FROM ${table} WHERE user_id=?`, o.user_id);
    await deleteSupport(o.user_id);
    await run(
      'DELETE FROM products WHERE outlet_id=? AND id NOT IN (SELECT product_id FROM order_items)',
      o.id,
    );
    await afterCommit(async () => {
      for (const d of documents) await objects.delete('documents/' + d.filename);
    });
    const kept =
      Number(orders.total) > 0 ||
      !!(await one('SELECT 1 FROM products WHERE outlet_id=? LIMIT 1', o.id));
    if (kept) {
      const at = now();
      await run(
        "UPDATE products SET active=0,sku='',deleted_at=? WHERE outlet_id=? AND deleted_at IS NULL",
        at,
        o.id,
      );
      // The outlet ID and the sign-in email are freed so a new outlet can use them.
      await run(
        'UPDATE outlets SET active=0,customer_id=?,deleted_at=? WHERE id=?',
        'deleted-' + o.id,
        at,
        o.id,
      );
      await run(
        "UPDATE users SET name='Deleted outlet',email=?,phone='',address='',login_id=NULL,password_hash=?,active=0,deleted_at=? WHERE id=?",
        `deleted-${o.user_id}@deleted.invalid`,
        hashPassword(randomUUID()),
        at,
        o.user_id,
      );
    } else {
      await run('DELETE FROM outlet_settings WHERE outlet_id=?', o.id);
      await run('DELETE FROM outlets WHERE id=?', o.id);
      await run('DELETE FROM payment_proofs WHERE user_id=?', o.user_id);
      await run('DELETE FROM users WHERE id=?', o.user_id);
    }
    res.json({ ok: true, kept });
  }),
);
/** Every rider with settings, duty state, load and balances: one query however many riders. */
app.get('/api/admin/riders', async (req, res) => {
  const period = range(req);
  const total = (column: string, table: string, where = '') =>
    `(SELECT COALESCE(SUM(${column}),0) FROM ${table} WHERE rider_id=u.id${where})`;
  const settings = Object.entries(riderDefaults)
    .map(([k, v]) => `COALESCE(g.${k},${typeof v === 'number' ? v : `'${v}'`}) ${k}`)
    .join(',');
  res.json(
    (
      await all(
        `SELECT u.id,u.name,u.email,u.phone,u.address,u.location_id,u.login_id,u.active,u.created_at,${settings},COALESCE(s.available,1) available,COALESCE(s.capacity,5) capacity,s.lat,s.lng,s.accuracy,s.updated_at position_at,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status NOT IN ('delivered','cancelled')) active_orders,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status='delivered') delivered,(SELECT MAX(delivered_at) FROM orders WHERE rider_id=u.id AND status='delivered') last_delivery_at,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status='delivered' AND ${between('delivered_at')}) delivered_range,${total('amount', 'rider_earnings', ' AND ' + between('created_at'))} earned_range,${total('amount', 'rider_payouts', ' AND ' + between('created_at'))} paid_range,${total('cash_collected', 'rider_earnings', ' AND ' + between('created_at'))} cash_range,${total('amount', 'rider_earnings')} earned,${total('amount', 'rider_payouts')} paid,${total('amount', 'payout_requests', " AND status='pending'")} pending_payouts,${total('cash_collected', 'rider_earnings')} cash_collected,${total('amount', 'cod_deposits', " AND status IN ('approved','pending')")} cash_submitted FROM users u LEFT JOIN rider_settings g ON g.user_id=u.id LEFT JOIN rider_state s ON s.user_id=u.id WHERE u.role='rider' AND u.deleted_at IS NULL ORDER BY u.created_at DESC`,
        ...Array.from({ length: 4 }, () => [period.from, period.to]).flat(),
      )
    ).map(({ cash_collected, cash_submitted, ...r }) => ({
      ...r,
      // Placeholder addresses stand in for riders saved without an email.
      email: r.email.endsWith(riderMailDomain) ? '' : r.email,
      balance: r.earned - r.paid,
      cash_in_hand: cash_collected - cash_submitted,
    })),
  );
});
/** Riders sign in with their rider ID, so an email is optional; accounts still need a unique one. */
const riderMailDomain = '@riders.dellvit.invalid';
const optional = (max: number) => z.string().trim().max(max).optional();
const riderSchema = z.object({
  name: str(100),
  email: z.union([email, z.literal('')]).default(''),
  phone,
  address: z.string().trim().max(500).default(''),
  location_id: location,
  login_id: z.string().regex(/^[A-Z0-9-]{3,30}$/),
  password: z.string().min(10).max(100).optional(),
  active: z.number().int().min(0).max(1).default(1),
  ...commissionSchema,
  vehicle_type: z.enum(vehicleTypes).optional(),
  vehicle_number: optional(20),
  cnic: z
    .string()
    .trim()
    .regex(/^(\d{5}-?\d{7}-?\d)?$/, 'A CNIC has 13 digits, for example 37405-1234567-1.')
    .optional(),
  license_number: optional(30),
  emergency_name: optional(100),
  emergency_phone: z.union([phone, z.literal('')]).optional(),
  payout_method: z.enum(payoutMethods).optional(),
  payout_bank: optional(100),
  payout_title: optional(100),
  payout_account: optional(40),
  notes: optional(2000),
  // Dispatch: whether the rider is on duty and how many orders they carry at once.
  available: z.number().int().min(0).max(1).optional(),
  capacity: z.number().int().min(1).max(50).optional(),
});
/** Sets a rider's duty state or capacity, keeping whichever is not given. */
async function saveRiderState(uid: string, s: { available?: number; capacity?: number }) {
  if (s.available === undefined && s.capacity === undefined) return;
  const old = (await one('SELECT available,capacity FROM rider_state WHERE user_id=?', uid)) || {
    available: 1,
    capacity: 5,
  };
  await run(
    'INSERT INTO rider_state(user_id,available,capacity) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET available=excluded.available,capacity=excluded.capacity',
    uid,
    s.available ?? old.available,
    s.capacity ?? old.capacity,
  );
}
async function saveRider(req: AuthRequest, res: Response, edit: boolean) {
  const p = await riderSchema.parseAsync(req.body);
  const uid = edit ? String(req.params.id) : id();
  if (edit && !(await one("SELECT id FROM users WHERE id=? AND role='rider' AND deleted_at IS NULL", uid)))
    fail('Rider not found.', 404);
  if (!edit && !p.password) fail('Set a rider password.');
  if (p.commission_type === 'percent' && p.commission_value > 100)
    fail('A percentage commission must be 100 or less.');
  await transaction(async () => await saveRiderAccount(p, uid, edit));
  res.json(await publicUser((await one('SELECT * FROM users WHERE id=?', uid))!));
}
async function saveRiderAccount(p: z.infer<typeof riderSchema>, uid: string, edit: boolean) {
  p.email ||= p.login_id.toLowerCase() + riderMailDomain;
  if (edit) {
    await run(
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
      await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(p.password), uid);
  } else
    await run(
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
  const { available, capacity } = p;
  await saveRiderSettings(uid, p);
  await saveRiderState(uid, { available, capacity });
}
app.post(
  '/api/admin/riders',
  atomicRoute(async (req: AuthRequest, res) => await saveRider(req, res, false)),
);
app.put(
  '/api/admin/riders/:id',
  atomicRoute(async (req: AuthRequest, res) => await saveRider(req, res, true)),
);
/** The switches in the rider table: change one setting without re-validating the whole rider. */
app.patch(
  '/api/admin/riders/:id',
  atomicRoute(async (req: AuthRequest, res) => {
    const p = z
      .object({
        active: flag.optional(),
        available: flag.optional(),
        capacity: z.number().int().min(1).max(50).optional(),
      })
      .parse(req.body);
    const uid = String(req.params.id);
    if (!(await one("SELECT id FROM users WHERE id=? AND role='rider' AND deleted_at IS NULL", uid)))
      fail('Rider not found.', 404);
    if (p.active !== undefined) await run('UPDATE users SET active=? WHERE id=?', p.active, uid);
    await saveRiderState(uid, p);
    res.json({ ok: true });
  }),
);
/**
 * Deleting a rider never loses an order or a payment record. A rider with a delivery in progress,
 * cash still in hand, earnings not yet paid or a request waiting for review cannot be deleted. With
 * no history the account is removed outright; otherwise it is closed for good, its sign-in and
 * personal details are erased, and the name stays on past orders and payments.
 */
app.delete(
  '/api/admin/riders/:id',
  atomicRoute(async (req, res) => {
    const uid = String(req.params.id);
    if (!(await one("SELECT id FROM users WHERE id=? AND role='rider' AND deleted_at IS NULL", uid)))
      fail('Rider not found.', 404);
    const sum = (column: string, table: string, where = '') =>
      `(SELECT COALESCE(SUM(${column}),0) FROM ${table} WHERE rider_id=?${where})`;
    const rows = (table: string, where = '') =>
      `(SELECT COUNT(*) FROM ${table} WHERE rider_id=?${where})`;
    const r = (await one(
      `SELECT ${rows('orders', " AND status NOT IN ('delivered','cancelled')")} active,${sum('amount', 'rider_earnings')}-${sum('amount', 'rider_payouts')} balance,${sum('cash_collected', 'rider_earnings')}-${sum('amount', 'cod_deposits', " AND status IN ('approved','pending')")} cash,${rows('cod_deposits', " AND status='pending'")}+${rows('payout_requests', " AND status='pending'")} pending,${['orders', 'rider_earnings', 'rider_payouts', 'payout_requests', 'cod_deposits'].map((t) => rows(t)).join('+')} history`,
      ...Array.from({ length: 12 }, () => uid),
    ))!;
    const rupees = (paisa: number) => 'Rs ' + (paisa / 100).toLocaleString('en-PK');
    const active = Number(r.active);
    if (active)
      fail(
        `This rider has ${active} order${active === 1 ? '' : 's'} in progress. Finish or reassign ${active === 1 ? 'it' : 'them'} first.`,
        409,
      );
    if (Number(r.cash) > 0)
      fail(
        `This rider still holds ${rupees(Number(r.cash))} of collected cash. Record the cash handover first.`,
        409,
      );
    if (Number(r.pending))
      fail(
        'This rider has a cash deposit or payout request waiting for review. Approve or reject it first.',
        409,
      );
    if (Number(r.balance) > 0)
      fail(
        `This rider is still owed ${rupees(Number(r.balance))} in earnings. Pay it out first.`,
        409,
      );
    for (const table of [
      'sessions',
      'notifications',
      'push_subscriptions',
      'email_codes',
      'password_resets',
      'rider_state',
      'rider_settings',
    ])
      await run(`DELETE FROM ${table} WHERE user_id=?`, uid);
    await deleteSupport(uid);
    const kept = Number(r.history) > 0;
    if (kept)
      // The rider ID and the email are freed so a new rider can use them.
      await run(
        "UPDATE users SET email=?,phone='',address='',location_id=NULL,login_id=NULL,password_hash=?,active=0,deleted_at=? WHERE id=?",
        `deleted-${uid}@deleted.invalid`,
        hashPassword(randomUUID()),
        now(),
        uid,
      );
    else {
      const proofs = await all('SELECT filename FROM payment_proofs WHERE user_id=?', uid);
      await run('DELETE FROM payment_proofs WHERE user_id=?', uid);
      await run('DELETE FROM users WHERE id=?', uid);
      await afterCommit(async () => {
        for (const p of proofs) await objects.delete('proofs/' + p.filename);
      });
    }
    res.json({ ok: true, kept });
  }),
);
app.get('/api/admin/outlets/:id/documents', async (req, res) =>
  res.json(
    await all(
      'SELECT id,name,mime,created_at FROM documents WHERE outlet_id=?',
      String(req.params.id),
    ),
  ),
);
app.post(
  '/api/admin/outlets/:id/documents',
  writeLimit,
  upload.single('file'),
  atomicRoute(async (req, res) => {
    if (
      !(await one(
        'SELECT id FROM outlets WHERE id=? AND deleted_at IS NULL',
        String(req.params.id),
      ))
    )
      fail('Outlet not found.', 404);
    if (!req.file) fail('Choose a PDF document.');
    if (req.file.buffer.subarray(0, 5).toString() !== '%PDF-')
      fail('Only PDF documents are accepted.');
    const did = id();
    const filename = did + '.pdf';
    await objects.put('documents/' + filename, req.file.buffer, 'application/pdf');
    await run(
      'INSERT INTO documents VALUES(?,?,?,?,?,?)',
      did,
      String(req.params.id),
      req.file.originalname.slice(0, 200),
      filename,
      'application/pdf',
      now(),
    );
    res.status(201).json({ id: did });
  }),
);
app.get('/api/admin/documents/:id', async (req, res) => {
  const d = await one('SELECT * FROM documents WHERE id=?', String(req.params.id));
  if (!d) fail('Document not found.', 404);
  res.setHeader('Cache-Control', 'no-store');
  const document = await objects.get('documents/' + d.filename);
  if (!document) return res.sendStatus(404);
  res.attachment(d.name).type('application/pdf').send(document.body);
});
app.delete(
  '/api/admin/documents/:id',
  atomicRoute(async (req, res) => {
    const d = await one('SELECT * FROM documents WHERE id=?', String(req.params.id));
    if (!d) fail('Document not found.', 404);
    await run('DELETE FROM documents WHERE id=?', d.id);
    await afterCommit(() => objects.delete('documents/' + d.filename));
    res.json({ ok: true });
  }),
);
app.delete(
  '/api/admin/messages/:id',
  atomicRoute(async (req, res) => {
    await run('DELETE FROM messages WHERE id=?', String(req.params.id));
    res.json({ ok: true });
  }),
);
app.get('/api/admin/messages', async (_req, res) =>
  res.json(await all('SELECT * FROM messages ORDER BY created_at DESC')),
);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((err: any, _req: AuthRequest, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: 'Upload one file up to 4 MB.' });
  if (err.code === '23505')
    return res.status(409).json({ error: 'That email, account ID or record already exists.' });
  if (err.code === '23503')
    return res.status(409).json({
      error: 'This record is referenced by other records, or a related record is missing.',
    });
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error('API request failed', { code: err.code || 'UNKNOWN' });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

export default app;
