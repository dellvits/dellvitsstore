'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, useEffect, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ClipboardList,
  Clock,
  LifeBuoy,
  Lock,
  MapPin,
  PackageCheck,
  Phone,
  RefreshCw,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useApp } from './Provider';
import { useData } from '@/lib/useData';
import { inRange, useRange } from '@/lib/range';
import { money, date, label, api } from '@/lib/api';
import type { Order } from '@/lib/types';
import { Loading, ErrorBox, Empty, Confirm, DataTable, Badge, PageTitle, FilterBar, Stat, RowAction } from './UI';
import { AccountDetails, PaymentName, PaymentProofFields, type Proof } from './Checkout';
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map…</div>,
});

export const orderStatuses = ['placed', 'confirmed', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled'];
export const paymentLabel = (o: Pick<Order, 'payment_type' | 'payment_status'>) =>
  o.payment_status === 'refund_due'
    ? 'Refund due'
    : o.payment_status === 'refunded'
      ? 'Refunded'
      : o.payment_type === 'cod' || !o.payment_type
        ? o.payment_status === 'paid'
          ? 'Collected'
          : 'Cash due'
        : o.payment_status === 'paid'
          ? 'Paid'
          : o.payment_status === 'rejected'
            ? 'Rejected'
            : o.payment_status === 'failed'
              ? 'Payment failed'
              : o.payment_type === 'card'
                ? 'Processing'
                : 'Verifying';
export const paymentTypeLabels: Record<string, string> = {
  cod: 'Cash on delivery',
  bank: 'Bank transfer',
  manual: 'Bank transfer',
  wallet: 'Mobile wallet',
  raast: 'Raast',
  card: 'Card',
};
export function PaymentStatusBadge({ order }: { order: Pick<Order, 'payment_type' | 'payment_status'> }) {
  const tone =
    order.payment_status === 'due' ? 'warn' : order.payment_status === 'submitted' ? 'warn' : undefined;
  return (
    <Badge value={order.payment_status} tone={tone}>
      {paymentLabel(order)}
    </Badge>
  );
}
export const eventLabels: Record<string, string> = {
  placed: 'Order placed',
  payment_verified: 'Payment verified',
  sent: 'Sent to outlet & rider',
  resent: 'Sent again for confirmation',
  outlet_accepted: 'Outlet accepted',
  rider_requested: 'New rider requested',
  rider_accepted: 'Rider accepted',
  rider_rejected: 'Rider declined',
  confirmed: 'Order confirmed',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  reminder: 'Reminder sent to outlet',
  cancel_requested: 'Outlet requested cancellation',
  cancel_request_dismissed: 'Cancellation request declined',
};
/** A plain-language description of where an order is in the workflow. */
export function stageLabel(o: Order) {
  if (o.status === 'cancelled') return 'Cancelled';
  if (o.status === 'delivered') return 'Delivered';
  const f = o.flow;
  if (o.status === 'placed') {
    if (!f?.payment_verified_at) return 'Awaiting payment verification';
    if (!f.sent_at) return 'Ready to assign & send';
    if (f.rider_status === 'rejected' || !o.rider_id) return 'Rider declined · reassign';
    if (f.outlet_status === 'pending' && f.rider_status === 'pending') return 'Awaiting outlet & rider';
    if (f.outlet_status === 'pending') return 'Awaiting outlet';
    return 'Awaiting rider';
  }
  if (o.status !== 'picked_up' && f && f.rider_status !== 'accepted')
    return label(o.status) + (f.rider_status === 'pending' ? ' · rider pending' : ' · needs rider');
  return label(o.status);
}

export function Orders() {
  const { ready, user, notice } = useApp();
  const router = useRouter();
  const { data, loading, error, refresh } = useData<Order[]>(ready && user ? '/orders' : null, 15000);
  const { range, setRange, label: rangeText } = useRange('7d');
  const [cancel, setCancel] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return <Loading />;
  if (!user)
    return (
      <div className="container page">
        <Empty title="Log in to see your orders" href="/login?next=/orders" action="Log in" />
      </div>
    );
  return (
    <div className="container page">
      <PageTitle
        eyebrow="Order history"
        title="Your orders"
        actions={
          <button className="button ghost" onClick={refresh}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />
      {(() => {
        const rows = (data || []).filter((o) => inRange(o.created_at, range));
        const delivered = rows.filter((o) => o.status === 'delivered');
        return (
          <div className="stack tight page-block">
            <FilterBar title="Summary" hint={`Orders placed ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
            <div className="stats compact">
              <Stat icon={<ClipboardList size={18} />} label="Orders" value={rows.length} tone="blue" />
              <Stat
                icon={<Clock size={18} />}
                label="In progress"
                value={rows.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length}
                tone="orange"
              />
              <Stat icon={<PackageCheck size={18} />} label="Delivered" value={delivered.length} tone="green" />
              <Stat icon={<XCircle size={18} />} label="Cancelled" value={rows.filter((o) => o.status === 'cancelled').length} />
              <Stat
                icon={<Wallet size={18} />}
                label="Total spent"
                value={money(delivered.reduce((s, o) => s + o.total, 0))}
                tone="purple"
              />
            </div>
          </div>
        );
      })()}
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push('/orders/' + o.id)}
        dateFilter={{ get: (o) => o.created_at }}
        search={(o) => `${o.reference} ${o.outlet.name} ${o.items.map((i) => i.name).join(' ')}`}
        searchPlaceholder="Search orders or items"
        empty="You haven’t placed any orders yet."
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            initial: 'all',
            options: [
              { value: 'active', label: 'In progress' },
              ...orderStatuses.map((s) => ({ value: s, label: label(s) })),
            ],
            test: (o, v) => (v === 'active' ? !['delivered', 'cancelled'].includes(o.status) : o.status === v),
          },
          {
            key: 'method',
            label: 'Payment methods',
            options: Object.entries(paymentTypeLabels)
              .filter(([k]) => k !== 'manual')
              .map(([value, text]) => ({ value, label: text })),
            test: (o, v) => (o.payment_type === 'manual' ? 'bank' : o.payment_type || 'cod') === v,
          },
          {
            key: 'payment',
            label: 'Payment statuses',
            options: [
              { value: 'due', label: 'Cash due' },
              { value: 'submitted', label: 'Verifying' },
              { value: 'paid', label: 'Paid' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'refund_due', label: 'Refund due' },
              { value: 'refunded', label: 'Refunded' },
            ],
            test: (o, v) =>
              v === 'submitted' ? ['submitted', 'pending'].includes(o.payment_status || '') : o.payment_status === v,
          },
        ]}
        columns={[
          {
            key: 'ref',
            header: 'Order',
            sort: (o) => o.created_at,
            render: (o) => (
              <span className="cell-stack">
                <strong>{o.reference}</strong>
                <small>{date(o.created_at)}</small>
              </span>
            ),
          },
          {
            key: 'outlet',
            header: 'Outlet & items',
            render: (o) => (
              <div className="cell-main">
                <img className="cell-thumb" src={o.items[0]?.image} alt="" />
                <span className="cell-stack">
                  <strong>{o.outlet.name}</strong>
                  <small className="truncate">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</small>
                </span>
              </div>
            ),
          },
          { key: 'total', header: 'Total', sort: (o) => o.total, render: (o) => <strong>{money(o.total)}</strong> },
          { key: 'method', header: 'Payment method', render: (o) => <PaymentName order={o} /> },
          { key: 'payment', header: 'Payment status', render: (o) => <PaymentStatusBadge order={o} /> },
          {
            key: 'status',
            header: 'Order status',
            render: (o) => (
              <span className="cell-stack">
                <Badge value={o.status} />
                {o.status === 'placed' && (
                  <small>{o.flow?.payment_verified_at ? 'Confirming with outlet' : 'Verifying payment'}</small>
                )}
              </span>
            ),
          },
        ]}
        actions={(o) => (
          <>
            {o.payment_status === 'rejected' && o.status !== 'cancelled' && (
              <RowAction tone="warn" href={'/orders/' + o.id}>
                Fix payment
              </RowAction>
            )}
            <RowAction tone={['delivered', 'cancelled'].includes(o.status) ? 'ghost' : 'primary'} href={'/orders/' + o.id}>
              {['delivered', 'cancelled'].includes(o.status) ? 'View' : 'Track order'}
            </RowAction>
            {o.can_cancel && (
              <RowAction tone="danger" onClick={() => setCancel(o)}>
                Cancel
              </RowAction>
            )}
          </>
        )}
      />
      <Confirm
        open={!!cancel}
        title={'Cancel ' + (cancel?.reference || 'order') + '?'}
        confirm="Cancel order"
        danger
        busy={busy}
        onClose={() => setCancel(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/orders/' + cancel!.id + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
            notice('Order cancelled.');
            setCancel(null);
            refresh();
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {cancel && cancel.payment_type !== 'cod' && cancel.payment_status === 'paid'
          ? 'Your online payment will be refunded by Dellvit.'
          : 'The outlet and rider will be notified.'}
      </Confirm>
    </div>
  );
}

export function Countdown({
  deadline,
  done = false,
  pending = false,
}: {
  deadline: string;
  done?: boolean;
  /** The order is not confirmed yet, so the countdown has not started. */
  pending?: boolean;
}) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((new Date(deadline).getTime() - t) / 1000));
  if (pending && !done) return <span className="muted">Starts after confirmation</span>;
  return (
    <span className={seconds === 0 && !done ? 'late' : ''}>
      {done ? 'Completed' : seconds > 0 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : 'Overdue'}
    </span>
  );
}

function PaymentCard({ o, refresh }: { o: Order; refresh: () => void }) {
  const { notice } = useApp();
  const [proof, setProof] = useState<Proof>({
    transaction_id: '',
    payer_name: o.payer_name || '',
    payer_account: o.payer_account || '',
  });
  const [busy, setBusy] = useState(false);
  const online = o.payment_type && o.payment_type !== 'cod';
  const card = o.payment_type === 'card';
  async function resubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/orders/' + o.id + '/payment', {
        method: 'POST',
        body: JSON.stringify({ ...proof, proof_url: undefined }),
      });
      notice('Payment details submitted for verification.');
      refresh();
    } catch (err) {
      notice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <h3>Payment</h3>
        <Badge value={o.payment_status}>{paymentLabel(o)}</Badge>
      </div>
      <div className="kv">
        <span>Method</span>
        <strong>
          <PaymentName order={o} />
        </strong>
        {online && (
          <>
            <span>Transaction ID</span>
            <strong>{o.transaction_id || '—'}</strong>
            {!card && (
              <>
                <span>Sender</span>
                <strong>{o.payer_name || '—'}</strong>
              </>
            )}
          </>
        )}
      </div>
      {card && o.payment_status === 'failed' && o.payment_note && (
        <div className="alert error">
          <AlertTriangle size={16} /> {o.payment_note}
        </div>
      )}
      {online && o.proof_url && (
        <a href={o.proof_url} target="_blank" rel="noreferrer" className="proof-link">
          <img src={o.proof_url} alt="Payment receipt" /> View receipt
        </a>
      )}
      {online && o.payment_status !== 'paid' && o.payment_status !== 'rejected' && o.status !== 'cancelled' && (
        <div className="alert info">
          <Clock size={16} />{' '}
          {card
            ? 'Waiting for your bank to confirm the card payment.'
            : 'We’re verifying your payment. The outlet will accept your order once it’s confirmed.'}
        </div>
      )}
      {o.payment_status === 'rejected' && o.status !== 'cancelled' && (
        <form className="stack" onSubmit={resubmit}>
          <div className="alert error">
            <AlertTriangle size={16} />
            <span>
              <strong>Payment not verified:</strong> {o.payment_note}
            </span>
          </div>
          {o.payment_details && <AccountDetails method={o.payment_details} />}
          <PaymentProofFields value={proof} onChange={setProof} />
          <button className="button" disabled={busy}>
            {busy ? 'Submitting…' : 'Resubmit payment details'}
          </button>
        </form>
      )}
    </section>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const { ready, user, notice } = useApp();
  const { data: o, loading, error, refresh } = useData<Order>(ready && user ? '/orders/' + id : null, 10000);
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  async function cancelOrder() {
    setBusy(true);
    try {
      await api('/orders/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
      setCancel(false);
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready || (loading && !o)) return <Loading />;
  if (!user)
    return (
      <div className="container page">
        <Empty title="Log in to view this order" href={'/login?next=/orders/' + id} action="Log in" />
      </div>
    );
  if (error || !o)
    return (
      <div className="container page">
        <ErrorBox error={error || 'Order not found.'} retry={refresh} />
      </div>
    );
  // Payment verification sits between placing and confirming the order.
  const stages = ['placed', 'payment_verified', 'confirmed', 'preparing', 'ready', 'picked_up', 'delivered'];
  const verified = !!o.flow?.payment_verified_at;
  const current = o.status === 'placed' ? (verified ? 1 : 0) : stages.indexOf(o.status);
  const done = ['delivered', 'cancelled'].includes(o.status);
  const stepTitle: Record<string, string> = { payment_verified: 'Payment verified', picked_up: 'On the way' };
  return (
    <div className="container page">
      <Link href="/orders" className="back-link">
        <ArrowLeft size={16} /> All orders
      </Link>
      <div className="page-title">
        <div>
          <span className="eyebrow">
            {o.reference} · {date(o.created_at)}
          </span>
          <h1>
            {o.status === 'delivered' ? 'Delivered' : o.status === 'cancelled' ? 'Order cancelled' : label(o.status)}
          </h1>
        </div>
        <div className="page-actions">
          <Badge value={o.status} />
        </div>
      </div>
      <div className="split">
        <div className="stack">
          {o.status !== 'cancelled' && (
            <section className="card">
              <div className="stepper seven">
                {stages.map((s, i) => {
                  const ev = [...o.events].reverse().find((e) => e.status === s);
                  const waitingPayment = s === 'payment_verified' && !verified;
                  return (
                    <div className={'stepper-item' + (i <= current ? ' done' : '') + (i === current ? ' current' : '')} key={s}>
                      <span className="stepper-dot">{i <= current ? <Check size={13} /> : i + 1}</span>
                      <strong>{stepTitle[s] || label(s)}</strong>
                      <small>{ev ? date(ev.created_at) : waitingPayment ? 'Pending' : '—'}</small>
                    </div>
                  );
                })}
              </div>
              {o.status === 'placed' && (
                <div className="alert info">
                  <Clock size={16} />
                  {!verified
                    ? o.payment_status === 'rejected'
                      ? 'Your payment could not be verified. Please update the details below.'
                      : 'We’re verifying your payment. Your order will be confirmed right after.'
                    : o.flow?.sent_at
                      ? 'Payment verified. We’re confirming your order with the outlet and a rider.'
                      : 'Payment verified. We’re assigning a rider to your order.'}
                </div>
              )}
              <div className="order-highlights">
                <div className="highlight">
                  <Clock size={20} />
                  <span>
                    <small>{done ? 'Delivered' : 'Arriving in'}</small>
                    <strong>
                      {done && o.delivered_at ? date(o.delivered_at) : <Countdown deadline={o.deliver_by} done={done} pending={o.status === 'placed'} />}
                    </strong>
                  </span>
                </div>
                {o.otp && !done && (
                  <div className="highlight otp">
                    <ShieldCheck size={20} />
                    <span>
                      <small>Delivery code — share only on arrival</small>
                      <strong className="otp-code">{o.otp}</strong>
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
          {o.status === 'cancelled' && (
            <div className="alert error cancel-note">
              <XCircle size={16} />
              <span>
                <strong>
                  This order was cancelled
                  {o.flow?.cancelled_by === 'outlet'
                    ? ' by the outlet'
                    : o.flow?.cancelled_by === 'customer'
                      ? ' at your request'
                      : o.flow?.cancelled_by === 'system'
                        ? ' because the payment failed'
                        : ' by Dellvit'}
                  .
                </strong>
                {o.flow?.cancel_reason && <> Reason: {o.flow.cancel_reason}</>}
                {o.payment_status === 'refund_due' && <> Your payment will be refunded shortly.</>}
                {o.payment_status === 'refunded' && <> Your payment has been refunded.</>}
              </span>
            </div>
          )}
          {o.locked && (
            <div className="alert info">
              <Lock size={16} /> This order is complete. Need help with it? Contact support.
            </div>
          )}
          <PaymentCard o={o} refresh={refresh} />
          <section className="card">
            <div className="card-head">
              <h3>Delivery</h3>
              {o.rider && (
                <a className="button ghost small" href={'tel:' + o.rider.phone}>
                  <Phone size={15} /> Call {o.rider.name.split(' ')[0]}
                </a>
              )}
            </div>
            <div className="route">
              <div className="route-stop pickup">
                <small>Pickup</small>
                <strong>{o.outlet.name}</strong>
                <span>{o.outlet.address}</span>
              </div>
              <div className="route-stop drop">
                <small>Drop-off</small>
                <strong>{o.name}</strong>
                <span>{o.address}</span>
                {o.notes && <em>“{o.notes}”</em>}
              </div>
            </div>
            {!o.rider && !done && <p className="muted small">A rider will be assigned shortly.</p>}
            <DeliveryMap lat={o.lat} lng={o.lng} pickup={o.outlet} rider={o.rider_location || undefined} />
          </section>
        </div>
        <aside className="card summary sticky">
          <h3>Summary</h3>
          <div className="summary-items">
            {o.items.map((i) => (
              <div className="summary-item" key={i.id}>
                <img src={i.image} alt="" />
                <span>
                  <strong>{i.name}</strong>
                  <small>
                    {i.quantity} × {money(i.unit_price)}
                  </small>
                </span>
                <strong>{money(i.unit_price * i.quantity)}</strong>
              </div>
            ))}
          </div>
          <div className="line">
            <span>Subtotal</span>
            <strong>{money(o.subtotal)}</strong>
          </div>
          <div className="line">
            <span>Delivery</span>
            <strong>{money(o.delivery_fee)}</strong>
          </div>
          {!!o.discount && (
            <div className="line success">
              <span>Coupon {o.coupon_code}</span>
              <strong>−{money(o.discount)}</strong>
            </div>
          )}
          <div className="line total">
            <span>Total</span>
            <strong>{money(o.total)}</strong>
          </div>
          <Link href="/contact" className="button ghost full">
            <LifeBuoy size={16} /> Get help
          </Link>
          {user.role === 'customer' && o.can_cancel && (
            <button className="button danger-ghost full" onClick={() => setCancel(true)}>
              Cancel order
            </button>
          )}
          <small className="muted with-icon">
            <MapPin size={13} /> {o.address}
          </small>
        </aside>
      </div>
      <Confirm
        open={cancel}
        title="Cancel this order?"
        confirm="Cancel order"
        danger
        busy={busy}
        onClose={() => setCancel(false)}
        onConfirm={cancelOrder}
      >
        {o.payment_type !== 'cod' && o.payment_status === 'paid'
          ? 'Your online payment will be flagged for a refund.'
          : 'The outlet and rider will be notified.'}
      </Confirm>
    </div>
  );
}
