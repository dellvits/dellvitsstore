'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Ban,
  BellRing,
  Bike,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Clock,
  CreditCard,
  HandCoins,
  Lock,
  Navigation,
  Package,
  PackageCheck,
  Send,
  ShieldCheck,
  Store,
  Truck,
  UserRoundCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { inRange, useRange } from '@/lib/range';
import type { CashStatement, Order } from '@/lib/types';
import { Badge, DataTable, FilterBar, Modal, RowAction, Stat, ErrorBox } from './UI';
import {
  Countdown,
  PaymentStatusBadge,
  eventLabels,
  orderStatuses,
  paymentTypeLabels,
  stageLabel,
} from './Orders';
import { PaymentName } from './Checkout';
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
function DeskStats({ role, rows }: { role: Role; rows: Order[] }) {
  const { range, setRange, query, label: rangeText } = useRange('7d');
  const { data: cash } = useData<CashStatement>(role === 'rider' ? '/rider/cash' + query : null, 30000);
  const inWindow = rows.filter((o) => inRange(o.created_at, range));
  const count = (fn: (o: Order) => boolean) => inWindow.filter(fn).length;
  const active = rows.filter((o) => !closed(o));
  return (
    <div className="stack tight">
      <FilterBar
        title={role === 'rider' ? 'Delivery summary' : 'Order summary'}
        hint={`Showing ${rangeText.toLowerCase()}`}
        range={range}
        onRange={setRange}
      />
      <div className="stats compact">
        {role === 'admin' && (
          <>
            <Stat icon={<ClipboardList size={18} />} label="Total orders" value={inWindow.length} tone="blue" />
            <Stat
              icon={<Send size={18} />}
              label="Needs dispatch"
              value={count((o) => needsDispatch(o) || needsRider(o))}
              hint={`${count((o) => o.status === 'placed' && !o.flow?.payment_verified_at)} awaiting payment`}
              tone="orange"
            />
            <Stat icon={<Clock size={18} />} label="In progress" value={count((o) => !closed(o))} tone="purple" />
            <Stat
              icon={<PackageCheck size={18} />}
              label="Delivered"
              value={count((o) => o.status === 'delivered')}
              hint={money(inWindow.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.total, 0)) + ' sales'}
              tone="green"
            />
            <Stat icon={<XCircle size={18} />} label="Cancelled" value={count((o) => o.status === 'cancelled')} />
          </>
        )}
        {role === 'outlet' && (
          <>
            <Stat icon={<ClipboardList size={18} />} label="Total orders" value={inWindow.length} tone="blue" />
            <Stat
              icon={<BellRing size={18} />}
              label="New requests"
              value={rows.filter((o) => o.status === 'placed' && o.flow?.outlet_status === 'pending').length}
              hint="Waiting for your answer"
              tone="orange"
            />
            <Stat
              icon={<Package size={18} />}
              label="In the kitchen"
              value={rows.filter((o) => ['confirmed', 'preparing'].includes(o.status)).length}
              hint={`${rows.filter((o) => o.status === 'ready').length} ready for pickup`}
              tone="purple"
            />
            <Stat icon={<PackageCheck size={18} />} label="Delivered" value={count((o) => o.status === 'delivered')} tone="green" />
            <Stat icon={<XCircle size={18} />} label="Cancelled" value={count((o) => o.status === 'cancelled')} />
          </>
        )}
        {role === 'rider' && (
          <>
            <Stat
              icon={<Truck size={18} />}
              label="Active orders"
              value={active.length}
              hint={`${rows.filter((o) => o.flow?.rider_status === 'pending' && !closed(o)).length} waiting for you`}
              tone="orange"
            />
            <Stat
              icon={<PackageCheck size={18} />}
              label="Delivered"
              value={rows.filter((o) => o.status === 'delivered' && inRange(o.delivered_at, range)).length}
              tone="green"
            />
            <Stat icon={<HandCoins size={18} />} label="COD collected" value={money(cash?.collected_range || 0)} tone="blue" />
            <Stat
              icon={<Wallet size={18} />}
              label="Cash in hand"
              value={money(cash?.in_hand || 0)}
              hint={cash?.pending ? money(cash.pending) + ' awaiting verification' : 'Current balance'}
              tone="purple"
            />
            <Stat
              icon={<ShieldCheck size={18} />}
              label="Submitted to Dellvit"
              value={money(cash?.submitted_range || 0)}
              hint="Verified submissions"
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
      <DeskStats role={role} rows={rows} />
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
            render: (o) => <Countdown deadline={o.deliver_by} done={closed(o)} pending={o.status === 'placed'} />,
          },
        ]}
        actions={(o) => <RowButtons o={o} role={role} a={a} open={() => setSelected(o.id)} />}
      />
      <Modal open={!!current} onClose={() => setSelected(null)} title={current ? current.reference : 'Order'} size="lg">
        {current && <OrderPanel o={current} role={role} a={a} refresh={refresh} />}
      </Modal>
      <PromptModal prompt={a.prompt} onClose={a.closePrompt} />
    </div>
  );
}

