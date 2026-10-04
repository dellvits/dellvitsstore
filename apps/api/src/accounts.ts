import type { Express, RequestHandler } from 'express';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { atomicRoute } from './atomic-route.js';
import { all, one, run, afterCommit, type Row } from './db.js';
import {
  requireRole,
  hashPassword,
  verifyPassword,
  publicUser,
  newSession,
  tokenHash,
  type AuthRequest,
} from './security.js';
import { range, between } from './range.js';
import {
  sendMail,
  deliver,
  mailReady,
  smtpSettings,
  saveSmtpSettings,
  verificationEmail,
  passwordResetEmail,
  passwordChangedEmail,
  welcomeEmail,
  testEmail,
} from './mail.js';
import { objects } from './storage.js';
import { deleteSupport } from './support.js';

/**
 * Customer accounts
 *
 * A new customer has no session until they enter the 6-digit code emailed to them. Signing in
 * before that is refused and sends a fresh code. Outlets, riders and administrators are created by
 * an administrator and are not asked to verify.
 */
export const CODE_MINUTES = 10;
/** Seconds a customer waits before asking for another code. */
const RESEND_SECONDS = 60;
/** Codes one account can be sent in an hour, however they are requested. */
const SENDS_PER_HOUR = 5;
const HOUR = 3600000;
/** Wrong codes allowed before a new one must be requested. */
const MAX_ATTEMPTS = 5;

const now = () => new Date().toISOString();
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const codeHash = (userId: string, code: string) => tokenHash(userId + ':' + code);
export const needsVerification = (u: Row) => u.role === 'customer' && !u.email_verified_at;

/**
 * Emails a fresh code, replacing any earlier one. The server enforces two limits per account: a
 * wait between codes, and a number of codes per hour. Inside either limit nothing is sent and
 * `retry_in` says how many seconds remain. `force` (an administrator) skips the limits.
 * The email goes out only after the surrounding transaction commits.
 */
export async function sendVerificationCode(u: Row, force = false) {
  const old = await one('SELECT sent_at,sends,window_at FROM email_codes WHERE user_id=?', u.id);
  const at = Date.now();
  const w = codeWindow(old, at, force);
  if (!w.allowed) return w.result;
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  await run(
    'INSERT INTO email_codes(user_id,code_hash,expires_at,attempts,sent_at,sends,window_at) VALUES(?,?,?,0,?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at,sends=excluded.sends,window_at=excluded.window_at',
    u.id,
    codeHash(u.id, code),
    new Date(at + CODE_MINUTES * 60000).toISOString(),
    new Date(at).toISOString(),
    w.sends,
    w.window,
  );
  await afterCommit(async () => {
    await sendMail(
      verificationEmail({ to: u.email, name: u.name, code, minutes: CODE_MINUTES }),
    );
  });
  return w.result;
}
/**
 * The two per-account limits on emailed codes, worked out from the last code sent: a wait
 * between codes and a number of codes per hour. `force` (an administrator) skips them.
 */
function codeWindow(old: Row | undefined, at: number, force: boolean) {
  // The hour being counted carries on from the previous code unless it has run out.
  const windowStart = old ? Date.parse(old.window_at || old.sent_at) : at;
  const inWindow = !!old && at - windowStart < HOUR;
  const sent = inWindow ? old.sends : 0;
  if (old && !force) {
    const cooldown = RESEND_SECONDS - (at - Date.parse(old.sent_at)) / 1000;
    const hourly = sent >= SENDS_PER_HOUR ? (windowStart + HOUR - at) / 1000 : 0;
    if (cooldown > 0 || hourly > 0)
      return {
        allowed: false as const,
        result: { sent: false, limited: hourly > 0, retry_in: Math.ceil(Math.max(cooldown, hourly)) },
      };
  }
  const window = new Date(inWindow ? windowStart : at).toISOString();
  return {
    allowed: true as const,
    sends: sent + 1,
    window,
    result: {
      sent: true,
      limited: false,
      // After the last code of the hour, the next one waits for the hour to end.
      retry_in:
        sent + 1 >= SENDS_PER_HOUR
          ? Math.ceil((Date.parse(window) + HOUR - at) / 1000)
          : RESEND_SECONDS,
    },
  };
}

