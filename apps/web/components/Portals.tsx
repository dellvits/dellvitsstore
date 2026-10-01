'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArchiveRestore,
  Archive,
  Banknote,
  Bike,
  Check,
  Clock,
  ClipboardList,
  DoorOpen,
  HandCoins,
  Hash,
  IdCard,
  Landmark,
  Navigation,
  Percent,
  Phone,
  Siren,
  StickyNote,
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
  Headphones,
  Bell,
  Package,
  PackageX,
  Plus,
  Reply,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
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
import { api, money, date, openingHours } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Product, Outlet, AdminOutlet, AdminArea, User, Location, PaymentMethod } from '@/lib/types';
import { useRange } from '@/lib/range';
import { PaymentLogo } from './Checkout';
import {
  Badge,
  Confirm,
  CopyButton,
  DataTable,
  Empty,
  ErrorBox,
  FilterBar,
  IconAction,
  Loading,
  MetaItem,
  Modal,
  PanelSection,
  Stat,
  Toggle,
  PageLoading,
} from './UI';
import { NotificationBell } from './Notifications';
import { ThemeSwitch } from './Shell';
import {
  RecordManager,
  PaymentsWorkspace,
  RiderTools,
  CustomerDirectory,
  commissionText,
} from './Platform';
import { AuditLog, SettingsManager, StaffManager } from './AdminSystem';
import { Account } from './Account';
import { NotificationsPage } from './Notifications';
import { OrderDesk } from './OrderDesk';
import { ContentManager } from './ContentManager';
import { AdManager } from './AdManager';
import { CouponManager } from './CouponManager';
import { MessageButton, SupportChat, SupportInbox } from './Support';
import { AdminOverview, OutletDashboard, RiderDashboard } from './Dashboards';
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
  { key: 'support', title: 'Support chat', icon: Headphones, group: 'Help' },
];
const riderNav: Nav[] = [
  { key: 'home', title: 'Dashboard', icon: LayoutDashboard, group: 'Rider' },
  { key: 'orders', title: 'Deliveries', icon: Truck, group: 'Rider' },
  { key: 'cash', title: 'COD cash', icon: HandCoins, group: 'Rider' },
  { key: 'earnings', title: 'Earnings & payouts', icon: Wallet, group: 'Rider' },
  { key: 'support', title: 'Support chat', icon: Headphones, group: 'Help' },
];

export default function Portal({ role }: { role: 'admin' | 'outlet' | 'rider' }) {
  const { user, ready, logout } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  if (!ready) return <PageLoading />;
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
  // Every account has its profile and its inbox, whatever modules it was given.
  const nav = [
    ...(role === 'admin'
      ? adminNav.filter(
          (x) => user.is_super_admin || (x.key !== 'staff' && user.permissions?.includes(x.permission || x.key)),
        )
      : role === 'outlet'
        ? outletNav
        : riderNav),
    { key: 'profile', title: 'Profile', icon: UserRound, group: 'Account' },
    { key: 'notifications', title: 'Notifications', icon: Bell, group: 'Account' },
  ];
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
            <ThemeSwitch />
            <MessageButton />
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
          ) : tab === 'home' ? (
            <RiderDashboard go={go} />
          ) : tab === 'profile' ? (
            <Account embedded />
          ) : tab === 'notifications' ? (
            <NotificationsPage embedded />
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
            <SupportInbox />
          ) : tab === 'support' ? (
            <SupportChat />
          ) : tab === 'coupons' ? (
            <CouponManager />
          ) : tab === 'staff' ? (
            <StaffManager />
          ) : tab === 'customers' ? (
            <CustomerDirectory />
          ) : tab === 'audit' ? (
            <AuditLog />
          ) : tab === 'settings' ? (
            <SettingsManager />
          ) : tab === 'content' ? (
            <ContentManager />
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
  max_per_order: 10,
  unit: '1 item',
  sku: '',
  discount: 0,
  deal: '',
  images: [] as string[],
  includes: '',
  excludes: '',
  delivery_minutes: 30,
  payment_methods: [] as string[],
  outlet_id: '',
  location_id: '',
  active: 1,
};
type ProductMethod = Pick<PaymentMethod, 'id' | 'name' | 'type' | 'provider' | 'bank_name' | 'logo' | 'active'>;
const methodSubtitle = (m: ProductMethod) =>
  m.type === 'cod' ? 'Cash on delivery' : m.type === 'raast' ? 'Raast' : m.provider || m.bank_name || 'Bank transfer';
