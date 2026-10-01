'use client';
import { useState, type FormEvent } from 'react';
import {
  BadgePercent,
  CalendarClock,
  Copy,
  Edit3,
  Eye,
  ClipboardCopy,
  MapPin,
  Plus,
  ShoppingBag,
  Sparkles,
  Tag,
  Ticket,
  Trash2,
  Truck,
  Wand2,
} from 'lucide-react';
import { api, date, label, money } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useRange } from '@/lib/range';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, ErrorBox, FilterBar, IconAction, Loading, Modal, Stat, Toggle } from './UI';
import { localDate } from './Platform';

type Coupon = {
  id: string;
  name: string;
  code: string;
  type: 'percent' | 'fixed' | 'delivery';
  value: number;
  /** The most a percentage coupon takes off, in paisa; 0 means no cap. */
  max_discount: number;
  minimum: number;
  /** Redemptions allowed in total and per customer; 0 means unlimited. */
  limit: number;
  per_customer: number;
  first_order: boolean;
  location_ids: string[];
  public: boolean;
  description: string;
  starts_at: string;
  ends_at: string;
  active: boolean;
  position: number;
  /** Figures for all time, and for the period chosen at the top of the page. */
  uses: number;
  discount: number;
  sales: number;
  customers: number;
  uses_range: number;
  discount_range: number;
  sales_range: number;
};
type Redemption = { id: string; reference: string; name: string; total: number; status: string; created_at: string; discount: number };

const figures = { uses: 0, discount: 0, sales: 0, customers: 0, uses_range: 0, discount_range: 0, sales_range: 0 };
const blank = (): Coupon => ({
  id: crypto.randomUUID(),
  name: '',
  code: '',
  type: 'percent',
  value: 10,
  max_discount: 0,
  minimum: 0,
  limit: 100,
  per_customer: 1,
  first_order: false,
  location_ids: [],
  public: false,
  description: '',
  starts_at: '',
  ends_at: '',
  active: true,
  position: 0,
  ...figures,
});
/** Coupons saved before the newer rules existed have none of them: unlimited per customer, everywhere. */
const complete = (c: Partial<Coupon>): Coupon => ({ ...blank(), per_customer: 0, ...c }) as Coupon;
/** An easy-to-read code without look-alike characters, e.g. "SAVE-7KQ4". */
const newCode = () =>
  'SAVE-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');
const offer = (c: Coupon) =>
  c.type === 'delivery'
    ? 'Free delivery'
    : c.type === 'percent'
      ? `${c.value}% off` + (c.max_discount > 0 ? `, up to ${money(c.max_discount)}` : '')
      : `${money(c.value)} off`;
const typeIcon = { percent: BadgePercent, fixed: Tag, delivery: Truck };

/** Whether customers can use a coupon right now, and if not, why. */
function status(c: Coupon): { key: string; text: string; tone: string; note?: string } {
  const now = new Date().toISOString();
  if (!c.active) return { key: 'off', text: 'Disabled', tone: 'neutral' };
  if (c.starts_at && c.starts_at > now) return { key: 'scheduled', text: 'Scheduled', tone: 'info', note: 'Starts ' + date(c.starts_at) };
  if (c.ends_at && c.ends_at <= now) return { key: 'expired', text: 'Expired', tone: 'danger', note: 'Ended ' + date(c.ends_at) };
  if (c.limit > 0 && c.uses >= c.limit) return { key: 'used', text: 'Used up', tone: 'warn', note: 'All redemptions taken' };
  return { key: 'live', text: 'Live', tone: 'success', note: c.ends_at ? 'Until ' + date(c.ends_at) : 'No expiry' };
}

