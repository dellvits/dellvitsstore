'use client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Search, MapPin, ArrowLeft, ArrowUpRight, Clock, Check, ShoppingBag } from 'lucide-react';
import { useApp } from './Provider';
import { ProductCard, Loading, Empty, ErrorBox, Quantity } from './UI';
import { useData } from '@/lib/useData';
import { money } from '@/lib/api';
import { DELIVERY_FEE } from '@/lib/constants';
import type { Product, Outlet } from '@/lib/types';
export function Catalog({ outletId }: { outletId?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { area, openLocation } = useApp();
  const [q, setQ] = useState(params.get('q') || '');
  const [query, setQuery] = useState(params.get('q') || '');
  const [cat, setCat] = useState(params.get('category') || 'All');
  const [sort, setSort] = useState('recommended');
  const { data: outlet } = useData<Outlet>(outletId ? '/outlets/' + outletId : null);
  const { data, loading, error, refresh } = useData<Product[]>(
    area
      ? `/products?location=${area.id}&q=${encodeURIComponent(query)}&category=${encodeURIComponent(cat)}${outletId ? '&outlet=' + outletId : ''}`
      : null,
  );
  useEffect(() => {
    setCat(params.get('category') || 'All');
    setQ(params.get('q') || '');
    setQuery(params.get('q') || '');
  }, [params]);
  const items = [...(data || [])].sort((a, b) =>
    sort === 'low'
      ? a.effective_price - b.effective_price
      : sort === 'high'
        ? b.effective_price - a.effective_price
        : sort === 'deals'
          ? b.discount - a.discount
          : 0,
  );
  return (
    <div className="container page">
      <div className="page-heading">
        <div className="eyebrow accent">Your neighbourhood, on the menu</div>
        <h1>{outlet?.name || 'Find your next favourite.'}</h1>
        <p>
          {outlet?.address ||
            'Food, fresh groceries and everyday essentials — all a little closer.'}
        </p>
      </div>
      <div className="catalog-toolbar">
        <form
          className="search-input"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <Search size={20} />
          <input
            placeholder="Search food, groceries, outlets…"
            aria-label="Search products"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="button small">Search</button>
        </form>
        <button className="button secondary" onClick={() => openLocation(true)}>
          <MapPin size={18} />
          {area?.name || 'Choose delivery area'}
        </button>
      </div>
      <div className="filter-row">
        <div className="filter-pills">
          {['All', 'Food', 'Groceries', 'Parcels', 'More'].map((c) => (
            <button key={c} className={cat === c ? 'selected' : ''} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <select aria-label="Sort products" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recommended">Recommended</option>
          <option value="low">Price: low to high</option>
          <option value="high">Price: high to low</option>
          <option value="deals">Biggest discounts</option>
        </select>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : items.length ? (
        <>
          <p className="results-count">{items.length} good things to choose from</p>
          <div className="product-grid">
            {items.map((p) => (
              <ProductCard product={p} key={p.id} />
            ))}
          </div>
        </>
      ) : (
        <Empty title="Nothing here just yet.">
          Try a different search, category or delivery area.
        </Empty>
      )}
    </div>
  );
}
export function Outlets() {
  const { area, openLocation } = useApp();
  const { data, loading, error, refresh } = useData<Outlet[]>(
    area ? '/outlets?location=' + area.id : null,
  );
  return (
    <div className="container page">
      <div className="page-heading">
        <div className="eyebrow accent">Meet your local favourites</div>
        <h1>Good neighbours. Great finds.</h1>
        <p>Discover the kitchens and shops that make your area special.</p>
      </div>
      <button className="button secondary" onClick={() => openLocation(true)}>
        <MapPin size={18} />
        {area?.name || 'Choose delivery area'}
      </button>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : (
        <div className="outlet-grid">
          {data?.map((o) => (
            <Link href={'/outlets/' + o.id} key={o.id} className="outlet-card">
              <img src={o.image} alt={o.name} width="600" height="320" />
              <div>
                <span className="eyebrow accent">{o.category}</span>
                <h2>{o.name}</h2>
                <p>
                  <MapPin size={15} />
                  {o.address}
                </p>
                <span className="text-button">
                  Explore outlet <ArrowUpRight size={18} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {data?.length === 0 && (
        <Empty title="More neighbours coming soon.">
          Choose another area to explore available outlets.
        </Empty>
      )}
    </div>
  );
}
export function ProductDetail({ id }: { id: string }) {
  const { data: p, loading, error, refresh } = useData<Product>('/products/' + id);
  const { user, add, area, openLocation } = useApp();
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(0);
  if (loading) return <Loading />;
  if (error || !p)
    return (
      <div className="container page">
        <ErrorBox error={error || 'Product not found.'} retry={refresh} />
      </div>
    );
  return (
    <div className="container page">
      <Link className="back-link" href="/search">
        <ArrowLeft size={16} />
        Back to browsing
      </Link>
      <div className="detail-grid">
        <div>
          <div className="detail-image">
            <img src={p.images[img] || p.images[0]} alt={p.name} width="700" height="550" />
            {p.discount > 0 && <span className="offer-badge">{p.discount}% OFF</span>}
          </div>
          {p.images.length > 1 && (
            <div className="thumbs">
              {p.images.map((url, i) => (
                <button key={url} onClick={() => setImg(i)} aria-label={`View image ${i + 1}`}>
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          )}
          <div className="detail-info">
            <Link href={'/outlets/' + p.outlet_id} className="eyebrow accent">
              {p.outlet_name} <ArrowUpRight size={14} />
            </Link>
            <h1>{p.name}</h1>
            <p>{p.description}</p>
            <div className="detail-tags">
              <span>
                <Clock size={16} />
                {p.delivery_minutes}–{p.delivery_minutes + 10} min
              </span>
              <span>{p.unit}</span>
              <span>{p.stock} available</span>
            </div>
            <div className="included-grid">
              <div>
                <h3>What’s included</h3>
                <p>
                  <Check size={16} />
                  {p.includes}
                </p>
              </div>
              <div>
                <h3>Not included</h3>
                <p>{p.excludes}</p>
              </div>
            </div>
          </div>
        </div>
        <aside className="checkout-panel">
          <span className="eyebrow accent">A little happiness, delivered</span>
          <h2>Your order</h2>
          <div className="detail-price">
            <strong>{money(p.effective_price)}</strong>
            {p.discount > 0 && <del>{money(p.price)}</del>}
          </div>
          {p.deal && <p className="deal-tag">{p.deal}</p>}
          <div className="line-item">
            <span>Quantity</span>
            <Quantity
              value={qty}
              onChange={(v) => setQty(Math.max(1, v))}
              max={Math.min(p.stock, 99)}
            />
          </div>
          <hr />
          <h3>Delivering to</h3>
          <button className="area-inline" onClick={() => openLocation(true)}>
            <MapPin size={17} />
            {area?.name || 'Choose your area'}
          </button>
          {user ? (
            <div className="delivery-preview">
              <strong>{user.name}</strong>
              <span>{user.phone}</span>
              <span>{user.email}</span>
              <p>{user.address}</p>
            </div>
          ) : (
            <p className="muted">
              Enter your details at checkout, or{' '}
              <Link className="accent" href="/login">
                log in
              </Link>{' '}
              to use your saved address.
            </p>
          )}
          <p className="small-muted">
            You can use a different delivery address and add notes at checkout.
          </p>
          <hr />
          <div className="line-item">
            <span>Items subtotal</span>
            <strong>{money(p.effective_price * qty)}</strong>
          </div>
          <button className="button full" disabled={!p.stock} onClick={() => add(p, qty)}>
            <ShoppingBag size={18} />
            Add to basket
          </button>
          <button
            className="button secondary full"
            disabled={!p.stock}
            onClick={() => {
              if (add(p, qty)) router.push('/checkout');
            }}
          >
            Order now <ArrowRightIcon />
          </button>
          <p className="small-muted center">
            Cash on delivery · Delivery fee {money(DELIVERY_FEE)}
          </p>
        </aside>
      </div>
    </div>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={18} />;
}
