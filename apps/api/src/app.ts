import { atomicRoute } from './atomic-route.js';
import { PostgresRateLimitStore } from './rate-limit-store.js';
import {
  installPlatform,
  areaSettings,
  couponDiscount,
  paymentMethods,
  records,
  isOnline,
} from './platform.js';
import { installNotifications, notify, adminsWith, outletUser } from './notifications.js';
import {
  installRiders,
  commissionSchema,
  riderSettings,
  saveRiderSettings,
  recordEarning,
  riderBalance,
} from './riders.js';
import {
  installPayments,
  paymentSnapshot,
  paymentSubmission,
  validateSubmission,
  chargeCardOrder,
} from './payments.js';
import {
  installWorkflow,
  addEvent,
  createFlow,
  flow,
  markPaymentVerified,
  serializeFlow,
  canCancel,
  cancelOrder,
  notifyCancelled,
} from './workflow.js';
import { installFinance, recordSettlement, outletSettings, saveOutletSettings } from './finance.js';
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
const origin = process.env.WEB_ORIGIN || 'http://localhost:3000';
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.use(
  express.json({
    limit: '100kb',
    // Card gateway adapters verify webhook signatures against the exact bytes received.
    verify: (req, _res, buf) => {
      if (req.url?.startsWith('/api/payments/card/webhook'))
        (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
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
const upload = multer({
  storage: multer.memoryStorage(),
  // Leave room for multipart framing under Vercel Functions' request body limit.
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});
installNotifications(app);
installRiders(app);
installPayments(app, { upload: upload.single('file') });
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
    async (v) => !!(await one('SELECT id FROM locations WHERE id=?', v)),
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
async function serializeOrder(o: Row, req: AuthRequest) {
  const { guest_session, otp, otp_attempts, otp_locked_until, idempotency_key, ...safe } = o;
  const own =
    (req.user?.role === 'customer' && o.user_id === req.user.id) ||
    (!o.user_id && o.guest_session === req.sessionHash);
  const outlet = await one(
    'SELECT name,address,lat,lng,phone FROM outlets WHERE id=?',
    o.outlet_id,
  );
  const rider = o.rider_id
    ? await one('SELECT name,phone FROM users WHERE id=?', o.rider_id)
    : null;
  const d = await one('SELECT * FROM order_details WHERE order_id=?', o.id);
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
        payment_details: await JSON.parse(d.payment_details || '{}'),
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
  const staff = req.user?.role && req.user.role !== 'customer';
  return {
    ...safe,
    ...payment,
    ...(await serializeFlow(o, req.user?.role || 'customer')),
    outlet_id: o.outlet_id,
    rider_location:
      !['delivered', 'cancelled'].includes(o.status) && o.rider_id
        ? (await one(
            'SELECT lat,lng,accuracy,updated_at FROM rider_state WHERE user_id=? AND lat IS NOT NULL',
            o.rider_id,
          )) || null
        : null,
    ...(own ? { otp } : {}),
    outlet,
    rider,
    items: await all('SELECT * FROM order_items WHERE order_id=?', o.id),
    events: (
      await all(
        'SELECT status,created_at,note,actor FROM order_events WHERE order_id=? ORDER BY created_at,sort_order',
        o.id,
      )
    ).filter(
      (e) =>
        staff ||
        !['rider_rejected', 'cancel_requested', 'cancel_request_dismissed', 'reminder'].includes(
          e.status,
        ),
    ),
  };
}
app.get('/api/health', async (_req, res) => {
  await one('SELECT key FROM settings LIMIT 1');
  res.json({ ok: true, service: 'dellvit-api' });
});
app.get('/api/locations', async (_req, res) =>
  res.json(
    (
      await Promise.all(
        (await all('SELECT * FROM locations')).map(async (l) => ({
          ...l,
          ...(await areaSettings(l.id)),
        })),
      )
    ).filter((l) => l.active),
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
    if (await one('SELECT id FROM users WHERE email=?', p.email))
      fail('An account already uses this email.', 409);
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
    if (req.sessionHash)
      await run(
        'UPDATE orders SET user_id=?,guest_session=NULL WHERE guest_session=? AND user_id IS NULL',
        uid,
        req.sessionHash,
      );
    if (req.sessionHash) await run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
    const token = await newSession(req, res, uid);
    res.status(201).json({
      user: await publicUser((await one('SELECT * FROM users WHERE id=?', uid))!),
      ...(req.headers['x-client'] === 'mobile' ? { token } : {}),
    });
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
    if (req.sessionHash) {
      if (u.role === 'customer')
        await run(
          'UPDATE orders SET user_id=?,guest_session=NULL WHERE guest_session=? AND user_id IS NULL',
          u.id,
          req.sessionHash,
        );
      await run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
    }
    const token = await newSession(req, res, u.id);
    res.json({
      user: await publicUser(u),
      ...(req.headers['x-client'] === 'mobile' ? { token } : {}),
    });
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
    const p = await z
      .object({ name: str(100), phone, address: str(500), location_id: location })
      .parseAsync(req.body);
    await run(
      'UPDATE users SET name=?,phone=?,address=?,location_id=? WHERE id=?',
      p.name,
      p.phone,
      p.address,
      p.location_id,
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
app.get('/api/outlets', async (req, res) =>
  res.json(
    req.query.location
      ? await all(
          'SELECT id,name,location_id,address,phone,image,category,active FROM outlets WHERE active=1 AND location_id=?',
          String(req.query.location),
        )
      : await all(
          'SELECT id,name,location_id,address,phone,image,category,active FROM outlets WHERE active=1',
        ),
  ),
);
app.get('/api/outlets/:id', async (req, res) => {
  const o = await one(
    'SELECT id,name,location_id,address,phone,image,category FROM outlets WHERE id=? AND active=1',
    String(req.params.id),
  );
  if (!o) fail('Outlet not found.', 404);
  res.json(o);
});
app.get('/api/ad', async (_req, res) =>
  res.json(
    await JSON.parse((await one('SELECT value FROM settings WHERE key=?', 'ad'))?.value || 'null'),
  ),
);
app.post(
  '/api/contact',
  writeLimit,
  atomicRoute(async (req, res) => {
    const p = await z.object({ name: str(100), email, message: str(3000) }).parseAsync(req.body);
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
  if (!loc || !(await one('SELECT id FROM locations WHERE id=?', loc)))
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
                  base + ' AND p.category=? ORDER BY p.stock>0 DESC,p.sort_order DESC LIMIT 8',
                  loc,
                  c.name,
                )
              ).map(product),
            ),
          })),
      )
    ).filter((c) => c.products.length),
    outlets: await all(
      'SELECT o.id,o.name,o.location_id,o.address,o.phone,o.image,o.category,(SELECT COUNT(*) FROM products p WHERE p.outlet_id=o.id AND p.active=1) products,(SELECT MIN(delivery_minutes) FROM products p WHERE p.outlet_id=o.id AND p.active=1) delivery_minutes FROM outlets o WHERE o.active=1 AND o.location_id=? ORDER BY products DESC',
      loc,
    ),
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
  let cardMethod: Row | undefined;
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
        return { ...(await product(x)), quantity: item.quantity };
      }),
    );
    if (new Set(lines.map((x) => x.outlet_id)).size !== 1)
      fail('Please order from one outlet at a time.');
    if (!(await outletSettings(lines[0].outlet_id)).accepting)
      fail('This outlet is not accepting orders right now. Please try again later.');
    const center = (await one('SELECT * FROM locations WHERE id=?', p.delivery.location_id))!;
    const km = Math.hypot((p.delivery.lat - center.lat) * 111, (p.delivery.lng - center.lng) * 92);
    const area = await areaSettings(center.id);
    if (!area.active) fail('Delivery is paused in this area.');
    if (km > area.radius) fail(`Delivery pin must be within ${area.radius} km of the area centre.`);
    const payment = (await paymentMethods()).find((m) => m.id === p.payment_method);
    if (!payment) fail('Choose an enabled payment method.');
    await validateSubmission(payment, p.payment, req.user!.id);
    const outlet = lines[0].outlet_id;
    const subtotal = lines.reduce((s, x) => s + x.effective_price * x.quantity, 0);
    const siteSettings = (await records('settings', true))[0];
    if (siteSettings?.checkout_enabled === false)
      fail('Ordering is temporarily paused. Please try again later.');
    if (siteSettings && subtotal < siteSettings.minimum_order)
      fail(`The minimum order subtotal is PKR ${(siteSettings.minimum_order / 100).toFixed(2)}.`);
    const fee = area.fee;
    const { discount, coupon } = await couponDiscount(p.coupon_code, subtotal);
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
    const card = payment.type === 'card';
    // The adapter needs the full record with its secret keys, not the customer-safe copy.
    if (card) cardMethod = (await records('payments')).find((m) => m.id === payment.id);
    await run(
      'INSERT INTO order_details(order_id,discount,coupon_code,payment_name,payment_type,payment_instructions,payment_status,transaction_id,payer_name,payer_account,proof_id,payment_details,payment_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      oid,
      discount,
      coupon?.code || '',
      payment.name,
      payment.type,
      payment.instructions || '',
      card ? 'pending' : online ? 'submitted' : 'due',
      online && !card ? p.payment!.transaction_id : '',
      online && !card ? p.payment!.payer_name : '',
      online && !card ? p.payment!.payer_account : '',
      online && !card ? p.payment!.proof_id || null : null,
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
  // Card orders are charged after the order (and its stock) is reserved; a decline cancels it again.
  let redirectUrl: string | undefined;
  if (created && cardMethod)
    redirectUrl = (await chargeCardOrder(result, cardMethod, p.payment!.card_token!)).redirect_url;
  if (created) {
    const o = result;
    const d = (await one(
      'SELECT payment_type,payment_name,payment_status FROM order_details WHERE order_id=?',
      o.id,
    ))!;
    const amount = money(o.total);
    const pendingNote =
      d.payment_type === 'card'
        ? d.payment_status === 'paid'
          ? ' · paid by card'
          : ' · card payment pending'
        : isOnline(d.payment_type)
          ? ' · payment under review'
          : '';
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
    if (isOnline(d.payment_type) && d.payment_type !== 'card')
      await notify(await adminsWith('payments'), {
        type: 'payment',
        title: 'Payment to verify',
        body: `${o.reference} · ${d.payment_name} · ${amount}`,
        link: '/admin?tab=payments',
      });
  }
  res.status(201).json({
    ...(await serializeOrder(result, req)),
    ...(redirectUrl ? { payment_redirect_url: redirectUrl } : {}),
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
  res.json(await Promise.all(rows.map(async (o) => await serializeOrder(o, req))));
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
            'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id',
          )
        : await all(
            'SELECT p.*,o.name outlet_name FROM products p JOIN outlets o ON o.id=p.outlet_id WHERE p.outlet_id=?',
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
async function saveProduct(req: AuthRequest, res: Response, editing: boolean) {
  const p = await productSchema.parseAsync(req.body);
  const pid = editing ? String(req.params.id) : id();
  if (editing) {
    const old = await one('SELECT * FROM products WHERE id=?', pid);
    if (!old) fail('Product not found.', 404);
    await allowedProduct(req, old);
  }
  await allowedProduct(req, p);
  if (!(await one('SELECT id FROM outlets WHERE id=?', p.outlet_id))) fail('Outlet not found.');
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
    await run(
      'UPDATE products SET outlet_id=?,name=?,description=?,category=?,price=?,stock=?,unit=?,location_id=?,discount=?,deal=?,images=?,includes=?,excludes=?,delivery_minutes=?,active=? WHERE id=?',
      ...values,
      pid,
    );
  else await run('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', pid, ...values);
  res.json(await product((await one('SELECT * FROM products WHERE id=?', pid))!));
}
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
    const p = await one('SELECT * FROM products WHERE id=?', String(req.params.id));
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
  res.json(o ? { ...o, ...(await outletSettings(o.id)) } : null);
});
app.use('/api/admin', requireRole('admin'));
const locationSchema = z.object({
  name: str(150),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
app.post(
  '/api/admin/locations',
  atomicRoute(async (req, res) => {
    const p = await locationSchema.parseAsync(req.body);
    const lid = id();
    await run('INSERT INTO locations VALUES(?,?,?,?)', lid, p.name, p.lat, p.lng);
    res.status(201).json({ id: lid, ...p });
  }),
);
app.put(
  '/api/admin/locations/:id',
  atomicRoute(async (req, res) => {
    const p = await locationSchema.parseAsync(req.body);
    if (!(await one('SELECT id FROM locations WHERE id=?', String(req.params.id))))
      fail('Delivery area not found.', 404);
    await run(
      'UPDATE locations SET name=?,lat=?,lng=? WHERE id=?',
      p.name,
      p.lat,
      p.lng,
      String(req.params.id),
    );
    res.json({ id: String(req.params.id), ...p });
  }),
);
app.get('/api/admin/outlets', async (_req, res) =>
  res.json(
    await Promise.all(
      (await all('SELECT * FROM outlets')).map(async (o) => ({
        ...o,
        ...(await outletSettings(o.id)),
      })),
    ),
  ),
);
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
});
async function saveOutlet(req: AuthRequest, res: Response, edit: boolean) {
  const p = await outletSchema.parseAsync(req.body);
  const oid = edit ? String(req.params.id) : id();
  const old = edit ? await one('SELECT * FROM outlets WHERE id=?', oid) : null;
  if (edit && !old) fail('Outlet not found.', 404);
  if (!edit && !p.password) fail('Set a password for the outlet account.');
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
    if (p.commission_rate !== undefined)
      await saveOutletSettings(oid, { commission_rate: p.commission_rate });
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
app.get('/api/admin/riders', async (_req, res) =>
  res.json(
    await Promise.all(
      (
        await all(
          "SELECT u.id,u.name,u.email,u.phone,u.address,u.location_id,u.login_id,u.active,u.created_at,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status NOT IN ('delivered','cancelled')) active_orders,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status='delivered') delivered FROM users u WHERE u.role='rider' ORDER BY u.created_at DESC",
        )
      ).map(async (r) => {
        const s = await riderSettings(r.id);
        return {
          ...r,
          commission_type: s.commission_type,
          commission_value: s.commission_value,
          commission_base: s.commission_base,
          ...(await riderBalance(r.id)),
        };
      }),
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
  ...commissionSchema,
});
async function saveRider(req: AuthRequest, res: Response, edit: boolean) {
  const p = await riderSchema.parseAsync(req.body);
  const uid = edit ? String(req.params.id) : id();
  if (edit && !(await one("SELECT id FROM users WHERE id=? AND role='rider'", uid)))
    fail('Rider not found.', 404);
  if (!edit && !p.password) fail('Set a rider password.');
  if (p.commission_type === 'percent' && p.commission_value > 100)
    fail('A percentage commission must be 100 or less.');
  await transaction(async () => await saveRiderAccount(p, uid, edit));
  res.json(await publicUser((await one('SELECT * FROM users WHERE id=?', uid))!));
}
async function saveRiderAccount(p: z.infer<typeof riderSchema>, uid: string, edit: boolean) {
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
  await saveRiderSettings(uid, p);
}
app.post(
  '/api/admin/riders',
  atomicRoute(async (req: AuthRequest, res) => await saveRider(req, res, false)),
);
app.put(
  '/api/admin/riders/:id',
  atomicRoute(async (req: AuthRequest, res) => await saveRider(req, res, true)),
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
    if (!(await one('SELECT id FROM outlets WHERE id=?', String(req.params.id))))
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
app.put(
  '/api/admin/ad',
  atomicRoute(async (req, res) => {
    const p = await z
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
      .parseAsync(req.body);
    await run(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      'ad',
      JSON.stringify(p),
    );
    res.json(p);
  }),
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
