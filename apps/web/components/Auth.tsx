'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck, LogOut } from 'lucide-react';
import { useApp } from './Provider';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { ErrorBox, Loading } from './UI';
export function Auth({ signup = false }: { signup?: boolean }) {
  const { setUser, locations, area } = useApp();
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const { user } = await api<{ user: User }>(signup ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(f),
      });
      setUser(user);
      const target = search.get('next');
      router.push(
        target && target.startsWith('/') && !target.startsWith('//')
          ? target
          : user.role === 'admin'
            ? '/admin'
            : user.role === 'outlet'
              ? '/portal/outlet'
              : user.role === 'rider'
                ? '/portal/rider'
                : '/account',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container auth-page">
      <div className="auth-art">
        <span className="eyebrow accent">Your everyday, delivered</span>
        <h1>
          A little closer
          <br />
          to the things
          <br />
          <em>you love.</em>
        </h1>
        <img
          src="/images/rider.webp"
          alt="Dellvit delivery rider on a red scooter"
          width="720"
          height="480"
        />
        <div>
          <ShieldCheck size={22} />
          Your next good thing is just a few taps away.
        </div>
      </div>
      <div className="auth-form">
        <h2>{signup ? 'Make yourself at home.' : 'Good to see you again.'}</h2>
        <p>
          {signup
            ? 'Create your Dellvit account for an easier everyday.'
            : 'Log in to order, manage your shop or head out for delivery.'}
        </p>
        <form onSubmit={submit} className="form-stack">
          {signup ? (
            <>
              <label>
                Full name
                <input name="name" required autoComplete="name" maxLength={100} />
              </label>
              <label>
                Email address
                <input name="email" type="email" required autoComplete="email" />
              </label>
              <label>
                Phone number
                <input
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  placeholder="03XX XXXXXXX"
                />
              </label>
            </>
          ) : (
            <label>
              Email address or outlet / rider ID
              <input
                name="login"
                required
                autoComplete="username"
                placeholder="you@example.com or DLV-001"
              />
            </label>
          )}
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={signup ? 10 : 1}
              maxLength={100}
              autoComplete={signup ? 'new-password' : 'current-password'}
            />
            {signup && <small>Use at least 10 characters.</small>}
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
                Delivery address
                <textarea
                  name="address"
                  required
                  autoComplete="street-address"
                  placeholder="House, street and landmark"
                  maxLength={500}
                />
              </label>
            </>
          )}
          {error && <ErrorBox error={error} />}
          <button disabled={busy} className="button full">
            {busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="center">
          {signup ? 'Already part of the neighbourhood?' : 'New to Dellvit?'}{' '}
          <Link className="accent" href={signup ? '/login' : '/signup'}>
            {signup ? 'Log in' : 'Sign up'}
          </Link>
        </p>
      </div>
    </div>
  );
}
export function Account() {
  const { user, setUser, ready, locations, logout, notice } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api<User>('/profile', {
        method: 'PATCH',
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setUser(u);
      notice('Your profile has been updated.');
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
    try {
      await api('/auth/password', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      notice('Password updated. Other sessions have been signed out.');
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
        <h1>Your Dellvit account</h1>
        <p>Log in to view your saved details.</p>
        <Link href="/login?next=/account" className="button">
          Log in
        </Link>
      </div>
    );
  return (
    <div className="container page">
      <div className="section-head">
        <div>
          <div className="eyebrow accent">Your corner of Dellvit</div>
          <h1>Hello, {user.name.split(' ')[0]}.</h1>
        </div>
        <button
          className="button secondary"
          onClick={async () => {
            await logout();
            router.push('/');
          }}
        >
          <LogOut size={17} />
          Log out
        </button>
      </div>
      <div className="account-grid">
        <section className="panel">
          <h2>Your delivery details</h2>
          <p className="muted">
            Saved for future orders. Checkout changes apply to one order only.
          </p>
          <form className="form-stack" onSubmit={save}>
            <label>
              Full name
              <input name="name" defaultValue={user.name} required />
            </label>
            <label>
              Email
              <input value={user.email} disabled />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" defaultValue={user.phone} required />
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
            <label>
              Address
              <textarea name="address" defaultValue={user.address} required />
            </label>
            <button disabled={busy} className="button">
              Save details
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>Account security</h2>
          <form className="form-stack" onSubmit={password}>
            <label>
              Current password
              <input name="current" type="password" autoComplete="current-password" required />
            </label>
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={100}
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Update password
            </button>
          </form>
          <hr />
          <Link className="button full" href="/orders">
            Your orders <ArrowRight size={17} />
          </Link>
        </section>
      </div>
      {error && <ErrorBox error={error} />}
    </div>
  );
}
