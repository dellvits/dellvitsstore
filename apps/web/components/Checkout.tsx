'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { ArrowRight, Trash2, MapPin, ShieldCheck, Wallet, ArrowLeft } from 'lucide-react';
import { useApp } from './Provider';
import { money, api } from '@/lib/api';
import { DELIVERY_FEE } from '@/lib/constants';
import { checkoutId } from '@/lib/id';
import type { Order } from '@/lib/types';
import { Empty, Quantity, ErrorBox, Loading, Modal } from './UI';
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map…</div>,
});
export function Cart() {
  const { cart, quantity, clear, ready } = useApp();
  const [confirm, setConfirm] = useState(false);
  const subtotal = cart.reduce((n, i) => n + i.product.effective_price * i.quantity, 0);
  if (!ready) return <Loading />;
  return (
    <div className="container page">
      <div className="page-heading">
        <div className="eyebrow accent">Good things are gathering</div>
        <h1>Your basket.</h1>
      </div>
      {!cart.length ? (
        <Empty title="Something good belongs here." href="/search">
          Find a local favourite and add it to your basket.
        </Empty>
      ) : (
        <div className="cart-grid">
          <section className="panel">
            <div className="section-head">
              <h2>{cart[0].product.outlet_name}</h2>
              <button className="text-button" onClick={() => setConfirm(true)}>
                Clear basket
              </button>
            </div>
            {cart.map((i) => (
              <div className="cart-item" key={i.product.id}>
                <Link href={'/products/' + i.product.id}>
                  <img src={i.product.images[0]} alt={i.product.name} width="96" height="96" />
                </Link>
                <div className="cart-item-info">
                  <Link href={'/products/' + i.product.id}>
                    <h3>{i.product.name}</h3>
                  </Link>
                  <p>{i.product.unit}</p>
                  <strong>{money(i.product.effective_price)}</strong>
                </div>
                <Quantity
                  value={i.quantity}
                  onChange={(q) => quantity(i.product.id, q)}
                  max={i.product.stock}
                />
                <button
                  className="icon-button"
                  aria-label={'Remove ' + i.product.name}
                  onClick={() => quantity(i.product.id, 0)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            <Link className="text-button" href={'/outlets/' + cart[0].product.outlet_id}>
              <ArrowLeft size={17} />
              Add something else
            </Link>
          </section>
          <aside className="checkout-panel">
            <h2>A quick check</h2>
            <div className="line-item">
              <span>Items subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <div className="line-item">
              <span>Delivery</span>
              <strong>{money(DELIVERY_FEE)}</strong>
            </div>
            <hr />
            <div className="line-item total">
              <span>Total</span>
              <strong>{money(subtotal + DELIVERY_FEE)}</strong>
            </div>
            <Link href="/checkout" className="button full">
              Continue to checkout <ArrowRight size={18} />
            </Link>
            <p className="small-muted center">
              Final prices and availability are checked when you order.
            </p>
          </aside>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Clear your basket?">
        <p>This removes the items you have added.</p>
        <div className="form-actions">
          <button className="button secondary" onClick={() => setConfirm(false)}>
            Keep items
          </button>
          <button
            className="button"
            onClick={() => {
              clear();
              setConfirm(false);
            }}
          >
            Clear basket
          </button>
        </div>
      </Modal>
    </div>
  );
}
export function Checkout() {
  const { cart, clear, user, area, locations, ready } = useApp();
  const router = useRouter();
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState({ lat: 33.6442, lng: 73.0713 });
  const [loc, setLoc] = useState('');
  const key = useRef<string>('');
  const inflight = useRef(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', notes: '' });
  useEffect(() => {
    if (!ready) return;
    const l = locations.find((l) => l.id === cart[0]?.product.location_id) || area;
    if (l) {
      setLoc(l.id);
      setPin({ lat: l.lat, lng: l.lng });
    }
    if (user)
      setForm((f) => ({
        ...f,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
      }));
  }, [ready, user, locations, area, cart[0]?.product.location_id]);
  const subtotal = cart.reduce((n, i) => n + i.product.effective_price * i.quantity, 0);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError('');
    try {
      if (!key.current) key.current = checkoutId();
      const o = await api<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
          delivery: { ...form, location_id: loc, ...pin },
          payment_method: 'cod',
          idempotency_key: key.current,
        }),
      });
      clear();
      router.push('/orders/' + o.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  }
  if (!ready) return <Loading />;
  if (!cart.length)
    return (
      <div className="container page">
        <Empty title="Your basket is empty." href="/search">
          Choose something you love before checking out.
        </Empty>
      </div>
    );
  if (user && user.role !== 'customer')
    return (
      <div className="container page">
        <ErrorBox error="Please log out of your staff account and use a customer account or guest checkout." />
        <Link href="/account" className="button">
          Go to account
        </Link>
      </div>
    );
  return (
    <div className="container page">
      <Link href="/cart" className="back-link">
        <ArrowLeft size={17} />
        Back to basket
      </Link>
      <div className="page-heading">
        <div className="eyebrow accent">Almost at your doorstep</div>
        <h1>Let’s get it to you.</h1>
      </div>
      <form onSubmit={submit} className="cart-grid">
        <div className="form-stack">
          <section className="panel">
            <div className="section-head">
              <h2>Delivery details</h2>
              {!user && (
                <Link className="text-button" href="/login?next=/checkout">
                  Log in for saved details
                </Link>
              )}
            </div>
            {user && (
              <>
                <p className="small-muted">
                  Your saved details are filled in. Changes here apply only to this order.
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={custom}
                    onChange={(e) => {
                      setCustom(e.target.checked);
                      setForm((f) => ({ ...f, address: e.target.checked ? '' : user.address }));
                    }}
                  />
                  Use a different address for this order
                </label>
              </>
            )}
            <div className="form-grid">
              {(['name', 'email', 'phone'] as const).map((k) => (
                <label key={k}>
                  {k === 'name' ? 'Full name' : k === 'email' ? 'Email address' : 'Phone number'}
                  <input
                    required
                    type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'}
                    value={form[k]}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                    maxLength={200}
                  />
                </label>
              ))}
              <label>
                Delivery area
                <select
                  required
                  value={loc}
                  onChange={(e) => {
                    setLoc(e.target.value);
                    const l = locations.find((x) => x.id === e.target.value);
                    if (l) setPin({ lat: l.lat, lng: l.lng });
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
                {custom ? 'Address for this order' : 'Delivery address'}
                <textarea
                  required
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  maxLength={500}
                  placeholder="House number, street and nearby landmark"
                />
              </label>
              <label className="span-2">
                Delivery notes <span className="muted">(optional)</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  maxLength={2000}
                  placeholder="Gate instructions, a landmark or anything we should know"
                />
              </label>
            </div>
          </section>
          <section className="panel">
            <h2>
              <MapPin size={22} />
              Pin your doorstep
            </h2>
            <p className="muted">
              Place the pin at your delivery address to help your rider find you.
            </p>
            <DeliveryMap
              lat={pin.lat}
              lng={pin.lng}
              onChange={(lat, lng) => setPin({ lat, lng })}
            />
            <div className="form-grid">
              <label>
                Latitude
                <input
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={pin.lat}
                  onChange={(e) => setPin((p) => ({ ...p, lat: Number(e.target.value) }))}
                  required
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={pin.lng}
                  onChange={(e) => setPin((p) => ({ ...p, lng: Number(e.target.value) }))}
                  required
                />
              </label>
            </div>
          </section>
        </div>
        <aside className="checkout-panel">
          <h2>Your order</h2>
          <p className="eyebrow accent">{cart[0].product.outlet_name}</p>
          {cart.map((i) => (
            <div className="line-item" key={i.product.id}>
              <span>
                {i.quantity} × {i.product.name}
              </span>
              <strong>{money(i.product.effective_price * i.quantity)}</strong>
            </div>
          ))}
          <hr />
          <div className="line-item">
            <span>Subtotal</span>
            <strong>{money(subtotal)}</strong>
          </div>
          <div className="line-item">
            <span>Delivery</span>
            <strong>{money(DELIVERY_FEE)}</strong>
          </div>
          <div className="line-item total">
            <span>Total</span>
            <strong>{money(subtotal + DELIVERY_FEE)}</strong>
          </div>
          <div className="payment-choice">
            <Wallet size={24} />
            <div>
              <strong>Cash on delivery</strong>
              <small>Pay your rider when your order arrives.</small>
            </div>
            <CheckMark />
          </div>
          <p className="small-muted">
            <ShieldCheck size={15} /> Your delivery code appears after checkout. Share it with your
            rider only after receiving your order.
          </p>
          {!user && (
            <p className="small-muted">
              Guest orders stay accessible in this browser for 7 days. Create an account to keep
              your order history.
            </p>
          )}
          {error && <ErrorBox error={error} />}
          <button className="button full" disabled={busy}>
            {busy ? 'Placing your order…' : 'Place order · ' + money(subtotal + DELIVERY_FEE)}
            <ArrowRight size={18} />
          </button>
        </aside>
      </form>
    </div>
  );
}
function CheckMark() {
  return <span className="accent">✓</span>;
}
