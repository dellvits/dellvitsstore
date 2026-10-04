'use client';
import { useState, type ReactNode } from 'react';
import {
  Activity,
  AlarmClock,
  CalendarDays,
  MapPin,
  Navigation,
  Truck,
  AlertTriangle,
  BadgePercent,
  Ban,
  Banknote,
  BellRing,
  Bike,
  CirclePause,
  ClipboardList,
  CreditCard,
  HandCoins,
  Mail,
  Package,
  PackageCheck,
  PackageX,
  ReceiptText,
  Send,
  Store,
  Ticket,
  TrendingUp,
  Undo2,
  UserX,
  Wallet,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useRange } from '@/lib/range';
import type { AdminAttention, AdminSummary, CashStatement, Order, OutletSummary, RiderStatement } from '@/lib/types';
import { Badge, DataTable, ErrorBox, FilterBar, LiveBadge, RangeFilter, RowAction, Skeleton, Stat, Toggle } from './UI';
import { Countdown, orderStatuses, PaymentStatusBadge, stageLabel } from './Orders';
import { commissionText } from './Platform';

function StatusBars({
  statuses,
  total,
  loading = false,
}: {
  statuses: Record<string, number>;
  total?: number;
  loading?: boolean;
}) {
  const counts = orderStatuses.map((s) => [s, statuses[s] || 0] as const);
  const max = Math.max(1, ...counts.map((c) => c[1]));
  const sum = total ?? counts.reduce((s, c) => s + c[1], 0);
  return (
    <div className={'bars' + (loading ? ' is-loading' : '')} aria-busy={loading || undefined}>
      {counts.map(([s, n]) => (
        <div className="bar-row" key={s}>
          <span>{label(s)}</span>
          <div className="bar">
            <i className={loading ? 'bar-shimmer' : 'tone-' + s} style={{ width: loading ? '100%' : `${(n / max) * 100}%` }} />
          </div>
          <strong>{loading ? '·' : n}</strong>
        </div>
      ))}
      <small className="muted bars-foot">
        {loading ? 'Loading…' : `${sum} order${sum === 1 ? '' : 's'} in this period`}
      </small>
    </div>
  );
}
/** A live queue card: same layout as the sales cards, muted while nothing is waiting. */
function Queue({
  count,
  urgent = true,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  count: number | undefined;
  hint?: ReactNode;
  tone?: string;
  /** Mute the card at zero; off for figures where zero is not "all clear". */
  urgent?: boolean;
  onClick: () => void;
}) {
  return <Stat {...rest} value={count ?? 0} loading={count === undefined} quiet={urgent && count === 0} />;
}
type QueueGroup = { title: string; items: ReactNode[] };
function AttentionPanel({ checkedAt, groups }: { checkedAt?: string; groups: QueueGroup[] }) {
  const shown = groups.filter((g) => g.items.length);
  if (!shown.length) return null;
  return (
    <section className="card attention-card">
      <div className="card-head">
        <h3>
          <BellRing size={17} /> Needs attention
        </h3>
        <span className="attention-meta">
          <LiveBadge />
          <small className="muted">
            All time
            {checkedAt &&
              ' · updated ' +
                new Date(checkedAt).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          </small>
        </span>
      </div>
      {shown.map((g) => (
        <div className="attention-group" key={g.title}>
          {shown.length > 1 && <h4>{g.title}</h4>}
          <div className="stats attention-stats">{g.items}</div>
        </div>
      ))}
    </section>
  );
}
function AdminAttentionPanel({ can, go }: { can: (p: string) => boolean; go: (tab: string) => void }) {
  const { data: a } = useData<AdminAttention>('/admin/attention', 15000);
  const n = (k: keyof AdminAttention) => (a ? Number(a[k]) : undefined);
  const total = (k: keyof AdminAttention) => (a ? money(Number(a[k])) + ' in total' : '');
  const groups: QueueGroup[] = [
    {
      title: 'Orders',
      items: can('orders')
        ? [
            <Queue
              key="active"
              icon={<Activity size={18} />}
              label="Active orders"
              count={n('active')}
              hint={a ? `${a.ready} ready · ${a.on_the_road} on the road` : ''}
              tone="blue"
              urgent={false}
              onClick={() => go('orders')}
            />,
            <Queue
              key="late"
              icon={<AlarmClock size={18} />}
              label="Running late"
              count={n('late')}
              hint="Past the promised delivery time"
              onClick={() => go('orders')}
            />,
            <Queue
              key="dispatch"
              icon={<Send size={18} />}
              label="To assign & send"
              count={n('dispatch')}
              hint="Payment verified, not sent yet"
              tone="orange"
              onClick={() => go('orders')}
            />,
            <Queue
              key="outlet"
              icon={<Store size={18} />}
              label="Waiting for outlet"
              count={n('awaiting_outlet')}
              hint="Outlet has not accepted yet"
              tone="orange"
              onClick={() => go('orders')}
            />,
            <Queue
              key="rider"
              icon={<Bike size={18} />}
              label="Waiting for rider"
              count={n('awaiting_rider')}
              hint="Rider has not accepted yet"
              tone="purple"
              onClick={() => go('orders')}
            />,
            <Queue
              key="reassign"
              icon={<UserX size={18} />}
              label="Riders to reassign"
              count={n('rider_needed')}
              hint="No rider, or the rider declined"
              tone="purple"
              onClick={() => go('orders')}
            />,
            <Queue
              key="declined"
              icon={<Ban size={18} />}
              label="Declined by outlet"
              count={n('outlet_declined')}
              hint="Resend to the outlet or cancel"
              onClick={() => go('orders')}
            />,
            <Queue
              key="cancel"
              icon={<AlertTriangle size={18} />}
              label="Cancellation requests"
              count={n('cancel_requests')}
              hint="Raised by outlets"
              onClick={() => go('orders')}
            />,
          ]
        : [],
    },
    {
      title: 'Payments & cash',
      items: [
        ...(can('payments')
          ? [
              <Queue
                key="payments"
                icon={<CreditCard size={18} />}
                label="Payments to verify"
                count={n('payments')}
                hint={total('payments_amount')}
                tone="purple"
                onClick={() => go('payments')}
              />,
              <Queue
                key="refunds"
                icon={<Undo2 size={18} />}
                label="Refunds due"
                count={n('refunds')}
                hint={total('refunds_amount')}
                tone="blue"
                onClick={() => go('payments')}
              />,
            ]
          : []),
        ...(can('riders')
          ? [
              <Queue
                key="payouts"
                icon={<Banknote size={18} />}
                label="Rider payout requests"
                count={n('payout_requests')}
                hint={total('payout_amount')}
                tone="green"
                onClick={() => go('payouts')}
              />,
              <Queue
                key="cod"
                icon={<HandCoins size={18} />}
                label="COD cash submissions"
                count={n('cod_deposits')}
                hint={total('cod_amount')}
                tone="green"
                onClick={() => go('cash')}
              />,
            ]
          : []),
      ],
    },
    {
      title: 'Riders, catalog & inbox',
      items: [
        ...(can('riders')
          ? [
              <Queue
                key="riders"
                icon={<Bike size={18} />}
                label="Riders available"
                count={n('riders_available')}
                hint={a ? `${a.riders_busy} on deliveries · ${a.riders_total} active riders` : ''}
                tone={a && !a.riders_available ? 'red' : 'green'}
                urgent={false}
                onClick={() => go('riders')}
              />,
            ]
          : []),
        ...(can('products')
          ? [
              <Queue
                key="stock"
                icon={<PackageX size={18} />}
                label="Out of stock"
                count={n('out_of_stock')}
                hint={a ? `${a.low_stock} more running low` : ''}
                onClick={() => go('products')}
              />,
            ]
          : []),
        ...(can('outlets')
          ? [
              <Queue
                key="paused"
                icon={<CirclePause size={18} />}
                label="Outlets paused"
                count={n('outlets_paused')}
                hint={a ? `${a.outlets_total - a.outlets_paused} of ${a.outlets_total} taking orders` : ''}
                tone="orange"
                onClick={() => go('outlets')}
              />,
            ]
          : []),
        ...(can('messages')
          ? [
              <Queue
                key="messages"
                icon={<Mail size={18} />}
                label="New messages"
                count={n('messages')}
                hint="Contact form · last 24 hours"
                tone="blue"
                onClick={() => go('messages')}
              />,
            ]
          : []),
      ],
    },
  ];
  return <AttentionPanel checkedAt={a?.checked_at} groups={groups} />;
}

/* ---------- Super admin dashboard ---------- */
export function AdminOverview({ go }: { go: (tab: string) => void }) {
  const { user } = useApp();
  const can = (p: string) => !!(user?.is_super_admin || user?.permissions?.includes(p));
  const cards = useRange('today');
  const status = useRange('24h');
  const { data, loading: cardsLoading, error, refresh } = useData<AdminSummary>(
    '/admin/summary' + cards.query,
    30000,
    'admin-summary:' + cards.key,
  );
  const { data: statusData, loading: statusLoading } = useData<AdminSummary>(
    '/admin/summary' + status.query,
    30000,
    'admin-summary:' + status.key,
  );
  const { data: orders, loading } = useData<Order[]>(can('orders') ? '/orders' : null, 20000);
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const busy = cardsLoading || !data;
  const pct = (n = 0) => (data?.sales ? Math.round((n / data.sales) * 100) + '% of sales' : '0% of sales');
  return (
    <div className="stack">
      <FilterBar
        title="Sales overview"
        hint={`Delivered orders placed ${cards.label.toLowerCase()}`}
        range={cards.range}
        onRange={cards.setRange}
      />
      <div className="stats six">
        <Stat
          icon={<ClipboardList size={20} />}
          label="Total orders"
          value={data?.orders ?? 0}
          hint={`${data?.delivered ?? 0} delivered · ${data?.cancelled ?? 0} cancelled`}
          tone="blue"
          loading={busy}
        />
        <Stat
          icon={<TrendingUp size={20} />}
          label="Total sales"
          value={money(data?.sales || 0)}
          hint={`${money(data?.delivery_fees || 0)} delivery fees`}
          tone="green"
          loading={busy}
        />
        <Stat
          icon={<Store size={20} />}
          label="Outlet deductions"
          value={money(data?.outlet_deducted || 0)}
          hint={`Paid to outlets · ${pct(data?.outlet_deducted)}`}
          tone="orange"
          loading={busy}
        />
        <Stat
          icon={<Bike size={20} />}
          label="Rider commissions"
          value={money(data?.rider_commission || 0)}
          hint={pct(data?.rider_commission)}
          tone="purple"
          loading={busy}
        />
        <Stat
          icon={<Ticket size={20} />}
          label="Coupon deductions"
          value={money(data?.coupon_deductions || 0)}
          hint="Discounts given"
          loading={busy}
        />
        <Stat
          icon={<Wallet size={20} />}
          label="Store sales (net)"
          value={money(data?.store_sales || 0)}
          hint={`${money(data?.outlet_commission || 0)} commission earned`}
          tone={data && data.store_sales < 0 ? 'red' : 'green'}
          loading={busy}
        />
      </div>
      <AdminAttentionPanel can={can} go={go} />
      <div className="grid-dash">
        {can('orders') ? (
          <DataTable
            title={<h3>Latest orders</h3>}
            rows={orders}
            loading={loading}
            rowKey={(o) => o.id}
            pageSize={5}
            toolbar={
              <button className="button ghost small" onClick={() => go('orders')}>
                Manage orders
              </button>
            }
            columns={[
              {
                key: 'ref',
                header: 'Order',
                render: (o) => (
                  <span className="cell-stack">
                    <strong>{o.reference}</strong>
                    <small>{date(o.created_at)}</small>
                  </span>
                ),
              },
              { key: 'customer', header: 'Customer', render: (o) => o.name },
              { key: 'outlet', header: 'Outlet', render: (o) => o.outlet.name },
              { key: 'total', header: 'Total', render: (o) => money(o.total) },
              { key: 'payment', header: 'Payment', render: (o) => <PaymentStatusBadge order={o} /> },
              { key: 'status', header: 'Status', render: (o) => <Badge value={o.status} /> },
            ]}
          />
        ) : (
          <div className="card muted">Orders module not assigned.</div>
        )}
        <section className="card">
          <div className="card-head">
            <h3>Orders by status</h3>
            <RangeFilter value={status.range} onChange={status.setRange} />
          </div>
          <StatusBars statuses={statusData?.statuses || {}} total={statusData?.orders} loading={statusLoading || !statusData} />
        </section>
      </div>
    </div>
  );
}

/* ---------- Outlet dashboard ---------- */
type Settlement = {
  order_id: string;
  reference: string;
  subtotal: number;
  outlet_rate: number;
  outlet_commission: number;
  outlet_payable: number;
  created_at: string;
  order_created_at: string;
};
export function OutletDashboard({ go }: { go: (tab: string) => void }) {
  const { notice } = useApp();
  const cards = useRange('7d');
  const { data, loading: cardsLoading, error, refresh } = useData<OutletSummary>(
    '/manage/outlet/summary' + cards.query,
    20000,
    'outlet-summary:' + cards.key,
  );
  const { data: settlements, loading } = useData<Settlement[]>('/manage/outlet/settlements', 60000);
  const [saving, setSaving] = useState(false);
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const o = data?.outlet;
  const busy = cardsLoading || !data;
  return (
    <div className="stack">
      <section className="card dash-hero">
        <div className="cell-main">
          {o?.image && <img className="outlet-hero-img" src={o.image} alt="" />}
          <span className="cell-stack">
            <strong>{o?.name || 'Your outlet'}</strong>
            <small>
              {o?.category} · {o?.address}
            </small>
          </span>
        </div>
        <div className="outlet-hero-tools">
          <Badge tone={o?.accepting ? 'success' : 'danger'}>{o?.accepting ? 'Open for orders' : 'Paused'}</Badge>
          {o && (
            <Toggle
              checked={!!o.accepting}
              disabled={saving}
              label="Accept new orders"
              onChange={async (v) => {
                setSaving(true);
                try {
                  await api('/manage/outlet/settings', { method: 'PATCH', body: JSON.stringify({ accepting: v }) });
                  notice(v ? 'You are accepting orders again.' : 'New orders are paused.');
                  refresh();
                } catch (e) {
                  notice((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}
        </div>
      </section>
      <AttentionPanel
        checkedAt={data?.checked_at}
        groups={[
          {
            title: 'Orders',
            items: [
              <Queue
                key="requests"
                icon={<BellRing size={18} />}
                label="New order requests"
                count={data?.awaiting_response}
                hint="Accept or decline them"
                tone="orange"
                onClick={() => go('orders')}
              />,
              <Queue
                key="kitchen"
                icon={<Package size={18} />}
                label="Orders to prepare"
                count={data?.in_kitchen}
                hint="Accepted, being prepared"
                tone="purple"
                onClick={() => go('orders')}
              />,
              <Queue
                key="pickup"
                icon={<PackageCheck size={18} />}
                label="Waiting for rider"
                count={data?.awaiting_pickup}
                hint="Ready for pickup"
                tone="green"
                onClick={() => go('orders')}
              />,
              <Queue
                key="late"
                icon={<AlarmClock size={18} />}
                label="Running late"
                count={data?.late}
                hint="Past the promised delivery time"
                onClick={() => go('orders')}
              />,
              <Queue
                key="stock"
                icon={<PackageX size={18} />}
                label="Out of stock"
                count={data?.out_of_stock}
                hint={data ? `${data.low_stock_count} more running low` : ''}
                onClick={() => go('products')}
              />,
            ],
          },
        ]}
      />
      <FilterBar title="Performance" hint={`Orders placed ${cards.label.toLowerCase()}`} range={cards.range} onRange={cards.setRange} />
      <div className="stats six">
        <Stat icon={<ClipboardList size={20} />} label="Orders" value={data?.orders ?? 0} hint={`${data?.statuses.cancelled || 0} cancelled`} tone="blue" loading={busy} />
        <Stat icon={<PackageCheck size={20} />} label="Delivered" value={data?.delivered ?? 0} tone="green" loading={busy} />
        <Stat icon={<TrendingUp size={20} />} label="Item sales" value={money(data?.sales || 0)} tone="green" loading={busy} />
        <Stat
          icon={<BadgePercent size={20} />}
          label="Dellvit commission"
          value={money(data?.commission || 0)}
          hint={`${o?.commission_rate ?? 0}% of item sales`}
          tone="orange"
          loading={busy}
        />
        <Stat icon={<Wallet size={20} />} label="Your earnings" value={money(data?.payable || 0)} hint="After commission" tone="purple" loading={busy} />
        <Stat icon={<ReceiptText size={20} />} label="Average order" value={money(data?.average_order || 0)} loading={busy} />
      </div>
      <div className="grid-3">
        <section className="card">
          <div className="card-head">
            <h3>Orders by status</h3>
          </div>
          <StatusBars statuses={data?.statuses || {}} total={data?.orders} loading={busy} />
        </section>
        <section className="card">
          <div className="card-head">
            <h3>Top products</h3>
          </div>
          {busy ? (
            <Skeleton count={3} className="list-skeleton" />
          ) : data?.top_products.length ? (
            <ul className="rank-list">
              {data.top_products.map((p, i) => (
                <li key={p.product_id}>
                  <span className="rank">{i + 1}</span>
                  <img src={p.image} alt="" />
                  <span className="cell-stack grow">
                    <strong>{p.name}</strong>
                    <small>{p.quantity} sold</small>
                  </span>
                  <strong>{money(p.revenue)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No delivered orders in this period.</p>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h3>Low stock</h3>
            <RowAction onClick={() => go('products')}>Manage</RowAction>
          </div>
          {busy ? (
            <Skeleton count={3} className="list-skeleton" />
          ) : data?.low_stock.length ? (
            <ul className="rank-list">
              {data.low_stock.map((p) => (
                <li key={p.id}>
                  <img src={p.image} alt="" />
                  <span className="grow">{p.name}</span>
                  <Badge tone={p.stock === 0 ? 'danger' : 'warn'}>{p.stock} left</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Every listed product has 10 or more in stock.</p>
          )}
        </section>
      </div>
      <DataTable
        title={<h3>Settlements</h3>}
        rows={settlements}
        loading={loading}
        rowKey={(s) => s.order_id}
        dateFilter={{ get: (s) => s.created_at }}
        search={(s) => s.reference}
        searchPlaceholder="Search order"
        empty="Earnings appear here when your orders are delivered."
        columns={[
          {
            key: 'ref',
            header: 'Order',
            sort: (s) => s.created_at,
            render: (s) => (
              <span className="cell-stack">
                <strong>{s.reference}</strong>
                <small>Delivered {date(s.created_at)}</small>
              </span>
            ),
          },
          { key: 'sales', header: 'Item sales', sort: (s) => s.subtotal, render: (s) => money(s.subtotal) },
          {
            key: 'commission',
            header: 'Commission',
            render: (s) => (
              <span className="cell-stack">
                <span>−{money(s.outlet_commission)}</span>
                <small>{s.outlet_rate}%</small>
              </span>
            ),
          },
          {
            key: 'payable',
            header: 'Your earnings',
            align: 'right',
            sort: (s) => s.outlet_payable,
            render: (s) => <strong className="success-text">{money(s.outlet_payable)}</strong>,
          },
        ]}
      />
    </div>
  );
}

const riderDone = (o: Order) => ['delivered', 'cancelled'].includes(o.status);
/** The rider's home: what needs doing now, what they earned, and the deliveries in hand. */
export function RiderDashboard({ go }: { go: (tab: string) => void }) {
  const { notice, user } = useApp();
  const cards = useRange('7d');
  const { data, loading, error, refresh } = useData<RiderStatement>(
    '/rider/earnings' + cards.query,
    30000,
    'rider-earnings:' + cards.key,
  );
  const { data: orders } = useData<Order[]>('/orders', 15000);
  const { data: cash } = useData<CashStatement>('/rider/cash', 60000);
  const { data: state, setData: setState, refresh: reloadState } = useData<{ available: number; capacity: number }>('/rider/state');
  const [saving, setSaving] = useState(false);
  if (error && !data) return <ErrorBox error={error} retry={refresh} />;
  const busy = loading || !data;
  const mine = orders || [];
  const active = mine.filter((o) => !riderDone(o));
  const count = (test: (o: Order) => boolean) => (orders ? active.filter(test).length : undefined);
  const onDuty = state ? !!state.available : true;
  return (
    <div className="stack">
      <section className="card dash-hero">
        <div className="cell-main">
          <span className="avatar xl">{user?.name.slice(0, 1).toUpperCase()}</span>
          <span className="cell-stack">
            <strong>{user?.name}</strong>
            <small>
              {user?.login_id}
              {data && ' · ' + commissionText(data.settings)}
              {state && ` · up to ${state.capacity} orders at a time`}
            </small>
          </span>
        </div>
        <div className="outlet-hero-tools">
          <Badge tone={onDuty ? 'success' : 'danger'}>{onDuty ? 'On duty' : 'Off duty'}</Badge>
          <Toggle
            checked={onDuty}
            disabled={saving || !state}
            label="Available for deliveries"
            onChange={async (v) => {
              setSaving(true);
              setState((s) => s && { ...s, available: Number(v) });
              try {
                await api('/rider/state', { method: 'PATCH', body: JSON.stringify({ available: v }) });
                notice(v ? 'You are on duty. New deliveries can be sent to you.' : 'You are off duty. No new deliveries will be sent.');
              } catch (e) {
                notice((e as Error).message);
                reloadState();
              } finally {
                setSaving(false);
              }
            }}
          />
        </div>
      </section>
      <AttentionPanel
        groups={[
          {
            title: 'Deliveries',
            items: [
              <Queue
                key="requests"
                icon={<BellRing size={18} />}
                label="New requests"
                count={count((o) => o.flow?.rider_status === 'pending')}
                hint="Accept or decline them"
                tone="orange"
                onClick={() => go('orders')}
              />,
              <Queue
                key="pickup"
                icon={<Package size={18} />}
                label="To pick up"
                count={count((o) => o.flow?.rider_status === 'accepted' && o.status !== 'picked_up')}
                hint="Accepted, at the outlet"
                tone="purple"
                onClick={() => go('orders')}
              />,
              <Queue
                key="way"
                icon={<Truck size={18} />}
                label="On the way"
                count={count((o) => o.status === 'picked_up')}
                hint="Picked up, to be delivered"
                tone="blue"
                onClick={() => go('orders')}
              />,
              <Queue
                key="late"
                icon={<AlarmClock size={18} />}
                label="Running late"
                count={count((o) => o.status !== 'placed' && new Date(o.deliver_by).getTime() < Date.now())}
                hint="Past the promised time"
                onClick={() => go('orders')}
              />,
              <Queue
                key="cash"
                icon={<HandCoins size={18} />}
                label="Cash to hand in"
                count={cash ? (cash.in_hand > 0 ? 1 : 0) : undefined}
                hint={cash ? money(Math.max(0, cash.in_hand)) + ' collected from customers' : ''}
                tone="green"
                onClick={() => go('cash')}
              />,
            ],
          },
        ]}
      />
      <FilterBar title="Your work" hint={`Deliveries completed ${cards.label.toLowerCase()}`} range={cards.range} onRange={cards.setRange} />
      <div className="stats six">
        <Stat icon={<PackageCheck size={20} />} label="Deliveries" value={data?.deliveries_range ?? 0} hint={`${data?.deliveries ?? 0} all time`} tone="blue" loading={busy} />
        <Stat icon={<TrendingUp size={20} />} label="Earned" value={money(data?.earned_range || 0)} hint="Commission on deliveries" tone="green" loading={busy} onClick={() => go('earnings')} />
        <Stat icon={<Banknote size={20} />} label="Paid out" value={money(data?.paid_range || 0)} hint="Payouts received" tone="purple" loading={busy} onClick={() => go('earnings')} />
        <Stat
          icon={<Wallet size={20} />}
          label="Balance"
          value={money(data?.available || 0)}
          hint={data?.pending_requests ? money(data.pending_requests) + ' requested' : 'Ready to request'}
          tone="orange"
          loading={busy}
          onClick={() => go('earnings')}
        />
        <Stat icon={<CalendarDays size={20} />} label="Today" value={money(data?.today || 0)} hint="Earned since midnight" loading={busy} />
        <Stat icon={<ReceiptText size={20} />} label="This week" value={money(data?.week || 0)} hint="Earned in 7 days" loading={busy} />
      </div>
      <section className="card">
        <div className="card-head">
          <h3>
            <Bike size={17} /> Deliveries in hand
          </h3>
          <RowAction onClick={() => go('orders')}>Open deliveries</RowAction>
        </div>
        {!orders ? (
          <Skeleton count={2} className="list-skeleton" />
        ) : active.length ? (
          <div className="active-orders">
            {active.map((o) => (
              <button type="button" className="active-order" key={o.id} onClick={() => go('orders')}>
                <span className="n-icon order">{o.status === 'picked_up' ? <Navigation size={16} /> : <Store size={16} />}</span>
                <span className="cell-stack grow">
                  <strong>
                    {o.reference} · {o.outlet.name}
                  </strong>
                  <small>
                    <MapPin size={12} /> {o.address}
                  </small>
                  <small>
                    {stageLabel(o)}
                    {(o.payment_type === 'cod' || !o.payment_type) && ' · collect ' + money(o.total)}
                  </small>
                </span>
                <span className="cell-stack end">
                  <Badge value={o.status} />
                  <small>
                    <Countdown deadline={o.deliver_by} pending={o.status === 'placed'} />
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small">{onDuty ? 'Nothing in hand. New deliveries appear here as soon as they are sent to you.' : 'You are off duty. Switch on “Available for deliveries” to receive orders.'}</p>
        )}
      </section>
      <DataTable
        title={<h3>Recent earnings</h3>}
        rows={data?.earnings}
        loading={loading}
        rowKey={(e) => e.id}
        pageSize={8}
        dateFilter={{ get: (e) => e.created_at }}
        search={(e) => e.reference}
        searchPlaceholder="Search order"
        empty="Earnings appear here when you complete a delivery."
        columns={[
          {
            key: 'ref',
            header: 'Order',
            sort: (e) => e.created_at,
            render: (e) => (
              <span className="cell-stack">
                <strong>{e.reference}</strong>
                <small>Delivered {date(e.created_at)}</small>
              </span>
            ),
          },
          { key: 'total', header: 'Order total', sort: (e) => e.order_total, render: (e) => money(e.order_total) },
          {
            key: 'cash',
            header: 'Cash collected',
            render: (e) => (e.cash_collected ? money(e.cash_collected) : <span className="muted">Paid online</span>),
          },
          {
            key: 'amount',
            header: 'You earned',
            align: 'right',
            sort: (e) => e.amount,
            render: (e) => <strong className="success-text">{money(e.amount)}</strong>,
          },
        ]}
      />
    </div>
  );
}
