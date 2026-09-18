'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ArchiveRestore,
  Archive,
  Banknote,
  Bike,
  ClipboardList,
  HandCoins,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Megaphone,
  Package,
  Plus,
  Reply,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tags,
  Ticket,
  Trash2,
  Truck,
  Upload,
  UserRound,
  Users,
  Wallet,
  X,
  History,
  Layers,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, date } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Product, Outlet, User, Ad, Location } from '@/lib/types';
import {
  Badge,
  Confirm,
  DataTable,
  Empty,
  ErrorBox,
  IconAction,
  Loading,
  Modal,
  Toggle,
} from './UI';
import { NotificationBell } from './Notifications';
import {
  RecordManager,
  SettingsManager,
  PaymentsWorkspace,
  StaffManager,
  FleetManager,
  RiderTools,
  CustomerDirectory,
  AuditLog,
  commissionText,
} from './Platform';
import { OrderDesk } from './OrderDesk';
import { AdminOverview, OutletDashboard } from './Dashboards';
import { AdminCash, AdminPayouts, RiderCash, RiderEarnings, RiderStatementModal } from './Finance';
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map…</div>,
});

type Nav = { key: string; title: string; icon: typeof Package; group: string; permission?: string };
const adminNav: Nav[] = [
  { key: 'overview', title: 'Dashboard', icon: LayoutDashboard, group: 'Main' },
  { key: 'orders', title: 'Orders', icon: ClipboardList, group: 'Main' },
  { key: 'payments', title: 'Payments', icon: CreditCard, group: 'Main' },
  { key: 'cash', title: 'COD cash', icon: HandCoins, group: 'Finance', permission: 'riders' },
  { key: 'payouts', title: 'Rider payouts', icon: Banknote, group: 'Finance', permission: 'riders' },
  { key: 'products', title: 'Products', icon: ShoppingBag, group: 'Catalog' },
  { key: 'categories', title: 'Categories', icon: Tags, group: 'Catalog' },
  { key: 'outlets', title: 'Outlets', icon: Store, group: 'Catalog' },
  { key: 'riders', title: 'Riders', icon: Bike, group: 'Operations' },
  { key: 'locations', title: 'Delivery areas', icon: MapPin, group: 'Operations' },
  { key: 'customers', title: 'Customers', icon: Users, group: 'Operations' },
  { key: 'content', title: 'Homepage content', icon: Layers, group: 'Marketing' },
  { key: 'ads', title: 'Advertising', icon: Megaphone, group: 'Marketing' },
  { key: 'coupons', title: 'Coupons', icon: Ticket, group: 'Marketing' },
  { key: 'messages', title: 'Messages', icon: Mail, group: 'Marketing' },
  { key: 'staff', title: 'Admin access', icon: ShieldCheck, group: 'System' },
  { key: 'audit', title: 'Activity log', icon: History, group: 'System' },
  { key: 'settings', title: 'Store settings', icon: Settings, group: 'System' },
];
const outletNav: Nav[] = [
  { key: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, group: 'Outlet' },
  { key: 'orders', title: 'Orders', icon: ClipboardList, group: 'Outlet' },
  { key: 'products', title: 'Products', icon: ShoppingBag, group: 'Outlet' },
];
const riderNav: Nav[] = [
  { key: 'orders', title: 'Deliveries', icon: Truck, group: 'Rider' },
  { key: 'cash', title: 'COD cash', icon: HandCoins, group: 'Rider' },
  { key: 'earnings', title: 'Earnings & payouts', icon: Wallet, group: 'Rider' },
];

