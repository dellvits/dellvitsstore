'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import {
  Banknote,
  Building2,
  Check,
  Clock,
  CreditCard,
  Edit3,
  Image as ImageIcon,
  Mail,
  MapPin,
  Navigation,
  Plus,
  Power,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Trash2,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import {
  Badge,
  Confirm,
  DataTable,
  ErrorBox,
  FilterBar,
  IconAction,
  Loading,
  Modal,
  RowAction,
  Stat,
  Toggle,
} from './UI';
import { inRange, useRange } from '@/lib/range';
import { PaymentStatusBadge } from './Orders';
import type { PaymentMethod, User } from '@/lib/types';
import { autoLogo, banks, cardGateways, providerName, wallets, type PaymentProvider } from '@/lib/paymentProviders';
import { PaymentLogo, PaymentName } from './Checkout';
const Map = dynamic(() => import('./DeliveryMap'), { ssr: false });
type RecordData = Record<string, any>;

async function uploadImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  return (await api<{ url: string }>('/manage/images', { method: 'POST', body: form })).url;
}
function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const { notice } = useApp();
  return (
    <div className="image-upload">
      {value && (
        <div className="upload-preview">
          <img src={value} alt="" />
          <button type="button" onClick={() => onChange('')} aria-label="Remove image">
            <X size={13} />
          </button>
        </div>
      )}
      {!value && (
        <label className="upload-tile">
          <ImageIcon size={18} />
          <span>{busy ? 'Uploading…' : 'Upload'}</span>
          <input
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              try {
                onChange(await uploadImage(f));
              } catch (err) {
                notice((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
    </div>
  );
}
function localDate(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/* ---------- Categories, homepage content, coupons ---------- */
type Kind = 'categories' | 'content' | 'coupons';
const recordConfig: Record<Kind, { noun: string; defaults: RecordData }> = {
  categories: { noun: 'category', defaults: { name: '', description: '', image: '', show_on_home: true } },
  content: {
    noun: 'section',
    defaults: { name: '', type: 'section', description: '', image: '', link: '/search', button: 'Explore' },
  },
  coupons: {
    noun: 'coupon',
    defaults: { name: '', code: '', type: 'percent', value: 10, minimum: 0, limit: 100, starts_at: '', ends_at: '' },
  },
};
export function RecordManager({ kind }: { kind: string }) {
  const k = kind as Kind;
  const config = recordConfig[k];
  const { notice } = useApp();
  const { data, error, loading, refresh } = useData<RecordData[]>('/admin/records/' + kind);
  const [edit, setEdit] = useState<RecordData | null>(null);
  const [remove, setRemove] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  if (!config) return <ErrorBox error="Unknown module." />;
  async function put(r: RecordData) {
    const { id, ...body } = r;
    await api('/admin/records/' + kind + '/' + id, { method: 'PUT', body: JSON.stringify(body) });
    refresh();
  }
  async function toggle(r: RecordData, v: boolean) {
    try {
      await api('/admin/records/' + kind + '/' + r.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
      refresh();
      notice(v ? 'Enabled.' : 'Disabled.');
    } catch (e) {
      notice((e as Error).message);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await put(edit!);
      setEdit(null);
      notice('Saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const start = (r?: RecordData) => {
    setFormError('');
    setEdit(r ? { ...r } : { ...config.defaults, id: crypto.randomUUID(), active: true, position: 0 });
  };
  const set = (key: string, v: unknown) => setEdit((e) => (e ? { ...e, [key]: v } : e));
  const columns =
    k === 'categories'
      ? [
          {
            key: 'name',
            header: 'Category',
            sort: (r: RecordData) => r.name,
            render: (r: RecordData) => (
              <div className="cell-main">
                {r.image ? <img className="cell-thumb" src={r.image} alt="" /> : <span className="cell-thumb placeholder" />}
                <span className="cell-stack">
                  <strong>{r.name}</strong>
                  <small>{r.description || '—'}</small>
                </span>
              </div>
            ),
          },
          {
            key: 'home',
            header: 'On home page',
            render: (r: RecordData) => (
              <Toggle
                checked={r.show_on_home !== false}
                onChange={(v) =>
                  put({ ...r, show_on_home: v })
                    .then(() => notice(v ? 'Shown on home page.' : 'Hidden from home page.'))
                    .catch((e) => notice(e.message))
                }
              />
            ),
          },
        ]
      : k === 'content'
        ? [
            {
              key: 'name',
              header: 'Section',
              render: (r: RecordData) => (
                <div className="cell-main">
                  {r.image ? <img className="cell-thumb" src={r.image} alt="" /> : <span className="cell-thumb placeholder" />}
                  <span className="cell-stack">
                    <strong>{r.name}</strong>
                    <small className="truncate">{r.description || '—'}</small>
                  </span>
                </div>
              ),
            },
            { key: 'type', header: 'Placement', render: (r: RecordData) => <Badge tone="info">{label(r.type)}</Badge> },
            { key: 'link', header: 'Link', render: (r: RecordData) => <code>{r.link || '—'}</code> },
          ]
        : [
            {
              key: 'code',
              header: 'Coupon',
              render: (r: RecordData) => (
                <span className="cell-stack">
                  <code className="code-chip">{r.code}</code>
                  <small>{r.name}</small>
                </span>
              ),
            },
            {
              key: 'value',
              header: 'Discount',
              render: (r: RecordData) => (r.type === 'percent' ? `${r.value}%` : money(r.value)),
            },
            { key: 'min', header: 'Minimum', render: (r: RecordData) => money(r.minimum) },
            { key: 'limit', header: 'Limit', render: (r: RecordData) => r.limit },
            {
              key: 'dates',
              header: 'Valid',
              render: (r: RecordData) => (
                <small>
                  {r.starts_at ? date(r.starts_at) : 'Now'} → {r.ends_at ? date(r.ends_at) : 'No expiry'}
                </small>
              ),
            },
          ];
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(r) => r.id}
        search={(r) => `${r.name} ${r.code || ''} ${r.description || ''}`}
        searchPlaceholder={'Search ' + kind}
        toolbar={
          <button className="button" onClick={() => start()}>
            <Plus size={16} /> Add {config.noun}
          </button>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'on', label: 'Enabled' },
              { value: 'off', label: 'Disabled' },
            ],
            test: (r, v) => (v === 'on' ? !!r.active : !r.active),
          },
        ]}
        columns={[
          ...columns,
          { key: 'position', header: 'Order', sort: (r: RecordData) => r.position, render: (r: RecordData) => r.position },
          {
            key: 'active',
            header: 'Enabled',
            render: (r: RecordData) => <Toggle checked={!!r.active} onChange={(v) => toggle(r, v)} />,
          },
        ]}
        actions={(r) => (
          <>
            <IconAction label="Edit" onClick={() => start(r)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(r)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={(edit && data?.some((d) => d.id === edit.id) ? 'Edit ' : 'Add ') + config.noun}>
        {edit && (
          <form className="stack" onSubmit={save}>
            {k === 'categories' && (
              <>
                <div className="form-grid">
                  <label className="span-2">
                    Name
                    <input required value={edit.name} onChange={(e) => set('name', e.target.value)} />
                  </label>
                  <label className="span-2">
                    Short description
                    <input maxLength={500} value={edit.description} onChange={(e) => set('description', e.target.value)} />
                  </label>
                </div>
                <div className="field">
                  <span className="field-label">Image</span>
                  <ImageField value={edit.image} onChange={(v) => set('image', v)} />
                </div>
                <Toggle
                  checked={edit.show_on_home !== false}
                  onChange={(v) => set('show_on_home', v)}
                  label="Show a product section for this category on the home page"
                />
              </>
            )}
            {k === 'content' && (
              <div className="form-grid">
                <label className="span-2">
                  Headline
                  <input required value={edit.name} onChange={(e) => set('name', e.target.value)} />
                </label>
                <label>
                  Placement
                  <select value={edit.type} onChange={(e) => set('type', e.target.value)}>
                    <option value="section">Section</option>
                    <option value="banner">Banner</option>
                    <option value="hero">Hero (main headline)</option>
                  </select>
                </label>
                <label>
                  Button label
                  <input maxLength={80} value={edit.button} onChange={(e) => set('button', e.target.value)} />
                </label>
                <label className="span-2">
                  Text
                  <textarea rows={3} maxLength={2000} value={edit.description} onChange={(e) => set('description', e.target.value)} />
                </label>
                <label className="span-2">
                  Link path
                  <input value={edit.link} onChange={(e) => set('link', e.target.value)} placeholder="/search" />
                </label>
                <div className="field span-2">
                  <span className="field-label">Artwork</span>
                  <ImageField value={edit.image} onChange={(v) => set('image', v)} />
                </div>
              </div>
            )}
            {k === 'coupons' && (
              <div className="form-grid">
                <label>
                  Campaign name
                  <input required value={edit.name} onChange={(e) => set('name', e.target.value)} />
                </label>
                <label>
                  Code
                  <input required value={edit.code} onChange={(e) => set('code', e.target.value.toUpperCase())} pattern="[A-Z0-9_-]{3,30}" />
                </label>
                <label>
                  Type
                  <select value={edit.type} onChange={(e) => set('type', e.target.value)}>
                    <option value="percent">Percentage</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </label>
                <label>
                  {edit.type === 'percent' ? 'Percent off' : 'Amount off (PKR)'}
                  <input
                    required
                    type="number"
                    min={1}
                    value={edit.type === 'percent' ? edit.value : edit.value / 100}
                    onChange={(e) => set('value', edit.type === 'percent' ? Number(e.target.value) : Math.round(Number(e.target.value) * 100))}
                  />
                </label>
                <label>
                  Minimum subtotal (PKR)
                  <input
                    required
                    type="number"
                    min={0}
                    value={edit.minimum / 100}
                    onChange={(e) => set('minimum', Math.round(Number(e.target.value) * 100))}
                  />
                </label>
                <label>
                  Max redemptions
                  <input required type="number" min={1} value={edit.limit} onChange={(e) => set('limit', Number(e.target.value))} />
                </label>
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
              </div>
            )}
            <div className="form-grid">
              <label>
                Display order
                <input type="number" min={0} max={999} value={edit.position} onChange={(e) => set('position', Number(e.target.value))} />
              </label>
              <div className="field end">
                <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Enabled" />
              </div>
            </div>
            {formError && <ErrorBox error={formError} />}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title={`Delete ${config.noun}?`}
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/records/' + kind + '/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        “{remove?.name}” will be removed permanently. You can disable it instead to keep it.
      </Confirm>
    </>
  );
}

/* ---------- Store settings ---------- */
const settingsDefaults = {
  name: 'Dellvit',
  support_email: '',
  support_phone: '',
  support_address: '',
  about_title: 'Your neighbourhood, a little closer.',
  about_description: '',
  minimum_order: 0,
  checkout_enabled: true,
  show_trust: true,
  show_categories: true,
  show_nearby: true,
  show_category_products: true,
  show_outlets: true,
  show_how: true,
  show_why: true,
  show_ad: true,
};
export function SettingsManager() {
  const { notice } = useApp();
  const { data, loading, error, refresh } = useData<RecordData[]>('/admin/records/settings');
  const [form, setForm] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (data) setForm({ ...settingsDefaults, ...(data.find((d) => d.id === 'global') || {}) });
  }, [data]);
  if (loading && !form) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refresh} />;
  if (!form) return null;
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFormError('');
        try {
          const { id, ...body } = form;
          await api('/admin/records/settings/global', {
            method: 'PUT',
            body: JSON.stringify({ ...body, active: true, position: 0 }),
          });
          refresh();
          notice('Settings saved.');
        } catch (err) {
          setFormError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Store & support</h3>
          </div>
          <div className="form-grid">
            <label>
              Store name
              <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label>
              Support email
              <input required type="email" value={form.support_email} onChange={(e) => set('support_email', e.target.value)} />
            </label>
            <label>
              Support phone
              <input required value={form.support_phone} onChange={(e) => set('support_phone', e.target.value)} />
            </label>
            <label>
              Support address
              <input value={form.support_address} onChange={(e) => set('support_address', e.target.value)} />
            </label>
            <label className="span-2">
              About page headline
              <input required value={form.about_title} onChange={(e) => set('about_title', e.target.value)} />
            </label>
            <label className="span-2">
              About page text
              <textarea rows={3} value={form.about_description} onChange={(e) => set('about_description', e.target.value)} />
            </label>
          </div>
        </section>
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Checkout</h3>
            </div>
            <div className="stack">
              <Toggle checked={form.checkout_enabled} onChange={(v) => set('checkout_enabled', v)} label="Accept new orders" />
              <label>
                Minimum order subtotal (PKR)
                <input
                  type="number"
                  min={0}
                  value={form.minimum_order / 100}
                  onChange={(e) => set('minimum_order', Math.round(Number(e.target.value) * 100))}
                />
              </label>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h3>Home page sections</h3>
            </div>
            <div className="toggle-list">
              {[
                ['show_trust', 'Benefits bar'],
                ['show_nearby', 'Good things near you'],
                ['show_category_products', 'Category product sections'],
                ['show_outlets', 'Outlets near you'],
                ['show_how', 'How it works'],
                ['show_ad', 'Advertising banner'],
              ].map(([key, title]) => (
                <Toggle key={key} checked={form[key] !== false} onChange={(v) => set(key, v)} label={title} />
              ))}
            </div>
          </section>
        </div>
      </div>
      {formError && <ErrorBox error={formError} />}
      <div className="form-foot sticky-foot">
        <button className="button" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

/* ---------- Payments ---------- */
const OTHER = '__other';
/** A bank/gateway select with an "Other" choice that reveals a free-text name. */
function ProviderField({
  label,
  groups,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  groups: [string, PaymentProvider[]][];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  const known = groups.some(([, list]) => list.some((p) => p.name === value));
  const [other, setOther] = useState(!!value && !known);
  return (
    <>
      <label>
        {label} {optional && <span className="muted">(optional)</span>}
        <select
          required={!optional}
          value={other ? OTHER : value}
          onChange={(e) => {
            const v = e.target.value;
            setOther(v === OTHER);
            onChange(v === OTHER ? '' : v);
          }}
        >
          <option value="">{optional ? 'None' : 'Choose…'}</option>
          {groups.map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((p) => (
                <option key={p.slug} value={p.name}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={OTHER}>Other (upload logo)</option>
        </select>
      </label>
      {other && (
        <label>
          {label} name
          <input required maxLength={100} value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
      )}
    </>
  );
}
const typeInfo: Record<string, { title: string; icon: typeof Banknote; hint: string }> = {
  cod: { title: 'Cash on delivery', icon: Banknote, hint: 'Rider collects cash at the door' },
  bank: { title: 'Bank transfer (IBFT)', icon: Building2, hint: 'Account number / IBAN' },
  wallet: { title: 'Mobile wallet', icon: Smartphone, hint: 'JazzCash, Easypaisa, SadaPay…' },
  raast: { title: 'Raast', icon: Zap, hint: 'Instant transfer to a Raast ID' },
  card: { title: 'Card payment', icon: CreditCard, hint: 'Visa, Mastercard via a card gateway' },
};
const cardNetworks = ['Visa', 'Mastercard', 'UnionPay', 'PayPak', 'American Express'];
const accountSummary = (m: PaymentMethod) =>
  m.type === 'cod'
    ? 'Collected by rider'
    : m.type === 'wallet'
      ? `${m.provider || ''} · ${m.mobile_number || ''}`
      : m.type === 'raast'
        ? `Raast ID ${m.raast_id || ''}`
        : m.type === 'card'
          ? `${m.gateway || 'No gateway'} · ${m.environment === 'live' ? 'Live' : 'Sandbox'}`
          : `${m.bank_name || ''} · ${m.iban || m.account_number || ''}`;

type QueueRow = {
  id: string;
  reference: string;
  name: string;
  phone: string;
  total: number;
  status: string;
  created_at: string;
  outlet_name: string;
  payment_name: string;
  payment_type: string;
  payment_status: string;
  transaction_id: string;
  payer_name: string;
  payer_account: string;
  proof_url: string | null;
  payment_note: string;
  payment_updated_at: string | null;
  payment_details: Partial<PaymentMethod>;
  payment_reviewed_at: string | null;
  reviewer_name: string | null;
  reviewer_email: string | null;
  cancel_reason: string | null;
};
export function PaymentsWorkspace() {
  const [tab, setTab] = useState<'queue' | 'methods'>('queue');
  const { data: queue } = useData<QueueRow[]>('/admin/payments/queue', 15000);
  const pending = queue?.filter((q) => q.payment_status === 'submitted' && q.status !== 'cancelled').length || 0;
  return (
    <div className="stack">
      <div className="tabs">
        <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
          Verification {pending > 0 && <span className="tab-count">{pending}</span>}
        </button>
        <button className={tab === 'methods' ? 'active' : ''} onClick={() => setTab('methods')}>
          Payment methods
        </button>
      </div>
      {tab === 'queue' ? <PaymentQueue /> : <PaymentMethods />}
    </div>
  );
}
function PaymentQueue() {
  const { notice } = useApp();
  const { range, setRange, label: rangeText } = useRange('7d');
  const { data, loading, error, refresh } = useData<QueueRow[]>('/admin/payments/queue', 15000);
  const [review, setReview] = useState<QueueRow | null>(null);
  const [mode, setMode] = useState<'review' | 'reject' | 'refund'>('review');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const open = (row: QueueRow, m: 'review' | 'reject' | 'refund' = 'review') => {
    setReview(row);
    setMode(m);
    setNote('');
    setReference('');
  };
  const close = () => {
    setReview(null);
    setMode('review');
  };
  async function decide(row: QueueRow, decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await api('/admin/payments/' + row.id + '/verify', {
        method: 'PATCH',
        body: JSON.stringify({ decision, note: decision === 'reject' ? note : '' }),
      });
      notice(decision === 'approve' ? 'Payment verified. The order is ready to send.' : 'Payment rejected. Customer notified.');
      close();
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refund(row: QueueRow) {
    setBusy(true);
    try {
      await api('/admin/payments/' + row.id + '/refund', { method: 'PATCH', body: JSON.stringify({ reference, note }) });
      notice('Refund recorded. Customer notified.');
      close();
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = data || [];
  const when = (r: QueueRow) => r.payment_updated_at || r.created_at;
  const windowed = rows.filter((r) => inRange(when(r), range));
  const awaiting = (r: QueueRow) =>
    r.payment_type !== 'card' && ['submitted', 'pending'].includes(r.payment_status) && r.status !== 'cancelled';
  const canDecide = (r: QueueRow) =>
    r.payment_type !== 'card' &&
    !['paid', 'refund_due', 'refunded'].includes(r.payment_status) &&
    !['cancelled', 'delivered'].includes(r.status);
  return (
    <>
      <FilterBar title="Online payments" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats compact">
        <Stat icon={<Clock size={18} />} label="Awaiting verification" value={rows.filter(awaiting).length} hint="Live" tone="orange" />
        <Stat
          icon={<Check size={18} />}
          label="Verified value"
          value={money(windowed.filter((r) => r.payment_status === 'paid').reduce((s, r) => s + r.total, 0))}
          hint={`${windowed.filter((r) => r.payment_status === 'paid').length} payments`}
          tone="green"
        />
        <Stat icon={<X size={18} />} label="Rejected" value={windowed.filter((r) => r.payment_status === 'rejected').length} tone="red" />
        <Stat
          icon={<Undo2 size={18} />}
          label="Refunds due"
          value={rows.filter((r) => r.payment_status === 'refund_due').length}
          hint={money(rows.filter((r) => r.payment_status === 'refund_due').reduce((s, r) => s + r.total, 0))}
          tone="purple"
        />
      </div>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(r) => r.id}
        onRowClick={(r) => open(r)}
        dateFilter={{ get: when }}
        search={(r) => `${r.reference} ${r.name} ${r.transaction_id} ${r.payer_name}`}
        searchPlaceholder="Search order, TID, sender"
        empty="No online payments yet."
        filters={[
          {
            key: 'status',
            label: 'Payment statuses',
            initial: 'submitted',
            options: [
              { value: 'submitted', label: 'Awaiting verification' },
              { value: 'paid', label: 'Verified' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'refund_due', label: 'Refund due' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'failed', label: 'Failed' },
            ],
            test: (r, v) => (v === 'submitted' ? awaiting(r) : r.payment_status === v),
          },
          {
            key: 'method',
            label: 'Methods',
            options: [
              { value: 'bank', label: 'Bank transfer' },
              { value: 'wallet', label: 'Mobile wallet' },
              { value: 'raast', label: 'Raast' },
              { value: 'card', label: 'Card' },
            ],
            test: (r, v) => (r.payment_type === 'manual' ? 'bank' : r.payment_type) === v,
          },
        ]}
        columns={[
          {
            key: 'ref',
            header: 'Order',
            sort: (r) => when(r),
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.reference}</strong>
                <small>{date(when(r))}</small>
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.name}</strong>
                <small>{r.phone}</small>
              </span>
            ),
          },
          { key: 'method', header: 'Payment method', render: (r) => <PaymentName order={r} /> },
          { key: 'amount', header: 'Amount', sort: (r) => r.total, render: (r) => <strong>{money(r.total)}</strong> },
          {
            key: 'tid',
            header: 'TID / sender',
            render: (r) => (
              <span className="cell-stack">
                <code>{r.transaction_id || '—'}</code>
                <small>{r.payer_name}</small>
              </span>
            ),
          },
          {
            key: 'proof',
            header: 'Receipt',
            render: (r) =>
              r.proof_url ? (
                <a href={r.proof_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  <img className="cell-thumb" src={r.proof_url} alt="Receipt" />
                </a>
              ) : (
                <span className="muted">—</span>
              ),
          },
          { key: 'status', header: 'Payment status', render: (r) => <PaymentStatusBadge order={r} /> },
          { key: 'order', header: 'Order status', render: (r) => <Badge value={r.status} /> },
        ]}
        actions={(r) => (
          <>
            {canDecide(r) && (
              <>
                <RowAction tone="success" disabled={busy} onClick={() => decide(r, 'approve')}>
                  Approve
                </RowAction>
                <RowAction tone="danger" onClick={() => open(r, 'reject')}>
                  Reject
                </RowAction>
              </>
            )}
            {r.payment_status === 'refund_due' && (
              <RowAction tone="warn" onClick={() => open(r, 'refund')}>
                Mark refunded
              </RowAction>
            )}
            <RowAction onClick={() => open(r)}>Review</RowAction>
          </>
        )}
      />
      <Modal open={!!review} onClose={close} title={'Payment · ' + (review?.reference || '')}>
        {review && (
          <div className="stack">
            <div className="kv">
              <span>Customer</span>
              <strong>
                {review.name} · {review.phone}
              </strong>
              <span>Outlet</span>
              <strong>{review.outlet_name}</strong>
              <span>Method</span>
              <strong>
                <PaymentName order={review} />
              </strong>
              <span>Amount</span>
              <strong>{money(review.total)}</strong>
              <span>Transaction ID</span>
              <strong>
                <code>{review.transaction_id || '—'}</code>
              </strong>
              <span>Sender</span>
              <strong>
                {review.payer_name || '—'} {review.payer_account && `· ${review.payer_account}`}
              </strong>
              <span>Payment status</span>
              <strong>
                <PaymentStatusBadge order={review} />
              </strong>
              <span>Order status</span>
              <strong>
                <Badge value={review.status} />
                {review.cancel_reason && <small className="muted"> · {review.cancel_reason}</small>}
              </strong>
              {review.reviewer_name && review.payment_status !== 'submitted' && (
                <>
                  <span>Reviewed by</span>
                  <strong>
                    {review.reviewer_name} · {review.reviewer_email}
                    {review.payment_reviewed_at && <small className="muted"> · {date(review.payment_reviewed_at)}</small>}
                  </strong>
                </>
              )}
            </div>
            {review.payment_note && <div className="alert info">{review.payment_note}</div>}
            {review.proof_url ? (
              <a href={review.proof_url} target="_blank" rel="noreferrer" className="receipt">
                <img src={review.proof_url} alt="Payment receipt" />
              </a>
            ) : (
              review.payment_type !== 'card' && (
                <div className="alert info">
                  <ReceiptText size={16} /> No screenshot uploaded. Match the TID and amount in your account.
                </div>
              )
            )}
            {mode === 'refund' && review.payment_status === 'refund_due' && (
              <div className="form-grid">
                <label>
                  Refund reference <span className="muted">(optional)</span>
                  <input maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
                </label>
                <label>
                  Note <span className="muted">(optional)</span>
                  <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
            )}
            {mode === 'reject' && (
              <label>
                Reason (sent to customer)
                <textarea
                  rows={2}
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. No transfer found with this TID"
                  autoFocus
                />
              </label>
            )}
            <div className="form-foot">
              {mode === 'reject' ? (
                <>
                  <button className="button ghost" onClick={() => setMode('review')}>
                    Back
                  </button>
                  <button className="button danger" disabled={busy || !note.trim()} onClick={() => decide(review, 'reject')}>
                    Reject payment
                  </button>
                </>
              ) : mode === 'refund' ? (
                <>
                  <button className="button ghost" onClick={() => setMode('review')}>
                    Back
                  </button>
                  <button className="button" disabled={busy} onClick={() => refund(review)}>
                    <Undo2 size={16} /> Confirm refund sent
                  </button>
                </>
              ) : (
                <>
                  {review.payment_status === 'refund_due' && (
                    <button className="button ghost" onClick={() => setMode('refund')}>
                      <Undo2 size={16} /> Mark refunded
                    </button>
                  )}
                  {canDecide(review) && (
                    <>
                      <button className="button danger-ghost" onClick={() => setMode('reject')}>
                        Reject
                      </button>
                      <button className="button" disabled={busy} onClick={() => decide(review, 'approve')}>
                        <Check size={16} /> Verify payment received
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

const emptyMethod: RecordData = {
  name: '',
  type: 'bank',
  logo: '',
  instructions: '',
  bank_name: '',
  account_title: '',
  account_number: '',
  iban: '',
  branch_code: '',
  provider: 'JazzCash',
  mobile_number: '',
  raast_id: '',
  card_networks: [],
  gateway: '',
  environment: 'sandbox',
  merchant_id: '',
  public_key: '',
  secret_key: '',
  webhook_secret: '',
  api_base_url: '',
  three_d_secure: true,
  require_proof: false,
  active: true,
  position: 0,
};
function PaymentMethods() {
  const { notice } = useApp();
  const { data, loading, error, refresh } = useData<PaymentMethod[]>('/admin/records/payments');
  const [edit, setEdit] = useState<RecordData | null>(null);
  const [remove, setRemove] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const isExisting = !!edit && !!data?.some((m) => m.id === edit.id);
  const hasCard = !!data?.some((m) => m.type === 'card');
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      const { id, ...body } = edit;
      if (body.type !== 'card') body.card_networks = [];
      // Known providers use the shared logo in public/paymentmethods, so no upload is stored.
      if (autoLogo(body)) body.logo = '';
      await api('/admin/records/payments/' + id, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null);
      refresh();
      notice('Payment method saved.');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(m) => m.id}
        search={(m) => `${m.name} ${accountSummary(m)}`}
        searchPlaceholder="Search methods"
        toolbar={
          <button
            className="button"
            onClick={() => {
              setFormError('');
              setEdit({ ...emptyMethod, id: crypto.randomUUID() });
            }}
          >
            <Plus size={16} /> Add method
          </button>
        }
        filters={[
          {
            key: 'type',
            label: 'Types',
            options: Object.entries(typeInfo).map(([value, t]) => ({ value, label: t.title })),
            test: (m, v) => m.type === v || (v === 'bank' && m.type === 'manual'),
          },
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'on', label: 'Enabled' },
              { value: 'off', label: 'Disabled' },
            ],
            test: (m, v) => (v === 'on' ? !!m.active : !m.active),
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Method',
            render: (m) => {
              const t = typeInfo[m.type] || typeInfo.bank;
              return (
                <div className="cell-main">
                  <PaymentLogo method={m} className="n-icon payment" size={16} />
                  <span className="cell-stack">
                    <strong>{m.name}</strong>
                    <small>{t.title}</small>
                  </span>
                </div>
              );
            },
          },
          {
            key: 'account',
            header: 'Account',
            render: (m) => (
              <span className="cell-stack">
                <span>{accountSummary(m)}</span>
                {m.account_title && <small>{m.account_title}</small>}
              </span>
            ),
          },
          {
            key: 'proof',
            header: 'Receipt',
            render: (m) =>
              m.type === 'cod' || m.type === 'card' ? '—' : m.require_proof ? 'Required' : 'Optional',
          },
          { key: 'position', header: 'Order', sort: (m) => m.position || 0, render: (m) => m.position || 0 },
          {
            key: 'active',
            header: 'Enabled',
            render: (m) => (
              <Toggle
                checked={!!m.active}
                onChange={async (v) => {
                  try {
                    await api('/admin/records/payments/' + m.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
                    refresh();
                    notice(v ? `${m.name} enabled at checkout.` : `${m.name} hidden from checkout.`);
                  } catch (e) {
                    notice((e as Error).message);
                  }
                }}
              />
            ),
          },
        ]}
        actions={(m) => (
          <>
            <IconAction
              label="Edit"
              onClick={() => {
                setFormError('');
                setEdit({ ...emptyMethod, ...m, type: m.type === 'manual' ? 'bank' : m.type });
              }}
            >
              <Edit3 size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(m)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={isExisting ? 'Edit payment method' : 'Add payment method'} size="lg">
        {edit && (
          <form className="stack" onSubmit={save}>
            <div className={'type-grid' + (isExisting ? ' locked' : '')}>
              {Object.entries(typeInfo)
                .filter(([value]) => !isExisting || edit.type === value)
                .map(([value, t]) => (
                  <button
                    type="button"
                    key={value}
                    disabled={isExisting || (value === 'card' && hasCard)}
                    className={'type-card' + (edit.type === value ? ' selected' : '')}
                    onClick={() =>
                      setEdit({
                        ...edit,
                        type: value,
                        name:
                          edit.name ||
                          (value === 'wallet'
                            ? edit.provider
                            : value === 'cod'
                              ? 'Cash on delivery'
                              : value === 'raast'
                                ? 'Raast'
                                : value === 'card'
                                  ? 'Card payment'
                                  : ''),
                        card_networks: value === 'card' && !edit.card_networks?.length ? ['Visa', 'Mastercard'] : edit.card_networks,
                      })
                    }
                  >
                    <t.icon size={20} />
                    <strong>{t.title}</strong>
                    <small>
                      {isExisting
                        ? 'Type is fixed once a method is created'
                        : value === 'card' && hasCard
                          ? 'Already added — edit or delete the existing card method'
                          : t.hint}
                    </small>
                  </button>
                ))}
            </div>
            <div className="form-grid">
              <label>
                Name shown at checkout
                <input required value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Meezan Bank transfer" />
              </label>
              <label>
                Display order
                <input type="number" min={0} max={999} value={edit.position} onChange={(e) => set('position', Number(e.target.value))} />
              </label>
              {edit.type === 'card' && (
                <>
                  <h4 className="span-2 form-section">Gateway integration</h4>
                  <ProviderField
                    label="Payment gateway"
                    groups={[['Payment gateways', cardGateways]]}
                    value={edit.gateway}
                    onChange={(v) => set('gateway', v)}
                  />
                  <label>
                    Environment
                    <select value={edit.environment} onChange={(e) => set('environment', e.target.value)}>
                      <option value="sandbox">Sandbox (test payments)</option>
                      <option value="live">Live (real payments)</option>
                    </select>
                  </label>
                  <label>
                    Merchant ID <span className="muted">(if your gateway uses one)</span>
                    <input autoComplete="off" value={edit.merchant_id} onChange={(e) => set('merchant_id', e.target.value)} />
                  </label>
                  <label>
                    Public / publishable key
                    <input autoComplete="off" value={edit.public_key} onChange={(e) => set('public_key', e.target.value)} />
                  </label>
                  <label>
                    Secret key
                    <input
                      type="password"
                      autoComplete="new-password"
                      required={!edit.secret_key_set}
                      value={edit.secret_key}
                      onChange={(e) => set('secret_key', e.target.value)}
                      placeholder={edit.secret_key_set ? 'Saved — leave blank to keep' : ''}
                    />
                  </label>
                  <label>
                    Webhook signing secret <span className="muted">(optional)</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={edit.webhook_secret}
                      onChange={(e) => set('webhook_secret', e.target.value)}
                      placeholder={edit.webhook_secret_set ? 'Saved — leave blank to keep' : ''}
                    />
                  </label>
                  {!cardGateways.some((g) => g.name === edit.gateway) && edit.gateway && (
                    <label className="span-2">
                      API base URL
                      <input
                        type="url"
                        pattern="https://.*"
                        value={edit.api_base_url}
                        onChange={(e) => set('api_base_url', e.target.value)}
                        placeholder="https://api.yourgateway.com"
                      />
                    </label>
                  )}
                  <div className="field span-2">
                    <span className="field-label">Webhook URL (paste into your gateway dashboard)</span>
                    <code className="webhook-url">{`${typeof window === 'undefined' ? '' : window.location.origin}/api/payments/card/webhook`}</code>
                  </div>
                  <div className="span-2">
                    <Toggle
                      checked={!!edit.three_d_secure}
                      onChange={(v) => set('three_d_secure', v)}
                      label="Require 3-D Secure (bank OTP) for every card payment"
                    />
                  </div>
                  {isExisting && !edit.gateway_connected && (
                    <div className="alert warn span-2">
                      <ShieldCheck size={16} /> Settings are saved, but the {edit.gateway || 'selected'} gateway is not connected in
                      the code yet, so checkout will refuse card payments. Keep this method disabled until it is connected.
                    </div>
                  )}
                  <div className="field span-2">
                    <span className="field-label">Accepted cards</span>
                    <div className="toggle-list">
                      {cardNetworks.map((n) => (
                        <Toggle
                          key={n}
                          label={n}
                          checked={(edit.card_networks || []).includes(n)}
                          onChange={(v) =>
                            set(
                              'card_networks',
                              v
                                ? cardNetworks.filter((x) => x === n || (edit.card_networks || []).includes(x))
                                : (edit.card_networks || []).filter((x: string) => x !== n),
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
              {edit.type === 'bank' && (
                <>
                  <ProviderField label="Bank" groups={[['Banks', banks]]} value={edit.bank_name} onChange={(v) => set('bank_name', v)} />
                  <label>
                    Account title
                    <input required value={edit.account_title} onChange={(e) => set('account_title', e.target.value)} />
                  </label>
                  <label>
                    Account number
                    <input
                      inputMode="numeric"
                      value={edit.account_number}
                      onChange={(e) => set('account_number', e.target.value)}
                      placeholder="6–24 digits"
                    />
                  </label>
                  <label>
                    IBAN
                    <input
                      value={edit.iban}
                      onChange={(e) => set('iban', e.target.value.toUpperCase())}
                      placeholder="PK36SCBL0000001123456702"
                      maxLength={34}
                    />
                  </label>
                  <label>
                    Branch code <span className="muted">(optional)</span>
                    <input value={edit.branch_code} onChange={(e) => set('branch_code', e.target.value)} />
                  </label>
                </>
              )}
              {edit.type === 'wallet' && (
                <>
                  <label>
                    Wallet provider
                    <select value={edit.provider} onChange={(e) => set('provider', e.target.value)}>
                      {wallets.map((p) => (
                        <option key={p.slug}>{p.name}</option>
                      ))}
                      <option value="Other">Other (upload logo)</option>
                    </select>
                  </label>
                  <label>
                    Account title
                    <input required value={edit.account_title} onChange={(e) => set('account_title', e.target.value)} />
                  </label>
                  <label>
                    Wallet mobile number
                    <input required value={edit.mobile_number} onChange={(e) => set('mobile_number', e.target.value)} placeholder="03XXXXXXXXX" />
                  </label>
                </>
              )}
              {edit.type === 'raast' && (
                <>
                  <label>
                    Account title
                    <input required value={edit.account_title} onChange={(e) => set('account_title', e.target.value)} />
                  </label>
                  <label>
                    Raast ID or IBAN
                    <input required value={edit.raast_id} onChange={(e) => set('raast_id', e.target.value)} placeholder="03XXXXXXXXX" />
                  </label>
                  <ProviderField
                    label="Bank or wallet"
                    optional
                    groups={[
                      ['Banks', banks],
                      ['Mobile wallets', wallets],
                    ]}
                    value={edit.bank_name}
                    onChange={(v) => set('bank_name', v)}
                  />
                </>
              )}
              {autoLogo(edit) ? (
                <div className="field span-2">
                  <span className="field-label">Logo</span>
                  <div className="logo-auto">
                    <PaymentLogo method={edit} className="n-icon payment" size={16} />
                    <small className="muted">
                      Set automatically from{' '}
                      {(!['raast', 'card'].includes(edit.type) && providerName(edit)) || typeInfo[edit.type]?.title}
                    </small>
                  </div>
                </div>
              ) : (
                providerName(edit) && (
                  <div className="field span-2">
                    <span className="field-label">Logo or icon</span>
                    <ImageField value={edit.logo || ''} onChange={(v) => set('logo', v)} />
                  </div>
                )
              )}
              <label className="span-2">
                Instructions for customers <span className="muted">(optional)</span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={edit.instructions}
                  onChange={(e) => set('instructions', e.target.value)}
                  placeholder={edit.type === 'cod' ? 'Please keep exact change ready.' : 'Transfer the exact total and enter the TID.'}
                />
              </label>
            </div>
            <div className="toggle-list">
              {edit.type !== 'cod' && edit.type !== 'card' && (
                <Toggle checked={!!edit.require_proof} onChange={(v) => set('require_proof', v)} label="Require a receipt screenshot" />
              )}
              <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Enabled at checkout" />
            </div>
            {edit.type === 'card' && (
              <div className="alert info">
                <ShieldCheck size={16} /> Customers enter their card at checkout and the card details go straight to the gateway.
                Paid orders need no manual verification. Secret keys are stored on the server and never shown again.
              </div>
            )}
            {edit.type !== 'cod' && edit.type !== 'card' && (
              <div className="alert info">
                <ShieldCheck size={16} /> Customers enter the transaction ID after paying. Orders wait for your verification in the
                Verification tab. Never enter passwords, PINs or API secrets here.
              </div>
            )}
            {formError && <ErrorBox error={formError} />}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                {busy ? 'Saving…' : 'Save method'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete payment method?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/records/payments/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Payment method deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        “{remove?.name}” will be removed. Existing orders keep their payment details. To hide it temporarily, disable it instead.
      </Confirm>
    </>
  );
}

/* ---------- Admin access ---------- */
export function StaffManager() {
  const { data, error, loading, refresh } = useData<{ permissions: string[]; users: User[] }>('/admin/staff');
  const { notice } = useApp();
  const [edit, setEdit] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api('/admin/staff/' + edit!.id, {
        method: 'PUT',
        body: JSON.stringify({ ...edit, password: edit!.password || undefined }),
      });
      setEdit(null);
      refresh();
      notice('Administrator saved.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DataTable
        rows={data?.users}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(u) => u.id}
        search={(u) => u.name + ' ' + u.email}
        searchPlaceholder="Search administrators"
        toolbar={
          <button
            className="button"
            onClick={() => {
              setMessage('');
              setEdit({ id: crypto.randomUUID(), name: '', email: '', password: '', permissions: [], active: true, isNew: true });
            }}
          >
            <Plus size={16} /> Add administrator
          </button>
        }
        columns={[
          {
            key: 'name',
            header: 'Administrator',
            render: (u) => (
              <div className="cell-main">
                <span className="avatar sm">{u.name.slice(0, 1)}</span>
                <span className="cell-stack">
                  <strong>{u.name}</strong>
                  <small>{u.email}</small>
                </span>
              </div>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            render: (u) => <Badge tone={u.is_super_admin ? 'purple' : 'info'}>{u.is_super_admin ? 'Super admin' : 'Admin'}</Badge>,
          },
          {
            key: 'modules',
            header: 'Modules',
            render: (u) =>
              u.is_super_admin ? (
                'All modules'
              ) : (
                <span className="chip-list">
                  {(u.permissions || []).slice(0, 4).map((p) => (
                    <span className="chip small" key={p}>
                      {label(p)}
                    </span>
                  ))}
                  {(u.permissions?.length || 0) > 4 && <span className="chip small">+{(u.permissions?.length || 0) - 4}</span>}
                </span>
              ),
          },
          { key: 'status', header: 'Status', render: (u) => <Badge value={u.active ? 'active' : 'disabled'} /> },
        ]}
        actions={(u) =>
          !u.is_super_admin && (
            <IconAction
              label="Edit access"
              onClick={() => {
                setMessage('');
                setEdit({ ...u, active: !!u.active, password: '' });
              }}
            >
              <Edit3 size={16} />
            </IconAction>
          )
        }
      />
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title="Administrator access" size="lg">
        {edit && (
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <label>
                Name
                <input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </label>
              <label>
                Email
                <input required type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </label>
              <label className="span-2">
                {edit.isNew ? 'Password (12+ characters)' : 'New password (optional)'}
                <input
                  type="password"
                  required={!!edit.isNew}
                  minLength={12}
                  autoComplete="new-password"
                  value={edit.password}
                  onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                />
              </label>
            </div>
            <fieldset className="fieldset">
              <legend>
                Modules
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setEdit({ ...edit, permissions: edit.permissions.length === data?.permissions.length ? [] : data?.permissions })
                  }
                >
                  {edit.permissions.length === data?.permissions.length ? 'Clear all' : 'Select all'}
                </button>
              </legend>
              <div className="permission-grid">
                {data?.permissions.map((p) => (
                  <label className="check" key={p}>
                    <input
                      type="checkbox"
                      checked={edit.permissions.includes(p)}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          permissions: e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x: string) => x !== p),
                        })
                      }
                    />
                    {label(p)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Account enabled" />
            <small className="muted">Saving signs this administrator out of existing sessions.</small>
            {message && <ErrorBox error={message} />}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                Save access
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/* ---------- Fleet ---------- */
export function FleetManager() {
  const { data, error, loading, refresh } = useData<RecordData[]>('/admin/tracking', 15000);
  const { notice, locations } = useApp();
  const [map, setMap] = useState<RecordData | null>(null);
  async function update(r: RecordData, patch: { available?: boolean; capacity?: number }) {
    try {
      await api('/admin/rider-controls/' + r.id, {
        method: 'PUT',
        body: JSON.stringify({ available: r.available !== 0, capacity: r.capacity ?? 5, ...patch }),
      });
      refresh();
      notice('Dispatch settings saved.');
    } catch (e) {
      notice((e as Error).message);
    }
  }
  return (
    <>
      <DataTable
        title={<h3>Fleet & live positions</h3>}
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(r) => r.id}
        pageSize={5}
        search={(r) => r.name}
        searchPlaceholder="Search fleet"
        filters={[
          {
            key: 'availability',
            label: 'Availability',
            options: [
              { value: 'on', label: 'On duty' },
              { value: 'off', label: 'Off duty' },
            ],
            test: (r, v) => (v === 'on' ? r.available !== 0 : r.available === 0),
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Rider',
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.name}</strong>
                <small>{locations.find((l) => l.id === r.location_id)?.name}</small>
              </span>
            ),
          },
          {
            key: 'available',
            header: 'On duty',
            render: (r) => <Toggle checked={r.available !== 0} onChange={(v) => update(r, { available: v })} />,
          },
          {
            key: 'load',
            header: 'Load',
            sort: (r) => r.load,
            render: (r) => (
              <span className="load">
                <strong>{r.load}</strong> /
                <select
                  aria-label="Capacity"
                  value={r.capacity ?? 5}
                  onChange={(e) => update(r, { capacity: Number(e.target.value) })}
                >
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </span>
            ),
          },
          {
            key: 'position',
            header: 'Last position',
            render: (r) =>
              r.lat != null ? (
                <span className="cell-stack">
                  <span>{date(r.updated_at)}</span>
                  <small>±{Math.round(r.accuracy)} m</small>
                </span>
              ) : (
                <span className="muted">Not shared</span>
              ),
          },
        ]}
        actions={(r) =>
          r.lat != null && (
            <IconAction label="Show on map" onClick={() => setMap(r)}>
              <MapPin size={16} />
            </IconAction>
          )
        }
      />
      <Modal open={!!map} onClose={() => setMap(null)} title={map ? map.name + ' · last position' : ''}>
        {map && <Map lat={map.lat} lng={map.lng} />}
      </Modal>
    </>
  );
}

export const commissionText = (s: { commission_type: string; commission_value: number; commission_base: string }) =>
  s.commission_type === 'fixed'
    ? `${money(s.commission_value)} per delivery`
    : `${s.commission_value}% of ${s.commission_base === 'delivery_fee' ? 'delivery fee' : s.commission_base === 'subtotal' ? 'subtotal' : 'order total'}`;

/* ---------- Rider shift tools ---------- */
export function RiderTools() {
  const { data, refresh } = useData<RecordData>('/rider/state');
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState('');
  const last = useRef(0);
  useEffect(() => {
    if (!sharing) return;
    if (!navigator.geolocation) {
      setMessage('Location is unavailable in this browser.');
      setSharing(false);
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - last.current < 10000) return;
        last.current = Date.now();
        api('/rider/location', {
          method: 'POST',
          body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        })
          .then(() => setMessage('Shared at ' + new Date().toLocaleTimeString()))
          .catch((e) => {
            setMessage(e.message);
            setSharing(false);
          });
      },
      (e) => {
        setMessage(e.message);
        setSharing(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [sharing]);
  const onDuty = data?.available !== 0;
  return (
    <section className="shift-bar card">
      <div className="shift-state">
        <span className={'pulse' + (onDuty ? ' on' : '')} />
        <span>
          <strong>{onDuty ? 'On duty' : 'Off duty'}</strong>
          <small>{message || (sharing ? 'Sharing live location' : 'Location sharing is off')}</small>
        </span>
      </div>
      <div className="shift-actions">
        <button
          className={'button small ' + (onDuty ? 'ghost' : '')}
          onClick={async () => {
            try {
              await api('/rider/state', { method: 'PATCH', body: JSON.stringify({ available: !onDuty }) });
              if (onDuty) setSharing(false);
              refresh();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <Power size={15} /> {onDuty ? 'Go off duty' : 'Go on duty'}
        </button>
        <button
          className={'button small ' + (sharing ? 'danger-ghost' : 'ghost')}
          disabled={!onDuty}
          onClick={() => {
            last.current = 0;
            setSharing(!sharing);
            setMessage(sharing ? 'Location sharing stopped.' : 'Waiting for permission…');
          }}
        >
          <Navigation size={15} /> {sharing ? 'Stop sharing' : 'Share location'}
        </button>
      </div>
    </section>
  );
}

/* ---------- Customers & audit ---------- */
export function CustomerDirectory() {
  const { data, error, loading, refresh } = useData<RecordData[]>('/admin/customers');
  const { notice } = useApp();
  return (
    <DataTable
      rows={data}
      loading={loading}
      error={error}
      onRetry={refresh}
      rowKey={(c) => c.id}
      search={(c) => `${c.name} ${c.email} ${c.phone}`}
      searchPlaceholder="Search name, email or phone"
      empty="No customer accounts yet."
      filters={[
        {
          key: 'status',
          label: 'Statuses',
          options: [
            { value: 'active', label: 'Active' },
            { value: 'disabled', label: 'Disabled' },
          ],
          test: (c, v) => (v === 'active' ? !!c.active : !c.active),
        },
        {
          key: 'orders',
          label: 'Order history',
          options: [
            { value: 'none', label: 'No orders' },
            { value: 'some', label: 'Has ordered' },
          ],
          test: (c, v) => (v === 'none' ? c.orders === 0 : c.orders > 0),
        },
      ]}
      columns={[
        {
          key: 'name',
          header: 'Customer',
          sort: (c) => c.name.toLowerCase(),
          render: (c) => (
            <div className="cell-main">
              <span className="avatar sm">{c.name.slice(0, 1)}</span>
              <span className="cell-stack">
                <strong>{c.name}</strong>
                <small>{c.email}</small>
              </span>
            </div>
          ),
        },
        { key: 'phone', header: 'Phone', render: (c) => <a href={'tel:' + c.phone}>{c.phone}</a> },
        { key: 'orders', header: 'Orders', sort: (c) => c.orders, render: (c) => c.orders },
        { key: 'spent', header: 'Delivered spend', sort: (c) => c.spent, render: (c) => money(c.spent) },
        { key: 'joined', header: 'Joined', sort: (c) => c.created_at, render: (c) => date(c.created_at) },
        {
          key: 'active',
          header: 'Access',
          render: (c) => (
            <Toggle
              checked={!!c.active}
              onChange={async (v) => {
                try {
                  await api('/admin/customers/' + c.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
                  refresh();
                  notice(v ? 'Account enabled.' : 'Account disabled and signed out.');
                } catch (e) {
                  notice((e as Error).message);
                }
              }}
            />
          ),
        },
      ]}
      actions={(c) => (
        <IconAction label="Email customer" href={'mailto:' + c.email}>
          <Mail size={16} />
        </IconAction>
      )}
    />
  );
}
export function AuditLog() {
  const { data, error, loading } = useData<RecordData[]>('/admin/audit', 20000);
  return (
    <DataTable
      rows={data}
      loading={loading}
      error={error}
      rowKey={(r) => r.id}
      pageSize={20}
      search={(r) => `${r.name} ${r.target}`}
      searchPlaceholder="Search administrator or resource"
      empty="No activity yet."
      filters={[
        {
          key: 'method',
          label: 'Actions',
          options: ['POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m })),
          test: (r, v) => r.action === v,
        },
      ]}
      columns={[
        { key: 'who', header: 'Administrator', render: (r) => <strong>{r.name || '—'}</strong> },
        {
          key: 'action',
          header: 'Action',
          render: (r) => (
            <Badge tone={r.action === 'DELETE' ? 'danger' : r.action === 'POST' ? 'success' : 'info'}>{r.action}</Badge>
          ),
        },
        { key: 'target', header: 'Resource', render: (r) => <code>{r.target}</code> },
        { key: 'time', header: 'Time', sort: (r) => r.created_at, render: (r) => date(r.created_at) },
      ]}
    />
  );
}