/**
 * Forgot password (customers only)
 *
 * 1. The customer asks for a code; it is emailed under the same limits as sign-up codes.
 * 2. A correct code is swapped for a random reset token that lasts RESET_MINUTES. The code is
 *    then spent, so it cannot be tried again.
 * 3. The token sets the new password once. Every device is signed out and the customer is told
 *    by email. Only hashes of the code and the token are stored.
 * Outlets, riders and administrators ask an administrator instead.
 */
const RESET_MINUTES = 15;
const resetCodeHash = (userId: string, code: string) => tokenHash('reset:' + userId + ':' + code);
/** Compares two hex hashes in constant time. */
const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** The customer a reset is for: blocked and deleted accounts cannot reset. */
const resetAccount = (email: string) =>
  one(
    "SELECT * FROM users WHERE email=? AND role='customer' AND active=1 AND deleted_at IS NULL",
    email,
  );
async function sendResetCode(u: Row) {
  const old = await one('SELECT sent_at,sends,window_at FROM password_resets WHERE user_id=?', u.id);
  const at = Date.now();
  const w = codeWindow(old, at, false);
  if (!w.allowed) return w.result;
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  // A new code also cancels any reset token from an earlier code.
  await run(
    'INSERT INTO password_resets(user_id,code_hash,expires_at,attempts,sent_at,sends,window_at,token_hash,token_expires_at) VALUES(?,?,?,0,?,?,?,NULL,NULL) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at,sends=excluded.sends,window_at=excluded.window_at,token_hash=NULL,token_expires_at=NULL',
    u.id,
    resetCodeHash(u.id, code),
    new Date(at + CODE_MINUTES * 60000).toISOString(),
    new Date(at).toISOString(),
    w.sends,
    w.window,
  );
  await afterCommit(async () => {
    await sendMail(passwordResetEmail({ to: u.email, name: u.name, code, minutes: CODE_MINUTES }));
  });
  return w.result;
}
/** How long a wait is, for a message: "45 seconds", "12 minutes". */
const waitText = (seconds: number) =>
  seconds < 90
    ? `${seconds} second${seconds === 1 ? '' : 's'}`
    : `${Math.ceil(seconds / 60)} minutes`;
/** The answer for a customer who must verify before going further; the client opens the code page. */
export const verifyResponse = (u: Row, error: string, retry_in: number) => ({
  error,
  code: 'verify_email',
  email: u.email,
  retry_in,
});
/** Signs a verified user in on this browser, taking over any orders placed as a guest in it. */
export async function startSession(req: AuthRequest, res: Parameters<RequestHandler>[1], u: Row) {
  if (req.sessionHash) {
    if (u.role === 'customer')
      await run(
        'UPDATE orders SET user_id=?,guest_session=NULL WHERE guest_session=? AND user_id IS NULL',
        u.id,
        req.sessionHash,
      );
    await run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
  }
  await run('UPDATE users SET last_login_at=? WHERE id=?', now(), u.id);
  const token = await newSession(req, res, u.id);
  return {
    user: await publicUser((await one('SELECT * FROM users WHERE id=?', u.id))!),
    ...(req.headers['x-client'] === 'mobile' ? { token } : {}),
  };
}

const emailField = z
  .email()
  .max(200)
  .transform((s) => s.toLowerCase());
