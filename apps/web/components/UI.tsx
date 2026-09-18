'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CalendarRange,
  Clock,
  Crosshair,
  Inbox,
  LoaderCircle,
  MapPin,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Store,
  X,
} from 'lucide-react';
import type { Outlet, Product } from '@/lib/types';
import { label as titleCase, money } from '@/lib/api';
import { inRange, rangeOptions, type Range, type RangeKey } from '@/lib/range';
import { useApp } from './Provider';

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
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
      className={'modal modal-' + size}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal-inner">
          <header className="modal-head">
            <h2>{title}</h2>
            <button className="icon-button" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
export function Confirm({
  open,
  title,
  children,
  confirm = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirm?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={'button ' + (danger ? 'danger' : '')} disabled={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirm}
          </button>
        </>
      }
    >
      <div className="muted">{children}</div>
    </Modal>
  );
}
export function Quantity({
  value,
  onChange,
  max = 99,
  small = false,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
  small?: boolean;
}) {
  return (
    <div className={'quantity' + (small ? ' small' : '')}>
      <button aria-label="Decrease quantity" onClick={() => onChange(value - 1)} disabled={value <= 1}>
        <Minus size={14} />
      </button>
      <span>{value}</span>
      <button aria-label="Increase quantity" onClick={() => onChange(value + 1)} disabled={value >= max}>
        <Plus size={14} />
      </button>
    </div>
  );
}
export function CartAction({ product: p }: { product: Product }) {
  const { add, inCart } = useApp();
  const router = useRouter();
  const added = inCart(p.id);
  return (
    <button
      className={'cart-action' + (added ? ' added' : '')}
      onClick={(e) => {
        e.preventDefault();
        if (added) router.push('/cart');
        else add(p);
      }}
      aria-label={added ? 'Go to cart' : 'Add ' + p.name + ' to cart'}
      title={added ? 'In your cart — view cart' : 'Add to cart'}
      disabled={!p.stock && !added}
    >
      {added ? <ArrowRight size={18} /> : <ShoppingCart size={18} />}
    </button>
  );
}
export function ProductCard({ product: p, layout = 'grid' }: { product: Product; layout?: 'grid' | 'row' }) {
  return (
    <article className={'product-card ' + layout}>
      <Link href={'/products/' + p.id} className="product-media">
        <img src={p.images[0]} alt={p.name} loading="lazy" />
        {p.discount > 0 && <span className="badge-offer">-{p.discount}%</span>}
        {p.stock === 0 && <span className="badge-sold">Sold out</span>}
      </Link>
      <div className="product-body">
        <span className="product-outlet">{p.outlet_name}</span>
        <Link href={'/products/' + p.id} className="product-name">
          {p.name}
        </Link>
        <div className="product-meta">
          <span>
            <Clock size={13} />
            {p.delivery_minutes}–{p.delivery_minutes + 10} min
          </span>
          <span>{p.unit}</span>
        </div>
        <div className="product-foot">
          <div className="price">
            <strong>{money(p.effective_price)}</strong>
            {p.discount > 0 && <del>{money(p.price)}</del>}
          </div>
          <CartAction product={p} />
        </div>
      </div>
    </article>
  );
}
export function OutletCard({ outlet: o }: { outlet: Outlet }) {
  return (
    <Link href={'/outlets/' + o.id} className="outlet-card">
      <div className="outlet-media">
        <img src={o.image} alt="" loading="lazy" />
        <span className="chip">{o.category}</span>
      </div>
      <div className="outlet-body">
        <strong>{o.name}</strong>
        <span className="outlet-line">
          <MapPin size={13} />
          {o.address}
        </span>
        <span className="outlet-stats">
          {o.delivery_minutes != null && (
            <span>
              <Clock size={13} />
              {o.delivery_minutes}+ min
            </span>
          )}
          {o.products != null && (
            <span>
              <Store size={13} />
              {o.products} items
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}
export function Empty({
  title,
  children,
  href,
  action,
  icon,
}: {
  title: string;
  children?: ReactNode;
  href?: string;
  action?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Inbox size={26} />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {href && (
        <Link className="button" href={href}>
          {action || 'Browse nearby'}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      {label}
    </div>
  );
}
export function Skeleton({ count = 4, className = 'product-grid' }: { count?: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="alert error" role="alert">
      <span>{error}</span>
      {retry && (
        <button className="link" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
const tones: Record<string, string> = {
  placed: 'info',
  confirmed: 'info',
  preparing: 'warn',
  ready: 'warn',
  picked_up: 'purple',
  delivered: 'success',
  cancelled: 'danger',
  paid: 'success',
  due: 'neutral',
  submitted: 'warn',
  pending: 'warn',
  rejected: 'danger',
  failed: 'danger',
  refund_due: 'purple',
  refunded: 'neutral',
  approved: 'success',
  accepted: 'success',
  unsent: 'neutral',
  verified: 'success',
  active: 'success',
  enabled: 'success',
  disabled: 'neutral',
  inactive: 'neutral',
};
export function Badge({ value, tone, children }: { value?: string; tone?: string; children?: ReactNode }) {
  return (
    <span className={'badge ' + (tone || tones[value || ''] || 'neutral')}>
      <i />
      {children ?? titleCase(value || '')}
    </span>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden />
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}
export function Stat({
  icon,
  label,
  value,
  hint,
  tone = 'red',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
}) {
  return (
    <div className={'stat ' + tone}>
      <span className="stat-icon">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {hint && <em>{hint}</em>}
      </div>
    </div>
  );
}
/** Time-frame picker: presets plus a custom date range. */
export function RangeFilter({
  value,
  onChange,
  label = 'Time frame',
}: {
  value: Range;
  onChange: (r: Range) => void;
  label?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="range-filter">
      <div className="select-wrap">
        <CalendarRange size={15} className="select-lead" />
        <select
          aria-label={label}
          value={value.key}
          onChange={(e) => {
            const key = e.target.value as RangeKey;
            onChange(
              key === 'custom'
                ? {
                    key,
                    from: value.from || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
                    to: value.to || today,
                  }
                : { key },
            );
          }}
        >
          {rangeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={15} />
      </div>
      {value.key === 'custom' && (
        <div className="range-dates">
          <input
            type="date"
            aria-label="From date"
            max={value.to || today}
            value={value.from || ''}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span>to</span>
          <input
            type="date"
            aria-label="To date"
            min={value.from}
            max={today}
            value={value.to || ''}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
/** A heading row with a time-frame filter that controls the cards below it. */
export function FilterBar({
  title,
  hint,
  range,
  onRange,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  range: Range;
  onRange: (r: Range) => void;
  children?: ReactNode;
}) {
  return (
    <div className="filter-bar">
      <div className="filter-bar-title">
        {title && <h3>{title}</h3>}
        {hint && <small>{hint}</small>}
      </div>
      <div className="filter-bar-tools">
        {children}
        <RangeFilter value={range} onChange={onRange} />
      </div>
    </div>
  );
}
/** A labelled button for table rows and panels. */
export function RowAction({
  children,
  onClick,
  href,
  tone = 'ghost',
  disabled,
  icon,
  title,
  external,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: 'primary' | 'ghost' | 'danger' | 'success' | 'warn';
  disabled?: boolean;
  icon?: ReactNode;
  title?: string;
  external?: boolean;
}) {
  const cls = 'button xs ' + (tone === 'primary' ? '' : tone === 'danger' ? 'danger-ghost' : tone);
  return href ? (
    <a
      className={cls}
      href={href}
      title={title}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      onClick={(e) => e.stopPropagation()}
    >
      {icon}
      {children}
    </a>
  ) : (
    <button
      type="button"
      className={cls}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {icon}
      {children}
    </button>
  );
}
export function PageTitle({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  align?: 'right' | 'center';
  width?: string;
};
export type Filter<T> = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  test: (row: T, value: string) => boolean;
  initial?: string;
};
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  search,
  searchPlaceholder = 'Search…',
  filters = [],
  actions,
  toolbar,
  loading,
  error,
  onRetry,
  empty = 'Nothing to show yet.',
  pageSize = 10,
  onRowClick,
  title,
  dateFilter,
}: {
  /** Adds a time-frame filter on the date returned by `get` (defaults to the last 7 days). */
  dateFilter?: { get: (row: T) => string | null | undefined; initial?: RangeKey };
  rows: T[] | null | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  search?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: Filter<T>[];
  actions?: (row: T) => ReactNode;
  toolbar?: ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  title?: ReactNode;
}) {
  const [q, setQ] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(filters.map((f) => [f.key, f.initial ?? 'all'])),
  );
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [range, setRange] = useState<Range>({ key: dateFilter?.initial || '7d' });
  const filtered = useMemo(() => {
    let list = [...(rows || [])];
    const term = q.trim().toLowerCase();
    if (term && search) list = list.filter((r) => search(r).toLowerCase().includes(term));
    if (dateFilter) list = list.filter((r) => inRange(dateFilter.get(r), range));
    for (const f of filters) {
      const v = values[f.key] ?? 'all';
      if (v !== 'all') list = list.filter((r) => f.test(r, v));
    }
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sort && sort)
      list.sort((a, b) => {
        const x = col.sort!(a),
          y = col.sort!(b);
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, values, sort, range]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages);
  const slice = filtered.slice((current - 1) * size, current * size);
  useEffect(() => setPage(1), [q, values, size, range]);
  const pageList = () => {
    const out: (number | '…')[] = [];
    for (let i = 1; i <= pages; i++)
      if (i === 1 || i === pages || Math.abs(i - current) <= 1) out.push(i);
      else if (out[out.length - 1] !== '…') out.push('…');
    return out;
  };
  return (
    <section className="table-card">
      {(title || search || filters.length > 0 || toolbar || dateFilter) && (
        <div className="table-toolbar">
          {title && <div className="table-title">{title}</div>}
          {search && (
            <div className="input-icon">
              <Search size={16} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {filters.map((f) => (
            <div className="select-wrap" key={f.key}>
              <select
                aria-label={f.label}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              >
                <option value="all">All {f.label.toLowerCase()}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
          ))}
          {dateFilter && <RangeFilter value={range} onChange={setRange} />}
          {toolbar && <div className="table-tools">{toolbar}</div>}
        </div>
      )}
      {error && (
        <div className="table-pad">
          <ErrorBox error={error} retry={onRetry} />
        </div>
      )}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align }}>
                  {c.sort ? (
                    <button
                      className="th-sort"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 },
                        )
                      }
                    >
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === 1 ? (
                          <ChevronUp size={13} />
                        ) : (
                          <ChevronDown size={13} />
                        )
                      ) : (
                        <ArrowUpDown size={12} />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
              {actions && <th className="actions-col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading && !rows
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="row-skeleton">
                    {columns.map((c) => (
                      <td key={c.key}>
                        <span />
                      </td>
                    ))}
                    {actions && (
                      <td>
                        <span />
                      </td>
                    )}
                  </tr>
                ))
              : slice.map((r) => (
                  <tr
                    key={rowKey(r)}
                    className={onRowClick ? 'clickable' : ''}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align }} data-label={c.header}>
                        {c.render(r)}
                      </td>
                    ))}
                    {actions && (
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">{actions(r)}</div>
                      </td>
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && rows && !filtered.length && (
          <div className="table-empty">
            <Inbox size={22} />
            <span>{rows.length ? 'No results match your filters.' : empty}</span>
          </div>
        )}
      </div>
      {filtered.length > 0 && (
        <div className="pagination">
          <span className="muted">
            {(current - 1) * size + 1}–{Math.min(current * size, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <div className="pager">
            <div className="select-wrap small">
              <select aria-label="Rows per page" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {[5, 10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
            <button
              className="page-btn"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            {pageList().map((n, i) =>
              n === '…' ? (
                <span key={'gap' + i} className="page-gap">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  className={'page-btn' + (n === current ? ' active' : '')}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ),
            )}
            <button
              className="page-btn"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
export function IconAction({
  label,
  onClick,
  children,
  tone,
  href,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  tone?: 'danger' | 'success';
  href?: string;
  disabled?: boolean;
}) {
  const cls = 'icon-action' + (tone ? ' ' + tone : '');
  return href ? (
    <a className={cls} href={href} title={label} aria-label={label}>
      {children}
    </a>
  ) : (
    <button className={cls} onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      {children}
    </button>
  );
}
export function LocationPicker() {
  const { locations, area, setArea, locationOpen, openLocation, detectArea, areaStatus } = useApp();
  const [q, setQ] = useState('');
  return (
    <Modal open={locationOpen} onClose={() => openLocation(false)} title="Delivery location" size="sm">
      <button
        className="detect-button"
        disabled={areaStatus === 'detecting'}
        onClick={async () => {
          await detectArea();
          openLocation(false);
        }}
      >
        <span>
          {areaStatus === 'detecting' ? <LoaderCircle className="spin" size={18} /> : <Crosshair size={18} />}
        </span>
        <div>
          <strong>{areaStatus === 'detecting' ? 'Detecting…' : 'Use my current location'}</strong>
          <small>We’ll find the nearest delivery area</small>
        </div>
      </button>
      {areaStatus === 'outside' && (
        <div className="alert warn">We don’t deliver to your current location yet. Pick an area below.</div>
      )}
      <div className="input-icon">
        <Search size={16} />
        <input placeholder="Search areas" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="location-list">
        {locations
          .filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
          .map((l) => (
            <button key={l.id} onClick={() => setArea(l)} className={area?.id === l.id ? 'selected' : ''}>
              <MapPin size={18} />
              <span>
                {l.name}
                <small>Within {l.radius ?? 8} km · {money(l.fee ?? 0)} delivery</small>
              </span>
            </button>
          ))}
      </div>
      {!locations.length && (
        <ErrorBox error="Delivery areas could not load. Check that the API is running." />
      )}
    </Modal>
  );
}
