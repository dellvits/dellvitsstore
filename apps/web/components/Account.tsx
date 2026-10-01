'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  BadgePercent,
  Bell,
  ClipboardList,
  Clock,
  Headphones,
  KeyRound,
  Laptop,
  LayoutDashboard,
  LogOut,
  MapPin,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Tag,
  UserRound,
  Wallet,
} from 'lucide-react';
import { useApp } from './Provider';
import { ago, api, date, money } from '@/lib/api';
import { useData } from '@/lib/useData';
import { inRange, useRange } from '@/lib/range';
import type { Order, User } from '@/lib/types';
import { Badge, Confirm, DataTable, Empty, ErrorBox, FilterBar, Loading, PageLoading, RowAction, Stat } from './UI';
import { NotificationSettings, inboxPath } from './Notifications';
import { Password } from './Auth';
import { Countdown, PaymentStatusBadge, stageLabel } from './Orders';
import { portalPath, themes } from './Shell';

type Session = { id: string; current: boolean; created_at: string | null; user_agent: string; expires_at: string };
type Offer = { code: string; name: string; description: string };
const closed = (o: Order) => ['delivered', 'cancelled'].includes(o.status);

/** "Chrome on Windows" from a browser's user-agent text. */
function device(agent: string) {
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Firefox\//.test(agent)
          ? 'Firefox'
          : /Safari\//.test(agent)
            ? 'Safari'
            : '';
  const system = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iPhone or iPad'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac OS X/.test(agent)
          ? 'Mac'
          : /Linux/.test(agent)
            ? 'Linux'
            : '';
  return {
    name: browser && system ? `${browser} on ${system}` : browser || system || 'Unknown device',
    mobile: /Android|iPhone|iPad|Mobile/.test(agent),
  };
}
/** What a new password still lacks, so the form can say so before it is sent. */
function passwordGaps(p: string) {
  return [
    p.length < 10 && 'at least 10 characters',
    !/[a-z]/.test(p) && 'a small letter',
    !/[A-Z]/.test(p) && 'a capital letter',
    !/\d/.test(p) && 'a digit',
  ].filter(Boolean) as string[];
}