const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[\d ()-]{7,20}$/, 'Enter a valid phone number.');
const areaField = z
  .string()
  .refine(
    async (v) => !v || !!(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', v)),
    'Choose a supported delivery area.',
  );
const customerFields = {
  name: z.string().trim().min(1).max(100),
  email: emailField,
  phone: phoneField,
  address: z.string().trim().max(500).default(''),
  location_id: areaField.default(''),
  admin_notes: z.string().trim().max(2000).default(''),
};
const open = "status NOT IN ('delivered','cancelled')";

export function installAccounts(app: Express, authLimit: RequestHandler) {
  const anyone = requireRole('customer', 'admin', 'outlet', 'rider');
  /** The devices the account is signed in on. A session is named by the start of its hash. */
  app.get('/api/profile/sessions', anyone, async (req: AuthRequest, res) =>
    res.json(
      (
        await all(
          'SELECT token_hash,created_at,user_agent,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC NULLS LAST',
          req.user!.id,
          now(),
        )
      ).map((s) => ({
        id: s.token_hash.slice(0, 16),
        current: s.token_hash === req.sessionHash,
        created_at: s.created_at,
        user_agent: s.user_agent,
        expires_at: s.expires_at,
      })),
    ),
  );
  /** Signs out one other device, or with no id, every other device. */
  app.delete(
    ['/api/profile/sessions', '/api/profile/sessions/:id'],
    anyone,
    atomicRoute(async (req: AuthRequest, res) => {
      const id = req.params.id === undefined ? '' : String(req.params.id);
      if (id && !/^[0-9a-f]{16}$/.test(id)) fail('Session not found.', 404);
      const { changes } = await run(
        'DELETE FROM sessions WHERE user_id=? AND token_hash<>? AND token_hash LIKE ?',
        req.user!.id,
        req.sessionHash,
        id + '%',
      );
      if (id && !changes) fail('Session not found.', 404);
      res.json({ ok: true, sessions: changes });
    }),
  );
  /* ---------- Email verification ---------- */
  app.post(
    '/api/auth/verify-email',
    authLimit,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({ email: emailField, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') })
        .parse(req.body);
      const u = await one("SELECT * FROM users WHERE email=? AND role='customer'", p.email);
      if (!u || !u.active) fail('That code is not correct. Check the email and try again.');
      if (u.email_verified_at) fail('This email is already verified. Log in to continue.', 409);
      const c = await one('SELECT * FROM email_codes WHERE user_id=?', u.id);
      if (!c) fail('Request a new code to continue.');
      if (c.attempts >= MAX_ATTEMPTS)
        fail('Too many incorrect attempts. Request a new code.', 429);
      if (c.expires_at < now()) fail('This code has expired. Request a new one.');
      if (c.code_hash !== codeHash(u.id, p.code)) {
        // Answered without throwing so the failed attempt is committed and counted.
        await run('UPDATE email_codes SET attempts=attempts+1 WHERE user_id=?', u.id);
        const left = MAX_ATTEMPTS - c.attempts - 1;
        return res.status(400).json({
          error: left
            ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`
            : 'Too many incorrect attempts. Request a new code.',
        });
      }
      await run('UPDATE users SET email_verified_at=? WHERE id=?', now(), u.id);
      await run('DELETE FROM email_codes WHERE user_id=?', u.id);
      await afterCommit(async () => {
        await sendMail(welcomeEmail({ to: u.email, name: u.name }));
      });
      res.json(await startSession(req, res, u));
    }),
  );
  app.post(
    '/api/auth/resend-code',
    authLimit,
    atomicRoute(async (req, res) => {
      const p = z.object({ email: emailField }).parse(req.body);
      const u = await one("SELECT * FROM users WHERE email=? AND role='customer'", p.email);
      // An address without a pending account gets the answer a first request would.
      if (!u || !u.active || u.email_verified_at)
        return res.json({ ok: true, retry_in: RESEND_SECONDS });
      const r = await sendVerificationCode(u);
      if (!r.sent)
        return res.status(429).json({
          error: r.limited
            ? `Too many codes requested. You can ask for another in ${waitText(r.retry_in)}.`
            : `Please wait ${waitText(r.retry_in)} before asking for another code.`,
          retry_in: r.retry_in,
        });
      res.json({ ok: true, retry_in: r.retry_in });
    }),
  );

  /* ---------- Forgot password ---------- */
  const codeLimited = (r: { limited: boolean; retry_in: number }) => ({
    error: r.limited
      ? `Too many codes requested. You can ask for another in ${waitText(r.retry_in)}.`
      : `Please wait ${waitText(r.retry_in)} before asking for another code.`,
    retry_in: r.retry_in,
  });
  app.post(
    '/api/auth/forgot-password',
    authLimit,
    atomicRoute(async (req, res) => {
      const p = z.object({ email: emailField }).parse(req.body);
      if (!(await mailReady()))
        fail('Password reset is unavailable because email is not set up yet. Please contact support.', 503);
      const u = await resetAccount(p.email);
      // An address without a customer account gets the answer a real one would.
      if (!u) return res.json({ ok: true, retry_in: RESEND_SECONDS });
      const r = await sendResetCode(u);
      if (!r.sent) return res.status(429).json(codeLimited(r));
      res.json({ ok: true, retry_in: r.retry_in });
    }),
  );
  app.post(
    '/api/auth/forgot-password/verify',
    authLimit,
    atomicRoute(async (req, res) => {
      const p = z
        .object({ email: emailField, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') })
        .parse(req.body);
      const u = await resetAccount(p.email);
      const c = u && (await one('SELECT * FROM password_resets WHERE user_id=?', u.id));
      if (!u || !c?.code_hash) fail('That code is not correct or has been used. Request a new code.');
      if (c.attempts >= MAX_ATTEMPTS)
        fail('Too many incorrect attempts. Request a new code.', 429);
      if (c.expires_at < now()) fail('This code has expired. Request a new one.');
      if (!sameHash(c.code_hash, resetCodeHash(u.id, p.code))) {
        // Answered without throwing so the failed attempt is committed and counted.
        await run('UPDATE password_resets SET attempts=attempts+1 WHERE user_id=?', u.id);
        const left = MAX_ATTEMPTS - c.attempts - 1;
        return res.status(400).json({
          error: left
            ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`
            : 'Too many incorrect attempts. Request a new code.',
        });
      }
      // The code is spent; only the token it was swapped for can set the password now.
      const token = randomBytes(32).toString('hex');
      await run(
        'UPDATE password_resets SET code_hash=NULL,attempts=0,token_hash=?,token_expires_at=? WHERE user_id=?',
        tokenHash(token),
        new Date(Date.now() + RESET_MINUTES * 60000).toISOString(),
        u.id,
      );
      res.json({ reset_token: token, minutes: RESET_MINUTES });
    }),
  );
  app.post(
    '/api/auth/forgot-password/reset',
    authLimit,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          email: emailField,
          reset_token: z.string().regex(/^[0-9a-f]{64}$/, 'This reset has expired. Start again.'),
          password: z.string().min(10, 'Use at least 10 characters.').max(100),
        })
        .parse(req.body);
      const u = await resetAccount(p.email);
      const c = u && (await one('SELECT * FROM password_resets WHERE user_id=?', u.id));
      if (
        !u ||
        !c?.token_hash ||
        !sameHash(c.token_hash, tokenHash(p.reset_token)) ||
        c.token_expires_at < now()
      )
        fail('This reset has expired. Start again to get a new code.');
      if (verifyPassword(p.password, u.password_hash))
        fail('Choose a new password, not the one you used before.');
      // The emailed code also proves the address belongs to them.
      await run(
        'UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,?) WHERE id=?',
        hashPassword(p.password),
        now(),
        u.id,
      );
      // Keeps the row so the hourly code limit still counts, but nothing in it works any more.
      await run(
        'UPDATE password_resets SET code_hash=NULL,token_hash=NULL,token_expires_at=NULL WHERE user_id=?',
        u.id,
      );
      await run('DELETE FROM email_codes WHERE user_id=?', u.id);
      // Whoever knew the old password is signed out everywhere.
      await run('DELETE FROM sessions WHERE user_id=?', u.id);
      await afterCommit(async () => {
        await sendMail(passwordChangedEmail({ to: u.email, name: u.name }));
      });
      res.json(await startSession(req, res, u));
    }),
  );

  /* ---------- Email (SMTP) settings ---------- */
  const emailAdmin = requireRole('admin');
  /** The details in use, never the password itself. */
  const emailView = async () => {
    const s = await smtpSettings();
    return s
      ? { host: s.host, port: s.port, secure: s.secure, user: s.user, from: s.from, has_password: !!s.pass, source: s.source }
      : { host: '', port: 587, secure: false, user: '', from: '', has_password: false, source: 'none' };
  };
  app.get('/api/admin/email-settings', emailAdmin, async (_req, res) => res.json(await emailView()));
  app.put(
    '/api/admin/email-settings',
    emailAdmin,
    atomicRoute(async (req, res) => {
      const p = z
        .object({
          // Empty clears the saved details, falling back to the environment if it has any.
          host: z
            .string()
            .trim()
            .max(200)
            .regex(/^[a-z0-9.-]*$/i, 'Enter the server name only, such as smtp.gmail.com.'),
          port: z.number().int().min(1).max(65535),
          secure: z.boolean(),
          user: z.string().trim().max(200),
          // Left out or empty keeps the password already saved.
          pass: z.string().max(500).optional(),
          from: z.string().trim().max(200),
        })
        .parse(req.body);
      const old = await smtpSettings();
      await saveSmtpSettings({
        host: p.host,
        port: p.port,
        secure: p.secure,
        user: p.user,
        pass: p.pass || (old?.source === 'saved' ? old.pass : ''),
        from: p.from,
      });
      res.json(await emailView());
    }),
  );
  /** Sends a real message with the details in use and reports the mail server's answer. */
  app.post('/api/admin/email-settings/test', emailAdmin, authLimit, async (req, res) => {
    const p = z.object({ to: emailField }).parse(req.body);
    const smtp = await smtpSettings();
    if (!smtp) fail('Save your SMTP details first.');
    try {
      await deliver(smtp, testEmail(p.to));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: 'The mail server refused: ' + String((error as Error).message || 'unknown error').slice(0, 300),
      });
    }
  });
  /** Emails that the administrator sets off must not fail silently. */
  const requireMail = async () => {
    if (!(await mailReady()))
      fail('Email is not set up yet. Add your SMTP details in Store settings, then try again.');
  };

  /* ---------- Customer management ---------- */
  const admin = requireRole('admin');
  const customer = async (id: string) => {
    const u = await one(
      "SELECT * FROM users WHERE id=? AND role='customer' AND deleted_at IS NULL",
      id,
    );
    if (!u) fail('Customer not found.', 404);
    return u;
  };
  /** Every customer with their order history and the figures for the time frame: one query. */
  app.get('/api/admin/customers', admin, async (req, res) => {
    const r = range(req);
    res.json(
      await all(
        `SELECT u.id,u.name,u.email,u.phone,u.address,u.location_id,u.active,u.created_at,u.email_verified_at,u.last_login_at,u.admin_notes,(SELECT COUNT(*) FROM orders WHERE user_id=u.id) orders,(SELECT COUNT(*) FROM orders WHERE user_id=u.id AND ${open}) active_orders,(SELECT COUNT(*) FROM orders WHERE user_id=u.id AND status='cancelled') cancelled,(SELECT COALESCE(SUM(total),0) FROM orders WHERE user_id=u.id AND status='delivered') spent,(SELECT MAX(created_at) FROM orders WHERE user_id=u.id) last_order_at,(SELECT COUNT(*) FROM orders WHERE user_id=u.id AND ${between('created_at')}) orders_range,(SELECT COALESCE(SUM(total),0) FROM orders WHERE user_id=u.id AND status='delivered' AND ${between('created_at')}) spent_range,(SELECT sent_at FROM email_codes WHERE user_id=u.id) code_sent_at FROM users u WHERE u.role='customer' AND u.deleted_at IS NULL ORDER BY u.created_at DESC`,
        r.from,
        r.to,
        r.from,
        r.to,
      ),
    );
  });
  /** A customer's most recent orders, for the detail view. */
  app.get('/api/admin/customers/:id/orders', admin, async (req, res) => {
    const u = await customer(String(req.params.id));
    res.json(
      await all(
        'SELECT o.id,o.reference,o.status,o.total,o.created_at,t.name outlet_name,d.payment_name,d.payment_status FROM orders o LEFT JOIN outlets t ON t.id=o.outlet_id LEFT JOIN order_details d ON d.order_id=o.id WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 25',
        u.id,
      ),
    );
  });
  app.post(
    '/api/admin/customers',
    admin,
    atomicRoute(async (req, res) => {
      const p = await z
        .object({
          ...customerFields,
          password: z.string().min(10).max(100),
          // An account the administrator vouches for skips the email code.
          verified: z.boolean().default(true),
        })
        .parseAsync(req.body);
      if (await one('SELECT id FROM users WHERE email=?', p.email))
        fail('An account already uses this email.', 409);
      if (!p.verified) await requireMail();
      const uid = randomUUID();
      await run(
        'INSERT INTO users(id,name,email,phone,address,location_id,password_hash,role,created_at,email_verified_at,admin_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        uid,
        p.name,
        p.email,
        p.phone,
        p.address,
        p.location_id || null,
        hashPassword(p.password),
        'customer',
        now(),
        p.verified ? now() : null,
        p.admin_notes,
      );
      if (!p.verified) await sendVerificationCode((await one('SELECT * FROM users WHERE id=?', uid))!);
      res.status(201).json({ id: uid });
    }),
  );
  app.put(
    '/api/admin/customers/:id',
    admin,
    atomicRoute(async (req, res) => {
      const p = await z
        .object({ ...customerFields, password: z.string().min(10).max(100).optional() })
        .parseAsync(req.body);
      const u = await customer(String(req.params.id));
      if (await one('SELECT id FROM users WHERE email=? AND id<>?', p.email, u.id))
        fail('Another account already uses this email.', 409);
      await run(
        'UPDATE users SET name=?,email=?,phone=?,address=?,location_id=?,admin_notes=? WHERE id=?',
        p.name,
        p.email,
        p.phone,
        p.address,
        p.location_id || null,
        p.admin_notes,
        u.id,
      );
      if (p.password) {
        // A new password signs the customer out everywhere.
        await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(p.password), u.id);
        await run('DELETE FROM sessions WHERE user_id=?', u.id);
      }
      res.json({ ok: true });
    }),
  );
  /** The switches: block or allow sign-in, and mark the email verified or not. */
  app.patch(
    '/api/admin/customers/:id',
    admin,
    atomicRoute(async (req, res) => {
      const p = z
        .object({ active: z.boolean().optional(), verified: z.boolean().optional() })
        .parse(req.body);
      const u = await customer(String(req.params.id));
      if (p.active !== undefined)
        await run('UPDATE users SET active=? WHERE id=?', Number(p.active), u.id);
      if (p.verified !== undefined) {
        await run(
          'UPDATE users SET email_verified_at=? WHERE id=?',
          p.verified ? u.email_verified_at || now() : null,
          u.id,
        );
        if (p.verified) await run('DELETE FROM email_codes WHERE user_id=?', u.id);
      }
      // A blocked or unverified customer cannot stay signed in.
      if (p.active === false || p.verified === false)
        await run('DELETE FROM sessions WHERE user_id=?', u.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/admin/customers/:id/send-code',
    admin,
    atomicRoute(async (req, res) => {
      const u = await customer(String(req.params.id));
      if (u.email_verified_at) fail('This email is already verified.');
      await requireMail();
      await sendVerificationCode(u, true);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/admin/customers/:id/sign-out',
    admin,
    atomicRoute(async (req, res) => {
      const u = await customer(String(req.params.id));
      const { changes } = await run('DELETE FROM sessions WHERE user_id=?', u.id);
      res.json({ ok: true, sessions: changes });
    }),
  );
  /**
   * Deleting a customer never loses an order. With no orders the account is removed outright. With
   * past orders it is closed and its personal details erased; the orders keep the delivery details
   * they were placed with. A customer with an order in progress cannot be deleted.
   */
  app.delete(
    '/api/admin/customers/:id',
    admin,
    atomicRoute(async (req, res) => {
      const u = await customer(String(req.params.id));
      const orders = (await one(
        `SELECT COUNT(*) total,(SELECT COUNT(*) FROM orders WHERE user_id=? AND ${open}) active FROM orders WHERE user_id=?`,
        u.id,
        u.id,
      ))!;
      if (orders.active)
        fail(
          `This customer has ${orders.active} order${orders.active === 1 ? '' : 's'} in progress. Finish or cancel ${orders.active === 1 ? 'it' : 'them'} first.`,
          409,
        );
      for (const table of ['sessions', 'notifications', 'push_subscriptions', 'email_codes', 'password_resets'])
        await run(`DELETE FROM ${table} WHERE user_id=?`, u.id);
      await deleteSupport(u.id);
      if (orders.total) {
        await run(
          "UPDATE users SET name='Deleted customer',email=?,phone='',address='',location_id=NULL,password_hash=?,active=0,admin_notes='',deleted_at=? WHERE id=?",
          `deleted-${u.id}@deleted.invalid`,
          hashPassword(randomUUID()),
          now(),
          u.id,
        );
        return res.json({ ok: true, erased: true });
      }
      // Receipts uploaded for orders that were never placed go with the account.
      const proofs = await all('SELECT filename FROM payment_proofs WHERE user_id=?', u.id);
      await run('DELETE FROM payment_proofs WHERE user_id=?', u.id);
      await run('DELETE FROM users WHERE id=?', u.id);
      await afterCommit(async () => {
        for (const p of proofs) await objects.delete('proofs/' + p.filename);
      });
      res.json({ ok: true, erased: false });
    }),
  );
}
