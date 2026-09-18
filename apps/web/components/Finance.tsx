'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Banknote,
  CircleDollarSign,
  Clock,
  CreditCard,
  HandCoins,
  Landmark,
  Plus,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useRange } from '@/lib/range';
import type { CashDeposit, CashStatement, Payout, PayoutRequest, RiderStatement } from '@/lib/types';
import { Badge, Confirm, DataTable, ErrorBox, FilterBar, Loading, Modal, RowAction, Stat } from './UI';
import { commissionText } from './Platform';

export const depositMethods: Record<string, string> = {
  cash_handover: 'Cash handover',
  bank: 'Bank transfer',
  wallet: 'Mobile wallet',
  raast: 'Raast',
};
export const payoutMethods: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank transfer',
  wallet: 'Mobile wallet',
  raast: 'Raast',
};
const payoutTypes: Record<string, string> = { manual: 'Direct payout', request: 'Rider request' };
const toPaisa = (v: string) => Math.round(Number(v) * 100);

/** Note prompt used for rejections. */
function NoteModal({
  open,
  title,
  message,
  confirm,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirm: string;
  onSubmit: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(''), [open]);
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} size="sm">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(note.trim());
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">{message}</p>
        <label>
          Reason
          <textarea required minLength={3} maxLength={300} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="form-foot">
          <button type="button" className="button ghost" onClick={onClose}>
            Back
          </button>
          <button className="button danger" disabled={busy}>
            {busy ? 'Working…' : confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function reviewCell(r: { status: string; reviewer_name: string | null; reviewed_at: string | null; review_note: string }) {
  if (r.status === 'pending') return <span className="muted">Awaiting review</span>;
  if (r.status === 'cancelled') return <span className="muted">Withdrawn</span>;
  return (
    <span className="cell-stack">
      <span>{r.reviewer_name || '—'}</span>
      <small>
        {r.reviewed_at ? date(r.reviewed_at) : ''}
        {r.review_note ? ' · ' + r.review_note : ''}
      </small>
    </span>
  );
}

/* ================= Rider: cash on delivery ================= */
export function RiderCash() {
  const { notice } = useApp();
  const { range, setRange, query, label: rangeText } = useRange('7d');
  const { data, loading, error, refresh } = useData<CashStatement>('/rider/cash' + query, 30000);
  const [form, setForm] = useState<{ amount: string; method: string; reference: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState<CashDeposit | null>(null);
  if (error) return <ErrorBox error={error} retry={refresh} />;
  if (!data) return <Loading />;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await api('/rider/cash/deposits', {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: toPaisa(form.amount) }),
      });
      notice('Submitted. Dellvit will verify the amount.');
      setForm(null);
      refresh();
    } catch (err) {
      notice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <FilterBar title="Cash on delivery" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange}>
        <button
          className="button small"
          disabled={data.in_hand <= 0}
          onClick={() => setForm({ amount: String(data.in_hand / 100), method: 'cash_handover', reference: '', note: '' })}
        >
          <HandCoins size={15} /> Submit cash to Dellvit
        </button>
      </FilterBar>
      <div className="stats">
        <Stat icon={<HandCoins size={20} />} label="COD collected" value={money(data.collected_range)} hint="From customers in this period" tone="blue" />
        <Stat icon={<Wallet size={20} />} label="Cash in hand" value={money(data.in_hand)} hint="Not yet submitted" tone="orange" />
        <Stat icon={<Clock size={20} />} label="Awaiting verification" value={money(data.pending)} tone="purple" />
        <Stat icon={<ShieldCheck size={20} />} label="Submitted to Dellvit" value={money(data.submitted_range)} hint="Verified in this period" tone="green" />
      </div>
      <DataTable
        title={<h3>Submissions</h3>}
        rows={data.deposits}
        loading={loading}
        rowKey={(d) => d.id}
        dateFilter={{ get: (d) => d.created_at }}
        empty="You haven’t submitted any cash yet."
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: ['pending', 'approved', 'rejected', 'cancelled'].map((s) => ({ value: s, label: label(s) })),
            test: (d, v) => d.status === v,
          },
        ]}
        columns={[
          { key: 'date', header: 'Submitted', sort: (d) => d.created_at, render: (d) => date(d.created_at) },
          { key: 'amount', header: 'Amount', sort: (d) => d.amount, render: (d) => <strong>{money(d.amount)}</strong> },
          { key: 'method', header: 'Method', render: (d) => depositMethods[d.method] || label(d.method) },
          { key: 'ref', header: 'Reference', render: (d) => (d.reference ? <code>{d.reference}</code> : <span className="muted">—</span>) },
          { key: 'status', header: 'Status', render: (d) => <Badge value={d.status}>{d.status === 'approved' ? 'Verified' : label(d.status)}</Badge> },
          { key: 'review', header: 'Reviewed', render: reviewCell },
        ]}
        actions={(d) =>
          d.status === 'pending' ? (
            <RowAction tone="danger" onClick={() => setWithdraw(d)}>
              Withdraw
            </RowAction>
          ) : null
        }
      />
      <DataTable
        title={<h3>Cash collections</h3>}
        rows={data.collections}
        rowKey={(c) => c.order_id}
        dateFilter={{ get: (c) => c.created_at }}
        search={(c) => `${c.reference} ${c.customer}`}
        searchPlaceholder="Search order"
        pageSize={5}
        empty="Cash-on-delivery orders you complete appear here."
        columns={[
          { key: 'ref', header: 'Order', sort: (c) => c.created_at, render: (c) => <strong>{c.reference}</strong> },
          { key: 'customer', header: 'Customer', render: (c) => c.customer },
          { key: 'date', header: 'Delivered', render: (c) => date(c.created_at) },
          { key: 'amount', header: 'Collected', align: 'right', render: (c) => <strong>{money(c.amount)}</strong> },
        ]}
      />
      <Modal open={!!form} onClose={() => !busy && setForm(null)} title="Submit cash to Dellvit" size="sm">
        {form && (
          <form className="stack" onSubmit={submit}>
            <div className="alert info">
              <Wallet size={16} /> You are holding {money(data.in_hand)}.
            </div>
            <div className="form-grid">
              <label>
                Amount (PKR)
                <input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  max={data.in_hand / 100}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </label>
              <label>
                Method
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {Object.entries(depositMethods).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                {form.method === 'cash_handover' ? 'Receipt number' : 'Transaction ID'}{' '}
                {form.method === 'cash_handover' && <span className="muted">(optional)</span>}
                <input
                  required={form.method !== 'cash_handover'}
                  minLength={form.method !== 'cash_handover' ? 4 : undefined}
                  maxLength={80}
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                />
              </label>
              <label className="span-2">
                Note <span className="muted">(optional)</span>
                <input maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Handed to the office manager" />
              </label>
            </div>
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                {busy ? 'Submitting…' : 'Submit for verification'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!withdraw}
        title="Withdraw this submission?"
        confirm="Withdraw"
        danger
        onClose={() => setWithdraw(null)}
        onConfirm={async () => {
          try {
            await api('/rider/cash/deposits/' + withdraw!.id, { method: 'DELETE' });
            setWithdraw(null);
            refresh();
            notice('Submission withdrawn.');
          } catch (e) {
            notice((e as Error).message);
          }
        }}
      >
        {withdraw && money(withdraw.amount)} returns to your cash in hand.
      </Confirm>
    </div>
  );
}

/* ================= Admin: COD cash verification ================= */
type CashRider = { id: string; name: string; login_id: string; phone: string; collected: number; approved: number; pending: number; in_hand: number };
export function AdminCash() {
  const { notice } = useApp();
  const { range, setRange, query, label: rangeText } = useRange('7d');
  const { data, loading, error, refresh } = useData<{
    riders: CashRider[];
    totals: { in_hand: number; pending: number; collected_range: number; approved_range: number };
    deposits: CashDeposit[];
  }>('/admin/cash' + query, 20000);
  const [reject, setReject] = useState<CashDeposit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rider, setRider] = useState<CashRider | null>(null);
  async function decide(d: CashDeposit, decision: 'approve' | 'reject', note = '') {
    setBusy(d.id);
    try {
      await api('/admin/cash/deposits/' + d.id, { method: 'PATCH', body: JSON.stringify({ decision, note }) });
      notice(decision === 'approve' ? 'Cash verified. The rider has been notified.' : 'Submission rejected.');
      setReject(null);
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const t = data?.totals;
  return (
    <div className="stack">
      <FilterBar title="Rider cash on delivery" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat icon={<Wallet size={20} />} label="Cash with riders" value={money(t?.in_hand || 0)} hint="Collected, not yet submitted" tone="orange" />
        <Stat
          icon={<Clock size={20} />}
          label="Awaiting verification"
          value={money(t?.pending || 0)}
          hint={`${data?.deposits.filter((d) => d.status === 'pending').length || 0} submissions`}
          tone="purple"
        />
        <Stat icon={<HandCoins size={20} />} label="COD collected" value={money(t?.collected_range || 0)} hint="In this period" tone="blue" />
        <Stat icon={<ShieldCheck size={20} />} label="Verified submissions" value={money(t?.approved_range || 0)} hint="In this period" tone="green" />
      </div>
      <DataTable
        title={<h3>Submissions</h3>}
        rows={data?.deposits}
        loading={loading}
        rowKey={(d) => d.id}
        dateFilter={{ get: (d) => d.created_at }}
        search={(d) => `${d.rider_name} ${d.login_id} ${d.reference}`}
        searchPlaceholder="Search rider or reference"
        empty="No cash submissions yet."
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: ['pending', 'approved', 'rejected', 'cancelled'].map((s) => ({ value: s, label: s === 'approved' ? 'Verified' : label(s) })),
            test: (d, v) => d.status === v,
          },
          {
            key: 'method',
            label: 'Methods',
            options: Object.entries(depositMethods).map(([value, text]) => ({ value, label: text })),
            test: (d, v) => d.method === v,
          },
        ]}
        columns={[
          {
            key: 'rider',
            header: 'Rider',
            render: (d) => (
              <span className="cell-stack">
                <strong>{d.rider_name}</strong>
                <small>{d.login_id}</small>
              </span>
            ),
          },
          { key: 'amount', header: 'Amount', sort: (d) => d.amount, render: (d) => <strong>{money(d.amount)}</strong> },
          {
            key: 'method',
            header: 'Method',
            render: (d) => (
              <span className="cell-stack">
                <span>{depositMethods[d.method] || label(d.method)}</span>
                {d.reference && <code>{d.reference}</code>}
              </span>
            ),
          },
          { key: 'date', header: 'Submitted', sort: (d) => d.created_at, render: (d) => date(d.created_at) },
          { key: 'note', header: 'Note', render: (d) => (d.note ? <small className="truncate">{d.note}</small> : <span className="muted">—</span>) },
          { key: 'status', header: 'Status', render: (d) => <Badge value={d.status}>{d.status === 'approved' ? 'Verified' : label(d.status)}</Badge> },
          { key: 'review', header: 'Reviewed by', render: reviewCell },
        ]}
        actions={(d) =>
          d.status === 'pending' ? (
            <>
              <RowAction tone="success" disabled={busy === d.id} onClick={() => decide(d, 'approve')}>
                Verify received
              </RowAction>
              <RowAction tone="danger" onClick={() => setReject(d)}>
                Reject
              </RowAction>
            </>
          ) : null
        }
      />
      <DataTable
        title={<h3>Cash position by rider</h3>}
        rows={data?.riders}
        loading={loading}
        rowKey={(r) => r.id}
        pageSize={5}
        search={(r) => `${r.name} ${r.login_id}`}
        searchPlaceholder="Search rider"
        columns={[
          {
            key: 'rider',
            header: 'Rider',
            sort: (r) => r.name,
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.name}</strong>
                <small>{r.login_id}</small>
              </span>
            ),
          },
          { key: 'collected', header: 'Collected (all time)', sort: (r) => r.collected, render: (r) => money(r.collected) },
          { key: 'approved', header: 'Verified', render: (r) => money(r.approved) },
          { key: 'pending', header: 'Pending', render: (r) => (r.pending ? money(r.pending) : '—') },
          {
            key: 'in_hand',
            header: 'In hand',
            align: 'right',
            sort: (r) => r.in_hand,
            render: (r) => <strong className={r.in_hand > 0 ? 'warn-text' : ''}>{money(r.in_hand)}</strong>,
          },
        ]}
        actions={(r) => <RowAction onClick={() => setRider(r)}>Transactions</RowAction>}
      />
      <NoteModal
        open={!!reject}
        title="Reject cash submission"
        message={reject ? `${reject.rider_name} · ${money(reject.amount)}. The amount returns to the rider’s cash in hand.` : ''}
        confirm="Reject"
        onClose={() => setReject(null)}
        onSubmit={(note) => decide(reject!, 'reject', note)}
      />
      {rider && <RiderCashModal rider={rider} onClose={() => setRider(null)} />}
    </div>
  );
}
function RiderCashModal({ rider, onClose }: { rider: CashRider; onClose: () => void }) {
  const { data, error } = useData<CashStatement>('/admin/cash/riders/' + rider.id);
  return (
    <Modal open onClose={onClose} title={rider.name + ' · cash transactions'} size="lg">
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className="stack">
          <div className="stats compact">
            <Stat icon={<HandCoins size={18} />} label="Collected" value={money(data.collected)} tone="blue" />
            <Stat icon={<ShieldCheck size={18} />} label="Verified" value={money(data.approved)} tone="green" />
            <Stat icon={<Wallet size={18} />} label="In hand" value={money(data.in_hand)} tone="orange" />
          </div>
          <DataTable
            title={<h3>Submissions</h3>}
            rows={data.deposits}
            rowKey={(d) => d.id}
            pageSize={5}
            dateFilter={{ get: (d) => d.created_at, initial: '30d' }}
            empty="No submissions."
            columns={[
              { key: 'date', header: 'Date', render: (d) => date(d.created_at) },
              { key: 'amount', header: 'Amount', render: (d) => money(d.amount) },
              { key: 'method', header: 'Method', render: (d) => depositMethods[d.method] || d.method },
              { key: 'status', header: 'Status', render: (d) => <Badge value={d.status} /> },
              { key: 'review', header: 'Reviewed', render: reviewCell },
            ]}
          />
          <DataTable
            title={<h3>Collections</h3>}
            rows={data.collections}
            rowKey={(c) => c.order_id}
            pageSize={5}
            dateFilter={{ get: (c) => c.created_at, initial: '30d' }}
            empty="No cash collected."
            columns={[
              { key: 'ref', header: 'Order', render: (c) => <strong>{c.reference}</strong> },
              { key: 'date', header: 'Delivered', render: (c) => date(c.created_at) },
              { key: 'amount', header: 'Amount', align: 'right', render: (c) => money(c.amount) },
            ]}
          />
        </div>
      )}
    </Modal>
  );
}

