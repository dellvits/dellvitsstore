import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import './platform.js';
import { db, all, one, run, transaction, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify, adminsWith } from './notifications.js';
import { riderBalance, pendingPayouts, insertPayout, payoutMethods } from './riders.js';
import { range, between } from './range.js';

db.exec(`
CREATE TABLE IF NOT EXISTS outlet_settings(outlet_id TEXT PRIMARY KEY REFERENCES outlets(id),commission_rate REAL NOT NULL DEFAULT 10,accepting INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS order_settlements(order_id TEXT PRIMARY KEY REFERENCES orders(id),outlet_id TEXT NOT NULL,rider_id TEXT,total INTEGER NOT NULL,subtotal INTEGER NOT NULL,delivery_fee INTEGER NOT NULL,discount INTEGER NOT NULL,outlet_rate REAL NOT NULL,outlet_commission INTEGER NOT NULL,outlet_payable INTEGER NOT NULL,rider_commission INTEGER NOT NULL,store_net INTEGER NOT NULL,cash_collected INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cod_deposits(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,review_note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS payout_requests(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,method TEXT NOT NULL,account TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,review_note TEXT NOT NULL DEFAULT '',payout_id TEXT);
CREATE INDEX IF NOT EXISTS idx_deposits_rider ON cod_deposits(rider_id,created_at);
CREATE INDEX IF NOT EXISTS idx_payout_requests_rider ON payout_requests(rider_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`);

const now = () => new Date().toISOString();
const money = (paisa: number) => 'PKR ' + (paisa / 100).toLocaleString('en-PK');
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export function outletSettings(outletId: string) {
  return (one('SELECT * FROM outlet_settings WHERE outlet_id=?', outletId) || {
    outlet_id: outletId,
    commission_rate: 10,
    accepting: 1,
  }) as Row;
}
export function saveOutletSettings(outletId: string, s: { commission_rate?: number; accepting?: number }) {
  const old = outletSettings(outletId);
  run(
    'INSERT INTO outlet_settings VALUES(?,?,?) ON CONFLICT(outlet_id) DO UPDATE SET commission_rate=excluded.commission_rate,accepting=excluded.accepting',
    outletId,
    s.commission_rate ?? old.commission_rate,
    s.accepting ?? old.accepting,
  );
}

/** Splits a delivered order between the outlet, the rider and Dellvit. Runs inside the delivery transaction. */
export function recordSettlement(order: Row) {
  if (one('SELECT order_id FROM order_settlements WHERE order_id=?', order.id)) return;
  const d = one('SELECT discount,payment_type FROM order_details WHERE order_id=?', order.id);
  const rate = outletSettings(order.outlet_id).commission_rate;
  const outletCommission = Math.round((order.subtotal * rate) / 100);
  const outletPayable = order.subtotal - outletCommission;
  const earning = one('SELECT amount,cash_collected FROM rider_earnings WHERE order_id=?', order.id);
  const riderCommission = earning?.amount || 0;
  run(
    'INSERT INTO order_settlements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    order.id,
    order.outlet_id,
    order.rider_id,
    order.total,
    order.subtotal,
    order.delivery_fee,
    d?.discount || 0,
    rate,
    outletCommission,
    outletPayable,
    riderCommission,
    order.total - outletPayable - riderCommission,
    earning?.cash_collected ?? (d?.payment_type === 'cod' ? order.total : 0),
    order.delivered_at || now(),
  );
}
for (const o of all(
  "SELECT o.* FROM orders o LEFT JOIN order_settlements s ON s.order_id=o.id WHERE o.status='delivered' AND s.order_id IS NULL",
))
  recordSettlement(o);


export function cashPosition(uid: string) {
  const collected = one(
    'SELECT COALESCE(SUM(cash_collected),0) n FROM rider_earnings WHERE rider_id=?',
    uid,
  )!.n as number;
  const sum = (status: string) =>
    one(
      'SELECT COALESCE(SUM(amount),0) n FROM cod_deposits WHERE rider_id=? AND status=?',
      uid,
      status,
    )!.n as number;
  const approved = sum('approved');
  const pending = sum('pending');
  return { collected, approved, pending, in_hand: collected - approved - pending };
}
const depositMethods = ['cash_handover', 'bank', 'wallet', 'raast'] as const;

