'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Plus, Clock, MapPin, Minus, X, ShoppingBag } from 'lucide-react';
import type { Product } from '@/lib/types';
import { money } from '@/lib/api';
import { useApp } from './Provider';
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="section-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function Quantity({
  value,
  onChange,
  max = 99,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="quantity">
      <button
        aria-label="Decrease quantity"
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
      >
        <Minus size={16} />
      </button>
      <span>{value}</span>
      <button
        aria-label="Increase quantity"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
export function ProductCard({ product: p }: { product: Product }) {
  const { add } = useApp();
  return (
    <article className="product-card">
      <Link href={'/products/' + p.id} className="product-image">
        <img src={p.images[0]} alt={p.name} width="400" height="300" loading="lazy" />
        {p.discount > 0 && <span className="offer-badge">{p.discount}% OFF</span>}
        {p.stock === 0 && <span className="sold-badge">Sold out</span>}
      </Link>
      <div className="product-content">
        <p className="eyebrow muted">{p.outlet_name}</p>
        <Link href={'/products/' + p.id}>
          <h3>{p.name}</h3>
        </Link>
        <div className="small-meta">
          <span>
            <Clock size={14} />
            {p.delivery_minutes}–{p.delivery_minutes + 10} min
          </span>
          <span>{p.unit}</span>
        </div>
        <div className="price-row">
          <div>
            <strong>{money(p.effective_price)}</strong>
            {p.discount > 0 && <del>{money(p.price)}</del>}
          </div>
          <button
            className="add-button"
            onClick={() => add(p)}
            aria-label={'Add ' + p.name}
            disabled={!p.stock}
          >
            <Plus size={22} />
          </button>
        </div>
      </div>
    </article>
  );
}
export function Empty({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children?: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ShoppingBag size={32} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {href && (
        <Link className="button" href={href}>
          {action || 'Browse nearby'}
          <ArrowUpRight size={18} />
        </Link>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Loading Dellvit…
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      {error}
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function LocationPicker() {
  const { locations, area, setArea, locationOpen, openLocation } = useApp();
  return (
    <Modal open={locationOpen} onClose={() => openLocation(false)} title="Where should we deliver?">
      <p className="muted">Choose your neighbourhood to see available shops and products.</p>
      <div className="location-list">
        {locations.map((l) => (
          <button
            key={l.id}
            onClick={() => setArea(l)}
            className={area?.id === l.id ? 'selected' : ''}
          >
            <MapPin size={22} />
            <span>
              {l.name}
              <small>Delivery within 8 km of this area</small>
            </span>
            {area?.id === l.id && <strong>✓</strong>}
          </button>
        ))}
      </div>
      {!locations.length && (
        <ErrorBox error="Delivery areas could not load. Check that the API is running and the database is seeded." />
      )}
    </Modal>
  );
}
