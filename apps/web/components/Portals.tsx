'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState, type FormEvent } from 'react';
import {
  LayoutDashboard,
  Package,
  Store,
  Bike,
  ImageIcon,
  Mail,
  MapPin,
  Plus,
  Edit3,
  Trash2,
  Upload,
  Download,
  ArrowUpRight,
  LogOut,
  RefreshCw,
  Phone,
  Navigation,
  Wallet,
  ShieldCheck,
  Search,
  UserRound,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Product, Outlet, Order, User, Ad, Location } from '@/lib/types';
import { Loading, ErrorBox, Empty, Modal } from './UI';
import { Countdown } from './Orders';
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map…</div>,
});
const navItems = [
  ['overview', 'Overview', LayoutDashboard],
  ['orders', 'Orders', Package],
  ['products', 'Products', ShoppingIcon],
  ['outlets', 'Outlets', Store],
  ['riders', 'Riders', Bike],
  ['locations', 'Delivery areas', MapPin],
  ['ads', 'Advertising', ImageIcon],
  ['messages', 'Messages', Mail],
] as const;
function ShoppingIcon(props: { size?: number }) {
  return <Package {...props} />;
}
export default function Portal({ role }: { role: 'admin' | 'outlet' | 'rider' }) {
  const { user, ready, logout } = useApp();
  const [tab, setTab] = useState(role === 'admin' ? 'overview' : 'orders');
  const [filter, setFilter] = useState('');
  if (!ready) return <Loading />;
  if (!user)
    return (
      <div className="container page">
        <Empty
          title={
            role === 'admin'
              ? 'Dellvit administration'
              : role === 'outlet'
                ? 'Your outlet, all in one place.'
                : 'Ready for your next delivery?'
          }
          href={
            '/login?next=' + encodeURIComponent(role === 'admin' ? '/admin' : '/portal/' + role)
          }
          action="Log in to your portal"
        >
          Use your assigned{' '}
          {role === 'outlet' ? 'customer ID' : role === 'rider' ? 'rider ID' : 'admin email'} and
          password to continue.
        </Empty>
      </div>
    );
  if (user.role !== role)
    return (
      <div className="container page">
        <ErrorBox
          error={`This portal is for ${role} accounts. You are signed in as ${user.role}.`}
        />
        <Link className="button" href="/account">
          Manage your account
        </Link>
      </div>
    );
  const nav =
    role === 'admin'
      ? navItems
      : role === 'outlet'
        ? navItems.filter((x) => ['orders', 'products'].includes(x[0]))
        : navItems.filter((x) => x[0] === 'orders');
  return (
    <div className="portal">
      <aside className="portal-sidebar">
        <div className="portal-brand">
          <span className="eyebrow accent">DELLVIT WORKSPACE</span>
          <h2>
            {role === 'admin'
              ? 'Mission control'
              : role === 'outlet'
                ? 'Your storefront'
                : 'On the move'}
          </h2>
          <p>{user.name}</p>
        </div>
        <nav aria-label="Portal navigation">
          {nav.map(([key, title, Icon]) => (
            <button
              key={key}
              className={tab === key ? 'selected' : ''}
              onClick={() => {
                setTab(key);
                setFilter('');
              }}
            >
              <Icon size={19} />
              {title}
            </button>
          ))}
          <Link href="/account">
            <UserRound size={19} />
            Account settings
          </Link>
        </nav>
        <div className="portal-sidebar-bottom">
          <Link href="/">
            View Dellvit <ArrowUpRight size={16} />
          </Link>
          <button onClick={logout}>
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </aside>
      <div className="portal-main">
        <header className="portal-heading">
          <div>
            <div className="eyebrow muted">{role} portal</div>
            <h1>
              {tab === 'overview'
                ? 'A view of your everyday.'
                : tab === 'orders' && role === 'rider'
                  ? 'Your delivery board.'
                  : label(tab) + '.'}
            </h1>
          </div>
          <span className="workspace-badge">
            <ShieldCheck size={15} />
            {role === 'admin' ? 'Administrator' : role === 'outlet' ? user.login_id : 'Rider'}
          </span>
        </header>
        {tab === 'overview' ? (
          <Overview onOrders={() => setTab('orders')} />
        ) : tab === 'orders' ? (
          <OrderManager role={role} />
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
        ) : (
          <Messages />
        )}
      </div>
    </div>
  );
}
function Overview({ onOrders }: { onOrders: () => void }) {
  const { data, error, loading } = useData<{
    orders: number;
    revenue: number;
    active_orders: number;
    outlets: number;
  }>('/admin/summary', 20000);
  const { data: orders } = useData<Order[]>('/orders', 20000);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="stats-grid">
        {[
          [Package, 'Total orders', data?.orders || 0],
          [Wallet, 'Delivered sales', money(data?.revenue || 0)],
          [Bike, 'In progress', data?.active_orders || 0],
          [Store, 'Active outlets', data?.outlets || 0],
        ].map(([Icon, title, value]) => {
          const I = Icon as typeof Package;
          return (
            <div className="stat-card" key={String(title)}>
              <span>
                <I size={21} />
              </span>
              <small>{String(title)}</small>
              <strong>{String(value)}</strong>
            </div>
          );
        })}
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>Latest orders</h2>
          <button className="text-button" onClick={onOrders}>
            Manage orders <ArrowUpRight size={17} />
          </button>
        </div>
        {!orders?.length ? (
          <Empty title="Your order board is ready.">
            New orders appear here as soon as customers check out.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Outlet</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 8).map((o) => (
                  <tr key={o.id}>
                    <td>{o.reference}</td>
                    <td>{o.name}</td>
                    <td>{o.outlet.name}</td>
                    <td>{money(o.total)}</td>
                    <td>
                      <span className={'status ' + o.status}>{label(o.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="portal-tip">
        <ShieldCheck size={22} />
        <p>
          Outlet documents stay in administration. Customers receive their own delivery code; riders
          verify it when handing over an order.
        </p>
      </div>
    </>
  );
}
function OrderManager({ role }: { role: string }) {
  const { notice } = useApp();
  const { data, loading, error, refresh } = useData<Order[]>('/orders', 10000);
  const { data: riders } = useData<User[]>(role === 'admin' ? '/admin/riders' : null);
  const [status, setStatus] = useState('active');
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [cash, setCash] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const current = data?.find((o) => o.id === selected);
  const rows = (data || []).filter(
    (o) =>
      (status === 'all' ||
        (status === 'active' && !['delivered', 'cancelled'].includes(o.status)) ||
        o.status === status) &&
      `${o.reference} ${o.name} ${o.outlet.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function change(o: Order, s: string) {
    setBusy(true);
    try {
      await api('/orders/' + o.id + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status: s }),
      });
      refresh();
      setConfirmCancel(false);
      notice('Order updated.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    try {
      await api('/orders/' + current.id + '/verify', {
        method: 'POST',
        body: JSON.stringify({ otp, cash_received: cash }),
      });
      setOtp('');
      setCash(false);
      refresh();
      notice('Delivery verified. Great work!');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function assign(oid: string, rid: string) {
    if (!rid) return;
    setBusy(true);
    try {
      await api('/admin/orders/' + oid + '/assign', {
        method: 'PATCH',
        body: JSON.stringify({ rider_id: rid }),
      });
      refresh();
      notice('Rider assigned.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="manage-toolbar">
        <div className="search-input">
          <Search size={18} />
          <input
            aria-label="Search orders"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order number, customer…"
          />
        </div>
        <select
          aria-label="Order status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            'active',
            'all',
            'placed',
            'confirmed',
            'preparing',
            'ready',
            'picked_up',
            'delivered',
            'cancelled',
          ].map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <button className="icon-button" aria-label="Refresh orders" onClick={refresh}>
          <RefreshCw size={19} />
        </button>
      </div>
      {error && <ErrorBox error={error} retry={refresh} />}{' '}
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={role === 'rider' ? 'No deliveries in this view.' : 'No orders in this view.'}>
          New orders will appear automatically. Try another status filter.
        </Empty>
      ) : (
        <div className="portal-order-grid">
          {rows.map((o) => (
            <button
              className="dispatch-card"
              key={o.id}
              onClick={() => {
                setSelected(o.id);
                setOtp('');
                setCash(false);
              }}
            >
              <div className="section-head">
                <strong>{o.reference}</strong>
                <span className={'status ' + o.status}>{label(o.status)}</span>
              </div>
              <h3>{o.outlet.name}</h3>
              <p>
                <MapPin size={16} />
                {o.address}
              </p>
              <div className="dispatch-bottom">
                <span>
                  {money(o.total)} <small>COD</small>
                </span>
                <small>
                  <Countdown
                    deadline={o.deliver_by}
                    done={['delivered', 'cancelled'].includes(o.status)}
                  />
                </small>
              </div>
              <span className="text-button">
                {role === 'rider' ? 'View delivery' : 'Manage order'} <ArrowUpRight size={17} />
              </span>
            </button>
          ))}
        </div>
      )}
      <Modal
        open={!!current}
        onClose={() => setSelected(null)}
        title={current?.reference || 'Order'}
      >
        {current && (
          <div className="form-stack">
            <div className="section-head">
              <span className={'status ' + current.status}>{label(current.status)}</span>
              <strong>{money(current.total)} COD</strong>
            </div>
            <div className="route-address">
              <span className="pickup-dot" />
              <div>
                <small>PICKUP</small>
                <h3>{current.outlet.name}</h3>
                <p>{current.outlet.address}</p>
                <a className="accent" href={'tel:' + current.outlet.phone}>
                  {current.outlet.phone}
                </a>
              </div>
            </div>
            <div className="route-address">
              <span className="drop-dot" />
              <div>
                <small>DELIVER TO</small>
                <h3>{current.name}</h3>
                <p>{current.address}</p>
                <a className="accent" href={'tel:' + current.phone}>
                  {current.phone}
                </a>
                <p className="small-muted">{current.email}</p>
              </div>
            </div>
            {current.notes && (
              <div className="notes-box">
                <strong>Customer notes</strong>
                <p>{current.notes}</p>
              </div>
            )}
            <div className="line-item">
              <span>Time to deliver</span>
              <strong>
                <Countdown
                  deadline={current.deliver_by}
                  done={['delivered', 'cancelled'].includes(current.status)}
                />
              </strong>
            </div>
            {current.items.map((i) => (
              <div className="line-item" key={i.id}>
                <span>
                  {i.quantity} × {i.name}
                </span>
                <strong>{money(i.unit_price * i.quantity)}</strong>
              </div>
            ))}
            {role === 'admin' && (
              <label>
                Assigned rider
                <select
                  value={current.rider_id || ''}
                  disabled={busy || ['delivered', 'cancelled'].includes(current.status)}
                  onChange={(e) => assign(current.id, e.target.value)}
                >
                  <option value="">Awaiting assignment</option>
                  {riders
                    ?.filter((r) => r.location_id === current.location_id && r.active)
                    .map((r) => (
                      <option value={r.id} key={r.id}>
                        {r.name} · {r.login_id}
                      </option>
                    ))}
                </select>
                <small>Only active riders in this delivery area are listed.</small>
              </label>
            )}
            {role === 'rider' && (
              <>
                <DeliveryMap lat={current.lat} lng={current.lng} pickup={current.outlet} />
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=${current.outlet.lat},${current.outlet.lng}&destination=${current.lat},${current.lng}&travelmode=driving`}
                  target="_blank"
                  rel="noreferrer"
                  className="button secondary"
                >
                  <Navigation size={18} />
                  Open navigation
                </a>
              </>
            )}
            {['admin', 'outlet'].includes(role) &&
              ['placed', 'confirmed', 'preparing'].includes(current.status) && (
                <button
                  disabled={busy}
                  className="button full"
                  onClick={() =>
                    change(
                      current,
                      (
                        {
                          placed: 'confirmed',
                          confirmed: 'preparing',
                          preparing: 'ready',
                        } as Record<string, string>
                      )[current.status],
                    )
                  }
                >
                  {
                    (
                      {
                        placed: 'Accept order',
                        confirmed: 'Start preparing',
                        preparing: 'Mark ready for pickup',
                      } as Record<string, string>
                    )[current.status]
                  }
                </button>
              )}
            {['rider', 'admin'].includes(role) && current.status === 'ready' && (
              <button
                disabled={busy}
                className="button full"
                onClick={() => change(current, 'picked_up')}
              >
                Confirm pickup
              </button>
            )}
            {role === 'rider' && current.status === 'picked_up' && (
              <form onSubmit={verify} className="otp-form">
                <h3>
                  <ShieldCheck size={20} />
                  Complete delivery
                </h3>
                <p>
                  Collect {money(current.total)} and ask the customer for their six-digit delivery
                  code.
                </p>
                <label className="check-label">
                  <input
                    required
                    type="checkbox"
                    checked={cash}
                    onChange={(e) => setCash(e.target.checked)}
                  />
                  I collected {money(current.total)} in cash
                </label>
                <label>
                  Customer delivery code
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    autoComplete="one-time-code"
                    placeholder="000000"
                  />
                </label>
                <button className="button full" disabled={busy}>
                  Verify & complete delivery
                </button>
              </form>
            )}
            {role === 'admin' &&
              ['placed', 'confirmed'].includes(current.status) &&
              (!confirmCancel ? (
                <button className="text-button" onClick={() => setConfirmCancel(true)}>
                  Cancel order
                </button>
              ) : (
                <div className="error-box">
                  Cancel and restore reserved stock?
                  <div className="form-actions">
                    <button className="button secondary" onClick={() => setConfirmCancel(false)}>
                      Keep order
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => change(current, 'cancelled')}
                    >
                      Confirm cancellation
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Modal>
    </>
  );
}
function ImageUpload({
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
      <div className="upload-previews">
        {value.map((url, i) => (
          <div key={url + i}>
            <img src={url} alt={'Uploaded image ' + (i + 1)} width="90" height="90" />
            {multiple && value.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => i !== j))}
                aria-label={'Remove image ' + (i + 1)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <label className="upload-button">
        <Upload size={17} />
        {busy ? 'Converting to WebP…' : multiple ? 'Add product image' : 'Upload image'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </label>
      <small>PNG, JPEG or WebP · Up to 8 MB · Saved as WebP</small>
    </div>
  );
}
const newProduct = {
  name: '',
  description: '',
  category: 'Food',
  price: 0,
  stock: 0,
  unit: '1 item',
  location_id: '',
  discount: 0,
  deal: '',
  images: ['/images/food.webp'],
  includes: '',
  excludes: '',
  delivery_minutes: 30,
  outlet_id: '',
  active: 1,
};
function ProductManager({ admin }: { admin: boolean }) {
  const { locations, notice } = useApp();
  const { data, loading, error, refresh } = useData<Product[]>('/manage/products');
  const { data: outlets } = useData<Outlet[]>(admin ? '/admin/outlets' : null);
  const { data: own } = useData<Outlet>(!admin ? '/manage/outlet' : null);
  const [edit, setEdit] = useState<(typeof newProduct & { id?: string }) | null>(null);
  const [remove, setRemove] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [q, setQ] = useState('');
  function start(p?: Product) {
    setFormError('');
    setEdit(
      p
        ? { ...p, price: p.price / 100 }
        : {
            ...newProduct,
            location_id: own?.location_id || locations[0]?.id || '',
            outlet_id: own?.id || outlets?.[0]?.id || '',
          },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await api('/manage/products' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...edit, price: Math.round(edit.price * 100) }),
      });
      setEdit(null);
      refresh();
      notice('Product saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!remove) return;
    setBusy(true);
    try {
      await api('/manage/products/' + remove.id, { method: 'DELETE' });
      setRemove(null);
      refresh();
      notice('Product removed from the shop.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = data?.filter((p) =>
    `${p.name} ${p.outlet_name}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="manage-toolbar">
        <div className="search-input">
          <Search size={18} />
          <input
            aria-label="Search products"
            placeholder="Find a product…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button className="button" onClick={() => start()}>
          <Plus size={18} />
          Add product
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Outlet / area</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="table-product">
                      <img src={p.images[0]} alt="" width="48" height="48" />
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.category} · {p.unit}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    {p.outlet_name}
                    <small>{locations.find((l) => l.id === p.location_id)?.name}</small>
                  </td>
                  <td>
                    {money(p.effective_price)}
                    {p.discount > 0 && <small>{p.discount}% off</small>}
                  </td>
                  <td>{p.stock}</td>
                  <td>
                    <span className={'status ' + (p.active ? 'confirmed' : 'cancelled')}>
                      {p.active ? 'Listed' : 'Archived'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="icon-button"
                        aria-label={'Edit ' + p.name}
                        onClick={() => start(p)}
                      >
                        <Edit3 size={17} />
                      </button>
                      {p.active === 1 && (
                        <button
                          className="icon-button"
                          aria-label={'Archive ' + p.name}
                          onClick={() => setRemove(p)}
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows?.length && (
            <Empty title="Your shelf is ready.">Add your first product to start selling.</Empty>
          )}
        </div>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit product' : 'Add a product'}
      >
        {edit && (
          <form onSubmit={save} className="form-stack">
            <ImageUpload
              value={edit.images}
              onChange={(images) => setEdit({ ...edit, images })}
              multiple
            />
            <div className="form-grid">
              <label className="span-2">
                Product name
                <input
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label className="span-2">
                Description
                <textarea
                  required
                  value={edit.description}
                  onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                />
              </label>
              {admin && (
                <label>
                  Outlet
                  <select
                    required
                    value={edit.outlet_id}
                    onChange={(e) => setEdit({ ...edit, outlet_id: e.target.value })}
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
                <select
                  required
                  value={edit.location_id}
                  onChange={(e) => setEdit({ ...edit, location_id: e.target.value })}
                >
                  {locations.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={edit.category}
                  onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                >
                  {['Food', 'Groceries', 'Parcels', 'More'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Price (PKR)
                <input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  value={edit.price}
                  onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })}
                />
              </label>
              <label>
                Available quantity
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={edit.stock}
                  onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value) })}
                />
              </label>
              <label>
                Unit / portion
                <input
                  required
                  value={edit.unit}
                  onChange={(e) => setEdit({ ...edit, unit: e.target.value })}
                />
              </label>
              <label>
                Discount (%)
                <input
                  required
                  type="number"
                  min="0"
                  max="90"
                  value={edit.discount}
                  onChange={(e) => setEdit({ ...edit, discount: Number(e.target.value) })}
                />
              </label>
              <label>
                Delivery time (minutes)
                <input
                  required
                  type="number"
                  min="10"
                  max="240"
                  value={edit.delivery_minutes}
                  onChange={(e) => setEdit({ ...edit, delivery_minutes: Number(e.target.value) })}
                />
              </label>
              <label className="span-2">
                Deal label (optional)
                <input
                  value={edit.deal}
                  onChange={(e) => setEdit({ ...edit, deal: e.target.value })}
                />
              </label>
              <label className="span-2">
                What is included
                <textarea
                  required
                  value={edit.includes}
                  onChange={(e) => setEdit({ ...edit, includes: e.target.value })}
                />
              </label>
              <label className="span-2">
                What is not included
                <textarea
                  required
                  value={edit.excludes}
                  onChange={(e) => setEdit({ ...edit, excludes: e.target.value })}
                />
              </label>
              <label className="check-label span-2">
                <input
                  type="checkbox"
                  checked={!!edit.active}
                  onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })}
                />
                Visible in shop
              </label>
            </div>
            {formError && <ErrorBox error={formError} />}
            <button className="button full" disabled={busy}>
              {busy ? 'Saving…' : 'Save product'}
            </button>
          </form>
        )}
      </Modal>
      <Modal open={!!remove} onClose={() => setRemove(null)} title="Remove this product?">
        <p>{remove?.name} will be hidden from the shop. Existing order history is preserved.</p>
        <div className="form-actions">
          <button className="button secondary" onClick={() => setRemove(null)}>
            Keep product
          </button>
          <button className="button" onClick={archive} disabled={busy}>
            Remove product
          </button>
        </div>
      </Modal>
    </>
  );
}
function OutletManager() {
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
            image: '/images/food.webp',
            category: 'Food',
            active: 1,
          },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      await api('/admin/outlets' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...edit, password: edit.password || undefined }),
      });
      setEdit(null);
      refresh();
      notice('Outlet and its portal account saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="manage-toolbar">
        <p className="muted">Local storefronts and their portal access.</p>
        <button className="button" onClick={() => start()}>
          <Plus size={18} />
          Add outlet
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : (
        <div className="admin-outlet-grid">
          {data?.map((o) => (
            <section className="panel" key={o.id}>
              <div className="table-product">
                <img src={o.image} alt="" width="68" height="68" />
                <div>
                  <span className="eyebrow accent">{o.customer_id}</span>
                  <h3>{o.name}</h3>
                </div>
              </div>
              <p>{o.address}</p>
              <p className="small-muted">
                {o.email}
                <br />
                {o.phone}
              </p>
              <span className={'status ' + (o.active ? 'confirmed' : 'cancelled')}>
                {o.active ? 'Active' : 'Disabled'}
              </span>
              <div className="form-actions">
                <button className="button secondary" onClick={() => start(o)}>
                  <Edit3 size={16} />
                  Edit outlet
                </button>
                <button className="text-button" onClick={() => setDocs(o)}>
                  <ShieldCheck size={16} />
                  Documents
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit outlet' : 'Add an outlet'}
      >
        {edit && (
          <form onSubmit={save} className="form-stack">
            <ImageUpload
              value={[edit.image]}
              onChange={(urls) => setEdit({ ...edit, image: urls[0] })}
            />
            <div className="form-grid">
              {[
                ['name', 'Outlet name', 'text'],
                ['phone', 'Phone number', 'tel'],
                ['email', 'Email address', 'email'],
                ['customer_id', 'Customer ID / login ID', 'text'],
              ].map(([key, title, type]) => (
                <label key={key}>
                  {title}
                  <input
                    required
                    type={type}
                    value={edit[key]}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        [key]:
                          key === 'customer_id' ? e.target.value.toUpperCase() : e.target.value,
                      })
                    }
                    pattern={key === 'customer_id' ? '[A-Z0-9-]{3,30}' : undefined}
                  />
                </label>
              ))}
              <label>
                Portal password
                <input
                  type="password"
                  required={!edit.id}
                  minLength={10}
                  maxLength={100}
                  autoComplete="new-password"
                  value={edit.password}
                  onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                />
                <small>
                  {edit.id
                    ? 'Leave blank to keep the current password.'
                    : 'Minimum 10 characters. Share securely with the outlet.'}
                </small>
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
                <textarea
                  required
                  value={edit.address}
                  onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                />
              </label>
              <label>
                Pickup latitude
                <input
                  type="number"
                  step="any"
                  required
                  min="-90"
                  max="90"
                  value={edit.lat}
                  onChange={(e) => setEdit({ ...edit, lat: Number(e.target.value) })}
                />
              </label>
              <label>
                Pickup longitude
                <input
                  type="number"
                  step="any"
                  required
                  min="-180"
                  max="180"
                  value={edit.lng}
                  onChange={(e) => setEdit({ ...edit, lng: Number(e.target.value) })}
                />
              </label>
              <label>
                Category
                <select
                  value={edit.category}
                  onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                >
                  {['Food', 'Groceries', 'Parcels', 'More'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!edit.active}
                  onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })}
                />
                Outlet and portal active
              </label>
            </div>
            {formError && <ErrorBox error={formError} />}
            <button className="button full" disabled={busy}>
              {busy ? 'Saving…' : 'Save outlet'}
            </button>
          </form>
        )}
      </Modal>
      <Modal
        open={!!docs}
        onClose={() => setDocs(null)}
        title={'Private documents · ' + (docs?.name || '')}
      >
        {docs && <DocumentManager outletId={docs.id} />}
      </Modal>
    </>
  );
}
function DocumentManager({ outletId }: { outletId: string }) {
  const { notice } = useApp();
  const { data, error, loading, refresh } = useData<
    { id: string; name: string; created_at: string }[]
  >('/admin/outlets/' + outletId + '/documents');
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api('/admin/outlets/' + outletId + '/documents', { method: 'POST', body: form });
      refresh();
      notice('Private document added.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function del() {
    if (!remove) return;
    setBusy(true);
    try {
      await api('/admin/documents/' + remove, { method: 'DELETE' });
      setRemove(null);
      refresh();
      notice('Document deleted.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <p className="notes-box">
        <ShieldCheck size={20} />
        These documents are visible only to administrators. Outlets cannot view, upload or remove
        them.
      </p>
      <label className="upload-button">
        <Upload size={18} />
        {busy ? 'Uploading…' : 'Upload PDF document'}
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </label>
      <small>PDF only · Up to 8 MB</small>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : !data?.length ? (
        <p className="muted">No documents added yet.</p>
      ) : (
        data.map((d) => (
          <div className="document-row" key={d.id}>
            <div>
              <strong>{d.name}</strong>
              <small>{date(d.created_at)}</small>
            </div>
            <a
              className="icon-button"
              href={'/api/admin/documents/' + d.id}
              aria-label={'Download ' + d.name}
            >
              <Download size={18} />
            </a>
            <button
              className="icon-button"
              onClick={() => setRemove(d.id)}
              aria-label={'Delete ' + d.name}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))
      )}
      {remove && (
        <div className="error-box">
          Permanently delete this document?
          <div className="form-actions">
            <button className="button secondary" onClick={() => setRemove(null)}>
              Keep document
            </button>
            <button className="button" disabled={busy} onClick={del}>
              Delete document
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function RiderManager() {
  const { locations, notice } = useApp();
  const { data, loading, error, refresh } = useData<User[]>('/admin/riders');
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  function start(r?: User) {
    setFormError('');
    setEdit(
      r
        ? { ...r, password: '' }
        : {
            name: '',
            email: '',
            phone: '',
            address: '',
            location_id: locations[0]?.id,
            login_id: '',
            password: '',
            active: 1,
          },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    try {
      await api('/admin/riders' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...edit, password: edit.password || undefined }),
      });
      setEdit(null);
      refresh();
      notice('Rider account saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="manage-toolbar">
        <p className="muted">Riders are assigned automatically within their delivery area.</p>
        <button className="button" onClick={() => start()}>
          <Plus size={18} />
          Add rider
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Rider</th>
                <th>Login ID</th>
                <th>Delivery area</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Edit</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    <small>{r.email}</small>
                  </td>
                  <td>{r.login_id}</td>
                  <td>{locations.find((l) => l.id === r.location_id)?.name}</td>
                  <td>{r.phone}</td>
                  <td>
                    <span className={'status ' + (r.active ? 'confirmed' : 'cancelled')}>
                      {r.active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={'Edit ' + r.name}
                      onClick={() => start(r)}
                    >
                      <Edit3 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit rider' : 'Add a rider'}
      >
        {edit && (
          <form className="form-stack" onSubmit={save}>
            <div className="form-grid">
              {[
                ['name', 'Full name', 'text'],
                ['email', 'Email address', 'email'],
                ['phone', 'Phone number', 'tel'],
                ['login_id', 'Rider ID', 'text'],
              ].map(([key, title, type]) => (
                <label key={key}>
                  {title}
                  <input
                    required
                    type={type}
                    value={edit[key]}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        [key]: key === 'login_id' ? e.target.value.toUpperCase() : e.target.value,
                      })
                    }
                    pattern={key === 'login_id' ? '[A-Z0-9-]{3,30}' : undefined}
                  />
                </label>
              ))}
              <label className="span-2">
                Address
                <textarea
                  required
                  value={edit.address}
                  onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                />
              </label>
              <label>
                Assigned area
                <select
                  value={edit.location_id}
                  onChange={(e) => setEdit({ ...edit, location_id: e.target.value })}
                >
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
                  onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!edit.active}
                  onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })}
                />
                Account active
              </label>
            </div>
            {formError && <ErrorBox error={formError} />}
            <button className="button full" disabled={busy}>
              {busy ? 'Saving…' : 'Save rider'}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}
function LocationManager() {
  const { notice } = useApp();
  const { data, error, refresh } = useData<Location[]>('/locations');
  const [edit, setEdit] = useState<{ id?: string; name: string; lat: number; lng: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    try {
      await api('/admin/locations' + (edit.id ? '/' + edit.id : ''), {
        method: edit.id ? 'PUT' : 'POST',
        body: JSON.stringify(edit),
      });
      setEdit(null);
      refresh();
      notice('Delivery area saved. Reload the page to refresh area selectors.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="manage-toolbar">
        <p className="muted">Each delivery area serves pins within 8 km of its centre.</p>
        <button
          className="button"
          onClick={() => setEdit({ name: '', lat: 33.6442, lng: 73.0713 })}
        >
          <Plus size={18} />
          Add delivery area
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      <div className="admin-outlet-grid">
        {data?.map((l) => (
          <section className="panel" key={l.id}>
            <MapPin className="accent" />
            <h3>{l.name}</h3>
            <p>
              {l.lat}, {l.lng}
            </p>
            <button className="text-button" onClick={() => setEdit(l)}>
              <Edit3 size={17} />
              Edit area
            </button>
          </section>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Delivery area">
        {edit && (
          <form className="form-stack" onSubmit={save}>
            <label>
              Area name
              <input
                required
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              Centre latitude
              <input
                type="number"
                required
                min="-90"
                max="90"
                step="any"
                value={edit.lat}
                onChange={(e) => setEdit({ ...edit, lat: Number(e.target.value) })}
              />
            </label>
            <label>
              Centre longitude
              <input
                type="number"
                required
                min="-180"
                max="180"
                step="any"
                value={edit.lng}
                onChange={(e) => setEdit({ ...edit, lng: Number(e.target.value) })}
              />
            </label>
            <button className="button" disabled={busy}>
              Save area
            </button>
          </form>
        )}
      </Modal>
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
      notice('Homepage advertisement updated.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refresh} />;
  const ad = edit || data;
  return (
    <section className="panel">
      <h2>Homepage advertising space</h2>
      <p className="muted">
        This replaces the app-download promotion until the mobile app is ready.
      </p>
      {ad && (
        <form className="form-stack" onSubmit={save}>
          <ImageUpload value={[ad.image]} onChange={(urls) => setEdit({ ...ad, image: urls[0] })} />
          {(['label', 'title', 'description', 'link'] as const).map((key) => (
            <label key={key}>
              {key === 'link' ? 'Destination link' : label(key)}
              <input
                required
                value={ad[key]}
                onChange={(e) => setEdit({ ...ad, [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={ad.active}
              onChange={(e) => setEdit({ ...ad, active: e.target.checked })}
            />
            Show on homepage
          </label>
          <button disabled={busy || !edit} className="button">
            {busy ? 'Saving…' : 'Save advertisement'}
          </button>
        </form>
      )}
    </section>
  );
}
function Messages() {
  const { data, error, loading, refresh } =
    useData<{ id: string; name: string; email: string; message: string; created_at: string }[]>(
      '/admin/messages',
    );
  return (
    <>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : !data?.length ? (
        <Empty title="Your inbox is clear.">Contact form enquiries will appear here.</Empty>
      ) : (
        <div className="form-stack">
          {data.map((m) => (
            <article key={m.id} className="panel">
              <div className="section-head">
                <h3>{m.name}</h3>
                <small>{date(m.created_at)}</small>
              </div>
              <a className="accent" href={'mailto:' + m.email}>
                {m.email}
              </a>
              <p className="message-body">{m.message}</p>
              <a className="button secondary" href={'mailto:' + m.email}>
                Reply by email <ArrowUpRight size={16} />
              </a>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
