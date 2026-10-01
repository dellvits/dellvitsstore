'use client';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  Clock,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  Hash,
  History,
  House,
  Image as ImageIcon,
  Landmark,
  ListChecks,
  LogOut,
  Mail,
  MailWarning,
  MapPin,
  Navigation,
  PackageX,
  Phone,
  Plus,
  Power,
  ReceiptText,
  Send,
  ShieldCheck,
  Smartphone,
  ShoppingBag,
  Store,
  Tags,
  Trash2,
  StickyNote,
  Undo2,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import {
  Badge,
  Confirm,
  CopyButton,
  DataTable,
  ErrorBox,
  FilterBar,
  IconAction,
  Loading,
  MetaItem,
  Modal,
  PanelSection,
  RowAction,
  Stat,
  Toggle,
} from './UI';
import { inRange, useRange } from '@/lib/range';
import { useSettling } from '@/lib/useSettling';
import { PaymentStatusBadge } from './Orders';
import type { PaymentMethod, User } from '@/lib/types';
import { autoLogo, banks, providerName, wallets, type PaymentProvider } from '@/lib/paymentProviders';
import { PaymentLogo, PaymentName } from './Checkout';
type RecordData = Record<string, any>;

async function uploadImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  return (await api<{ url: string }>('/manage/images', { method: 'POST', body: form })).url;
}
export function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
export function localDate(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/* ---------- Categories ---------- */
type Kind = 'categories';
const recordConfig: Record<Kind, { noun: string; defaults: RecordData }> = {
  categories: {
    noun: 'category',
    defaults: {
      name: '',
      description: '',
      image: '',
      show_on_home: true,
      home_limit: 8,
      show_in_filters: true,
      commission_rate: null,
    },
  },
};
export function RecordManager({ kind }: { kind: string }) {
  const k = kind as Kind;
  const config = recordConfig[k];
  const { notice } = useApp();
  const { data, setData, error, loading, refresh } = useData<RecordData[]>('/admin/records/' + kind);
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
  /** Flips a switch at once and saves just that field; the list reloads only if the save fails. */
  async function quick(r: RecordData, change: RecordData, done: string) {
    setData((rows) => rows && rows.map((x) => (x.id === r.id ? { ...x, ...change } : x)));
    try {
      await api('/admin/records/' + kind + '/' + r.id, { method: 'PATCH', body: JSON.stringify(change) });
      notice(done);
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  const toggle = (r: RecordData, v: boolean) => quick(r, { active: v }, v ? 'Enabled.' : 'Disabled.');
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
  const list = data || [];
  const statsBusy = loading && !data;
  const inUse = (r: RecordData) => r.products > 0 || r.outlets > 0;
  const onHome = (r: RecordData) => !!r.active && r.show_on_home !== false;
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
            key: 'products',
            header: 'Products',
            sort: (r: RecordData) => r.products || 0,
            render: (r: RecordData) => (r.products ? r.products : <span className="muted">None</span>),
          },
          {
            key: 'outlets',
            header: 'Outlets',
            sort: (r: RecordData) => r.outlets || 0,
            render: (r: RecordData) => (
              <span className="cell-stack">
                <span>{r.outlets ? r.outlets : <span className="muted">None</span>}</span>
                {r.commission_rate != null && <small>{r.commission_rate}% default commission</small>}
              </span>
            ),
          },
          {
            key: 'home',
            header: 'On home page',
            render: (r: RecordData) => (
              <span className="cell-stack">
                <Toggle
                  checked={r.show_on_home !== false}
                  onChange={(v) => quick(r, { show_on_home: v }, v ? 'Shown on home page.' : 'Hidden from home page.')}
                />
                {r.show_on_home !== false && <small>Up to {r.home_limit || 8} products</small>}
              </span>
            ),
          },
          {
            key: 'filters',
            header: 'In filters',
            render: (r: RecordData) => (
              <Toggle
                checked={r.show_in_filters !== false}
                onChange={(v) =>
                  quick(r, { show_in_filters: v }, v ? 'Shown in storefront filters.' : 'Hidden from storefront filters.')
                }
              />
            ),
          },
        ]
      : [];
  return (
    <div className="stack">
      {k === 'categories' && (
        <div className="stats">
          <Stat
            icon={<Tags size={20} />}
            label="Categories"
            value={list.length}
            hint={`${list.filter((r) => r.active).length} enabled`}
            tone="blue"
            loading={statsBusy}
          />
          <Stat
            icon={<House size={20} />}
            label="On home page"
            value={list.filter(onHome).length}
            hint="Enabled categories with a product section"
            tone="green"
            loading={statsBusy}
          />
          <Stat
            icon={<ShoppingBag size={20} />}
            label="Products"
            value={list.reduce((n, r) => n + (r.products || 0), 0)}
            hint={`${list.reduce((n, r) => n + (r.outlets || 0), 0)} outlets across all categories`}
            tone="purple"
            loading={statsBusy}
          />
          <Stat
            icon={<PackageX size={20} />}
            label="Not in use"
            value={list.filter((r) => !inUse(r)).length}
            hint="No products or outlets yet"
            tone="orange"
            loading={statsBusy}
          />
        </div>
      )}
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
          ...(k === 'categories'
            ? [
                {
                  key: 'home',
                  label: 'Home page',
                  options: [
                    { value: 'shown', label: 'On home page' },
                    { value: 'hidden', label: 'Not on home page' },
                  ],
                  test: (r: RecordData, v: string) => (v === 'shown') === (r.show_on_home !== false),
                },
                {
                  key: 'usage',
                  label: 'Usage',
                  options: [
                    { value: 'used', label: 'In use' },
                    { value: 'unused', label: 'Not in use' },
                  ],
                  test: (r: RecordData, v: string) => (v === 'used') === inUse(r),
                },
              ]
            : []),
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
                <h4 className="form-section">Storefront</h4>
                <div className="toggle-list">
                  <Toggle
                    checked={edit.show_on_home !== false}
                    onChange={(v) => set('show_on_home', v)}
                    label="Show a product section for this category on the home page"
                  />
                  <Toggle
                    checked={edit.show_in_filters !== false}
                    onChange={(v) => set('show_in_filters', v)}
                    label="Offer this category as a filter on the search and outlets pages"
                  />
                </div>
                <div className="form-grid">
                  <label>
                    Products in the home page section
                    <input
                      type="number"
                      required
                      min={1}
                      max={24}
                      disabled={edit.show_on_home === false}
                      value={edit.home_limit ?? 8}
                      onChange={(e) => set('home_limit', Number(e.target.value))}
                    />
                    <small>In-stock products come first. 1 to 24.</small>
                  </label>
                  <label>
                    Commission for new outlets (%) <span className="muted">(optional)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      placeholder="Platform default (10%)"
                      value={edit.commission_rate ?? ''}
                      onChange={(e) => set('commission_rate', e.target.value === '' ? null : Number(e.target.value))}
                    />
                    <small>The starting rate when an outlet is added to this category. Existing outlets keep theirs.</small>
                  </label>
                </div>
                {data?.some((d) => d.id === edit.id && d.name !== edit.name && inUse(d)) && (
                  <div className="alert info">
                    <Tags size={16} /> Renaming moves this category’s products and outlets to the new name.
                  </div>
                )}
              </>
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
        {remove && k === 'categories' && inUse(remove)
          ? `“${remove.name}” is still used by ${remove.products} product${remove.products === 1 ? '' : 's'} and ${remove.outlets} outlet${remove.outlets === 1 ? '' : 's'}, so it cannot be deleted. Move them to another category first, or disable it instead.`
          : `“${remove?.name}” will be removed permanently. You can disable it instead to keep it.`}
      </Confirm>
    </div>
  );
}

type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  has_password: boolean;
  source: 'saved' | 'environment' | 'none';
};
/** The mail server that sends verification codes, with a button to prove it works. */
export function EmailSettings() {
  const { notice, user } = useApp();
  const { data, loading, error, refresh } = useData<EmailConfig>('/admin/email-settings');
  const [form, setForm] = useState<(EmailConfig & { pass: string }) | null>(null);
  const [to, setTo] = useState(user?.email || '');
  const [busy, setBusy] = useState('');
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (data) setForm({ ...data, pass: '' });
  }, [data]);
  if (loading && !form) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refresh} />;
  if (!form) return null;
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });
  const dirty =
    !!data &&
    (form.pass !== '' || (['host', 'port', 'secure', 'user', 'from'] as const).some((k) => form[k] !== data[k]));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setFormError('');
    setResult(null);
    try {
      const { has_password, source, ...body } = form!;
      await api('/admin/email-settings', { method: 'PUT', body: JSON.stringify(body) });
      refresh();
      notice('Email settings saved. Send a test email to check them.');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function test() {
    setBusy('test');
    setResult(null);
    try {
      await api('/admin/email-settings/test', { method: 'POST', body: JSON.stringify({ to }) });
      setResult({ ok: true, text: `Test email sent to ${to}. Check the inbox, and the spam folder.` });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <h3>Email (SMTP)</h3>
        <Badge tone={data?.source === 'none' ? 'danger' : 'success'}>
          {data?.source === 'none' ? 'Not set up' : data?.source === 'environment' ? 'Set in server environment' : 'Set up'}
        </Badge>
      </div>
      <form className="stack" onSubmit={save}>
        <small className="muted">
          Customers receive their 6-digit verification code through this mail server. Until it is set up, new customers
          cannot sign up.
        </small>
        <div className="form-grid">
          <label>
            SMTP server
            <input value={form.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="smtp.gmail.com" />
          </label>
          <label>
            Security and port
            <select
              value={form.secure ? 'ssl' : 'starttls'}
              onChange={(e) => setForm({ ...form, secure: e.target.value === 'ssl', port: e.target.value === 'ssl' ? 465 : 587 })}
            >
              <option value="starttls">STARTTLS (port 587)</option>
              <option value="ssl">SSL / TLS (port 465)</option>
            </select>
          </label>
          <label>
            Port
            <input type="number" required min={1} max={65535} value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
          </label>
          <label>
            Username
            <input value={form.user} autoComplete="off" onChange={(e) => set('user', e.target.value)} placeholder="you@your-domain.com" />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="new-password"
              value={form.pass}
              onChange={(e) => set('pass', e.target.value)}
              placeholder={data?.has_password && data.source === 'saved' ? 'Saved. Type to replace it' : ''}
            />
            <small>For Gmail, use an app password, not your normal password.</small>
          </label>
          <label>
            Sender shown to customers
            <input value={form.from} onChange={(e) => set('from', e.target.value)} placeholder="Dellvit <no-reply@your-domain.com>" />
          </label>
        </div>
        {formError && <ErrorBox error={formError} />}
        <div className="email-test">
          <label>
            Send a test email to
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" />
          </label>
          <button
            type="button"
            className="button ghost"
            disabled={!!busy || !to || dirty || data?.source === 'none'}
            title={dirty ? 'Save your changes first' : undefined}
            onClick={test}
          >
            <Send size={16} /> {busy === 'test' ? 'Sending…' : 'Send test email'}
          </button>
          <button className="button" disabled={!!busy || !dirty}>
            {busy === 'save' ? 'Saving…' : 'Save email settings'}
          </button>
        </div>
        {result && (
          <div className={'alert ' + (result.ok ? 'success' : 'error')}>
            {result.ok ? <Check size={16} /> : <X size={16} />} {result.text}
          </div>
        )}
      </form>
    </section>
  );
}

/* ---------- Payments ---------- */
const OTHER = '__other';
/** A bank/wallet select with an "Other" choice that reveals a free-text name. */
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
};
const methodType = (t?: string) => (t === 'manual' ? 'bank' : t || 'cod');
const accountSummary = (m: Partial<PaymentMethod>) =>
  m.type === 'cod'
    ? 'Collected by rider'
    : m.type === 'wallet'
      ? `${m.provider || ''} · ${m.mobile_number || ''}`
      : m.type === 'raast'
        ? `Raast ID ${m.raast_id || ''}`
        : `${m.bank_name || ''} · ${m.iban || m.account_number || ''}`;

type QueueRow = {
  id: string;
  reference: string;
  name: string;
  phone: string;
  email: string;
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
type Queue = ReturnType<typeof useData<QueueRow[]>>;
const awaiting = (r: QueueRow) => ['submitted', 'pending'].includes(r.payment_status) && r.status !== 'cancelled';
const canDecide = (r: QueueRow) =>
  !['paid', 'refund_due', 'refunded'].includes(r.payment_status) && !['cancelled', 'delivered'].includes(r.status);
const paidAt = (r: QueueRow) => r.payment_updated_at || r.created_at;

export function PaymentsWorkspace() {
  const [tab, setTab] = useState<'queue' | 'methods'>('queue');
  // One poll feeds both the tab badge and the verification list.
  const queue = useData<QueueRow[]>('/admin/payments/queue', 15000);
  const { data: methods } = useData<PaymentMethod[]>('/admin/records/payments');
  const pending = queue.data?.filter(awaiting).length || 0;
  const enabled = methods?.filter((m) => m.active).length;
  return (
    <div className="stack">
      <div className="seg-tabs" role="tablist" aria-label="Payments">
        <button role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
          <ShieldCheck size={16} />
          Verification
          {pending > 0 && <span className="tab-count">{pending}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'methods'} className={tab === 'methods' ? 'active' : ''} onClick={() => setTab('methods')}>
          <Wallet size={16} />
          Payment methods
          {enabled !== undefined && <span className="seg-count">{enabled} live</span>}
        </button>
      </div>
      {tab === 'queue' ? <PaymentQueue queue={queue} /> : <PaymentMethods />}
    </div>
  );
}

function PaymentQueue({ queue }: { queue: Queue }) {
  const { notice } = useApp();
  const { range, setRange, key, label: rangeText } = useRange('7d');
  const { data, loading, error, refresh } = queue;
  const [review, setReview] = useState<QueueRow | null>(null);
  const [busy, setBusy] = useState(false);
  // Figures are counted in the browser, so a new time frame shows placeholders briefly.
  const settling = useSettling(key);
  const statsBusy = (loading && !data) || settling;
  async function approve(row: QueueRow) {
    setBusy(true);
    try {
      await api('/admin/payments/' + row.id + '/verify', { method: 'PATCH', body: JSON.stringify({ decision: 'approve', note: '' }) });
      notice('Payment verified. The order is ready to send.');
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = data || [];
  const windowed = rows.filter((r) => inRange(paidAt(r), range));
  const total = (list: QueueRow[]) => money(list.reduce((s, r) => s + r.total, 0));
  const waiting = rows.filter(awaiting);
  const verified = windowed.filter((r) => r.payment_status === 'paid');
  const rejected = windowed.filter((r) => r.payment_status === 'rejected');
  const refunds = rows.filter((r) => r.payment_status === 'refund_due');
  // Keep the open review in step with the latest poll.
  const current = review && (rows.find((r) => r.id === review.id) || review);
  return (
    <>
      <FilterBar title="Online payments" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Clock size={20} />}
          label="Awaiting verification"
          value={waiting.length}
          hint={`${total(waiting)} to check · live`}
          tone="orange"
          loading={statsBusy}
        />
        <Stat
          icon={<BadgeCheck size={20} />}
          label="Verified"
          value={total(verified)}
          hint={`${verified.length} payment${verified.length === 1 ? '' : 's'} in this period`}
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<X size={20} />}
          label="Rejected"
          value={rejected.length}
          hint={rejected.length ? `${total(rejected)} sent back to customers` : 'None in this period'}
          tone="red"
          loading={statsBusy}
        />
        <Stat
          icon={<Undo2 size={20} />}
          label="Refunds due"
          value={refunds.length}
          hint={`${total(refunds)} to return · live`}
          tone="purple"
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(r) => r.id}
        onRowClick={(r) => setReview(r)}
        dateFilter={{ get: paidAt }}
        search={(r) => `${r.reference} ${r.name} ${r.phone} ${r.transaction_id} ${r.payer_name}`}
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
            ],
            test: (r, v) => methodType(r.payment_type) === v,
          },
          {
            key: 'receipt',
            label: 'Receipts',
            options: [
              { value: 'yes', label: 'With receipt' },
              { value: 'no', label: 'No receipt' },
            ],
            test: (r, v) => (v === 'yes' ? !!r.proof_url : !r.proof_url),
          },
        ]}
        columns={[
          {
            key: 'ref',
            header: 'Order',
            sort: (r) => paidAt(r),
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.reference}</strong>
                <small>{date(paidAt(r))}</small>
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
              <RowAction tone="success" disabled={busy} onClick={() => approve(r)}>
                Approve
              </RowAction>
            )}
            <RowAction onClick={() => setReview(r)}>Review</RowAction>
          </>
        )}
      />
      <PaymentReview row={current} onClose={() => setReview(null)} refresh={refresh} />
    </>
  );
}

