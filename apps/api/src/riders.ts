import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, all, one, run, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify } from './notifications.js';
import { range, between } from './range.js';

db.exec(`
CREATE TABLE IF NOT EXISTS rider_settings(user_id TEXT PRIMARY KEY REFERENCES users(id),commission_type TEXT NOT NULL DEFAULT 'fixed' CHECK(commission_type IN ('fixed','percent')),commission_value REAL NOT NULL DEFAULT 10000,commission_base TEXT NOT NULL DEFAULT 'delivery_fee' CHECK(commission_base IN ('delivery_fee','subtotal','total')));
CREATE TABLE IF NOT EXISTS rider_earnings(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),amount INTEGER NOT NULL,commission_type TEXT NOT NULL,commission_value REAL NOT NULL,commission_base TEXT NOT NULL,base_amount INTEGER NOT NULL,cash_collected INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rider_payouts(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',created_by TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_earnings_rider ON rider_earnings(rider_id,created_at);
CREATE INDEX IF NOT EXISTS idx_payouts_rider ON rider_payouts(rider_id,created_at);
`);
const payoutColumns = all('PRAGMA table_info(rider_payouts)').map((c) => c.name);
for (const [name, def] of [
  ['method', "TEXT NOT NULL DEFAULT 'cash'"],
  ['reference', "TEXT NOT NULL DEFAULT ''"],
  ['type', "TEXT NOT NULL DEFAULT 'manual'"],
  ['status', "TEXT NOT NULL DEFAULT 'paid'"],
])
  if (!payoutColumns.includes(name)) db.exec(`ALTER TABLE rider_payouts ADD COLUMN ${name} ${def}`);
db.exec(
  "CREATE TABLE IF NOT EXISTS payout_requests(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,method TEXT NOT NULL,account TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,review_note TEXT NOT NULL DEFAULT '',payout_id TEXT);",
);

