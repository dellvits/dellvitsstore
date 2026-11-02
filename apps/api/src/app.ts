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
  productInArea,
} from './platform.js';
import { installBlog } from './blog.js';
import { installWishes, matchProduct } from './wishes.js';
import { toWebp, videoType } from './images.js';
import { describeQr } from './emvqr.js';
import jsQRModule from 'jsqr';
import sharp from 'sharp';
// jsqr is CommonJS; its function is the module itself or its default export.
const jsQR = ((jsQRModule as any).default || jsQRModule) as typeof import('jsqr').default;
import { installSupport, deleteSupport } from './support.js';
import { installNotifications, notify, adminsWith, outletUser } from './notifications.js';
import { pushConfigured } from './fcm.js';
import { installBroadcasts } from './broadcasts.js';
import { installPartners } from './partners.js';
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
// Blog posts carry their whole article; every other request stays small.
const largeJson = express.json({ limit: '2mb' });
const smallJson = express.json({ limit: '100kb' });
app.use((req, res, next) =>
  (req.path.startsWith('/api/admin/blog/') ? largeJson : smallJson)(req, res, next),
);
app.use(cookieParser());
app.use(session);
app.use('/api', (req, res, next) => {
  if (
    /^\/(session|auth|profile|orders|manage|admin|rider|notifications|payment-proofs|push|home|wishes|uploads)(\/|$)/.test(
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
  // Room for full-size phone photos; every picture is converted to WebP before it is stored.
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});
/** Blog videos are larger; only administrators upload them. */
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});
installNotifications(app, { writeLimit });
installBroadcasts(app);
installPartners(app);
installAccounts(app, authLimit);
installRiders(app);
installPayments(app, { upload: upload.single('file') });
installSupport(app, { upload: upload.single('file'), writeLimit });
installWorkflow(app);
installFinance(app);
installBlog(app, { writeLimit });
installWishes(app, { writeLimit });
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
/** Products for the API, each with the delivery areas it sells in, read in one extra query. */
export async function products(rows: Row[]): Promise<Row[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((p) => String(p.id)))];
  const areas = new Map<string, string[]>();
  for (const r of ids.length > 500
    ? await all('SELECT product_id,location_id FROM product_areas')
    : await all(
        `SELECT product_id,location_id FROM product_areas WHERE product_id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      ))
    areas.set(r.product_id, [...(areas.get(r.product_id) || []), r.location_id]);
  return rows.map((p) => {
    const list = areas.get(p.id) || [];
    return {
      ...p,
      images: JSON.parse(p.images),
      payment_methods: productPaymentIds(p),
      effective_price: Math.round((p.price * (100 - p.discount)) / 100),
      nationwide: Number(p.nationwide || 0),
      // Nation Wide products sell everywhere; the others in their main area and the areas listed.
      location_ids: p.nationwide ? [] : [...new Set([p.location_id, ...list])],
    };
  });
}
const product = async (p: Row) => (await products([p]))[0];
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
  // `push` says whether the Firebase key for the app's notifications is set, never the key itself.
  res.json({ ok: true, service: 'dellvit-api', push: pushConfigured() });
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
        // Riders and outlets sign up as applicants: they verify their email, send their details
        // and wait for an administrator (partners.ts).
        account_type: z.enum(['customer', 'rider', 'outlet']).default('customer'),
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
      p.account_type === 'customer' ? 'customer' : 'applicant',
      now(),
    );
    if (p.account_type !== 'customer')
      await run(
        'INSERT INTO partner_applications(user_id,kind,created_at) VALUES(?,?,?)',
        uid,
        p.account_type,
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
    // Rider and outlet IDs are kept in capitals, so "drv-001" signs in as DRV-001.
    const u = await one(
      'SELECT * FROM users WHERE email=? OR login_id=?',
      p.login.toLowerCase(),
      p.login.toUpperCase(),
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
  requireRole('customer', 'admin', 'outlet', 'rider', 'applicant'),
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
/** The storefront's "Nation Wide" choice: browse every delivery area at once. */
const NATION_WIDE = 'nationwide';
app.get('/api/products', async (req, res) => {
  const { location: loc, q, category, outlet } = req.query;
  let sql =
    'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.active=1 AND o.active=1';
  const args: any[] = [];
  if (loc && loc !== NATION_WIDE) {
    sql += ' AND ' + productInArea;
    args.push(String(loc), String(loc));
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
  res.json(await products(await all(sql, ...args)));
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
/** Matches outlets that deliver to the area given as the next parameter: nation wide ones, or ones serving it. */
const servesArea =
  '(o.nationwide=1 OR EXISTS (SELECT 1 FROM outlet_areas a WHERE a.outlet_id=o.id AND a.location_id=?))';
app.get('/api/outlets', async (req, res) =>
  res.json(
    (req.query.location && req.query.location !== NATION_WIDE
      ? await all(
          publicOutlets + ` AND ${servesArea} ORDER BY featured DESC,o.name`,
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
/**
 * The pop-up the mobile app shows when it opens: the first enabled one inside its schedule that is
 * meant for this shopper and area, with those of its products that can be ordered there now.
 * Nation Wide shoppers only see pop-ups meant for every area. Answers null when there is none.
 */
app.get('/api/app/popup', async (req: AuthRequest, res) => {
  const loc = String(req.query.location || '');
  const everywhere = !loc || loc === NATION_WIDE;
  const at = new Date().toISOString();
  const who = !req.user ? 'guests' : req.user.role === 'customer' ? 'customers' : 'staff';
  const live = (await records('popups', true)).filter(
    (p) =>
      (!p.starts_at || p.starts_at <= at) &&
      (!p.ends_at || p.ends_at > at) &&
      (p.audience === 'all' || p.audience === who) &&
      (!p.location_ids?.length || (!everywhere && p.location_ids.includes(loc))),
  );
  for (const p of live) {
    const ids: string[] = p.product_ids || [];
    if (!ids.length) continue;
    const rows = await all(
      `SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.active=1 AND o.active=1 AND p.stock>0 AND p.id IN (${ids.map(() => '?').join(',')})` +
        (everywhere ? '' : ' AND ' + productInArea),
      ...ids,
      ...(everywhere ? [] : [loc, loc]),
    );
    if (!rows.length) continue;
    // In the order the administrator chose.
    rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return res.json({
      id: p.id,
      title: p.title,
      message: p.message,
      image: p.image,
      frequency: p.frequency,
      delay: p.delay,
      products: await products(rows),
    });
  }
  res.json(null);
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
/**
 * Deals products out one outlet at a time, keeping the shuffled order within each outlet, so
 * neighbouring cards come from different outlets and no single shop fills a row. Products that
 * are sold out go after everything that can be bought.
 */
export function spreadByOutlet<T extends Row>(rows: T[], limit: number): T[] {
  const spread = (list: T[]) => {
    const queues = new Map<string, T[]>();
    for (const p of list) queues.set(p.outlet_id, [...(queues.get(p.outlet_id) || []), p]);
    const out: T[] = [];
    while (out.length < list.length) for (const q of queues.values()) if (q.length) out.push(q.shift()!);
    return out;
  };
  return [...spread(rows.filter((p) => p.stock > 0)), ...spread(rows.filter((p) => p.stock <= 0))].slice(0, limit);
}
/** Homepage feed for one delivery area, or every area when Nation Wide: nearby picks, deals, home categories and outlets. */
app.get('/api/home', async (req, res) => {
  const loc = String(req.query.location || '');
  const everywhere = loc === NATION_WIDE;
  if (
    !everywhere &&
    (!loc || !(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', loc)))
  )
    return res.json({ nearby: [], deals: [], categories: [], outlets: [] });
  const area = everywhere ? [] : [loc];
  // Products come in a random mix rather than newest or oldest first. The seed picks the mix:
  // the website and app send one per visit, so the order holds while someone browses and
  // changes when they come back or pull to refresh.
  const seed = /^[a-z0-9]{1,32}$/i.test(String(req.query.seed || ''))
    ? String(req.query.seed)
    : randomUUID().slice(0, 8);
  const base =
    'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.active=1 AND o.active=1' +
    (everywhere ? '' : ' AND ' + productInArea);
  // A few times more than are shown, so the spread across outlets has products to choose from.
  const mixed = async (filter: string, limit: number) =>
    spreadByOutlet(
      await all(
        `${base}${filter} ORDER BY p.stock>0 DESC,md5(p.id||?) LIMIT ${Math.min(96, limit * 4)}`,
        ...area,
        ...area,
        seed,
      ),
      limit,
    );
  const homeCategories = (await records('categories', true)).filter((c) => c.show_on_home !== false);
  const limitOf = (c: Row) => Math.min(24, Math.max(1, Math.round(Number(c.home_limit)) || 8));
  // Every category section in one query: each category's products numbered in the same mix.
  const sectionRows = async () => {
    if (!homeCategories.length) return [];
    return await all(
      `SELECT * FROM (SELECT p.*,o.name outlet_name,ROW_NUMBER() OVER (PARTITION BY p.category ORDER BY p.stock>0 DESC,md5(p.id||?)) home_rank FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.active=1 AND o.active=1${everywhere ? '' : ' AND ' + productInArea} AND p.category IN (${homeCategories.map(() => '?').join(',')})) x WHERE home_rank<=96 ORDER BY home_rank`,
      seed,
      ...area,
      ...area,
      ...homeCategories.map((c) => c.name),
    );
  };
  const [nearbyRows, dealRows, categoryRows, outlets] = await Promise.all([
    mixed('', 8),
    mixed(' AND p.discount>0 AND p.stock>0', 8),
    sectionRows(),
    all(
      `SELECT o.id,o.name,o.location_id,o.address,o.phone,o.image,o.category,${outletPublicColumns},(SELECT COUNT(*) FROM products p WHERE p.outlet_id=o.id AND p.active=1) products,(SELECT MIN(delivery_minutes) FROM products p WHERE p.outlet_id=o.id AND p.active=1) delivery_minutes FROM outlets o LEFT JOIN outlet_settings s ON s.outlet_id=o.id WHERE o.active=1${everywhere ? '' : ' AND ' + servesArea} ORDER BY featured DESC,products DESC`,
      ...area,
    ),
  ]);
  const sections = homeCategories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    image: c.image,
    rows: spreadByOutlet(
      categoryRows.filter((p) => p.category === c.name && p.home_rank <= limitOf(c) * 4),
      limitOf(c),
    ),
  }));
  // The delivery areas of every product shown, in one more query.
  const serialized = new Map(
    (
      await products([...nearbyRows, ...dealRows, ...sections.flatMap((s) => s.rows)].map(({ home_rank, ...p }) => p))
    ).map((p) => [p.id, p]),
  );
  const out = (rows: Row[]) => rows.map((p) => serialized.get(p.id)!);
  res.json({
    nearby: out(nearbyRows),
    deals: out(dealRows),
    categories: sections
      .filter((s) => s.rows.length)
      .map(({ rows, ...s }) => ({ ...s, products: out(rows) })),
    outlets: outlets.map(withOpen),
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
/**
 * Places a checkout. A cart may hold products from several outlets: it becomes one order per
 * outlet, all saved together in one transaction and linked by checkout_id, because each outlet
 * prepares and each rider delivers its own order. Delivery is charged per outlet; a coupon's
 * discount is taken off the largest order first.
 */
app.post('/api/orders', writeLimit, async (req: AuthRequest, res) => {
  if (!req.user) fail('Please log in or create an account to place an order.', 401);
  if (req.user.role !== 'customer') fail('Use a customer account to place an order.', 403);
  const p = await cart.parseAsync(req.body);
  let created = false;
  const placed = await transaction(async () => {
    const prior = await one('SELECT * FROM orders WHERE idempotency_key=?', p.idempotency_key);
    if (prior) {
      if (!(await orderVisible(req, prior))) fail('Checkout key already used.', 409);
      return prior.checkout_id
        ? await all('SELECT * FROM orders WHERE checkout_id=? ORDER BY created_at,id', prior.checkout_id)
        : [prior];
    }
    const ids = new Set(p.items.map((i) => i.product_id));
    if (ids.size !== p.items.length) fail('Duplicate cart items are not allowed.');
    const loc = p.delivery.location_id;
    const lines: Row[] = await Promise.all(
      p.items.map(async (item): Promise<Row> => {
        const x = await one(
          `SELECT p.*,o.active outlet_active,o.name outlet_name,${productInArea} served FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.id=?`,
          loc,
          loc,
          item.product_id,
        );
        if (!x || !x.active || !x.outlet_active) fail('An item is no longer available.');
        if (!x.served) fail(`${x.name} is not available in your delivery area.`);
        if (x.stock < item.quantity) fail(`${x.name} has only ${x.stock} available.`, 409);
        if (item.quantity > x.max_per_order)
          fail(`You can order up to ${x.max_per_order} of ${x.name} at a time.`);
        return { ...(await product(x)), quantity: item.quantity };
      }),
    );
    // One group per outlet, in the order the cart lists them.
    const groups = new Map<string, Row[]>();
    for (const x of lines) groups.set(x.outlet_id, [...(groups.get(x.outlet_id) || []), x]);
    const several = groups.size > 1;
    for (const [outletId, items] of groups) {
      const shop = await outletSettings(outletId);
      const who = several ? items[0].outlet_name : 'This outlet';
      if (!shop.accepting)
        fail(`${who} is not accepting orders right now. Please try again later.`);
      if (!withinHours(shop))
        fail(`${who} takes orders from ${shop.opens_at} to ${shop.closes_at}. Please order then.`);
    }
    const center = (await one('SELECT * FROM locations WHERE id=?', loc))!;
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
    const sum = (items: Row[]) => items.reduce((s, x) => s + x.effective_price * x.quantity, 0);
    const subtotal = sum(lines);
    const siteSettings = (await records('settings', true))[0];
    if (siteSettings?.checkout_enabled === false)
      fail(siteSettings.checkout_message || 'Ordering is temporarily paused. Please try again later.');
    if (siteSettings && subtotal < siteSettings.minimum_order)
      fail(`The minimum order subtotal is PKR ${(siteSettings.minimum_order / 100).toFixed(2)}.`);
    for (const [outletId, items] of groups) {
      const shop = await outletSettings(outletId);
      if (sum(items) < shop.minimum_order)
        fail(
          `The minimum order for ${several ? items[0].outlet_name : 'this outlet'} is PKR ${(shop.minimum_order / 100).toFixed(2)}.`,
        );
    }
    if (subtotal < area.minimum_order)
      fail(`The minimum order in this area is PKR ${(area.minimum_order / 100).toFixed(2)}.`);
    // The free-delivery threshold looks at the whole checkout.
    const fee = deliveryFee(area, subtotal);
    const { discount, coupon } = await couponDiscount(p.coupon_code, subtotal, {
      userId: req.user!.id,
      locationId: center.id,
      fee: fee * groups.size,
    });
    // Largest order first: it takes the coupon, and its id becomes the checkout's id.
    const orders = [...groups.values()].sort((a, b) => sum(b) - sum(a));
    let left = discount;
    const online = isOnline(payment.type);
    const placedIds: string[] = [];
    let checkoutId: string | null = null;
    for (const [n, items] of orders.entries()) {
      const oid = id();
      checkoutId ??= several ? oid : null;
      const part = Math.min(left, sum(items) + fee);
      left -= part;
      const ref = 'DLV-' + Date.now().toString(36).toUpperCase() + '-' + randomInt(100, 1000);
      const otp = String(randomInt(100000, 1000000));
      const due = new Date(
        Date.now() + Math.max(...items.map((x) => x.delivery_minutes)) * 60000,
      ).toISOString();
      await run(
        'INSERT INTO orders(id,reference,user_id,guest_session,outlet_id,rider_id,name,email,phone,address,location_id,lat,lng,notes,payment_method,subtotal,delivery_fee,total,status,otp,created_at,deliver_by,idempotency_key,checkout_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        oid,
        ref,
        req.user!.id,
        null,
        items[0].outlet_id,
        // Riders are assigned by an administrator when the order is sent for confirmation.
        null,
        p.delivery.name,
        p.delivery.email,
        p.delivery.phone,
        p.delivery.address,
        loc,
        p.delivery.lat,
        p.delivery.lng,
        p.delivery.notes,
        p.payment_method,
        sum(items),
        fee,
        sum(items) + fee - part,
        'placed',
        otp,
        // Later orders of the checkout sort right after the first.
        new Date(Date.now() + n).toISOString(),
        due,
        n ? `${p.idempotency_key}:${n + 1}` : p.idempotency_key,
        checkoutId,
      );
      await run(
        'INSERT INTO order_details(order_id,discount,coupon_code,payment_name,payment_type,payment_instructions,payment_status,transaction_id,payer_name,payer_account,proof_id,payment_details,payment_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        oid,
        part,
        part ? coupon?.code || '' : '',
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
      // A coupon counts as used once per checkout.
      if (coupon && !n) await run('INSERT INTO coupon_uses VALUES(?,?)', oid, coupon.id);
      for (const x of items) {
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
      placedIds.push(oid);
    }
    created = true;
    return await all(
      `SELECT * FROM orders WHERE id IN (${placedIds.map(() => '?').join(',')}) ORDER BY created_at,id`,
      ...placedIds,
    );
  });
  const first = placed[0];
  if (created) {
    const d = (await one(
      'SELECT payment_type,payment_name,payment_status FROM order_details WHERE order_id=?',
      first.id,
    ))!;
    const amount = money(placed.reduce((s, o) => s + o.total, 0));
    const pendingNote = isOnline(d.payment_type) ? ' · payment under review' : '';
    await notify([first.user_id], {
      type: 'order',
      title: placed.length > 1 ? `${placed.length} orders placed` : 'Order placed',
      body: `${placed.map((o) => o.reference).join(', ')} · ${amount}${pendingNote}`,
      link: placed.length > 1 ? '/orders' : '/orders/' + first.id,
    });
    for (const o of placed) {
      const verified = !!(await flow(o.id)).payment_verified_at;
      await notify(await adminsWith('orders'), {
        type: 'order',
        title: 'New order',
        body: `${o.reference} from ${o.name} · ${money(o.total)}${placed.length > 1 ? ` · 1 of ${placed.length} in one checkout` : ''} · ${verified ? 'assign a rider and send it' : 'awaiting payment verification'}`,
        link: '/admin?tab=orders',
      });
    }
    if (isOnline(d.payment_type))
      await notify(await adminsWith('payments'), {
        type: 'payment',
        title: 'Payment to verify',
        body: `${placed.map((o) => o.reference).join(', ')} · ${d.payment_name} · ${amount}`,
        link: '/admin?tab=payments',
      });
  }
  // The first order, as before, plus every order of the checkout.
  res.status(201).json({
    ...(await serializeOrder(first, req)),
    checkout: placed.map((o) => ({ id: o.id, reference: o.reference, total: o.total })),
  });
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
    await products(
      req.user!.role === 'admin'
        ? await all(
            'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.deleted_at IS NULL',
          )
        : await all(
            'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.outlet_id=? AND p.deleted_at IS NULL',
            (await myOutlet(req))?.id || '',
          ),
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
  // The main area. The areas the product sells in are Nation Wide or location_ids; left out,
  // a new product sells in its main area and an edited one keeps the areas it has.
  location_id: location,
  nationwide: z.number().int().min(0).max(1).optional(),
  location_ids: z.array(z.string().max(100)).max(500).optional(),
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
  // Delivery areas work like an outlet's: Nation Wide, or the areas ticked.
  const keepAreas = editing && p.nationwide === undefined && p.location_ids === undefined;
  const nationwide = p.nationwide ?? 0;
  const areas = nationwide ? [] : [...new Set(p.location_ids || [p.location_id])];
  if (!keepAreas && !nationwide) {
    if (!areas.length) fail('Tick Nation Wide or choose at least one delivery area.');
    const found = await all(
      `SELECT id FROM locations WHERE deleted_at IS NULL AND id IN (${areas.map(() => '?').join(',')})`,
      ...areas,
    );
    if (found.length !== areas.length) fail('One of the chosen delivery areas no longer exists.');
    // The main area is one of the areas it sells in.
    if (!areas.includes(p.location_id)) p.location_id = areas[0];
  }
  const before = editing ? await one('SELECT active FROM products WHERE id=?', pid) : null;
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
  if (!keepAreas) {
    await run('UPDATE products SET nationwide=? WHERE id=?', nationwide, pid);
    await run('DELETE FROM product_areas WHERE product_id=?', pid);
    if (areas.length)
      await run(
        `INSERT INTO product_areas(product_id,location_id) VALUES ${areas.map(() => '(?,?)').join(',')}`,
        ...areas.flatMap((a) => [pid, a]),
      );
  }
  // New and newly listed products are compared with what customers asked for in Find my product.
  if (p.active && (!before || !before.active)) await afterCommit(() => matchProduct(pid));
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
/** Saves any picture as WebP in the public image folder and answers its address. */
async function storeImage(req: AuthRequest, res: Response) {
  if (!req.file) fail('Choose an image.');
  const f = id() + '.webp';
  const image = await toWebp(req.file.buffer);
  await objects.put('images/' + f, image, 'image/webp');
  res.status(201).json({ url: '/api/media/' + f });
}
app.post(
  '/api/manage/images',
  requireRole('admin', 'outlet'),
  writeLimit,
  upload.single('file'),
  atomicRoute(storeImage),
);
// Customers add pictures to their Find my product requests.
app.post(
  '/api/uploads/images',
  requireRole('customer', 'admin', 'outlet', 'rider'),
  writeLimit,
  upload.single('file'),
  atomicRoute(storeImage),
);
/**
 * Turns a picture the browser cannot show (such as an iPhone HEIC photo) into WebP so it can be
 * cropped before uploading. Nothing is stored.
 */
app.post(
  '/api/uploads/preview',
  requireRole('customer', 'admin', 'outlet', 'rider'),
  writeLimit,
  upload.single('file'),
  async (req: AuthRequest, res) => {
    if (!req.file) fail('Choose an image.');
    res.setHeader('Cache-Control', 'no-store');
    res.type('image/webp').send(await toWebp(req.file.buffer, { max: 4096 }));
  },
);
/**
 * Reads the store's merchant QR from a photo or screenshot of it (or from its text), for the
 * payment method form. Nothing is stored here; the form saves the text with the method.
 */
app.post(
  '/api/admin/payments/qr-read',
  requireRole('admin'),
  writeLimit,
  upload.single('file'),
  atomicRoute(async (req: AuthRequest, res) => {
    let payload = String(req.body?.payload || '').trim();
    if (req.file) {
      const { data, info } = await sharp(await toWebp(req.file.buffer, { max: 1600 }))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
      if (!found?.data) fail('No QR code was found in this picture. Upload a clear, straight photo or screenshot of it.');
      payload = found.data.trim();
    }
    if (!payload) fail('Upload the QR picture or paste its text.');
    if (payload.length > 700) fail('This QR holds too much text to be a payment QR.');
    res.json({ payload, ...describeQr(payload) });
  }),
);
app.post(
  '/api/manage/videos',
  requireRole('admin'),
  writeLimit,
  videoUpload.single('file'),
  atomicRoute(async (req, res) => {
    if (!req.file) fail('Choose a video.');
    const kind = videoType(req.file.buffer);
    if (!kind) fail('Upload an MP4 or WebM video.');
    const f = id() + '.' + kind;
    await objects.put('videos/' + f, req.file.buffer, 'video/' + kind);
    res.status(201).json({ url: '/api/videos/' + f });
  }),
);
/** Videos play in the browser, which asks for them in parts while seeking. */
app.get('/api/videos/:name', async (req, res) => {
  const name = String(req.params.name);
  const kind = /^[\da-f-]+\.(mp4|webm)$/.exec(name)?.[1];
  if (!kind) fail('File not found.', 404);
  const video = await objects.get('videos/' + name);
  if (!video) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.type('video/' + kind);
  const size = video.body.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (!range || (!range[1] && !range[2])) return res.send(video.body);
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  start = Math.max(0, start);
  if (start > end || start >= size) {
    res.setHeader('Content-Range', 'bytes */' + size);
    return res.sendStatus(416);
  }
  res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.send(video.body.subarray(start, end + 1));
});
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
      "SELECT (SELECT COUNT(*) FROM orders WHERE location_id=? AND status NOT IN ('delivered','cancelled')) active,(SELECT COUNT(*) FROM outlets o WHERE o.deleted_at IS NULL AND (o.location_id=? OR EXISTS (SELECT 1 FROM outlet_areas a WHERE a.outlet_id=o.id AND a.location_id=?))) outlets,(SELECT COUNT(*) FROM products WHERE location_id=? AND deleted_at IS NULL) products,(SELECT COUNT(*) FROM orders WHERE location_id=?)+(SELECT COUNT(*) FROM outlets WHERE location_id=?)+(SELECT COUNT(*) FROM products WHERE location_id=?) history",
      ...Array.from({ length: 7 }, () => lid),
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
/** The delivery areas every outlet serves, by outlet ID. */
async function outletAreas() {
  const areas = new Map<string, string[]>();
  for (const r of await all('SELECT outlet_id,location_id FROM outlet_areas'))
    areas.set(r.outlet_id, [...(areas.get(r.outlet_id) || []), r.location_id]);
  return areas;
}
app.get('/api/admin/outlets', async (_req, res) => {
  // Three queries however many outlets there are.
  const [settings, areas] = await Promise.all([
    all('SELECT * FROM outlet_settings').then(
      (rows) => new Map(rows.map((s) => [s.outlet_id, s])),
    ),
    outletAreas(),
  ]);
  res.json(
    (
      await all(
        'SELECT o.*,(SELECT COUNT(*) FROM products p WHERE p.outlet_id=o.id AND p.active=1) products,(SELECT COUNT(*) FROM orders x WHERE x.outlet_id=o.id) orders,(SELECT COALESCE(SUM(subtotal),0) FROM order_settlements t WHERE t.outlet_id=o.id) sales,(SELECT COALESCE(SUM(outlet_payable),0) FROM order_settlements t WHERE t.outlet_id=o.id) payable FROM outlets o WHERE o.deleted_at IS NULL ORDER BY o.name',
      )
    ).map((o) => {
      const s = { ...outletDefaults, ...settings.get(o.id) };
      return { ...o, ...s, location_ids: areas.get(o.id) || [], open: outletOpen(s) };
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
  // The pickup area; the areas the outlet delivers to are nationwide or location_ids.
  location_id: location,
  // Left out on an edit, the outlet keeps the areas it has; a new outlet is nation wide.
  nationwide: flag.optional(),
  location_ids: z.array(z.string().max(100)).max(500).optional(),
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
  // Nation wide outlets show in every delivery area; the others only in the areas chosen.
  const keepAreas = edit && p.nationwide === undefined && p.location_ids === undefined;
  const nationwide = p.nationwide ?? (p.location_ids?.length ? 0 : 1);
  const areas = nationwide ? [] : [...new Set(p.location_ids)];
  if (!keepAreas && !nationwide) {
    if (!areas.length) fail('Tick Nation Wide or choose at least one delivery area.');
    const found = await all(
      `SELECT id FROM locations WHERE deleted_at IS NULL AND id IN (${areas.map(() => '?').join(',')})`,
      ...areas,
    );
    if (found.length !== areas.length) fail('Choose supported delivery areas.');
  }
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
    if (!keepAreas) {
      await run('UPDATE outlets SET nationwide=? WHERE id=?', nationwide, oid);
      await run('DELETE FROM outlet_areas WHERE outlet_id=?', oid);
      if (areas.length)
        await run(
          `INSERT INTO outlet_areas(outlet_id,location_id) VALUES ${areas.map(() => '(?,?)').join(',')}`,
          ...areas.flatMap((a) => [oid, a]),
        );
    }
  });
  res.json({
    ...(await one('SELECT * FROM outlets WHERE id=?', oid)),
    ...(await outletSettings(oid)),
    location_ids: (await all('SELECT location_id FROM outlet_areas WHERE outlet_id=?', oid)).map(
      (r) => r.location_id,
    ),
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
    for (const table of ['sessions', 'notifications', 'push_subscriptions', 'device_tokens', 'email_codes', 'password_resets'])
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
      'device_tokens',
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
    return res
      .status(400)
      .json({ error: 'Upload one picture up to 15 MB, or one video up to 60 MB.' });
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
