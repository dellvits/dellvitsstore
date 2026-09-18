import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, all, one, run, transaction, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify, adminsWith, outletUser } from './notifications.js';

/**
 * Order workflow
 *
 *   placed ──(payment verified)──> admin assigns an on-duty rider and sends the order
 *          ──> outlet and rider both accept ──> confirmed
 *   confirmed ──outlet──> preparing ──outlet──> ready ──rider──> picked_up ──rider (OTP)──> delivered
 *
 * An outlet rejection cancels the order. A rider rejection only unassigns the rider so the
 * admin can send it to someone else. Delivered orders are locked.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS order_flow(order_id TEXT PRIMARY KEY REFERENCES orders(id),sent_at TEXT,sent_by TEXT,outlet_status TEXT NOT NULL DEFAULT 'unsent',outlet_responded_at TEXT,outlet_note TEXT NOT NULL DEFAULT '',rider_status TEXT NOT NULL DEFAULT 'unsent',rider_responded_at TEXT,rider_note TEXT NOT NULL DEFAULT '',rider_rejections INTEGER NOT NULL DEFAULT 0,payment_verified_at TEXT,cancel_reason TEXT NOT NULL DEFAULT '',cancelled_by TEXT,cancel_request TEXT NOT NULL DEFAULT '',cancel_request_at TEXT,reminders INTEGER NOT NULL DEFAULT 0,last_reminder_at TEXT);
`);
const eventColumns = all('PRAGMA table_info(order_events)').map((c) => c.name);
if (!eventColumns.includes('note'))
  db.exec("ALTER TABLE order_events ADD COLUMN note TEXT NOT NULL DEFAULT ''");
if (!eventColumns.includes('actor'))
  db.exec("ALTER TABLE order_events ADD COLUMN actor TEXT NOT NULL DEFAULT ''");
// Orders created before the workflow existed were already confirmed the old way.
db.exec(`INSERT OR IGNORE INTO order_flow(order_id,sent_at,outlet_status,rider_status,payment_verified_at)
  SELECT o.id,
    CASE WHEN o.status='placed' THEN NULL ELSE o.created_at END,
    CASE WHEN o.status='placed' THEN 'unsent' ELSE 'accepted' END,
    CASE WHEN o.status='placed' THEN 'unsent' WHEN o.rider_id IS NULL THEN 'unsent' ELSE 'accepted' END,
    CASE WHEN d.payment_type IS NULL OR d.payment_type='cod' OR d.payment_status='paid' THEN o.created_at END
  FROM orders o LEFT JOIN order_details d ON d.order_id=o.id`);

const now = () => new Date().toISOString();
const money = (paisa: number) => 'PKR ' + (paisa / 100).toLocaleString('en-PK');
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export const terminal = ['delivered', 'cancelled'];

export function addEvent(orderId: string, status: string, note = '', actor = '') {
  run(
    'INSERT INTO order_events(id,order_id,status,created_at,note,actor) VALUES(?,?,?,?,?,?)',
    randomUUID(),
    orderId,
    status,
    now(),
    note,
    actor,
  );
}
export function createFlow(orderId: string) {
  run('INSERT OR IGNORE INTO order_flow(order_id) VALUES(?)', orderId);
}
export function flow(orderId: string): Row {
  createFlow(orderId);
  return one('SELECT * FROM order_flow WHERE order_id=?', orderId)!;
}
/** Records that the order's payment is verified. Safe to call more than once. */
export function markPaymentVerified(orderId: string) {
  const f = flow(orderId);
  if (f.payment_verified_at) return false;
  run('UPDATE order_flow SET payment_verified_at=? WHERE order_id=?', now(), orderId);
  addEvent(orderId, 'payment_verified');
  return true;
}
export function clearPaymentVerified(orderId: string) {
  run('UPDATE order_flow SET payment_verified_at=NULL WHERE order_id=?', orderId);
}

/** Who may cancel at each stage. After delivery nobody can. */
const cancelRoles: Record<string, string[]> = {
  placed: ['admin', 'customer'],
  confirmed: ['admin', 'customer'],
  preparing: ['admin'],
  ready: ['admin', 'customer'],
  picked_up: ['admin', 'customer'],
};
export const canCancel = (status: string, role?: string) =>
  !!role && (cancelRoles[status] || []).includes(role);

