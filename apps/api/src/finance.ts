import { atomicRoute } from './atomic-route.js';
import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import './platform.js';
import { all, one, run, transaction, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify, adminsWith } from './notifications.js';
import { riderBalance, pendingPayouts, insertPayout, payoutMethods } from './riders.js';
import { range, between } from './range.js';

const now = () => new Date().toISOString();
const money = (paisa: number) => 'PKR ' + (paisa / 100).toLocaleString('en-PK');
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export const outletDefaults = {
  commission_rate: 10,
  accepting: 1,
  description: '',
  featured: 0,
  minimum_order: 0,
  opens_at: '',
  closes_at: '',
  owner_name: '',
  payout_bank: '',
  payout_title: '',
  payout_account: '',
  notes: '',
};
export type OutletSettings = typeof outletDefaults;
export async function outletSettings(outletId: string) {
  return ((await one('SELECT * FROM outlet_settings WHERE outlet_id=?', outletId)) || {
    outlet_id: outletId,
    ...outletDefaults,
  }) as Row;
}
/** An outlet's settings without the fields only administrators may read. */
export async function outletOwnSettings(outletId: string) {
  const { owner_name, payout_bank, payout_title, payout_account, notes, ...own } =
    await outletSettings(outletId);
  return own;
}
export async function saveOutletSettings(outletId: string, s: Partial<OutletSettings>) {
  const old = await outletSettings(outletId);
  const keys = Object.keys(outletDefaults) as (keyof OutletSettings)[];
  await run(
    `INSERT INTO outlet_settings(outlet_id,${keys.join(',')}) VALUES(?,${keys.map(() => '?').join(',')}) ON CONFLICT(outlet_id) DO UPDATE SET ${keys.map((k) => `${k}=excluded.${k}`).join(',')}`,
    outletId,
    ...keys.map((k) => s[k] ?? old[k]),
  );
}
/** The storefront fields of an outlet's settings, for queries that join outlet_settings as `s`. */
export const outletPublicColumns =
  "COALESCE(s.description,'') description,COALESCE(s.featured,0) featured,COALESCE(s.minimum_order,0) minimum_order,COALESCE(s.opens_at,'') opens_at,COALESCE(s.closes_at,'') closes_at,COALESCE(s.accepting,1) accepting";
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** Whether the time is inside an outlet's opening hours (Pakistan time). Hours may run past midnight. */
export function withinHours(s: Row, at = new Date()) {
  if (!s.opens_at || !s.closes_at) return true;
  const t = clock.format(at);
  return s.opens_at < s.closes_at
    ? t >= s.opens_at && t < s.closes_at
    : t >= s.opens_at || t < s.closes_at;
}
/** Whether an outlet takes orders right now: not paused, and inside its opening hours. */
export const outletOpen = (s: Row, at = new Date()) => !!s.accepting && withinHours(s, at);

