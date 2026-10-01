'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  BellRing,
  Bike,
  CalendarClock,
  CheckCircle2,
  ChefHat,
  CircleDashed,
  CircleDot,
  ClipboardList,
  Clock,
  CreditCard,
  ExternalLink,
  HandCoins,
  Hash,
  History,
  House,
  LocateFixed,
  Lock,
  Mail,
  MapPin,
  MapPinned,
  MessageSquareText,
  Navigation,
  Package,
  PackageCheck,
  Phone,
  Receipt,
  RefreshCcw,
  Route,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  Timer,
  Truck,
  Undo2,
  UserRound,
  UserRoundCheck,
  UserX,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { inRange, useRange } from '@/lib/range';
import { useSettling } from '@/lib/useSettling';
import type { CashStatement, Order, PaymentMethod } from '@/lib/types';
import {
  Badge,
  CopyButton,
  DataTable,
  ErrorBox,
  FilterBar,
  MetaItem as Meta,
  Modal,
  PanelSection as Section,
  RowAction,
  Stat,
} from './UI';
import {
  Countdown,
  PaymentStatusBadge,
  eventLabels,
  orderStatuses,
  paymentTypeLabels,
  stageLabel,
} from './Orders';
import { PaymentLogo, PaymentName } from './Checkout';
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map…</div>,
});

type Role = 'admin' | 'outlet' | 'rider';
const closed = (o: Order) => ['delivered', 'cancelled'].includes(o.status);
const navigateUrl = (o: Order) =>
  `https://www.google.com/maps/dir/?api=1&origin=${o.outlet.lat},${o.outlet.lng}&destination=${o.lat},${o.lng}&travelmode=driving`;
/** The admin still has to assign a rider and/or send the order. */
export const needsDispatch = (o: Order) =>
  o.status === 'placed' &&
  !!o.flow?.payment_verified_at &&
  (!o.flow.sent_at || !o.rider_id || o.flow.rider_status === 'rejected');
const needsRider = (o: Order) =>
  !closed(o) && o.status !== 'picked_up' && !!o.flow?.sent_at && (!o.rider_id || o.flow.rider_status === 'rejected');

