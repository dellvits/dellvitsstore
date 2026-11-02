import { atomicRoute } from './atomic-route.js';
import type { Express, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { objects } from './storage.js';
import { toWebp } from './images.js';
import { z } from 'zod';
import { all, one, run, transaction, type Row } from './db.js';
import { can, isOnline, records } from './platform.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify, adminsWith } from './notifications.js';
import { clearPaymentVerified, flow, markPaymentVerified } from './workflow.js';

const bankKeys = ['bank_name', 'account_title', 'account_number', 'iban', 'branch_code'];
const detailKeys: Record<string, string[]> = {
  bank: bankKeys,
  manual: bankKeys,
  wallet: ['provider', 'account_title', 'mobile_number'],
  raast: ['bank_name', 'account_title', 'raast_id'],
  cod: [],
};
/** Account details shown to the customer, copied onto the order when it is placed. */
export function paymentSnapshot(method: Row) {
  // The merchant QR stays with the method; an order keeps only the account details.
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
});
type Submission = z.infer<typeof paymentSubmission>;

export async function validateSubmission(
  method: Row,
  s: Submission | undefined,
  userId: string,
  orderId = '',
) {
  const fail = (m: string) => {
    throw Object.assign(new Error(m), { status: 400 });
  };
  if (!isOnline(method.type)) return;
  if (!s || s.transaction_id.length < 4)
    fail('Enter the transaction ID (TID) from your payment receipt.');
  if (!s!.payer_name) fail('Enter the name on the account you paid from.');
  if (method.require_proof && !s!.proof_id) fail('Upload a screenshot of your payment receipt.');
  if (
    s!.proof_id &&
    !(await one('SELECT id FROM payment_proofs WHERE id=? AND user_id=?', s!.proof_id, userId))
  )
    fail('Upload your payment receipt again.');
  // Orders placed together in one checkout (one per outlet) share a single payment.
  const duplicate = await one(
    "SELECT d.order_id FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.transaction_id=? AND d.payment_type<>'cod' AND o.status<>'cancelled' AND o.id<>? AND NOT (o.checkout_id IS NOT NULL AND o.checkout_id=(SELECT checkout_id FROM orders WHERE id=?))",
    s!.transaction_id,
    orderId,
    orderId,
  );
  if (duplicate) fail('This transaction ID has already been used for another order.');
}

/**
 * The order and the other unfinished online-paid orders from the same checkout: one payment
 * covers them all, so it is resubmitted and reviewed for all of them together.
 */
async function samePayment(o: Row): Promise<Row[]> {
  if (!o.checkout_id) return [o];
  return await all(
    "SELECT o.* FROM orders o JOIN order_details d ON d.order_id=o.id WHERE o.checkout_id=? AND d.payment_type<>'cod' AND o.status NOT IN ('cancelled','delivered') ORDER BY o.created_at,o.id",
    o.checkout_id,
  );
}

async function notifyReadyToSend(o: Row, how: string) {
  await notify(await adminsWith('orders'), {
    type: 'order',
    title: 'Paid order ready to send',
    body: `${o.reference} has been ${how}. Assign a rider and send it to the outlet.`,
    link: '/admin?tab=orders',
  });
}

