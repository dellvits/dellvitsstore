'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import {
  Package,
  ArrowUpRight,
  MapPin,
  Phone,
  Clock,
  ShieldCheck,
  RefreshCw,
  Check,
} from 'lucide-react';
import { useApp } from './Provider';
import { useData } from '@/lib/useData';
import { money, date, label, api } from '@/lib/api';
import type { Order } from '@/lib/types';
import { Loading, ErrorBox, Empty, Modal } from './UI';
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map…</div>,
});
export function Orders() {
  const { ready, user } = useApp();
  const { data, loading, error, refresh } = useData<Order[]>(ready ? '/orders' : null, 15000);
  return (
    <div className="container page">
      <div className="section-head">
        <div>
          <div className="eyebrow accent">From their door to yours</div>
          <h1>Your orders.</h1>
        </div>
        <button className="button secondary" onClick={refresh}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>
      {!user && (
        <p className="muted">
          Guest orders placed in this browser appear here.{' '}
          <Link className="accent" href="/login">
            Log in
          </Link>{' '}
          for your account history.
        </p>
      )}
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : !data?.length ? (
        <Empty title="Your first good thing is waiting." href="/search">
          Once you place an order, you can follow it here.
        </Empty>
      ) : (
        <div className="orders-list">
          {data.map((o) => (
            <Link className="order-card" href={'/orders/' + o.id} key={o.id}>
              <div className="order-card-icon">
                <Package size={26} />
              </div>
              <div>
                <h3>{o.outlet.name}</h3>
                <p>
                  {o.reference} · {date(o.created_at)}
                </p>
                <span>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</span>
              </div>
              <div className="order-card-right">
                <span className={'status ' + o.status}>{label(o.status)}</span>
                <strong>{money(o.total)}</strong>
                <span className="text-button">
                  View order <ArrowUpRight size={16} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
export function Countdown({ deadline, done = false }: { deadline: string; done?: boolean }) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((new Date(deadline).getTime() - t) / 1000));
  return (
    <span>
      {done
        ? 'Completed'
        : seconds > 0
          ? `${Math.floor(seconds / 60)}m ${seconds % 60}s remaining`
          : 'Estimated delivery time passed'}
    </span>
  );
}
export function OrderDetail({ id }: { id: string }) {
  const { ready, user, notice } = useApp();
  const {
    data: o,
    loading,
    error,
    refresh,
  } = useData<Order>(ready ? '/orders/' + id : null, 10000);
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  async function cancelOrder() {
    setBusy(true);
    try {
      await api('/orders/' + id + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      setCancel(false);
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready || (loading && !o)) return <Loading />;
  if (error || !o)
    return (
      <div className="container page">
        <ErrorBox error={error || 'Order not found.'} retry={refresh} />
      </div>
    );
  const stages = ['placed', 'confirmed', 'preparing', 'ready', 'picked_up', 'delivered'];
  const current = stages.indexOf(o.status);
  return (
    <div className="container page">
      <div className="section-head">
        <div>
          <div className="eyebrow accent">{o.reference}</div>
          <h1>
            {o.status === 'delivered'
              ? 'Delivered. Enjoy!'
              : o.status === 'cancelled'
                ? 'Order cancelled.'
                : 'Good things are on their way.'}
          </h1>
          <p>{date(o.created_at)}</p>
        </div>
        <span className={'status ' + o.status}>{label(o.status)}</span>
      </div>
      <div className="cart-grid">
        <div>
          <section className="panel">
            <h2>From {o.outlet.name}</h2>
            {o.status !== 'cancelled' && (
              <div className="timeline">
                {stages.map((s, i) => (
                  <div className={i <= current ? 'done' : ''} key={s}>
                    <span>{i <= current ? <Check size={15} /> : i + 1}</span>
                    <div>
                      <strong>{label(s)}</strong>
                      <small>
                        {o.events.find((e) => e.status === s)
                          ? date(o.events.find((e) => e.status === s)!.created_at)
                          : 'Coming up'}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {o.status !== 'cancelled' && (
              <div className="delivery-estimate">
                <Clock size={21} />
                <div>
                  <strong>
                    <Countdown deadline={o.deliver_by} done={o.status === 'delivered'} />
                  </strong>
                  <small>Estimated arrival: {date(o.deliver_by)}</small>
                </div>
              </div>
            )}
            {o.otp && o.status !== 'cancelled' && (
              <div className="otp-box">
                <ShieldCheck size={26} />
                <div>
                  <h3>Your delivery code</h3>
                  <strong>{o.otp}</strong>
                  <p>Give this code to your rider only after you receive your order.</p>
                </div>
              </div>
            )}
          </section>
          <section className="panel mt-6">
            <h2>Delivery details</h2>
            <p>
              <strong>{o.name}</strong>
              <br />
              {o.phone}
              <br />
              {o.email}
            </p>
            <p>
              <MapPin size={17} />
              {o.address}
            </p>
            {o.notes && (
              <p>
                <strong>Your notes:</strong> {o.notes}
              </p>
            )}
            {o.rider ? (
              <div className="rider-contact">
                <div>
                  <span className="eyebrow accent">Your rider</span>
                  <h3>{o.rider.name}</h3>
                </div>
                <a className="button secondary" href={'tel:' + o.rider.phone}>
                  <Phone size={17} />
                  Call rider
                </a>
              </div>
            ) : (
              <p className="muted">We’re arranging a rider for your order.</p>
            )}
            <DeliveryMap lat={o.lat} lng={o.lng} pickup={o.outlet} />
          </section>
        </div>
        <aside className="checkout-panel">
          <h2>Order summary</h2>
          {o.items.map((i) => (
            <div className="mini-order-item" key={i.id}>
              <img src={i.image} alt="" width="60" height="60" />
              <div>
                <strong>{i.name}</strong>
                <small>
                  {i.quantity} × {money(i.unit_price)}
                </small>
              </div>
            </div>
          ))}
          <hr />
          <div className="line-item">
            <span>Subtotal</span>
            <strong>{money(o.subtotal)}</strong>
          </div>
          <div className="line-item">
            <span>Delivery</span>
            <strong>{money(o.delivery_fee)}</strong>
          </div>
          <div className="line-item total">
            <span>Total</span>
            <strong>{money(o.total)}</strong>
          </div>
          <p className="small-muted">
            Cash on delivery{o.status === 'delivered' ? ' · Collected' : ''}
          </p>
          <Link href="/contact" className="button secondary full">
            Need a hand?
          </Link>
          {user?.role === 'customer' && ['placed', 'confirmed'].includes(o.status) && (
            <button className="text-button full" onClick={() => setCancel(true)}>
              Cancel order
            </button>
          )}
        </aside>
      </div>
      <Modal open={cancel} onClose={() => setCancel(false)} title="Cancel this order?">
        <p>Your order will stop here and no cash will be due.</p>
        <div className="form-actions">
          <button className="button secondary" onClick={() => setCancel(false)}>
            Keep order
          </button>
          <button className="button" disabled={busy} onClick={cancelOrder}>
            Cancel order
          </button>
        </div>
      </Modal>
    </div>
  );
}