/* ---------- Order panel ---------- */
function Check({ state, title, detail }: { state: 'done' | 'wait' | 'fail' | 'idle'; title: string; detail: ReactNode }) {
  return (
    <div className={'flow-step ' + state}>
      <span className="flow-icon">
        {state === 'done' ? <CheckCircle2 size={17} /> : state === 'fail' ? <XCircle size={17} /> : <CircleDashed size={17} />}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}
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
      <Check
        state={f.payment_verified_at ? 'done' : o.payment_status === 'rejected' ? 'fail' : 'wait'}
        title="Payment"
        detail={f.payment_verified_at ? `Verified ${date(f.payment_verified_at)}` : o.payment_status === 'rejected' ? 'Rejected' : 'Awaiting verification'}
      />
      <Check state={tone(f.outlet_status)} title="Outlet" detail={response(f.outlet_status, f.outlet_responded_at, f.outlet_note, 'the outlet')} />
      <Check
        state={tone(f.rider_status)}
        title={'Rider' + (o.rider ? ' · ' + o.rider.name : '')}
        detail={response(f.rider_status, f.rider_responded_at, f.rider_note, 'the rider')}
      />
      <Check
        state={o.status === 'cancelled' ? 'fail' : o.status === 'placed' ? 'idle' : 'done'}
        title="Confirmed"
        detail={o.status === 'cancelled' ? 'Cancelled' : o.status === 'placed' ? 'After both accept' : label(o.status)}
      />
    </div>
  );
}
export function Timeline({ o }: { o: Order }) {
  return (
    <ol className="timeline">
      {[...o.events].reverse().map((e, i) => (
        <li key={i} className={'tl-' + e.status}>
          <strong>{eventLabels[e.status] || label(e.status)}</strong>
          {e.note && <span>{e.note}</span>}
          <small>
            {date(e.created_at)}
            {e.actor && e.actor !== 'system' ? ' · ' + label(e.actor) : ''}
          </small>
        </li>
      ))}
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
  return (
    <section className="dispatch-box">
      <div className="card-head">
        <h3>
          <Send size={17} /> {o.status === 'placed' ? (sent ? 'Confirmation' : 'Assign rider & send') : 'Rider'}
        </h3>
        {o.flow.rider_rejections > 0 && <Badge tone="warn">{o.flow.rider_rejections} rider decline(s)</Badge>}
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
  const { notice } = useApp();
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
  return (
    <div className="order-panel">
      <div className="panel-badges">
        <Badge value={o.status} />
        <PaymentStatusBadge order={o} />
        <span className="pay-chip">
          <PaymentName order={o} />
        </span>
        <span className="muted small">
          Due <Countdown deadline={o.deliver_by} done={closed(o)} pending={o.status === 'placed'} />
        </span>
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
      {role !== 'rider' && <FlowTracker o={o} />}
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
      {role === 'admin' && !closed(o) && o.status !== 'picked_up' && (
        <Dispatch o={o} refresh={refresh} />
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
      <div className="grid-2">
        <div className="route">
          <div className="route-stop pickup">
            <small>Pickup</small>
            <strong>{o.outlet.name}</strong>
            <span>{o.outlet.address}</span>
            <a href={'tel:' + o.outlet.phone}>{o.outlet.phone}</a>
          </div>
          <div className="route-stop drop">
            <small>Deliver to</small>
            <strong>{o.name}</strong>
            <span>{o.address}</span>
            <a href={'tel:' + o.phone}>{o.phone}</a>
            {o.notes && <em>“{o.notes}”</em>}
          </div>
        </div>
        <div className="mini-summary">
          {o.items.map((i) => (
            <div className="line" key={i.id}>
              <span>
                {i.quantity} × {i.name}
              </span>
              <strong>{money(i.unit_price * i.quantity)}</strong>
            </div>
          ))}
          {role !== 'outlet' && (
            <>
              <div className="line">
                <span>Delivery</span>
                <strong>{money(o.delivery_fee)}</strong>
              </div>
              {!!o.discount && (
                <div className="line success">
                  <span>Discount {o.coupon_code}</span>
                  <strong>−{money(o.discount)}</strong>
                </div>
              )}
            </>
          )}
          <div className="line total">
            <span>{role === 'outlet' ? 'Items value' : 'Total'}</span>
            <strong>{money(role === 'outlet' ? o.subtotal : o.total)}</strong>
          </div>
          {role === 'admin' && online && (
            <div className="kv small">
              <span>TID</span>
              <strong>{o.transaction_id || '—'}</strong>
              <span>Sender</span>
              <strong>{o.payer_name || '—'}</strong>
              {o.proof_url && (
                <>
                  <span>Receipt</span>
                  <a className="link" href={o.proof_url} target="_blank" rel="noreferrer">
                    View screenshot
                  </a>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {role === 'rider' && !closed(o) && (
        <>
          <DeliveryMap lat={o.lat} lng={o.lng} pickup={o.outlet} />
          <a href={navigateUrl(o)} target="_blank" rel="noreferrer" className="button ghost">
            <Navigation size={16} /> Open in Google Maps
          </a>
        </>
      )}
      {!o.locked && o.status !== 'cancelled' && (
        <div className="panel-actions">
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
              <Package size={16} /> Start preparing
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
              Cancel order
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
        <section>
          <h3 className="section-label">Activity</h3>
          <Timeline o={o} />
        </section>
      ) : null}
      {!o.flow && <ErrorBox error="Workflow details are unavailable for this order." />}
    </div>
  );
}