export function installPayments(app: Express, { upload }: { upload: RequestHandler }) {
  app.post(
    '/api/payment-proofs',
    requireRole('customer'),
    upload,
    atomicRoute(async (req: AuthRequest, res) => {
      if (!req.file) return res.status(400).json({ error: 'Choose a receipt image.' });
      const id = randomUUID();
      // Receipts stay large enough to read every digit.
      const image = await toWebp(req.file.buffer, { max: 2400 });
      await objects.put('proofs/' + id + '.webp', image, 'image/webp');
      await run(
        'INSERT INTO payment_proofs VALUES(?,?,?,?)',
        id,
        req.user!.id,
        id + '.webp',
        new Date().toISOString(),
      );
      res.status(201).json({ id, url: '/api/payment-proofs/' + id });
    }),
  );
  app.get(
    '/api/payment-proofs/:id',
    requireRole('customer', 'admin'),
    async (req: AuthRequest, res) => {
      const p = await one('SELECT * FROM payment_proofs WHERE id=?', String(req.params.id));
      const allowed =
        p &&
        (p.user_id === req.user!.id ||
          (req.user!.role === 'admin' &&
            ((await can(req.user, 'payments')) || (await can(req.user, 'orders')))));
      if (!allowed) return res.status(404).json({ error: 'Receipt not found.' });
      res.setHeader('Cache-Control', 'private, no-store');
      const proof = await objects.get('proofs/' + p!.filename);
      if (!proof) return res.status(404).json({ error: 'Receipt not found.' });
      res.type('image/webp').send(proof.body);
    },
  );
  app.post(
    '/api/orders/:id/payment',
    requireRole('customer'),
    atomicRoute(async (req: AuthRequest, res) => {
      const o = await one(
        'SELECT * FROM orders WHERE id=? AND user_id=?',
        String(req.params.id),
        req.user!.id,
      );
      const d = o && (await one('SELECT * FROM order_details WHERE order_id=?', o.id));
      if (!o || !d) return res.status(404).json({ error: 'Order not found.' });
      if (
        !isOnline(d.payment_type) ||
        d.payment_status === 'paid' ||
        ['cancelled', 'delivered'].includes(o.status)
      )
        return res.status(400).json({ error: 'This order does not need a payment update.' });
      const s = paymentSubmission.parse(req.body);
      const method = (await records('payments')).find((m) => m.id === o.payment_method) || {
        type: d.payment_type,
      };
      await validateSubmission(method, s, req.user!.id, o.id);
      for (const x of await samePayment(o))
        await run(
          "UPDATE order_details SET transaction_id=?,payer_name=?,payer_account=?,proof_id=?,payment_status='submitted',payment_note='',payment_updated_at=?,payment_reviewed_by=NULL,payment_reviewed_at=NULL WHERE order_id=? AND payment_status<>'paid'",
          s.transaction_id,
          s.payer_name,
          s.payer_account,
          s.proof_id || null,
          new Date().toISOString(),
          x.id,
        );
      await notify(await adminsWith('payments'), {
        type: 'payment',
        title: 'Payment resubmitted',
        body: `${o.reference} · TID ${s.transaction_id}`,
        link: '/admin?tab=payments',
      });
      res.json({ ok: true });
    }),
  );
  const verify = async (req: AuthRequest, res: any) => {
    const p = z
      .object({
        decision: z.enum(['approve', 'reject']).default('approve'),
        note: z.string().trim().max(300).default(''),
      })
      .parse(req.body || {});
    const o = await one('SELECT * FROM orders WHERE id=?', String(req.params.id));
    const d = o && (await one('SELECT * FROM order_details WHERE order_id=?', o.id));
    if (!o || !d || o.status === 'cancelled')
      return res.status(404).json({ error: 'Order is unavailable.' });
    if (o.status === 'delivered')
      return res.status(400).json({ error: 'A completed order cannot be modified.' });
    if (!isOnline(d.payment_type))
      return res.status(400).json({ error: 'Cash orders are settled on delivery.' });
    if (p.decision === 'reject' && !p.note)
      return res.status(400).json({ error: 'Tell the customer why the payment was rejected.' });
    if (p.decision === 'reject' && (await flow(o.id)).sent_at)
      return res
        .status(400)
        .json({ error: 'This order was already sent to the outlet. Cancel it instead.' });
    // The other orders from the same checkout were paid with the same transfer.
    const siblings = (await samePayment(o)).filter((x) => x.id !== o.id);
    const others =
      p.decision === 'approve'
        ? siblings
        : (
            await Promise.all(siblings.map(async (x) => ((await flow(x.id)).sent_at ? null : x)))
          ).filter((x): x is Row => !!x);
    const orders = [o, ...others];
    await transaction(async () => {
      const at = new Date().toISOString();
      for (const x of orders) {
        await run(
          'UPDATE order_details SET payment_status=?,payment_note=?,payment_updated_at=?,payment_reviewed_by=?,payment_reviewed_at=? WHERE order_id=?',
          p.decision === 'approve' ? 'paid' : 'rejected',
          p.note,
          at,
          req.user!.id,
          at,
          x.id,
        );
        if (p.decision === 'approve') await markPaymentVerified(x.id);
        else await clearPaymentVerified(x.id);
      }
    });
    const refs = orders.map((x) => x.reference).join(', ');
    if (p.decision === 'approve') {
      await notify([o.user_id], {
        type: 'payment',
        title: 'Payment verified',
        body: `We received your payment for ${refs}.`,
        link: '/orders/' + o.id,
      });
      for (const x of orders) if (x.status === 'placed') await notifyReadyToSend(x, 'paid online');
    } else
      await notify([o.user_id], {
        type: 'payment',
        title: 'Payment could not be verified',
        body: `${refs}: ${p.note}`,
        link: '/orders/' + o.id,
      });
    res.json({ ok: true });
  };
  app.get('/api/admin/payments/queue', requireRole('admin'), async (_req, res) =>
    res.json(
      (
        await all(
          "SELECT o.id,o.reference,o.name,o.phone,o.email,o.total,o.status,o.created_at,t.name outlet_name,d.payment_name,d.payment_type,d.payment_status,d.transaction_id,d.payer_name,d.payer_account,d.proof_id,d.payment_note,d.payment_updated_at,d.payment_details,d.payment_reviewed_at,r.name reviewer_name,r.email reviewer_email,f.cancel_reason FROM orders o JOIN order_details d ON d.order_id=o.id JOIN outlets t ON t.id=o.outlet_id LEFT JOIN users r ON r.id=d.payment_reviewed_by LEFT JOIN order_flow f ON f.order_id=o.id WHERE d.payment_type<>'cod' ORDER BY COALESCE(d.payment_updated_at,o.created_at) DESC",
        )
      ).map(({ proof_id, ...r }) => ({
        ...r,
        payment_details: JSON.parse(r.payment_details || '{}'),
        proof_url: proof_id ? '/api/payment-proofs/' + proof_id : null,
      })),
    ),
  );
  /** Records that a paid online order that was later cancelled has been refunded. */
  app.patch(
    '/api/admin/payments/:id/refund',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          reference: z.string().trim().max(80).default(''),
          note: z.string().trim().max(300).default(''),
        })
        .parse(req.body || {});
      const o = await one('SELECT * FROM orders WHERE id=?', String(req.params.id));
      const d = o && (await one('SELECT * FROM order_details WHERE order_id=?', o.id));
      if (!o || !d) return res.status(404).json({ error: 'Order not found.' });
      if (d.payment_status !== 'refund_due')
        return res.status(400).json({ error: 'This payment is not waiting for a refund.' });
      const at = new Date().toISOString();
      await run(
        "UPDATE order_details SET payment_status='refunded',payment_note=?,payment_updated_at=?,payment_reviewed_by=?,payment_reviewed_at=? WHERE order_id=?",
        [p.reference && 'Refund ref ' + p.reference, p.note].filter(Boolean).join(' · '),
        at,
        req.user!.id,
        at,
        o.id,
      );
      await notify([o.user_id], {
        type: 'payment',
        title: 'Refund sent',
        body: `Your payment for ${o.reference} has been refunded.${p.reference ? ' Reference ' + p.reference + '.' : ''}`,
        link: '/orders/' + o.id,
      });
      res.json({ ok: true });
    }),
  );
  app.patch('/api/admin/payments/:id/verify', requireRole('admin'), atomicRoute(verify));
  app.patch('/api/admin/payments/:id/confirm', requireRole('admin'), atomicRoute(verify));
}