/* ================= Earnings & payouts (shared tables) ================= */
function PayoutTable({ rows, admin, loading }: { rows?: Payout[]; admin?: boolean; loading?: boolean }) {
  return (
    <DataTable
      title={<h3>Payouts</h3>}
      rows={rows}
      loading={loading}
      rowKey={(p) => p.id}
      pageSize={admin ? 10 : 5}
      dateFilter={{ get: (p) => p.created_at }}
      search={(p) => `${p.rider_name || ''} ${p.reference} ${p.note}`}
      searchPlaceholder="Search payouts"
      empty="No payouts recorded yet."
      filters={[
        {
          key: 'type',
          label: 'Payout types',
          options: Object.entries(payoutTypes).map(([value, text]) => ({ value, label: text })),
          test: (p, v) => p.type === v,
        },
        {
          key: 'method',
          label: 'Methods',
          options: Object.entries(payoutMethods).map(([value, text]) => ({ value, label: text })),
          test: (p, v) => p.method === v,
        },
      ]}
      columns={[
        { key: 'date', header: 'Date', sort: (p) => p.created_at, render: (p) => date(p.created_at) },
        ...(admin
          ? [
              {
                key: 'rider',
                header: 'Rider',
                render: (p: Payout) => (
                  <span className="cell-stack">
                    <strong>{p.rider_name}</strong>
                    <small>{p.login_id}</small>
                  </span>
                ),
              },
            ]
          : []),
        { key: 'amount', header: 'Amount', sort: (p) => p.amount, render: (p) => <strong>{money(p.amount)}</strong> },
        { key: 'type', header: 'Payout type', render: (p) => payoutTypes[p.type] || label(p.type) },
        {
          key: 'method',
          header: 'Payment method',
          render: (p) => (
            <span className="cell-stack">
              <span>{payoutMethods[p.method] || label(p.method)}</span>
              {p.reference && <code>{p.reference}</code>}
            </span>
          ),
        },
        { key: 'status', header: 'Payment status', render: (p) => <Badge value={p.status} /> },
        {
          key: 'issued',
          header: 'Issued by',
          render: (p) => (
            <span className="cell-stack">
              <span>{p.issued_by || '—'}</span>
              {p.note && <small className="truncate">{p.note}</small>}
            </span>
          ),
        },
      ]}
    />
  );
}
function EarningsTable({ s, admin }: { s: RiderStatement; admin?: boolean }) {
  return (
    <DataTable
      title={<h3>Earnings</h3>}
      rows={s.earnings}
      rowKey={(e) => e.id}
      pageSize={admin ? 5 : 10}
      dateFilter={{ get: (e) => e.created_at }}
      search={(e) => e.reference}
      searchPlaceholder="Search order"
      empty="Complete a delivery to start earning."
      columns={[
        {
          key: 'order',
          header: 'Order',
          sort: (e) => e.created_at,
          render: (e) => (
            <span className="cell-stack">
              <strong>{e.reference}</strong>
              <small>{date(e.created_at)}</small>
            </span>
          ),
        },
        { key: 'total', header: 'Order total', render: (e) => money(e.order_total) },
        {
          key: 'rule',
          header: 'Rule',
          render: (e) => <small>{e.commission_type === 'fixed' ? 'Fixed' : `${e.commission_value}% of ${money(e.base_amount)}`}</small>,
        },
        { key: 'cash', header: 'Cash collected', render: (e) => (e.cash_collected ? money(e.cash_collected) : '—') },
        {
          key: 'amount',
          header: 'Earned',
          sort: (e) => e.amount,
          align: 'right',
          render: (e) => <strong className="success-text">+{money(e.amount)}</strong>,
        },
      ]}
    />
  );
}
function RequestTable({
  rows,
  admin,
  loading,
  actions,
}: {
  rows?: PayoutRequest[];
  admin?: boolean;
  loading?: boolean;
  actions: (r: PayoutRequest) => ReactNode;
}) {
  return (
    <DataTable
      title={<h3>Payout requests</h3>}
      rows={rows}
      loading={loading}
      rowKey={(r) => r.id}
      pageSize={admin ? 10 : 5}
      dateFilter={{ get: (r) => r.created_at }}
      search={(r) => `${r.rider_name || ''} ${r.account}`}
      searchPlaceholder="Search requests"
      empty="No payout requests."
      filters={[
        {
          key: 'status',
          label: 'Statuses',
          options: ['pending', 'approved', 'rejected', 'cancelled'].map((s) => ({ value: s, label: label(s) })),
          test: (r, v) => r.status === v,
        },
      ]}
      columns={[
        { key: 'date', header: 'Requested', sort: (r) => r.created_at, render: (r) => date(r.created_at) },
        ...(admin
          ? [
              {
                key: 'rider',
                header: 'Rider',
                render: (r: PayoutRequest) => (
                  <span className="cell-stack">
                    <strong>{r.rider_name}</strong>
                    <small>Balance {money(r.balance || 0)}</small>
                  </span>
                ),
              },
            ]
          : []),
        { key: 'amount', header: 'Amount', sort: (r) => r.amount, render: (r) => <strong>{money(r.amount)}</strong> },
        {
          key: 'method',
          header: 'Receive by',
          render: (r) => (
            <span className="cell-stack">
              <span>{payoutMethods[r.method] || label(r.method)}</span>
              {r.account && <small>{r.account}</small>}
            </span>
          ),
        },
        { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
        { key: 'review', header: 'Reviewed', render: reviewCell },
      ]}
      actions={actions}
    />
  );
}

/* ================= Rider: earnings ================= */
export function RiderEarnings() {
  const { notice } = useApp();
  const { range, setRange, query, label: rangeText } = useRange('7d');
  const { data, loading, error, refresh } = useData<RiderStatement>('/rider/earnings' + query, 30000);
  const [form, setForm] = useState<{ amount: string; method: string; account: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState<PayoutRequest | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refresh} />;
  if (!data) return null;
  return (
    <div className="stack">
      <FilterBar title="Earnings" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange}>
        <button
          className="button small"
          disabled={data.available <= 0}
          onClick={() => setForm({ amount: String(data.available / 100), method: 'wallet', account: '', note: '' })}
        >
          <Banknote size={15} /> Request payout
        </button>
      </FilterBar>
      <div className="stats">
        <Stat
          icon={<Wallet size={20} />}
          label="Current balance"
          value={money(data.balance)}
          hint={data.pending_requests ? `${money(data.pending_requests)} requested · ${money(data.available)} available` : 'Available to request'}
          tone="green"
        />
        <Stat
          icon={<TrendingUp size={20} />}
          label="Earnings"
          value={money(data.earned_range)}
          hint={`${data.deliveries_range} deliveries in this period`}
          tone="blue"
        />
        <Stat icon={<CircleDollarSign size={20} />} label="Payouts" value={money(data.paid_range)} hint="Received in this period" tone="purple" />
        <Stat icon={<CreditCard size={20} />} label="Commission" value={commissionText(data.settings)} hint="Set by your administrator" tone="orange" />
      </div>
      <RequestTable
        rows={data.requests}
        actions={(r) =>
          r.status === 'pending' ? (
            <RowAction tone="danger" onClick={() => setWithdraw(r)}>
              Withdraw
            </RowAction>
          ) : null
        }
      />
      <PayoutTable rows={data.payouts} />
      <EarningsTable s={data} />
      <Modal open={!!form} onClose={() => !busy && setForm(null)} title="Request a payout" size="sm">
        {form && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api('/rider/payout-requests', {
                  method: 'POST',
                  body: JSON.stringify({ ...form, amount: toPaisa(form.amount) }),
                });
                notice('Payout requested. You will be notified when it is reviewed.');
                setForm(null);
                refresh();
              } catch (err) {
                notice((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="alert info">
              <Wallet size={16} /> Available to request: <strong>{money(data.available)}</strong>
            </div>
            <div className="form-grid">
              <label>
                Amount (PKR)
                <input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  max={data.available / 100}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </label>
              <label>
                Receive by
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {Object.entries(payoutMethods).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {form.method !== 'cash' && (
                <label className="span-2">
                  {form.method === 'wallet' ? 'Wallet name & number' : form.method === 'raast' ? 'Raast ID' : 'Bank & account / IBAN'}
                  <input
                    required
                    minLength={4}
                    maxLength={120}
                    value={form.account}
                    onChange={(e) => setForm({ ...form, account: e.target.value })}
                    placeholder={form.method === 'wallet' ? 'Easypaisa · 03001234567' : ''}
                  />
                </label>
              )}
              <label className="span-2">
                Note <span className="muted">(optional)</span>
                <input maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
            </div>
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                {busy ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!withdraw}
        title="Withdraw payout request?"
        confirm="Withdraw"
        danger
        onClose={() => setWithdraw(null)}
        onConfirm={async () => {
          try {
            await api('/rider/payout-requests/' + withdraw!.id, { method: 'DELETE' });
            setWithdraw(null);
            refresh();
            notice('Request withdrawn.');
          } catch (e) {
            notice((e as Error).message);
          }
        }}
      >
        {withdraw && money(withdraw.amount)} will be available to request again.
      </Confirm>
    </div>
  );
}

/* ================= Admin: payouts ================= */
type PayoutRider = { id: string; name: string; login_id: string; earned: number; paid: number; balance: number; pending: number; available: number };
type PayForm = { rider_id: string; amount: string; method: string; reference: string; note: string; request?: PayoutRequest };
export function AdminPayouts() {
  const { notice } = useApp();
  const { range, setRange, query, label: rangeText } = useRange('7d');
  const { data, loading, error, refresh } = useData<{
    riders: PayoutRider[];
    totals: { balance: number; pending: number; paid_range: number; earned_range: number };
    requests: PayoutRequest[];
    payouts: Payout[];
  }>('/admin/payouts' + query, 20000);
  const [pay, setPay] = useState<PayForm | null>(null);
  const [reject, setReject] = useState<PayoutRequest | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const pendingCount = data?.requests.filter((r) => r.status === 'pending').length || 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pay) return;
    setBusy(true);
    try {
      if (pay.request)
        await api('/admin/payouts/requests/' + pay.request.id, {
          method: 'POST',
          body: JSON.stringify({ decision: 'approve', method: pay.method, reference: pay.reference, note: pay.note }),
        });
      else
        await api('/admin/riders/' + pay.rider_id + '/payouts', {
          method: 'POST',
          body: JSON.stringify({ amount: toPaisa(pay.amount), method: pay.method, reference: pay.reference, note: pay.note }),
        });
      notice(pay.request ? 'Request approved and paid. Rider notified.' : 'Payout recorded. Rider notified.');
      setPay(null);
      refresh();
    } catch (err) {
      notice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = data?.riders.find((r) => r.id === pay?.rider_id);
  return (
    <div className="stack">
      <FilterBar title="Rider payouts" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange}>
        <button
          className="button small"
          disabled={!data?.riders.length}
          onClick={() => setPay({ rider_id: data?.riders.find((r) => r.balance > 0)?.id || data?.riders[0]?.id || '', amount: '', method: 'cash', reference: '', note: '' })}
        >
          <Plus size={15} /> Record payout
        </button>
      </FilterBar>
      <div className="stats">
        <Stat
          icon={<Clock size={20} />}
          label="Pending requests"
          value={pendingCount}
          hint={money(data?.totals.pending || 0) + ' requested'}
          tone="orange"
        />
        <Stat icon={<Wallet size={20} />} label="Owed to riders" value={money(data?.totals.balance || 0)} hint="Current unpaid balances" tone="purple" />
        <Stat icon={<Landmark size={20} />} label="Paid out" value={money(data?.totals.paid_range || 0)} hint="In this period" tone="green" />
        <Stat icon={<TrendingUp size={20} />} label="Rider earnings" value={money(data?.totals.earned_range || 0)} hint="Commissions in this period" tone="blue" />
      </div>
      <RequestTable
        admin
        rows={data?.requests}
        loading={loading}
        actions={(r) =>
          r.status === 'pending' ? (
            <>
              <RowAction
                tone="success"
                onClick={() => setPay({ rider_id: r.rider_id, amount: String(r.amount / 100), method: r.method, reference: '', note: '', request: r })}
              >
                Approve & pay
              </RowAction>
              <RowAction tone="danger" onClick={() => setReject(r)}>
                Reject
              </RowAction>
            </>
          ) : null
        }
      />
      <PayoutTable admin rows={data?.payouts} loading={loading} />
      <DataTable
        title={<h3>Rider balances</h3>}
        rows={data?.riders}
        loading={loading}
        rowKey={(r) => r.id}
        pageSize={5}
        search={(r) => `${r.name} ${r.login_id}`}
        searchPlaceholder="Search rider"
        columns={[
          {
            key: 'rider',
            header: 'Rider',
            sort: (r) => r.name,
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.name}</strong>
                <small>{r.login_id}</small>
              </span>
            ),
          },
          { key: 'earned', header: 'Earned (all time)', sort: (r) => r.earned, render: (r) => money(r.earned) },
          { key: 'paid', header: 'Paid out', render: (r) => money(r.paid) },
          { key: 'pending', header: 'Requested', render: (r) => (r.pending ? money(r.pending) : '—') },
          { key: 'balance', header: 'Balance', align: 'right', sort: (r) => r.balance, render: (r) => <strong>{money(r.balance)}</strong> },
        ]}
        actions={(r) => (
          <RowAction
            disabled={r.balance <= 0}
            onClick={() => setPay({ rider_id: r.id, amount: String(r.balance / 100), method: 'cash', reference: '', note: '' })}
          >
            Pay
          </RowAction>
        )}
      />
      <Modal open={!!pay} onClose={() => !busy && setPay(null)} title={pay?.request ? 'Approve payout request' : 'Record payout'} size="sm">
        {pay && (
          <form className="stack" onSubmit={submit}>
            {pay.request && (
              <div className="kv">
                <span>Rider</span>
                <strong>{pay.request.rider_name}</strong>
                <span>Requested</span>
                <strong>{money(pay.request.amount)}</strong>
                <span>Receive by</span>
                <strong>
                  {payoutMethods[pay.request.method]} {pay.request.account && '· ' + pay.request.account}
                </strong>
                {pay.request.note && (
                  <>
                    <span>Note</span>
                    <strong>{pay.request.note}</strong>
                  </>
                )}
              </div>
            )}
            <div className="form-grid">
              {!pay.request && (
                <>
                  <label className="span-2">
                    Rider
                    <select value={pay.rider_id} onChange={(e) => setPay({ ...pay, rider_id: e.target.value })}>
                      {data?.riders.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · balance {money(r.balance)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Amount (PKR)
                    <input
                      required
                      type="number"
                      min="1"
                      step="0.01"
                      max={(selected?.balance || 0) / 100}
                      value={pay.amount}
                      onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                    />
                  </label>
                </>
              )}
              <label className={pay.request ? 'span-2' : ''}>
                Paid by
                <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {Object.entries(payoutMethods).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Transaction reference <span className="muted">(optional)</span>
                <input maxLength={80} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              </label>
              <label className="span-2">
                Note <span className="muted">(optional)</span>
                <input maxLength={300} value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="e.g. Weekly settlement" />
              </label>
            </div>
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setPay(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                {busy ? 'Saving…' : pay.request ? 'Approve & mark paid' : 'Record payout'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <NoteModal
        open={!!reject}
        title="Reject payout request"
        message={reject ? `${reject.rider_name} requested ${money(reject.amount)}.` : ''}
        confirm="Reject request"
        onClose={() => setReject(null)}
        onSubmit={async (note) => {
          try {
            await api('/admin/payouts/requests/' + reject!.id, { method: 'POST', body: JSON.stringify({ decision: 'reject', note }) });
            notice('Request rejected. Rider notified.');
            setReject(null);
            refresh();
          } catch (e) {
            notice((e as Error).message);
          }
        }}
      />
    </div>
  );
}

/* ================= Admin: one rider's statement ================= */
export function RiderStatementModal({ rider, onClose }: { rider: { id: string; name: string }; onClose: () => void }) {
  const { data, loading, error } = useData<RiderStatement>('/admin/riders/' + rider.id + '/earnings');
  return (
    <Modal open onClose={onClose} title={rider.name + ' · earnings & payouts'} size="lg">
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        data && (
          <div className="stack">
            <div className="stats compact">
              <Stat icon={<Wallet size={18} />} label="Balance" value={money(data.balance)} hint={`${money(data.pending_requests)} requested`} tone="green" />
              <Stat icon={<TrendingUp size={18} />} label="Earned" value={money(data.earned)} hint={`${data.deliveries} deliveries`} tone="blue" />
              <Stat icon={<Landmark size={18} />} label="Paid out" value={money(data.paid)} tone="purple" />
            </div>
            <div className="alert info">
              <CreditCard size={16} /> Commission: <strong>{commissionText(data.settings)}</strong>. Record payouts from the Rider payouts page.
            </div>
            <PayoutTable rows={data.payouts} />
            <EarningsTable s={data} admin />
          </div>
        )
      )}
    </Modal>
  );
}
