'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ShoppingBag,
  Search,
  MapPin,
  Menu,
  ChevronDown,
  ArrowUpRight,
  Package,
  UserRound,
} from 'lucide-react';
import { useApp } from './Provider';
import { LocationPicker, Modal } from './UI';
const links = [
  ['/search', 'Search'],
  ['/orders', 'Orders'],
  ['/outlets', 'Outlets'],
  ['/about', 'About'],
  ['/contact', 'Contact us'],
];
export function Header() {
  const path = usePathname();
  const router = useRouter();
  const { cart, user, logout, area, openLocation } = useApp();
  const [menu, setMenu] = useState(false);
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  const portal =
    user?.role === 'customer'
      ? '/account'
      : user?.role === 'admin'
        ? '/admin'
        : user?.role === 'outlet'
          ? '/portal/outlet'
          : '/portal/rider';
  return (
    <>
      <div className="top-strip">
        <span>Your everyday, delivered.</span>
        <button onClick={() => openLocation(true)}>
          <MapPin size={13} />
          {area?.name || 'Choose delivery area'}
          <ChevronDown size={13} />
        </button>
      </div>
      <header className="header">
        <Link href="/" aria-label="Dellvit home">
          <img className="logo" src="/images/logo.webp" alt="Dellvit" width="150" height="85" />
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <Link href="/" className={path === '/' ? 'active' : ''}>
            Home
          </Link>
          {links.map(([url, title]) => (
            <Link key={url} href={url} className={path.startsWith(url) ? 'active' : ''}>
              {title === 'Search' && <Search size={16} />} {title}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link href="/cart" className="cart-link" aria-label={`Cart, ${count} items`}>
            <ShoppingBag size={21} />
            <span className="cart-label">Cart</span>
            <span className="count">{count}</span>
          </Link>
          {user ? (
            <Link href={portal} className="button secondary auth-link">
              <UserRound size={17} />
              {user.role === 'customer' ? 'Account' : 'Portal'}
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-button auth-link">
                Log in
              </Link>
              <Link href="/signup" className="button small auth-link">
                Sign up
              </Link>
            </>
          )}
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(true)}
            aria-label="Open menu"
          >
            <Menu />
          </button>
        </div>
      </header>
      <Modal open={menu} onClose={() => setMenu(false)} title="Explore Dellvit">
        <nav className="mobile-nav">
          {[
            ['/', 'Home'],
            ...links,
            ['/cart', `Cart (${count})`],
            ...(user
              ? [[portal, 'My account / portal']]
              : [
                  ['/login', 'Log in'],
                  ['/signup', 'Sign up'],
                ]),
          ].map(([url, title]) => (
            <Link key={url} href={url} onClick={() => setMenu(false)}>
              {title}
              <ArrowUpRight size={17} />
            </Link>
          ))}
          {user && (
            <button
              onClick={async () => {
                await logout();
                setMenu(false);
                router.push('/');
              }}
            >
              Log out
            </button>
          )}
        </nav>
      </Modal>
      <LocationPicker />
    </>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-main">
        <div>
          <Link href="/">
            <img src="/images/logo.webp" alt="Dellvit" width="144" height="80" />
          </Link>
          <p>
            From local favourites to everyday essentials.
            <br />A little closer, with Dellvit.
          </p>
        </div>
        <div>
          <h3>Explore</h3>
          <Link href="/search">Find something good</Link>
          <Link href="/outlets">Local outlets</Link>
          <Link href="/orders">Track your order</Link>
        </div>
        <div>
          <h3>Let’s talk</h3>
          <a href="mailto:dellvitsupport@gmail.com">dellvitsupport@gmail.com</a>
          <a href="tel:+923169212708">0316 9212708</a>
          <span>6th Road, Rawalpindi</span>
        </div>
        <div>
          <h3>Work with Dellvit</h3>
          <Link href="/portal/outlet">Outlet portal</Link>
          <Link href="/portal/rider">Rider portal</Link>
          <Link href="/contact">
            Become a partner <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Dellvit. Your everyday delivered.</span>
        <div>
          <Link href="/about">About us</Link>
          <Link href="/contact">Help & support</Link>
          <Link href="/admin">Admin</Link>
        </div>
      </div>
    </footer>
  );
}