/** Cancels inside the caller's transaction: restores stock and coupon use, flags refunds. */
export function cancelOrder(o: Row, by: string, reason: string) {
  if (terminal.includes(o.status)) fail('This order is already closed.');
  run("UPDATE orders SET status='cancelled' WHERE id=?", o.id);
  for (const item of all('SELECT * FROM order_items WHERE order_id=?', o.id))
    run('UPDATE products SET stock=stock+? WHERE id=?', item.quantity, item.product_id);
  run('DELETE FROM coupon_uses WHERE order_id=?', o.id);
  run(
    "UPDATE order_details SET payment_status='refund_due',payment_updated_at=? WHERE order_id=? AND payment_type<>'cod' AND payment_status='paid'",
    now(),
    o.id,
  );
  run(
    "UPDATE order_flow SET cancel_reason=?,cancelled_by=?,cancel_request='',cancel_request_at=NULL,outlet_status=CASE WHEN outlet_status='pending' THEN 'unsent' ELSE outlet_status END WHERE order_id=?",
    reason,
    by,
    o.id,
  );
  addEvent(o.id, 'cancelled', reason, by);
}
export function notifyCancelled(o: Row, by: string, reason: string) {
  const who =
    by === 'customer'
      ? 'the customer'
      : by === 'outlet'
        ? 'the outlet'
        : by === 'system'
          ? 'the payment system'
          : 'Dellvit support';
  notify([o.user_id], {
    type: 'order',
    title: 'Order cancelled',
    body: `${o.reference} was cancelled by ${who}${reason ? ': ' + reason : '.'}`,
    link: '/orders/' + o.id,
  });
  const f = flow(o.id);
  notify([f.sent_at ? outletUser(o.outlet_id) : null, f.sent_at ? o.rider_id : null], {
    type: 'order',
    title: 'Order cancelled',
    body: `${o.reference} was cancelled by ${who}.`,
    link: '/portal/outlet',
  });
  if (by !== 'admin')
    notify(adminsWith('orders'), {
      type: 'order',
      title: 'Order cancelled',
      body: `${o.reference} was cancelled by ${who}${reason ? ': ' + reason : '.'}`,
      link: '/admin?tab=orders',
    });
}

/** A rider can take a delivery when active, on duty, in the area and below capacity. */
export function riderProblem(riderId: string, o: Row) {
  const r = one("SELECT * FROM users WHERE id=? AND role='rider'", riderId);
  if (!r || !r.active) return 'This rider account is disabled.';
  if (r.location_id !== o.location_id) return 'This rider works in another delivery area.';
  const state = one('SELECT available,capacity FROM rider_state WHERE user_id=?', riderId);
  if (state?.available === 0) return 'This rider is off duty.';
  const load = one(
    "SELECT COUNT(*) n FROM orders WHERE rider_id=? AND id<>? AND status NOT IN ('delivered','cancelled')",
    riderId,
    o.id,
  )!.n;
  if (load >= (state?.capacity ?? 5)) return 'This rider has reached their delivery capacity.';
  return '';
}

function maybeConfirm(orderId: string) {
  const o = one('SELECT * FROM orders WHERE id=?', orderId)!;
  const f = flow(orderId);
  if (o.status !== 'placed' || f.outlet_status !== 'accepted' || f.rider_status !== 'accepted')
    return false;
  const duration = Math.max(0, Date.parse(o.deliver_by) - Date.parse(o.created_at));
  run(
    "UPDATE orders SET status='confirmed',deliver_by=? WHERE id=?",
    new Date(Date.now() + duration).toISOString(),
    o.id,
  );
  addEvent(o.id, 'confirmed', 'Outlet and rider accepted', 'system');
  return true;
}
function notifyConfirmed(o: Row) {
  notify([o.user_id], {
    type: 'order',
    title: 'Order confirmed',
    body: `${o.reference} · The outlet and your rider have accepted your order.`,
    link: '/orders/' + o.id,
  });
  notify([outletUser(o.outlet_id)], {
    type: 'order',
    title: 'Order confirmed — start preparing',
    body: `${o.reference} is confirmed. Mark it as preparing when you begin.`,
    link: '/portal/outlet?tab=orders',
  });
  notify([o.rider_id], {
    type: 'delivery',
    title: 'Delivery confirmed',
    body: `${o.reference} is confirmed. Head to ${one('SELECT name FROM outlets WHERE id=?', o.outlet_id)?.name || 'the outlet'} when it is ready.`,
    link: '/portal/rider',
  });
  notify(adminsWith('orders'), {
    type: 'order',
    title: 'Order confirmed',
    body: `${o.reference} was accepted by the outlet and rider.`,
    link: '/admin?tab=orders',
  });
}
const load = (id: string) => {
  const o = one('SELECT * FROM orders WHERE id=?', id);
  if (!o) fail('Order not found.', 404);
  return o;
};
function sendRiderRequest(o: Row, riderId: string) {
  notify([riderId], {
    type: 'delivery',
    title: 'New delivery request',
    body: `${o.reference} · ${money(o.total)} · ${String(o.address).slice(0, 70)}. Accept or decline.`,
    link: '/portal/rider',
  });
}

