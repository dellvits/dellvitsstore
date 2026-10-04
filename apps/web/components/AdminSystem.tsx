'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  BadgeCheck,
  Crown,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  Headphones,
  History,
  KeyRound,
  LayoutPanelTop,
  ChartLine,
  Copy,
  ExternalLink,
  ListTree,
  Mail,
  Wrench,
  Lock,
  LogOut,
  Megaphone,
  Phone,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Store,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Wand2,
} from 'lucide-react';
import { ago, api, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useRange } from '@/lib/range';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, ErrorBox, FilterBar, IconAction, Loading, Modal, Stat, Toggle } from './UI';
import { EmailSettings } from './Platform';
import { MaintenancePage } from './Maintenance';

/* ---------- Admin access ---------- */
type Admin = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  active: number;
  created_at: string;
  last_login_at: string | null;
  permissions: string[];
  is_super_admin: boolean;
  /** The store owner's account: it can be seen here but never changed. */
  is_owner: boolean;
  /** Devices signed in right now, and changes made in the last 30 days. */
  sessions: number;
  actions: number;
};
type Staff = { permissions: string[]; me: string; users: Admin[] };
type Draft = Omit<Admin, 'sessions' | 'actions' | 'created_at' | 'last_login_at' | 'is_owner' | 'active'> & {
  active: boolean;
  password: string;
  isNew: boolean;
};

/** What each module lets an administrator do. */
const modules: Record<string, { title: string; hint: string; group: string }> = {
  overview: { title: 'Dashboard', hint: 'Sales figures and what needs attention', group: 'Daily work' },
  orders: { title: 'Orders', hint: 'See, assign, send and cancel orders', group: 'Daily work' },
  payments: { title: 'Payments', hint: 'Verify payments and manage payment methods', group: 'Daily work' },
  messages: { title: 'Messages', hint: 'Support chat and the contact form inbox', group: 'Daily work' },
  customers: { title: 'Customers', hint: 'Customer accounts, verification and blocking', group: 'Daily work' },
  riders: { title: 'Riders', hint: 'Riders, COD cash and rider payouts', group: 'Operations' },
  outlets: { title: 'Outlets', hint: 'Outlets, their documents and commission', group: 'Operations' },
  locations: { title: 'Delivery areas', hint: 'Areas, fees, hours and coverage', group: 'Operations' },
  products: { title: 'Products', hint: 'Every outlet’s products and stock', group: 'Catalogue' },
  categories: { title: 'Categories', hint: 'Categories and their home page sections', group: 'Catalogue' },
  content: { title: 'Homepage content', hint: 'Heroes, sections, banners and videos', group: 'Marketing' },
  ads: { title: 'Advertising', hint: 'Ads, where they appear and their figures', group: 'Marketing' },
  coupons: { title: 'Coupons', hint: 'Discount codes and their rules', group: 'Marketing' },
  audit: { title: 'Activity log', hint: 'What administrators changed', group: 'System' },
  settings: { title: 'Store settings', hint: 'Store details, switches and email', group: 'System' },
};
const moduleTitle = (p: string) => modules[p]?.title || label(p);
/** Ready-made sets of modules for common jobs. */
const presets: { title: string; permissions: string[] }[] = [
  { title: 'Store manager', permissions: Object.keys(modules).filter((m) => m !== 'settings' && m !== 'audit') },
  { title: 'Dispatcher', permissions: ['overview', 'orders', 'riders', 'locations'] },
  { title: 'Support agent', permissions: ['overview', 'orders', 'customers', 'messages'] },
  { title: 'Finance', permissions: ['overview', 'orders', 'payments', 'riders'] },
  { title: 'Catalogue editor', permissions: ['products', 'categories', 'outlets'] },
  { title: 'Marketing', permissions: ['content', 'ads', 'coupons'] },
];
/** A 16-character password with letters, digits and symbols, without look-alike characters. */
const newPassword = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%+='[n % 62],
  ).join('');
const roleOf = (u: Pick<Admin, 'is_owner' | 'is_super_admin'>) => (u.is_owner ? 'owner' : u.is_super_admin ? 'super' : 'admin');

