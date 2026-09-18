'use client';
import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  Banknote,
  BellRing,
  Bike,
  ClipboardList,
  CreditCard,
  HandCoins,
  Package,
  PackageCheck,
  ReceiptText,
  Send,
  Store,
  Ticket,
  TrendingUp,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useRange } from '@/lib/range';
import type { AdminSummary, Order, OutletSummary } from '@/lib/types';
import { Badge, DataTable, ErrorBox, FilterBar, RangeFilter, RowAction, Stat, Toggle } from './UI';
import { orderStatuses, PaymentStatusBadge } from './Orders';

function StatusBars({ statuses, total }: { statuses: Record<string, number>; total?: number }) {
  const counts = orderStatuses.map((s) => [s, statuses[s] || 0] as const);
  const max = Math.max(1, ...counts.map((c) => c[1]));
  const sum = total ?? counts.reduce((s, c) => s + c[1], 0);
  return (
    <div className="bars">
      {counts.map(([s, n]) => (
        <div className="bar-row" key={s}>
          <span>{label(s)}</span>
          <div className="bar">
            <i className={'tone-' + s} style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <strong>{n}</strong>
        </div>
      ))}
      <small className="muted bars-foot">
        {sum} order{sum === 1 ? '' : 's'} in this period
      </small>
    </div>
  );
}
function Attention({
  icon,
  count,
  children,
  onClick,
  tone = 'orange',
}: {
  icon: ReactNode;
  count: number;
  children: ReactNode;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button className={'attention ' + tone + (count ? '' : ' clear')} onClick={onClick}>
      <span className="attention-icon">{icon}</span>
      <span>
        <strong>{count}</strong>
        <small>{children}</small>
      </span>
    </button>
  );
}

/* ---------- Super admin dashboard ---------- */
export function AdminOverview({ go }: { go: (tab: string) => void }) {
  const { user } = useApp();
  const can = (p: string) => !!(user?.is_super_admin || user?.permissions?.includes(p));
  const cards = useRange('today');
  const status = useRange('24h');
  const { data, error, refresh } = useData<AdminSummary>('/admin/summary' + cards.query, 30000);
  const { data: statusData } = useData<AdminSummary>('/admin/summary' + status.query, 30000);
  const { data: orders, loading } = useData<Order[]>(can('orders') ? '/orders' : null, 20000);
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const att = data?.attention;
  const pct = (n = 0) => (data?.sales ? Math.round((n / data.sales) * 100) + '% of sales' : '—');
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
          value={data?.orders ?? '—'}
          hint={`${data?.delivered ?? 0} delivered · ${data?.cancelled ?? 0} cancelled`}
          tone="blue"
        />
        <Stat
          icon={<TrendingUp size={20} />}
          label="Total sales"
          value={money(data?.sales || 0)}
          hint={`${money(data?.delivery_fees || 0)} delivery fees`}
          tone="green"
        />
        <Stat
          icon={<Store size={20} />}
          label="Outlet deductions"
          value={money(data?.outlet_deducted || 0)}
          hint={`Paid to outlets · ${pct(data?.outlet_deducted)}`}
          tone="orange"
        />
        <Stat
          icon={<Bike size={20} />}
          label="Rider commissions"
          value={money(data?.rider_commission || 0)}
          hint={pct(data?.rider_commission)}
          tone="purple"
        />
        <Stat
          icon={<Ticket size={20} />}
          label="Coupon deductions"
          value={money(data?.coupon_deductions || 0)}
          hint="Discounts given"
        />
        <Stat
          icon={<Wallet size={20} />}
          label="Store sales (net)"
          value={money(data?.store_sales || 0)}
          hint={`${money(data?.outlet_commission || 0)} outlet commission earned`}
          tone={data && data.store_sales < 0 ? 'red' : 'green'}
        />
      </div>
      {att && (
        <section className="card">
          <div className="card-head">
            <h3>
              <BellRing size={17} /> Needs attention
            </h3>
            <small className="muted">Live · all time</small>
          </div>
          <div className="attention-grid">
            {can('orders') && (
              <>
                <Attention icon={<Send size={18} />} count={att.dispatch} onClick={() => go('orders')}>
                  Orders to assign & send
                </Attention>
                <Attention icon={<AlertTriangle size={18} />} count={att.cancel_requests} onClick={() => go('orders')} tone="red">
                  Outlet cancellation requests
                </Attention>
              </>
            )}
            {can('payments') && (
              <>
                <Attention icon={<CreditCard size={18} />} count={att.payments} onClick={() => go('payments')} tone="purple">
                  Payments to verify
                </Attention>
                <Attention icon={<Undo2 size={18} />} count={att.refunds} onClick={() => go('payments')} tone="blue">
                  Refunds due
                </Attention>
              </>
            )}
            {can('riders') && (
              <>
                <Attention icon={<Banknote size={18} />} count={att.payout_requests} onClick={() => go('payouts')} tone="green">
                  Rider payout requests
                </Attention>
                <Attention icon={<HandCoins size={18} />} count={att.cod_deposits} onClick={() => go('cash')} tone="green">
                  COD cash submissions
                </Attention>
              </>
            )}
          </div>
        </section>
      )}
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
          <StatusBars statuses={statusData?.statuses || {}} total={statusData?.orders} />
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
  const { data, error, refresh } = useData<OutletSummary>('/manage/outlet/summary' + cards.query, 20000);
  const { data: settlements, loading } = useData<Settlement[]>('/manage/outlet/settlements', 60000);
  const [saving, setSaving] = useState(false);
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const o = data?.outlet;
  return (
    <div className="stack">
      <section className="card outlet-hero">
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
      <div className="attention-grid">
        <Attention icon={<BellRing size={18} />} count={data?.awaiting_response || 0} onClick={() => go('orders')}>
          New order requests to answer
        </Attention>
        <Attention icon={<Package size={18} />} count={data?.in_kitchen || 0} onClick={() => go('orders')} tone="purple">
          Orders to prepare
        </Attention>
        <Attention icon={<PackageCheck size={18} />} count={data?.awaiting_pickup || 0} onClick={() => go('orders')} tone="green">
          Ready, waiting for rider
        </Attention>
      </div>
      <FilterBar title="Performance" hint={`Orders placed ${cards.label.toLowerCase()}`} range={cards.range} onRange={cards.setRange} />
      <div className="stats six">
        <Stat icon={<ClipboardList size={20} />} label="Orders" value={data?.orders ?? '—'} hint={`${data?.statuses.cancelled || 0} cancelled`} tone="blue" />
        <Stat icon={<PackageCheck size={20} />} label="Delivered" value={data?.delivered ?? '—'} tone="green" />
        <Stat icon={<TrendingUp size={20} />} label="Item sales" value={money(data?.sales || 0)} tone="green" />
        <Stat
          icon={<BadgePercent size={20} />}
          label="Dellvit commission"
          value={money(data?.commission || 0)}
          hint={`${o?.commission_rate ?? 0}% of item sales`}
          tone="orange"
        />
        <Stat icon={<Wallet size={20} />} label="Your earnings" value={money(data?.payable || 0)} hint="After commission" tone="purple" />
        <Stat icon={<ReceiptText size={20} />} label="Average order" value={money(data?.average_order || 0)} />
      </div>
      <div className="grid-3">
        <section className="card">
          <div className="card-head">
            <h3>Orders by status</h3>
          </div>
          <StatusBars statuses={data?.statuses || {}} total={data?.orders} />
        </section>
        <section className="card">
          <div className="card-head">
            <h3>Top products</h3>
          </div>
          {data?.top_products.length ? (
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
          {data?.low_stock.length ? (
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