/* ---------- Reason prompt ---------- */
type Prompt = {
  title: string;
  message?: ReactNode;
  label: string;
  confirm: string;
  required?: boolean;
  danger?: boolean;
  placeholder?: string;
  run: (text: string) => Promise<unknown>;
  done: string;
};
function PromptModal({ prompt, onClose }: { prompt: Prompt | null; onClose: () => void }) {
  const { notice } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(''), [prompt]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt) return;
    setBusy(true);
    try {
      await prompt.run(text.trim());
      notice(prompt.done);
      onClose();
    } catch (err) {
      notice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!prompt} onClose={() => !busy && onClose()} title={prompt?.title || ''} size="sm">
      {prompt && (
        <form className="stack" onSubmit={submit}>
          {prompt.message && <div className="muted">{prompt.message}</div>}
          <label>
            {prompt.label} {!prompt.required && <span className="muted">(optional)</span>}
            <textarea
              rows={3}
              maxLength={300}
              required={prompt.required}
              minLength={prompt.required ? 3 : undefined}
              value={text}
              placeholder={prompt.placeholder}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          </label>
          <div className="form-foot">
            <button type="button" className="button ghost" onClick={onClose}>
              Back
            </button>
            <button className={'button ' + (prompt.danger ? 'danger' : '')} disabled={busy}>
              {busy ? 'Working…' : prompt.confirm}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ---------- Actions ---------- */
function useOrderActions(refresh: () => void) {
  const { notice } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  async function call(key: string, path: string, method: string, body: unknown, message: string) {
    setBusy(key);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      notice(message);
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const post = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const withRefresh = (fn: (t: string) => Promise<unknown>) => async (t: string) => {
    await fn(t);
    refresh();
  };
  return {
    busy,
    prompt,
    closePrompt: () => setPrompt(null),
    status: (o: Order, status: string, message: string) =>
      call(o.id + status, '/orders/' + o.id + '/status', 'PATCH', { status }, message),
    outletAccept: (o: Order) =>
      call(o.id + 'accept', '/orders/' + o.id + '/outlet-response', 'POST', { decision: 'accept' }, 'Order accepted.'),
    riderAccept: (o: Order) =>
      call(o.id + 'accept', '/orders/' + o.id + '/rider-response', 'POST', { decision: 'accept' }, 'Delivery accepted.'),
    remind: (o: Order) =>
      setPrompt({
        title: 'Remind ' + o.outlet.name,
        label: 'Message to the outlet',
        placeholder: o.status === 'confirmed' ? 'Please start preparing this order.' : 'Please mark this order ready.',
        confirm: 'Send reminder',
        done: 'Reminder sent to the outlet.',
        run: withRefresh((t) => post('/admin/orders/' + o.id + '/remind', { message: t })),
      }),
    outletReject: (o: Order) =>
      setPrompt({
        title: 'Reject ' + o.reference + '?',
        message: 'The order will be cancelled and the customer will see your reason.',
        label: 'Reason',
        required: true,
        danger: true,
        placeholder: 'e.g. An item is out of stock',
        confirm: 'Reject order',
        done: 'Order rejected. The customer has been informed.',
        run: withRefresh((t) => post('/orders/' + o.id + '/outlet-response', { decision: 'reject', note: t })),
      }),
    riderReject: (o: Order) =>
      setPrompt({
        title: 'Decline ' + o.reference + '?',
        message: 'Dellvit will assign another rider. The order is not cancelled.',
        label: 'Reason',
        placeholder: 'e.g. Too far from my location',
        confirm: 'Decline delivery',
        danger: true,
        done: 'Delivery declined.',
        run: withRefresh((t) => post('/orders/' + o.id + '/rider-response', { decision: 'reject', note: t })),
      }),
    cancel: (o: Order, role: Role) =>
      setPrompt({
        title: 'Cancel ' + o.reference + '?',
        message: `Reserved stock is restored${o.payment_type !== 'cod' && o.payment_status === 'paid' ? ', the payment is flagged for refund' : ''} and everyone involved is notified.`,
        label: 'Reason shown to the customer',
        required: role === 'admin',
        danger: true,
        placeholder: 'e.g. No rider is available in your area right now',
        confirm: 'Cancel order',
        done: 'Order cancelled.',
        run: withRefresh((t) =>
          api('/orders/' + o.id + '/status', {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled', reason: t }),
          }),
        ),
      }),
    requestCancel: (o: Order) =>
      setPrompt({
        title: 'Request cancellation',
        message: 'Only Dellvit can cancel an order that is being prepared. We will review your request.',
        label: 'Why can’t this order be completed?',
        required: true,
        danger: true,
        confirm: 'Send request',
        done: 'Cancellation request sent to Dellvit.',
        run: withRefresh((t) => post('/orders/' + o.id + '/cancel-request', { reason: t })),
      }),
    decideRequest: (o: Order, decision: 'approve' | 'dismiss') =>
      setPrompt({
        title: decision === 'approve' ? 'Approve cancellation' : 'Decline cancellation request',
        message:
          decision === 'approve' ? (
            <>
              The outlet said: “{o.flow.cancel_request}”. The order will be cancelled.
            </>
          ) : (
            'The outlet will be asked to continue with the order.'
          ),
        label: decision === 'approve' ? 'Reason shown to the customer' : 'Note to the outlet',
        placeholder: decision === 'approve' ? o.flow.cancel_request : '',
        confirm: decision === 'approve' ? 'Cancel order' : 'Decline request',
        danger: decision === 'approve',
        done: decision === 'approve' ? 'Order cancelled.' : 'Request declined.',
        run: withRefresh((t) => post('/admin/orders/' + o.id + '/cancel-request', { decision, note: t })),
      }),
  };
}
type Actions = ReturnType<typeof useOrderActions>;

/** Text buttons for a table row. The full set lives in the order panel. */
function RowButtons({ o, role, a, open }: { o: Order; role: Role; a: Actions; open: () => void }) {
  const busy = !!a.busy?.startsWith(o.id);
  const f = o.flow;
  return (
    <>
      {role === 'admin' && (
        <>
          {needsDispatch(o) && (
            <RowAction tone="primary" icon={<Send size={13} />} onClick={open}>
              Assign & send
            </RowAction>
          )}
          {needsRider(o) && o.status !== 'placed' && (
            <RowAction tone="warn" icon={<Bike size={13} />} onClick={open}>
              Reassign rider
            </RowAction>
          )}
          {f?.cancel_request && (
            <RowAction tone="warn" onClick={open}>
              Review request
            </RowAction>
          )}
          {['confirmed', 'preparing'].includes(o.status) && (
            <RowAction icon={<BellRing size={13} />} onClick={() => a.remind(o)}>
              Remind
            </RowAction>
          )}
        </>
      )}
      {role === 'outlet' && (
        <>
          {o.status === 'placed' && f?.outlet_status === 'pending' && (
            <>
              <RowAction tone="success" disabled={busy} onClick={() => a.outletAccept(o)}>
                Accept
              </RowAction>
              <RowAction tone="danger" onClick={() => a.outletReject(o)}>
                Reject
              </RowAction>
            </>
          )}
          {o.status === 'confirmed' && (
            <RowAction tone="primary" disabled={busy} onClick={() => a.status(o, 'preparing', 'Marked as preparing.')}>
              Start preparing
            </RowAction>
          )}
          {o.status === 'preparing' && (
            <RowAction tone="success" disabled={busy} onClick={() => a.status(o, 'ready', 'Marked ready for pickup.')}>
              Mark ready
            </RowAction>
          )}
        </>
      )}
      {role === 'rider' && (
        <>
          {f?.rider_status === 'pending' && !closed(o) && (
            <>
              <RowAction tone="success" disabled={busy} onClick={() => a.riderAccept(o)}>
                Accept
              </RowAction>
              <RowAction tone="danger" onClick={() => a.riderReject(o)}>
                Decline
              </RowAction>
            </>
          )}
          {o.status === 'ready' && f?.rider_status === 'accepted' && (
            <RowAction tone="primary" disabled={busy} onClick={() => a.status(o, 'picked_up', 'Pickup confirmed.')}>
              Confirm pickup
            </RowAction>
          )}
          {o.status === 'picked_up' && (
            <RowAction tone="success" onClick={open}>
              Complete delivery
            </RowAction>
          )}
          {!closed(o) && f?.rider_status === 'accepted' && (
            <RowAction href={navigateUrl(o)} external icon={<Navigation size={13} />}>
              Navigate
            </RowAction>
          )}
        </>
      )}
      <RowAction onClick={open}>View</RowAction>
      {role === 'admin' && o.can_cancel && !f?.cancel_request && (
        <RowAction tone="danger" onClick={() => a.cancel(o, role)}>
          Cancel
        </RowAction>
      )}
    </>
  );
}

/* ---------- Cards ---------- */
function DeskStats({ role, rows, loading }: { role: Role; rows: Order[]; loading: boolean }) {
  const { range, setRange, query, key, label: rangeText } = useRange('7d');
  const { data: cash, loading: cashLoading } = useData<CashStatement>(
    role === 'rider' ? '/rider/cash' + query : null,
    30000,
    'rider-cash:' + key,
  );
  // The figures are counted in the browser, so a new time frame is instant; show the placeholders briefly.
  const settling = useSettling(key);
  const busy = loading || settling;
  const inWindow = rows.filter((o) => inRange(o.created_at, range));
  const count = (fn: (o: Order) => boolean) => inWindow.filter(fn).length;
  const sum = (list: Order[], fn: (o: Order) => number) => list.reduce((s, o) => s + fn(o), 0);
  // Queues that need action are live across all orders, matching the dashboard's "Needs attention".
  const live = (fn: (o: Order) => boolean) => rows.filter(fn).length;
  const active = rows.filter((o) => !closed(o));
  const delivered = inWindow.filter((o) => o.status === 'delivered');
  const cancelled = count((o) => o.status === 'cancelled');
  const cancelShare = inWindow.length ? `${Math.round((cancelled / inWindow.length) * 100)}% of orders` : 'No orders in this period';
  const cashBusy = role === 'rider' && (busy || cashLoading || !cash);
  return (
    <div className="stack tight">
      <FilterBar
        title={role === 'rider' ? 'Delivery summary' : 'Order summary'}
        hint={`Showing ${rangeText.toLowerCase()}`}
        range={range}
        onRange={setRange}
      />
      <div className="stats">
        {role === 'admin' && (
          <>
            <Stat
              icon={<ClipboardList size={20} />}
              label="Total orders"
              value={inWindow.length}
              hint={`${money(sum(inWindow, (o) => o.total))} order value`}
              tone="blue"
              loading={busy}
            />
            <Stat
              icon={<Send size={20} />}
              label="Needs dispatch"
              value={live((o) => needsDispatch(o) || needsRider(o))}
              hint={`${live((o) => o.status === 'placed' && !o.flow?.payment_verified_at)} awaiting payment`}
              tone="orange"
              loading={busy}
            />
            <Stat
              icon={<Clock size={20} />}
              label="In progress"
              value={active.length}
              hint={`${live((o) => o.status === 'picked_up')} on the road · all open orders`}
              tone="purple"
              loading={busy}
            />
            <Stat
              icon={<PackageCheck size={20} />}
              label="Delivered"
              value={delivered.length}
              hint={money(sum(delivered, (o) => o.total)) + ' sales'}
              tone="green"
              loading={busy}
            />
            <Stat icon={<XCircle size={20} />} label="Cancelled" value={cancelled} hint={cancelShare} loading={busy} />
          </>
        )}
        {role === 'outlet' && (
          <>
            <Stat
              icon={<ClipboardList size={20} />}
              label="Total orders"
              value={inWindow.length}
              hint={`${money(sum(inWindow, (o) => o.subtotal))} items value`}
              tone="blue"
              loading={busy}
            />
            <Stat
              loading={busy}
              icon={<BellRing size={20} />}
              label="New requests"
              value={live((o) => o.status === 'placed' && o.flow?.outlet_status === 'pending')}
              hint="Waiting for your answer"
              tone="orange"
            />
            <Stat
              loading={busy}
              icon={<Package size={20} />}
              label="In the kitchen"
              value={live((o) => ['confirmed', 'preparing'].includes(o.status))}
              hint={`${live((o) => o.status === 'ready')} ready for pickup`}
              tone="purple"
            />
            <Stat
              icon={<PackageCheck size={20} />}
              label="Delivered"
              value={delivered.length}
              hint={money(sum(delivered, (o) => o.subtotal)) + ' item sales'}
              tone="green"
              loading={busy}
            />
            <Stat icon={<XCircle size={20} />} label="Cancelled" value={cancelled} hint={cancelShare} loading={busy} />
          </>
        )}
        {role === 'rider' && (
          <>
            <Stat
              loading={busy}
              icon={<Truck size={20} />}
              label="Active orders"
              value={active.length}
              hint={`${live((o) => o.flow?.rider_status === 'pending' && !closed(o))} waiting for you`}
              tone="orange"
            />
            <Stat
              icon={<PackageCheck size={20} />}
              label="Delivered"
              value={rows.filter((o) => o.status === 'delivered' && inRange(o.delivered_at, range)).length}
              hint="Completed in this period"
              tone="green"
              loading={busy}
            />
            <Stat
              icon={<HandCoins size={20} />}
              label="COD collected"
              value={money(cash?.collected_range || 0)}
              hint="From customers in this period"
              tone="blue"
              loading={cashBusy}
            />
            <Stat
              icon={<Wallet size={20} />}
              label="Cash in hand"
              value={money(cash?.in_hand || 0)}
              hint={cash?.pending ? money(cash.pending) + ' awaiting verification' : 'Current balance'}
              tone="purple"
              loading={cashBusy}
            />
            <Stat
              icon={<ShieldCheck size={20} />}
              label="Submitted to Dellvit"
              value={money(cash?.submitted_range || 0)}
              hint="Verified submissions"
              loading={cashBusy}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Desk ---------- */
export function OrderDesk({ role }: { role: Role }) {
  const { locations } = useApp();
  const { data, loading, error, refresh } = useData<Order[]>('/orders', 10000);
  const [selected, setSelected] = useState<string | null>(null);
  const a = useOrderActions(refresh);
  const current = data?.find((o) => o.id === selected);
  const rows = data || [];
  return (
    <div className="stack">
      <DeskStats role={role} rows={rows} loading={loading && !data} />
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(o) => o.id}
        onRowClick={(o) => setSelected(o.id)}
        dateFilter={{ get: (o) => o.created_at }}
        search={(o) => `${o.reference} ${o.name} ${o.phone} ${o.outlet.name} ${o.address} ${o.rider?.name || ''}`}
        searchPlaceholder="Search order, customer, address"
        empty={role === 'rider' ? 'No deliveries assigned yet.' : 'No orders yet.'}
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'action', label: 'Needs my action' },
              { value: 'active', label: 'In progress' },
              ...orderStatuses.map((s) => ({ value: s, label: label(s) })),
            ],
            test: (o, v) =>
              v === 'action'
                ? role === 'admin'
                  ? needsDispatch(o) || needsRider(o) || !!o.flow?.cancel_request
                  : role === 'outlet'
                    ? (o.status === 'placed' && o.flow?.outlet_status === 'pending') ||
                      ['confirmed', 'preparing'].includes(o.status)
                    : (o.flow?.rider_status === 'pending' && !closed(o)) || ['ready', 'picked_up'].includes(o.status)
                : v === 'active'
                  ? !closed(o)
                  : o.status === v,
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
              { value: 'paid', label: 'Paid / collected' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'refund_due', label: 'Refund due' },
              { value: 'refunded', label: 'Refunded' },
            ],
            test: (o, v) =>
              v === 'submitted' ? ['submitted', 'pending'].includes(o.payment_status || '') : o.payment_status === v,
          },
          ...(role === 'admin'
            ? [
                {
                  key: 'area',
                  label: 'Areas',
                  options: locations.map((l) => ({ value: l.id, label: l.name })),
                  test: (o: Order, v: string) => o.location_id === v,
                },
              ]
            : []),
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
            key: 'customer',
            header: 'Customer',
            render: (o) => (
              <span className="cell-stack">
                <strong>{o.name}</strong>
                <small>{o.phone}</small>
              </span>
            ),
          },
          role === 'outlet'
            ? {
                key: 'items',
                header: 'Items',
                render: (o: Order) => (
                  <small className="truncate">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</small>
                ),
              }
            : { key: 'outlet', header: 'Outlet', render: (o: Order) => o.outlet.name },
          {
            key: 'total',
            header: role === 'outlet' ? 'Items value' : 'Total',
            sort: (o) => o.total,
            render: (o) => <strong>{money(role === 'outlet' ? o.subtotal : o.total)}</strong>,
          },
          { key: 'method', header: 'Payment method', render: (o) => <PaymentName order={o} /> },
          { key: 'payment', header: 'Payment status', render: (o) => <PaymentStatusBadge order={o} /> },
          {
            key: 'status',
            header: 'Order status',
            render: (o) => (
              <span className="cell-stack">
                <Badge value={o.status} />
                {!closed(o) && <small>{stageLabel(o)}</small>}
                {o.flow?.cancel_request && <small className="warn-text">Cancellation requested</small>}
              </span>
            ),
          },
          ...(role === 'admin'
            ? [
                {
                  key: 'rider',
                  header: 'Rider',
                  render: (o: Order) =>
                    o.rider ? (
                      <span className="cell-stack">
                        <span>{o.rider.name}</span>
                        <small>{label(o.flow?.rider_status === 'unsent' ? 'not sent' : o.flow?.rider_status || '')}</small>
                      </span>
                    ) : (
                      <span className="muted">Unassigned</span>
                    ),
                },
              ]
            : []),
          {
            key: 'due',
            header: 'Due in',
            sort: (o) => o.deliver_by,
            render: (o) =>
              closed(o) ? (
                <span className="muted">{o.status === 'cancelled' ? 'Cancelled' : 'Delivered'}</span>
              ) : (
                <Countdown deadline={o.deliver_by} pending={o.status === 'placed'} />
              ),
          },
        ]}
        actions={(o) => <RowButtons o={o} role={role} a={a} open={() => setSelected(o.id)} />}
      />
      <Modal open={!!current} onClose={() => setSelected(null)} title={current ? 'Order ' + current.reference : 'Order'} size="xl">
        {current && <OrderPanel o={current} role={role} a={a} refresh={refresh} />}
      </Modal>
      <PromptModal prompt={a.prompt} onClose={a.closePrompt} />
    </div>
  );
}