export default function Portal({ role }: { role: 'admin' | 'outlet' | 'rider' }) {
  const { user, ready, logout } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  if (!ready) return <Loading />;
  if (!user)
    return (
      <div className="container page">
        <Empty
          title={role === 'admin' ? 'Administration' : role === 'outlet' ? 'Outlet portal' : 'Rider portal'}
          href={role === 'admin' ? '/admin/login' : '/login?next=' + encodeURIComponent('/portal/' + role)}
          action="Log in"
          icon={<ShieldCheck size={26} />}
        >
          Sign in with your {role === 'outlet' ? 'outlet ID' : role === 'rider' ? 'rider ID' : 'admin email'}.
        </Empty>
      </div>
    );
  if (user.role !== role)
    return (
      <div className="container page narrow">
        <ErrorBox error={`This portal is for ${role} accounts. You are signed in as ${user.role}.`} />
      </div>
    );
  const nav =
    role === 'admin'
      ? adminNav.filter(
          (x) => user.is_super_admin || (x.key !== 'staff' && user.permissions?.includes(x.permission || x.key)),
        )
      : role === 'outlet'
        ? outletNav
        : riderNav;
  const wanted = params.get('tab') || nav[0]?.key;
  const tab = nav.some((x) => x.key === wanted) ? wanted : nav[0]?.key;
  const current = nav.find((x) => x.key === tab);
  const go = (key: string) => {
    router.replace('?tab=' + key, { scroll: false });
    setDrawer(false);
  };
  const groups = [...new Set(nav.map((n) => n.group))];
  const sidebar = (
    <>
      <div className="side-brand">
        <Link href="/">
          <img src="/images/logo.webp" alt="Dellvit" width="92" height="52" />
        </Link>
        <span className="role-chip">
          {role === 'admin' ? (user.is_super_admin ? 'Super admin' : 'Admin') : role === 'outlet' ? 'Outlet' : 'Rider'}
        </span>
      </div>
      <nav className="side-nav" aria-label="Portal navigation">
        {groups.map((g) => (
          <div key={g} className="side-group">
            <span className="side-label">{g}</span>
            {nav
              .filter((n) => n.group === g)
              .map((n) => (
                <button key={n.key} className={tab === n.key ? 'active' : ''} onClick={() => go(n.key)}>
                  <n.icon size={18} />
                  {n.title}
                </button>
              ))}
          </div>
        ))}
        <div className="side-group">
          <span className="side-label">Account</span>
          <Link href="/account">
            <UserRound size={18} /> Profile
          </Link>
          <Link href="/notifications">
            <ExternalLink size={18} /> Notifications
          </Link>
        </div>
      </nav>
      <div className="side-foot">
        <div className="side-user">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <span>
            <strong>{user.name}</strong>
            <small>{user.login_id || user.email}</small>
          </span>
        </div>
        <button className="icon-action" title="Log out" aria-label="Log out" onClick={() => logout().then(() => router.push('/'))}>
          <LogOut size={17} />
        </button>
      </div>
    </>
  );
  return (
    <div className="portal">
      <aside className="sidebar">{sidebar}</aside>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(false)}>
          <aside className="sidebar drawer-side" onClick={(e) => e.stopPropagation()}>
            <button className="icon-action drawer-close" onClick={() => setDrawer(false)} aria-label="Close menu">
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="portal-main">
        <header className="topbar">
          <button className="header-icon mobile-only" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <small>{role === 'admin' ? 'Admin' : role === 'outlet' ? 'Outlet' : 'Rider'} portal</small>
            <h1>{current?.title || 'Workspace'}</h1>
          </div>
          <div className="topbar-actions">
            <Link href="/" className="button ghost small hide-sm">
              <Store size={15} /> View store
            </Link>
            <NotificationBell />
          </div>
        </header>
        <div className="portal-content">
          {!tab ? (
            <Empty title="No modules assigned">Ask your super administrator for access.</Empty>
          ) : tab === 'overview' ? (
            <AdminOverview go={go} />
          ) : tab === 'dashboard' ? (
            <OutletDashboard go={go} />
          ) : tab === 'orders' ? (
            <>
              {role === 'rider' && <RiderTools />}
              <OrderDesk key={role} role={role} />
            </>
          ) : tab === 'cash' ? (
            role === 'rider' ? <RiderCash /> : <AdminCash />
          ) : tab === 'payouts' ? (
            <AdminPayouts />
          ) : tab === 'earnings' ? (
            <RiderEarnings />
          ) : tab === 'payments' ? (
            <PaymentsWorkspace />
          ) : tab === 'products' ? (
            <ProductManager admin={role === 'admin'} />
          ) : tab === 'outlets' ? (
            <OutletManager />
          ) : tab === 'riders' ? (
            <RiderManager />
          ) : tab === 'locations' ? (
            <LocationManager />
          ) : tab === 'ads' ? (
            <AdManager />
          ) : tab === 'messages' ? (
            <Messages />
          ) : tab === 'staff' ? (
            <StaffManager />
          ) : tab === 'customers' ? (
            <CustomerDirectory />
          ) : tab === 'audit' ? (
            <AuditLog />
          ) : tab === 'settings' ? (
            <SettingsManager />
          ) : (
            <RecordManager key={tab} kind={tab} />
          )}
        </div>
      </div>
    </div>
  );
}

