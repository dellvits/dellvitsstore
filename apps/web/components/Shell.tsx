'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChevronDown,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Package,
  Search,
  ShoppingCart,
  Store,
  UserRound,
  X,
} from 'lucide-react';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import { LocationPicker } from './UI';
import { NotificationBell } from './Notifications';

export const portalPath = (role?: string) =>
  role === 'customer'
    ? '/account'
    : role === 'admin'
      ? '/admin'
      : role === 'outlet'
        ? '/portal/outlet'
        : '/portal/rider';

function SearchBox({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (path !== '/search') setQ('');
  }, [path]);
  return (
    <form
      className="header-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push('/search' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : ''));
        onDone?.();
      }}
    >
      <Search size={17} />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search food, groceries, outlets…"
        aria-label="Search Dellvit"
        type="search"
      />
      <button type="submit" className="header-search-go" aria-label="Search">
        Search
      </button>
    </form>
  );
}

function AccountMenu() {
  const { user, logout } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!user) return null;
  const items: [string, string, typeof UserRound][] =
    user.role === 'customer'
      ? [
          ['/account', 'My account', UserRound],
          ['/orders', 'My orders', Package],
          ['/notifications', 'Notifications', Bell],
        ]
      : [
          [portalPath(user.role), 'Open portal', LayoutDashboard],
          ['/notifications', 'Notifications', Bell],
          ['/account', 'Account settings', UserRound],
        ];
  return (
    <div className="account-menu" ref={ref}>
      <button className="avatar-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="avatar-name">{user.name.split(' ')[0]}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="dropdown menu-panel">
          <div className="menu-user">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          {items.map(([href, title, I]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              <I size={16} /> {title}
            </Link>
          ))}
          <button
            onClick={async () => {
              setOpen(false);
              await logout();
              router.push('/');
            }}
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const path = usePathname();
  const { cart, user, area, openLocation, areaStatus, logout } = useApp();
  const [menu, setMenu] = useState(false);
  const router = useRouter();
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  useEffect(() => setMenu(false), [path]);
  if (path.startsWith('/admin') || path.startsWith('/portal/')) return <LocationPicker />;
  const links: [string, string][] = [
    ['/search', 'Explore'],
    ['/outlets', 'Outlets'],
    ['/orders', 'Orders'],
  ];
  return (
    <>
      <header className="site-header">
        <div className="header-row container">
          <Link href="/" aria-label="Dellvit home" className="brand">
            <img src="/images/logo.webp" alt="Dellvit" width="112" height="63" />
          </Link>
          <button className="area-pill" onClick={() => openLocation(true)}>
            <MapPin size={16} />
            <span>
              <small>Deliver to</small>
              <strong>
                {areaStatus === 'detecting' ? 'Detecting…' : area?.name || 'Select location'}
              </strong>
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="header-search-slot">
            <SearchBox />
          </div>
          <nav className="header-nav" aria-label="Main navigation">
            {links.map(([href, title]) => (
              <Link key={href} href={href} className={path.startsWith(href) ? 'active' : ''}>
                {title}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <NotificationBell />
            <Link href="/cart" className="header-icon" aria-label={`Cart, ${count} items`}>
              <ShoppingCart size={19} />
              {count > 0 && <span className="dot-count">{count}</span>}
            </Link>
            {user ? (
              <AccountMenu />
            ) : (
              <div className="auth-links">
                <Link href="/login" className="button ghost small">
                  Log in
                </Link>
                <Link href="/signup" className="button small">
                  Sign up
                </Link>
              </div>
            )}
            <button className="header-icon mobile-only" onClick={() => setMenu(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
          </div>
        </div>
        <div className="mobile-search container">
          <SearchBox />
        </div>
      </header>
      {menu && (
        <div className="drawer-backdrop" onClick={() => setMenu(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <img src="/images/logo.webp" alt="Dellvit" width="96" height="54" />
              <button className="header-icon" onClick={() => setMenu(false)} aria-label="Close menu">
                <X size={20} />
              </button>
            </div>
            <button className="area-pill wide" onClick={() => openLocation(true)}>
              <MapPin size={16} />
              <span>
                <small>Deliver to</small>
                <strong>{area?.name || 'Select location'}</strong>
              </span>
            </button>
            <nav>
              <Link href="/">
                <Store size={17} /> Home
              </Link>
              {links.map(([href, title]) => (
                <Link key={href} href={href}>
                  {title === 'Orders' ? <Package size={17} /> : <Search size={17} />} {title}
                </Link>
              ))}
              <Link href="/cart">
                <ShoppingCart size={17} /> Cart ({count})
              </Link>
              {user ? (
                <>
                  <Link href={portalPath(user.role)}>
                    <LayoutDashboard size={17} /> {user.role === 'customer' ? 'My account' : 'Portal'}
                  </Link>
                  <Link href="/notifications">
                    <Bell size={17} /> Notifications
                  </Link>
                  <button
                    onClick={async () => {
                      await logout();
                      router.push('/');
                    }}
                  >
                    <LogOut size={17} /> Log out
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login">
                    <LogIn size={17} /> Log in
                  </Link>
                  <Link href="/signup" className="button">
                    Create account
                  </Link>
                </>
              )}
            </nav>
          </aside>
        </div>
      )}
      <LocationPicker />
    </>
  );
}

export function Footer() {
  const { data } = useData<{ settings: Record<string, string> | null }>('/site');
  const settings = data?.settings;
  const path = usePathname();
  if (path.startsWith('/admin') || path.startsWith('/portal/')) return null;
  const email = settings?.support_email || 'dellvitsupport@gmail.com';
  const phone = settings?.support_phone || '0316 9212708';
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <img src="/images/logo.webp" alt="Dellvit" width="112" height="63" />
          <p>Local favourites and everyday essentials, delivered.</p>
        </div>
        <div>
          <h4>Explore</h4>
          <Link href="/search">Products</Link>
          <Link href="/outlets">Outlets</Link>
          <Link href="/orders">Track order</Link>
        </div>
        <div>
          <h4>Partners</h4>
          <Link href="/portal/outlet">Outlet portal</Link>
          <Link href="/portal/rider">Rider portal</Link>
          <Link href="/contact">Become a partner</Link>
        </div>
        <div>
          <h4>Support</h4>
          <a href={'mailto:' + email}>{email}</a>
          <a href={'tel:' + phone.replace(/\s/g, '')}>{phone}</a>
          <span>{settings?.support_address || '6th Road, Rawalpindi'}</span>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>
          © {new Date().getFullYear()} {settings?.name || 'Dellvit'}
        </span>
        <div>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/admin">Admin</Link>
        </div>
      </div>
    </footer>
  );
}
