'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Building2,
  Check,
  Copy,
  CreditCard,
  Crosshair,
  ImageUp,
  LoaderCircle,
  Lock,
  MapPin,
  ShieldCheck,
  Smartphone,
  Tag,
  Trash2,
  UserRound,
  Zap,
} from 'lucide-react';
import { useApp } from './Provider';
import { money, api, currentPosition, distanceKm } from '@/lib/api';
import { useData } from '@/lib/useData';
import { checkoutId } from '@/lib/id';
import { methodLogo } from '@/lib/paymentProviders';
import {
  cardBrands,
  detectBrand,
  formatCardNumber,
  tokenizeCard,
  validateCard,
  type CardErrors,
  type CardInput,
} from '@/lib/cardGateways';
const emptyCard: CardInput = { number: '', name: '', expiry: '', cvc: '' };
import type { Order, PaymentMethod } from '@/lib/types';
import { Empty, Quantity, ErrorBox, Loading, Confirm } from './UI';
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map…</div>,
});

export function Cart() {
  const { cart, quantity, clear, ready, locations } = useApp();
  const deliveryFee = locations.find((l) => l.id === cart[0]?.product.location_id)?.fee ?? 0;
  const [confirm, setConfirm] = useState(false);
  const subtotal = cart.reduce((n, i) => n + i.product.effective_price * i.quantity, 0);
  const savings = cart.reduce((n, i) => n + (i.product.price - i.product.effective_price) * i.quantity, 0);
  if (!ready) return <Loading />;
  if (!cart.length)
    return (
      <div className="container page">
        <Empty title="Your cart is empty" href="/search" action="Start shopping">
          Add something good from a local outlet.
        </Empty>
      </div>
    );
  return (
    <div className="container page">
      <div className="page-title">
        <div>
          <span className="eyebrow">{cart.length} item{cart.length > 1 ? 's' : ''}</span>
          <h1>Your cart</h1>
        </div>
      </div>
      <div className="split">
        <section className="card">
          <div className="card-head">
            <Link href={'/outlets/' + cart[0].product.outlet_id} className="card-title-link">
              {cart[0].product.outlet_name}
            </Link>
            <button className="button ghost small" onClick={() => setConfirm(true)}>
              <Trash2 size={15} /> Clear
            </button>
          </div>
          <div className="cart-lines">
            {cart.map((i) => (
              <div className="cart-line" key={i.product.id}>
                <Link href={'/products/' + i.product.id} className="cart-thumb">
                  <img src={i.product.images[0]} alt="" />
                </Link>
                <div className="cart-line-info">
                  <Link href={'/products/' + i.product.id}>
                    <strong>{i.product.name}</strong>
                  </Link>
                  <small>{i.product.unit}</small>
                  <span className="price">
                    <strong>{money(i.product.effective_price)}</strong>
                    {i.product.discount > 0 && <del>{money(i.product.price)}</del>}
                  </span>
                </div>
                <Quantity small value={i.quantity} onChange={(q) => quantity(i.product.id, q)} max={i.product.stock} />
                <strong className="cart-line-total">{money(i.product.effective_price * i.quantity)}</strong>
                <button
                  className="icon-action danger"
                  aria-label={'Remove ' + i.product.name}
                  onClick={() => quantity(i.product.id, 0)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <Link className="button ghost small" href={'/outlets/' + cart[0].product.outlet_id}>
            <ArrowLeft size={15} /> Add more items
          </Link>
        </section>
        <aside className="card summary">
          <h3>Order summary</h3>
          <div className="line">
            <span>Subtotal</span>
            <strong>{money(subtotal)}</strong>
          </div>
          {savings > 0 && (
            <div className="line success">
              <span>You save</span>
              <strong>−{money(savings)}</strong>
            </div>
          )}
          <div className="line">
            <span>Delivery</span>
            <strong>{money(deliveryFee)}</strong>
          </div>
          <div className="line total">
            <span>Total</span>
            <strong>{money(subtotal + deliveryFee)}</strong>
          </div>
          <Link href="/checkout" className="button large full">
            Checkout <ArrowRight size={18} />
          </Link>
          <small className="muted center">Prices and stock are confirmed when you order.</small>
        </aside>
      </div>
      <Confirm
        open={confirm}
        title="Clear your cart?"
        confirm="Clear cart"
        danger
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          clear();
          setConfirm(false);
        }}
      >
        All items will be removed.
      </Confirm>
    </div>
  );
}

function CopyValue({ label, value }: { label: string; value?: string }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <div className="copy-row">
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      <button
        type="button"
        className="icon-action"
        aria-label={'Copy ' + label}
        title="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}
export function AccountDetails({ method }: { method: Partial<PaymentMethod> }) {
  return (
    <div className="account-box">
      <CopyValue label="Bank" value={method.bank_name} />
      <CopyValue label="Wallet" value={method.provider} />
      <CopyValue label="Account title" value={method.account_title} />
      <CopyValue label="Account number" value={method.account_number} />
      <CopyValue label="IBAN" value={method.iban} />
      <CopyValue label="Branch code" value={method.branch_code} />
      <CopyValue label="Mobile number" value={method.mobile_number} />
      <CopyValue label="Raast ID" value={method.raast_id} />
    </div>
  );
}

/** A small brand logo that falls back to a generic card icon until the image exists. */
function BrandLogo({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? (
    <span className="card-brand-fallback" title={name}>
      {name === 'American Express' ? 'AMEX' : name.toUpperCase()}
    </span>
  ) : (
    <img src={src} alt={name} title={name} onError={() => setFailed(true)} />
  );
}

export function CardFields({
  value,
  onChange,
  accepted,
  errors,
}: {
  value: CardInput;
  onChange: (v: CardInput) => void;
  accepted: string[];
  errors: CardErrors;
}) {
  const digits = value.number.replace(/\D/g, '');
  const brand = detectBrand(digits);
  const cvcLength = brand?.cvc || 3;
  return (
    <div className="card-form">
      <div className="card-brands" aria-label="Accepted cards">
        {cardBrands
          .filter((b) => accepted.includes(b.name))
          .map((b) => (
            <span key={b.name} className={'card-brand' + (brand && brand.name !== b.name ? ' dim' : '')}>
              <BrandLogo src={b.logo} name={b.name} />
            </span>
          ))}
      </div>
      <div className="form-grid">
        <label className="span-2">
          Card number
          <span className="card-number">
            <input
              required
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 5678 9012 3456"
              value={formatCardNumber(digits)}
              maxLength={23}
              aria-invalid={!!errors.number}
              onChange={(e) => onChange({ ...value, number: e.target.value.replace(/\D/g, '').slice(0, 19) })}
            />
            <span className="card-number-brand">
              {brand ? <BrandLogo src={brand.logo} name={brand.name} /> : <CreditCard size={18} />}
            </span>
          </span>
          {errors.number && <small className="error-text">{errors.number}</small>}
        </label>
        <label className="span-2">
          Name on card
          <input
            required
            autoComplete="cc-name"
            maxLength={100}
            value={value.name}
            aria-invalid={!!errors.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          {errors.name && <small className="error-text">{errors.name}</small>}
        </label>
        <label>
          Expiry date
          <input
            required
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            maxLength={5}
            value={value.expiry}
            aria-invalid={!!errors.expiry}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, '').slice(0, 4);
              onChange({ ...value, expiry: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d });
            }}
          />
          {errors.expiry && <small className="error-text">{errors.expiry}</small>}
        </label>
        <label>
          Security code (CVV)
          <input
            required
            type="password"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder={'•'.repeat(cvcLength)}
            maxLength={cvcLength}
            value={value.cvc}
            aria-invalid={!!errors.cvc}
            onChange={(e) => onChange({ ...value, cvc: e.target.value.replace(/\D/g, '').slice(0, cvcLength) })}
          />
          {errors.cvc && <small className="error-text">{errors.cvc}</small>}
        </label>
      </div>
      <small className="muted with-icon">
        <Lock size={13} /> Your card details go straight to our secure payment gateway and are never stored by us.
      </small>
    </div>
  );
}
export const paymentIcon = (type?: string) =>
  type === 'cod'
    ? Banknote
    : type === 'wallet'
      ? Smartphone
      : type === 'raast'
        ? Zap
        : type === 'card'
          ? CreditCard
          : Building2;
/** A payment method's provider logo (or uploaded logo), falling back to its type icon if the image is missing. */
export function PaymentLogo({
  method,
  className,
  size = 20,
}: {
  method: Partial<PaymentMethod>;
  className: string;
  size?: number;
}) {
  const src = methodLogo(method);
  const [failed, setFailed] = useState(false);
  // Try the image again whenever it changes or the component remounts (e.g. a logo was added later).
  useEffect(() => setFailed(false), [src]);
  const I = paymentIcon(method.type);
  const show = !!src && !failed;
  return (
    <span className={className + (show ? ' has-logo' : '')}>
      {show ? <img className="pay-logo" src={src} alt="" onError={() => setFailed(true)} /> : <I size={size} />}
    </span>
  );
}
/** The payment method recorded on an order, shown with its logo. */
export function PaymentName({
  order,
}: {
  order: { payment_type?: string; payment_name?: string; payment_details?: Partial<PaymentMethod> };
}) {
  return (
    <span className="pay-name">
      <PaymentLogo
        method={{ ...order.payment_details, type: (order.payment_type || 'cod') as PaymentMethod['type'] }}
        className="pay-mini"
        size={13}
      />
      {order.payment_name}
    </span>
  );
}

export type Proof = { transaction_id: string; payer_name: string; payer_account: string; proof_id?: string; proof_url?: string };
export function PaymentProofFields({
  value,
  onChange,
  requireProof,
}: {
  value: Proof;
  onChange: (v: Proof) => void;
  requireProof?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="form-grid">
      <label>
        Transaction ID (TID)
        <input
          required
          minLength={4}
          maxLength={60}
          value={value.transaction_id}
          onChange={(e) => onChange({ ...value, transaction_id: e.target.value })}
          placeholder="e.g. 0123456789"
        />
      </label>
      <label>
        Sender account name
        <input
          required
          maxLength={100}
          value={value.payer_name}
          onChange={(e) => onChange({ ...value, payer_name: e.target.value })}
        />
      </label>
      <label>
        Sender number / account <span className="muted">(optional)</span>
        <input
          maxLength={40}
          value={value.payer_account}
          onChange={(e) => onChange({ ...value, payer_account: e.target.value })}
          placeholder="03XX XXXXXXX"
        />
      </label>
      <div className="field">
        <span className="field-label">
          Receipt screenshot {requireProof ? '' : <span className="muted">(optional)</span>}
        </span>
        <label className={'upload-tile' + (value.proof_url ? ' has-file' : '')}>
          {value.proof_url ? (
            <img src={value.proof_url} alt="Payment receipt" />
          ) : busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <ImageUp size={18} />
          )}
          <span>{value.proof_url ? 'Replace screenshot' : busy ? 'Uploading…' : 'Upload screenshot'}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setBusy(true);
              setError('');
              try {
                const form = new FormData();
                form.append('file', file);
                const r = await api<{ id: string; url: string }>('/payment-proofs', { method: 'POST', body: form });
                onChange({ ...value, proof_id: r.id, proof_url: r.url });
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {error && <small className="error-text">{error}</small>}
      </div>
    </div>
  );
}

function AuthGate() {
  return (
    <div className="container page narrow">
      <div className="card gate">
        <span className="gate-icon">
          <Lock size={26} />
        </span>
        <h1>Sign in to check out</h1>
        <p className="muted">
          An account keeps your orders, delivery code and payment status safe. Your cart is saved.
        </p>
        <div className="gate-actions">
          <Link href="/login?next=/checkout" className="button large">
            <UserRound size={17} /> Log in
          </Link>
          <Link href="/signup?next=/checkout" className="button ghost large">
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Checkout() {
  const { cart, clear, user, area, locations, ready, coords, notice } = useApp();
  const router = useRouter();
  const { data: payments, error: paymentError } = useData<PaymentMethod[]>('/payments', 30000);
  const [payment, setPayment] = useState('');
  const [proof, setProof] = useState<Proof>({ transaction_id: '', payer_name: '', payer_account: '' });
  const [cardInput, setCardInput] = useState<CardInput>(emptyCard);
  const [cardErrors, setCardErrors] = useState<CardErrors>({});
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [quote, setQuote] = useState<{ signature: string; total: number; delivery_fee: number; discount: number } | null>(
    null,
  );
  const [quoteError, setQuoteError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [pin, setPin] = useState({ lat: 33.6442, lng: 73.0713 });
  const [loc, setLoc] = useState('');
  const signature = JSON.stringify({
    items: cart.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
    location_id: loc,
    coupon_code: appliedCoupon,
  });
  useEffect(() => {
    if (!loc || !cart.length) return;
    let alive = true;
    setQuoteError('');
    api<{ total: number; delivery_fee: number; discount: number }>('/quote', { method: 'POST', body: signature })
      .then((q) => alive && setQuote({ ...q, signature }))
      .catch((e) => {
        if (alive) {
          setQuote(null);
          setQuoteError(e.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [signature, loc, cart.length]);
  useEffect(() => {
    if (payments && !payments.some((p) => p.id === payment)) setPayment(payments[0]?.id || '');
  }, [payments, payment]);
  const key = useRef('');
  const inflight = useRef(false);
  const initialized = useRef('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', notes: '' });
  useEffect(() => {
    if (!ready || !user) return;
    const init = user.id + ':' + (cart[0]?.product.location_id || '');
    if (initialized.current === init) return;
    const l = locations.find((l) => l.id === cart[0]?.product.location_id) || area;
    if (l) {
      initialized.current = init;
      setLoc(l.id);
      const near = coords && distanceKm(coords, l) <= (l.radius ?? 8);
      setPin(near ? coords! : { lat: l.lat, lng: l.lng });
    }
    setForm((f) => ({ ...f, name: user.name, email: user.email, phone: user.phone, address: user.address }));
    setProof((p) => ({ ...p, payer_name: p.payer_name || user.name }));
  }, [ready, user, locations, area, coords, cart]);
  const method = payments?.find((p) => p.id === payment);
  const online = !!method && method.type !== 'cod';
  const card = method?.type === 'card';
  const subtotal = cart.reduce((n, i) => n + i.product.effective_price * i.quantity, 0);
  const areaInfo = locations.find((l) => l.id === loc);
  const deliveryFee = quote?.delivery_fee ?? areaInfo?.fee ?? 0;
  const total = quote?.total ?? subtotal + deliveryFee;
  const pinKm = areaInfo ? distanceKm(pin, areaInfo) : 0;
  const pinOutside = !!areaInfo && pinKm > (areaInfo.radius ?? 8);

  async function locate() {
    setLocating(true);
    try {
      const p = await currentPosition();
      setPin({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) });
      notice(`Location set (±${Math.round(p.accuracy)} m). Drag or tap the map to fine-tune.`);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setLocating(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError('');
    try {
      let cardToken = '';
      if (card) {
        const errors = validateCard(cardInput, method!.card_networks || []);
        setCardErrors(errors);
        if (Object.keys(errors).length) return;
        cardToken = await tokenizeCard(cardInput, method!);
      }
      if (!key.current) key.current = checkoutId();
      const o = await api<Order & { payment_redirect_url?: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
          delivery: { ...form, location_id: loc, ...pin },
          payment_method: payment,
          payment: card
            ? { card_token: cardToken }
            : online
              ? {
                  transaction_id: proof.transaction_id.trim(),
                  payer_name: proof.payer_name.trim(),
                  payer_account: proof.payer_account.trim(),
                  proof_id: proof.proof_id,
                }
              : undefined,
          coupon_code: appliedCoupon,
          idempotency_key: key.current,
        }),
      });
      setCardInput(emptyCard);
      clear();
      if (o.payment_redirect_url) window.location.assign(o.payment_redirect_url);
      else router.push('/orders/' + o.id);
    } catch (e) {
      // A declined card cancels that order, so the next attempt needs a new checkout key.
      // Network errors keep the key, so a retry cannot charge twice.
      if (card && !(e instanceof TypeError)) key.current = '';
      setError((e as Error).message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  }
  if (!ready) return <Loading />;
  if (!cart.length)
    return (
      <div className="container page">
        <Empty title="Your cart is empty" href="/search" action="Start shopping" />
      </div>
    );
  if (!user) return <AuthGate />;
  if (user.role !== 'customer')
    return (
      <div className="container page narrow">
        <ErrorBox error="Staff accounts cannot place orders. Log out and use a customer account." />
      </div>
    );
  return (
    <div className="container page">
      <Link href="/cart" className="back-link">
        <ArrowLeft size={16} /> Back to cart
      </Link>
      <div className="page-title">
        <div>
          <h1>Checkout</h1>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      <form onSubmit={submit} className="split">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>
                <span className="step-dot">1</span> Contact & address
              </h3>
            </div>
            <div className="form-grid">
              <label>
                Full name
                <input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Phone number
                <input
                  required
                  type="tel"
                  maxLength={20}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  maxLength={200}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
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
                Address
                <textarea
                  required
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  maxLength={500}
                  placeholder="House, street and nearby landmark"
                />
              </label>
              <label className="span-2">
                Notes for rider <span className="muted">(optional)</span>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  maxLength={2000}
                  placeholder="Gate code, floor, landmark…"
                />
              </label>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h3>
                <span className="step-dot">2</span> Pin your doorstep
              </h3>
              <button type="button" className="button ghost small" onClick={locate} disabled={locating}>
                {locating ? <LoaderCircle size={15} className="spin" /> : <Crosshair size={15} />}
                {locating ? 'Locating…' : 'Use my current location'}
              </button>
            </div>
            <DeliveryMap lat={pin.lat} lng={pin.lng} onChange={(lat, lng) => setPin({ lat, lng })} />
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
            {pinOutside && (
              <div className="alert warn">
                <MapPin size={16} /> This pin is {pinKm.toFixed(1)} km from {areaInfo!.name}. Deliveries reach
                up to {areaInfo!.radius ?? 8} km.
              </div>
            )}
          </section>
          <section className="card">
            <div className="card-head">
              <h3>
                <span className="step-dot">3</span> Payment
              </h3>
            </div>
            {paymentError && <ErrorBox error={paymentError} />}
            {payments?.length === 0 && <ErrorBox error="Ordering is paused until a payment method is enabled." />}
            <div className="pay-options">
              {payments?.map((p) => {
                return (
                  <label className={'pay-option' + (payment === p.id ? ' selected' : '')} key={p.id}>
                    <input
                      type="radio"
                      name="payment"
                      value={p.id}
                      checked={payment === p.id}
                      onChange={() => setPayment(p.id)}
                      required
                    />
                    <PaymentLogo method={p} className="pay-icon" />
                    <span className="pay-text">
                      <strong>{p.name}</strong>
                      <small>
                        {p.type === 'cod'
                          ? 'Pay the rider in cash'
                          : p.type === 'card'
                            ? 'Debit / credit card'
                            : p.provider || p.bank_name || 'Online transfer'}
                      </small>
                    </span>
                    <span className="radio-dot" />
                  </label>
                );
              })}
            </div>
            {card && method && (
              <div className="pay-panel">
                <CardFields
                  value={cardInput}
                  onChange={(v) => {
                    setCardInput(v);
                    setCardErrors({});
                  }}
                  accepted={method.card_networks || []}
                  errors={cardErrors}
                />
                {method.instructions && <p className="muted small">{method.instructions}</p>}
              </div>
            )}
            {online && !card && method && (
              <div className="pay-panel">
                <div className="pay-steps">
                  <span>
                    <b>1</b> Send <strong>{money(total)}</strong> to the account below
                  </span>
                  <span>
                    <b>2</b> Enter the transaction details from your receipt
                  </span>
                  <span>
                    <b>3</b> We verify the payment, then your order is accepted
                  </span>
                </div>
                <AccountDetails method={method} />
                {method.instructions && <p className="muted small">{method.instructions}</p>}
                <PaymentProofFields value={proof} onChange={setProof} requireProof={method.require_proof} />
              </div>
            )}
          </section>
        </div>
        <aside className="card summary sticky">
          <h3>Order summary</h3>
          <small className="muted">{cart[0].product.outlet_name}</small>
          <div className="summary-items">
            {cart.map((i) => (
              <div className="summary-item" key={i.product.id}>
                <img src={i.product.images[0]} alt="" />
                <span>
                  <strong>{i.product.name}</strong>
                  <small>Qty {i.quantity}</small>
                </span>
                <strong>{money(i.product.effective_price * i.quantity)}</strong>
              </div>
            ))}
          </div>
          <div className="coupon">
            <div className="input-icon">
              <Tag size={15} />
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                maxLength={30}
                placeholder="Coupon code"
                aria-label="Coupon code"
              />
            </div>
            <button type="button" className="button ghost" onClick={() => setAppliedCoupon(coupon.trim())}>
              Apply
            </button>
          </div>
          {appliedCoupon && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setAppliedCoupon('');
                setCoupon('');
              }}
            >
              Remove {appliedCoupon}
            </button>
          )}
          {quoteError && <ErrorBox error={quoteError} />}
          <div className="line">
            <span>Subtotal</span>
            <strong>{money(subtotal)}</strong>
          </div>
          <div className="line">
            <span>Delivery</span>
            <strong>{money(deliveryFee)}</strong>
          </div>
          {!!quote?.discount && (
            <div className="line success">
              <span>Discount</span>
              <strong>−{money(quote.discount)}</strong>
            </div>
          )}
          <div className="line total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <button
            className="button large full"
            disabled={busy || !payment || quote?.signature !== signature || !!quoteError || !!paymentError}
          >
            {busy
              ? card
                ? 'Processing payment…'
                : 'Placing order…'
              : card
                ? `Pay ${money(total)}`
                : online
                  ? 'Submit payment & order'
                  : 'Place order'}
            <ArrowRight size={18} />
          </button>
          <small className="muted center with-icon">
            <ShieldCheck size={14} /> You’ll get a delivery code to share with your rider.
          </small>
        </aside>
      </form>
    </div>
  );
}
