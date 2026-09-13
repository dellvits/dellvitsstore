'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Mail, Phone, MapPin, ArrowRight, Heart, ShieldCheck, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorBox } from './UI';
export function About() {
  return (
    <div className="container page">
      <div className="about-hero">
        <div>
          <div className="eyebrow accent">Meet Dellvit</div>
          <h1>
            Your neighbourhood.
            <br />A little closer.
          </h1>
          <p>
            Good food, fresh groceries and everyday essentials shouldn’t be far away. Dellvit
            connects you with local outlets and brings their best to your door.
          </p>
          <Link className="button" href="/search">
            Explore your area <ArrowRight size={18} />
          </Link>
        </div>
        <img src="/images/rider.webp" alt="Dellvit delivery rider" width="700" height="470" />
      </div>
      <div className="about-values">
        {[
          [
            Store,
            'Rooted in local',
            'Discover the shops and kitchens around you, all in one place.',
          ],
          [
            Heart,
            'Made for everyday',
            'From lunch to your weekly groceries, we help make the little things easier.',
          ],
          [
            ShieldCheck,
            'Care at every step',
            'Follow order updates and confirm delivery with your own private code.',
          ],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Store;
          return (
            <section className="panel" key={String(title)}>
              <I size={32} />
              <h2>{String(title)}</h2>
              <p>{String(body)}</p>
            </section>
          );
        })}
      </div>
      <section className="about-cta">
        <h2>Have a shop, a question or an idea?</h2>
        <p>We’d love to hear from you.</p>
        <Link className="button secondary" href="/contact">
          Let’s talk <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}
export function Contact() {
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
  return (
    <div className="container page">
      <div className="page-heading">
        <div className="eyebrow accent">A real person is a good start</div>
        <h1>Let’s talk.</h1>
        <p>Order question, partnership idea or just saying hello? We’re here.</p>
      </div>
      <div className="contact-grid">
        <div className="contact-details">
          <a href="mailto:dellvitsupport@gmail.com">
            <Mail />
            <span>
              <small>EMAIL US</small>
              <strong>dellvitsupport@gmail.com</strong>
            </span>
          </a>
          <a href="tel:+923169212708">
            <Phone />
            <span>
              <small>GIVE US A CALL</small>
              <strong>0316 9212708</strong>
            </span>
          </a>
          <div>
            <MapPin />
            <span>
              <small>FIND US</small>
              <strong>6th Road, Rawalpindi</strong>
            </span>
          </div>
          <img
            src="/images/parcel.webp"
            alt="A parcel ready for delivery"
            width="400"
            height="350"
          />
        </div>
        <section className="panel">
          <h2>Drop us a message.</h2>
          {success ? (
            <div className="success-box">
              <h3>Your message is with us.</h3>
              <p>
                The Dellvit team can now see your message and contact details. For urgent delivery
                help, give us a call.
              </p>
              <button className="button secondary" onClick={() => setSuccess(false)}>
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="form-stack">
              <label>
                Your name
                <input name="name" required maxLength={100} />
              </label>
              <label>
                Email address
                <input name="email" type="email" required maxLength={200} />
              </label>
              <label>
                How can we help?
                <textarea
                  name="message"
                  required
                  maxLength={3000}
                  rows={6}
                  placeholder="For an order enquiry, include your order number."
                />
              </label>
              {error && <ErrorBox error={error} />}
              <button className="button" disabled={busy}>
                {busy ? 'Sending…' : 'Send message'}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