/* ---------- Order panel ---------- */
const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
/** "just now", "5 min ago", "2 h ago", or the date for anything older than a day. */
function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return date(iso);
}
const orderSteps: { key: string; label: string; icon: typeof ClipboardList }[] = [
  { key: 'placed', label: 'Placed', icon: ClipboardList },
  { key: 'confirmed', label: 'Confirmed', icon: BadgeCheck },
  { key: 'preparing', label: 'Preparing', icon: ChefHat },
  { key: 'ready', label: 'Ready', icon: PackageCheck },
  { key: 'picked_up', label: 'On the way', icon: Bike },
  { key: 'delivered', label: 'Delivered', icon: House },
];
/** Where the order is in its life: each stage with the time it was reached, or where it was cancelled. */
function StatusStepper({ o }: { o: Order }) {
  const at = (key: string) =>
    key === 'placed'
      ? o.created_at
      : key === 'delivered' && o.delivered_at
        ? o.delivered_at
        : o.events.find((e) => e.status === key)?.created_at;
  const cancelled = o.status === 'cancelled';
  const reached = cancelled
    ? Math.max(0, ...orderSteps.map((s, i) => (at(s.key) ? i : 0)))
    : Math.max(0, orderSteps.findIndex((s) => s.key === o.status));
  const cancelledAt = o.events.find((e) => e.status === 'cancelled')?.created_at;
  return (
    <ol className="op-stepper" aria-label="Order progress">
      {orderSteps.map((s, i) => {
        const failed = cancelled && i === reached + 1;
        const state = failed
          ? 'fail'
          : i < reached || (i === reached && (o.status === 'delivered' || cancelled))
            ? 'done'
            : i === reached
              ? 'current'
              : 'todo';
        const Icon = failed ? XCircle : s.icon;
        const when = failed ? cancelledAt : state === 'todo' ? undefined : at(s.key);
        return (
          <li key={s.key} className={'op-step ' + state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="op-step-icon">
              <Icon size={16} />
            </span>
            <strong>{failed ? 'Cancelled' : s.label}</strong>
            <small>{when ? date(when) : state === 'current' ? 'In progress' : ' '}</small>
          </li>
        );
      })}
    </ol>
  );
}

function FlowCheck({
  state,
  icon,
  title,
  detail,
}: {
  state: 'done' | 'wait' | 'fail' | 'idle';
  icon: ReactNode;
  title: string;
  detail: ReactNode;
}) {
  const mark =
    state === 'done' ? <CheckCircle2 size={14} /> : state === 'fail' ? <XCircle size={14} /> : <CircleDashed size={14} />;
  return (
    <div className={'flow-step ' + state}>
      <span className="flow-icon">{icon}</span>
      <span>
        <strong>
          {title}
          <i className="flow-mark">{mark}</i>
        </strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}
/** The four confirmations an order needs before it is under way. */
export function FlowTracker({ o }: { o: Order }) {
  const f = o.flow;
  if (!f) return null;
  const response = (s: string, at: string | null, note: string, who: string) =>
    s === 'accepted'
      ? `Accepted ${at ? date(at) : ''}`
      : s === 'rejected'
        ? `Declined${note ? ': ' + note : ''}`
        : s === 'pending'
          ? `Waiting for ${who}`
          : 'Not sent yet';
  const tone = (s: string) => (s === 'accepted' ? 'done' : s === 'rejected' ? 'fail' : s === 'pending' ? 'wait' : 'idle');
  return (
    <div className="flow-tracker">
      <FlowCheck
        state={f.payment_verified_at ? 'done' : o.payment_status === 'rejected' ? 'fail' : 'wait'}
        icon={<CreditCard size={16} />}
        title="Payment"
        detail={
          f.payment_verified_at
            ? `Verified ${date(f.payment_verified_at)}`
            : o.payment_status === 'rejected'
              ? 'Rejected'
              : 'Awaiting verification'
        }
      />
      <FlowCheck
        state={tone(f.outlet_status)}
        icon={<Store size={16} />}
        title="Outlet"
        detail={response(f.outlet_status, f.outlet_responded_at, f.outlet_note, 'the outlet')}
      />
      <FlowCheck
        state={tone(f.rider_status)}
        icon={<Bike size={16} />}
        title={'Rider' + (o.rider ? ' · ' + o.rider.name : '')}
        detail={response(f.rider_status, f.rider_responded_at, f.rider_note, 'the rider')}
      />
      <FlowCheck
        state={o.status === 'cancelled' ? 'fail' : o.status === 'placed' ? 'idle' : 'done'}
        icon={<BadgeCheck size={16} />}
        title="Confirmed"
        detail={o.status === 'cancelled' ? 'Cancelled' : o.status === 'placed' ? 'After both accept' : label(o.status)}
      />
    </div>
  );
}

const eventIcons: Record<string, typeof ClipboardList> = {
  placed: ClipboardList,
  payment_verified: CreditCard,
  sent: Send,
  resent: RefreshCcw,
  outlet_accepted: Store,
  rider_requested: Bike,
  rider_accepted: UserRoundCheck,
  rider_rejected: UserX,
  confirmed: BadgeCheck,
  preparing: ChefHat,
  ready: PackageCheck,
  picked_up: Bike,
  delivered: House,
  cancelled: XCircle,
  reminder: BellRing,
  cancel_requested: AlertTriangle,
  cancel_request_dismissed: Undo2,
};
const eventTone = (s: string) =>
  ['cancelled', 'rider_rejected', 'cancel_requested'].includes(s)
    ? 'red'
    : ['delivered', 'confirmed', 'payment_verified', 'outlet_accepted', 'rider_accepted'].includes(s)
      ? 'green'
      : ['reminder', 'cancel_request_dismissed'].includes(s)
        ? 'orange'
        : 'blue';
/** Everything that happened to the order, newest first. */
export function Timeline({ o }: { o: Order }) {
  return (
    <ol className="op-timeline">
      {[...o.events].reverse().map((e, i) => {
        const Icon = eventIcons[e.status] || CircleDot;
        return (
          <li key={i} className={'tone-' + eventTone(e.status)}>
            <span className="op-tl-icon">
              <Icon size={14} />
            </span>
            <div>
              <strong>{eventLabels[e.status] || label(e.status)}</strong>
              {e.note && <p>{e.note}</p>}
              <small>
                {date(e.created_at)}
                {e.actor && e.actor !== 'system' ? ' · ' + label(e.actor) : ''}
              </small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type PoolRider = {
  id: string;
  name: string;
  login_id: string;
  phone: string;
  available: number;
  capacity: number;
  load: number;
  problem: string;
};
function Dispatch({ o, refresh }: { o: Order; refresh: () => void }) {
  const { notice } = useApp();
  const { data: pool, refresh: reloadPool } = useData<PoolRider[]>('/admin/orders/' + o.id + '/riders', 15000);
  const [rider, setRider] = useState(o.rider_id || '');
  const [busy, setBusy] = useState(false);
  const suggested = useMemo(() => pool?.find((r) => !r.problem), [pool]);
  useEffect(() => {
    if (!rider && suggested && o.flow.rider_status !== 'rejected') setRider(suggested.id);
  }, [suggested, rider, o.flow.rider_status]);
  useEffect(() => setRider(o.rider_id || ''), [o.rider_id]);
  const sent = !!o.flow.sent_at;
  const verified = !!o.flow.payment_verified_at;
  const choice = pool?.find((r) => r.id === rider);
  async function go() {
    setBusy(true);
    try {
      if (o.status === 'placed' && !sent)
        await api('/admin/orders/' + o.id + '/dispatch', { method: 'POST', body: JSON.stringify({ rider_id: rider }) });
      else
        await api('/admin/orders/' + o.id + '/assign', { method: 'PATCH', body: JSON.stringify({ rider_id: rider }) });
      notice(
        o.status === 'placed' && !sent
          ? 'Sent to the outlet and rider for confirmation.'
          : 'Rider request sent.',
      );
      refresh();
      reloadPool();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const unchanged = rider === o.rider_id && sent && o.flow.rider_status !== 'rejected';
  const free = pool?.filter((r) => !r.problem).length ?? 0;
  return (
    <section className="dispatch-box">
      <div className="card-head">
        <h3>
          <Send size={17} /> {o.status === 'placed' ? (sent ? 'Confirmation' : 'Assign rider & send') : 'Rider'}
        </h3>
        <span className="panel-badges">
          {pool && (
            <Badge tone={free ? 'success' : 'danger'}>
              {free} rider{free === 1 ? '' : 's'} free
            </Badge>
          )}
          {o.flow.rider_rejections > 0 && <Badge tone="warn">{o.flow.rider_rejections} rider decline(s)</Badge>}
        </span>
      </div>
      {!verified && (
        <div className="alert warn">
          <CreditCard size={16} /> Verify the customer’s payment in Payments before sending this order.
        </div>
      )}
      <div className="dispatch-row">
        <label className="grow">
          Rider in this area
          <select value={rider} onChange={(e) => setRider(e.target.value)} disabled={busy || !verified}>
            <option value="">Choose a rider…</option>
            {pool?.map((r) => (
              <option key={r.id} value={r.id} disabled={!!r.problem && r.id !== o.rider_id}>
                {r.name} · {r.login_id} · {r.load}/{r.capacity} active
                {r.problem ? ` — ${r.problem.replace(/^This rider (is |has )?/, '').replace(/\.$/, '')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy || !verified || !rider || !!choice?.problem || unchanged}
          onClick={go}
        >
          <Send size={15} />
          {busy ? 'Sending…' : o.status === 'placed' && !sent ? 'Send to outlet & rider' : rider !== o.rider_id || o.flow.rider_status === 'rejected' ? 'Send to rider' : 'Sent'}
        </button>
      </div>
      {pool && !pool.some((r) => !r.problem) && (
        <div className="alert error">
          <Ban size={16} /> No rider is available right now (all off duty, busy or disabled). You can wait, or cancel the
          order with a reason.
        </div>
      )}
      {choice?.problem && <small className="warn-text">{choice.problem}</small>}
    </section>
  );
}

function OrderPanel({ o, role, a, refresh }: { o: Order; role: Role; a: Actions; refresh: () => void }) {
  const { notice, locations } = useApp();
  const [otp, setOtp] = useState('');
  const [cash, setCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const online = o.payment_type !== 'cod';
  const f = o.flow;
  useEffect(() => {
    setOtp('');
    setCash(false);
  }, [o.id]);
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/orders/' + o.id + '/verify', { method: 'POST', body: JSON.stringify({ otp, cash_received: cash }) });
      refresh();
      notice('Delivery completed. Great work!');
    } catch (err) {
      notice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const working = !!a.busy?.startsWith(o.id);
  const units = o.items.reduce((s, i) => s + i.quantity, 0);
  const area = locations.find((l) => l.id === o.location_id)?.name;
  const cancelledAt = o.events.find((e) => e.status === 'cancelled')?.created_at;
  const late = !closed(o) && o.status !== 'placed' && new Date(o.deliver_by).getTime() < Date.now();
  const riderText = !o.rider
    ? ''
    : f?.rider_status === 'accepted'
      ? 'Accepted the delivery'
      : f?.rider_status === 'pending'
        ? 'Waiting for the rider to accept'
        : f?.rider_status === 'rejected'
          ? 'Declined — choose another rider'
          : 'Not sent yet';
  return (
    <div className="order-panel">
      {/* Summary */}
      <div className="op-hero">
        <div className="op-hero-top">
          <div className="panel-badges">
            <Badge value={o.status} />
            <PaymentStatusBadge order={o} />
            <span className="pay-chip">
              <PaymentName order={o} />
            </span>
          </div>
          <span className="op-ref">
            <Hash size={14} />
            {o.reference}
            <CopyButton value={o.reference} label="order number" />
          </span>
        </div>
        <div className="op-meta">
          <Meta icon={<CalendarClock size={17} />} label="Placed">
            {date(o.created_at)}
          </Meta>
          {o.status === 'delivered' ? (
            <Meta icon={<House size={17} />} label="Delivered" tone="green">
              {o.delivered_at ? date(o.delivered_at) : 'Delivered'}
            </Meta>
          ) : o.status === 'cancelled' ? (
            <Meta icon={<XCircle size={17} />} label="Cancelled" tone="red">
              {cancelledAt ? date(cancelledAt) : 'Cancelled'}
            </Meta>
          ) : (
            <Meta icon={<Timer size={17} />} label={late ? 'Running late' : 'Delivery due in'} tone={late ? 'red' : undefined}>
              <Countdown deadline={o.deliver_by} pending={o.status === 'placed'} />
            </Meta>
          )}
          <Meta icon={<ShoppingBag size={17} />} label="Items">
            {units} item{units === 1 ? '' : 's'} · {o.items.length} product{o.items.length === 1 ? '' : 's'}
          </Meta>
          <Meta icon={<Wallet size={17} />} label={role === 'outlet' ? 'Items value' : 'Order total'} tone="brand">
            {money(role === 'outlet' ? o.subtotal : o.total)}
          </Meta>
        </div>
      </div>

      {o.locked && (
        <div className="alert info">
          <Lock size={16} /> This order is completed and can no longer be changed.
        </div>
      )}
      {o.status === 'cancelled' && f?.cancel_reason && (
        <div className="alert error">
          <XCircle size={16} />
          <span>
            Cancelled by {label(f.cancelled_by || 'admin')}: {f.cancel_reason}
          </span>
        </div>
      )}
      {role === 'admin' && f?.cancel_request && o.status !== 'cancelled' && (
        <div className="alert warn request-alert">
          <Store size={16} />
          <span>
            <strong>{o.outlet.name} asked to cancel:</strong> {f.cancel_request}
          </span>
          <div className="panel-actions">
            <RowAction tone="danger" onClick={() => a.decideRequest(o, 'approve')}>
              Approve & cancel
            </RowAction>
            <RowAction onClick={() => a.decideRequest(o, 'dismiss')}>Ask to continue</RowAction>
          </div>
        </div>
      )}
      {role === 'outlet' && f?.cancel_request && o.status !== 'cancelled' && (
        <div className="alert info">
          <Clock size={16} /> Cancellation request sent: “{f.cancel_request}”. Dellvit will review it.
        </div>
      )}
      {role === 'rider' && f?.rider_status === 'pending' && !closed(o) && (
        <div className="alert warn">
          <Bike size={16} /> New delivery request. Accept to take it, or decline so another rider can be assigned.
        </div>
      )}

      <Section icon={<Route size={16} />} title="Progress">
        <StatusStepper o={o} />
        {role !== 'rider' && <FlowTracker o={o} />}
      </Section>

      {role === 'admin' && !closed(o) && o.status !== 'picked_up' && <Dispatch o={o} refresh={refresh} />}

      <div className="op-grid">
        <div className="op-col">
          <Section icon={<MapPin size={16} />} title="Pickup & delivery">
            <div className="op-route">
              <div className="op-stop pickup">
                <span className="op-stop-icon">
                  <Store size={16} />
                </span>
                <div className="op-stop-body">
                  <small>Pickup</small>
                  <strong>{o.outlet.name}</strong>
                  <span>{o.outlet.address}</span>
                  <div className="op-stop-actions">
                    <a className="op-chip" href={'tel:' + o.outlet.phone}>
                      <Phone size={13} /> {o.outlet.phone}
                    </a>
                    <a className="op-chip" href={mapsUrl(o.outlet.lat, o.outlet.lng)} target="_blank" rel="noreferrer">
                      <MapPinned size={13} /> Map
                    </a>
                  </div>
                </div>
              </div>
              <div className="op-stop drop">
                <span className="op-stop-icon">
                  <UserRound size={16} />
                </span>
                <div className="op-stop-body">
                  <small>Deliver to{area ? ' · ' + area : ''}</small>
                  <strong>{o.name}</strong>
                  <span>{o.address}</span>
                  <div className="op-stop-actions">
                    <a className="op-chip" href={'tel:' + o.phone}>
                      <Phone size={13} /> {o.phone}
                    </a>
                    <a className="op-chip" href={mapsUrl(o.lat, o.lng)} target="_blank" rel="noreferrer">
                      <MapPinned size={13} /> Map
                    </a>
                    {role === 'admin' && o.email && (
                      <a className="op-chip" href={'mailto:' + o.email}>
                        <Mail size={13} /> Email
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {o.notes && (
              <div className="op-note">
                <MessageSquareText size={16} />
                <span>
                  <small>Customer note</small>
                  {o.notes}
                </span>
              </div>
            )}
          </Section>

          {role !== 'rider' && o.rider && (
            <Section
              icon={<Bike size={16} />}
              title="Rider"
              aside={f?.rider_status && f.rider_status !== 'unsent' ? <Badge value={f.rider_status} /> : undefined}
            >
              <div className="op-person">
                <span className="op-avatar">{o.rider.name.slice(0, 1).toUpperCase()}</span>
                <span className="op-person-text">
                  <strong>{o.rider.name}</strong>
                  <small>{riderText}</small>
                </span>
                {o.rider.phone && (
                  <a className="op-chip" href={'tel:' + o.rider.phone}>
                    <Phone size={13} /> Call
                  </a>
                )}
              </div>
              {o.rider_location && !closed(o) && (
                <a
                  className="op-live"
                  href={mapsUrl(o.rider_location.lat, o.rider_location.lng)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <LocateFixed size={15} />
                  <span>
                    Last location {ago(o.rider_location.updated_at)}
                    {o.rider_location.accuracy ? ` · ±${Math.round(o.rider_location.accuracy)} m` : ''}
                  </span>
                  <ExternalLink size={13} />
                </a>
              )}
            </Section>
          )}

          {role === 'rider' && !closed(o) && (
            <Section icon={<Navigation size={16} />} title="Route">
              <DeliveryMap lat={o.lat} lng={o.lng} pickup={o.outlet} />
              <a href={navigateUrl(o)} target="_blank" rel="noreferrer" className="button ghost">
                <Navigation size={16} /> Open in Google Maps
              </a>
            </Section>
          )}
        </div>

        <div className="op-col">
          <Section
            icon={<ShoppingBag size={16} />}
            title="Items"
            aside={
              <small className="muted">
                {units} item{units === 1 ? '' : 's'}
              </small>
            }
          >
            <ul className="op-items">
              {o.items.map((i) => (
                <li key={i.id}>
                  {i.image ? <img src={i.image} alt="" loading="lazy" /> : <span className="op-item-ph" />}
                  <span className="op-item-text">
                    <strong>{i.name}</strong>
                    <small>
                      {i.quantity} × {money(i.unit_price)}
                    </small>
                  </span>
                  <strong>{money(i.unit_price * i.quantity)}</strong>
                </li>
              ))}
            </ul>
            <div className="op-totals">
              {role !== 'outlet' && (
                <>
                  <div className="line">
                    <span>Items</span>
                    <strong>{money(o.subtotal)}</strong>
                  </div>
                  <div className="line">
                    <span>Delivery</span>
                    <strong>{money(o.delivery_fee)}</strong>
                  </div>
                  {!!o.discount && (
                    <div className="line success">
                      <span>
                        Discount {o.coupon_code && <span className="op-code">{o.coupon_code}</span>}
                      </span>
                      <strong>−{money(o.discount)}</strong>
                    </div>
                  )}
                </>
              )}
              <div className="line total">
                <span>{role === 'outlet' ? 'Items value' : 'Total'}</span>
                <strong>{money(role === 'outlet' ? o.subtotal : o.total)}</strong>
              </div>
            </div>
          </Section>

          {role === 'admin' && (
            <Section icon={<CreditCard size={16} />} title="Payment" aside={<PaymentStatusBadge order={o} />}>
              <div className="op-pay">
                <PaymentLogo
                  method={{ ...o.payment_details, type: (o.payment_type || 'cod') as PaymentMethod['type'] }}
                  className="op-pay-logo"
                  size={18}
                />
                <span className="op-person-text">
                  <strong>{o.payment_name || 'Cash on delivery'}</strong>
                  <small>{paymentTypeLabels[o.payment_type === 'manual' ? 'bank' : o.payment_type || 'cod'] || ''}</small>
                </span>
              </div>
              <dl className="op-kv">
                {online ? (
                  <>
                    <dt>Transaction ID</dt>
                    <dd>
                      {o.transaction_id ? (
                        <>
                          <span className="mono">{o.transaction_id}</span>
                          <CopyButton value={o.transaction_id} label="transaction ID" />
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                    <dt>Sender</dt>
                    <dd>{o.payer_name || '—'}</dd>
                    {o.payer_account && (
                      <>
                        <dt>Account</dt>
                        <dd>{o.payer_account}</dd>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <dt>Collect</dt>
                    <dd>{money(o.total)} in cash at the door</dd>
                  </>
                )}
                <dt>Verified</dt>
                <dd>{f?.payment_verified_at ? date(f.payment_verified_at) : 'Not yet'}</dd>
              </dl>
              {o.payment_note && (
                <div className="op-note">
                  <MessageSquareText size={16} />
                  <span>
                    <small>Payment note</small>
                    {o.payment_note}
                  </span>
                </div>
              )}
              {o.proof_url && (
                <a className="op-live" href={o.proof_url} target="_blank" rel="noreferrer">
                  <Receipt size={15} />
                  <span>View payment receipt</span>
                  <ExternalLink size={13} />
                </a>
              )}
            </Section>
          )}
        </div>
      </div>

      {!o.locked && o.status !== 'cancelled' && (
        <div className="panel-actions op-actions">
          {role === 'outlet' && o.status === 'placed' && f?.outlet_status === 'pending' && (
            <>
              <button className="button" disabled={working} onClick={() => a.outletAccept(o)}>
                <CheckCircle2 size={16} /> Accept order
              </button>
              <button className="button danger-ghost" onClick={() => a.outletReject(o)}>
                Reject order
              </button>
            </>
          )}
          {role === 'outlet' && o.status === 'confirmed' && (
            <button className="button" disabled={working} onClick={() => a.status(o, 'preparing', 'Marked as preparing.')}>
              <ChefHat size={16} /> Start preparing
            </button>
          )}
          {role === 'outlet' && o.status === 'preparing' && (
            <button className="button" disabled={working} onClick={() => a.status(o, 'ready', 'Marked ready for pickup.')}>
              <PackageCheck size={16} /> Mark ready for pickup
            </button>
          )}
          {role === 'outlet' && ['confirmed', 'preparing'].includes(o.status) && !f?.cancel_request && (
            <button className="button danger-ghost" onClick={() => a.requestCancel(o)}>
              Request cancellation
            </button>
          )}
          {role === 'rider' && f?.rider_status === 'pending' && (
            <>
              <button className="button" disabled={working} onClick={() => a.riderAccept(o)}>
                <UserRoundCheck size={16} /> Accept delivery
              </button>
              <button className="button danger-ghost" onClick={() => a.riderReject(o)}>
                Decline
              </button>
            </>
          )}
          {role === 'rider' && o.status === 'ready' && f?.rider_status === 'accepted' && (
            <button className="button" disabled={working} onClick={() => a.status(o, 'picked_up', 'Pickup confirmed.')}>
              <Bike size={16} /> Confirm pickup
            </button>
          )}
          {role === 'admin' && ['confirmed', 'preparing'].includes(o.status) && (
            <button className="button ghost" onClick={() => a.remind(o)}>
              <BellRing size={16} /> Remind outlet
              {f?.reminders ? <span className="tab-count">{f.reminders}</span> : null}
            </button>
          )}
          {role === 'admin' && o.can_cancel && (
            <button className="button danger-ghost" onClick={() => a.cancel(o, role)}>
              <XCircle size={16} /> Cancel order
            </button>
          )}
        </div>
      )}
      {role === 'rider' && o.status === 'picked_up' && (
        <form onSubmit={verify} className="otp-form">
          <h3>
            <ShieldCheck size={18} /> Complete delivery
          </h3>
          <label className="check">
            <input required type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} />
            {online
              ? o.payment_status === 'paid'
                ? 'Payment was verified online — do not collect cash'
                : 'Waiting for payment verification'
              : `I collected ${money(o.total)} in cash`}
          </label>
          <div className="otp-row">
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              autoComplete="one-time-code"
              placeholder="6-digit code"
              aria-label="Customer delivery code"
            />
            <button className="button" disabled={busy || (online && o.payment_status !== 'paid')}>
              Verify & complete
            </button>
          </div>
        </form>
      )}
      {role !== 'rider' || closed(o) ? (
        <Section
          icon={<History size={16} />}
          title="Activity"
          aside={
            <small className="muted">
              {o.events.length} event{o.events.length === 1 ? '' : 's'}
            </small>
          }
        >
          <Timeline o={o} />
        </Section>
      ) : null}
      {!o.flow && <ErrorBox error="Workflow details are unavailable for this order." />}
    </div>
  );
}