export function installFinance(app: Express) {
  /* ---------- Admin dashboard ---------- */
  app.get('/api/admin/summary', requireRole('admin'), (req, res) => {
    const r = range(req);
    const count = (extra = '') =>
      one(`SELECT COUNT(*) n FROM orders WHERE ${between('created_at')}${extra}`, r.from, r.to)!.n;
    const totals = one(
      `SELECT COUNT(*) delivered,COALESCE(SUM(s.total),0) sales,COALESCE(SUM(s.outlet_payable),0) outlet_deducted,COALESCE(SUM(s.outlet_commission),0) outlet_commission,COALESCE(SUM(s.rider_commission),0) rider_commission,COALESCE(SUM(s.discount),0) coupon_deductions,COALESCE(SUM(s.store_net),0) store_sales,COALESCE(SUM(s.delivery_fee),0) delivery_fees FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE ${between('o.created_at')}`,
      r.from,
      r.to,
    )!;
    res.json({
      orders: count(),
      cancelled: count(" AND status='cancelled'"),
      active_orders: count(" AND status NOT IN ('delivered','cancelled')"),
      ...totals,
      // Kept for older clients.
      revenue: totals.sales,
      outlets: one('SELECT COUNT(*) n FROM outlets WHERE active=1')!.n,
      statuses: Object.fromEntries(
        all(
          `SELECT status,COUNT(*) n FROM orders WHERE ${between('created_at')} GROUP BY status`,
          r.from,
          r.to,
        ).map((x) => [x.status, x.n]),
      ),
      attention: {
        dispatch: one(
          "SELECT COUNT(*) n FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.status='placed' AND f.payment_verified_at IS NOT NULL AND (f.sent_at IS NULL OR f.rider_status IN ('rejected','unsent'))",
        )!.n,
        payments: one(
          "SELECT COUNT(*) n FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.payment_status='submitted' AND o.status<>'cancelled'",
        )!.n,
        refunds: one("SELECT COUNT(*) n FROM order_details WHERE payment_status='refund_due'")!.n,
        cancel_requests: one("SELECT COUNT(*) n FROM order_flow WHERE cancel_request<>''")!.n,
        payout_requests: one("SELECT COUNT(*) n FROM payout_requests WHERE status='pending'")!.n,
        cod_deposits: one("SELECT COUNT(*) n FROM cod_deposits WHERE status='pending'")!.n,
      },
    });
  });

  /* ---------- Outlet dashboard ---------- */
  const myOutlet = (req: AuthRequest) => {
    const o = one('SELECT * FROM outlets WHERE user_id=?', req.user!.id);
    if (!o) fail('Outlet not found.', 404);
    return o;
  };
  app.get('/api/manage/outlet/summary', requireRole('outlet'), (req: AuthRequest, res) => {
    const outlet = myOutlet(req);
    const r = range(req);
    const scope = `o.outlet_id=? AND f.sent_at IS NOT NULL AND ${between('o.created_at')}`;
    const args = [outlet.id, r.from, r.to];
    const statuses = Object.fromEntries(
      all(
        `SELECT o.status,COUNT(*) n FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE ${scope} GROUP BY o.status`,
        ...args,
      ).map((x) => [x.status, x.n]),
    );
    const totals = one(
      `SELECT COUNT(*) delivered,COALESCE(SUM(s.subtotal),0) sales,COALESCE(SUM(s.outlet_commission),0) commission,COALESCE(SUM(s.outlet_payable),0) payable FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.outlet_id=? AND ${between('o.created_at')}`,
      outlet.id,
      r.from,
      r.to,
    )!;
    res.json({
      outlet: { ...outlet, ...outletSettings(outlet.id) },
      statuses,
      orders: Object.values(statuses).reduce((a: number, b) => a + Number(b), 0),
      awaiting_response: one(
        "SELECT COUNT(*) n FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.outlet_id=? AND o.status='placed' AND f.outlet_status='pending'",
        outlet.id,
      )!.n,
      in_kitchen: one(
        "SELECT COUNT(*) n FROM orders WHERE outlet_id=? AND status IN ('confirmed','preparing')",
        outlet.id,
      )!.n,
      awaiting_pickup: one("SELECT COUNT(*) n FROM orders WHERE outlet_id=? AND status='ready'", outlet.id)!.n,
      ...totals,
      average_order: totals.delivered ? Math.round(totals.sales / totals.delivered) : 0,
      top_products: all(
        `SELECT i.product_id,i.name,i.image,SUM(i.quantity) quantity,SUM(i.quantity*i.unit_price) revenue FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.outlet_id=? AND o.status='delivered' AND ${between('o.created_at')} GROUP BY i.product_id ORDER BY quantity DESC LIMIT 5`,
        outlet.id,
        r.from,
        r.to,
      ),
      low_stock: all(
        'SELECT id,name,stock,images FROM products WHERE outlet_id=? AND active=1 AND stock<10 ORDER BY stock ASC LIMIT 6',
        outlet.id,
      ).map((p) => ({ ...p, image: JSON.parse(p.images)[0], images: undefined })),
      daily: all(
        `SELECT substr(o.created_at,1,10) day,COUNT(*) orders,COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.subtotal ELSE 0 END),0) sales FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE ${scope} GROUP BY day ORDER BY day`,
        ...args,
      ),
    });
  });
  app.get('/api/manage/outlet/settlements', requireRole('outlet'), (req: AuthRequest, res) => {
    const outlet = myOutlet(req);
    res.json(
      all(
        'SELECT s.*,o.reference,o.created_at order_created_at FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.outlet_id=? ORDER BY s.created_at DESC',
        outlet.id,
      ),
    );
  });
  app.patch('/api/manage/outlet/settings', requireRole('outlet'), (req: AuthRequest, res) => {
    const p = z.object({ accepting: z.boolean() }).parse(req.body);
    const outlet = myOutlet(req);
    saveOutletSettings(outlet.id, { accepting: Number(p.accepting) });
    notify(adminsWith('outlets'), {
      type: 'order',
      title: p.accepting ? 'Outlet reopened' : 'Outlet paused orders',
      body: `${outlet.name} ${p.accepting ? 'is accepting orders again.' : 'stopped accepting new orders.'}`,
      link: '/admin?tab=outlets',
    });
    res.json({ ok: true, ...outletSettings(outlet.id) });
  });

  /* ---------- Rider cash on delivery ---------- */
  function cashStatement(uid: string, req: Request) {
    const r = range(req);
    return {
      ...cashPosition(uid),
      collected_range: one(
        `SELECT COALESCE(SUM(cash_collected),0) n FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}`,
        uid,
        r.from,
        r.to,
      )!.n,
      submitted_range: one(
        `SELECT COALESCE(SUM(amount),0) n FROM cod_deposits WHERE rider_id=? AND status='approved' AND ${between('created_at')}`,
        uid,
        r.from,
        r.to,
      )!.n,
      collections: all(
        "SELECT e.order_id,e.cash_collected amount,e.created_at,o.reference,o.name customer FROM rider_earnings e JOIN orders o ON o.id=e.order_id WHERE e.rider_id=? AND e.cash_collected>0 ORDER BY e.created_at DESC",
        uid,
      ),
      deposits: all(
        'SELECT d.*,u.name reviewer_name FROM cod_deposits d LEFT JOIN users u ON u.id=d.reviewed_by WHERE d.rider_id=? ORDER BY d.created_at DESC',
        uid,
      ),
    };
  }
  app.get('/api/rider/cash', requireRole('rider'), (req: AuthRequest, res) =>
    res.json(cashStatement(req.user!.id, req)),
  );
  app.post('/api/rider/cash/deposits', requireRole('rider'), (req: AuthRequest, res) => {
    const p = z
      .object({
        amount: z.number().int().positive().max(100000000),
        method: z.enum(depositMethods),
        reference: z.string().trim().max(80).default(''),
        note: z.string().trim().max(300).default(''),
      })
      .parse(req.body);
    if (p.method !== 'cash_handover' && p.reference.length < 4)
      fail('Enter the transaction ID of your transfer.');
    const id = randomUUID();
    transaction(() => {
      if (p.amount > cashPosition(req.user!.id).in_hand)
        fail('You cannot submit more cash than you are holding.');
      run(
        'INSERT INTO cod_deposits(id,rider_id,amount,method,reference,note,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
        id,
        req.user!.id,
        p.amount,
        p.method,
        p.reference,
        p.note,
        'pending',
        now(),
      );
    });
    notify(adminsWith('riders'), {
      type: 'payment',
      title: 'COD cash submitted',
      body: `${req.user!.name} submitted ${money(p.amount)} for verification.`,
      link: '/admin?tab=cash',
    });
    res.status(201).json({ id, ...cashPosition(req.user!.id) });
  });
  app.delete('/api/rider/cash/deposits/:id', requireRole('rider'), (req: AuthRequest, res) => {
    const r = run(
      "UPDATE cod_deposits SET status='cancelled' WHERE id=? AND rider_id=? AND status='pending'",
      String(req.params.id),
      req.user!.id,
    );
    if (!r.changes) fail('Only pending submissions can be withdrawn.');
    res.json({ ok: true });
  });
  app.get('/api/admin/cash', requireRole('admin'), (req, res) => {
    const r = range(req);
    const riders = all(
      "SELECT id,name,login_id,phone,location_id,active FROM users WHERE role='rider' ORDER BY name",
    ).map((u) => ({ ...u, ...cashPosition(u.id) }));
    res.json({
      riders,
      totals: {
        in_hand: riders.reduce((s, x) => s + x.in_hand, 0),
        pending: riders.reduce((s, x) => s + x.pending, 0),
        collected_range: one(
          `SELECT COALESCE(SUM(cash_collected),0) n FROM rider_earnings WHERE ${between('created_at')}`,
          r.from,
          r.to,
        )!.n,
        approved_range: one(
          `SELECT COALESCE(SUM(amount),0) n FROM cod_deposits WHERE status='approved' AND ${between('created_at')}`,
          r.from,
          r.to,
        )!.n,
      },
      deposits: all(
        'SELECT d.*,u.name rider_name,u.login_id,a.name reviewer_name FROM cod_deposits d JOIN users u ON u.id=d.rider_id LEFT JOIN users a ON a.id=d.reviewed_by ORDER BY d.created_at DESC',
      ),
    });
  });
  app.get('/api/admin/cash/riders/:id', requireRole('admin'), (req, res) => {
    const id = String(req.params.id);
    if (!one("SELECT id FROM users WHERE id=? AND role='rider'", id)) fail('Rider not found.', 404);
    res.json(cashStatement(id, req));
  });
  app.patch('/api/admin/cash/deposits/:id', requireRole('admin'), (req: AuthRequest, res) => {
    const p = z
      .object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).default('') })
      .parse(req.body);
    const d = one('SELECT * FROM cod_deposits WHERE id=?', String(req.params.id));
    if (!d) fail('Submission not found.', 404);
    if (d.status !== 'pending') fail('This submission has already been reviewed.');
    if (p.decision === 'reject' && !p.note) fail('Tell the rider why the submission was rejected.');
    run(
      'UPDATE cod_deposits SET status=?,reviewed_by=?,reviewed_at=?,review_note=? WHERE id=?',
      p.decision === 'approve' ? 'approved' : 'rejected',
      req.user!.id,
      now(),
      p.note,
      d.id,
    );
    notify([d.rider_id], {
      type: 'payment',
      title: p.decision === 'approve' ? 'Cash submission verified' : 'Cash submission rejected',
      body:
        p.decision === 'approve'
          ? `${money(d.amount)} was received by Dellvit.`
          : `${money(d.amount)}: ${p.note}`,
      link: '/portal/rider?tab=cash',
    });
    res.json({ ok: true });
  });

  /* ---------- Rider payout requests ---------- */
  app.post('/api/rider/payout-requests', requireRole('rider'), (req: AuthRequest, res) => {
    const p = z
      .object({
        amount: z.number().int().positive().max(100000000),
        method: z.enum(payoutMethods),
        account: z.string().trim().max(120).default(''),
        note: z.string().trim().max(300).default(''),
      })
      .parse(req.body);
    if (p.method !== 'cash' && p.account.length < 4)
      fail('Enter the account or wallet number to receive the payout.');
    const id = randomUUID();
    transaction(() => {
      if (p.amount > riderBalance(req.user!.id).balance - pendingPayouts(req.user!.id))
        fail('The request is more than your available balance.');
      run(
        'INSERT INTO payout_requests(id,rider_id,amount,method,account,note,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
        id,
        req.user!.id,
        p.amount,
        p.method,
        p.account,
        p.note,
        'pending',
        now(),
      );
    });
    notify(adminsWith('riders'), {
      type: 'payout',
      title: 'Payout requested',
      body: `${req.user!.name} requested ${money(p.amount)}.`,
      link: '/admin?tab=payouts',
    });
    res.status(201).json({ id });
  });
  app.delete('/api/rider/payout-requests/:id', requireRole('rider'), (req: AuthRequest, res) => {
    const r = run(
      "UPDATE payout_requests SET status='cancelled' WHERE id=? AND rider_id=? AND status='pending'",
      String(req.params.id),
      req.user!.id,
    );
    if (!r.changes) fail('Only pending requests can be withdrawn.');
    res.json({ ok: true });
  });
  app.get('/api/admin/payouts', requireRole('admin'), (req, res) => {
    const r = range(req);
    const riders = all("SELECT id,name,login_id FROM users WHERE role='rider' ORDER BY name").map(
      (u) => {
        const b = riderBalance(u.id);
        const pending = pendingPayouts(u.id);
        return { ...u, ...b, pending, available: b.balance - pending };
      },
    );
    res.json({
      riders,
      totals: {
        balance: riders.reduce((s, x) => s + x.balance, 0),
        pending: riders.reduce((s, x) => s + x.pending, 0),
        paid_range: one(
          `SELECT COALESCE(SUM(amount),0) n FROM rider_payouts WHERE ${between('created_at')}`,
          r.from,
          r.to,
        )!.n,
        earned_range: one(
          `SELECT COALESCE(SUM(amount),0) n FROM rider_earnings WHERE ${between('created_at')}`,
          r.from,
          r.to,
        )!.n,
      },
      requests: all(
        'SELECT q.*,u.name rider_name,u.login_id,a.name reviewer_name FROM payout_requests q JOIN users u ON u.id=q.rider_id LEFT JOIN users a ON a.id=q.reviewed_by ORDER BY q.created_at DESC',
      ).map((q) => ({ ...q, balance: riderBalance(q.rider_id).balance })),
      payouts: all(
        'SELECT p.*,u.name rider_name,u.login_id,a.name issued_by FROM rider_payouts p JOIN users u ON u.id=p.rider_id LEFT JOIN users a ON a.id=p.created_by ORDER BY p.created_at DESC',
      ),
    });
  });
  app.post('/api/admin/payouts/requests/:id', requireRole('admin'), (req: AuthRequest, res) => {
    const p = z
      .object({
        decision: z.enum(['approve', 'reject']),
        method: z.enum(payoutMethods).optional(),
        reference: z.string().trim().max(80).default(''),
        note: z.string().trim().max(300).default(''),
      })
      .parse(req.body);
    const q = one('SELECT * FROM payout_requests WHERE id=?', String(req.params.id));
    if (!q) fail('Request not found.', 404);
    if (q.status !== 'pending') fail('This request has already been reviewed.');
    if (p.decision === 'reject') {
      if (!p.note) fail('Tell the rider why the request was rejected.');
      run(
        "UPDATE payout_requests SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=?",
        req.user!.id,
        now(),
        p.note,
        q.id,
      );
      notify([q.rider_id], {
        type: 'payout',
        title: 'Payout request rejected',
        body: `${money(q.amount)}: ${p.note}`,
        link: '/portal/rider?tab=earnings',
      });
      return res.json({ ok: true });
    }
    const payoutId = randomUUID();
    transaction(() => {
      if (q.amount > riderBalance(q.rider_id).balance)
        fail('The request is more than the rider’s current balance.');
      insertPayout({
        id: payoutId,
        rider_id: q.rider_id,
        amount: q.amount,
        note: p.note || q.note,
        created_by: req.user!.id,
        method: p.method || q.method,
        reference: p.reference,
        type: 'request',
      });
      run(
        "UPDATE payout_requests SET status='approved',reviewed_by=?,reviewed_at=?,review_note=?,payout_id=? WHERE id=?",
        req.user!.id,
        now(),
        p.note,
        payoutId,
        q.id,
      );
    });
    notify([q.rider_id], {
      type: 'payout',
      title: 'Payout approved',
      body: `${money(q.amount)} has been paid out to you.`,
      link: '/portal/rider?tab=earnings',
    });
    res.json({ ok: true });
  });
}
