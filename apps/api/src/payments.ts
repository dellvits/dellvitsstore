import type { Express, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { db, all, one, run, transaction, type Row } from './db.js';
import { can, isOnline, records } from './platform.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify, adminsWith } from './notifications.js';
import { cardGateway } from './cards.js';
import { cancelOrder, clearPaymentVerified, flow, markPaymentVerified } from './workflow.js';

const columns = all('PRAGMA table_info(order_details)').map((c) => c.name);
for (const [name, def] of [
  ['transaction_id', "TEXT NOT NULL DEFAULT ''"],
  ['payer_name', "TEXT NOT NULL DEFAULT ''"],
  ['payer_account', "TEXT NOT NULL DEFAULT ''"],
  ['proof_id', 'TEXT'],
  ['payment_note', "TEXT NOT NULL DEFAULT ''"],
  ['payment_details', "TEXT NOT NULL DEFAULT '{}'"],
  ['payment_updated_at', 'TEXT'],
  ['payment_reviewed_by', 'TEXT'],
  ['payment_reviewed_at', 'TEXT'],
])
  if (!columns.includes(name)) db.exec(`ALTER TABLE order_details ADD COLUMN ${name} ${def}`);
db.exec(
  'CREATE TABLE IF NOT EXISTS payment_proofs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),filename TEXT NOT NULL,created_at TEXT NOT NULL);',
);

const bankKeys = ['bank_name', 'account_title', 'account_number', 'iban', 'branch_code'];
const detailKeys: Record<string, string[]> = {
  bank: bankKeys,
  manual: bankKeys,
  wallet: ['provider', 'account_title', 'mobile_number'],
  raast: ['bank_name', 'account_title', 'raast_id'],
  // Public card details only: gateway secrets are never copied onto orders.
  card: ['gateway', 'card_networks'],
  cod: [],
};
/** Account details shown to the customer, copied onto the order when it is placed. */
export function paymentSnapshot(method: Row) {
  return Object.fromEntries(
    [...(detailKeys[method.type] || []), 'logo']
      .filter((k) => (Array.isArray(method[k]) ? method[k].length : method[k]))
      .map((k) => [k, method[k]]),
  );
}

export const paymentSubmission = z.object({
  transaction_id: z.string().trim().max(60).default(''),
  payer_name: z.string().trim().max(100).default(''),
  payer_account: z.string().trim().max(40).default(''),
  proof_id: z.string().max(100).optional(),
  /** Single-use token from the card gateway. Raw card numbers are never accepted. */
  card_token: z.string().trim().max(500).optional(),
});
type Submission = z.infer<typeof paymentSubmission>;

export function validateSubmission(
  method: Row,
  s: Submission | undefined,
  userId: string,
  orderId = '',
) {
  const fail = (m: string) => {
    throw Object.assign(new Error(m), { status: 400 });
  };
  if (!isOnline(method.type)) return;
  if (method.type === 'card') {
    if (!cardGateway(method))
      throw Object.assign(
        new Error('Card payments are not available right now. Please choose another payment method.'),
        { status: 503 },
      );
    if (!s?.card_token) fail('Enter your card details.');
    return;
  }
  if (!s || s.transaction_id.length < 4)
    fail('Enter the transaction ID (TID) from your payment receipt.');
  if (!s!.payer_name) fail('Enter the name on the account you paid from.');
  if (method.require_proof && !s!.proof_id) fail('Upload a screenshot of your payment receipt.');
  if (s!.proof_id && !one('SELECT id FROM payment_proofs WHERE id=? AND user_id=?', s!.proof_id, userId))
    fail('Upload your payment receipt again.');
  const duplicate = one(
    "SELECT d.order_id FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.transaction_id=? AND d.payment_type<>'cod' AND o.status<>'cancelled' AND o.id<>?",
    s!.transaction_id,
    orderId,
  );
  if (duplicate) fail('This transaction ID has already been used for another order.');
}

/** Cancels a card order whose charge failed, restoring stock and the coupon use. */
function cancelFailedCard(orderId: string, message: string) {
  transaction(() => {
    const o = one('SELECT * FROM orders WHERE id=?', orderId);
    if (o && o.status !== 'cancelled') cancelOrder(o, 'system', message);
    run(
      "UPDATE order_details SET payment_status='failed',payment_note=?,payment_updated_at=? WHERE order_id=?",
      message,
      new Date().toISOString(),
      orderId,
    );
  });
}
function markCardPaid(orderId: string, transactionId: string) {
  transaction(() => {
    run(
      "UPDATE order_details SET payment_status='paid',transaction_id=?,payment_note='',payment_updated_at=? WHERE order_id=?",
      transactionId,
      new Date().toISOString(),
      orderId,
    );
    markPaymentVerified(orderId);
  });
}
function notifyReadyToSend(o: Row, how: string) {
  notify(adminsWith('orders'), {
    type: 'order',
    title: 'Paid order ready to send',
    body: `${o.reference} has been ${how}. Assign a rider and send it to the outlet.`,
    link: '/admin?tab=orders',
  });
}

/** Charges a newly placed card order. Throws (after cancelling the order) when the card is declined. */
export async function chargeCardOrder(order: Row, method: Row, token: string) {
  const gateway = cardGateway(method)!;
  let result;
  try {
    result = await gateway.charge({
      method,
      token,
      amount: order.total,
      currency: 'PKR',
      reference: order.reference,
      customer: { name: order.name, email: order.email, phone: order.phone },
    });
  } catch {
    result = { status: 'failed' as const, message: 'The card payment could not be processed.' };
  }
  if (result.status === 'failed') {
    cancelFailedCard(order.id, result.message);
    throw Object.assign(new Error(result.message || 'Your card was declined.'), { status: 402 });
  }
  if (result.status === 'paid') {
    markCardPaid(order.id, result.transaction_id);
    return {};
  }
  run('UPDATE order_details SET transaction_id=? WHERE order_id=?', result.transaction_id, order.id);
  return { redirect_url: result.redirect_url };
}

export function installPayments(
  app: Express,
  { uploadDir, upload }: { uploadDir: string; upload: RequestHandler },
) {
  const proofDir = resolve(uploadDir, 'proofs');
  mkdirSync(proofDir, { recursive: true });
  app.post('/api/payment-proofs', requireRole('customer'), upload, async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a receipt image.' });
    const id = randomUUID();
    try {
      await sharp(req.file.buffer, { limitInputPixels: 24000000 })
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(resolve(proofDir, id + '.webp'));
    } catch {
      return res.status(400).json({ error: 'Upload a valid PNG, JPEG or WebP screenshot.' });
    }
    run(
      'INSERT INTO payment_proofs VALUES(?,?,?,?)',
      id,
      req.user!.id,
      id + '.webp',
      new Date().toISOString(),
    );
    res.status(201).json({ id, url: '/api/payment-proofs/' + id });
  });
  app.get('/api/payment-proofs/:id', requireRole('customer', 'admin'), (req: AuthRequest, res) => {
    const p = one('SELECT * FROM payment_proofs WHERE id=?', String(req.params.id));
    const allowed =
      p &&
      (p.user_id === req.user!.id ||
        (req.user!.role === 'admin' && (can(req.user, 'payments') || can(req.user, 'orders'))));
    if (!allowed || !existsSync(resolve(proofDir, p.filename)))
      return res.status(404).json({ error: 'Receipt not found.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(resolve(proofDir, p.filename));
  });
  app.post('/api/orders/:id/payment', requireRole('customer'), (req: AuthRequest, res) => {
    const o = one('SELECT * FROM orders WHERE id=? AND user_id=?', String(req.params.id), req.user!.id);
    const d = o && one('SELECT * FROM order_details WHERE order_id=?', o.id);
    if (!o || !d) return res.status(404).json({ error: 'Order not found.' });
    if (
      !isOnline(d.payment_type) ||
      d.payment_type === 'card' ||
      d.payment_status === 'paid' ||
      ['cancelled', 'delivered'].includes(o.status)
    )
      return res.status(400).json({ error: 'This order does not need a payment update.' });
    const s = paymentSubmission.parse(req.body);
    const method = records('payments').find((m) => m.id === o.payment_method) || {
      type: d.payment_type,
    };
    validateSubmission(method, s, req.user!.id, o.id);
    run(
      "UPDATE order_details SET transaction_id=?,payer_name=?,payer_account=?,proof_id=?,payment_status='submitted',payment_note='',payment_updated_at=?,payment_reviewed_by=NULL,payment_reviewed_at=NULL WHERE order_id=?",
      s.transaction_id,
      s.payer_name,
      s.payer_account,
      s.proof_id || null,
      new Date().toISOString(),
      o.id,
    );
    notify(adminsWith('payments'), {
      type: 'payment',
      title: 'Payment resubmitted',
      body: `${o.reference} · TID ${s.transaction_id}`,
      link: '/admin?tab=payments',
    });
    res.json({ ok: true });
  });
  const verify = (req: AuthRequest, res: any) => {
    const p = z
      .object({
        decision: z.enum(['approve', 'reject']).default('approve'),
        note: z.string().trim().max(300).default(''),
      })
      .parse(req.body || {});
    const o = one('SELECT * FROM orders WHERE id=?', String(req.params.id));
    const d = o && one('SELECT * FROM order_details WHERE order_id=?', o.id);
    if (!o || !d || o.status === 'cancelled')
      return res.status(404).json({ error: 'Order is unavailable.' });
    if (o.status === 'delivered')
      return res.status(400).json({ error: 'A completed order cannot be modified.' });
    if (!isOnline(d.payment_type))
      return res.status(400).json({ error: 'Cash orders are settled on delivery.' });
    if (d.payment_type === 'card')
      return res.status(400).json({ error: 'Card payments are confirmed by the card gateway.' });
    if (p.decision === 'reject' && !p.note)
      return res.status(400).json({ error: 'Tell the customer why the payment was rejected.' });
    if (p.decision === 'reject' && flow(o.id).sent_at)
      return res
        .status(400)
        .json({ error: 'This order was already sent to the outlet. Cancel it instead.' });
    transaction(() => {
      const at = new Date().toISOString();
      run(
        'UPDATE order_details SET payment_status=?,payment_note=?,payment_updated_at=?,payment_reviewed_by=?,payment_reviewed_at=? WHERE order_id=?',
        p.decision === 'approve' ? 'paid' : 'rejected',
        p.note,
        at,
        req.user!.id,
        at,
        o.id,
      );
      if (p.decision === 'approve') markPaymentVerified(o.id);
      else clearPaymentVerified(o.id);
    });
    if (p.decision === 'approve') {
      notify([o.user_id], {
        type: 'payment',
        title: 'Payment verified',
        body: `We received your payment for ${o.reference}.`,
        link: '/orders/' + o.id,
      });
      if (o.status === 'placed') notifyReadyToSend(o, 'paid online');
    } else
      notify([o.user_id], {
        type: 'payment',
        title: 'Payment could not be verified',
        body: `${o.reference}: ${p.note}`,
        link: '/orders/' + o.id,
      });
    res.json({ ok: true });
  };
  app.get('/api/admin/payments/queue', requireRole('admin'), (_req, res) =>
    res.json(
      all(
        "SELECT o.id,o.reference,o.name,o.phone,o.email,o.total,o.status,o.created_at,t.name outlet_name,d.payment_name,d.payment_type,d.payment_status,d.transaction_id,d.payer_name,d.payer_account,d.proof_id,d.payment_note,d.payment_updated_at,d.payment_details,d.payment_reviewed_at,r.name reviewer_name,r.email reviewer_email,f.cancel_reason FROM orders o JOIN order_details d ON d.order_id=o.id JOIN outlets t ON t.id=o.outlet_id LEFT JOIN users r ON r.id=d.payment_reviewed_by LEFT JOIN order_flow f ON f.order_id=o.id WHERE d.payment_type<>'cod' ORDER BY COALESCE(d.payment_updated_at,o.created_at) DESC",
      ).map(({ proof_id, ...r }) => ({
        ...r,
        payment_details: JSON.parse(r.payment_details || '{}'),
        proof_url: proof_id ? '/api/payment-proofs/' + proof_id : null,
      })),
    ),
  );
  // Server-to-server notifications from the card gateway (3-D Secure results, late declines).
  app.post('/api/payments/card/webhook', async (req: AuthRequest & { rawBody?: Buffer }, res) => {
    const method = records('payments').find((m) => m.type === 'card');
    const gateway = cardGateway(method);
    if (!method || !gateway?.webhook) return res.status(404).json({ error: 'Endpoint not found.' });
    const event = await gateway.webhook(req, method).catch(() => null);
    if (!event) return res.status(400).json({ error: 'Invalid webhook.' });
    const o = one('SELECT * FROM orders WHERE reference=?', event.reference);
    const d = o && one('SELECT * FROM order_details WHERE order_id=?', o.id);
    if (!o || d?.payment_type !== 'card' || d.payment_status !== 'pending') return res.json({ ok: true });
    if (event.status === 'paid') {
      markCardPaid(o.id, event.transaction_id);
      notifyReadyToSend(o, 'paid by card');
    } else cancelFailedCard(o.id, event.message || 'The card payment was not completed.');
    notify([o.user_id], {
      type: 'payment',
      title: event.status === 'paid' ? 'Card payment received' : 'Card payment failed',
      body: `${o.reference}${event.status === 'paid' ? '' : ' was cancelled because the card payment failed.'}`,
      link: '/orders/' + o.id,
    });
    res.json({ ok: true });
  });
  /** Records that a paid online order that was later cancelled has been refunded. */
  app.patch('/api/admin/payments/:id/refund', requireRole('admin'), (req: AuthRequest, res) => {
    const p = z
      .object({ reference: z.string().trim().max(80).default(''), note: z.string().trim().max(300).default('') })
      .parse(req.body || {});
    const o = one('SELECT * FROM orders WHERE id=?', String(req.params.id));
    const d = o && one('SELECT * FROM order_details WHERE order_id=?', o.id);
    if (!o || !d) return res.status(404).json({ error: 'Order not found.' });
    if (d.payment_status !== 'refund_due')
      return res.status(400).json({ error: 'This payment is not waiting for a refund.' });
    const at = new Date().toISOString();
    run(
      "UPDATE order_details SET payment_status='refunded',payment_note=?,payment_updated_at=?,payment_reviewed_by=?,payment_reviewed_at=? WHERE order_id=?",
      [p.reference && 'Refund ref ' + p.reference, p.note].filter(Boolean).join(' · '),
      at,
      req.user!.id,
      at,
      o.id,
    );
    notify([o.user_id], {
      type: 'payment',
      title: 'Refund sent',
      body: `Your payment for ${o.reference} has been refunded.${p.reference ? ' Reference ' + p.reference + '.' : ''}`,
      link: '/orders/' + o.id,
    });
    res.json({ ok: true });
  });
  app.patch('/api/admin/payments/:id/verify', requireRole('admin'), verify);
  app.patch('/api/admin/payments/:id/confirm', requireRole('admin'), verify);
}
