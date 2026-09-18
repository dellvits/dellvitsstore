'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Mail, Phone, MapPin, ArrowRight, Heart, ShieldCheck, Store, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useData } from '@/lib/useData';
import { ErrorBox } from './UI';

export function About() {
  const { data } = useData<{ settings: Record<string, string> | null }>('/site');
  const settings = data?.settings;
  return (
    <div className="container page">
      <section className="about-hero card">
        <div>
          <span className="eyebrow">About Dellvit</span>
          <h1>{settings?.about_title || 'Your neighbourhood, a little closer.'}</h1>
          <p>
            {settings?.about_description ||
              'Dellvit connects you with local outlets and brings their best to your door — quickly and safely.'}
          </p>
          <Link className="button large" href="/search">
            Explore your area <ArrowRight size={18} />
          </Link>
        </div>
        <img src="/images/rider.webp" alt="Dellvit delivery rider" />
      </section>
      <div className="feature-grid">
        {[
          [Store, 'Rooted in local', 'The shops and kitchens around you, in one place.'],
          [Heart, 'Made for everyday', 'From lunch to weekly groceries.'],
          [ShieldCheck, 'Care at every step', 'Live updates and a private delivery code.'],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Store;
          return (
            <div className="card feature" key={String(title)}>
              <span className="feature-icon">
                <I size={22} />
              </span>
              <h3>{String(title)}</h3>
              <p>{String(body)}</p>
            </div>
          );
        })}
      </div>
      <section className="cta-band">
        <h2>Have a shop or an idea?</h2>
        <Link className="button white" href="/contact">
          Let’s talk <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}

export function Contact() {
  const { data } = useData<{ settings: Record<string, string> | null }>('/site');
  const settings = data?.settings;
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/contact', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const email = settings?.support_email || 'dellvitsupport@gmail.com';
  const phone = settings?.support_phone || '0316 9212708';
  return (
    <div className="container page">
      <div className="page-title">
        <div>
          <span className="eyebrow">Support</span>
          <h1>Contact us</h1>
        </div>
      </div>
      <div className="split reverse">
        <section className="card">
          {success ? (
            <div className="success-state">
              <CheckCircle2 size={36} />
              <h3>Message sent</h3>
              <p className="muted">We’ll get back to you soon. For urgent delivery help, call us.</p>
              <button className="button ghost" onClick={() => setSuccess(false)}>
                Send another
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="stack">
              <div className="form-grid">
                <label>
                  Name
                  <input name="name" required maxLength={100} />
                </label>
                <label>
                  Email
                  <input name="email" type="email" required maxLength={200} />
                </label>
              </div>
              <label>
                Message
                <textarea
                  name="message"
                  required
                  maxLength={3000}
                  rows={6}
                  placeholder="Include your order number for order questions."
                />
              </label>
              {error && <ErrorBox error={error} />}
              <button className="button large" disabled={busy}>
                {busy ? 'Sending…' : 'Send message'} <ArrowRight size={18} />
              </button>
            </form>
          )}
        </section>
        <aside className="stack">
          <a className="card contact-item" href={'mailto:' + email}>
            <span className="feature-icon">
              <Mail size={20} />
            </span>
            <span>
              <small>Email</small>
              <strong>{email}</strong>
            </span>
          </a>
          <a className="card contact-item" href={'tel:' + phone.replace(/\s/g, '')}>
            <span className="feature-icon">
              <Phone size={20} />
            </span>
            <span>
              <small>Phone</small>
              <strong>{phone}</strong>
            </span>
          </a>
          <div className="card contact-item">
            <span className="feature-icon">
              <MapPin size={20} />
            </span>
            <span>
              <small>Address</small>
              <strong>{settings?.support_address || '6th Road, Rawalpindi'}</strong>
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
