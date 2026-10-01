'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowRight,
  Bell,
  CircleCheck,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  MailCheck,
  Package,
  RotateCw,
  ShieldCheck,
  Truck,
  UserPlus,
  UserRound,
  Wallet,
} from 'lucide-react';
import { useApp } from './Provider';
import { api, money, type ApiError } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Order, User } from '@/lib/types';
import { ErrorBox, Stat, Empty, PageLoading } from './UI';
import { NotificationSettings } from './Notifications';
import { portalPath } from './Shell';

export function Password({
  name,
  autoComplete,
  minLength,
  onChange,
}: {
  name: string;
  autoComplete: string;
  minLength?: number;
  /** Told what is typed, e.g. to show how strong a new password is. */
  onChange?: (value: string) => void;
}) {
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
        onChange={onChange && ((e) => onChange(e.target.value))}
      />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

/** Where the visitor goes to enter their emailed code, keeping the page they were heading to. */
const verifyPath = (email: string, next: string, wait?: number) =>
  '/verify?email=' +
  encodeURIComponent(email) +
  (wait ? '&wait=' + Math.round(wait) : '') +
  (next ? '&next=' + encodeURIComponent(next) : '');
/** A countdown as the customer reads it: "0:45", "12:05". */
const clock = (seconds: number) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
const safePath = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '');

/** The right-hand artwork shared by every sign-in screen. */
function AuthArt({ title }: { title: string }) {
  return (
    <div className="auth-art">
      <img src="/images/rider.webp" alt="" />
      <div className="auth-art-copy">
        <h2>{title}</h2>
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
  );
}
/** Creating an account takes two steps; this shows which one the visitor is on. */
function SignupSteps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="auth-steps" aria-label="Sign-up progress">
      {['Your details', 'Verify email', 'Start ordering'].map((title, i) => (
        <li key={title} className={i + 1 < step ? 'done' : i + 1 === step ? 'current' : ''}>
          <span>{i + 1 < step ? <CircleCheck size={14} /> : i + 1}</span>
          {title}
        </li>
      ))}
    </ol>
  );
}

const CODE_LENGTH = 6;
/** Six boxes for a one-time code: typing moves forward, backspace moves back, a paste fills them all. */
function CodeInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete: (code: string) => void;
  invalid: boolean;
  disabled: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();
  function update(next: string, at: number) {
    const code = next.slice(0, CODE_LENGTH);
    onChange(code);
    if (code.length === CODE_LENGTH) onComplete(code);
    else focus(at);
  }
  function key(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      // Clears this box, or the one before it when this one is already empty.
      const at = value[i] ? i : i - 1;
      if (at >= 0) update(value.slice(0, at), at);
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  }
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '');
    if (digits) update(digits, digits.length);
  }
  useEffect(() => {
    if (!value && !disabled) focus(0);
  }, [value, disabled]);
  return (
    <div className={'otp' + (invalid ? ' invalid' : '')} role="group" aria-label="6-digit verification code">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          value={value[i] || ''}
          inputMode="numeric"
          pattern="\d*"
          maxLength={1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid}
          disabled={disabled}
          className={value[i] ? 'filled' : ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            // Typing lands in the first empty box, so the code can never have a gap.
            if (digits) update(value.slice(0, Math.min(i, value.length)) + digits, Math.min(i, value.length) + digits.length);
          }}
          onKeyDown={(e) => key(e, i)}
          onPaste={paste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
/** Hides most of an address: `muzaffar@example.com` becomes `mu••••••@example.com`. */
function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return name.slice(0, 2) + '•'.repeat(Math.max(2, name.length - 2)) + '@' + domain;
}

