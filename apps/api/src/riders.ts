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
export async function riderSettings(uid: string) {
  return ((await one('SELECT * FROM rider_settings WHERE user_id=?', uid)) || {
    user_id: uid,
    commission_type: 'fixed',
    commission_value: 10000,
    commission_base: 'delivery_fee',
  }) as Row;
}
export async function saveRiderSettings(
  uid: string,
  s: { commission_type: string; commission_value: number; commission_base: string },
) {
  if (s.commission_type === 'percent' && s.commission_value > 100)
    throw Object.assign(new Error('A percentage commission must be 100 or less.'), { status: 400 });
  await run(
    'INSERT INTO rider_settings VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET commission_type=excluded.commission_type,commission_value=excluded.commission_value,commission_base=excluded.commission_base',
    uid,
    s.commission_type,
    s.commission_type === 'fixed' ? Math.round(s.commission_value) : s.commission_value,
    s.commission_base,
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
  const earned = (await one(
    'SELECT COALESCE(SUM(amount),0) n FROM rider_earnings WHERE rider_id=?',
    uid,
  ))!.n as number;
  const paid = (await one(
    'SELECT COALESCE(SUM(amount),0) n FROM rider_payouts WHERE rider_id=?',
    uid,
  ))!.n as number;
  return { earned, paid, balance: earned - paid };
}
export async function pendingPayouts(uid: string) {
  return (await one(
    "SELECT COALESCE(SUM(amount),0) n FROM payout_requests WHERE rider_id=? AND status='pending'",
    uid,
  ))!.n as number;
}
export const payoutMethods = ['cash', 'bank', 'wallet', 'raast'] as const;
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
  const sum = async (since: Date) =>
    (await one(
      'SELECT COALESCE(SUM(amount),0) n FROM rider_earnings WHERE rider_id=? AND created_at>=?',
      uid,
      since.toISOString(),
    ))!.n;
  const inRange = async (sql: string) => (await one(sql, uid, r.from, r.to))!.n as number;
  const balance = await riderBalance(uid);
  const pending = await pendingPayouts(uid);
  return {
    settings: await riderSettings(uid),
    ...balance,
    pending_requests: pending,
    available: balance.balance - pending,
    today: await sum(today),
    week: await sum(week),
    earned_range: await inRange(
      `SELECT COALESCE(SUM(amount),0) n FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}`,
    ),
    paid_range: await inRange(
      `SELECT COALESCE(SUM(amount),0) n FROM rider_payouts WHERE rider_id=? AND ${between('created_at')}`,
    ),
    deliveries_range: await inRange(
      `SELECT COUNT(*) n FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}`,
    ),
    deliveries: (await one('SELECT COUNT(*) n FROM rider_earnings WHERE rider_id=?', uid))!.n,
    cash_collected: (await one(
      'SELECT COALESCE(SUM(cash_collected),0) n FROM rider_earnings WHERE rider_id=?',
      uid,
    ))!.n,
    earnings: await all(
      'SELECT e.*,o.reference,o.total order_total,o.delivery_fee FROM rider_earnings e JOIN orders o ON o.id=e.order_id WHERE e.rider_id=? ORDER BY e.created_at DESC',
      uid,
    ),
    payouts: await all(
      'SELECT p.*,a.name issued_by FROM rider_payouts p LEFT JOIN users a ON a.id=p.created_by WHERE p.rider_id=? ORDER BY p.created_at DESC',
      uid,
    ),
    requests: await all(
      'SELECT q.*,a.name reviewer_name FROM payout_requests q LEFT JOIN users a ON a.id=q.reviewed_by WHERE q.rider_id=? ORDER BY q.created_at DESC',
      uid,
    ),
  };
}
export function installRiders(app: Express) {
  app.get('/api/rider/earnings', requireRole('rider'), async (req: AuthRequest, res) =>
    res.json(await statement(req.user!.id, req)),
  );
  app.get('/api/admin/riders/:id/earnings', requireRole('admin'), async (req, res) => {
    const id = String(req.params.id);
    if (!(await one("SELECT id FROM users WHERE id=? AND role='rider'", id)))
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
      if (!(await one("SELECT id FROM users WHERE id=? AND role='rider'", id)))
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
