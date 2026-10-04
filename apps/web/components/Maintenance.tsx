'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clock, LayoutDashboard, Mail, MessageCircle, Phone, Settings, Wrench } from 'lucide-react';
import { MAINTENANCE_EVENT } from '@/lib/api';
import { useApp } from './Provider';

/** What the maintenance page shows; null while the store is open. */
export type MaintenanceInfo = {
  name: string;
  title: string;
  message: string;
  until: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  facebook_url?: string;
  instagram_url?: string;
} | null;

const adminPath = (path: string) => path === '/admin' || path.startsWith('/admin/');

/**
 * Swaps every storefront and portal page for the maintenance page while maintenance mode is on.
 * The administrator sign-in and dashboard stay open. The API refuses everyone else as well, so
 * this is the visible half of the lock, not the only one.
 */
export default function MaintenanceGate({ initial, children }: { initial: MaintenanceInfo; children: ReactNode }) {
  const path = usePathname();
  const [info, setInfo] = useState<MaintenanceInfo>(initial);
  const on = !!info;
  useEffect(() => {
    const check = () =>
      fetch('/api/site/head', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setInfo(d.maintenance || null))
        .catch(() => {});
    // An open store learns of maintenance from a refused API request; a closed one checks every
    // minute so the store reopens without a reload.
    window.addEventListener(MAINTENANCE_EVENT, check);
    const timer = on ? setInterval(check, 60000) : undefined;
    if (on) window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener(MAINTENANCE_EVENT, check);
    };
  }, [on]);
  if (!info) return children;
  if (adminPath(path))
    return (
      <>
        <div className="maintenance-bar" role="status">
          <Wrench size={14} /> Maintenance mode is on. Visitors see the maintenance page.
          <Link href="/admin?tab=settings#maintenance">Change</Link>
        </div>
        {children}
      </>
    );
  return <MaintenancePage info={info} />;
}

function Countdown({ until }: { until: string }) {
  // Times depend on the visitor's clock and time zone, so they appear after the page loads.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const end = Date.parse(until);
  if (now === null || Number.isNaN(end)) return <div className="maint-when placeholder" />;
  const left = Math.max(0, Math.floor((end - now) / 1000));
  const when = new Date(end).toLocaleString('en-PK', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  if (!left)
    return (
      <div className="maint-when">
        <Clock size={16} /> Finishing up — we’ll be back any minute now.
      </div>
    );
  const parts = [
    ['days', Math.floor(left / 86400)],
    ['hours', Math.floor((left % 86400) / 3600)],
    ['min', Math.floor((left % 3600) / 60)],
    ['sec', left % 60],
  ] as const;
  return (
    <div className="maint-when">
      <div className="maint-countdown" aria-hidden>
        {parts
          .filter(([k, v]) => k !== 'days' || v > 0)
          .map(([k, v]) => (
            <span key={k}>
              <b>{String(v).padStart(2, '0')}</b>
              <small>{k}</small>
            </span>
          ))}
      </div>
      <span>
        <Clock size={15} /> Expected back {when}
      </span>
    </div>
  );
}

/** The page visitors see; `preview` fits it inside the settings popup instead of the whole screen. */
export function MaintenancePage({ info, preview }: { info: NonNullable<MaintenanceInfo>; preview?: boolean }) {
  const Root = preview ? 'div' : 'main';
  const { user } = useApp();
  const contacts = [
    info.email && { href: 'mailto:' + info.email, icon: <Mail size={16} />, text: info.email },
    info.phone && { href: 'tel:' + info.phone.replace(/[^\d+]/g, ''), icon: <Phone size={16} />, text: info.phone },
    info.whatsapp && {
      href: 'https://wa.me/' + info.whatsapp.replace(/\D/g, ''),
      icon: <MessageCircle size={16} />,
      text: 'WhatsApp',
    },
  ].filter(Boolean) as { href: string; icon: ReactNode; text: string }[];
  const socials = (
    [
      ['Facebook', info.facebook_url],
      ['Instagram', info.instagram_url],
    ] as [string, string | undefined][]
  ).filter((s): s is [string, string] => !!s[1]);
  return (
    <Root className={'maint' + (preview ? ' preview' : '')} id={preview ? undefined : 'main'}>
      <div className="maint-glow" aria-hidden />
      <section className="maint-card">
        <img className="maint-logo" src="/images/logo.webp" alt={info.name} width="484" height="262" />
        <div className="maint-art" aria-hidden>
          <Settings className="maint-gear big" size={64} strokeWidth={1.6} />
          <Settings className="maint-gear small" size={36} strokeWidth={1.8} />
          <span className="maint-tool">
            <Wrench size={26} />
          </span>
        </div>
        <span className="maint-badge">
          <span className="maint-dot" /> Under maintenance
        </span>
        <h1>{info.title || 'We’ll be back soon'}</h1>
        <p className="maint-text">
          {info.message ||
            `${info.name} is getting a few improvements. Ordering is paused for a short while. Thank you for your patience!`}
        </p>
        {info.until && <Countdown until={info.until} />}
        {contacts.length > 0 && (
          <div className="maint-help">
            <small>Need help with an order?</small>
            <div className="maint-contacts">
              {contacts.map((c) => (
                <a key={c.href} href={c.href} target={c.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
                  {c.icon} {c.text}
                </a>
              ))}
            </div>
          </div>
        )}
        {socials.length > 0 && (
          <div className="maint-social">
            {socials.map(([title, href]) => (
              <a key={title} href={href} target="_blank" rel="noopener noreferrer">
                {title}
              </a>
            ))}
          </div>
        )}
        {user?.role === 'admin' && !preview && (
          <Link className="button ghost maint-admin" href="/admin">
            <LayoutDashboard size={16} /> Open dashboard
          </Link>
        )}
      </section>
      <small className="maint-foot">
        © {new Date().getFullYear()} {info.name}
      </small>
    </Root>
  );
}