export function CouponManager() {
  const { notice, locations } = useApp();
  const { range, setRange, query, key, label: rangeText } = useRange('30d');
  const { data, setData, error, loading, refresh } = useData<Partial<Coupon>[]>('/admin/coupons' + query, 60000, 'coupons:' + key);
  const [edit, setEdit] = useState<Coupon | null>(null);
  const [view, setView] = useState<Coupon | null>(null);
  const [remove, setRemove] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const list = (data || []).map(complete);
  const isNew = !!edit && !list.some((c) => c.id === edit.id);
  const set = <K extends keyof Coupon>(k: K, v: Coupon[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const start = (c: Coupon) => {
    setFormError('');
    setEdit(c);
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      const { id, uses, discount, sales, customers, uses_range, discount_range, sales_range, ...body } = edit;
      await api('/admin/records/coupons/' + id, {
        method: 'PUT',
        body: JSON.stringify({ ...body, value: body.type === 'delivery' ? 0 : body.value, max_discount: body.type === 'percent' ? body.max_discount : 0 }),
      });
      setEdit(null);
      refresh();
      notice(isNew ? 'Coupon created.' : 'Coupon saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips the switch at once and saves just that; the list reloads only if the save fails. */
  async function setActive(c: Coupon, v: boolean) {
    setData((rows) => rows && rows.map((x) => (x.id === c.id ? { ...x, active: v } : x)));
    try {
      await api('/admin/records/coupons/' + c.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
      notice(v ? 'Coupon enabled.' : 'Coupon disabled.');
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      notice(`${code} copied.`);
    } catch {
      notice('Could not copy. Select the code and copy it by hand.');
    }
  }
  const statsBusy = loading && !data;
  const count = (k: string) => list.filter((c) => status(c).key === k).length;
  const sum = (get: (c: Coupon) => number) => list.reduce((n, c) => n + get(c), 0);
  const given = sum((c) => c.discount_range);
  const sales = sum((c) => c.sales_range);
  const top = [...list].sort((a, b) => b.uses_range - a.uses_range)[0];
  const areaText = (c: Coupon) =>
    c.location_ids.length === 1
      ? locations.find((l) => l.id === c.location_ids[0])?.name || '1 area'
      : `${c.location_ids.length} areas`;
  return (
    <div className="stack">
      <FilterBar title="Coupons" hint={`Redemptions for ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Ticket size={20} />}
          label="Live coupons"
          value={count('live')}
          hint={`${list.length} in total · ${count('scheduled')} scheduled · ${count('expired') + count('used')} finished`}
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<Sparkles size={20} />}
          label="Redemptions"
          value={sum((c) => c.uses_range).toLocaleString('en-PK')}
          hint={top?.uses_range ? `Most used: ${top.code} (${top.uses_range})` : 'Orders placed with a coupon'}
          tone="blue"
          quiet={!sum((c) => c.uses_range)}
          loading={statsBusy}
        />
        <Stat
          icon={<BadgePercent size={20} />}
          label="Discount given"
          value={money(given)}
          hint={sales + given ? `${((given / (sales + given)) * 100).toFixed(1)}% of those orders` : 'Taken off customers’ orders'}
          tone="orange"
          quiet={!given}
          loading={statsBusy}
        />
        <Stat
          icon={<ShoppingBag size={20} />}
          label="Sales with coupons"
          value={money(sales)}
          hint="Total paid on orders that used a coupon"
          tone="purple"
          quiet={!sales}
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data ? list : data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(c) => c.id}
        onRowClick={(c) => start(c)}
        search={(c) => `${c.code} ${c.name} ${c.description}`}
        searchPlaceholder="Search code or campaign"
        empty="No coupons yet. Create one to reward your customers."
        toolbar={
          <button className="button" onClick={() => start(blank())}>
            <Plus size={16} /> New coupon
          </button>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'live', label: 'Live' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'expired', label: 'Expired' },
              { value: 'used', label: 'Used up' },
              { value: 'off', label: 'Disabled' },
            ],
            test: (c, v) => status(c).key === v,
          },
          {
            key: 'type',
            label: 'Types',
            options: [
              { value: 'percent', label: 'Percentage' },
              { value: 'fixed', label: 'Fixed amount' },
              { value: 'delivery', label: 'Free delivery' },
            ],
            test: (c, v) => c.type === v,
          },
          {
            key: 'show',
            label: 'Visibility',
            options: [
              { value: 'public', label: 'Shown at checkout' },
              { value: 'private', label: 'Code only' },
            ],
            test: (c, v) => (v === 'public') === !!c.public,
          },
        ]}
        columns={[
          {
            key: 'code',
            header: 'Coupon',
            sort: (c) => c.code,
            render: (c) => (
              <span className="cell-stack">
                <span>
                  <code className="code-chip">{c.code}</code> {c.public && <Badge tone="info">At checkout</Badge>}
                </span>
                <small>{c.name}</small>
              </span>
            ),
          },
          {
            key: 'offer',
            header: 'Discount',
            sort: (c) => c.value,
            render: (c) => {
              const Icon = typeIcon[c.type];
              return (
                <span className="coupon-offer">
                  <Icon size={15} /> {offer(c)}
                </span>
              );
            },
          },
          {
            key: 'rules',
            header: 'Conditions',
            render: (c) => (
              <span className="cell-stack">
                <span>{c.minimum ? 'Min. ' + money(c.minimum) : 'No minimum'}</span>
                <small>
                  {[
                    c.first_order && 'First order',
                    c.per_customer > 0 && `${c.per_customer} per customer`,
                    c.location_ids.length ? areaText(c) : 'All areas',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            ),
          },
          {
            key: 'used',
            header: 'Used',
            sort: (c) => c.uses,
            render: (c) => (
              <span className="cell-stack coupon-usage">
                <span>
                  {c.uses.toLocaleString('en-PK')}
                  {c.limit > 0 ? ' of ' + c.limit.toLocaleString('en-PK') : ''}
                </span>
                {c.limit > 0 ? (
                  <span className="meter" aria-hidden>
                    <i style={{ width: Math.min(100, (c.uses / c.limit) * 100) + '%' }} />
                  </span>
                ) : (
                  <small>Unlimited</small>
                )}
              </span>
            ),
          },
          {
            key: 'given',
            header: 'Given',
            sort: (c) => c.discount_range,
            render: (c) => (
              <span className="cell-stack">
                <span>{money(c.discount_range)}</span>
                <small>{c.uses_range} in this period</small>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (c) => {
              const s = status(c);
              return (
                <span className="cell-stack">
                  <Badge tone={s.tone}>{s.text}</Badge>
                  {s.note && <small>{s.note}</small>}
                </span>
              );
            },
          },
          {
            key: 'active',
            header: 'Enabled',
            render: (c) => <Toggle checked={!!c.active} onChange={(v) => setActive(c, v)} />,
          },
        ]}
        actions={(c) => (
          <>
            <IconAction label="Redemptions" onClick={() => setView(c)}>
              <Eye size={16} />
            </IconAction>
            <IconAction label="Copy code" onClick={() => copy(c.code)}>
              <ClipboardCopy size={16} />
            </IconAction>
            <IconAction label="Edit" onClick={() => start(c)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction
              label="Duplicate"
              onClick={() => start({ ...c, ...figures, id: crypto.randomUUID(), code: newCode(), name: c.name + ' (copy)', active: false })}
            >
              <Copy size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(c)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={isNew ? 'New coupon' : 'Edit coupon'} size="lg">
        {edit && (
          <form className="stack" onSubmit={save}>
            <div className="coupon-ticket">
              <span className="coupon-ticket-icon">
                <Ticket size={22} />
              </span>
              <div>
                <strong>{offer(edit)}</strong>
                <small>
                  {[
                    edit.minimum ? 'on orders over ' + money(edit.minimum) : 'on any order',
                    edit.first_order && 'first order only',
                    edit.ends_at && 'until ' + date(edit.ends_at),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
              <code className="code-chip">{edit.code || 'CODE'}</code>
            </div>
            <div className="form-grid">
              <label>
                Code
                <span className="input-with-button">
                  <input
                    required
                    value={edit.code}
                    maxLength={30}
                    pattern="[A-Z0-9_\-]{3,30}"
                    title="3 to 30 capital letters, digits, hyphens or underscores"
                    onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))}
                    placeholder="EID25"
                  />
                  <button type="button" className="button ghost small" onClick={() => set('code', newCode())}>
                    <Wand2 size={14} /> Generate
                  </button>
                </span>
              </label>
              <label>
                Campaign name
                <input required maxLength={200} value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Eid offer" />
              </label>

              <h4 className="span-2 form-section">Discount</h4>
              <div className="field span-2">
                <div className="segmented">
                  {(
                    [
                      ['percent', 'Percentage'],
                      ['fixed', 'Fixed amount'],
                      ['delivery', 'Free delivery'],
                    ] as const
                  ).map(([value, text]) => (
                    <button
                      type="button"
                      key={value}
                      className={edit.type === value ? 'selected' : ''}
                      onClick={() =>
                        // The number means percent or paisa depending on the type, so it starts again.
                        setEdit({ ...edit, type: value, value: value === edit.type ? edit.value : value === 'percent' ? 10 : value === 'fixed' ? 10000 : 0 })
                      }
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
              {edit.type === 'delivery' ? (
                <p className="span-2 muted" style={{ margin: 0 }}>
                  The delivery fee of the customer’s area is taken off the order.
                </p>
              ) : (
                <label>
                  {edit.type === 'percent' ? 'Percent off' : 'Amount off (PKR)'}
                  <input
                    required
                    type="number"
                    min={1}
                    max={edit.type === 'percent' ? 100 : undefined}
                    value={edit.type === 'percent' ? edit.value : edit.value / 100}
                    onChange={(e) => set('value', edit.type === 'percent' ? Number(e.target.value) : Math.round(Number(e.target.value) * 100))}
                  />
                </label>
              )}
              {edit.type === 'percent' && (
                <label>
                  Most it can take off (PKR) <span className="muted">(optional)</span>
                  <input
                    type="number"
                    min={0}
                    value={edit.max_discount ? edit.max_discount / 100 : ''}
                    onChange={(e) => set('max_discount', Math.round(Number(e.target.value) * 100) || 0)}
                    placeholder="No cap"
                  />
                </label>
              )}

              <h4 className="span-2 form-section">Conditions</h4>
              <label>
                Minimum subtotal (PKR)
                <input type="number" min={0} value={edit.minimum ? edit.minimum / 100 : ''} onChange={(e) => set('minimum', Math.round(Number(e.target.value) * 100) || 0)} placeholder="No minimum" />
              </label>
              <label>
                Total redemptions
                <input type="number" min={0} max={1000000} value={edit.limit || ''} onChange={(e) => set('limit', Number(e.target.value) || 0)} placeholder="Unlimited" />
                {!isNew && <small>{edit.uses} used so far.</small>}
              </label>
              <label>
                Uses per customer
                <input type="number" min={0} max={1000} value={edit.per_customer || ''} onChange={(e) => set('per_customer', Number(e.target.value) || 0)} placeholder="Unlimited" />
              </label>
              <div className="field end">
                <Toggle checked={edit.first_order} onChange={(v) => set('first_order', v)} label="First order only" />
              </div>
              <div className="field span-2">
                <span className="field-label">
                  Delivery areas
                  {!!edit.location_ids.length && (
                    <button type="button" className="link" onClick={() => set('location_ids', [])}>
                      Valid in every area
                    </button>
                  )}
                </span>
                <div className="choice-row">
                  {locations.map((l) => {
                    const on = edit.location_ids.includes(l.id);
                    return (
                      <button
                        type="button"
                        key={l.id}
                        className={'choice' + (on ? ' selected' : '')}
                        aria-pressed={on}
                        onClick={() => set('location_ids', on ? edit.location_ids.filter((x) => x !== l.id) : [...edit.location_ids, l.id])}
                      >
                        <MapPin size={13} /> {l.name}
                      </button>
                    );
                  })}
                </div>
                <small className="muted">
                  {edit.location_ids.length ? 'The coupon works only for deliveries to the selected areas.' : 'None selected: the coupon works in every area.'}
                </small>
              </div>

              <h4 className="span-2 form-section">Schedule</h4>
              <label>
                Starts <span className="muted">(optional)</span>
                <input
                  type="datetime-local"
                  value={edit.starts_at ? localDate(edit.starts_at) : ''}
                  onChange={(e) => set('starts_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                />
              </label>
              <label>
                Expires <span className="muted">(optional)</span>
                <input
                  type="datetime-local"
                  value={edit.ends_at ? localDate(edit.ends_at) : ''}
                  onChange={(e) => set('ends_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                />
              </label>

              <h4 className="span-2 form-section">At checkout</h4>
              <div className="field span-2">
                <Toggle
                  checked={edit.public}
                  onChange={(v) => set('public', v)}
                  label="Show this coupon at checkout as an offer customers can apply with one tap"
                />
                <small className="muted">Off: only customers who know the code can use it.</small>
              </div>
              {edit.public && (
                <label className="span-2">
                  Line shown to customers <span className="muted">(optional)</span>
                  <input maxLength={200} value={edit.description} onChange={(e) => set('description', e.target.value)} placeholder={offer(edit)} />
                </label>
              )}
            </div>
            <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Enabled" />
            {formError && <ErrorBox error={formError} />}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                {busy ? 'Saving…' : isNew ? 'Create coupon' : 'Save coupon'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.code} · redemptions` : ''} size="lg">
        {view && <Redemptions coupon={view} />}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete coupon?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/records/coupons/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Coupon deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {remove?.code} will stop working at once. Orders that already used it keep their discount. Disable it instead to
        keep its figures on this page.
      </Confirm>
    </div>
  );
}

/** What a coupon has done so far, and the latest orders it was used on. */
function Redemptions({ coupon: c }: { coupon: Coupon }) {
  const { data, error, loading, refresh } = useData<Redemption[]>('/admin/coupons/' + c.id + '/orders');
  return (
    <div className="stack">
      <div className="ad-figures">
        <span>
          <strong>
            {c.uses.toLocaleString('en-PK')}
            {c.limit > 0 ? ' / ' + c.limit.toLocaleString('en-PK') : ''}
          </strong>
          <small>Redemptions</small>
        </span>
        <span>
          <strong>{c.customers.toLocaleString('en-PK')}</strong>
          <small>Customers</small>
        </span>
        <span>
          <strong>{money(c.discount)}</strong>
          <small>Discount given</small>
        </span>
        <span>
          <strong>{money(c.sales)}</strong>
          <small>Sales</small>
        </span>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : !data?.length ? (
        <p className="muted">
          <CalendarClock size={14} /> This coupon has not been used yet.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Discount</th>
                <th>Paid</th>
                <th>Status</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <code className="code-chip">{o.reference}</code>
                  </td>
                  <td>{o.name}</td>
                  <td>{money(o.discount)}</td>
                  <td>{money(o.total)}</td>
                  <td>
                    <Badge value={o.status}>{label(o.status)}</Badge>
                  </td>
                  <td>{date(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 50 && <small className="muted">Showing the latest 50 orders.</small>}
        </div>
      )}
    </div>
  );
}
