import { atomicRoute } from './atomic-route.js';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, one, run, afterCommit, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify, adminsWith } from './notifications.js';
import { can, records } from './platform.js';
import { saveRiderSettings, vehicleTypes, payoutMethods, riderDefaults } from './riders.js';
import { saveOutletSettings } from './finance.js';
import { sendMail, noticeEmail } from './mail.js';

/**
 * Riders and outlets who sign up themselves. The account starts with the role 'applicant', so no
 * rider or outlet feature, list or dispatch sees it:
 *   1. it signs up as a rider or an outlet and verifies its email (like a customer),
 *   2. it sends the details its kind needs (draft → pending),
 *   3. an administrator approves it, which makes it a real rider or outlet with its own ID, or
 *      sends it back with a note to correct (rejected → pending again).
 * Until then the website and app show the form or a "not approved yet" message.
 * Administrators who manage riders review rider applications; those who manage outlets, outlets.
 */
const now = () => new Date().toISOString();
const id = () => randomUUID();
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const str = (n = 200) => z.string().trim().min(1).max(n);
const optional = (n = 200) => z.string().trim().max(n).default('');
const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d ()-]{7,20}$/, 'Enter a valid phone number.');
// Pakistani CNIC: 13 digits, written with or without dashes (35202-1234567-1).
const cnic = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{7}-?\d$/, 'Enter the 13-digit CNIC number, e.g. 35202-1234567-1.')
  .transform((v) => v.replace(/\D/g, '').replace(/^(\d{5})(\d{7})(\d)$/, '$1-$2-$3'));