/** The second step of signing up: enter the 6-digit code that was emailed. */
export function VerifyEmail() {
  const { setUser, notice } = useApp();
  const router = useRouter();
  const search = useSearchParams();
  const email = (search.get('email') || '').trim().toLowerCase();
  const next = safePath(search.get('next'));
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Seconds until another code may be requested. The server decides this and enforces it; the
  // countdown only mirrors its answer.
  const [wait, setWait] = useState(() => Math.max(0, Math.min(3600, Number(search.get('wait')) || 0)));
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  async function verify(value: string) {
    if (busy || done) return;
    setBusy(true);
    setError('');
    try {
      const { user } = await api<{ user: User }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email, code: value }),
      });
      setDone(true);
      setUser(user);
      setTimeout(() => router.push(next || portalPath(user.role)), 1400);
    } catch (e) {
      setError((e as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (sending || wait > 0) return;
    setSending(true);
    setError('');
    try {
      const r = await api<{ retry_in: number }>('/auth/resend-code', { method: 'POST', body: JSON.stringify({ email }) });
      setWait(r.retry_in);
      setCode('');
      notice('If this email has a pending account, a new code is on its way.');
    } catch (e) {
      const failure = e as ApiError;
      // Asked too soon or too often: the server says how long is left.
      if (failure.data?.retry_in) setWait(failure.data.retry_in);
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="auth">
      <div className="auth-panel">
        <div className="auth-card">
          <SignupSteps step={done ? 3 : 2} />
          {!email ? (
            <>
              <span className="auth-badge">
                <MailCheck size={26} />
              </span>
              <h1>Verify your email</h1>
              <p className="auth-lead">Log in with your email and password and we will send you a fresh code.</p>
              <Link className="button large full" href="/login">
                Go to log in <ArrowRight size={18} />
              </Link>
            </>
          ) : done ? (
            <div className="auth-done">
              <span className="auth-badge success">
                <CircleCheck size={28} />
              </span>
              <h1>Email verified</h1>
              <p className="auth-lead">Your account is ready. Taking you in…</p>
            </div>
          ) : (
            <>
              <span className="auth-badge">
                <MailCheck size={26} />
              </span>
              <div>
                <span className="eyebrow">One last step</span>
                <h1>Check your email</h1>
                <p className="auth-lead">
                  We sent a 6-digit code to <strong>{maskEmail(email)}</strong>. Enter it below to finish creating your
                  account.
                </p>
              </div>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length === CODE_LENGTH) verify(code);
                }}
              >
                <CodeInput
                  value={code}
                  onChange={(c) => {
                    setCode(c);
                    if (c) setError('');
                  }}
                  onComplete={verify}
                  invalid={!!error}
                  disabled={busy}
                />
                {error && <ErrorBox error={error} />}
                <button className="button large full" disabled={busy || code.length < CODE_LENGTH}>
                  {busy ? 'Checking…' : 'Verify email'}
                  <ArrowRight size={18} />
                </button>
              </form>
              <div className="otp-meta">
                <span>
                  <Clock size={14} /> The code expires in 10 minutes
                </span>
                {wait > 0 ? (
                  <span aria-live="polite">
                    New code available in <strong className="otp-timer">{clock(wait)}</strong>
                  </span>
                ) : (
                  <button type="button" className="link" disabled={sending} onClick={resend}>
                    <RotateCw size={13} /> {sending ? 'Sending…' : 'Send a new code'}
                  </button>
                )}
              </div>
              <div className="alert info">
                <ShieldCheck size={16} /> Can’t find it? Check your spam folder. Never share this code with anyone.
              </div>
              <p className="auth-switch">
                Wrong email? <Link href={'/signup' + (next ? '?next=' + encodeURIComponent(next) : '')}>Sign up again</Link>
              </p>
            </>
          )}
        </div>
      </div>
      <AuthArt title="Almost there." />
    </div>
  );
}

export function Auth({ signup = false, admin = false }: { signup?: boolean; admin?: boolean }) {
  const { setUser, locations, area } = useApp();
  const router = useRouter();
  const search = useSearchParams();
  // The store can stop taking new customers; existing ones still sign in.
  const { data: site } = useData<{ settings: Record<string, any> | null }>('/site');
  const closed = signup && site?.settings?.signup_enabled === false;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const safeNext = safePath(search.get('next'));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ user?: User; verify?: boolean; email?: string; retry_in?: number }>(
        signup ? '/auth/register' : admin ? '/auth/admin-login' : '/auth/login',
        { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) },
      );
      // A new account has no session yet: the emailed code comes first.
      if (result.verify || !result.user)
        return router.push(verifyPath(result.email || '', safeNext, result.retry_in));
      setUser(result.user);
      router.push(safeNext || portalPath(result.user.role));
    } catch (e) {
      const failure = e as ApiError;
      // An unverified customer is sent on to enter the code that was just emailed.
      if (failure.code === 'verify_email')
        return router.push(verifyPath(failure.data?.email || '', safeNext, failure.data?.retry_in));
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <div className="auth-panel">
        <div className="auth-card">
          {signup && <SignupSteps step={1} />}
          <span className="auth-badge">
            {admin ? <ShieldCheck size={26} /> : signup ? <UserPlus size={26} /> : <UserRound size={26} />}
          </span>
          <div>
            <span className="eyebrow">{admin ? 'Administration' : signup ? 'New here?' : 'Welcome back'}</span>
            <h1>{admin ? 'Admin sign in' : signup ? 'Create your account' : 'Log in to Dellvit'}</h1>
            <p className="auth-lead">
              {admin
                ? 'Sign in with your administrator email.'
                : signup
                  ? 'It takes a minute. We will email you a 6-digit code to confirm your address.'
                  : 'Order from outlets near you and track every delivery.'}
            </p>
          </div>
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
            {closed && <div className="alert warn">New accounts cannot be created right now. Please check back later.</div>}
            <button disabled={busy || closed} className="button large full">
              {busy ? 'Please wait…' : signup ? 'Continue' : 'Log in'}
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
      <AuthArt title={admin ? 'Run your delivery business.' : 'Your neighbourhood, delivered.'} />
    </div>
  );
}