function ProductManager({ admin }: { admin: boolean }) {
  const { data: categories } = useData<{ name: string }[]>('/categories');
  const { locations, notice } = useApp();
  const { data, loading, error, refresh } = useData<Product[]>('/manage/products');
  const { data: outlets } = useData<Outlet[]>(admin ? '/manage/product-outlets' : null);
  const { data: own } = useData<Outlet>(!admin ? '/manage/outlet' : null);
  const { data: methods } = useData<ProductMethod[]>('/manage/payment-methods');
  const [edit, setEdit] = useState<(typeof newProduct & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const enabledIds = new Set((methods || []).filter((m) => m.active).map((m) => m.id));
  function start(p?: Product) {
    setFormError('');
    const outlet = own || outlets?.[0];
    setEdit(
      p
        ? { ...p, price: p.price / 100 }
        : {
            ...newProduct,
            category: categories?.[0]?.name || '',
            outlet_id: outlet?.id || '',
            // New products start in their outlet's area.
            location_id: outlet?.location_id || locations[0]?.id || '',
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
    if (!edit.payment_methods.length) return setFormError('Choose at least one payment method for this product.');
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
  const toggleMethod = (id: string, on: boolean) =>
    setEdit((e) =>
      e ? { ...e, payment_methods: on ? [...e.payment_methods, id] : e.payment_methods.filter((x) => x !== id) } : e,
    );
  const selectedOutlet = admin ? outlets?.find((o) => o.id === edit?.outlet_id) : own;
  const noEnabledMethod = !!edit && edit.payment_methods.length > 0 && !edit.payment_methods.some((id) => enabledIds.has(id));
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(p) => p.id}
        search={(p) => `${p.name} ${p.outlet_name} ${p.category} ${p.sku}`}
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
          {
            key: 'payment',
            label: 'Payment methods',
            options: [
              { value: 'none', label: 'No enabled method' },
              ...(methods || []).map((m) => ({ value: 'm:' + m.id, label: m.name })),
            ],
            test: (p, v) =>
              v === 'none' ? !p.payment_methods.some((id) => enabledIds.has(id)) : p.payment_methods.includes(v.slice(2)),
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
                    {p.sku && ` · SKU ${p.sku}`}
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
            key: 'payment',
            header: 'Payment',
            render: (p) => {
              const accepted = (methods || []).filter((m) => m.active && p.payment_methods.includes(m.id));
              if (!methods) return <span className="muted">—</span>;
              if (!accepted.length) return <Badge tone="danger">None enabled</Badge>;
              return (
                <span className="method-logos" title={accepted.map((m) => m.name).join(', ')}>
                  {accepted.slice(0, 4).map((m) => (
                    <PaymentLogo key={m.id} method={m} className="pay-mini" size={13} />
                  ))}
                  {accepted.length > 4 && <small className="muted">+{accepted.length - 4}</small>}
                </span>
              );
            },
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
                  <select
                    required
                    value={edit.outlet_id}
                    onChange={(e) => {
                      const area = outlets?.find((o) => o.id === e.target.value)?.location_id;
                      // Picking an outlet moves the product to that outlet's area; it can still be changed below.
                      setEdit((p) => (p ? { ...p, outlet_id: e.target.value, location_id: area || p.location_id } : p));
                    }}
                  >
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
                      {l.id === selectedOutlet?.location_id ? ' (outlet’s area)' : ''}
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
              <h4 className="span-2 form-section">Pricing and stock</h4>
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
                Max per order
                <input
                  required
                  type="number"
                  min="1"
                  max="99"
                  value={edit.max_per_order}
                  onChange={(e) => set('max_per_order', Number(e.target.value))}
                />
              </label>
              <label>
                Unit / portion
                <input required value={edit.unit} onChange={(e) => set('unit', e.target.value)} placeholder="1 meal, 2 kg, 500 ml" />
              </label>
              <label>
                SKU <span className="muted">(optional)</span>
                <input
                  value={edit.sku}
                  maxLength={40}
                  pattern="[\w.\/\-]*"
                  title="Letters, numbers, dashes, dots and slashes"
                  onChange={(e) => set('sku', e.target.value.toUpperCase())}
                />
              </label>
              <h4 className="span-2 form-section">Delivery and promotion</h4>
              <label>
                Prep + delivery time (min)
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
                <input value={edit.deal} maxLength={150} onChange={(e) => set('deal', e.target.value)} />
              </label>
              <label>
                Included <span className="muted">(optional, comma separated)</span>
                <textarea rows={2} value={edit.includes} onChange={(e) => set('includes', e.target.value)} />
              </label>
              <label>
                Not included <span className="muted">(optional, comma separated)</span>
                <textarea rows={2} value={edit.excludes} onChange={(e) => set('excludes', e.target.value)} />
              </label>
            </div>
            <div className="field">
              <span className="field-label">
                Payment methods at checkout
                {!!methods?.length && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => set('payment_methods', [...new Set([...edit.payment_methods, ...enabledIds])])}
                  >
                    Select all enabled
                  </button>
                )}
              </span>
              {!methods ? (
                <Loading />
              ) : !methods.length ? (
                <div className="alert warn">
                  No payment methods have been set up yet.{' '}
                  {admin ? <Link href="/admin?tab=payments">Add one on the Payments page</Link> : 'Ask Dellvit to add one.'}
                </div>
              ) : (
                <div className="pay-options method-picker">
                  {methods.map((m) => {
                    const on = edit.payment_methods.includes(m.id);
                    return (
                      <label key={m.id} className={'pay-option' + (on ? ' selected' : '') + (m.active ? '' : ' off')}>
                        <input type="checkbox" checked={on} onChange={(e) => toggleMethod(m.id, e.target.checked)} />
                        <PaymentLogo method={m} className="pay-icon" />
                        <span className="pay-text">
                          <strong>{m.name}</strong>
                          <small>{m.active ? methodSubtitle(m) : 'Disabled · hidden at checkout'}</small>
                        </span>
                        <span className="check-dot">{on && <Check size={12} strokeWidth={3} />}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              <small className="muted">
                Customers can pay only with the enabled methods selected here. Disabling a method on the Payments page hides it
                from every product; deleting it removes it.
              </small>
              {noEnabledMethod && (
                <div className="alert warn">None of the selected methods is enabled, so customers cannot order this product yet.</div>
              )}
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
  const { data, setData, loading, error, refresh } = useData<AdminOutlet[]>('/admin/outlets');
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [docs, setDocs] = useState<Outlet | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  function start(o?: AdminOutlet) {
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
            // Blank uses the category's commission, or the platform default.
            commission_rate: '',
            accepting: 1,
            featured: 0,
            description: '',
            minimum_order: 0,
            opens_at: '',
            closes_at: '',
            owner_name: '',
            payout_bank: '',
            payout_title: '',
            payout_account: '',
            notes: '',
          },
    );
  }
  async function persist(o: Record<string, any>) {
    await api('/admin/outlets' + (o.id ? '/' + o.id : ''), {
      method: o.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        ...o,
        password: o.password || undefined,
        commission_rate: o.commission_rate === '' ? undefined : o.commission_rate,
      }),
    });
    refresh();
  }
  /** Flips a switch at once and saves just that flag; the list reloads only if the save fails. */
  async function quick(o: AdminOutlet, change: Partial<AdminOutlet>, done: string) {
    const merge = (extra: Partial<AdminOutlet>) =>
      setData((rows) => rows && rows.map((x) => (x.id === o.id ? { ...x, ...extra } : x)));
    merge(change);
    try {
      const saved = await api<Partial<AdminOutlet>>('/admin/outlets/' + o.id, {
        method: 'PATCH',
        body: JSON.stringify(change),
      });
      merge({ open: saved.open });
      notice(done);
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
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
  const list = data || [];
  const live = list.filter((o) => o.active);
  const statsBusy = loading && !data;
  const sum = (get: (o: AdminOutlet) => number) => list.reduce((n, o) => n + (get(o) || 0), 0);
  return (
    <div className="stack">
      <div className="stats">
        <Stat
          icon={<Store size={20} />}
          label="Outlets"
          value={list.length}
          hint={`${live.length} active · ${list.filter((o) => o.featured).length} featured`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<DoorOpen size={20} />}
          label="Taking orders now"
          value={live.filter((o) => o.open).length}
          hint={`${live.filter((o) => !o.accepting).length} paused · ${live.filter((o) => o.accepting && !o.open).length} outside opening hours`}
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<Banknote size={20} />}
          label="Delivered item sales"
          value={money(sum((o) => o.sales))}
          hint={`${money(sum((o) => o.payable))} outlet share · all time`}
          tone="purple"
          loading={statsBusy}
        />
        <Stat
          icon={<PackageX size={20} />}
          label="Without products"
          value={live.filter((o) => !o.products).length}
          hint="Active outlets with nothing listed"
          tone="orange"
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(o) => o.id}
        search={(o) => `${o.name} ${o.customer_id} ${o.email} ${o.phone} ${o.address} ${o.owner_name}`}
        searchPlaceholder="Search outlets"
        empty="No outlets yet. Add one to start listing products."
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
              { value: 'featured', label: 'Featured' },
            ],
            test: (o, v) => (v === 'featured' ? !!o.featured : v === 'active' ? !!o.active : !o.active),
          },
          {
            key: 'orders',
            label: 'Order states',
            options: [
              { value: 'open', label: 'Taking orders now' },
              { value: 'paused', label: 'Orders paused' },
              { value: 'closed', label: 'Outside opening hours' },
            ],
            test: (o, v) => (v === 'open' ? !!o.open : v === 'paused' ? !o.accepting : !!o.accepting && !o.open),
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
                  <strong>
                    {o.name} {!!o.featured && <Star size={13} className="featured-star" aria-label="Featured" />}
                  </strong>
                  <small>
                    {o.customer_id} · {o.phone}
                  </small>
                </span>
              </div>
            ),
          },
          {
            key: 'category',
            header: 'Category & area',
            render: (o) => (
              <span className="cell-stack">
                <span>{o.category}</span>
                <small>{locations.find((l) => l.id === o.location_id)?.name || '—'}</small>
              </span>
            ),
          },
          {
            key: 'hours',
            header: 'Hours & minimum',
            render: (o) => (
              <span className="cell-stack">
                <span>{openingHours(o) || 'Open 24 hours'}</span>
                <small>{o.minimum_order ? 'Min. order ' + money(o.minimum_order) : 'No outlet minimum'}</small>
              </span>
            ),
          },
          {
            key: 'products',
            header: 'Products',
            sort: (o) => o.products || 0,
            render: (o) => (
              <span className="cell-stack">
                <span>{o.products ? o.products : <span className="warn-text">None listed</span>}</span>
                <small>
                  {o.orders} order{o.orders === 1 ? '' : 's'}
                </small>
              </span>
            ),
          },
          {
            key: 'sales',
            header: 'Sales',
            sort: (o) => o.sales || 0,
            render: (o) => (
              <span className="cell-stack">
                <strong>{money(o.sales || 0)}</strong>
                <small>{o.commission_rate ?? 10}% commission</small>
              </span>
            ),
          },
          {
            key: 'accepting',
            header: 'Taking orders',
            render: (o) => (
              <span className="cell-stack">
                <Toggle
                  checked={!!o.accepting}
                  onChange={(v) =>
                    quick(
                      o,
                      { accepting: v ? 1 : 0 },
                      v ? `${o.name} is taking orders again.` : `New orders paused for ${o.name}.`,
                    )
                  }
                />
                {!o.accepting ? (
                  <small className="warn-text">Paused</small>
                ) : (
                  !o.open && <small>Closed right now</small>
                )}
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Active',
            render: (o) => (
              <Toggle
                checked={!!o.active}
                onChange={(v) => quick(o, { active: v ? 1 : 0 }, v ? 'Outlet enabled.' : 'Outlet disabled.')}
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
              <h4 className="span-2 form-section">Outlet profile</h4>
              <label>
                Outlet name
                <input required maxLength={150} value={edit.name} onChange={(e) => set('name', e.target.value)} />
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
                Phone
                <input required type="tel" value={edit.phone} onChange={(e) => set('phone', e.target.value)} />
              </label>
              <label>
                Email
                <input required type="email" value={edit.email} onChange={(e) => set('email', e.target.value)} />
              </label>
              <label className="span-2">
                Storefront description <span className="muted">(optional)</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={edit.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="What this outlet is known for. Shown on its store page."
                />
              </label>

              <h4 className="span-2 form-section">Pickup location</h4>
              <label className="span-2">
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

              <h4 className="span-2 form-section">Ordering</h4>
              <label>
                Opens at
                <input type="time" value={edit.opens_at} onChange={(e) => set('opens_at', e.target.value)} />
              </label>
              <label>
                Closes at
                <input type="time" value={edit.closes_at} onChange={(e) => set('closes_at', e.target.value)} />
              </label>
              <small className="span-2 muted">
                Pakistan time. Checkout is refused outside these hours; closing may be after midnight.{' '}
                {edit.opens_at || edit.closes_at ? (
                  <button type="button" className="link" onClick={() => setEdit({ ...edit, opens_at: '', closes_at: '' })}>
                    Clear to stay open 24 hours
                  </button>
                ) : (
                  'Leave both empty to stay open 24 hours.'
                )}
              </small>
              <label>
                Minimum order (PKR)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={edit.minimum_order / 100}
                  onChange={(e) => set('minimum_order', Math.round(Number(e.target.value) * 100))}
                />
                <small>Item subtotal needed to check out. 0 applies only the store-wide minimum.</small>
              </label>

              <h4 className="span-2 form-section">Commission and settlement</h4>
              <label>
                Dellvit commission (%)
                <input
                  type="number"
                  required={!!edit.id}
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="Category default"
                  value={edit.commission_rate ?? 10}
                  onChange={(e) => set('commission_rate', e.target.value === '' ? '' : Number(e.target.value))}
                />
                <small>Deducted from item sales on every delivered order.</small>
              </label>
              <label>
                Owner or contact person <span className="muted">(optional)</span>
                <input maxLength={100} value={edit.owner_name} onChange={(e) => set('owner_name', e.target.value)} />
              </label>
              <label>
                Settlement bank or wallet <span className="muted">(optional)</span>
                <input
                  maxLength={100}
                  value={edit.payout_bank}
                  onChange={(e) => set('payout_bank', e.target.value)}
                  placeholder="e.g. Meezan Bank, JazzCash"
                />
              </label>
              <label>
                Account title <span className="muted">(optional)</span>
                <input maxLength={100} value={edit.payout_title} onChange={(e) => set('payout_title', e.target.value)} />
              </label>
              <label>
                Account number or IBAN <span className="muted">(optional)</span>
                <input maxLength={40} value={edit.payout_account} onChange={(e) => set('payout_account', e.target.value)} />
                <small>Where the outlet's share of sales is paid.</small>
              </label>
              <label className="span-2">
                Internal notes <span className="muted">(optional)</span>
                <textarea rows={2} maxLength={2000} value={edit.notes} onChange={(e) => set('notes', e.target.value)} />
              </label>

              <h4 className="span-2 form-section">Portal login</h4>
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
            <div className="toggle-list">
              <Toggle checked={!!edit.active} onChange={(v) => set('active', v ? 1 : 0)} label="Outlet and portal active" />
              <Toggle
                checked={!!edit.accepting}
                onChange={(v) => set('accepting', v ? 1 : 0)}
                label="Taking new orders (the outlet can also pause this from its dashboard)"
              />
              <Toggle
                checked={!!edit.featured}
                onChange={(v) => set('featured', v ? 1 : 0)}
                label="Featured: listed first on the home page and the outlets page"
              />
            </div>
            <div className="alert info">
              <ShieldCheck size={16} /> Settlement details, the contact person and internal notes are visible to administrators
              only.
            </div>
          </>
        )}
      </FormModal>
      <Modal open={!!docs} onClose={() => setDocs(null)} title={'Documents · ' + (docs?.name || '')}>
        {docs && <DocumentManager outletId={docs.id} />}
      </Modal>
    </div>
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

type AdminRider = User & {
  created_at: string;
  commission_type: string;
  commission_value: number;
  commission_base: string;
  vehicle_type: string;
  vehicle_number: string;
  cnic: string;
  license_number: string;
  emergency_name: string;
  emergency_phone: string;
  payout_method: string;
  payout_bank: string;
  payout_title: string;
  payout_account: string;
  notes: string;
  /** 0 while the rider is off duty. */
  available: number;
  /** Most orders the rider carries at once. */
  capacity: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  position_at: string | null;
  active_orders: number;
  delivered: number;
  last_delivery_at: string | null;
  earned: number;
  paid: number;
  balance: number;
  pending_payouts: number;
  cash_in_hand: number;
  /** Figures for the time frame chosen above the cards. */
  delivered_range: number;
  earned_range: number;
  paid_range: number;
  cash_range: number;
};
const vehicles: Record<string, string> = {
  motorbike: 'Motorbike',
  bicycle: 'Bicycle',
  car: 'Car',
  rickshaw: 'Rickshaw',
  on_foot: 'On foot',
};
const payoutLabels: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank transfer',
  wallet: 'Mobile wallet',
  raast: 'Raast',
};
/** What a rider is doing right now, for the badge, the filter and the stat cards. */
function riderDuty(r: AdminRider): { key: string; text: string; tone: string } {
  if (!r.active) return { key: 'disabled', text: 'Disabled', tone: 'neutral' };
  if (!r.available) return { key: 'off', text: 'Off duty', tone: 'warn' };
  if (r.active_orders >= r.capacity) return { key: 'full', text: 'At capacity', tone: 'danger' };
  if (r.active_orders > 0) return { key: 'busy', text: 'On a delivery', tone: 'info' };
  return { key: 'free', text: 'Free', tone: 'success' };
}
const emptyRider = {
  name: '',
  email: '',
  phone: '',
  address: '',
  login_id: '',
  password: '',
  active: 1,
  commission_type: 'fixed',
  commission_value: 100,
  commission_base: 'delivery_fee',
  vehicle_type: 'motorbike',
  vehicle_number: '',
  cnic: '',
  license_number: '',
  emergency_name: '',
  emergency_phone: '',
  payout_method: 'cash',
  payout_bank: '',
  payout_title: '',
  payout_account: '',
  notes: '',
  available: 1,
  capacity: 5,
};
function RiderManager() {
  const { locations, notice } = useApp();
  const { range, setRange, query, key, label: rangeText } = useRange('7d');
  const { data, setData, loading, error, refresh } = useData<AdminRider[]>('/admin/riders' + query, 30000, 'riders:' + key);
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [statement, setStatement] = useState<AdminRider | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const areaName = (id: string) => locations.find((l) => l.id === id)?.name || '—';
  function start(r?: AdminRider) {
    setFormError('');
    setEdit(
      r
        ? {
            ...r,
            password: '',
            commission_value: r.commission_type === 'fixed' ? r.commission_value / 100 : r.commission_value,
          }
        : { ...emptyRider, location_id: locations[0]?.id },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await api('/admin/riders' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...edit,
          password: edit.password || undefined,
          capacity: Number(edit.capacity),
          commission_value:
            edit.commission_type === 'fixed' ? Math.round(Number(edit.commission_value) * 100) : Number(edit.commission_value),
        }),
      });
      refresh();
      setEdit(null);
      notice('Rider saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips a switch at once and saves just that setting; the list reloads only if the save fails. */
  async function quick(r: AdminRider, change: Partial<AdminRider>, done: string) {
    setData((rows) => rows && rows.map((x) => (x.id === r.id ? { ...x, ...change } : x)));
    try {
      await api('/admin/riders/' + r.id, { method: 'PATCH', body: JSON.stringify(change) });
      notice(done);
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  const setDuty = (r: AdminRider, v: boolean) =>
    quick(r, { available: v ? 1 : 0 }, v ? `${r.name} is on duty.` : `${r.name} is off duty.`);
  const setActive = (r: AdminRider, v: boolean) =>
    quick(r, { active: v ? 1 : 0 }, v ? 'Rider enabled.' : 'Rider disabled.');
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const list = data || [];
  const live = list.filter((r) => r.active);
  const onDuty = live.filter((r) => r.available);
  const statsBusy = loading && !data;
  const sum = (get: (r: AdminRider) => number) => list.reduce((n, r) => n + (get(r) || 0), 0);
  const current = view ? list.find((r) => r.id === view) : undefined;
  return (
    <div className="stack">
      <FilterBar title="Riders" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Users size={20} />}
          label="Riders"
          value={list.length}
          hint={`${onDuty.length} on duty · ${live.length - onDuty.length} off duty · live`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<Truck size={20} />}
          label="Deliveries completed"
          value={sum((r) => r.delivered_range)}
          hint={`${sum((r) => r.active_orders)} in progress now`}
          tone="green"
          loading={loading}
        />
        <Stat
          icon={<Percent size={20} />}
          label="Commission earned"
          value={money(sum((r) => r.earned_range))}
          hint={`${money(sum((r) => r.paid_range))} paid out in this period`}
          tone="orange"
          loading={loading}
        />
        <Stat
          icon={<HandCoins size={20} />}
          label="COD collected"
          value={money(sum((r) => r.cash_range))}
          hint={`${money(sum((r) => r.cash_in_hand))} still with riders · live`}
          loading={loading}
        />
        <Stat
          icon={<Wallet size={20} />}
          label="Commission owed"
          value={money(sum((r) => r.balance))}
          hint={`${money(sum((r) => r.pending_payouts))} requested by riders · live`}
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
        onRowClick={(r) => setView(r.id)}
        search={(r) => `${r.name} ${r.email} ${r.phone} ${r.login_id} ${r.vehicle_number} ${r.cnic}`}
        searchPlaceholder="Search name, ID, phone, plate"
        empty="No riders yet. Add one to start dispatching orders."
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
            key: 'duty',
            label: 'Duty states',
            options: [
              { value: 'free', label: 'Free' },
              { value: 'busy', label: 'On a delivery' },
              { value: 'full', label: 'At capacity' },
              { value: 'off', label: 'Off duty' },
              { value: 'disabled', label: 'Disabled' },
            ],
            test: (r, v) => riderDuty(r).key === v,
          },
          {
            key: 'vehicle',
            label: 'Vehicles',
            options: Object.entries(vehicles).map(([value, label]) => ({ value, label })),
            test: (r, v) => r.vehicle_type === v,
          },
          {
            key: 'money',
            label: 'Balances',
            options: [
              { value: 'owed', label: 'Commission owed' },
              { value: 'cash', label: 'Holding COD cash' },
              { value: 'requested', label: 'Payout requested' },
            ],
            test: (r, v) => (v === 'owed' ? r.balance > 0 : v === 'cash' ? r.cash_in_hand > 0 : r.pending_payouts > 0),
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
          {
            key: 'area',
            header: 'Area & vehicle',
            render: (r) => (
              <span className="cell-stack">
                <span>{areaName(r.location_id)}</span>
                <small>
                  {vehicles[r.vehicle_type] || r.vehicle_type}
                  {r.vehicle_number && ' · ' + r.vehicle_number}
                </small>
              </span>
            ),
          },
          {
            key: 'state',
            header: 'Status',
            render: (r) => {
              const d = riderDuty(r);
              return <Badge tone={d.tone}>{d.text}</Badge>;
            },
          },
          {
            key: 'load',
            header: 'Load',
            sort: (r) => r.active_orders,
            render: (r) => (
              <span className="cell-stack">
                <strong>
                  {r.active_orders} / {r.capacity}
                </strong>
                <small>{r.position_at ? 'Seen ' + date(r.position_at) : 'Location not shared'}</small>
              </span>
            ),
          },
          {
            key: 'deliveries',
            header: 'Delivered',
            sort: (r) => r.delivered,
            render: (r) => (
              <span className="cell-stack">
                <strong>{r.delivered}</strong>
                <small>{r.last_delivery_at ? 'Last ' + date(r.last_delivery_at) : 'None yet'}</small>
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
                <small className={r.cash_in_hand > 0 ? 'warn-text' : ''}>
                  {r.cash_in_hand > 0 ? money(r.cash_in_hand) + ' COD in hand' : commissionText(r)}
                </small>
              </span>
            ),
          },
          {
            key: 'duty',
            header: 'On duty',
            render: (r) => <Toggle checked={!!r.available} disabled={!r.active} onChange={(v) => setDuty(r, v)} />,
          },
          {
            key: 'active',
            header: 'Active',
            render: (r) => <Toggle checked={!!r.active} onChange={(v) => setActive(r, v)} />,
          },
        ]}
        actions={(r) => (
          <>
            <IconAction label="View rider" onClick={() => setView(r.id)}>
              <Eye size={16} />
            </IconAction>
            <IconAction label="Edit rider" onClick={() => start(r)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction label="Earnings & payouts" onClick={() => setStatement(r)}>
              <Wallet size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!current} onClose={() => setView(null)} title={current ? 'Rider · ' + current.name : 'Rider'} size="xl">
        {current && (
          <RiderPanel
            rider={current}
            area={areaName(current.location_id)}
            onDuty={(v) => setDuty(current, v)}
            onActive={(v) => setActive(current, v)}
            onCapacity={(n) => quick(current, { capacity: n }, `${current.name} can carry ${n} order${n === 1 ? '' : 's'} at once.`)}
            onEdit={() => {
              setView(null);
              start(current);
            }}
            onStatement={() => {
              setView(null);
              setStatement(current);
            }}
          />
        )}
      </Modal>
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
              <h4 className="span-2 form-section">Rider profile</h4>
              <label>
                Full name
                <input required maxLength={100} value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                Phone
                <input required type="tel" value={edit.phone} onChange={(e) => set('phone', e.target.value)} placeholder="03XXXXXXXXX" />
              </label>
              <label>
                CNIC <span className="muted">(optional)</span>
                <input
                  value={edit.cnic}
                  pattern="(\d{5}-?\d{7}-?\d)?"
                  title="13 digits, for example 37405-1234567-1"
                  onChange={(e) => set('cnic', e.target.value)}
                  placeholder="37405-1234567-1"
                />
              </label>
              <label>
                Email <span className="muted">(optional)</span>
                <input type="email" value={edit.email} onChange={(e) => set('email', e.target.value)} />
              </label>
              <label className="span-2">
                Home address <span className="muted">(optional)</span>
                <input maxLength={500} value={edit.address} onChange={(e) => set('address', e.target.value)} />
              </label>

              <h4 className="span-2 form-section">Vehicle</h4>
              <label>
                Vehicle
                <select value={edit.vehicle_type} onChange={(e) => set('vehicle_type', e.target.value)}>
                  {Object.entries(vehicles).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {!['bicycle', 'on_foot'].includes(edit.vehicle_type) && (
                <>
                  <label>
                    Number plate <span className="muted">(optional)</span>
                    <input
                      maxLength={20}
                      value={edit.vehicle_number}
                      onChange={(e) => set('vehicle_number', e.target.value.toUpperCase())}
                      placeholder="RIK-1234"
                    />
                  </label>
                  <label>
                    Driving licence number <span className="muted">(optional)</span>
                    <input maxLength={30} value={edit.license_number} onChange={(e) => set('license_number', e.target.value)} />
                  </label>
                </>
              )}

              <h4 className="span-2 form-section">Dispatch</h4>
              <label>
                Delivery area
                <select value={edit.location_id} onChange={(e) => set('location_id', e.target.value)}>
                  {locations.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <small>The rider is offered orders from this area only.</small>
              </label>
              <label>
                Orders at once
                <input
                  required
                  type="number"
                  min={1}
                  max={50}
                  value={edit.capacity}
                  onChange={(e) => set('capacity', e.target.value)}
                />
                <small>The rider cannot be sent more active orders than this.</small>
              </label>

              <h4 className="span-2 form-section">Emergency contact</h4>
              <label>
                Contact name <span className="muted">(optional)</span>
                <input maxLength={100} value={edit.emergency_name} onChange={(e) => set('emergency_name', e.target.value)} />
              </label>
              <label>
                Contact phone <span className="muted">(optional)</span>
                <input type="tel" value={edit.emergency_phone} onChange={(e) => set('emergency_phone', e.target.value)} />
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
                    onClick={() =>
                      edit.commission_type !== v &&
                      setEdit({ ...edit, commission_type: v, commission_value: v === 'fixed' ? 100 : 80 })
                    }
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
            <div className="form-grid">
              <h4 className="span-2 form-section">Payout account</h4>
              <label>
                Usual payout method
                <select value={edit.payout_method} onChange={(e) => set('payout_method', e.target.value)}>
                  {Object.entries(payoutLabels).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {edit.payout_method !== 'cash' && (
                <>
                  <label>
                    {edit.payout_method === 'wallet' ? 'Wallet' : 'Bank'} <span className="muted">(optional)</span>
                    <input
                      maxLength={100}
                      value={edit.payout_bank}
                      onChange={(e) => set('payout_bank', e.target.value)}
                      placeholder={edit.payout_method === 'wallet' ? 'e.g. JazzCash' : 'e.g. Meezan Bank'}
                    />
                  </label>
                  <label>
                    Account title
                    <input maxLength={100} value={edit.payout_title} onChange={(e) => set('payout_title', e.target.value)} />
                  </label>
                  <label>
                    {edit.payout_method === 'bank' ? 'Account number or IBAN' : edit.payout_method === 'raast' ? 'Raast ID' : 'Wallet number'}
                    <input maxLength={40} value={edit.payout_account} onChange={(e) => set('payout_account', e.target.value)} />
                  </label>
                </>
              )}

              <h4 className="span-2 form-section">Portal login</h4>
              <label>
                Rider ID
                <input
                  required
                  pattern="[A-Z0-9-]{3,30}"
                  value={edit.login_id}
                  onChange={(e) => set('login_id', e.target.value.toUpperCase())}
                  placeholder="DRV-003"
                />
                <small>The rider signs in with this ID.</small>
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
                <small>{edit.id ? 'Leave blank to keep the current password.' : 'At least 10 characters.'}</small>
              </label>
              <label className="span-2">
                Internal notes <span className="muted">(optional, administrators only)</span>
                <textarea rows={2} maxLength={2000} value={edit.notes} onChange={(e) => set('notes', e.target.value)} />
              </label>
            </div>
            <div className="toggle-list">
              <Toggle checked={!!edit.active} onChange={(v) => set('active', v ? 1 : 0)} label="Account active (the rider can sign in)" />
              <Toggle
                checked={!!edit.available}
                onChange={(v) => set('available', v ? 1 : 0)}
                label="On duty (the rider can also change this from their portal)"
              />
            </div>
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

/** Everything about one rider: who they are, what they are doing, what they are owed. */
function RiderPanel({
  rider: r,
  area,
  onDuty,
  onActive,
  onCapacity,
  onEdit,
  onStatement,
}: {
  rider: AdminRider;
  area: string;
  onDuty: (v: boolean) => void;
  onActive: (v: boolean) => void;
  onCapacity: (n: number) => void;
  onEdit: () => void;
  onStatement: () => void;
}) {
  const duty = riderDuty(r);
  const facts = (rows: [string, string, boolean?][]) => {
    const shown = rows.filter(([, v]) => v);
    return shown.length ? (
      <dl className="op-kv">
        {shown.map(([k, v, copy]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>
              <span className={copy ? 'mono' : ''}>{v}</span>
              {copy && <CopyButton value={v} label={k.toLowerCase()} />}
            </dd>
          </Fragment>
        ))}
      </dl>
    ) : (
      <small className="muted">Nothing recorded yet.</small>
    );
  };
  return (
    <div className="order-panel">
      <div className="op-hero">
        <div className="op-hero-top">
          <div className="panel-badges">
            <Badge tone={duty.tone}>{duty.text}</Badge>
            <Badge tone="neutral">{vehicles[r.vehicle_type] || r.vehicle_type}</Badge>
            {r.pending_payouts > 0 && <Badge tone="warn">Payout requested</Badge>}
          </div>
          <span className="op-ref">
            <Hash size={14} />
            {r.login_id}
            <CopyButton value={r.login_id || ''} label="rider ID" />
          </span>
        </div>
        <div className="op-meta">
          <MetaItem icon={<MapPin size={17} />} label="Area">
            {area}
          </MetaItem>
          <MetaItem icon={<Truck size={17} />} label="Load">
            {r.active_orders} of {r.capacity}
          </MetaItem>
          <MetaItem icon={<Check size={17} />} label="Delivered">
            {r.delivered}
          </MetaItem>
          <MetaItem icon={<Wallet size={17} />} label="Commission owed" tone="brand">
            {money(r.balance)}
          </MetaItem>
        </div>
      </div>

      {r.cash_in_hand > 0 && (
        <div className="alert warn">
          <HandCoins size={16} /> Holding {money(r.cash_in_hand)} of COD cash that has not been handed over yet.
        </div>
      )}

      <div className="op-grid">
        <div className="op-col">
          <PanelSection icon={<UserRound size={16} />} title="Contact">
            <div className="op-person">
              <span className="op-avatar">{r.name.slice(0, 1).toUpperCase()}</span>
              <span className="op-person-text">
                <strong>{r.name}</strong>
                <small>{r.phone}</small>
              </span>
              <a className="op-chip" href={'tel:' + r.phone}>
                <Phone size={13} /> Call
              </a>
            </div>
            {facts([
              ['Email', r.email],
              ['Address', r.address],
              ['Joined', date(r.created_at)],
            ])}
          </PanelSection>
          <PanelSection icon={<IdCard size={16} />} title="Vehicle and identity">
            {facts([
              ['Vehicle', vehicles[r.vehicle_type] || r.vehicle_type],
              ['Number plate', r.vehicle_number, true],
              ['Licence', r.license_number, true],
              ['CNIC', r.cnic, true],
            ])}
          </PanelSection>
          <PanelSection
            icon={<Siren size={16} />}
            title="Emergency contact"
            aside={
              r.emergency_phone ? (
                <a className="op-chip" href={'tel:' + r.emergency_phone}>
                  <Phone size={13} /> Call
                </a>
              ) : undefined
            }
          >
            {facts([
              ['Name', r.emergency_name],
              ['Phone', r.emergency_phone],
            ])}
          </PanelSection>
          {r.notes && (
            <PanelSection icon={<StickyNote size={16} />} title="Internal notes">
              <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {r.notes}
              </p>
            </PanelSection>
          )}
        </div>
        <div className="op-col">
          <PanelSection icon={<Bike size={16} />} title="Dispatch controls">
            <div className="toggle-list">
              <Toggle checked={!!r.active} onChange={onActive} label="Account active" />
              <Toggle checked={!!r.available} disabled={!r.active} onChange={onDuty} label="On duty and accepting deliveries" />
              <label className="load">
                Orders at once
                <select aria-label="Orders at once" value={r.capacity} onChange={(e) => onCapacity(Number(e.target.value))}>
                  {Array.from({ length: Math.max(20, r.capacity) }, (_, i) => i + 1).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          </PanelSection>
          <PanelSection icon={<Percent size={16} />} title="Earnings">
            {facts([
              ['Commission', commissionText(r)],
              ['Earned', money(r.earned)],
              ['Paid out', money(r.paid)],
              ['Requested', r.pending_payouts ? money(r.pending_payouts) : ''],
              ['Last delivery', r.last_delivery_at ? date(r.last_delivery_at) : ''],
            ])}
          </PanelSection>
          <PanelSection icon={<Landmark size={16} />} title="Payout account">
            {facts([
              ['Method', payoutLabels[r.payout_method] || r.payout_method],
              ['Bank or wallet', r.payout_method === 'cash' ? '' : r.payout_bank],
              ['Account title', r.payout_method === 'cash' ? '' : r.payout_title],
              ['Account', r.payout_method === 'cash' ? '' : r.payout_account, true],
            ])}
          </PanelSection>
          <PanelSection
            icon={<Navigation size={16} />}
            title="Last position"
            aside={
              r.position_at ? (
                <small className="muted">
                  <Clock size={12} /> {date(r.position_at)}
                  {r.accuracy != null && ' · ±' + Math.round(r.accuracy) + ' m'}
                </small>
              ) : undefined
            }
          >
            {r.lat != null && r.lng != null ? (
              <DeliveryMap lat={r.lat} lng={r.lng} />
            ) : (
              <small className="muted">Riders share their position only while they have an active delivery.</small>
            )}
          </PanelSection>
        </div>
      </div>
      <div className="panel-actions op-actions">
        <button className="button ghost" onClick={onStatement}>
          <Wallet size={16} /> Earnings & payouts
        </button>
        <button className="button" onClick={onEdit}>
          <Edit3 size={16} /> Edit rider
        </button>
      </div>
    </div>
  );
}

/** Whether no active rider is on duty in an area that takes orders: nothing there can be dispatched. */
const noRider = (a: AdminArea) => !!a.active && a.riders_on_duty === 0;
function LocationManager() {
  const { notice } = useApp();
  const { range, setRange, query, key, label: rangeText } = useRange('7d');
  const { data, setData, error, loading, refresh } = useData<AdminArea[]>(
    '/admin/area-settings' + query,
    60000,
    'areas:' + key,
  );
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [remove, setRemove] = useState<AdminArea | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const paisa = (v: unknown) => Math.round(Number(v) * 100);
  function start(a?: AdminArea) {
    setFormError('');
    setEdit(
      a
        ? {
            ...a,
            active: !!a.active,
            fee: a.fee / 100,
            minimum_order: a.minimum_order / 100,
            free_delivery_over: a.free_delivery_over / 100,
          }
        : {
            name: '',
            lat: 33.6442,
            lng: 73.0713,
            radius: 8,
            fee: 150,
            minimum_order: 0,
            free_delivery_over: 0,
            opens_at: '',
            closes_at: '',
            active: true,
          },
    );
  }
  // One request saves the area with all of its settings.
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await api('/admin/locations' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: edit.name,
          lat: Number(edit.lat),
          lng: Number(edit.lng),
          active: !!edit.active,
          radius: Number(edit.radius),
          fee: paisa(edit.fee),
          minimum_order: paisa(edit.minimum_order),
          free_delivery_over: paisa(edit.free_delivery_over),
          opens_at: edit.opens_at,
          closes_at: edit.closes_at,
        }),
      });
      setEdit(null);
      refresh();
      notice('Delivery area saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips the switch at once and saves just that; the list reloads only if the save fails. */
  async function setActive(a: AdminArea, v: boolean) {
    setData((rows) => rows && rows.map((x) => (x.id === a.id ? { ...x, active: v ? 1 : 0 } : x)));
    try {
      await api('/admin/area-settings/' + a.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
      notice(v ? `${a.name} is taking orders again.` : `Delivery paused in ${a.name}.`);
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  const set = (k: string, v: unknown) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const list = data || [];
  const live = list.filter((a) => a.active);
  const statsBusy = loading && !data;
  const sum = (get: (a: AdminArea) => number) => list.reduce((n, a) => n + (get(a) || 0), 0);
  const inUse = (a: AdminArea) => a.outlets + a.products + a.riders + a.orders + a.active_orders > 0;
  return (
    <div className="stack">
      <FilterBar title="Delivery areas" hint={`Showing ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<MapPin size={20} />}
          label="Delivery areas"
          value={list.length}
          hint={`${live.length} taking orders · ${list.length - live.length} paused · live`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<ClipboardList size={20} />}
          label="Orders"
          value={sum((a) => a.orders)}
          hint={`${sum((a) => a.active_orders)} in progress now`}
          tone="orange"
          loading={loading}
        />
        <Stat
          icon={<Banknote size={20} />}
          label="Delivered sales"
          value={money(sum((a) => a.sales))}
          hint="Order totals delivered in this period"
          tone="green"
          loading={loading}
        />
        <Stat
          icon={<Bike size={20} />}
          label="Riders on duty"
          value={sum((a) => a.riders_on_duty)}
          hint={`of ${sum((a) => a.riders)} active riders · live`}
          tone="purple"
          loading={statsBusy}
        />
        <Stat
          icon={<Truck size={20} />}
          label="Areas without a rider"
          value={list.filter(noRider).length}
          hint="Taking orders with nobody on duty · live"
          tone="red"
          quiet={!list.some(noRider)}
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(l) => l.id}
        search={(l) => l.name}
        searchPlaceholder="Search areas"
        empty="No delivery areas yet. Add one so customers can order."
        toolbar={
          <button className="button" onClick={() => start()}>
            <Plus size={16} /> Add area
          </button>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'on', label: 'Taking orders' },
              { value: 'off', label: 'Paused' },
            ],
            test: (l, v) => (v === 'on' ? !!l.active : !l.active),
          },
          {
            key: 'riders',
            label: 'Rider cover',
            options: [
              { value: 'yes', label: 'Rider on duty' },
              { value: 'no', label: 'No rider on duty' },
            ],
            test: (l, v) => (v === 'yes') === l.riders_on_duty > 0,
          },
          {
            key: 'hours',
            label: 'Delivery hours',
            options: [
              { value: 'always', label: 'Open 24 hours' },
              { value: 'limited', label: 'Limited hours' },
            ],
            test: (l, v) => (v === 'limited') === !!openingHours(l),
          },
          {
            key: 'fee',
            label: 'Fees',
            options: [
              { value: 'free', label: 'Free delivery offered' },
              { value: 'minimum', label: 'Has a minimum order' },
            ],
            test: (l, v) => (v === 'free' ? l.fee === 0 || l.free_delivery_over > 0 : l.minimum_order > 0),
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Area',
            sort: (l) => l.name.toLowerCase(),
            render: (l) => (
              <span className="cell-main">
                <span className="n-icon order">
                  <MapPin size={15} />
                </span>
                <span className="cell-stack">
                  <strong>{l.name}</strong>
                  <small>
                    {l.lat.toFixed(4)}, {l.lng.toFixed(4)}
                  </small>
                </span>
              </span>
            ),
          },
          {
            key: 'radius',
            header: 'Coverage',
            sort: (l) => l.radius,
            render: (l) => (
              <span className="cell-stack">
                <span>{l.radius} km radius</span>
                <small>{openingHours(l) || 'Open 24 hours'}</small>
              </span>
            ),
          },
          {
            key: 'fee',
            header: 'Delivery fee',
            sort: (l) => l.fee,
            render: (l) => (
              <span className="cell-stack">
                <strong>{l.fee ? money(l.fee) : 'Free'}</strong>
                <small>
                  {[
                    l.fee > 0 && l.free_delivery_over > 0 && 'Free over ' + money(l.free_delivery_over),
                    l.minimum_order > 0 && 'Min. order ' + money(l.minimum_order),
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No minimum'}
                </small>
              </span>
            ),
          },
          {
            key: 'outlets',
            header: 'Outlets',
            sort: (l) => l.outlets,
            render: (l) => (
              <span className="cell-stack">
                <span>{l.outlets ? l.outlets : <span className="muted">None</span>}</span>
                <small>
                  {l.products} product{l.products === 1 ? '' : 's'}
                </small>
              </span>
            ),
          },
          {
            key: 'riders',
            header: 'Riders on duty',
            sort: (l) => l.riders_on_duty,
            render: (l) => (
              <span className="cell-stack">
                <span className={noRider(l) ? 'warn-text' : ''}>
                  {l.riders_on_duty} of {l.riders}
                </span>
                {noRider(l) && <small>Orders cannot be dispatched</small>}
              </span>
            ),
          },
          {
            key: 'orders',
            header: 'Orders',
            sort: (l) => l.orders,
            render: (l) => (
              <span className="cell-stack">
                <strong>{l.orders}</strong>
                <small>{l.active_orders ? l.active_orders + ' in progress' : money(l.sales) + ' delivered'}</small>
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Taking orders',
            render: (l) => <Toggle checked={!!l.active} onChange={(v) => setActive(l, v)} />,
          },
        ]}
        actions={(l) => (
          <>
            <IconAction label="Edit area" onClick={() => start(l)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction label="Delete area" tone="danger" onClick={() => setRemove(l)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <FormModal
        open={!!edit}
        title={edit?.id ? 'Edit delivery area' : 'Add delivery area'}
        onClose={() => setEdit(null)}
        onSubmit={save}
        busy={busy}
        error={formError}
        submit="Save area"
      >
        {edit && (
          <>
            <div className="form-grid">
              <h4 className="span-2 form-section">Area and coverage</h4>
              <label>
                Area name
                <input required maxLength={150} value={edit.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                Radius (km)
                <input type="number" required min="0.1" max="100" step="0.1" value={edit.radius} onChange={(e) => set('radius', e.target.value)} />
                <small>Delivery pins further than this from the centre are refused.</small>
              </label>
            </div>
            <DeliveryMap
              lat={Number(edit.lat)}
              lng={Number(edit.lng)}
              radiusKm={Number(edit.radius)}
              onChange={(lat, lng) => setEdit((e) => (e ? { ...e, lat, lng } : e))}
            />
            <div className="form-grid">
              <label>
                Centre latitude
                <input type="number" required min="-90" max="90" step="any" value={edit.lat} onChange={(e) => set('lat', e.target.value)} />
              </label>
              <label>
                Centre longitude
                <input type="number" required min="-180" max="180" step="any" value={edit.lng} onChange={(e) => set('lng', e.target.value)} />
              </label>

              <h4 className="span-2 form-section">Fees</h4>
              <label>
                Delivery fee (PKR)
                <input type="number" required min="0" step="1" value={edit.fee} onChange={(e) => set('fee', e.target.value)} />
              </label>
              <label>
                Free delivery from (PKR)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={edit.free_delivery_over}
                  onChange={(e) => set('free_delivery_over', e.target.value)}
                />
                <small>Orders with at least this item subtotal pay no delivery fee. 0 always charges the fee.</small>
              </label>
              <label>
                Minimum order (PKR)
                <input type="number" min="0" step="1" value={edit.minimum_order} onChange={(e) => set('minimum_order', e.target.value)} />
                <small>Item subtotal needed to check out here. 0 applies only the store-wide minimum.</small>
              </label>

              <h4 className="span-2 form-section">Delivery hours</h4>
              <label>
                Opens at
                <input type="time" value={edit.opens_at} onChange={(e) => set('opens_at', e.target.value)} />
              </label>
              <label>
                Closes at
                <input type="time" value={edit.closes_at} onChange={(e) => set('closes_at', e.target.value)} />
              </label>
              <small className="span-2 muted">
                Pakistan time. Checkout is refused outside these hours; closing may be after midnight.{' '}
                {edit.opens_at || edit.closes_at ? (
                  <button type="button" className="link" onClick={() => setEdit({ ...edit, opens_at: '', closes_at: '' })}>
                    Clear to deliver 24 hours
                  </button>
                ) : (
                  'Leave both empty to deliver 24 hours.'
                )}
              </small>
            </div>
            {Number(edit.free_delivery_over) > 0 && (
              <div className="alert info">
                <Bike size={16} /> Riders paid a percentage of the delivery fee earn nothing on a free delivery. Use a fixed
                commission for riders in this area if that matters.
              </div>
            )}
            <Toggle
              checked={!!edit.active}
              onChange={(v) => set('active', v)}
              label="Taking orders (paused areas disappear from the area picker)"
            />
          </>
        )}
      </FormModal>
      <Confirm
        open={!!remove}
        title="Delete delivery area?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/locations/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Delivery area deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {remove && inUse(remove)
          ? `“${remove.name}” still has outlets, products, riders or orders, so it cannot be deleted. Pause it instead to stop new orders.`
          : `“${remove?.name}” will be removed permanently. Areas that customers, outlets or orders refer to cannot be deleted.`}
      </Confirm>
    </div>
  );
}