export function StaffManager() {
  const { notice } = useApp();
  const { data, setData, error, loading, refresh } = useData<Staff>('/admin/staff', 60000);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [remove, setRemove] = useState<Admin | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState('');
  const users = data?.users || [];
  const all = data?.permissions || Object.keys(modules);
  /** The owner and your own account are managed elsewhere. */
  const locked = (u: Admin) => u.is_owner || u.id === data?.me;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  function start(u?: Admin) {
    setMessage('');
    setReveal(false);
    setEdit(
      u
        ? { id: u.id, name: u.name, email: u.email, phone: u.phone || '', title: u.title || '', permissions: u.permissions, is_super_admin: u.is_super_admin, active: !!u.active, password: '', isNew: false }
        : { id: crypto.randomUUID(), name: '', email: '', phone: '', title: '', permissions: [], is_super_admin: false, active: true, password: '', isNew: true },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setMessage('');
    try {
      const { id, isNew, is_super_admin, password, ...body } = edit;
      await api('/admin/staff/' + id, {
        method: 'PUT',
        body: JSON.stringify({ ...body, super: is_super_admin, password: password || undefined }),
      });
      setEdit(null);
      refresh();
      notice(isNew ? 'Administrator added.' : 'Administrator saved. They will sign in again with the new access.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips the switch at once and saves just that; the list reloads only if the save fails. */
  async function setActive(u: Admin, v: boolean) {
    setData((d) => d && { ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, active: Number(v), sessions: v ? x.sessions : 0 } : x)) });
    try {
      await api('/admin/staff/' + u.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
      notice(v ? `${u.name} can sign in again.` : `${u.name} is disabled and signed out.`);
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  async function signOut(u: Admin) {
    try {
      const r = await api<{ sessions: number }>('/admin/staff/' + u.id + '/sign-out', { method: 'POST' });
      notice(r.sessions ? `${u.name} was signed out of ${r.sessions} device${r.sessions === 1 ? '' : 's'}.` : `${u.name} was not signed in.`);
      refresh();
    } catch (e) {
      notice((e as Error).message);
    }
  }
  const statsBusy = loading && !data;
  const groups = [...new Set(all.map((p) => modules[p]?.group || 'Other'))];
  return (
    <div className="stack">
      <div className="stats">
        <Stat
          icon={<Users size={20} />}
          label="Administrators"
          value={users.length}
          hint={`${users.filter((u) => u.active).length} enabled`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<Crown size={20} />}
          label="Super admins"
          value={users.filter((u) => u.is_super_admin).length}
          hint="Every module, and this page"
          tone="purple"
          loading={statsBusy}
        />
        <Stat
          icon={<UserCheck size={20} />}
          label="Signed in now"
          value={users.filter((u) => u.sessions > 0).length}
          hint={`${users.reduce((n, u) => n + u.sessions, 0)} devices`}
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<UserX size={20} />}
          label="Disabled"
          value={users.filter((u) => !u.active).length}
          hint="Cannot sign in"
          tone="orange"
          quiet={!users.some((u) => !u.active)}
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data?.users}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(u) => u.id}
        onRowClick={(u) => !locked(u) && start(u)}
        search={(u) => `${u.name} ${u.email} ${u.title} ${u.phone}`}
        searchPlaceholder="Search administrators"
        empty="No administrators yet."
        toolbar={
          <button className="button" onClick={() => start()}>
            <UserPlus size={16} /> Add administrator
          </button>
        }
        filters={[
          {
            key: 'role',
            label: 'Roles',
            options: [
              { value: 'owner', label: 'Owner' },
              { value: 'super', label: 'Super admin' },
              { value: 'admin', label: 'Admin' },
            ],
            test: (u, v) => roleOf(u) === v,
          },
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'on', label: 'Enabled' },
              { value: 'off', label: 'Disabled' },
              { value: 'online', label: 'Signed in now' },
            ],
            test: (u, v) => (v === 'online' ? u.sessions > 0 : (v === 'on') === !!u.active),
          },
          {
            key: 'module',
            label: 'Modules',
            options: all.map((p) => ({ value: p, label: moduleTitle(p) })),
            test: (u, v) => u.is_super_admin || u.permissions.includes(v),
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Administrator',
            sort: (u) => u.name.toLowerCase(),
            render: (u) => (
              <div className="cell-main">
                <span className="avatar sm">{u.name.slice(0, 1).toUpperCase()}</span>
                <span className="cell-stack">
                  <strong>
                    {u.name} {u.id === data?.me && <span className="chip small">You</span>}
                  </strong>
                  <small>{u.email}</small>
                </span>
              </div>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            sort: (u) => roleOf(u),
            render: (u) => (
              <span className="cell-stack">
                <Badge tone={u.is_owner ? 'success' : u.is_super_admin ? 'purple' : 'info'}>
                  {u.is_owner ? 'Owner' : u.is_super_admin ? 'Super admin' : 'Admin'}
                </Badge>
                {u.title && <small>{u.title}</small>}
              </span>
            ),
          },
          {
            key: 'modules',
            header: 'Modules',
            render: (u) =>
              u.is_super_admin ? (
                'All modules'
              ) : u.permissions.length ? (
                <span className="chip-list">
                  {u.permissions.slice(0, 3).map((p) => (
                    <span className="chip small" key={p}>
                      {moduleTitle(p)}
                    </span>
                  ))}
                  {u.permissions.length > 3 && (
                    <span className="chip small" title={u.permissions.slice(3).map(moduleTitle).join(', ')}>
                      +{u.permissions.length - 3}
                    </span>
                  )}
                </span>
              ) : (
                <span className="muted">None</span>
              ),
          },
          {
            key: 'seen',
            header: 'Last sign-in',
            sort: (u) => u.last_login_at || '',
            render: (u) => (
              <span className="cell-stack">
                <span>{u.last_login_at ? ago(u.last_login_at) : <span className="muted">Never</span>}</span>
                <small>{u.sessions ? `${u.sessions} device${u.sessions === 1 ? '' : 's'} signed in` : 'Not signed in'}</small>
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'Changes',
            sort: (u) => u.actions,
            render: (u) => (
              <span className="cell-stack">
                <span>{u.actions}</span>
                <small>last 30 days</small>
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Enabled',
            render: (u) =>
              locked(u) ? (
                <span className="muted protected-note">
                  <Lock size={13} /> {u.is_owner ? 'Protected' : 'Your account'}
                </span>
              ) : (
                <Toggle checked={!!u.active} onChange={(v) => setActive(u, v)} />
              ),
          },
        ]}
        actions={(u) =>
          locked(u) ? (
            u.id === data?.me && (
              <IconAction label="Open your profile" href="/admin?tab=profile">
                <Edit3 size={16} />
              </IconAction>
            )
          ) : (
            <>
              <IconAction label="Edit access" onClick={() => start(u)}>
                <Edit3 size={16} />
              </IconAction>
              <IconAction label="Sign out of all devices" onClick={() => signOut(u)} disabled={!u.sessions}>
                <LogOut size={16} />
              </IconAction>
              <IconAction label="Delete" tone="danger" onClick={() => setRemove(u)}>
                <Trash2 size={16} />
              </IconAction>
            </>
          )
        }
      />
      <div className="alert info">
        <ShieldCheck size={16} /> The owner account cannot be edited, disabled or deleted by anyone else. Every other
        administrator, including super admins, can be changed or removed here.
      </div>
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={edit?.isNew ? 'Add administrator' : 'Edit administrator'} size="lg">
        {edit && (
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <label>
                Full name
                <input required maxLength={200} value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                Job title <span className="muted">(optional)</span>
                <input maxLength={60} value={edit.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Support agent" />
              </label>
              <label>
                Email (used to sign in)
                <input required type="email" value={edit.email} onChange={(e) => set('email', e.target.value.trim())} />
              </label>
              <label>
                Phone <span className="muted">(optional)</span>
                <input type="tel" maxLength={30} value={edit.phone} onChange={(e) => set('phone', e.target.value)} />
              </label>
              <label className="span-2">
                {edit.isNew ? 'Password' : 'New password'} {!edit.isNew && <span className="muted">(leave empty to keep the current one)</span>}
                <span className="input-with-button">
                  <input
                    type={reveal ? 'text' : 'password'}
                    required={edit.isNew}
                    minLength={12}
                    maxLength={100}
                    autoComplete="new-password"
                    value={edit.password}
                    onChange={(e) => set('password', e.target.value)}
                  />
                  <button type="button" className="button ghost small" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Hide password' : 'Show password'}>
                    {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => {
                      set('password', newPassword());
                      setReveal(true);
                    }}
                  >
                    <Wand2 size={14} /> Generate
                  </button>
                </span>
                <small>At least 12 characters. Give it to the administrator yourself; it is not emailed.</small>
              </label>

              <h4 className="span-2 form-section">Role</h4>
              <div className="field span-2">
                <div className="type-grid role-grid">
                  <button type="button" className={'type-card' + (edit.is_super_admin ? '' : ' selected')} onClick={() => set('is_super_admin', false)}>
                    <ShieldCheck size={20} />
                    <strong>Admin</strong>
                    <small>Only the modules you choose below</small>
                  </button>
                  <button type="button" className={'type-card' + (edit.is_super_admin ? ' selected' : '')} onClick={() => set('is_super_admin', true)}>
                    <Crown size={20} />
                    <strong>Super admin</strong>
                    <small>Every module, and can manage administrators</small>
                  </button>
                </div>
              </div>
            </div>
            {!edit.is_super_admin && (
              <fieldset className="fieldset">
                <legend>
                  Modules ({edit.permissions.length} of {all.length})
                  <button type="button" className="link" onClick={() => set('permissions', edit.permissions.length === all.length ? [] : all)}>
                    {edit.permissions.length === all.length ? 'Clear all' : 'Select all'}
                  </button>
                </legend>
                <div className="choice-row">
                  {presets.map((p) => (
                    <button
                      type="button"
                      key={p.title}
                      className="choice"
                      onClick={() => setEdit({ ...edit, permissions: p.permissions.filter((x) => all.includes(x)), title: edit.title || p.title })}
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
                {groups.map((g) => (
                  <div key={g} className="permission-group">
                    <small className="muted">{g}</small>
                    <div className="permission-grid">
                      {all
                        .filter((p) => (modules[p]?.group || 'Other') === g)
                        .map((p) => (
                          <label className="check" key={p}>
                            <input
                              type="checkbox"
                              checked={edit.permissions.includes(p)}
                              onChange={(e) =>
                                set('permissions', e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x) => x !== p))
                              }
                            />
                            <span className="cell-stack">
                              <strong>{moduleTitle(p)}</strong>
                              <small>{modules[p]?.hint}</small>
                            </span>
                          </label>
                        ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            )}
            <Toggle checked={edit.active} onChange={(v) => set('active', v)} label="Account enabled" />
            {!edit.isNew && <small className="muted">Saving signs this administrator out, so the new access applies when they sign in again.</small>}
            {message && <ErrorBox error={message} />}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="button" disabled={busy || (!edit.is_super_admin && !edit.permissions.length)}>
                {busy ? 'Saving…' : edit.isNew ? 'Add administrator' : 'Save administrator'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete administrator?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/staff/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Administrator deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {remove?.name} ({remove?.email}) will be signed out and removed permanently. What they changed stays in the
        activity log without their name. Disable the account instead to keep it.
      </Confirm>
    </div>
  );
}

/* ---------- Activity log ---------- */
type Entry = { id: string; user_id: string | null; action: string; target: string; created_at: string; name: string | null; email: string | null };
const areas: Record<string, string> = {
  staff: 'Admin access',
  'area-settings': 'Delivery areas',
  locations: 'Delivery areas',
  'email-settings': 'Email settings',
  support: 'Support chat',
  messages: 'Messages',
  'rider-controls': 'Riders',
  riders: 'Riders',
  tracking: 'Riders',
  cash: 'COD cash',
  payouts: 'Rider payouts',
  settings: 'Store settings',
  customers: 'Customers',
  outlets: 'Outlets',
  documents: 'Outlet documents',
  coupons: 'Coupons',
  ads: 'Advertising',
  content: 'Homepage content',
  categories: 'Categories',
  payments: 'Payments',
  products: 'Products',
  images: 'Images',
  orders: 'Orders',
};
const verbs: Record<string, { text: string; tone: string }> = {
  POST: { text: 'Added', tone: 'success' },
  PUT: { text: 'Saved', tone: 'info' },
  PATCH: { text: 'Changed', tone: 'info' },
  DELETE: { text: 'Deleted', tone: 'danger' },
};
const isId = (s: string) => /^[0-9a-f-]{16,}$/i.test(s) || /\d/.test(s);
/** Turns a logged address such as /admin/records/coupons/abc into "Coupons". */
function describe(e: Entry) {
  const parts = e.target.split('/').filter(Boolean);
  const key = parts[0] === 'admin' ? (parts[1] === 'records' ? parts[2] : parts[1]) : parts[0] === 'manage' ? parts[1] : parts[0];
  // A trailing word that is not an id names the step, e.g. "status" or "sign-out".
  const last = parts[parts.length - 1];
  const step = parts.length > 2 && last !== key && !isId(last) ? label(last.replaceAll('-', '_')) : '';
  return { key: key || 'other', area: areas[key] || label((key || 'other').replaceAll('-', '_')), step };
}

export function AuditLog() {
  const { range, setRange, query, key, label: rangeText } = useRange('7d');
  const { data, error, loading, refresh } = useData<Entry[]>('/admin/audit' + query, 30000, 'audit:' + key);
  const rows = data || [];
  const statsBusy = loading && !data;
  const people = [...new Map(rows.map((r) => [r.user_id || '', r.name || 'Deleted administrator'])).entries()];
  const byArea = new Map<string, number>();
  for (const r of rows) byArea.set(describe(r).area, (byArea.get(describe(r).area) || 0) + 1);
  const busiest = [...byArea.entries()].sort((a, b) => b[1] - a[1])[0];
  function download() {
    const cell = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    const lines = [
      ['Time', 'Administrator', 'Email', 'Action', 'Area', 'Address'].join(','),
      ...rows.map((r) =>
        [new Date(r.created_at).toISOString(), r.name || 'Deleted administrator', r.email || '', verbs[r.action]?.text || r.action, describe(r).area, r.target]
          .map(cell)
          .join(','),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'activity-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="stack">
      <FilterBar title="Activity log" hint={`Changes made ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Activity size={20} />}
          label="Changes"
          value={rows.length === 1000 ? '1,000+' : rows.length}
          hint={rows.length === 1000 ? 'Showing the latest 1,000' : 'Saved by administrators'}
          tone="blue"
          loading={statsBusy}
        />
        <Stat icon={<Users size={20} />} label="Administrators active" value={people.length} hint="Made at least one change" tone="green" loading={statsBusy} />
        <Stat
          icon={<Trash2 size={20} />}
          label="Deletions"
          value={rows.filter((r) => r.action === 'DELETE').length}
          hint="Records removed"
          tone="orange"
          quiet={!rows.some((r) => r.action === 'DELETE')}
          loading={statsBusy}
        />
        <Stat
          icon={<History size={20} />}
          label="Busiest area"
          value={busiest?.[0] || '—'}
          hint={busiest ? `${busiest[1]} change${busiest[1] === 1 ? '' : 's'}` : 'Nothing changed'}
          tone="purple"
          quiet={!busiest}
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(r) => r.id}
        pageSize={20}
        search={(r) => `${r.name || ''} ${r.email || ''} ${describe(r).area} ${r.target}`}
        searchPlaceholder="Search administrator or area"
        empty="Nothing was changed in this period."
        toolbar={
          <button className="button ghost" onClick={download} disabled={!rows.length}>
            <Download size={16} /> Export CSV
          </button>
        }
        filters={[
          {
            key: 'action',
            label: 'Actions',
            options: Object.entries(verbs).map(([value, v]) => ({ value, label: v.text })),
            test: (r, v) => r.action === v,
          },
          {
            key: 'area',
            label: 'Areas',
            options: [...byArea.keys()].sort().map((a) => ({ value: a, label: a })),
            test: (r, v) => describe(r).area === v,
          },
          {
            key: 'who',
            label: 'Administrators',
            options: people.map(([id, name]) => ({ value: id, label: name })),
            test: (r, v) => (r.user_id || '') === v,
          },
        ]}
        columns={[
          {
            key: 'who',
            header: 'Administrator',
            sort: (r) => (r.name || '').toLowerCase(),
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.name || <span className="muted">Deleted administrator</span>}</strong>
                {r.email && <small>{r.email}</small>}
              </span>
            ),
          },
          {
            key: 'action',
            header: 'Action',
            render: (r) => <Badge tone={verbs[r.action]?.tone || 'neutral'}>{verbs[r.action]?.text || r.action}</Badge>,
          },
          {
            key: 'area',
            header: 'Area',
            sort: (r) => describe(r).area,
            render: (r) => {
              const d = describe(r);
              return (
                <span className="cell-stack">
                  <span>{d.area}</span>
                  {d.step && <small>{d.step}</small>}
                </span>
              );
            },
          },
          { key: 'target', header: 'Address', render: (r) => <code className="truncate wide">{r.target}</code> },
          {
            key: 'time',
            header: 'Time',
            sort: (r) => r.created_at,
            render: (r) => <span title={ago(r.created_at)}>{date(r.created_at)}</span>,
          },
        ]}
      />
    </div>
  );
}

/* ---------- Store settings ---------- */
type Settings = Record<string, any>;
const settingsDefaults: Settings = {
  name: 'Dellvit',
  tagline: '',
  support_email: '',
  support_phone: '',
  support_address: '',
  support_hours: '',
  whatsapp: '',
  facebook_url: '',
  instagram_url: '',
  tiktok_url: '',
  youtube_url: '',
  footer_note: '',
  about_title: 'Your neighbourhood, a little closer.',
  about_description: '',
  minimum_order: 0,
  checkout_enabled: true,
  checkout_message: '',
  notice_enabled: false,
  notice: '',
  signup_enabled: true,
  contact_form_enabled: true,
  chat_enabled: true,
  chat_greeting: '',
  show_trust: true,
  show_categories: true,
  show_nearby: true,
  show_category_products: true,
  show_outlets: true,
  show_how: true,
  show_why: true,
  show_ad: true,
  google_site_verification: '',
  bing_site_verification: '',
  google_analytics_id: '',
  google_tag_manager_id: '',
  facebook_pixel_id: '',
  custom_head_code: '',
  search_indexing: true,
  site_url: '',
  sitemap_enabled: true,
  sitemap_pages: true,
  sitemap_outlets: true,
  sitemap_products: true,
  sitemap_categories: true,
  sitemap_images: true,
  sitemap_frequency: 'daily',
  maintenance_enabled: false,
  maintenance_title: '',
  maintenance_message: '',
  maintenance_until: '',
  maintenance_show_contact: true,
};
function Section({ id, icon, title, hint, children }: { id: string; icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="card settings-section" id={'settings-' + id}>
      <div className="settings-section-head">
        <span className="n-icon order">{icon}</span>
        <div>
          <h3>{title}</h3>
          <small className="muted">{hint}</small>
        </div>
      </div>
      {children}
    </section>
  );
}
const settingsTabs = [
  ['store', 'Store', Store],
  ['contact', 'Contact', Phone],
  ['social', 'Social', Globe],
  ['orders', 'Orders', ShoppingCart],
  ['notice', 'Notice bar', Megaphone],
  ['access', 'Customer access', BadgeCheck],
  ['home', 'Home page', LayoutPanelTop],
  ['tracking', 'SEO and analytics', ChartLine],
  ['sitemap', 'Sitemap', ListTree],
  ['maintenance', 'Maintenance', Wrench],
  ['email', 'Email', Mail],
] as const;
type SettingsTab = (typeof settingsTabs)[number][0];
const isSettingsTab = (v: string): v is SettingsTab => settingsTabs.some(([id]) => id === v);
/** The tab holding a setting, so a save the server rejects opens the field it is about. */
function tabOf(field: string): SettingsTab | null {
  if (field.startsWith('maintenance_')) return 'maintenance';
  if (field.startsWith('sitemap_') || field === 'search_indexing' || field === 'site_url') return 'sitemap';
  if (field.startsWith('show_')) return 'home';
  const tabs: Record<string, SettingsTab> = {
    name: 'store',
    tagline: 'store',
    about_title: 'store',
    about_description: 'store',
    support_email: 'contact',
    support_phone: 'contact',
    support_address: 'contact',
    support_hours: 'contact',
    whatsapp: 'contact',
    footer_note: 'social',
    checkout_enabled: 'orders',
    checkout_message: 'orders',
    minimum_order: 'orders',
    notice_enabled: 'notice',
    notice: 'notice',
    signup_enabled: 'access',
    contact_form_enabled: 'access',
    chat_enabled: 'access',
    chat_greeting: 'access',
  };
  if (field.endsWith('_url') && field !== 'site_url') return 'social';
  if (/^(google|bing|facebook_pixel|custom_head)/.test(field)) return 'tracking';
  return tabs[field] || null;
}
/** A saved ISO time as the value a datetime-local field expects, in the admin's own time zone. */
const localInput = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
type SitemapPreview = {
  indexing: boolean;
  enabled: boolean;
  pages: boolean;
  outlets: unknown[];
  products: unknown[];
  categories: unknown[];
};
/** What the live sitemap.xml lists right now, from the last saved settings. */
function SitemapStatus({ version }: { version: number }) {
  const { notice } = useApp();
  const { data, loading } = useData<SitemapPreview>('/site/sitemap?v=' + version);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const links = data?.enabled ? 1 + (data.pages ? 4 : 0) + data.categories.length + data.outlets.length + data.products.length : 0;
  return (
    <section className="card settings-section">
      <div className="settings-section-head">
        <span className="n-icon order">
          <ListTree size={16} />
        </span>
        <div>
          <h3>Your sitemap now</h3>
          <small className="muted">Updates by itself within about a minute when outlets and products are added, changed or hidden</small>
        </div>
      </div>
      {loading && !data ? (
        <Loading />
      ) : !data ? (
        <ErrorBox error="The sitemap details could not load." />
      ) : (
        <>
          {!data.indexing ? (
            <div className="alert warn">Search engines are asked to stay away from the store, so no sitemap is published.</div>
          ) : (
            !data.enabled && <div className="alert warn">The sitemap is switched off.</div>
          )}
          <div className="sitemap-status">
            <div>
              <b>{links.toLocaleString('en-PK')}</b>
              <small>Links in total</small>
            </div>
            <div>
              <b>{data.outlets.length.toLocaleString('en-PK')}</b>
              <small>Outlets</small>
            </div>
            <div>
              <b>{data.products.length.toLocaleString('en-PK')}</b>
              <small>Products</small>
            </div>
            <div>
              <b>{data.categories.length.toLocaleString('en-PK')}</b>
              <small>Categories</small>
            </div>
          </div>
        </>
      )}
      <div className="settings-links">
        <a className="button ghost" href="/sitemap.xml" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={15} /> Open sitemap.xml
        </a>
        <a className="button ghost" href="/robots.txt" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={15} /> Open robots.txt
        </a>
        <button
          type="button"
          className="button ghost"
          onClick={() =>
            navigator.clipboard
              .writeText(origin + '/sitemap.xml')
              .then(() => notice('Sitemap address copied.'))
              .catch(() => notice('Copy failed. The address is ' + origin + '/sitemap.xml'))
          }
        >
          <Copy size={15} /> Copy address
        </button>
      </div>
      <small className="muted">
        Submit <b>{origin}/sitemap.xml</b> once in Google Search Console → Sitemaps (and Bing Webmaster Tools). After that, search
        engines read the new version by themselves.
      </small>
    </section>
  );
}

export function SettingsManager() {
  const { notice } = useApp();
  const { data, loading, error, refresh } = useData<Settings[]>('/admin/records/settings');
  const { data: email } = useData<{ source: string }>('/admin/email-settings');
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [tab, setTabState] = useState<SettingsTab>('store');
  const [sitemapVersion, setSitemapVersion] = useState(0);
  const [preview, setPreview] = useState(false);
  // The open tab is kept in the address (#sitemap), so a reload or a shared link opens it again.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (isSettingsTab(h)) setTabState(h);
  }, []);
  const setTab = (t: SettingsTab) => {
    setTabState(t);
    window.history.replaceState(null, '', '#' + t);
  };
  useEffect(() => {
    if (!data) return;
    const next = { ...settingsDefaults, ...(data.find((d) => d.id === 'global') || {}) };
    setForm(next);
    setSaved(JSON.stringify(next));
  }, [data]);
  if (loading && !form) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refresh} />;
  if (!form) return null;
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });
  const text = (k: string, extra: Record<string, unknown> = {}) => ({
    value: form[k] ?? '',
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
    ...extra,
  });
  const dirty = JSON.stringify(form) !== saved;
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const { id, ...body } = form!;
      await api('/admin/records/settings/global', { method: 'PUT', body: JSON.stringify({ ...body, active: true, position: 0 }) });
      refresh();
      setSitemapVersion(Date.now());
      notice('Settings saved.');
    } catch (err) {
      const message = (err as Error).message;
      const field = tabOf(/^(\w+):/.exec(message)?.[1] || '');
      if (field) setTab(field);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }
  const on = (v: unknown) => v !== false;
  return (
    <div className="stack">
      <div className="stats">
        <Stat
          icon={<ShoppingCart size={20} />}
          label="Ordering"
          value={form.maintenance_enabled ? 'Maintenance' : on(form.checkout_enabled) ? 'Open' : 'Paused'}
          hint={form.minimum_order ? `Minimum PKR ${(form.minimum_order / 100).toLocaleString('en-PK')}` : 'No store-wide minimum'}
          tone={on(form.checkout_enabled) && !form.maintenance_enabled ? 'green' : 'orange'}
        />
        <Stat
          icon={<UserPlus size={20} />}
          label="New sign-ups"
          value={on(form.signup_enabled) ? 'Allowed' : 'Closed'}
          hint="Customer registration"
          tone={on(form.signup_enabled) ? 'blue' : 'orange'}
        />
        <Stat
          icon={<Headphones size={20} />}
          label="Support chat"
          value={on(form.chat_enabled) ? 'On' : 'Off'}
          hint={on(form.contact_form_enabled) ? 'Contact form is on' : 'Contact form is off'}
          tone={on(form.chat_enabled) ? 'purple' : 'orange'}
        />
        <Stat
          icon={<KeyRound size={20} />}
          label="Email"
          value={!email ? '…' : email.source === 'none' ? 'Not set up' : 'Ready'}
          hint="Sends verification codes"
          tone={email?.source === 'none' ? 'orange' : 'green'}
        />
      </div>
      <div className="seg-tabs settings-tabs" role="tablist" aria-label="Settings">
        {settingsTabs.map(([id, title, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={15} /> {title}
            {id === 'maintenance' && form.maintenance_enabled && <span className="tab-count">On</span>}
          </button>
        ))}
      </div>
      <form id="settings-form" className="stack settings-panel" onSubmit={save}>
          {tab === 'store' && (
          <Section id="store" icon={<Store size={16} />} title="Store" hint="Your name and the About page">
            <div className="form-grid">
              <label>
                Store name
                <input required maxLength={200} {...text('name')} />
              </label>
              <label>
                Tagline <span className="muted">(optional)</span>
                <input maxLength={120} {...text('tagline')} placeholder="Everything you need, delivered fast." />
                <small>Shown in the footer under your logo.</small>
              </label>
              <label className="span-2">
                About page headline
                <input required maxLength={200} {...text('about_title')} />
              </label>
              <label className="span-2">
                About page text
                <textarea rows={4} maxLength={4000} {...text('about_description')} />
              </label>
            </div>
          </Section>
          )}
          {tab === 'contact' && (
          <Section id="contact" icon={<Phone size={16} />} title="Contact and support" hint="Shown in the footer and on the contact page">
            <div className="form-grid">
              <label>
                Support email
                <input required type="email" {...text('support_email')} />
              </label>
              <label>
                Support phone
                <input required type="tel" {...text('support_phone')} />
              </label>
              <label>
                WhatsApp number <span className="muted">(optional)</span>
                <input type="tel" maxLength={20} {...text('whatsapp')} placeholder="+92 300 1234567" />
                <small>Adds a “Chat on WhatsApp” link.</small>
              </label>
              <label>
                Support hours <span className="muted">(optional)</span>
                <input maxLength={120} {...text('support_hours')} placeholder="Every day, 9 am – 11 pm" />
              </label>
              <label className="span-2">
                Address
                <input maxLength={500} {...text('support_address')} />
              </label>
            </div>
          </Section>
          )}
          {tab === 'social' && (
          <Section id="social" icon={<Globe size={16} />} title="Social links and footer" hint="Leave a link empty to hide it">
            <div className="form-grid">
              {(
                [
                  ['facebook_url', 'Facebook', 'https://facebook.com/yourpage'],
                  ['instagram_url', 'Instagram', 'https://instagram.com/yourpage'],
                  ['tiktok_url', 'TikTok', 'https://tiktok.com/@yourpage'],
                  ['youtube_url', 'YouTube', 'https://youtube.com/@yourchannel'],
                ] as const
              ).map(([k, title, placeholder]) => (
                <label key={k}>
                  {title}
                  <input type="url" maxLength={300} pattern="https://.+" title="A full https:// address" {...text(k)} placeholder={placeholder} />
                </label>
              ))}
              <label className="span-2">
                Footer note <span className="muted">(optional)</span>
                <input maxLength={200} {...text('footer_note')} placeholder="e.g. Delivering across Rawalpindi and Islamabad." />
              </label>
            </div>
          </Section>
          )}
          {tab === 'orders' && (
          <Section id="orders" icon={<ShoppingCart size={16} />} title="Orders and checkout" hint="Applies to every outlet and area">
            <div className="stack">
              <Toggle checked={on(form.checkout_enabled)} onChange={(v) => set('checkout_enabled', v)} label="Accept new orders" />
              <label>
                Message while ordering is paused
                <input maxLength={300} {...text('checkout_message')} placeholder="Ordering is temporarily paused. Please try again later." />
                <small>Customers read this at checkout when new orders are switched off.</small>
              </label>
              <label>
                Minimum order subtotal (PKR)
                <input
                  type="number"
                  min={0}
                  value={form.minimum_order ? form.minimum_order / 100 : ''}
                  onChange={(e) => set('minimum_order', Math.round(Number(e.target.value) * 100) || 0)}
                  placeholder="No minimum"
                />
                <small>Outlets and delivery areas can ask for more on their own pages.</small>
              </label>
            </div>
          </Section>
          )}
          {tab === 'notice' && (
          <Section id="notice" icon={<Megaphone size={16} />} title="Notice bar" hint="One line across the top of every store page">
            <div className="stack">
              <Toggle checked={!!form.notice_enabled} onChange={(v) => set('notice_enabled', v)} label="Show the notice bar" />
              <label>
                Notice text
                <input maxLength={200} required={!!form.notice_enabled} {...text('notice')} placeholder="e.g. We are closed on Eid day. Orders resume on Tuesday." />
              </label>
              {form.notice_enabled && form.notice && (
                <div className="site-notice preview">
                  <Megaphone size={14} /> {form.notice}
                </div>
              )}
            </div>
          </Section>
          )}
          {tab === 'access' && (
          <Section id="access" icon={<BadgeCheck size={16} />} title="Customer access" hint="What visitors and customers can use">
            <div className="stack">
              <div className="toggle-list">
                <Toggle checked={on(form.signup_enabled)} onChange={(v) => set('signup_enabled', v)} label="Allow new customers to create accounts" />
                <Toggle checked={on(form.contact_form_enabled)} onChange={(v) => set('contact_form_enabled', v)} label="Contact form on the contact page" />
                <Toggle
                  checked={on(form.chat_enabled)}
                  onChange={(v) => set('chat_enabled', v)}
                  label="Support chat for signed-in customers, outlets and riders"
                />
              </div>
              <label>
                Chat welcome line <span className="muted">(optional)</span>
                <input maxLength={300} disabled={!on(form.chat_enabled)} {...text('chat_greeting')} placeholder="Ask us anything. We usually reply within a few minutes." />
              </label>
              <small className="muted">
                With chat off, customers cannot send new messages; your team can still reply to open conversations. Existing
                customers can always sign in.
              </small>
            </div>
          </Section>
          )}
          {tab === 'home' && (
          <Section id="home" icon={<LayoutPanelTop size={16} />} title="Home page sections" hint="The built-in parts of the home page">
            <div className="toggle-list">
              {[
                ['show_trust', 'Benefits bar'],
                ['show_categories', 'Category shortcuts'],
                ['show_nearby', 'Good things near you'],
                ['show_category_products', 'Category product sections'],
                ['show_outlets', 'Outlets near you'],
                ['show_how', 'How it works'],
                ['show_ad', 'Advertising (all ads, on every page)'],
              ].map(([k, title]) => (
                <Toggle key={k} checked={on(form[k])} onChange={(v) => set(k, v)} label={title} />
              ))}
            </div>
            <small className="muted">
              Your own sections, banners and videos are managed in <a href="/admin?tab=content">Homepage content</a>.
            </small>
          </Section>
          )}
          {tab === 'tracking' && (
          <Section
            id="tracking"
            icon={<ChartLine size={16} />}
            title="SEO and analytics"
            hint="Verification tags and tracking codes added to every page"
          >
            <div className="form-grid">
              <label>
                Google Search Console code <span className="muted">(optional)</span>
                <input maxLength={300} {...text('google_site_verification')} placeholder='<meta name="google-site-verification" …>' />
                <small>In Search Console choose “HTML tag”, then paste the whole tag or only its code.</small>
              </label>
              <label>
                Bing Webmaster code <span className="muted">(optional)</span>
                <input maxLength={300} {...text('bing_site_verification')} placeholder='<meta name="msvalidate.01" …>' />
                <small>Paste the whole tag or only its code.</small>
              </label>
              <label>
                Google Analytics ID <span className="muted">(optional)</span>
                <input maxLength={2000} {...text('google_analytics_id')} placeholder="G-XXXXXXXXXX" />
                <small>The Measurement ID from Analytics → Admin → Data streams.</small>
              </label>
              <label>
                Google Tag Manager ID <span className="muted">(optional)</span>
                <input maxLength={2000} {...text('google_tag_manager_id')} placeholder="GTM-XXXXXXX" />
                <small>Leave Analytics empty if Tag Manager already loads it.</small>
              </label>
              <label>
                Meta (Facebook) Pixel ID <span className="muted">(optional)</span>
                <input maxLength={2000} {...text('facebook_pixel_id')} placeholder="123456789012345" />
                <small>From Events Manager. Page views are counted automatically.</small>
              </label>
              <label className="span-2">
                Custom head code <span className="muted">(optional)</span>
                <textarea
                  rows={6}
                  maxLength={20000}
                  className="mono"
                  spellCheck={false}
                  {...text('custom_head_code')}
                  placeholder={'<meta name="facebook-domain-verification" content="…" />\n<script async src="https://…"></script>'}
                />
                <small>
                  For any other service. Added to the &lt;head&gt; of every page; &lt;meta&gt;, &lt;link&gt;, &lt;script&gt;,
                  &lt;style&gt; and &lt;noscript&gt; tags are used and anything else is skipped. Only paste code from
                  services you trust: it runs on every page, including checkout and this admin panel.
                </small>
              </label>
            </div>
            <small className="muted">Saved changes reach the website within about a minute.</small>
          </Section>
          )}
          {tab === 'sitemap' && (
            <>
              <Section id="sitemap" icon={<ListTree size={16} />} title="Sitemap and search engines" hint="sitemap.xml and robots.txt are built from your live store">
                <div className="toggle-list">
                  <Toggle checked={on(form.search_indexing)} onChange={(v) => set('search_indexing', v)} label="Let search engines show the store in their results" />
                  <Toggle
                    checked={on(form.sitemap_enabled)}
                    disabled={!on(form.search_indexing)}
                    onChange={(v) => set('sitemap_enabled', v)}
                    label="Publish sitemap.xml"
                  />
                </div>
                {!on(form.search_indexing) && (
                  <div className="alert warn">
                    robots.txt will ask every search engine to stay away and pages are marked “noindex”. The store slowly drops out of
                    Google.
                  </div>
                )}
                <div className="form-grid">
                  <label>
                    Website address <span className="muted">(optional)</span>
                    <input type="url" maxLength={300} pattern="https://.+" title="A full https:// address" {...text('site_url')} placeholder={typeof window === 'undefined' ? '' : window.location.origin} />
                    <small>Used in sitemap links. Leave empty to use the address the website runs on.</small>
                  </label>
                  <label>
                    How often your menu changes
                    <select value={form.sitemap_frequency} onChange={(e) => set('sitemap_frequency', e.target.value)}>
                      <option value="hourly">Every hour</option>
                      <option value="daily">Every day</option>
                      <option value="weekly">Every week</option>
                      <option value="monthly">Every month</option>
                    </select>
                    <small>A hint for search engines about how often to come back.</small>
                  </label>
                </div>
                <div className="stack">
                  <small className="muted">What the sitemap lists</small>
                  <div className="toggle-list">
                    {[
                      ['sitemap_pages', 'Main pages: Explore, Outlets, About and Contact'],
                      ['sitemap_outlets', 'Every open outlet'],
                      ['sitemap_products', 'Every product on sale'],
                      ['sitemap_categories', 'Category pages'],
                      ['sitemap_images', 'Product and outlet photos (for Google Images)'],
                    ].map(([k, title]) => (
                      <Toggle key={k} checked={on(form[k])} disabled={!on(form.search_indexing) || !on(form.sitemap_enabled)} onChange={(v) => set(k, v)} label={title} />
                    ))}
                  </div>
                  <small className="muted">Hidden, closed and deleted outlets and products are never listed. Private pages such as checkout, orders and this dashboard are kept out of search engines.</small>
                </div>
              </Section>
              <SitemapStatus version={sitemapVersion} />
            </>
          )}
          {tab === 'maintenance' && (
            <Section id="maintenance" icon={<Wrench size={16} />} title="Maintenance mode" hint="Close the store for everyone except administrators">
              <Toggle checked={!!form.maintenance_enabled} onChange={(v) => set('maintenance_enabled', v)} label="Put the store under maintenance" />
              <div className={'alert ' + (form.maintenance_enabled ? 'warn' : 'info')}>
                While this is on, customers, outlets and riders, on the website and in the app, see only the maintenance page and
                cannot order or sign in. This dashboard and the administrator sign-in page at <b>/admin/login</b> keep working.
              </div>
              <div className="form-grid">
                <label className="span-2">
                  Heading <span className="muted">(optional)</span>
                  <input maxLength={120} {...text('maintenance_title')} placeholder="We’ll be back soon" />
                </label>
                <label className="span-2">
                  Message <span className="muted">(optional)</span>
                  <textarea
                    rows={3}
                    maxLength={600}
                    {...text('maintenance_message')}
                    placeholder={(form.name || 'Dellvit') + ' is getting a few improvements. Ordering is paused for a short while. Thank you for your patience!'}
                  />
                </label>
                <label>
                  Expected back <span className="muted">(optional)</span>
                  <input
                    type="datetime-local"
                    value={localInput(form.maintenance_until || '')}
                    onChange={(e) => set('maintenance_until', e.target.value ? new Date(e.target.value).toISOString() : '')}
                  />
                  <small>Shows a countdown on the page.</small>
                </label>
                <div className="stack">
                  <Toggle checked={on(form.maintenance_show_contact)} onChange={(v) => set('maintenance_show_contact', v)} label="Show support email, phone and WhatsApp" />
                </div>
              </div>
              <div className="settings-links">
                <button type="button" className="button ghost" onClick={() => setPreview(true)}>
                  <Eye size={15} /> Preview the page
                </button>
              </div>
              <Modal open={preview} onClose={() => setPreview(false)} title="Maintenance page preview" size="lg">
                {preview && (
                  <MaintenancePage
                    preview
                    info={{
                      name: form.name || 'Dellvit',
                      title: form.maintenance_title,
                      message: form.maintenance_message,
                      until: form.maintenance_until,
                      ...(on(form.maintenance_show_contact)
                        ? { email: form.support_email, phone: form.support_phone, whatsapp: form.whatsapp, facebook_url: form.facebook_url, instagram_url: form.instagram_url }
                        : {}),
                    }}
                  />
                )}
              </Modal>
            </Section>
          )}
        {formError && <ErrorBox error={formError} />}
      </form>
      {tab === 'email' && (
        <div id="settings-email">
          <EmailSettings />
        </div>
      )}
      {(tab !== 'email' || dirty) && (
        <div className={'form-foot sticky-foot' + (dirty ? ' dirty' : '')}>
          {dirty && <small className="muted">You have unsaved changes.</small>}
          {dirty && (
            <button type="button" className="button ghost" disabled={busy} onClick={() => setForm(JSON.parse(saved))}>
              Discard
            </button>
          )}
          <button form="settings-form" className="button" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
}
