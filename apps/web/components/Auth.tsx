'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bell,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Package,
  ShieldCheck,
  Truck,
  UserRound,
  Wallet,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Order, User } from '@/lib/types';
import { ErrorBox, Loading, Stat, Empty } from './UI';
import { NotificationSettings } from './Notifications';
import { portalPath } from './Shell';

function Password({ name, autoComplete, minLength }: { name: string; autoComplete: string; minLength?: number }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password">
      <input
        name={name}
        type={show ? 'text' : 'password'}
        required
        minLength={minLength}
        maxLength={100}
        autoComplete={autoComplete}
      />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function Auth({ signup = false, admin = false }: { signup?: boolean; admin?: boolean }) {
  const { setUser, locations, area } = useApp();
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const next = search.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api<{ user: User }>(
        signup ? '/auth/register' : admin ? '/auth/admin-login' : '/auth/login',
        { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) },
      );
      setUser(user);
      router.push(safeNext || portalPath(user.role));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <div className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">{admin ? 'Administration' : signup ? 'New here?' : 'Welcome back'}</span>
          <h1>{admin ? 'Admin sign in' : signup ? 'Create your account' : 'Log in to Dellvit'}</h1>
          {safeNext === '/checkout' && (
            <div className="alert info">
              <ShieldCheck size={16} /> Sign in to finish your order — your cart is saved.
            </div>
          )}
          <form onSubmit={submit} className="stack">
            {signup ? (
              <>
                <label>
                  Full name
                  <input name="name" required autoComplete="name" maxLength={100} />
                </label>
                <div className="form-grid">
                  <label>
                    Email
                    <input name="email" type="email" required autoComplete="email" />
                  </label>
                  <label>
                    Phone
                    <input name="phone" type="tel" required autoComplete="tel" placeholder="03XX XXXXXXX" />
                  </label>
                </div>
              </>
            ) : (
              <label>
                {admin ? 'Email' : 'Email, outlet ID or rider ID'}
                <input
                  name="login"
                  required
                  autoComplete="username"
                  placeholder={admin ? 'admin@example.com' : 'you@example.com or DLV-001'}
                />
              </label>
            )}
            <label>
              Password
              <Password
                name="password"
                minLength={signup ? 10 : 1}
                autoComplete={signup ? 'new-password' : 'current-password'}
              />
              {signup && <small>At least 10 characters.</small>}
            </label>
            {signup && (
              <>
                <label>
                  Delivery area
                  <select name="location_id" required defaultValue={area?.id || ''}>
                    <option value="" disabled>
                      Choose your area
                    </option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Address
                  <textarea
                    name="address"
                    required
                    rows={2}
                    autoComplete="street-address"
                    placeholder="House, street and landmark"
                    maxLength={500}
                  />
                </label>
              </>
            )}
            {error && <ErrorBox error={error} />}
            <button disabled={busy} className="button large full">
              {busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}
              <ArrowRight size={18} />
            </button>
          </form>
          {!admin && (
            <p className="auth-switch">
              {signup ? 'Already have an account?' : 'New to Dellvit?'}{' '}
              <Link href={(signup ? '/login' : '/signup') + (safeNext ? '?next=' + encodeURIComponent(safeNext) : '')}>
                {signup ? 'Log in' : 'Create an account'}
              </Link>
            </p>
          )}
          {!admin && !signup && (
            <Link className="auth-admin" href="/admin/login">
              <KeyRound size={14} /> Administrator sign in
            </Link>
          )}
        </div>
      </div>
      <div className="auth-art">
        <img src="/images/rider.webp" alt="" />
        <div className="auth-art-copy">
          <h2>{admin ? 'Run your delivery business.' : 'Your neighbourhood, delivered.'}</h2>
          <ul>
            <li>
              <Truck size={16} /> Live order tracking
            </li>
            <li>
              <ShieldCheck size={16} /> OTP-protected handover
            </li>
            <li>
              <Bell size={16} /> Instant notifications
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function Account() {
  const { user, setUser, ready, locations, logout, notice } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: orders } = useData<Order[]>(user?.role === 'customer' ? '/orders' : null, 30000);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await api<User>('/profile', {
        method: 'PATCH',
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setUser(u);
      notice('Profile updated.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError('');
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset();
      notice('Password updated. Other sessions were signed out.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready) return <Loading />;
  if (!user)
    return (
      <div className="container page">
        <Empty title="Log in to view your account" href="/login?next=/account" action="Log in" />
      </div>
    );
  const active = orders?.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length ?? 0;
  const spent = orders?.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.total, 0) ?? 0;
  return (
    <div className="container page">
      <div className="profile-head card">
        <span className="avatar xl">{user.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <h1>{user.name}</h1>
          <small className="muted">
            {user.email} · {user.phone}
          </small>
        </div>
        <div className="page-actions">
          {user.role !== 'customer' && (
            <Link href={portalPath(user.role)} className="button">
              Open portal
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
      {user.role === 'customer' && (
        <div className="stats">
          <Link href="/orders">
            <Stat icon={<Package size={20} />} label="Total orders" value={orders?.length ?? 0} />
          </Link>
          <Link href="/orders">
            <Stat icon={<Clock size={20} />} label="In progress" value={active} tone="orange" />
          </Link>
          <Stat icon={<Wallet size={20} />} label="Delivered spend" value={money(spent)} tone="green" />
        </div>
      )}
      {error && <ErrorBox error={error} />}
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>
              <UserRound size={18} /> Profile
            </h3>
          </div>
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <label>
                Full name
                <input name="name" defaultValue={user.name} required />
              </label>
              <label>
                Phone
                <input name="phone" type="tel" defaultValue={user.phone} required />
              </label>
              <label>
                Email
                <input value={user.email} disabled />
              </label>
              <label>
                Delivery area
                <select name="location_id" defaultValue={user.location_id}>
                  {locations.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Address
                <textarea name="address" rows={2} defaultValue={user.address} required />
              </label>
            </div>
            <button disabled={busy} className="button">
              Save changes
            </button>
          </form>
        </section>
        <div className="stack">
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
                <Password name="password" autoComplete="new-password" minLength={10} />
              </label>
              <button className="button ghost" disabled={busy}>
                Update password
              </button>
            </form>
          </section>
          <section className="card">
            <div className="card-head">
              <h3>
                <Bell size={18} /> Notifications
              </h3>
              <Link className="link" href="/notifications">
                View all
              </Link>
            </div>
            <NotificationSettings />
          </section>
        </div>
      </div>
    </div>
  );
}