const hour = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).default('');
const area = z
  .string()
  .refine(
    async (v) => !!(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', v)),
    'Choose a supported delivery area.',
  );

/** What a rider sends before approval. */
const riderDetails = z
  .object({
    cnic,
    license_number: optional(40),
    vehicle_type: z.enum(vehicleTypes),
    vehicle_number: optional(30),
    emergency_name: str(100),
    emergency_phone: phone,
    // How the rider would like to earn per delivery; the team sets the amount when approving.
    commission_type: z.enum(['fixed', 'percent']).default('fixed'),
    payout_method: z.enum(payoutMethods).default('cash'),
    payout_bank: optional(100),
    payout_title: optional(100),
    payout_account: optional(40),
    about: optional(500),
  })
  .superRefine((d, ctx) => {
    // Motor vehicles need their registration number and a driving licence.
    if (['motorbike', 'car', 'rickshaw'].includes(d.vehicle_type)) {
      if (!d.vehicle_number) ctx.addIssue({ code: 'custom', path: ['vehicle_number'], message: 'Enter the vehicle number.' });
      if (!d.license_number) ctx.addIssue({ code: 'custom', path: ['license_number'], message: 'Enter your driving licence number.' });
    }
    if (d.payout_method !== 'cash' && !d.payout_account)
      ctx.addIssue({ code: 'custom', path: ['payout_account'], message: 'Enter the account number for your earnings.' });
  });

/** What an outlet sends before approval. */
const outletDetails = z.object({
  business_name: str(150),
  category: str(100).refine(
    async (v) => (await records('categories', true)).some((c) => c.name === v),
    'Choose an active category.',
  ),
  owner_name: str(100),
  owner_cnic: cnic,
  business_phone: phone,
  address: str(500),
  location_id: area,
  // The shop's map position, when the applicant shares it; otherwise its area's centre.
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  description: optional(500),
  opens_at: hour,
  closes_at: hour,
  payout_bank: optional(100),
  payout_title: optional(100),
  payout_account: optional(40),
});

/** The next free ID of a kind, e.g. DRV-007, counting riders' and outlets' sign-in IDs. */
async function nextLoginId(prefix: 'DRV' | 'DLV') {
  const rows = await all(
    'SELECT login_id code FROM users WHERE login_id LIKE ? UNION SELECT customer_id FROM outlets WHERE customer_id LIKE ?',
    prefix + '-%',
    prefix + '-%',
  );
  const n = Math.max(0, ...rows.map((r) => Number(String(r.code).slice(prefix.length + 1)) || 0)) + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

const permissionFor = (kind: string) => (kind === 'rider' ? 'riders' : 'outlets');

function view(a: Row) {
  return {
    kind: a.kind,
    status: a.status,
    details: JSON.parse(a.details || '{}'),
    note: a.note,
    created_at: a.created_at,
    submitted_at: a.submitted_at,
    reviewed_at: a.reviewed_at,
  };
}

export function installPartners(app: Express) {
  const applicant = requireRole('applicant');
  const admin = requireRole('admin');

  /** The applicant's own application: what to fill in, or where it stands. */
  app.get('/api/partner/application', applicant, async (req: AuthRequest, res) => {
    const a = await one('SELECT * FROM partner_applications WHERE user_id=?', req.user!.id);
    if (!a) fail('No application was found for this account.', 404);
    res.json(view(a));
  });

  /** Sends the details for review. Allowed again after the team sends it back, and while it waits. */
  app.put(
    '/api/partner/application',
    applicant,
    atomicRoute(async (req: AuthRequest, res) => {
      const a = await one('SELECT * FROM partner_applications WHERE user_id=?', req.user!.id);
      if (!a) fail('No application was found for this account.', 404);
      if (a.status === 'approved') fail('This application is already approved. Sign in again to continue.', 409);
      const details = await (a.kind === 'rider' ? riderDetails : outletDetails).parseAsync(req.body);
      const first = a.status !== 'pending';
      await run(
        "UPDATE partner_applications SET details=?,status='pending',note='',submitted_at=? WHERE user_id=?",
        JSON.stringify(details),
        now(),
        req.user!.id,
      );
      // The team hears about a new or corrected application, not every later edit.
      if (first)
        await notify(await adminsWith(permissionFor(a.kind)), {
          type: 'message',
          title: `New ${a.kind} application`,
          body: `${req.user!.name} sent their details for review.`,
          link: '/admin?tab=applications',
        });
      res.json(view((await one('SELECT * FROM partner_applications WHERE user_id=?', req.user!.id))!));
    }),
  );

  /** Applications the administrator may review, newest first, with the account they belong to. */
  app.get('/api/admin/applications', admin, async (req: AuthRequest, res) => {
    const kinds = ['rider', 'outlet'];
    const allowed = [];
    for (const k of kinds) if (await can(req.user, permissionFor(k))) allowed.push(k);
    if (!allowed.length) return res.json([]);
    const rows = await all(
      `SELECT a.*,u.name,u.email,u.phone,u.address,u.location_id,u.email_verified_at,u.role,u.login_id,u.active,u.created_at registered_at,r.name reviewed_by_name
       FROM partner_applications a JOIN users u ON u.id=a.user_id LEFT JOIN users r ON r.id=a.reviewed_by
       WHERE a.kind IN (${allowed.map(() => '?').join(',')}) AND u.deleted_at IS NULL
       ORDER BY COALESCE(a.submitted_at,a.created_at) DESC LIMIT 1000`,
      ...allowed,
    );
    res.json(
      rows.map((r) => ({
        user_id: r.user_id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        address: r.address,
        location_id: r.location_id,
        email_verified: !!r.email_verified_at,
        // Blocked by an administrator: the account cannot sign in.
        active: !!r.active,
        login_id: r.login_id,
        registered_at: r.registered_at,
        reviewed_by_name: r.reviewed_by_name,
        ...view(r),
      })),
    );
  });

  /**
   * Changes where an application stands without approving or sending it back: confirm the email
   * for someone whose code never arrived, return it to "waiting for details" or "waiting for
   * review", or block and unblock the account. Approving and sending back have their own routes.
   */
  app.patch(
    '/api/admin/applications/:id',
    admin,
    atomicRoute(async (req: AuthRequest, res) => {
      const uid = String(req.params.id);
      const p = z
        .object({
          email_verified: z.boolean().optional(),
          status: z.enum(['draft', 'pending']).optional(),
          active: z.boolean().optional(),
        })
        .parse(req.body);
      const a = await one(
        "SELECT a.*,u.email_verified_at FROM partner_applications a JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND u.role='applicant' AND u.deleted_at IS NULL",
        uid,
      );
      if (!a) fail('This application was not found or is already decided.', 404);
      if (!(await can(req.user, permissionFor(a.kind)))) fail('Your administrator has not granted access to this module.', 403);
      if (p.status === 'pending' && a.details === '{}')
        fail('They have not sent their details yet, so it cannot wait for review.');
      if (p.email_verified !== undefined) {
        await run(
          'UPDATE users SET email_verified_at=? WHERE id=?',
          p.email_verified ? a.email_verified_at || now() : null,
          uid,
        );
        if (p.email_verified) await run('DELETE FROM email_codes WHERE user_id=?', uid);
      }
      if (p.status) await run("UPDATE partner_applications SET status=?,note='' WHERE user_id=?", p.status, uid);
      if (p.active !== undefined) {
        await run('UPDATE users SET active=? WHERE id=?', Number(p.active), uid);
        // A blocked account is signed out everywhere at once.
        if (!p.active) await run('DELETE FROM sessions WHERE user_id=?', uid);
      }
      res.json({ ok: true });
    }),
  );

  /** Opens the account: the applicant becomes a rider or an outlet with its own sign-in ID. */
  app.post(
    '/api/admin/applications/:id/approve',
    admin,
    atomicRoute(async (req: AuthRequest, res) => {
      const uid = String(req.params.id);
      const a = await one(
        "SELECT a.*,u.name,u.email,u.phone,u.address,u.location_id FROM partner_applications a JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND u.role='applicant' AND u.deleted_at IS NULL",
        uid,
      );
      if (!a) fail('This application was not found or is already decided.', 404);
      if (!(await can(req.user, permissionFor(a.kind)))) fail('Your administrator has not granted access to this module.', 403);
      if (a.status !== 'pending') fail('Only an application with its details sent can be approved.', 409);
      const d = JSON.parse(a.details);
      // A rider's commission: what the team sets here, else what the rider asked for with the usual
      // amount (PKR 100 per delivery, or 80% of the delivery fee). Fixed amounts are in paisa.
      const c = z
        .object({
          commission_type: z.enum(['fixed', 'percent']).optional(),
          commission_value: z.number().min(0).max(100000000).optional(),
          commission_base: z.enum(['delivery_fee', 'subtotal', 'total']).optional(),
        })
        .parse(req.body ?? {});
      const commissionType = c.commission_type ?? d.commission_type ?? riderDefaults.commission_type;
      const commissionValue = c.commission_value ?? (commissionType === 'percent' ? 80 : riderDefaults.commission_value);
      if (commissionType === 'percent' && commissionValue > 100) fail('A percentage commission must be 100 or less.');
      let loginId: string;
      if (a.kind === 'rider') {
        loginId = await nextLoginId('DRV');
        await run("UPDATE users SET role='rider',login_id=?,active=1 WHERE id=?", loginId, uid);
        await saveRiderSettings(uid, {
          commission_type: commissionType,
          commission_value: commissionValue,
          commission_base: c.commission_base ?? 'delivery_fee',
          cnic: d.cnic,
          license_number: d.license_number,
          vehicle_type: d.vehicle_type,
          vehicle_number: d.vehicle_number,
          emergency_name: d.emergency_name,
          emergency_phone: d.emergency_phone,
          payout_method: d.payout_method,
          payout_bank: d.payout_bank,
          payout_title: d.payout_title,
          payout_account: d.payout_account,
          notes: d.about ? 'From the application: ' + d.about : '',
        });
      } else {
        loginId = await nextLoginId('DLV');
        const centre = await one('SELECT lat,lng FROM locations WHERE id=?', d.location_id);
        const oid = id();
        // The outlet's sign-in carries the business name, like outlets the team creates.
        await run(
          "UPDATE users SET role='outlet',login_id=?,name=?,phone=?,address=?,location_id=?,active=1 WHERE id=?",
          loginId,
          d.business_name,
          d.business_phone,
          d.address,
          d.location_id,
          uid,
        );
        await run(
          'INSERT INTO outlets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
          oid,
          d.business_name,
          d.business_phone,
          a.email,
          d.location_id,
          d.address,
          d.lat ?? centre?.lat ?? 0,
          d.lng ?? centre?.lng ?? 0,
          loginId,
          uid,
          1,
          // A stand-in picture until the outlet or the team uploads its own.
          '/images/essentials.webp',
          d.category,
        );
        // It delivers in its own area to begin with; the team can widen that on the Outlets page.
        await run('UPDATE outlets SET nationwide=0 WHERE id=?', oid);
        await run('INSERT INTO outlet_areas(outlet_id,location_id) VALUES(?,?) ON CONFLICT DO NOTHING', oid, d.location_id);
        const rate = (await records('categories')).find((c) => c.name === d.category)?.commission_rate;
        await saveOutletSettings(oid, {
          commission_rate: rate ?? undefined,
          description: d.description,
          opens_at: d.opens_at,
          closes_at: d.closes_at,
          owner_name: d.owner_name,
          payout_bank: d.payout_bank,
          payout_title: d.payout_title,
          payout_account: d.payout_account,
          notes: 'Owner CNIC: ' + d.owner_cnic,
        });
      }
      await run(
        "UPDATE partner_applications SET status='approved',note='',reviewed_at=?,reviewed_by=? WHERE user_id=?",
        now(),
        req.user!.id,
        uid,
      );
      const what = a.kind === 'rider' ? 'rider' : 'outlet';
      await notify([uid], {
        type: 'message',
        title: `Your ${what} account is approved`,
        body: `Welcome to Dellvit! Your ${what} ID is ${loginId}. Sign in again to start.`,
        link: a.kind === 'rider' ? '/portal/rider' : '/portal/outlet',
      });
      await afterCommit(async () => {
        await sendMail(
          noticeEmail({
            to: a.email,
            subject: `Your Dellvit ${what} account is approved`,
            heading: 'You are approved',
            paragraphs: [
              `Good news, ${a.name.split(' ')[0] || 'there'}: your Dellvit ${what} account is approved.`,
              `Your ${what} ID is ${loginId}. Sign in with it, or with your email, and the same password.`,
            ],
            button: { path: '/login', label: 'Sign in' },
          }),
        ).catch(() => {});
      });
      res.json({ ok: true, login_id: loginId });
    }),
  );

  /** Sends the application back with the reason; the applicant corrects it and sends it again. */
  app.post(
    '/api/admin/applications/:id/reject',
    admin,
    atomicRoute(async (req: AuthRequest, res) => {
      const uid = String(req.params.id);
      const p = z.object({ note: str(1000) }).parse(req.body);
      const a = await one(
        "SELECT a.*,u.name,u.email FROM partner_applications a JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND u.role='applicant' AND u.deleted_at IS NULL",
        uid,
      );
      if (!a) fail('This application was not found or is already decided.', 404);
      if (!(await can(req.user, permissionFor(a.kind)))) fail('Your administrator has not granted access to this module.', 403);
      if (a.status !== 'pending') fail('Only an application with its details sent can be sent back.', 409);
      await run(
        "UPDATE partner_applications SET status='rejected',note=?,reviewed_at=?,reviewed_by=? WHERE user_id=?",
        p.note,
        now(),
        req.user!.id,
        uid,
      );
      await notify([uid], {
        type: 'message',
        title: 'Your application needs changes',
        body: p.note,
        link: '/partner',
      });
      await afterCommit(async () => {
        await sendMail(
          noticeEmail({
            to: a.email,
            subject: 'Your Dellvit application needs changes',
            heading: 'Please update your application',
            paragraphs: [
              `Hi ${a.name.split(' ')[0] || 'there'}, our team looked at your ${a.kind} application and needs a few changes before approving it:`,
              p.note,
              'Sign in, correct your details and send them again.',
            ],
            button: { path: '/partner', label: 'Update your details' },
          }),
        ).catch(() => {});
      });
      res.json({ ok: true });
    }),
  );
}