/** Fixed commissions are stored in paisa; percentage commissions as a percent (0–100). */
export const commissionSchema = {
  commission_type: z.enum(['fixed', 'percent']).default('fixed'),
  commission_value: z.number().min(0).max(100000000).default(10000),
  commission_base: z.enum(['delivery_fee', 'subtotal', 'total']).default('delivery_fee'),
};
export function riderSettings(uid: string) {
  return (one('SELECT * FROM rider_settings WHERE user_id=?', uid) || {
    user_id: uid,
    commission_type: 'fixed',
    commission_value: 10000,
    commission_base: 'delivery_fee',
  }) as Row;
}
export function saveRiderSettings(
  uid: string,
  s: { commission_type: string; commission_value: number; commission_base: string },
) {
  if (s.commission_type === 'percent' && s.commission_value > 100)
    throw Object.assign(new Error('A percentage commission must be 100 or less.'), { status: 400 });
  run(
    'INSERT INTO rider_settings VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET commission_type=excluded.commission_type,commission_value=excluded.commission_value,commission_base=excluded.commission_base',
    uid,
    s.commission_type,
    s.commission_type === 'fixed' ? Math.round(s.commission_value) : s.commission_value,
    s.commission_base,
  );
}
/** Called inside the delivery transaction. Earnings are recorded once per order. */
export function recordEarning(order: Row, cashCollected: number) {
  if (!order.rider_id || one('SELECT id FROM rider_earnings WHERE order_id=?', order.id)) return;
  const s = riderSettings(order.rider_id);
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
  run(
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
export function riderBalance(uid: string) {
  const earned = one('SELECT COALESCE(SUM(amount),0) n FROM rider_earnings WHERE rider_id=?', uid)!
    .n as number;
  const paid = one('SELECT COALESCE(SUM(amount),0) n FROM rider_payouts WHERE rider_id=?', uid)!
    .n as number;
  return { earned, paid, balance: earned - paid };
}
export function pendingPayouts(uid: string) {
  return one(
    "SELECT COALESCE(SUM(amount),0) n FROM payout_requests WHERE rider_id=? AND status='pending'",
    uid,
  )!.n as number;
}
export const payoutMethods = ['cash', 'bank', 'wallet', 'raast'] as const;
export function insertPayout(p: {
  id?: string;
  rider_id: string;
  amount: number;
  note: string;
  created_by: string;
  method: string;
  reference: string;
  type: 'manual' | 'request';
}) {
  run(
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
function statement(uid: string, req: Request) {
  const r = range(req);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = new Date(Date.now() - 7 * 86400000);
  const sum = (since: Date) =>
    one(
      'SELECT COALESCE(SUM(amount),0) n FROM rider_earnings WHERE rider_id=? AND created_at>=?',
      uid,
      since.toISOString(),
    )!.n;
  const inRange = (sql: string) => one(sql, uid, r.from, r.to)!.n as number;
  const balance = riderBalance(uid);
  const pending = pendingPayouts(uid);
  return {
    settings: riderSettings(uid),
    ...balance,
    pending_requests: pending,
    available: balance.balance - pending,
    today: sum(today),
    week: sum(week),
    earned_range: inRange(
      `SELECT COALESCE(SUM(amount),0) n FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}`,
    ),
    paid_range: inRange(
      `SELECT COALESCE(SUM(amount),0) n FROM rider_payouts WHERE rider_id=? AND ${between('created_at')}`,
    ),
    deliveries_range: inRange(
      `SELECT COUNT(*) n FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}`,
    ),
    deliveries: one('SELECT COUNT(*) n FROM rider_earnings WHERE rider_id=?', uid)!.n,
    cash_collected: one(
      'SELECT COALESCE(SUM(cash_collected),0) n FROM rider_earnings WHERE rider_id=?',
      uid,
    )!.n,
    earnings: all(
      'SELECT e.*,o.reference,o.total order_total,o.delivery_fee FROM rider_earnings e JOIN orders o ON o.id=e.order_id WHERE e.rider_id=? ORDER BY e.created_at DESC',
      uid,
    ),
    payouts: all(
      'SELECT p.*,a.name issued_by FROM rider_payouts p LEFT JOIN users a ON a.id=p.created_by WHERE p.rider_id=? ORDER BY p.created_at DESC',
      uid,
    ),
    requests: all(
      'SELECT q.*,a.name reviewer_name FROM payout_requests q LEFT JOIN users a ON a.id=q.reviewed_by WHERE q.rider_id=? ORDER BY q.created_at DESC',
      uid,
    ),
  };
}
export function installRiders(app: Express) {
  app.get('/api/rider/earnings', requireRole('rider'), (req: AuthRequest, res) =>
    res.json(statement(req.user!.id, req)),
  );
  app.get('/api/admin/riders/:id/earnings', requireRole('admin'), (req, res) => {
    const id = String(req.params.id);
    if (!one("SELECT id FROM users WHERE id=? AND role='rider'", id)) return res.sendStatus(404);
    res.json(statement(id, req));
  });
  app.post('/api/admin/riders/:id/payouts', requireRole('admin'), (req: AuthRequest, res) => {
    const id = String(req.params.id);
    const p = z
      .object({
        amount: z.number().int().positive().max(100000000),
        note: z.string().max(300).default(''),
        method: z.enum(payoutMethods).default('cash'),
        reference: z.string().trim().max(80).default(''),
      })
      .parse(req.body);
    if (!one("SELECT id FROM users WHERE id=? AND role='rider'", id)) return res.sendStatus(404);
    if (p.amount > riderBalance(id).balance)
      return res.status(400).json({ error: 'A payout cannot exceed the rider balance.' });
    insertPayout({ ...p, rider_id: id, created_by: req.user!.id, type: 'manual' });
    notify([id], {
      type: 'payout',
      title: 'Payout recorded',
      body: `PKR ${(p.amount / 100).toLocaleString('en-PK')} has been paid out to you.`,
      link: '/portal/rider?tab=earnings',
    });
    res.status(201).json({ ok: true, ...riderBalance(id) });
  });
}