export function ImageUpload({
  value,
  onChange,
  multiple = false,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  multiple?: boolean;
}) {
  const { notice } = useApp();
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const r = await api<{ url: string }>('/manage/images', { method: 'POST', body: data });
      onChange(multiple ? [...value, r.url].slice(-6) : [r.url]);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="image-upload">
      {value.map((url, i) => (
        <div className="upload-preview" key={url + i}>
          <img src={url} alt={'Image ' + (i + 1)} />
          {(multiple ? value.length > 1 : true) && (
            <button type="button" onClick={() => onChange(value.filter((_, j) => i !== j))} aria-label={'Remove image ' + (i + 1)}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      {(multiple || !value.length) && (
        <label className="upload-tile">
          <Upload size={18} />
          <span>{busy ? 'Uploading…' : 'Upload'}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) upload(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

function FormModal({
  open,
  title,
  onClose,
  onSubmit,
  busy,
  error,
  children,
  submit = 'Save',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  error?: string;
  children: ReactNode;
  submit?: string;
}) {
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} size="lg">
      <form className="stack" onSubmit={onSubmit}>
        {children}
        {error && <ErrorBox error={error} />}
        <div className="form-foot">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy}>
            {busy ? 'Saving…' : submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const newProduct = {
  name: '',
  description: '',
  category: '',
  price: 0,
  stock: 0,
  unit: '1 item',
  location_id: '',
  discount: 0,
  deal: '',
  images: [] as string[],
  includes: '',
  excludes: '',
  delivery_minutes: 30,
  outlet_id: '',
  active: 1,
};
function ProductManager({ admin }: { admin: boolean }) {
  const { data: categories } = useData<{ name: string }[]>('/categories');
  const { locations, notice } = useApp();
  const { data, loading, error, refresh } = useData<Product[]>('/manage/products');
  const { data: outlets } = useData<Outlet[]>(admin ? '/manage/product-outlets' : null);
  const { data: own } = useData<Outlet>(!admin ? '/manage/outlet' : null);
  const [edit, setEdit] = useState<(typeof newProduct & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  function start(p?: Product) {
    setFormError('');
    setEdit(
      p
        ? { ...p, price: p.price / 100 }
        : {
            ...newProduct,
            category: categories?.[0]?.name || '',
            location_id: own?.location_id || locations[0]?.id || '',
            outlet_id: own?.id || outlets?.[0]?.id || '',
          },
    );
  }
  async function persist(p: typeof newProduct & { id?: string }, message: string) {
    await api('/manage/products' + (p.id ? '/' + p.id : ''), {
      method: p.id ? 'PUT' : 'POST',
      body: JSON.stringify({ ...p, price: Math.round(p.price * 100) }),
    });
    refresh();
    notice(message);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await persist(edit, 'Product saved.');
      setEdit(null);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(p) => p.id}
        search={(p) => `${p.name} ${p.outlet_name} ${p.category}`}
        searchPlaceholder="Search products"
        empty="No products yet. Add your first product."
        toolbar={
          <button className="button" onClick={() => start()}>
            <Plus size={16} /> Add product
          </button>
        }
        filters={[
          {
            key: 'category',
            label: 'Categories',
            options: (categories || []).map((c) => ({ value: c.name, label: c.name })),
            test: (p, v) => p.category === v,
          },
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'listed', label: 'Listed' },
              { value: 'archived', label: 'Archived' },
            ],
            test: (p, v) => (v === 'listed' ? !!p.active : !p.active),
          },
          {
            key: 'stock',
            label: 'Stock levels',
            options: [
              { value: 'out', label: 'Out of stock' },
              { value: 'low', label: 'Low (under 10)' },
              { value: 'in', label: 'In stock' },
            ],
            test: (p, v) => (v === 'out' ? p.stock === 0 : v === 'low' ? p.stock > 0 && p.stock < 10 : p.stock > 0),
          },
          ...(admin
            ? [
                {
                  key: 'outlet',
                  label: 'Outlets',
                  options: (outlets || []).map((o) => ({ value: o.id, label: o.name })),
                  test: (p: Product, v: string) => p.outlet_id === v,
                },
              ]
            : []),
        ]}
        columns={[
          {
            key: 'name',
            header: 'Product',
            sort: (p) => p.name.toLowerCase(),
            render: (p) => (
              <div className="cell-main">
                <img className="cell-thumb" src={p.images[0]} alt="" />
                <span className="cell-stack">
                  <strong>{p.name}</strong>
                  <small>
                    {p.category} · {p.unit}
                  </small>
                </span>
              </div>
            ),
          },
          ...(admin ? [{ key: 'outlet', header: 'Outlet', render: (p: Product) => p.outlet_name }] : []),
          { key: 'area', header: 'Area', render: (p) => locations.find((l) => l.id === p.location_id)?.name || '—' },
          {
            key: 'price',
            header: 'Price',
            sort: (p) => p.effective_price,
            render: (p) => (
              <span className="cell-stack">
                <strong>{money(p.effective_price)}</strong>
                {p.discount > 0 && <small className="success-text">{p.discount}% off</small>}
              </span>
            ),
          },
          {
            key: 'stock',
            header: 'Stock',
            sort: (p) => p.stock,
            render: (p) => <Badge tone={p.stock === 0 ? 'danger' : p.stock < 10 ? 'warn' : 'success'}>{p.stock}</Badge>,
          },
          {
            key: 'active',
            header: 'Listed',
            render: (p) => (
              <Toggle
                checked={!!p.active}
                onChange={(v) =>
                  persist({ ...p, price: p.price / 100, active: v ? 1 : 0 }, v ? 'Product listed.' : 'Product archived.').catch((e) =>
                    notice(e.message),
                  )
                }
              />
            ),
          },
        ]}
        actions={(p) => (
          <>
            <IconAction label="Edit" onClick={() => start(p)}>
              <Edit3 size={16} />
            </IconAction>
            {p.active ? (
              <IconAction label="View in store" href={'/products/' + p.id}>
                <ExternalLink size={16} />
              </IconAction>
            ) : null}
            <IconAction
              label={p.active ? 'Archive' : 'Restore'}
              tone={p.active ? 'danger' : 'success'}
              onClick={() =>
                persist({ ...p, price: p.price / 100, active: p.active ? 0 : 1 }, p.active ? 'Product archived.' : 'Product restored.').catch(
                  (e) => notice(e.message),
                )
              }
            >
              {p.active ? <Archive size={16} /> : <ArchiveRestore size={16} />}
            </IconAction>
          </>
        )}
      />
      <FormModal
        open={!!edit}
        title={edit?.id ? 'Edit product' : 'Add product'}
        onClose={() => setEdit(null)}
        onSubmit={save}
        busy={busy}
        error={formError}
        submit="Save product"
      >
        {edit && (
          <>
            <div className="field">
              <span className="field-label">Images (up to 6)</span>
              <ImageUpload value={edit.images} onChange={(images) => set('images', images)} multiple />
            </div>
            <div className="form-grid">
              <label className="span-2">
                Product name
                <input required value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label className="span-2">
                Description
                <textarea required rows={3} value={edit.description} onChange={(e) => set('description', e.target.value)} />
              </label>
              {admin && (
                <label>
                  Outlet
                  <select required value={edit.outlet_id} onChange={(e) => set('outlet_id', e.target.value)}>
                    {outlets?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Delivery area
                <select required value={edit.location_id} onChange={(e) => set('location_id', e.target.value)}>
                  {locations.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select value={edit.category} onChange={(e) => set('category', e.target.value)}>
                  {(categories || []).map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Price (PKR)
                <input required type="number" min="1" step="0.01" value={edit.price} onChange={(e) => set('price', Number(e.target.value))} />
              </label>
              <label>
                Discount (%)
                <input required type="number" min="0" max="90" value={edit.discount} onChange={(e) => set('discount', Number(e.target.value))} />
              </label>
              <label>
                Stock
                <input required type="number" min="0" value={edit.stock} onChange={(e) => set('stock', Number(e.target.value))} />
              </label>
              <label>
                Unit / portion
                <input required value={edit.unit} onChange={(e) => set('unit', e.target.value)} />
              </label>
              <label>
                Delivery time (min)
                <input
                  required
                  type="number"
                  min="10"
                  max="240"
                  value={edit.delivery_minutes}
                  onChange={(e) => set('delivery_minutes', Number(e.target.value))}
                />
              </label>
              <label>
                Deal label <span className="muted">(optional)</span>
                <input value={edit.deal} onChange={(e) => set('deal', e.target.value)} />
              </label>
              <label>
                Included <small>Comma separated</small>
                <textarea required rows={2} value={edit.includes} onChange={(e) => set('includes', e.target.value)} />
              </label>
              <label>
                Not included <small>Comma separated</small>
                <textarea required rows={2} value={edit.excludes} onChange={(e) => set('excludes', e.target.value)} />
              </label>
            </div>
            <Toggle checked={!!edit.active} onChange={(v) => set('active', v ? 1 : 0)} label="Listed in the store" />
          </>
        )}
      </FormModal>
    </>
  );
}

function OutletManager() {
  const { data: categories } = useData<{ name: string }[]>('/categories');
  const { locations, notice } = useApp();
  const { data, loading, error, refresh } = useData<Outlet[]>('/admin/outlets');
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [docs, setDocs] = useState<Outlet | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  function start(o?: Outlet) {
    setFormError('');
    setEdit(
      o
        ? { ...o, password: '' }
        : {
            name: '',
            phone: '',
            email: '',
            location_id: locations[0]?.id,
            address: '',
            lat: locations[0]?.lat || 33.6442,
            lng: locations[0]?.lng || 73.0713,
            customer_id: '',
            password: '',
            image: '',
            category: categories?.[0]?.name || '',
            active: 1,
            commission_rate: 10,
          },
    );
  }
  async function persist(o: Record<string, any>) {
    await api('/admin/outlets' + (o.id ? '/' + o.id : ''), {
      method: o.id ? 'PUT' : 'POST',
      body: JSON.stringify({ ...o, password: o.password || undefined }),
    });
    refresh();
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await persist(edit);
      setEdit(null);
      notice('Outlet saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(o) => o.id}
        search={(o) => `${o.name} ${o.customer_id} ${o.email} ${o.phone} ${o.address}`}
        searchPlaceholder="Search outlets"
        toolbar={
          <button className="button" onClick={() => start()}>
            <Plus size={16} /> Add outlet
          </button>
        }
        filters={[
          {
            key: 'area',
            label: 'Areas',
            options: locations.map((l) => ({ value: l.id, label: l.name })),
            test: (o, v) => o.location_id === v,
          },
          {
            key: 'category',
            label: 'Categories',
            options: (categories || []).map((c) => ({ value: c.name, label: c.name })),
            test: (o, v) => o.category === v,
          },
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'disabled', label: 'Disabled' },
            ],
            test: (o, v) => (v === 'active' ? !!o.active : !o.active),
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Outlet',
            sort: (o) => o.name.toLowerCase(),
            render: (o) => (
              <div className="cell-main">
                <img className="cell-thumb" src={o.image} alt="" />
                <span className="cell-stack">
                  <strong>{o.name}</strong>
                  <small>{o.customer_id}</small>
                </span>
              </div>
            ),
          },
          { key: 'category', header: 'Category', render: (o) => o.category },
          { key: 'area', header: 'Area', render: (o) => locations.find((l) => l.id === o.location_id)?.name || '—' },
          {
            key: 'commission',
            header: 'Commission',
            sort: (o) => (o as Outlet & { commission_rate?: number }).commission_rate ?? 0,
            render: (o) => {
              const x = o as Outlet & { commission_rate?: number; accepting?: number };
              return (
                <span className="cell-stack">
                  <span>{x.commission_rate ?? 10}%</span>
                  {x.accepting === 0 && <small className="warn-text">Paused by outlet</small>}
                </span>
              );
            },
          },
          {
            key: 'contact',
            header: 'Contact',
            render: (o) => (
              <span className="cell-stack">
                <span>{o.phone}</span>
                <small>{o.email}</small>
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Active',
            render: (o) => (
              <Toggle
                checked={!!o.active}
                onChange={(v) =>
                  persist({ ...o, active: v ? 1 : 0 })
                    .then(() => notice(v ? 'Outlet enabled.' : 'Outlet disabled.'))
                    .catch((e) => notice(e.message))
                }
              />
            ),
          },
        ]}
        actions={(o) => (
          <>
            <IconAction label="Edit" onClick={() => start(o)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction label="Private documents" onClick={() => setDocs(o)}>
              <FileText size={16} />
            </IconAction>
            <IconAction label="View storefront" href={'/outlets/' + o.id}>
              <ExternalLink size={16} />
            </IconAction>
          </>
        )}
      />
      <FormModal
        open={!!edit}
        title={edit?.id ? 'Edit outlet' : 'Add outlet'}
        onClose={() => setEdit(null)}
        onSubmit={save}
        busy={busy}
        error={formError}
        submit="Save outlet"
      >
        {edit && (
          <>
            <div className="field">
              <span className="field-label">Cover image</span>
              <ImageUpload value={edit.image ? [edit.image] : []} onChange={(urls) => set('image', urls[0] || '')} />
            </div>
            <div className="form-grid">
              <label>
                Outlet name
                <input required value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                Login ID
                <input
                  required
                  pattern="[A-Z0-9-]{3,30}"
                  value={edit.customer_id}
                  onChange={(e) => set('customer_id', e.target.value.toUpperCase())}
                  placeholder="DLV-006"
                />
              </label>
              <label>
                Phone
                <input required type="tel" value={edit.phone} onChange={(e) => set('phone', e.target.value)} />
              </label>
              <label>
                Email
                <input required type="email" value={edit.email} onChange={(e) => set('email', e.target.value)} />
              </label>
              <label>
                Category
                <select value={edit.category} onChange={(e) => set('category', e.target.value)}>
                  {(categories || []).map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Delivery area
                <select
                  value={edit.location_id}
                  onChange={(e) => {
                    const l = locations.find((l) => l.id === e.target.value);
                    setEdit({ ...edit, location_id: e.target.value, lat: l?.lat, lng: l?.lng });
                  }}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Pickup address
                <textarea required rows={2} value={edit.address} onChange={(e) => set('address', e.target.value)} />
              </label>
              <label>
                Latitude
                <input type="number" step="any" required min="-90" max="90" value={edit.lat} onChange={(e) => set('lat', Number(e.target.value))} />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="any"
                  required
                  min="-180"
                  max="180"
                  value={edit.lng}
                  onChange={(e) => set('lng', Number(e.target.value))}
                />
              </label>
              <label>
                Dellvit commission (%)
                <input
                  type="number"
                  required
                  min="0"
                  max="100"
                  step="0.1"
                  value={edit.commission_rate ?? 10}
                  onChange={(e) => set('commission_rate', Number(e.target.value))}
                />
                <small>Deducted from item sales on every delivered order.</small>
              </label>
              <label>
                {edit.id ? 'New password (optional)' : 'Portal password'}
                <input
                  type="password"
                  required={!edit.id}
                  minLength={10}
                  maxLength={100}
                  autoComplete="new-password"
                  value={edit.password}
                  onChange={(e) => set('password', e.target.value)}
                />
                <small>{edit.id ? 'Leave blank to keep the current password.' : 'At least 10 characters.'}</small>
              </label>
            </div>
            <Toggle checked={!!edit.active} onChange={(v) => set('active', v ? 1 : 0)} label="Outlet and portal active" />
          </>
        )}
      </FormModal>
      <Modal open={!!docs} onClose={() => setDocs(null)} title={'Documents · ' + (docs?.name || '')}>
        {docs && <DocumentManager outletId={docs.id} />}
      </Modal>
    </>
  );
}

function DocumentManager({ outletId }: { outletId: string }) {
  const { notice } = useApp();
  const { data, error, loading, refresh } = useData<{ id: string; name: string; created_at: string }[]>(
    '/admin/outlets/' + outletId + '/documents',
  );
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api('/admin/outlets/' + outletId + '/documents', { method: 'POST', body: form });
      refresh();
      notice('Document uploaded.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="alert info">
        <ShieldCheck size={16} /> Visible to administrators only.
      </div>
      <label className="upload-tile wide">
        <Upload size={18} />
        <span>{busy ? 'Uploading…' : 'Upload PDF (max 4 MB)'}</span>
        <input
          type="file"
          accept="application/pdf"
          hidden
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </label>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        rowKey={(d) => d.id}
        pageSize={5}
        empty="No documents yet."
        columns={[
          {
            key: 'name',
            header: 'Document',
            render: (d) => (
              <span className="cell-main">
                <FileText size={16} /> {d.name}
              </span>
            ),
          },
          { key: 'date', header: 'Uploaded', render: (d) => date(d.created_at) },
        ]}
        actions={(d) => (
          <>
            <IconAction label="Download" href={'/api/admin/documents/' + d.id}>
              <Download size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(d.id)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Confirm
        open={!!remove}
        title="Delete document?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/documents/' + remove, { method: 'DELETE' });
            setRemove(null);
            refresh();
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        This permanently removes the file.
      </Confirm>
    </div>
  );
}

type RiderRow = User & {
  commission_type: string;
  commission_value: number;
  commission_base: string;
  balance: number;
  earned: number;
  active_orders: number;
  delivered: number;
};
function RiderManager() {
  const { locations, notice } = useApp();
  const { data, loading, error, refresh } = useData<RiderRow[]>('/admin/riders', 30000);
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [statement, setStatement] = useState<RiderRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  function start(r?: RiderRow) {
    setFormError('');
    setEdit(
      r
        ? {
            ...r,
            password: '',
            commission_value: r.commission_type === 'fixed' ? r.commission_value / 100 : r.commission_value,
          }
        : {
            name: '',
            email: '',
            phone: '',
            address: '',
            location_id: locations[0]?.id,
            login_id: '',
            password: '',
            active: 1,
            commission_type: 'fixed',
            commission_value: 100,
            commission_base: 'delivery_fee',
          },
    );
  }
  async function persist(r: Record<string, any>, displayValue = true) {
    await api('/admin/riders' + (r.id ? '/' + r.id : ''), {
      method: r.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        ...r,
        password: r.password || undefined,
        commission_value:
          r.commission_type === 'fixed' && displayValue ? Math.round(Number(r.commission_value) * 100) : Number(r.commission_value),
      }),
    });
    refresh();
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await persist(edit);
      setEdit(null);
      notice('Rider saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  return (
    <div className="stack">
      <DataTable
        title={<h3>Riders</h3>}
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(r) => r.id}
        search={(r) => `${r.name} ${r.email} ${r.phone} ${r.login_id}`}
        searchPlaceholder="Search riders"
        toolbar={
          <button className="button" onClick={() => start()}>
            <Plus size={16} /> Add rider
          </button>
        }
        filters={[
          {
            key: 'area',
            label: 'Areas',
            options: locations.map((l) => ({ value: l.id, label: l.name })),
            test: (r, v) => r.location_id === v,
          },
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'disabled', label: 'Disabled' },
            ],
            test: (r, v) => (v === 'active' ? !!r.active : !r.active),
          },
          {
            key: 'commission',
            label: 'Commission types',
            options: [
              { value: 'fixed', label: 'Fixed' },
              { value: 'percent', label: 'Percentage' },
            ],
            test: (r, v) => r.commission_type === v,
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Rider',
            sort: (r) => r.name.toLowerCase(),
            render: (r) => (
              <div className="cell-main">
                <span className="avatar sm">{r.name.slice(0, 1)}</span>
                <span className="cell-stack">
                  <strong>{r.name}</strong>
                  <small>
                    {r.login_id} · {r.phone}
                  </small>
                </span>
              </div>
            ),
          },
          { key: 'area', header: 'Area', render: (r) => locations.find((l) => l.id === r.location_id)?.name || '—' },
          { key: 'commission', header: 'Commission', render: (r) => commissionText(r) },
          {
            key: 'deliveries',
            header: 'Deliveries',
            sort: (r) => r.delivered,
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.delivered}</strong>
                <small>{r.active_orders} active</small>
              </span>
            ),
          },
          {
            key: 'balance',
            header: 'Balance',
            sort: (r) => r.balance,
            render: (r) => (
              <span className="cell-stack">
                <strong>{money(r.balance)}</strong>
                <small>{money(r.earned)} earned</small>
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Active',
            render: (r) => (
              <Toggle
                checked={!!r.active}
                onChange={(v) =>
                  persist({ ...r, active: v ? 1 : 0 }, false)
                    .then(() => notice(v ? 'Rider enabled.' : 'Rider disabled.'))
                    .catch((e) => notice(e.message))
                }
              />
            ),
          },
        ]}
        actions={(r) => (
          <>
            <IconAction label="Edit rider" onClick={() => start(r)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction label="Earnings & payouts" onClick={() => setStatement(r)}>
              <Wallet size={16} />
            </IconAction>
          </>
        )}
      />
      <FleetManager />
      <FormModal
        open={!!edit}
        title={edit?.id ? 'Edit rider' : 'Add rider'}
        onClose={() => setEdit(null)}
        onSubmit={save}
        busy={busy}
        error={formError}
        submit="Save rider"
      >
        {edit && (
          <>
            <div className="form-grid">
              <label>
                Full name
                <input required value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                Rider ID
                <input
                  required
                  pattern="[A-Z0-9-]{3,30}"
                  value={edit.login_id}
                  onChange={(e) => set('login_id', e.target.value.toUpperCase())}
                  placeholder="DRV-003"
                />
              </label>
              <label>
                Email
                <input required type="email" value={edit.email} onChange={(e) => set('email', e.target.value)} />
              </label>
              <label>
                Phone
                <input required type="tel" value={edit.phone} onChange={(e) => set('phone', e.target.value)} />
              </label>
              <label>
                Assigned area
                <select value={edit.location_id} onChange={(e) => set('location_id', e.target.value)}>
                  {locations.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {edit.id ? 'New password (optional)' : 'Password'}
                <input
                  type="password"
                  minLength={10}
                  maxLength={100}
                  required={!edit.id}
                  value={edit.password}
                  autoComplete="new-password"
                  onChange={(e) => set('password', e.target.value)}
                />
              </label>
              <label className="span-2">
                Address
                <textarea required rows={2} value={edit.address} onChange={(e) => set('address', e.target.value)} />
              </label>
            </div>
            <fieldset className="fieldset">
              <legend>Commission per delivery</legend>
              <div className="segmented">
                {[
                  ['fixed', 'Fixed amount'],
                  ['percent', 'Percentage'],
                ].map(([v, t]) => (
                  <button
                    type="button"
                    key={v}
                    className={edit.commission_type === v ? 'selected' : ''}
                    onClick={() => setEdit({ ...edit, commission_type: v, commission_value: v === 'fixed' ? 100 : 80 })}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  {edit.commission_type === 'fixed' ? 'Amount per delivery (PKR)' : 'Percentage (%)'}
                  <input
                    required
                    type="number"
                    min="0"
                    max={edit.commission_type === 'percent' ? 100 : undefined}
                    step={edit.commission_type === 'percent' ? '0.1' : '1'}
                    value={edit.commission_value}
                    onChange={(e) => set('commission_value', e.target.value)}
                  />
                </label>
                {edit.commission_type === 'percent' && (
                  <label>
                    Calculated on
                    <select value={edit.commission_base} onChange={(e) => set('commission_base', e.target.value)}>
                      <option value="delivery_fee">Delivery fee</option>
                      <option value="subtotal">Items subtotal</option>
                      <option value="total">Order total</option>
                    </select>
                  </label>
                )}
              </div>
              <small className="muted">Earnings are added to the rider’s balance when a delivery is verified.</small>
            </fieldset>
            <Toggle checked={!!edit.active} onChange={(v) => set('active', v ? 1 : 0)} label="Account active" />
          </>
        )}
      </FormModal>
      {statement && (
        <RiderStatementModal
          rider={statement}
          onClose={() => {
            setStatement(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function LocationManager() {
  const { notice } = useApp();
  const { data, error, loading, refresh } = useData<(Location & { radius: number; fee: number; active: number })[]>(
    '/admin/area-settings',
  );
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  async function saveCoverage(a: { id: string; active: boolean; radius: number; fee: number }) {
    await api('/admin/area-settings/' + a.id, {
      method: 'PUT',
      body: JSON.stringify({ active: a.active, radius: Number(a.radius), fee: Math.round(Number(a.fee)) }),
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      const saved = await api<{ id: string }>('/admin/locations' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify({ name: edit.name, lat: Number(edit.lat), lng: Number(edit.lng) }),
      });
      await saveCoverage({ id: saved.id, active: !!edit.active, radius: edit.radius, fee: Number(edit.fee) * 100 });
      setEdit(null);
      refresh();
      notice('Delivery area saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(l) => l.id}
        search={(l) => l.name}
        searchPlaceholder="Search areas"
        toolbar={
          <button className="button" onClick={() => setEdit({ name: '', lat: 33.6442, lng: 73.0713, radius: 8, fee: 150, active: true })}>
            <Plus size={16} /> Add area
          </button>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'on', label: 'Accepting orders' },
              { value: 'off', label: 'Paused' },
            ],
            test: (l, v) => (v === 'on' ? !!l.active : !l.active),
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Area',
            sort: (l) => l.name,
            render: (l) => (
              <span className="cell-main">
                <span className="n-icon order">
                  <MapPin size={15} />
                </span>
                <strong>{l.name}</strong>
              </span>
            ),
          },
          { key: 'coords', header: 'Centre', render: (l) => <small>{l.lat.toFixed(4)}, {l.lng.toFixed(4)}</small> },
          { key: 'radius', header: 'Radius', sort: (l) => l.radius, render: (l) => `${l.radius} km` },
          { key: 'fee', header: 'Delivery fee', sort: (l) => l.fee, render: (l) => money(l.fee) },
          {
            key: 'active',
            header: 'Accepting',
            render: (l) => (
              <Toggle
                checked={!!l.active}
                onChange={(v) =>
                  saveCoverage({ id: l.id, active: v, radius: l.radius, fee: l.fee })
                    .then(() => {
                      refresh();
                      notice(v ? 'Area resumed.' : 'Area paused.');
                    })
                    .catch((e) => notice(e.message))
                }
              />
            ),
          },
        ]}
        actions={(l) => (
          <IconAction label="Edit area" onClick={() => setEdit({ ...l, fee: l.fee / 100, active: !!l.active })}>
            <Edit3 size={16} />
          </IconAction>
        )}
      />
      <FormModal
        open={!!edit}
        title={edit?.id ? 'Edit delivery area' : 'Add delivery area'}
        onClose={() => setEdit(null)}
        onSubmit={save}
        busy={busy}
        error={formError}
      >
        {edit && (
          <>
            <div className="form-grid">
              <label className="span-2">
                Area name
                <input required value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                Centre latitude
                <input type="number" required min="-90" max="90" step="any" value={edit.lat} onChange={(e) => set('lat', e.target.value)} />
              </label>
              <label>
                Centre longitude
                <input type="number" required min="-180" max="180" step="any" value={edit.lng} onChange={(e) => set('lng', e.target.value)} />
              </label>
              <label>
                Radius (km)
                <input type="number" required min="0.1" max="100" step="0.1" value={edit.radius} onChange={(e) => set('radius', e.target.value)} />
              </label>
              <label>
                Delivery fee (PKR)
                <input type="number" required min="0" step="1" value={edit.fee} onChange={(e) => set('fee', e.target.value)} />
              </label>
            </div>
            <DeliveryMap lat={Number(edit.lat)} lng={Number(edit.lng)} onChange={(lat, lng) => setEdit({ ...edit, lat, lng })} />
            <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Accepting orders" />
          </>
        )}
      </FormModal>
    </>
  );
}

function AdManager() {
  const { notice } = useApp();
  const { data, error, loading, refresh } = useData<Ad>('/ad');
  const [edit, setEdit] = useState<Ad | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    try {
      await api('/admin/ad', { method: 'PUT', body: JSON.stringify(edit) });
      refresh();
      setEdit(null);
      notice('Advertisement updated.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const ad = edit || data || { title: '', description: '', label: '', link: '/search', image: '', active: false };
  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <h3>Homepage banner</h3>
          <Toggle checked={ad.active} onChange={(v) => setEdit({ ...ad, active: v })} label={ad.active ? 'Live' : 'Hidden'} />
        </div>
        <form className="stack" onSubmit={save}>
          <div className="field">
            <span className="field-label">Image</span>
            <ImageUpload value={ad.image ? [ad.image] : []} onChange={(urls) => setEdit({ ...ad, image: urls[0] || '' })} />
          </div>
          <div className="form-grid">
            <label>
              Label
              <input required value={ad.label} onChange={(e) => setEdit({ ...ad, label: e.target.value })} />
            </label>
            <label>
              Link
              <input required value={ad.link} onChange={(e) => setEdit({ ...ad, link: e.target.value })} placeholder="/search" />
            </label>
            <label className="span-2">
              Title
              <input required value={ad.title} onChange={(e) => setEdit({ ...ad, title: e.target.value })} />
            </label>
            <label className="span-2">
              Description
              <textarea required rows={2} value={ad.description} onChange={(e) => setEdit({ ...ad, description: e.target.value })} />
            </label>
          </div>
          <div className="form-foot">
            {edit && (
              <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                Discard
              </button>
            )}
            <button disabled={busy || !edit} className="button">
              {busy ? 'Saving…' : 'Save banner'}
            </button>
          </div>
        </form>
      </section>
      <section className="card">
        <div className="card-head">
          <h3>Preview</h3>
        </div>
        <div className="ad preview">
          <div className="ad-copy">
            <span className="eyebrow light">{ad.label || 'Label'}</span>
            <h2>{ad.title || 'Your headline'}</h2>
            <p>{ad.description}</p>
            <span className="button white small">Explore now</span>
          </div>
          {ad.image && <img src={ad.image} alt="" />}
        </div>
      </section>
    </div>
  );
}

type Message = { id: string; name: string; email: string; message: string; created_at: string };
function Messages() {
  const { notice } = useApp();
  const { data, error, loading, refresh } = useData<Message[]>('/admin/messages', 30000);
  const [view, setView] = useState<Message | null>(null);
  const [remove, setRemove] = useState<Message | null>(null);
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(m) => m.id}
        onRowClick={setView}
        search={(m) => `${m.name} ${m.email} ${m.message}`}
        searchPlaceholder="Search messages"
        empty="Your inbox is clear."
        columns={[
          {
            key: 'from',
            header: 'From',
            sort: (m) => m.name,
            render: (m) => (
              <span className="cell-stack">
                <strong>{m.name}</strong>
                <small>{m.email}</small>
              </span>
            ),
          },
          { key: 'message', header: 'Message', render: (m) => <span className="truncate wide">{m.message}</span> },
          { key: 'date', header: 'Received', sort: (m) => m.created_at, render: (m) => date(m.created_at) },
        ]}
        actions={(m) => (
          <>
            <IconAction label="Open" onClick={() => setView(m)}>
              <Eye size={16} />
            </IconAction>
            <IconAction label="Reply by email" href={'mailto:' + m.email}>
              <Reply size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(m)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal
        open={!!view}
        onClose={() => setView(null)}
        title={view?.name || 'Message'}
        footer={
          view && (
            <a className="button" href={'mailto:' + view.email}>
              <Reply size={16} /> Reply
            </a>
          )
        }
      >
        {view && (
          <div className="stack">
            <small className="muted">
              {view.email} · {date(view.created_at)}
            </small>
            <p className="message-body">{view.message}</p>
          </div>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete message?"
        danger
        confirm="Delete"
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          try {
            await api('/admin/messages/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Message deleted.');
          } catch (e) {
            notice((e as Error).message);
          }
        }}
      />
    </>
  );
}