/** The full payment review: what the customer sent, where it should have arrived, and the decision. */
function PaymentReview({ row, onClose, refresh }: { row: QueueRow | null; onClose: () => void; refresh: () => void }) {
  const { notice } = useApp();
  const [mode, setMode] = useState<'review' | 'reject' | 'refund'>('review');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [checks, setChecks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode('review');
    setNote('');
    setReference('');
    setChecks([]);
  }, [row?.id]);
  async function send(path: string, body: unknown, done: string) {
    if (!row) return;
    setBusy(true);
    try {
      await api('/admin/payments/' + row.id + path, { method: 'PATCH', body: JSON.stringify(body) });
      notice(done);
      onClose();
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const r = row;
  const d = r?.payment_details || {};
  const checklist = r
    ? [
        { key: 'amount', text: `Received exactly ${money(r.total)}` },
        { key: 'tid', text: `Transaction ID ${r.transaction_id || '—'} matches your statement` },
        { key: 'sender', text: `Sent by ${r.payer_name || 'the customer'}${r.payer_account ? ' · ' + r.payer_account : ''}` },
      ]
    : [];
  const allChecked = checklist.every((c) => checks.includes(c.key));
  const destination: [string, string | undefined][] = [
    ['Bank', d.bank_name],
    ['Wallet', d.provider],
    ['Account title', d.account_title],
    ['Account number', d.account_number],
    ['IBAN', d.iban],
    ['Mobile number', d.mobile_number],
    ['Raast ID', d.raast_id],
  ];
  return (
    <Modal open={!!r} onClose={() => !busy && onClose()} title={r ? 'Payment · ' + r.reference : 'Payment'} size="xl">
      {r && (
        <div className="order-panel">
          <div className="op-hero">
            <div className="op-hero-top">
              <div className="panel-badges">
                <PaymentStatusBadge order={r} />
                <Badge value={r.status} />
                <span className="pay-chip">
                  <PaymentName order={r} />
                </span>
              </div>
              <span className="op-ref">
                <Hash size={14} />
                {r.reference}
                <CopyButton value={r.reference} label="order number" />
              </span>
            </div>
            <div className="op-meta">
              <MetaItem icon={<Wallet size={17} />} label="Amount" tone="brand">
                {money(r.total)}
              </MetaItem>
              <MetaItem icon={<CalendarClock size={17} />} label="Submitted">
                {date(paidAt(r))}
              </MetaItem>
              <MetaItem icon={<Store size={17} />} label="Outlet">
                {r.outlet_name}
              </MetaItem>
              <MetaItem icon={<UserRound size={17} />} label="Customer">
                {r.name}
              </MetaItem>
            </div>
          </div>

          {r.status === 'cancelled' && r.cancel_reason && (
            <div className="alert error">
              <X size={16} /> Order cancelled: {r.cancel_reason}
            </div>
          )}
          {r.payment_status === 'refund_due' && (
            <div className="alert warn">
              <Undo2 size={16} /> This order was cancelled after the payment was verified. Send {money(r.total)} back to the
              customer, then mark it refunded.
            </div>
          )}

          <div className="op-grid">
            <div className="op-col">
              <PanelSection icon={<CreditCard size={16} />} title="What the customer sent">
                <div className="op-pay">
                  <PaymentLogo
                    method={{ ...d, type: methodType(r.payment_type) as PaymentMethod['type'] }}
                    className="op-pay-logo"
                    size={18}
                  />
                  <span className="op-person-text">
                    <strong>{r.payment_name}</strong>
                    <small>{typeInfo[methodType(r.payment_type)]?.title}</small>
                  </span>
                </div>
                <dl className="op-kv">
                  <dt>Transaction ID</dt>
                  <dd>
                    {r.transaction_id ? (
                      <>
                        <span className="mono">{r.transaction_id}</span>
                        <CopyButton value={r.transaction_id} label="transaction ID" />
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                  <dt>Sender</dt>
                  <dd>{r.payer_name || '—'}</dd>
                  {r.payer_account && (
                    <>
                      <dt>From account</dt>
                      <dd>
                        <span className="mono">{r.payer_account}</span>
                        <CopyButton value={r.payer_account} label="sender account" />
                      </dd>
                    </>
                  )}
                </dl>
                {r.payment_note && (
                  <div className="op-note">
                    <ReceiptText size={16} />
                    <span>
                      <small>{r.payment_status === 'rejected' ? 'Rejection reason' : 'Note'}</small>
                      {r.payment_note}
                    </span>
                  </div>
                )}
              </PanelSection>
              <PanelSection icon={<Landmark size={16} />} title="Paid into">
                <dl className="op-kv">
                  {destination
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>
                          <span className={/number|IBAN|ID/.test(k) ? 'mono' : ''}>{v}</span>
                        </dd>
                      </Fragment>
                    ))}
                </dl>
                {!destination.some(([, v]) => v) && <small className="muted">No account details were saved on this order.</small>}
              </PanelSection>
              <PanelSection icon={<UserRound size={16} />} title="Customer">
                <div className="op-person">
                  <span className="op-avatar">{r.name.slice(0, 1).toUpperCase()}</span>
                  <span className="op-person-text">
                    <strong>{r.name}</strong>
                    <small>{r.email || r.phone}</small>
                  </span>
                  <a className="op-chip" href={'tel:' + r.phone}>
                    <Phone size={13} /> Call
                  </a>
                </div>
              </PanelSection>
            </div>
            <div className="op-col">
              <PanelSection
                icon={<ImageIcon size={16} />}
                title="Receipt"
                aside={
                  r.proof_url ? (
                    <a className="op-chip" href={r.proof_url} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> Open full size
                    </a>
                  ) : undefined
                }
              >
                {r.proof_url ? (
                  <a href={r.proof_url} target="_blank" rel="noreferrer" className="pr-receipt">
                    <img src={r.proof_url} alt="Payment receipt" />
                  </a>
                ) : (
                  <div className="pr-empty">
                    <ReceiptText size={22} />
                    <strong>No screenshot uploaded</strong>
                    <small>Match the transaction ID and amount against your account statement.</small>
                  </div>
                )}
              </PanelSection>
              {canDecide(r) && mode === 'review' && (
                <PanelSection
                  icon={<ListChecks size={16} />}
                  title="Before you approve"
                  aside={
                    <small className="muted">
                      {checks.length}/{checklist.length} checked
                    </small>
                  }
                >
                  <div className="pr-checks">
                    {checklist.map((c) => (
                      <label key={c.key} className="check">
                        <input
                          type="checkbox"
                          checked={checks.includes(c.key)}
                          onChange={(e) =>
                            setChecks((list) => (e.target.checked ? [...list, c.key] : list.filter((x) => x !== c.key)))
                          }
                        />
                        {c.text}
                      </label>
                    ))}
                  </div>
                </PanelSection>
              )}
              {r.reviewer_name && r.payment_status !== 'submitted' && (
                <PanelSection icon={<History size={16} />} title="Review">
                  <div className="op-person">
                    <span className="op-avatar">{r.reviewer_name.slice(0, 1).toUpperCase()}</span>
                    <span className="op-person-text">
                      <strong>{r.reviewer_name}</strong>
                      <small>
                        {label(r.payment_status)}
                        {r.payment_reviewed_at && ' · ' + date(r.payment_reviewed_at)}
                      </small>
                    </span>
                  </div>
                </PanelSection>
              )}
            </div>
          </div>

          {mode === 'reject' && (
            <label>
              Reason (sent to the customer)
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
          {mode === 'refund' && (
            <div className="form-grid">
              <label>
                Refund reference <span className="muted">(optional)</span>
                <input maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
              </label>
              <label>
                Note <span className="muted">(optional)</span>
                <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          )}
          <div className="panel-actions op-actions">
            {mode === 'reject' ? (
              <>
                <button className="button ghost" onClick={() => setMode('review')}>
                  Back
                </button>
                <button
                  className="button danger"
                  disabled={busy || !note.trim()}
                  onClick={() => send('/verify', { decision: 'reject', note }, 'Payment rejected. Customer notified.')}
                >
                  <X size={16} /> Reject payment
                </button>
              </>
            ) : mode === 'refund' ? (
              <>
                <button className="button ghost" onClick={() => setMode('review')}>
                  Back
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => send('/refund', { reference, note }, 'Refund recorded. Customer notified.')}
                >
                  <Undo2 size={16} /> Confirm refund sent
                </button>
              </>
            ) : (
              <>
                {r.payment_status === 'refund_due' && (
                  <button className="button" onClick={() => setMode('refund')}>
                    <Undo2 size={16} /> Mark refunded
                  </button>
                )}
                {canDecide(r) && (
                  <>
                    <button className="button danger-ghost" onClick={() => setMode('reject')}>
                      <X size={16} /> Reject
                    </button>
                    <button
                      className="button"
                      disabled={busy || !allChecked}
                      title={allChecked ? undefined : 'Tick each check first'}
                      onClick={() =>
                        send('/verify', { decision: 'approve', note: '' }, 'Payment verified. The order is ready to send.')
                      }
                    >
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
  require_proof: false,
  active: true,
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
  const list = data || [];
  const live = list.filter((m) => m.active);
  const online = list.filter((m) => m.type !== 'cod');
  const statsBusy = loading && !data;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      const { id, ...body } = edit;
      // Known providers use the shared logo in public/paymentmethods, so no upload is stored.
      if (autoLogo(body)) body.logo = '';
      await api('/admin/records/payments/' + id, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null);
      refresh();
      notice(isExisting ? 'Payment method saved.' : 'Payment method added. Select it on the products that should accept it.');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const add = () => {
    setFormError('');
    setEdit({ ...emptyMethod, id: crypto.randomUUID() });
  };
  return (
    <>
      <div className="stats">
        <Stat
          icon={<Wallet size={20} />}
          label="Payment methods"
          value={list.length}
          hint={`${live.length} enabled at checkout`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<Banknote size={20} />}
          label="Cash on delivery"
          value={list.some((m) => m.type === 'cod' && m.active) ? 'On' : 'Off'}
          hint="Rider collects cash at the door"
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<Building2 size={20} />}
          label="Online methods"
          value={online.filter((m) => m.active).length}
          hint={`${online.length} set up · bank, wallet and Raast`}
          tone="purple"
          loading={statsBusy}
        />
        <Stat
          icon={<ReceiptText size={20} />}
          label="Receipt required"
          value={online.filter((m) => m.require_proof).length}
          hint={`of ${online.length} online method${online.length === 1 ? '' : 's'}`}
          tone="orange"
          loading={statsBusy}
        />
      </div>
      <DataTable
        title={
          <span className="cell-stack">
            <h3>Payment methods</h3>
            <small className="muted">
              Choose which methods each product accepts when you add or edit it under Products.
            </small>
          </span>
        }
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(m) => m.id}
        search={(m) => `${m.name} ${accountSummary(m)} ${m.account_title || ''}`}
        searchPlaceholder="Search methods"
        toolbar={
          <button className="button" onClick={add}>
            <Plus size={16} /> Add method
          </button>
        }
        filters={[
          {
            key: 'type',
            label: 'Types',
            options: Object.entries(typeInfo).map(([value, t]) => ({ value, label: t.title })),
            test: (m, v) => methodType(m.type) === v,
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
        empty="No payment methods yet. Add one so customers can pay."
        columns={[
          {
            key: 'name',
            header: 'Method',
            sort: (m) => m.name,
            render: (m) => (
              <div className="cell-main">
                <PaymentLogo method={m} className="n-icon payment" size={16} />
                <span className="cell-stack">
                  <strong>{m.name}</strong>
                  <small>{typeInfo[methodType(m.type)]?.title}</small>
                </span>
              </div>
            ),
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
              m.type === 'cod' ? (
                <span className="muted">—</span>
              ) : (
                <Badge tone={m.require_proof ? 'warn' : 'neutral'}>{m.require_proof ? 'Required' : 'Optional'}</Badge>
              ),
          },
          {
            key: 'products',
            header: 'Products',
            sort: (m) => m.products || 0,
            render: (m) =>
              m.products ? (
                <span>
                  {m.products} product{m.products === 1 ? '' : 's'}
                </span>
              ) : (
                <span className="muted">Not used</span>
              ),
          },
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
                    notice(
                      v
                        ? `${m.name} enabled for the products that accept it.`
                        : `${m.name} hidden from checkout on every product.`,
                    );
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
                setEdit({ ...emptyMethod, ...m, type: methodType(m.type) });
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
                    disabled={isExisting}
                    className={'type-card' + (edit.type === value ? ' selected' : '')}
                    onClick={() =>
                      setEdit({
                        ...edit,
                        type: value,
                        name:
                          edit.name ||
                          (value === 'wallet' ? edit.provider : value === 'cod' ? 'Cash on delivery' : value === 'raast' ? 'Raast' : ''),
                      })
                    }
                  >
                    <t.icon size={20} />
                    <strong>{t.title}</strong>
                    <small>{isExisting ? 'Type is fixed once a method is created' : t.hint}</small>
                  </button>
                ))}
            </div>
            <div className="form-grid">
              <label className="span-2">
                Name shown at checkout
                <input required value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Meezan Bank transfer" />
              </label>
              {edit.type !== 'cod' && <h4 className="span-2 form-section">Account details</h4>}
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
                      Set automatically from {(edit.type !== 'raast' && providerName(edit)) || typeInfo[edit.type]?.title}
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
              {edit.type !== 'cod' && (
                <Toggle checked={!!edit.require_proof} onChange={(v) => set('require_proof', v)} label="Require a receipt screenshot" />
              )}
              <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Enabled at checkout" />
            </div>
            {edit.type !== 'cod' && (
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
        “{remove?.name}” will be removed
        {remove?.products
          ? ` from ${remove.products} product${remove.products === 1 ? '' : 's'} as well. Products left without an enabled method cannot be ordered until you choose another`
          : ''}
        . Existing orders keep their payment details. To hide it temporarily, disable it instead.
      </Confirm>
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
type AdminCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  location_id: string | null;
  active: number;
  created_at: string;
  /** Empty until the customer enters the code emailed to them; they cannot sign in before that. */
  email_verified_at: string | null;
  last_login_at: string | null;
  admin_notes: string;
  orders: number;
  active_orders: number;
  cancelled: number;
  spent: number;
  last_order_at: string | null;
  /** Figures for the time frame chosen above the cards. */
  orders_range: number;
  spent_range: number;
  code_sent_at: string | null;
};
type CustomerOrder = {
  id: string;
  reference: string;
  status: string;
  total: number;
  created_at: string;
  outlet_name: string | null;
  payment_name: string | null;
};
export function CustomerDirectory() {
  const { notice, locations } = useApp();
  const { range, setRange, query, key, label: rangeText } = useRange('30d');
  const { data, setData, error, loading, refresh } = useData<AdminCustomer[]>(
    '/admin/customers' + query,
    30000,
    'customers:' + key,
  );
  // Shown only to administrators who may see email settings; others simply get no warning.
  const { data: email } = useData<{ source: string }>('/admin/email-settings');
  const [view, setView] = useState<string | null>(null);
  const [edit, setEdit] = useState<RecordData | null>(null);
  const [remove, setRemove] = useState<AdminCustomer | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const areaName = (id: string | null) => locations.find((l) => l.id === id)?.name || '';
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  function start(c?: AdminCustomer) {
    setFormError('');
    setEdit(
      c
        ? { ...c, location_id: c.location_id || '', password: '' }
        : { name: '', email: '', phone: '', address: '', location_id: '', admin_notes: '', password: '', verified: true },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await api('/admin/customers' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...edit, password: edit.password || undefined }),
      });
      refresh();
      notice(
        edit.id
          ? 'Customer saved.'
          : edit.verified
            ? 'Customer added. They can sign in right away.'
            : 'Customer added. A verification code has been emailed to them.',
      );
      setEdit(null);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips a switch at once and saves just that setting; the list reloads only if the save fails. */
  async function quick(c: AdminCustomer, change: { active?: boolean; verified?: boolean }, done: string) {
    setData(
      (rows) =>
        rows &&
        rows.map((x) =>
          x.id === c.id
            ? {
                ...x,
                ...(change.active !== undefined ? { active: Number(change.active) } : {}),
                ...(change.verified !== undefined
                  ? { email_verified_at: change.verified ? x.email_verified_at || new Date().toISOString() : null }
                  : {}),
              }
            : x,
        ),
    );
    try {
      await api('/admin/customers/' + c.id, { method: 'PATCH', body: JSON.stringify(change) });
      notice(done);
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  /** A one-off action from the detail view. */
  async function act(c: AdminCustomer, path: string, done: (r: RecordData) => string) {
    setBusy(true);
    try {
      notice(done(await api<RecordData>('/admin/customers/' + c.id + path, { method: 'POST' })));
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const list = data || [];
  const pending = list.filter((c) => !c.email_verified_at);
  const statsBusy = loading && !data;
  const sum = (get: (c: AdminCustomer) => number) => list.reduce((n, c) => n + (get(c) || 0), 0);
  const joined = list.filter((c) => inRange(c.created_at, range));
  const buyers = list.filter((c) => c.orders_range > 0).length;
  const current = view ? list.find((c) => c.id === view) : undefined;
  return (
    <div className="stack">
      {email?.source === 'none' && (
        <div className="alert warn">
          <MailWarning size={16} /> Email is not set up, so verification codes cannot be sent and new customers cannot sign
          up. <a href="/admin?tab=settings">Add your SMTP details in Store settings.</a>
        </div>
      )}
      <FilterBar title="Customers" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Users size={20} />}
          label="Customers"
          value={list.length}
          hint={`${list.length - pending.length} verified · ${list.filter((c) => !c.active).length} blocked · live`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<UserPlus size={20} />}
          label="New sign-ups"
          value={joined.length}
          hint={`${joined.filter((c) => c.email_verified_at).length} verified their email`}
          tone="green"
          loading={loading}
        />
        <Stat
          icon={<ShoppingBag size={20} />}
          label="Orders"
          value={sum((c) => c.orders_range)}
          hint={`from ${buyers} customer${buyers === 1 ? '' : 's'}`}
          tone="orange"
          loading={loading}
        />
        <Stat
          icon={<Wallet size={20} />}
          label="Delivered spend"
          value={money(sum((c) => c.spent_range))}
          hint="Order totals delivered in this period"
          tone="purple"
          loading={loading}
        />
        <Stat
          icon={<MailWarning size={20} />}
          label="Awaiting verification"
          value={pending.length}
          hint="Signed up but cannot sign in yet · live"
          tone="red"
          quiet={!pending.length}
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(c) => c.id}
        onRowClick={(c) => setView(c.id)}
        search={(c) => `${c.name} ${c.email} ${c.phone} ${c.address}`}
        searchPlaceholder="Search name, email, phone"
        empty="No customer accounts yet."
        toolbar={
          <button className="button" onClick={() => start()}>
            <Plus size={16} /> Add customer
          </button>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'active', label: 'Can sign in' },
              { value: 'blocked', label: 'Blocked' },
            ],
            test: (c, v) => (v === 'active' ? !!c.active : !c.active),
          },
          {
            key: 'email',
            label: 'Email statuses',
            options: [
              { value: 'verified', label: 'Verified' },
              { value: 'pending', label: 'Awaiting verification' },
            ],
            test: (c, v) => (v === 'verified') === !!c.email_verified_at,
          },
          {
            key: 'orders',
            label: 'Order history',
            options: [
              { value: 'none', label: 'No orders' },
              { value: 'some', label: 'Has ordered' },
              { value: 'open', label: 'Order in progress' },
              { value: 'repeat', label: 'Repeat customer' },
            ],
            test: (c, v) =>
              v === 'none' ? c.orders === 0 : v === 'some' ? c.orders > 0 : v === 'open' ? c.active_orders > 0 : c.orders > 1,
          },
          {
            key: 'area',
            label: 'Areas',
            options: locations.map((l) => ({ value: l.id, label: l.name })),
            test: (c, v) => c.location_id === v,
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
          {
            key: 'phone',
            header: 'Contact',
            render: (c) => (
              <span className="cell-stack">
                <span>{c.phone || '—'}</span>
                <small>{areaName(c.location_id) || 'No area'}</small>
              </span>
            ),
          },
          {
            key: 'email',
            header: 'Email',
            render: (c) =>
              c.email_verified_at ? (
                <Badge tone="success">Verified</Badge>
              ) : (
                <span className="cell-stack">
                  <Badge tone="warn">Awaiting code</Badge>
                  {c.code_sent_at && <small>Sent {date(c.code_sent_at)}</small>}
                </span>
              ),
          },
          {
            key: 'orders',
            header: 'Orders',
            sort: (c) => c.orders,
            render: (c) => (
              <span className="cell-stack">
                <strong>{c.orders}</strong>
                <small>
                  {c.active_orders
                    ? c.active_orders + ' in progress'
                    : c.last_order_at
                      ? 'Last ' + date(c.last_order_at)
                      : 'None yet'}
                </small>
              </span>
            ),
          },
          {
            key: 'spent',
            header: 'Delivered spend',
            sort: (c) => c.spent,
            render: (c) => <strong>{money(c.spent)}</strong>,
          },
          {
            key: 'joined',
            header: 'Joined',
            sort: (c) => c.created_at,
            render: (c) => (
              <span className="cell-stack">
                <span>{date(c.created_at)}</span>
                <small>{c.last_login_at ? 'Signed in ' + date(c.last_login_at) : 'Never signed in'}</small>
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Can sign in',
            render: (c) => (
              <Toggle
                checked={!!c.active}
                onChange={(v) => quick(c, { active: v }, v ? 'Account unblocked.' : 'Account blocked and signed out.')}
              />
            ),
          },
        ]}
        actions={(c) => (
          <>
            <IconAction label="View customer" onClick={() => setView(c.id)}>
              <Eye size={16} />
            </IconAction>
            <IconAction label="Edit customer" onClick={() => start(c)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction label="Delete customer" tone="danger" onClick={() => setRemove(c)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!current} onClose={() => setView(null)} title={current ? 'Customer · ' + current.name : 'Customer'} size="xl">
        {current && (
          <CustomerPanel
            customer={current}
            area={areaName(current.location_id)}
            busy={busy}
            onActive={(v) => quick(current, { active: v }, v ? 'Account unblocked.' : 'Account blocked and signed out.')}
            onVerified={(v) =>
              quick(
                current,
                { verified: v },
                v ? 'Email marked as verified. The customer can sign in.' : 'Email marked as unverified. The customer was signed out.',
              )
            }
            onSendCode={() => act(current, '/send-code', () => 'A new verification code has been emailed.')}
            onSignOut={() =>
              act(current, '/sign-out', (r) =>
                r.sessions ? `Signed out of ${r.sessions} device${r.sessions === 1 ? '' : 's'}.` : 'The customer was not signed in anywhere.',
              )
            }
            onEdit={() => {
              setView(null);
              start(current);
            }}
            onDelete={() => {
              setView(null);
              setRemove(current);
            }}
          />
        )}
      </Modal>
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={edit?.id ? 'Edit customer' : 'Add customer'} size="lg">
        {edit && (
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <h4 className="span-2 form-section">Customer</h4>
              <label>
                Full name
                <input required maxLength={100} value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                Phone
                <input required type="tel" value={edit.phone} onChange={(e) => set('phone', e.target.value)} placeholder="03XXXXXXXXX" />
              </label>
              <label>
                Email
                <input required type="email" value={edit.email} onChange={(e) => set('email', e.target.value)} />
                <small>The customer signs in with this address.</small>
              </label>
              <label>
                Delivery area <span className="muted">(optional)</span>
                <select value={edit.location_id} onChange={(e) => set('location_id', e.target.value)}>
                  <option value="">No area</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Address <span className="muted">(optional)</span>
                <input maxLength={500} value={edit.address} onChange={(e) => set('address', e.target.value)} />
              </label>

              <h4 className="span-2 form-section">Sign-in</h4>
              <label>
                {edit.id ? 'New password (optional)' : 'Password'}
                <input
                  type="password"
                  required={!edit.id}
                  minLength={10}
                  maxLength={100}
                  autoComplete="new-password"
                  value={edit.password}
                  onChange={(e) => set('password', e.target.value)}
                />
                <small>
                  {edit.id ? 'Setting one signs the customer out everywhere. Leave blank to keep it.' : 'At least 10 characters.'}
                </small>
              </label>
              <label className="span-2">
                Internal notes <span className="muted">(optional, administrators only)</span>
                <textarea rows={2} maxLength={2000} value={edit.admin_notes} onChange={(e) => set('admin_notes', e.target.value)} />
              </label>
            </div>
            {!edit.id && (
              <Toggle
                checked={!!edit.verified}
                onChange={(v) => set('verified', v)}
                label="Email already verified (turn off to email the customer a 6-digit code first)"
              />
            )}
            {formError && <ErrorBox error={formError} />}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                {busy ? 'Saving…' : 'Save customer'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete customer?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const r = await api<{ erased: boolean }>('/admin/customers/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice(r.erased ? 'Account closed and personal details erased. Past orders were kept.' : 'Customer deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {remove?.active_orders
          ? `“${remove.name}” has ${remove.active_orders} order${remove.active_orders === 1 ? '' : 's'} in progress, so the account cannot be deleted yet. Finish or cancel ${remove.active_orders === 1 ? 'it' : 'them'} first, or block the account instead.`
          : remove?.orders
            ? `“${remove.name}” has ${remove.orders} past order${remove.orders === 1 ? '' : 's'}. The account will be closed and the name, email, phone and address erased. The orders stay in your records with the delivery details they were placed with. This cannot be undone.`
            : `“${remove?.name}” has no orders, so the account will be removed completely. This cannot be undone.`}
      </Confirm>
    </div>
  );
}

/** Everything about one customer: contact, account controls and recent orders. */
function CustomerPanel({
  customer: c,
  area,
  busy,
  onActive,
  onVerified,
  onSendCode,
  onSignOut,
  onEdit,
  onDelete,
}: {
  customer: AdminCustomer;
  area: string;
  busy: boolean;
  onActive: (v: boolean) => void;
  onVerified: (v: boolean) => void;
  onSendCode: () => void;
  onSignOut: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data: orders, loading, error } = useData<CustomerOrder[]>('/admin/customers/' + c.id + '/orders');
  return (
    <div className="order-panel">
      <div className="op-hero">
        <div className="op-hero-top">
          <div className="panel-badges">
            <Badge tone={c.active ? 'success' : 'danger'}>{c.active ? 'Can sign in' : 'Blocked'}</Badge>
            <Badge tone={c.email_verified_at ? 'success' : 'warn'}>
              {c.email_verified_at ? 'Email verified' : 'Awaiting verification'}
            </Badge>
            {c.active_orders > 0 && <Badge tone="info">{c.active_orders} order{c.active_orders === 1 ? '' : 's'} in progress</Badge>}
          </div>
          <span className="op-ref">
            <Mail size={14} />
            {c.email}
            <CopyButton value={c.email} label="email" />
          </span>
        </div>
        <div className="op-meta">
          <MetaItem icon={<ShoppingBag size={17} />} label="Orders">
            {c.orders}
          </MetaItem>
          <MetaItem icon={<Wallet size={17} />} label="Delivered spend" tone="brand">
            {money(c.spent)}
          </MetaItem>
          <MetaItem icon={<CalendarClock size={17} />} label="Joined">
            {date(c.created_at)}
          </MetaItem>
          <MetaItem icon={<History size={17} />} label="Last sign-in">
            {c.last_login_at ? date(c.last_login_at) : 'Never'}
          </MetaItem>
        </div>
      </div>

      {!c.email_verified_at && (
        <div className="alert warn">
          <MailWarning size={16} /> This customer has not entered their email code yet, so they cannot sign in.
          {c.code_sent_at && ' The last code was sent ' + date(c.code_sent_at) + '.'}
        </div>
      )}

      <div className="op-grid">
        <div className="op-col">
          <PanelSection icon={<UserRound size={16} />} title="Contact">
            <div className="op-person">
              <span className="op-avatar">{c.name.slice(0, 1).toUpperCase()}</span>
              <span className="op-person-text">
                <strong>{c.name}</strong>
                <small>{c.phone || 'No phone'}</small>
              </span>
              {c.phone && (
                <a className="op-chip" href={'tel:' + c.phone}>
                  <Phone size={13} /> Call
                </a>
              )}
              <a className="op-chip" href={'mailto:' + c.email}>
                <Mail size={13} /> Email
              </a>
            </div>
            <dl className="op-kv">
              <dt>Area</dt>
              <dd>{area || '—'}</dd>
              <dt>Address</dt>
              <dd>{c.address || '—'}</dd>
              {c.cancelled > 0 && (
                <>
                  <dt>Cancelled</dt>
                  <dd>
                    {c.cancelled} order{c.cancelled === 1 ? '' : 's'}
                  </dd>
                </>
              )}
            </dl>
          </PanelSection>
          <PanelSection icon={<ShieldCheck size={16} />} title="Account controls">
            <div className="toggle-list">
              <Toggle checked={!!c.active} onChange={onActive} label="Can sign in (turn off to block the account)" />
              <Toggle
                checked={!!c.email_verified_at}
                onChange={onVerified}
                label="Email verified (turn off to require a new code)"
              />
            </div>
            <div className="panel-actions">
              {!c.email_verified_at && (
                <RowAction icon={<Send size={14} />} disabled={busy} onClick={onSendCode}>
                  Email a new code
                </RowAction>
              )}
              <RowAction icon={<LogOut size={14} />} disabled={busy} onClick={onSignOut}>
                Sign out everywhere
              </RowAction>
            </div>
          </PanelSection>
          {c.admin_notes && (
            <PanelSection icon={<StickyNote size={16} />} title="Internal notes">
              <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {c.admin_notes}
              </p>
            </PanelSection>
          )}
        </div>
        <div className="op-col">
          <PanelSection
            icon={<ReceiptText size={16} />}
            title="Recent orders"
            aside={orders?.length ? <small className="muted">Latest {orders.length}</small> : undefined}
          >
            {loading && !orders ? (
              <Loading />
            ) : error ? (
              <ErrorBox error={error} />
            ) : orders?.length ? (
              <div className="customer-orders">
                {orders.map((o) => (
                  <a key={o.id} href={'/orders/' + o.id} target="_blank" rel="noreferrer" className="customer-order">
                    <span className="cell-stack">
                      <strong>{o.reference}</strong>
                      <small>
                        {date(o.created_at)}
                        {o.outlet_name && ' · ' + o.outlet_name}
                      </small>
                    </span>
                    <span className="cell-stack end">
                      <strong>{money(o.total)}</strong>
                      <Badge value={o.status} />
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <small className="muted">This customer has not placed an order yet.</small>
            )}
          </PanelSection>
        </div>
      </div>
      <div className="panel-actions op-actions">
        <button className="button danger-ghost" onClick={onDelete}>
          <Trash2 size={16} /> Delete
        </button>
        <button className="button" onClick={onEdit}>
          <Edit3 size={16} /> Edit customer
        </button>
      </div>
    </div>
  );
}