export function installWorkflow(app: Express) {
  const note = z.string().trim().max(300).default('');

  /** Riders in the order's area with their eligibility, for the dispatch picker. */
  app.get('/api/admin/orders/:id/riders', requireRole('admin'), (req, res) => {
    const o = load(String(req.params.id));
    res.json(
      all(
        "SELECT u.id,u.name,u.phone,u.login_id,u.location_id,u.active,COALESCE(s.available,1) available,COALESCE(s.capacity,5) capacity,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status NOT IN ('delivered','cancelled')) load,s.updated_at FROM users u LEFT JOIN rider_state s ON s.user_id=u.id WHERE u.role='rider' AND u.location_id=? ORDER BY available DESC,load ASC,u.name",
        o.location_id,
      ).map((r) => ({ ...r, problem: riderProblem(r.id, o) })),
    );
  });

  /** Assigns (or reassigns) a rider. Once an order is sent, the new rider gets a request. */
  app.patch('/api/admin/orders/:id/assign', requireRole('admin'), (req: AuthRequest, res) => {
    const { rider_id } = z.object({ rider_id: z.string().max(100) }).parse(req.body);
    const o = load(String(req.params.id));
    if (o.status === 'delivered') fail('A completed order cannot be modified.');
    if (['cancelled', 'picked_up'].includes(o.status))
      fail('The rider cannot be changed after pickup or cancellation.');
    const problem = riderProblem(rider_id, o);
    if (problem) fail(problem);
    const f = flow(o.id);
    const changed = o.rider_id !== rider_id;
    transaction(() => {
      run('UPDATE orders SET rider_id=? WHERE id=?', rider_id, o.id);
      if (changed && f.sent_at) {
        run(
          "UPDATE order_flow SET rider_status='pending',rider_responded_at=NULL,rider_note='' WHERE order_id=?",
          o.id,
        );
        addEvent(
          o.id,
          'rider_requested',
          one('SELECT name FROM users WHERE id=?', rider_id)!.name,
          'admin',
        );
      }
    });
    if (changed && f.sent_at) {
      sendRiderRequest(o, rider_id);
      if (o.rider_id)
        notify([o.rider_id], {
          type: 'delivery',
          title: 'Delivery reassigned',
          body: `${o.reference} was assigned to another rider.`,
          link: '/portal/rider',
        });
    }
    res.json({ ok: true });
  });

  /** Sends a paid order to its outlet and rider for confirmation. */
  app.post('/api/admin/orders/:id/dispatch', requireRole('admin'), (req: AuthRequest, res) => {
    const p = z.object({ rider_id: z.string().max(100).optional() }).parse(req.body || {});
    const o = load(String(req.params.id));
    if (o.status !== 'placed') fail('Only new orders can be sent for confirmation.');
    const f = flow(o.id);
    if (!f.payment_verified_at) fail('Verify the payment before sending this order.');
    const riderId = p.rider_id || o.rider_id;
    if (!riderId) fail('Assign an on-duty rider before sending the order.');
    const problem = riderProblem(riderId, o);
    if (problem) fail(problem);
    const resend = !!f.sent_at;
    transaction(() => {
      run('UPDATE orders SET rider_id=? WHERE id=?', riderId, o.id);
      run(
        `UPDATE order_flow SET sent_at=?,sent_by=?,
          outlet_status=CASE WHEN outlet_status='accepted' THEN 'accepted' ELSE 'pending' END,
          rider_status=CASE WHEN rider_status='accepted' AND ?=? THEN 'accepted' ELSE 'pending' END
         WHERE order_id=?`,
        now(),
        req.user!.id,
        riderId,
        o.rider_id || '',
        o.id,
      );
      addEvent(o.id, resend ? 'resent' : 'sent', 'Waiting for outlet and rider', 'admin');
    });
    const after = flow(o.id);
    if (after.outlet_status === 'pending')
      notify([outletUser(o.outlet_id)], {
        type: 'order',
        title: 'New order request',
        body: `${o.reference} · ${money(o.subtotal)}. Accept or reject this order.`,
        link: '/portal/outlet?tab=orders',
      });
    if (after.rider_status === 'pending') sendRiderRequest(o, riderId);
    if (!resend)
      notify([o.user_id], {
        type: 'order',
        title: 'Confirming your order',
        body: `${o.reference} · We’re confirming your order with the outlet and a rider.`,
        link: '/orders/' + o.id,
      });
    res.json({ ok: true });
  });

  app.post('/api/orders/:id/outlet-response', requireRole('outlet'), (req: AuthRequest, res) => {
    const p = z.object({ decision: z.enum(['accept', 'reject']), note }).parse(req.body);
    const o = load(String(req.params.id));
    const outlet = one('SELECT id FROM outlets WHERE user_id=?', req.user!.id);
    if (o.outlet_id !== outlet?.id) fail('Order not found.', 404);
    const f = flow(o.id);
    if (o.status !== 'placed' || f.outlet_status !== 'pending')
      fail('This order is not waiting for your response.');
    if (p.decision === 'reject') {
      const reason = p.note || 'The outlet is unable to fulfil this order.';
      transaction(() => {
        run(
          "UPDATE order_flow SET outlet_status='rejected',outlet_responded_at=?,outlet_note=? WHERE order_id=?",
          now(),
          reason,
          o.id,
        );
        cancelOrder(o, 'outlet', reason);
      });
      notifyCancelled(o, 'outlet', reason);
      return res.json({ ok: true, status: 'cancelled' });
    }
    let confirmed = false;
    transaction(() => {
      run(
        "UPDATE order_flow SET outlet_status='accepted',outlet_responded_at=?,outlet_note=? WHERE order_id=?",
        now(),
        p.note,
        o.id,
      );
      addEvent(o.id, 'outlet_accepted', p.note, 'outlet');
      confirmed = maybeConfirm(o.id);
    });
    if (confirmed) notifyConfirmed(one('SELECT * FROM orders WHERE id=?', o.id)!);
    else
      notify(adminsWith('orders'), {
        type: 'order',
        title: 'Outlet accepted',
        body: `${o.reference} · waiting for the rider to accept.`,
        link: '/admin?tab=orders',
      });
    res.json({ ok: true, status: confirmed ? 'confirmed' : 'placed' });
  });

  app.post('/api/orders/:id/rider-response', requireRole('rider'), (req: AuthRequest, res) => {
    const p = z.object({ decision: z.enum(['accept', 'reject']), note }).parse(req.body);
    const o = load(String(req.params.id));
    const f = flow(o.id);
    if (o.rider_id !== req.user!.id || !f.sent_at) fail('Order not found.', 404);
    if (f.rider_status !== 'pending' || terminal.includes(o.status) || o.status === 'picked_up')
      fail('This delivery is not waiting for your response.');
    if (p.decision === 'reject') {
      transaction(() => {
        run('UPDATE orders SET rider_id=NULL WHERE id=?', o.id);
        run(
          "UPDATE order_flow SET rider_status='rejected',rider_responded_at=?,rider_note=?,rider_rejections=rider_rejections+1 WHERE order_id=?",
          now(),
          p.note,
          o.id,
        );
        addEvent(o.id, 'rider_rejected', [req.user!.name, p.note].filter(Boolean).join(': '), 'rider');
      });
      notify(adminsWith('orders'), {
        type: 'order',
        title: 'Rider declined a delivery',
        body: `${req.user!.name} declined ${o.reference}${p.note ? ` (${p.note})` : ''}. Assign another rider.`,
        link: '/admin?tab=orders',
      });
      return res.json({ ok: true });
    }
    if (one('SELECT available FROM rider_state WHERE user_id=?', req.user!.id)?.available === 0)
      fail('Go on duty before accepting deliveries.');
    let confirmed = false;
    transaction(() => {
      run(
        "UPDATE order_flow SET rider_status='accepted',rider_responded_at=?,rider_note=? WHERE order_id=?",
        now(),
        p.note,
        o.id,
      );
      addEvent(o.id, 'rider_accepted', req.user!.name, 'rider');
      confirmed = maybeConfirm(o.id);
    });
    if (confirmed) notifyConfirmed(one('SELECT * FROM orders WHERE id=?', o.id)!);
    else
      notify(adminsWith('orders'), {
        type: 'order',
        title: 'Rider accepted',
        body: `${o.reference} · ${req.user!.name} accepted${o.status === 'placed' ? '; waiting for the outlet.' : '.'}`,
        link: '/admin?tab=orders',
      });
    res.json({ ok: true });
  });

  app.post('/api/admin/orders/:id/remind', requireRole('admin'), (req, res) => {
    const p = z.object({ message: note }).parse(req.body || {});
    const o = load(String(req.params.id));
    if (!['confirmed', 'preparing'].includes(o.status))
      fail('Reminders can be sent until the outlet marks the order ready.');
    run(
      'UPDATE order_flow SET reminders=reminders+1,last_reminder_at=? WHERE order_id=?',
      now(),
      o.id,
    );
    addEvent(o.id, 'reminder', p.message, 'admin');
    notify([outletUser(o.outlet_id)], {
      type: 'order',
      title: 'Reminder from Dellvit',
      body: `${o.reference}: ${p.message || (o.status === 'confirmed' ? 'Please start preparing this order.' : 'Please mark this order ready as soon as it is packed.')}`,
      link: '/portal/outlet?tab=orders',
    });
    res.json({ ok: true });
  });

  app.post('/api/orders/:id/cancel-request', requireRole('outlet'), (req: AuthRequest, res) => {
    const p = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    const o = load(String(req.params.id));
    const outlet = one('SELECT id FROM outlets WHERE user_id=?', req.user!.id);
    if (o.outlet_id !== outlet?.id) fail('Order not found.', 404);
    if (!['confirmed', 'preparing'].includes(o.status))
      fail('Cancellation can be requested only while the order is being prepared.');
    run(
      'UPDATE order_flow SET cancel_request=?,cancel_request_at=? WHERE order_id=?',
      p.reason,
      now(),
      o.id,
    );
    addEvent(o.id, 'cancel_requested', p.reason, 'outlet');
    notify(adminsWith('orders'), {
      type: 'order',
      title: 'Outlet requests cancellation',
      body: `${o.reference}: ${p.reason}`,
      link: '/admin?tab=orders',
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/orders/:id/cancel-request', requireRole('admin'), (req, res) => {
    const p = z.object({ decision: z.enum(['approve', 'dismiss']), note }).parse(req.body);
    const o = load(String(req.params.id));
    const f = flow(o.id);
    if (!f.cancel_request) fail('There is no open cancellation request.');
    if (p.decision === 'approve') {
      const reason = p.note || f.cancel_request;
      transaction(() => cancelOrder(o, 'admin', reason));
      notifyCancelled(o, 'admin', reason);
    } else {
      transaction(() => {
        run("UPDATE order_flow SET cancel_request='',cancel_request_at=NULL WHERE order_id=?", o.id);
        addEvent(o.id, 'cancel_request_dismissed', p.note, 'admin');
      });
      notify([outletUser(o.outlet_id)], {
        type: 'order',
        title: 'Cancellation request declined',
        body: `${o.reference}: please continue with this order.${p.note ? ' ' + p.note : ''}`,
        link: '/portal/outlet?tab=orders',
      });
    }
    res.json({ ok: true });
  });
}

/** Workflow fields added to every serialized order. */
export function serializeFlow(o: Row, role?: string) {
  const f = flow(o.id);
  return {
    flow: {
      sent_at: f.sent_at,
      outlet_status: f.outlet_status,
      outlet_note: f.outlet_note,
      outlet_responded_at: f.outlet_responded_at,
      rider_status: f.rider_status,
      rider_note: role === 'customer' ? '' : f.rider_note,
      rider_responded_at: f.rider_responded_at,
      rider_rejections: role === 'customer' ? 0 : f.rider_rejections,
      payment_verified_at: f.payment_verified_at,
      cancel_reason: f.cancel_reason,
      cancelled_by: f.cancelled_by,
      cancel_request: role === 'customer' ? '' : f.cancel_request,
      cancel_request_at: role === 'customer' ? null : f.cancel_request_at,
      reminders: role === 'customer' ? 0 : f.reminders,
      last_reminder_at: role === 'customer' ? null : f.last_reminder_at,
    },
    can_cancel: canCancel(o.status, role),
    locked: o.status === 'delivered',
  };
}
