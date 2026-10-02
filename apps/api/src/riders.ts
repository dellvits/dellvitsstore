import { atomicRoute } from './atomic-route.js';
import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, one, run, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify } from './notifications.js';
import { range, between } from './range.js';

/** Fixed commissions are stored in paisa; percentage commissions as a percent (0–100). */
export const commissionSchema = {
  commission_type: z.enum(['fixed', 'percent']).default('fixed'),
  commission_value: z.number().min(0).max(100000000).default(10000),
  commission_base: z.enum(['delivery_fee', 'subtotal', 'total']).default('delivery_fee'),
};
export const vehicleTypes = ['motorbike', 'bicycle', 'car', 'rickshaw', 'on_foot'] as const;
export const payoutMethods = ['cash', 'bank', 'wallet', 'raast'] as const;
/** A rider without a settings row yet has these. Fixed commissions are in paisa. */
export const riderDefaults = {
  commission_type: 'fixed',
  commission_value: 10000,
  commission_base: 'delivery_fee',
  vehicle_type: 'motorbike',
  vehicle_number: '',
  cnic: '',
  license_number: '',
  emergency_name: '',
  emergency_phone: '',
  payout_method: 'cash',
  payout_bank: '',
  payout_title: '',
  payout_account: '',
  notes: '',
};
export type RiderSettings = typeof riderDefaults;
export async function riderSettings(uid: string) {
  return ((await one('SELECT * FROM rider_settings WHERE user_id=?', uid)) || {
    user_id: uid,
    ...riderDefaults,
  }) as Row;
}
/** Saves the fields given and keeps the rest as they are. */
export async function saveRiderSettings(uid: string, s: Partial<RiderSettings>) {
  const next = { ...(await riderSettings(uid)), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) };
  if (next.commission_type === 'percent' && next.commission_value > 100)
    throw Object.assign(new Error('A percentage commission must be 100 or less.'), { status: 400 });
  if (next.commission_type === 'fixed') next.commission_value = Math.round(next.commission_value);
  const keys = Object.keys(riderDefaults);
  await run(
    `INSERT INTO rider_settings(user_id,${keys.join(',')}) VALUES(?,${keys.map(() => '?').join(',')}) ON CONFLICT(user_id) DO UPDATE SET ${keys.map((k) => `${k}=excluded.${k}`).join(',')}`,
    uid,
    ...keys.map((k) => next[k]),
  );
}
/** Called inside the delivery transaction. Earnings are recorded once per order. */
export async function recordEarning(order: Row, cashCollected: number) {
  if (!order.rider_id || (await one('SELECT id FROM rider_earnings WHERE order_id=?', order.id)))
    return;
  const s = await riderSettings(order.rider_id);
  const base =
    s.commission_base === 'subtotal'
      ? order.subtotal
      : s.commission_base === 'total'
        ? order.total
        : order.delivery_fee;
  const amount =
    s.commission_type === 'fixed'
      ? Math.round(s.commission_value)
      : Math.round((base * s.commission_value) / 100);
  await run(
    'INSERT INTO rider_earnings VALUES(?,?,?,?,?,?,?,?,?,?)',
    randomUUID(),
    order.rider_id,
    order.id,
    amount,
    s.commission_type,
    s.commission_value,
    s.commission_base,
    base,
    cashCollected,
    new Date().toISOString(),
  );
}
export async function riderBalance(uid: string) {
  const b = (await one(
    `SELECT (SELECT COALESCE(SUM(amount),0) FROM rider_earnings WHERE rider_id=?) earned,(SELECT COALESCE(SUM(amount),0) FROM rider_payouts WHERE rider_id=?) paid`,
    uid,
    uid,
  ))!;
  return { earned: b.earned as number, paid: b.paid as number, balance: b.earned - b.paid };
}
export async function pendingPayouts(uid: string) {
  return (await one(
    "SELECT COALESCE(SUM(amount),0) n FROM payout_requests WHERE rider_id=? AND status='pending'",
    uid,
  ))!.n as number;
}
export async function insertPayout(p: {
  id?: string;
  rider_id: string;
  amount: number;
  note: string;
  created_by: string;
  method: string;
  reference: string;
  type: 'manual' | 'request';
}) {
  await run(
    'INSERT INTO rider_payouts(id,rider_id,amount,note,created_by,created_at,method,reference,type,status) VALUES(?,?,?,?,?,?,?,?,?,?)',
    p.id || randomUUID(),
    p.rider_id,
    p.amount,
    p.note,
    p.created_by,
    new Date().toISOString(),
    p.method,
    p.reference,
    p.type,
    'paid',
  );
}
async function statement(uid: string, req: Request) {
  const r = range(req);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = new Date(Date.now() - 7 * 86400000);
  // Every figure in one query, alongside the four lists: a single round of queries.
  const [n, settings, earnings, payouts, requests] = await Promise.all([
    one(
      `SELECT (SELECT COALESCE(SUM(amount),0) FROM rider_earnings WHERE rider_id=?) earned,(SELECT COALESCE(SUM(amount),0) FROM rider_payouts WHERE rider_id=?) paid,(SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE rider_id=? AND status='pending') pending,(SELECT COALESCE(SUM(amount),0) FROM rider_earnings WHERE rider_id=? AND created_at>=?) today,(SELECT COALESCE(SUM(amount),0) FROM rider_earnings WHERE rider_id=? AND created_at>=?) week,(SELECT COALESCE(SUM(amount),0) FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}) earned_range,(SELECT COALESCE(SUM(amount),0) FROM rider_payouts WHERE rider_id=? AND ${between('created_at')}) paid_range,(SELECT COUNT(*) FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}) deliveries_range,(SELECT COUNT(*) FROM rider_earnings WHERE rider_id=?) deliveries,(SELECT COALESCE(SUM(cash_collected),0) FROM rider_earnings WHERE rider_id=?) cash_collected`,
      uid,
      uid,
      uid,
      uid,
      today.toISOString(),
      uid,
      week.toISOString(),
      uid,
      r.from,
      r.to,
      uid,
      r.from,
      r.to,
      uid,
      r.from,
      r.to,
      uid,
      uid,
    ),
    riderSettings(uid).then((s) => ({
      commission_type: s.commission_type,
      commission_value: s.commission_value,
      commission_base: s.commission_base,
    })),
    all(
      'SELECT e.*,o.reference,o.total order_total,o.delivery_fee FROM rider_earnings e JOIN orders o ON o.id=e.order_id WHERE e.rider_id=? ORDER BY e.created_at DESC',
      uid,
    ),
    all(
      'SELECT p.*,a.name issued_by FROM rider_payouts p LEFT JOIN users a ON a.id=p.created_by WHERE p.rider_id=? ORDER BY p.created_at DESC',
      uid,
    ),
    all(
      'SELECT q.*,a.name reviewer_name FROM payout_requests q LEFT JOIN users a ON a.id=q.reviewed_by WHERE q.rider_id=? ORDER BY q.created_at DESC',
      uid,
    ),
  ]);
  const balance = n!.earned - n!.paid;
  return {
    settings,
    earned: n!.earned,
    paid: n!.paid,
    balance,
    pending_requests: n!.pending,
    available: balance - n!.pending,
    today: n!.today,
    week: n!.week,
    earned_range: n!.earned_range,
    paid_range: n!.paid_range,
    deliveries_range: n!.deliveries_range,
    deliveries: n!.deliveries,
    cash_collected: n!.cash_collected,
    earnings,
    payouts,
    requests,
  };
}
export function installRiders(app: Express) {
  app.get('/api/rider/earnings', requireRole('rider'), async (req: AuthRequest, res) =>
    res.json(await statement(req.user!.id, req)),
  );
  app.get('/api/admin/riders/:id/earnings', requireRole('admin'), async (req, res) => {
    const id = String(req.params.id);
    if (!(await one("SELECT id FROM users WHERE id=? AND role='rider' AND deleted_at IS NULL", id)))
      return res.sendStatus(404);
    res.json(await statement(id, req));
  });
  app.post(
    '/api/admin/riders/:id/payouts',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const id = String(req.params.id);
      const p = z
        .object({
          amount: z.number().int().positive().max(100000000),
          note: z.string().max(300).default(''),
          method: z.enum(payoutMethods).default('cash'),
          reference: z.string().trim().max(80).default(''),
        })
        .parse(req.body);
      if (!(await one("SELECT id FROM users WHERE id=? AND role='rider' AND deleted_at IS NULL", id)))
        return res.sendStatus(404);
      if (p.amount > (await riderBalance(id)).balance)
        return res.status(400).json({ error: 'A payout cannot exceed the rider balance.' });
      await insertPayout({ ...p, rider_id: id, created_by: req.user!.id, type: 'manual' });
      await notify([id], {
        type: 'payout',
        title: 'Payout recorded',
        body: `PKR ${(p.amount / 100).toLocaleString('en-PK')} has been paid out to you.`,
        link: '/portal/rider?tab=earnings',
      });
      res.status(201).json({ ok: true, ...(await riderBalance(id)) });
    }),
  );
}