/** Splits a delivered order between the outlet, the rider and Dellvit. Runs inside the delivery transaction. */
export async function recordSettlement(order: Row) {
  if (await one('SELECT order_id FROM order_settlements WHERE order_id=?', order.id)) return;
  const d = await one('SELECT discount,payment_type FROM order_details WHERE order_id=?', order.id);
  const rate = (await outletSettings(order.outlet_id)).commission_rate;
  const outletCommission = Math.round((order.subtotal * rate) / 100);
  const outletPayable = order.subtotal - outletCommission;
  const earning = await one(
    'SELECT amount,cash_collected FROM rider_earnings WHERE order_id=?',
    order.id,
  );
  const riderCommission = earning?.amount || 0;
  await run(
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

export async function cashPosition(uid: string) {
  const p = (await one(
    `SELECT (SELECT COALESCE(SUM(cash_collected),0) FROM rider_earnings WHERE rider_id=?) collected,(SELECT COALESCE(SUM(amount),0) FROM cod_deposits WHERE rider_id=? AND status='approved') approved,(SELECT COALESCE(SUM(amount),0) FROM cod_deposits WHERE rider_id=? AND status='pending') pending`,
    uid,
    uid,
    uid,
  ))!;
  const collected = p.collected as number,
    approved = p.approved as number,
    pending = p.pending as number;
  return { collected, approved, pending, in_hand: collected - approved - pending };
}
const depositMethods = ['cash_handover', 'bank', 'wallet', 'raast'] as const;

export function installFinance(app: Express) {
  /* ---------- Admin dashboard ---------- */
  app.get('/api/admin/summary', requireRole('admin'), async (req, res) => {
    const r = range(req);
    // Order counts come from the per-status totals, so the page needs two queries, run together.
    const [statusRows, totals] = await Promise.all([
      all(
        `SELECT status,COUNT(*) n FROM orders WHERE ${between('created_at')} GROUP BY status`,
        r.from,
        r.to,
      ),
      one(
        `SELECT COUNT(*) delivered,COALESCE(SUM(s.total),0) sales,COALESCE(SUM(s.outlet_payable),0) outlet_deducted,COALESCE(SUM(s.outlet_commission),0) outlet_commission,COALESCE(SUM(s.rider_commission),0) rider_commission,COALESCE(SUM(s.discount),0) coupon_deductions,COALESCE(SUM(s.store_net),0) store_sales,COALESCE(SUM(s.delivery_fee),0) delivery_fees,(SELECT COUNT(*) FROM outlets WHERE active=1) outlets FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE ${between('o.created_at')}`,
        r.from,
        r.to,
      ),
    ]);
    const statuses: Record<string, number> = Object.fromEntries(
      statusRows.map((x) => [x.status, x.n]),
    );
    const orders = statusRows.reduce((sum, x) => sum + x.n, 0);
    res.json({
      orders,
      cancelled: statuses.cancelled || 0,
      active_orders: orders - (statuses.delivered || 0) - (statuses.cancelled || 0),
      ...totals,
      // Kept for older clients.
      revenue: totals!.sales,
      statuses,
    });
  });

  /* ---------- Admin live queues (not tied to a time frame) ---------- */
  app.get('/api/admin/attention', requireRole('admin'), async (_req, res) => {
    const at = Date.now();
    const open = "o.status NOT IN ('delivered','cancelled')";
    // One round trip: every live count as a scalar subquery.
    const row = (await one(
      `SELECT
        (SELECT COUNT(*) FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.status='placed' AND f.payment_verified_at IS NOT NULL AND (f.sent_at IS NULL OR f.rider_status IN ('rejected','unsent'))) dispatch,
        (SELECT COUNT(*) FROM order_flow WHERE cancel_request<>'') cancel_requests,
        (SELECT COUNT(*) FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE ${open} AND f.outlet_status='rejected') outlet_declined,
        (SELECT COUNT(*) FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.status='placed' AND f.sent_at IS NOT NULL AND f.outlet_status='pending') awaiting_outlet,
        (SELECT COUNT(*) FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE ${open} AND f.sent_at IS NOT NULL AND f.rider_status='pending') awaiting_rider,
        (SELECT COUNT(*) FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.status IN ('confirmed','preparing','ready') AND f.sent_at IS NOT NULL AND (o.rider_id IS NULL OR f.rider_status='rejected')) rider_needed,
        (SELECT COUNT(*) FROM orders o WHERE ${open} AND o.deliver_by<?) late,
        (SELECT COUNT(*) FROM orders o WHERE ${open}) active,
        (SELECT COUNT(*) FROM orders WHERE status='ready') ready,
        (SELECT COUNT(*) FROM orders WHERE status='picked_up') on_the_road,
        (SELECT COUNT(*) FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.payment_status='submitted' AND o.status<>'cancelled') payments,
        (SELECT COALESCE(SUM(o.total),0) FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.payment_status='submitted' AND o.status<>'cancelled') payments_amount,
        (SELECT COUNT(*) FROM order_details WHERE payment_status='refund_due') refunds,
        (SELECT COALESCE(SUM(o.total),0) FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.payment_status='refund_due') refunds_amount,
        (SELECT COUNT(*) FROM payout_requests WHERE status='pending') payout_requests,
        (SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE status='pending') payout_amount,
        (SELECT COUNT(*) FROM cod_deposits WHERE status='pending') cod_deposits,
        (SELECT COALESCE(SUM(amount),0) FROM cod_deposits WHERE status='pending') cod_amount,
        (SELECT COUNT(*) FROM users u LEFT JOIN rider_state s ON s.user_id=u.id WHERE u.role='rider' AND u.active=1 AND COALESCE(s.available,1)=1) riders_available,
        (SELECT COUNT(DISTINCT o.rider_id) FROM orders o WHERE ${open} AND o.rider_id IS NOT NULL) riders_busy,
        (SELECT COUNT(*) FROM users WHERE role='rider' AND active=1) riders_total,
        (SELECT COUNT(*) FROM products WHERE active=1 AND stock=0) out_of_stock,
        (SELECT COUNT(*) FROM products WHERE active=1 AND stock>0 AND stock<10) low_stock,
        (SELECT COUNT(*) FROM outlets o LEFT JOIN outlet_settings s ON s.outlet_id=o.id WHERE o.active=1 AND COALESCE(s.accepting,1)=0) outlets_paused,
        (SELECT COUNT(*) FROM outlets WHERE active=1) outlets_total,
        (SELECT COUNT(*) FROM messages WHERE created_at>=?) messages`,
      new Date(at).toISOString(),
      new Date(at - 86400000).toISOString(),
    ))!;
    res.json({ ...row, checked_at: new Date(at).toISOString() });
  });

  /* ---------- Outlet dashboard ---------- */
  const myOutlet = async (req: AuthRequest) => {
    const o = await one('SELECT * FROM outlets WHERE user_id=?', req.user!.id);
    if (!o) fail('Outlet not found.', 404);
    return o;
  };
  app.get('/api/manage/outlet/summary', requireRole('outlet'), async (req: AuthRequest, res) => {
    const outlet = await myOutlet(req);
    const r = range(req);
    const scope = `o.outlet_id=? AND f.sent_at IS NOT NULL AND ${between('o.created_at')}`;
    const args = [outlet.id, r.from, r.to];
    const statuses = Object.fromEntries(
      (
        await all(
          `SELECT o.status,COUNT(*) n FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE ${scope} GROUP BY o.status`,
          ...args,
        )
      ).map((x) => [x.status, x.n]),
    );
    const totals = (await one(
      `SELECT COUNT(*) delivered,COALESCE(SUM(s.subtotal),0) sales,COALESCE(SUM(s.outlet_commission),0) commission,COALESCE(SUM(s.outlet_payable),0) payable FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.outlet_id=? AND ${between('o.created_at')}`,
      outlet.id,
      r.from,
      r.to,
    ))!;
    res.json({
      outlet: { ...outlet, ...(await outletOwnSettings(outlet.id)) },
      statuses,
      orders: Object.values(statuses).reduce((a: number, b) => a + Number(b), 0),
      awaiting_response: (await one(
        "SELECT COUNT(*) n FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.outlet_id=? AND o.status='placed' AND f.outlet_status='pending'",
        outlet.id,
      ))!.n,
      in_kitchen: (await one(
        "SELECT COUNT(*) n FROM orders WHERE outlet_id=? AND status IN ('confirmed','preparing')",
        outlet.id,
      ))!.n,
      awaiting_pickup: (await one(
        "SELECT COUNT(*) n FROM orders WHERE outlet_id=? AND status='ready'",
        outlet.id,
      ))!.n,
      late: (await one(
        "SELECT COUNT(*) n FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE o.outlet_id=? AND f.sent_at IS NOT NULL AND o.status NOT IN ('delivered','cancelled') AND o.deliver_by<?",
        outlet.id,
        now(),
      ))!.n,
      out_of_stock: (await one(
        'SELECT COUNT(*) n FROM products WHERE outlet_id=? AND active=1 AND stock=0',
        outlet.id,
      ))!.n,
      low_stock_count: (await one(
        'SELECT COUNT(*) n FROM products WHERE outlet_id=? AND active=1 AND stock>0 AND stock<10',
        outlet.id,
      ))!.n,
      checked_at: now(),
      ...totals,
      average_order: totals.delivered ? Math.round(totals.sales / totals.delivered) : 0,
      top_products: await all(
        `SELECT i.product_id,MAX(i.name) name,MAX(i.image) image,SUM(i.quantity) quantity,SUM(i.quantity*i.unit_price) revenue FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.outlet_id=? AND o.status='delivered' AND ${between('o.created_at')} GROUP BY i.product_id ORDER BY quantity DESC LIMIT 5`,
        outlet.id,
        r.from,
        r.to,
      ),
      low_stock: (
        await all(
          'SELECT id,name,stock,images FROM products WHERE outlet_id=? AND active=1 AND stock<10 ORDER BY stock ASC LIMIT 6',
          outlet.id,
        )
      ).map((p) => ({ ...p, image: JSON.parse(p.images)[0], images: undefined })),
      daily: await all(
        `SELECT substr(o.created_at,1,10) AS "day",COUNT(*) orders,COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.subtotal ELSE 0 END),0) sales FROM orders o JOIN order_flow f ON f.order_id=o.id WHERE ${scope} GROUP BY 1 ORDER BY 1`,
        ...args,
      ),
    });
  });
  app.get(
    '/api/manage/outlet/settlements',
    requireRole('outlet'),
    async (req: AuthRequest, res) => {
      const outlet = await myOutlet(req);
      res.json(
        await all(
          'SELECT s.*,o.reference,o.created_at order_created_at FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.outlet_id=? ORDER BY s.created_at DESC',
          outlet.id,
        ),
      );
    },
  );
  app.patch(
    '/api/manage/outlet/settings',
    requireRole('outlet'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z.object({ accepting: z.boolean() }).parse(req.body);
      const outlet = await myOutlet(req);
      await saveOutletSettings(outlet.id, { accepting: Number(p.accepting) });
      await notify(await adminsWith('outlets'), {
        type: 'order',
        title: p.accepting ? 'Outlet reopened' : 'Outlet paused orders',
        body: `${outlet.name} ${p.accepting ? 'is accepting orders again.' : 'stopped accepting new orders.'}`,
        link: '/admin?tab=outlets',
      });
      res.json({ ok: true, ...(await outletOwnSettings(outlet.id)) });
    }),
  );

  /* ---------- Rider cash on delivery ---------- */
  async function cashStatement(uid: string, req: Request) {
    const r = range(req);
    const [position, ranges, collections, deposits] = await Promise.all([
      cashPosition(uid),
      one(
        `SELECT (SELECT COALESCE(SUM(cash_collected),0) FROM rider_earnings WHERE rider_id=? AND ${between('created_at')}) collected_range,(SELECT COALESCE(SUM(amount),0) FROM cod_deposits WHERE rider_id=? AND status='approved' AND ${between('created_at')}) submitted_range`,
        uid,
        r.from,
        r.to,
        uid,
        r.from,
        r.to,
      ),
      all(
        'SELECT e.order_id,e.cash_collected amount,e.created_at,o.reference,o.name customer FROM rider_earnings e JOIN orders o ON o.id=e.order_id WHERE e.rider_id=? AND e.cash_collected>0 ORDER BY e.created_at DESC',
        uid,
      ),
      all(
        'SELECT d.*,u.name reviewer_name FROM cod_deposits d LEFT JOIN users u ON u.id=d.reviewed_by WHERE d.rider_id=? ORDER BY d.created_at DESC',
        uid,
      ),
    ]);
    return {
      ...position,
      collected_range: ranges!.collected_range,
      submitted_range: ranges!.submitted_range,
      collections,
      deposits,
    };
  }
  app.get('/api/rider/cash', requireRole('rider'), async (req: AuthRequest, res) =>
    res.json(await cashStatement(req.user!.id, req)),
  );
  app.post(
    '/api/rider/cash/deposits',
    requireRole('rider'),
    atomicRoute(async (req: AuthRequest, res) => {
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
      await transaction(async () => {
        if (p.amount > (await cashPosition(req.user!.id)).in_hand)
          fail('You cannot submit more cash than you are holding.');
        await run(
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
      await notify(await adminsWith('riders'), {
        type: 'payment',
        title: 'COD cash submitted',
        body: `${req.user!.name} submitted ${money(p.amount)} for verification.`,
        link: '/admin?tab=cash',
      });
      res.status(201).json({ id, ...(await cashPosition(req.user!.id)) });
    }),
  );
  app.delete(
    '/api/rider/cash/deposits/:id',
    requireRole('rider'),
    atomicRoute(async (req: AuthRequest, res) => {
      const r = await run(
        "UPDATE cod_deposits SET status='cancelled' WHERE id=? AND rider_id=? AND status='pending'",
        String(req.params.id),
        req.user!.id,
      );
      if (!r.changes) fail('Only pending submissions can be withdrawn.');
      res.json({ ok: true });
    }),
  );
  app.get('/api/admin/cash', requireRole('admin'), async (req, res) => {
    const r = range(req);
    // Three queries, run together, however many riders there are.
    const [rows, totals, deposits] = await Promise.all([
      all(
        `SELECT u.id,u.name,u.login_id,u.phone,u.location_id,u.active,(SELECT COALESCE(SUM(cash_collected),0) FROM rider_earnings WHERE rider_id=u.id) collected,(SELECT COALESCE(SUM(amount),0) FROM cod_deposits WHERE rider_id=u.id AND status='approved') approved,(SELECT COALESCE(SUM(amount),0) FROM cod_deposits WHERE rider_id=u.id AND status='pending') pending FROM users u WHERE u.role='rider' ORDER BY u.name`,
      ),
      one(
        `SELECT (SELECT COALESCE(SUM(cash_collected),0) FROM rider_earnings WHERE ${between('created_at')}) collected_range,(SELECT COALESCE(SUM(amount),0) FROM cod_deposits WHERE status='approved' AND ${between('created_at')}) approved_range`,
        r.from,
        r.to,
        r.from,
        r.to,
      ),
      all(
        'SELECT d.*,u.name rider_name,u.login_id,a.name reviewer_name FROM cod_deposits d JOIN users u ON u.id=d.rider_id LEFT JOIN users a ON a.id=d.reviewed_by ORDER BY d.created_at DESC',
      ),
    ]);
    const riders = rows.map((u): Row => ({ ...u, in_hand: u.collected - u.approved - u.pending }));
    res.json({
      riders,
      totals: {
        in_hand: riders.reduce((s, x) => s + x.in_hand, 0),
        pending: riders.reduce((s, x) => s + x.pending, 0),
        collected_range: totals!.collected_range,
        approved_range: totals!.approved_range,
      },
      deposits,
    });
  });
  app.get('/api/admin/cash/riders/:id', requireRole('admin'), async (req, res) => {
    const id = String(req.params.id);
    if (!(await one("SELECT id FROM users WHERE id=? AND role='rider'", id)))
      fail('Rider not found.', 404);
    res.json(await cashStatement(id, req));
  });
  app.patch(
    '/api/admin/cash/deposits/:id',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          decision: z.enum(['approve', 'reject']),
          note: z.string().trim().max(300).default(''),
        })
        .parse(req.body);
      const d = await one('SELECT * FROM cod_deposits WHERE id=?', String(req.params.id));
      if (!d) fail('Submission not found.', 404);
      if (d.status !== 'pending') fail('This submission has already been reviewed.');
      if (p.decision === 'reject' && !p.note)
        fail('Tell the rider why the submission was rejected.');
      await run(
        'UPDATE cod_deposits SET status=?,reviewed_by=?,reviewed_at=?,review_note=? WHERE id=?',
        p.decision === 'approve' ? 'approved' : 'rejected',
        req.user!.id,
        now(),
        p.note,
        d.id,
      );
      await notify([d.rider_id], {
        type: 'payment',
        title: p.decision === 'approve' ? 'Cash submission verified' : 'Cash submission rejected',
        body:
          p.decision === 'approve'
            ? `${money(d.amount)} was received by Dellvit.`
            : `${money(d.amount)}: ${p.note}`,
        link: '/portal/rider?tab=cash',
      });
      res.json({ ok: true });
    }),
  );

  /* ---------- Rider payout requests ---------- */
  app.post(
    '/api/rider/payout-requests',
    requireRole('rider'),
    atomicRoute(async (req: AuthRequest, res) => {
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
      await transaction(async () => {
        if (
          p.amount >
          (await riderBalance(req.user!.id)).balance - (await pendingPayouts(req.user!.id))
        )
          fail('The request is more than your available balance.');
        await run(
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
      await notify(await adminsWith('riders'), {
        type: 'payout',
        title: 'Payout requested',
        body: `${req.user!.name} requested ${money(p.amount)}.`,
        link: '/admin?tab=payouts',
      });
      res.status(201).json({ id });
    }),
  );
  app.delete(
    '/api/rider/payout-requests/:id',
    requireRole('rider'),
    atomicRoute(async (req: AuthRequest, res) => {
      const r = await run(
        "UPDATE payout_requests SET status='cancelled' WHERE id=? AND rider_id=? AND status='pending'",
        String(req.params.id),
        req.user!.id,
      );
      if (!r.changes) fail('Only pending requests can be withdrawn.');
      res.json({ ok: true });
    }),
  );
  app.get('/api/admin/payouts', requireRole('admin'), async (req, res) => {
    const r = range(req);
    const earned = (rider: string) =>
      `(SELECT COALESCE(SUM(amount),0) FROM rider_earnings WHERE rider_id=${rider})`;
    const paid = (rider: string) =>
      `(SELECT COALESCE(SUM(amount),0) FROM rider_payouts WHERE rider_id=${rider})`;
    // Four queries, run together, however many riders and requests there are.
    const [rows, totals, requestRows, payouts] = await Promise.all([
      all(
        `SELECT u.id,u.name,u.login_id,${earned('u.id')} earned,${paid('u.id')} paid,(SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE rider_id=u.id AND status='pending') pending FROM users u WHERE u.role='rider' ORDER BY u.name`,
      ),
      one(
        `SELECT (SELECT COALESCE(SUM(amount),0) FROM rider_payouts WHERE ${between('created_at')}) paid_range,(SELECT COALESCE(SUM(amount),0) FROM rider_earnings WHERE ${between('created_at')}) earned_range`,
        r.from,
        r.to,
        r.from,
        r.to,
      ),
      all(
        `SELECT q.*,u.name rider_name,u.login_id,a.name reviewer_name,${earned('q.rider_id')} rider_earned,${paid('q.rider_id')} rider_paid FROM payout_requests q JOIN users u ON u.id=q.rider_id LEFT JOIN users a ON a.id=q.reviewed_by ORDER BY q.created_at DESC`,
      ),
      all(
        'SELECT p.*,u.name rider_name,u.login_id,a.name issued_by FROM rider_payouts p JOIN users u ON u.id=p.rider_id LEFT JOIN users a ON a.id=p.created_by ORDER BY p.created_at DESC',
      ),
    ]);
    const riders = rows.map((u): Row => {
      const balance = u.earned - u.paid;
      return { ...u, balance, available: balance - u.pending };
    });
    res.json({
      riders,
      totals: {
        balance: riders.reduce((s, x) => s + x.balance, 0),
        pending: riders.reduce((s, x) => s + x.pending, 0),
        paid_range: totals!.paid_range,
        earned_range: totals!.earned_range,
      },
      requests: requestRows.map(({ rider_earned, rider_paid, ...q }) => ({
        ...q,
        balance: rider_earned - rider_paid,
      })),
      payouts,
    });
  });
  app.post(
    '/api/admin/payouts/requests/:id',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          decision: z.enum(['approve', 'reject']),
          method: z.enum(payoutMethods).optional(),
          reference: z.string().trim().max(80).default(''),
          note: z.string().trim().max(300).default(''),
        })
        .parse(req.body);
      const q = await one('SELECT * FROM payout_requests WHERE id=?', String(req.params.id));
      if (!q) fail('Request not found.', 404);
      if (q.status !== 'pending') fail('This request has already been reviewed.');
      if (p.decision === 'reject') {
        if (!p.note) fail('Tell the rider why the request was rejected.');
        await run(
          "UPDATE payout_requests SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=?",
          req.user!.id,
          now(),
          p.note,
          q.id,
        );
        await notify([q.rider_id], {
          type: 'payout',
          title: 'Payout request rejected',
          body: `${money(q.amount)}: ${p.note}`,
          link: '/portal/rider?tab=earnings',
        });
        return res.json({ ok: true });
      }
      const payoutId = randomUUID();
      await transaction(async () => {
        if (q.amount > (await riderBalance(q.rider_id)).balance)
          fail('The request is more than the rider’s current balance.');
        await insertPayout({
          id: payoutId,
          rider_id: q.rider_id,
          amount: q.amount,
          note: p.note || q.note,
          created_by: req.user!.id,
          method: p.method || q.method,
          reference: p.reference,
          type: 'request',
        });
        await run(
          "UPDATE payout_requests SET status='approved',reviewed_by=?,reviewed_at=?,review_note=?,payout_id=? WHERE id=?",
          req.user!.id,
          now(),
          p.note,
          payoutId,
          q.id,
        );
      });
      await notify([q.rider_id], {
        type: 'payout',
        title: 'Payout approved',
        body: `${money(q.amount)} has been paid out to you.`,
        link: '/portal/rider?tab=earnings',
      });
      res.json({ ok: true });
    }),
  );
}