/** The customer's dashboard: what is on its way, what they spent, and where they order most. */
function Overview({ user }: { user: User }) {
  const router = useRouter();
  const { data: orders, loading, error, refresh } = useData<Order[]>('/orders', 20000);
  const { range, setRange, label: rangeText } = useRange('30d');
  const { data: offers } = useData<Offer[]>(user.location_id ? '/coupons?location=' + encodeURIComponent(user.location_id) : null);
  const { notice } = useApp();
  const all = orders || [];
  const rows = all.filter((o) => inRange(o.created_at, range));
  const delivered = rows.filter((o) => o.status === 'delivered');
  const active = all.filter((o) => !closed(o));
  const busy = loading && !orders;
  // The outlets ordered from most often, for a quick return visit.
  const places = [...all.reduce((m, o) => m.set(o.outlet_id, { id: o.outlet_id, name: o.outlet.name, orders: (m.get(o.outlet_id)?.orders || 0) + 1 }), new Map<string, { id: string; name: string; orders: number }>()).values()]
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 4);
  if (error && !orders) return <ErrorBox error={error} retry={refresh} />;
  return (
    <div className="stack">
      {!!active.length && (
        <section className="card attention-card">
          <div className="card-head">
            <h3>
              <Clock size={17} /> On the way
            </h3>
            <small className="muted">
              {active.length} order{active.length === 1 ? '' : 's'} in progress
            </small>
          </div>
          <div className="active-orders">
            {active.slice(0, 4).map((o) => (
              <Link href={'/orders/' + o.id} className="active-order" key={o.id}>
                <img src={o.items[0]?.image} alt="" />
                <span className="cell-stack grow">
                  <strong>{o.outlet.name}</strong>
                  <small>
                    {o.reference} · {o.items.reduce((n, i) => n + i.quantity, 0)} item{o.items.reduce((n, i) => n + i.quantity, 0) === 1 ? '' : 's'} · {money(o.total)}
                  </small>
                  <small>{stageLabel(o)}</small>
                </span>
                <span className="cell-stack end">
                  <Badge value={o.status} />
                  <small>
                    <Countdown deadline={o.deliver_by} pending={o.status === 'placed'} />
                  </small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <FilterBar title="Your orders" hint={`Placed ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat icon={<ClipboardList size={20} />} label="Orders" value={rows.length} hint={`${all.length} in total`} tone="blue" loading={busy} onClick={() => router.push('/orders')} />
        <Stat icon={<Clock size={20} />} label="In progress" value={active.length} hint="Being prepared or delivered" tone="orange" quiet={!active.length} loading={busy} onClick={() => router.push('/orders')} />
        <Stat icon={<PackageCheck size={20} />} label="Delivered" value={delivered.length} hint={`${rows.filter((o) => o.status === 'cancelled').length} cancelled`} tone="green" loading={busy} />
        <Stat icon={<Wallet size={20} />} label="Spent" value={money(delivered.reduce((s, o) => s + o.total, 0))} hint="On delivered orders" tone="purple" loading={busy} />
        <Stat
          icon={<BadgePercent size={20} />}
          label="Saved with coupons"
          value={money(delivered.reduce((s, o) => s + (o.discount || 0), 0))}
          hint="Discounts on delivered orders"
          tone="green"
          quiet={!delivered.some((o) => o.discount)}
          loading={busy}
        />
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>
              <Store size={17} /> Order again
            </h3>
            <Link className="link" href="/outlets">
              All outlets
            </Link>
          </div>
          {busy ? (
            <Loading />
          ) : places.length ? (
            <ul className="rank-list">
              {places.map((p, i) => (
                <li key={p.id}>
                  <span className="rank">{i + 1}</span>
                  <span className="cell-stack grow">
                    <strong>{p.name}</strong>
                    <small>
                      {p.orders} order{p.orders === 1 ? '' : 's'}
                    </small>
                  </span>
                  <RowAction href={'/outlets/' + p.id}>Visit</RowAction>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">The outlets you order from will appear here.</p>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h3>
              <Tag size={17} /> Offers for you
            </h3>
          </div>
          {offers?.length ? (
            <div className="coupon-offers">
              {offers.map((o) => (
                <button
                  type="button"
                  key={o.code}
                  title="Copy the code"
                  onClick={() => navigator.clipboard.writeText(o.code).then(() => notice(`${o.code} copied. Paste it at checkout.`), () => notice('Could not copy the code.'))}
                >
                  <Tag size={14} />
                  <span>
                    <strong>{o.code}</strong>
                    <small>{o.description || o.name}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">No offers in your area right now. Coupons you can use will appear here.</p>
          )}
          <div className="quick-links">
            <Link href="/search" className="button ghost small">
              <ShoppingBag size={15} /> Browse products
            </Link>
            <Link href="/support" className="button ghost small">
              <Headphones size={15} /> Support chat
            </Link>
          </div>
        </section>
      </div>
      <DataTable
        title={<h3>Recent orders</h3>}
        rows={orders}
        loading={loading}
        rowKey={(o) => o.id}
        pageSize={5}
        onRowClick={(o) => router.push('/orders/' + o.id)}
        search={(o) => `${o.reference} ${o.outlet.name} ${o.items.map((i) => i.name).join(' ')}`}
        searchPlaceholder="Search orders or items"
        empty="You haven’t placed any orders yet."
        toolbar={
          <Link className="button ghost" href="/orders">
            All orders
          </Link>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'active', label: 'In progress' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
            test: (o, v) => (v === 'active' ? !closed(o) : o.status === v),
          },
        ]}
        columns={[
          {
            key: 'ref',
            header: 'Order',
            sort: (o) => o.created_at,
            render: (o) => (
              <span className="cell-stack">
                <strong>{o.reference}</strong>
                <small>{date(o.created_at)}</small>
              </span>
            ),
          },
          {
            key: 'outlet',
            header: 'Outlet & items',
            render: (o) => (
              <span className="cell-stack">
                <strong>{o.outlet.name}</strong>
                <small className="truncate">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</small>
              </span>
            ),
          },
          { key: 'total', header: 'Total', sort: (o) => o.total, render: (o) => <strong>{money(o.total)}</strong> },
          { key: 'payment', header: 'Payment', render: (o) => <PaymentStatusBadge order={o} /> },
          { key: 'status', header: 'Status', render: (o) => <Badge value={o.status} /> },
        ]}
        actions={(o) => (
          <RowAction tone={closed(o) ? 'ghost' : 'primary'} href={'/orders/' + o.id}>
            {closed(o) ? 'View' : 'Track'}
          </RowAction>
        )}
      />
    </div>
  );
}

function Profile({ user }: { user: User }) {
  const { setUser, locations, notice, theme, setTheme } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const customer = user.role === 'customer';
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await api<User>('/profile', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) }));
      notice('Profile updated.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <h3>
            <UserRound size={18} /> Your details
          </h3>
        </div>
        <form className="stack" onSubmit={save} key={user.id}>
          <div className="form-grid">
            <label>
              Full name
              <input name="name" defaultValue={user.name} required maxLength={100} />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" defaultValue={user.phone} required={customer} />
            </label>
            <label className="span-2">
              {user.login_id ? 'Contact email' : 'Email'}
              <input value={user.email.endsWith('.invalid') ? 'Not set' : user.email} disabled />
              <small>
                {customer
                  ? 'Your email is how you sign in. Ask support if it needs to change.'
                  : user.role === 'admin'
                    ? 'A super administrator changes this on the Admin access page.'
                    : 'Ask Dellvit support to change this.'}
              </small>
            </label>
            <label className="span-2">
              {customer ? 'Delivery area' : 'Area'}
              <select name="location_id" defaultValue={user.location_id || ''} required={customer}>
                {!customer && <option value="">Not set</option>}
                {locations.map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              {customer ? 'Delivery address' : 'Address'}
              <textarea name="address" rows={2} defaultValue={user.address} required={customer} maxLength={500} />
              {customer && <small>Checkout starts with this address; you can change it for each order.</small>}
            </label>
          </div>
          {error && <ErrorBox error={error} />}
          <div className="form-foot">
            <button disabled={busy} className="button">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>
      <section className="card">
        <div className="card-head">
          <h3>
            <BadgeCheck size={18} /> Account
          </h3>
        </div>
        <dl className="account-facts">
          <div>
            <dt>Account type</dt>
            <dd>
              {user.role === 'admin' ? (user.is_owner ? 'Owner' : user.is_super_admin ? 'Super administrator' : 'Administrator') : user.role === 'customer' ? 'Customer' : user.role === 'outlet' ? 'Outlet' : 'Rider'}
            </dd>
          </div>
          {user.login_id && (
            <div>
              <dt>Sign-in ID</dt>
              <dd>
                <code className="code-chip">{user.login_id}</code>
              </dd>
            </div>
          )}
          {customer && (
            <div>
              <dt>Email</dt>
              <dd>
                <Badge tone={user.email_verified_at ? 'success' : 'warn'}>{user.email_verified_at ? 'Verified' : 'Not verified'}</Badge>
              </dd>
            </div>
          )}
          {user.created_at && (
            <div>
              <dt>Member since</dt>
              <dd>{new Date(user.created_at).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
            </div>
          )}
          {user.last_login_at && (
            <div>
              <dt>Last sign-in</dt>
              <dd>{date(user.last_login_at)}</dd>
            </div>
          )}
          {user.role === 'admin' && !user.is_super_admin && (
            <div>
              <dt>Modules</dt>
              <dd>{user.permissions?.length || 0} assigned</dd>
            </div>
          )}
        </dl>
        <div className="field appearance">
          <span className="field-label">Appearance</span>
          <div className="segmented">
            {themes.map(([key, title, Icon]) => (
              <button type="button" key={key} className={theme === key ? 'selected' : ''} aria-pressed={theme === key} onClick={() => setTheme(key)}>
                <Icon size={14} /> {title}
              </button>
            ))}
          </div>
          <small className="muted">Device default follows your phone or computer. The choice is kept on this device.</small>
        </div>
        {user.is_owner && (
          <div className="alert info">
            <ShieldCheck size={16} /> This is the owner account. Other administrators cannot edit, disable or delete it.
          </div>
        )}
      </section>
    </div>
  );
}

function Security() {
  const { notice } = useApp();
  const { data: sessions, loading, error, refresh } = useData<Session[]>('/profile/sessions');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [next, setNext] = useState('');
  const [everywhere, setEverywhere] = useState(false);
  const gaps = passwordGaps(next);
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setFormError('');
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset();
      setNext('');
      refresh();
      notice('Password updated. Your other devices were signed out.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut(id?: string) {
    setBusy(true);
    try {
      await api('/profile/sessions' + (id ? '/' + id : ''), { method: 'DELETE' });
      setEverywhere(false);
      refresh();
      notice(id ? 'That device was signed out.' : 'Every other device was signed out.');
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const others = (sessions || []).filter((s) => !s.current);
  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <h3>
            <KeyRound size={18} /> Password
          </h3>
        </div>
        <form className="stack" onSubmit={password}>
          <label>
            Current password
            <Password name="current" autoComplete="current-password" />
          </label>
          <label>
            New password
            <Password name="password" autoComplete="new-password" minLength={10} onChange={setNext} />
            {next && (
              <small className={gaps.length ? 'warn-text' : 'success-text'}>
                {gaps.length ? 'Still needs ' + gaps.join(', ') + '.' : 'Strong enough.'}
              </small>
            )}
          </label>
          {formError && <ErrorBox error={formError} />}
          <small className="muted">Changing your password signs you out everywhere except here.</small>
          <div className="form-foot">
            <button className="button" disabled={busy || next.length < 10}>
              Update password
            </button>
          </div>
        </form>
      </section>
      <section className="card">
        <div className="card-head">
          <h3>
            <Laptop size={18} /> Signed-in devices
          </h3>
          {!!others.length && (
            <button type="button" className="link" onClick={() => setEverywhere(true)}>
              Sign out all others
            </button>
          )}
        </div>
        {loading && !sessions ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} retry={refresh} />
        ) : (
          <ul className="device-list">
            {(sessions || []).map((s) => {
              const d = device(s.user_agent);
              return (
                <li key={s.id}>
                  <span className="n-icon order">{d.mobile ? <Smartphone size={16} /> : <Laptop size={16} />}</span>
                  <span className="cell-stack grow">
                    <strong>
                      {d.name} {s.current && <Badge tone="success">This device</Badge>}
                    </strong>
                    <small>
                      {s.created_at ? 'Signed in ' + ago(s.created_at) : 'Signed in earlier'} · stays signed in until {date(s.expires_at)}
                    </small>
                  </span>
                  {!s.current && (
                    <RowAction tone="danger" onClick={() => signOut(s.id)}>
                      Sign out
                    </RowAction>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <small className="muted">If you see a device you do not recognise, sign it out and change your password.</small>
      </section>
      <Confirm open={everywhere} title="Sign out all other devices?" confirm="Sign out" busy={busy} onClose={() => setEverywhere(false)} onConfirm={() => signOut()}>
        You stay signed in here. {others.length} other device{others.length === 1 ? '' : 's'} will need to sign in again.
      </Confirm>
    </div>
  );
}

type Tab = 'overview' | 'profile' | 'security' | 'notifications';
/**
 * The signed-in account: a dashboard for customers, then details, security and alerts. With
 * `embedded` it sits inside a portal, which has its own frame and its own notifications page.
 */
export function Account({ embedded = false }: { embedded?: boolean }) {
  const { user, ready, logout } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const customer = user?.role === 'customer';
  const tabs: [Tab, string, typeof Bell][] = [
    ...(customer && !embedded ? ([['overview', 'Dashboard', LayoutDashboard]] as [Tab, string, typeof Bell][]) : []),
    ['profile', 'Profile', UserRound],
    ['security', 'Security', ShieldCheck],
    ['notifications', 'Notifications', Bell],
  ];
  const wanted = params.get('view') as Tab | null;
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab = tabs.find(([k]) => k === (chosen || wanted))?.[0] || tabs[0][0];
  if (!ready) return <PageLoading />;
  if (!user)
    return (
      <div className="container page">
        <Empty title="Log in to view your account" href="/login?next=/account" action="Log in" />
      </div>
    );
  return (
    <div className={embedded ? 'stack' : 'container page stack'}>
      <div className="profile-head card">
        <span className="avatar xl">{user.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <h1>{user.name}</h1>
          <small className="muted">
            {[user.login_id, !user.email.endsWith('.invalid') && user.email, user.phone].filter(Boolean).join(' · ')}
          </small>
          {customer && user.address && (
            <small className="muted profile-address">
              <MapPin size={13} /> {user.address}
            </small>
          )}
        </div>
        <div className="page-actions">
          {!embedded && !customer && (
            <Link href={portalPath(user.role)} className="button">
              Open portal
            </Link>
          )}
          {!embedded && customer && (
            <Link href="/orders" className="button">
              <ClipboardList size={16} /> My orders
            </Link>
          )}
          <button
            className="button ghost"
            onClick={async () => {
              await logout();
              router.push('/');
            }}
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, title, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setChosen(k)}>
            <Icon size={16} /> {title}
          </button>
        ))}
      </div>
      {tab === 'overview' ? (
        <Overview user={user} />
      ) : tab === 'profile' ? (
        <Profile user={user} />
      ) : tab === 'security' ? (
        <Security />
      ) : (
        <section className="card narrow-card">
          <div className="card-head">
            <h3>
              <Bell size={18} /> Alert preferences
            </h3>
            <Link className="link" href={inboxPath(user)}>
              Open inbox
            </Link>
          </div>
          <NotificationSettings full />
        </section>
      )}
    </div>
  );
}
