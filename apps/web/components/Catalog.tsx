'use client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  MapPin,
  Package,
  Phone,
  Search,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Tag,
  Truck,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from './Provider';
import { ProductCard, OutletCard, Empty, ErrorBox, Quantity, Skeleton } from './UI';
import { useData } from '@/lib/useData';
import { money } from '@/lib/api';
import type { Product, Outlet } from '@/lib/types';

function NeedsArea() {
  const { openLocation } = useApp();
  return (
    <Empty title="Select your delivery location" icon={<MapPin size={26} />}>
      <button className="button" onClick={() => openLocation(true)}>
        Choose location
      </button>
    </Empty>
  );
}

export function Catalog({ outletId }: { outletId?: string }) {
  const { data: categories } = useData<{ name: string }[]>('/categories');
  const params = useSearchParams();
  const router = useRouter();
  const { area, areaStatus, openLocation } = useApp();
  const [q, setQ] = useState(params.get('q') || '');
  const [cat, setCat] = useState(params.get('category') || 'All');
  const [sort, setSort] = useState('recommended');
  const [deals, setDeals] = useState(false);
  const [inStock, setInStock] = useState(false);
  const query = params.get('q') || '';
  const { data: outlet } = useData<Outlet>(outletId ? '/outlets/' + outletId : null);
  const { data, loading, error, refresh } = useData<Product[]>(
    area
      ? `/products?location=${area.id}&q=${encodeURIComponent(query)}&category=${encodeURIComponent(cat)}${outletId ? '&outlet=' + outletId : ''}`
      : null,
  );
  useEffect(() => {
    setCat(params.get('category') || 'All');
    setQ(params.get('q') || '');
  }, [params]);
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== 'All') next.set(key, value);
    else next.delete(key);
    router.replace('?' + next.toString(), { scroll: false });
  };
  const items = [...(data || [])]
    .filter((p) => (!deals || p.discount > 0) && (!inStock || p.stock > 0))
    .sort((a, b) =>
      sort === 'low'
        ? a.effective_price - b.effective_price
        : sort === 'high'
          ? b.effective_price - a.effective_price
          : sort === 'deals'
            ? b.discount - a.discount
            : sort === 'fast'
              ? a.delivery_minutes - b.delivery_minutes
              : 0,
    );
  return (
    <div className="container page">
      {outlet ? (
        <div className="outlet-hero">
          <img src={outlet.image} alt="" />
          <div className="outlet-hero-copy">
            <span className="chip">{outlet.category}</span>
            <h1>{outlet.name}</h1>
            <div className="outlet-hero-meta">
              <span>
                <MapPin size={15} /> {outlet.address}
              </span>
              <a href={'tel:' + outlet.phone}>
                <Phone size={15} /> {outlet.phone}
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="catalog-head">
          <div>
            <h1>{query ? `Results for “${query}”` : cat !== 'All' ? cat : 'Explore'}</h1>
            <button className="area-link" onClick={() => openLocation(true)}>
              <MapPin size={14} /> {area?.name || 'Select location'}
            </button>
          </div>
          <form
            className="input-icon large"
            onSubmit={(e) => {
              e.preventDefault();
              setParam('q', q.trim());
            }}
          >
            <Search size={18} />
            <input
              placeholder="Search products or outlets"
              aria-label="Search products"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
            />
            {query && (
              <button type="button" className="icon-action" aria-label="Clear search" onClick={() => setParam('q', '')}>
                <X size={16} />
              </button>
            )}
          </form>
        </div>
      )}
      <div className="catalog-bar">
        <div className="chips-scroll">
          {['All', ...(categories || []).map((c) => c.name)].map((c) => (
            <button
              key={c}
              className={'filter-chip' + (cat === c ? ' selected' : '')}
              onClick={() => (outletId ? setCat(c) : setParam('category', c))}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="catalog-controls">
          <button className={'filter-chip' + (deals ? ' selected' : '')} onClick={() => setDeals(!deals)}>
            <Tag size={14} /> Deals
          </button>
          <button className={'filter-chip' + (inStock ? ' selected' : '')} onClick={() => setInStock(!inStock)}>
            <Check size={14} /> In stock
          </button>
          <div className="select-wrap">
            <SlidersHorizontal size={15} className="select-lead" />
            <select aria-label="Sort products" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recommended">Recommended</option>
              <option value="low">Price: low to high</option>
              <option value="high">Price: high to low</option>
              <option value="deals">Biggest discount</option>
              <option value="fast">Fastest delivery</option>
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
      </div>
      {!area && areaStatus !== 'detecting' && areaStatus !== 'loading' ? (
        <NeedsArea />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : loading || !data ? (
        <Skeleton count={8} />
      ) : items.length ? (
        <>
          <p className="results-count">{items.length} items</p>
          <div className="product-grid">
            {items.map((p) => (
              <ProductCard product={p} key={p.id} />
            ))}
          </div>
        </>
      ) : (
        <Empty title="No matching items" icon={<Search size={26} />}>
          Try another search, category or location.
        </Empty>
      )}
    </div>
  );
}

export function Outlets() {
  const { area, areaStatus, openLocation } = useApp();
  const [q, setQ] = useState('');
  const { data: categories } = useData<{ name: string }[]>('/categories');
  const [cat, setCat] = useState('All');
  const { data, loading, error, refresh } = useData<Outlet[]>(area ? '/outlets?location=' + area.id : null);
  const list = (data || []).filter(
    (o) =>
      (cat === 'All' || o.category === cat) &&
      (o.name + ' ' + o.address).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="container page">
      <div className="catalog-head">
        <div>
          <h1>Outlets</h1>
          <button className="area-link" onClick={() => openLocation(true)}>
            <MapPin size={14} /> {area?.name || 'Select location'}
          </button>
        </div>
        <div className="input-icon large">
          <Search size={18} />
          <input placeholder="Search outlets" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="catalog-bar">
        <div className="chips-scroll">
          {['All', ...(categories || []).map((c) => c.name)].map((c) => (
            <button key={c} className={'filter-chip' + (cat === c ? ' selected' : '')} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {!area && areaStatus !== 'detecting' && areaStatus !== 'loading' ? (
        <NeedsArea />
      ) : error ? (
        <ErrorBox error={error} retry={refresh} />
      ) : loading || !data ? (
        <Skeleton count={6} className="outlet-grid" />
      ) : list.length ? (
        <div className="outlet-grid">
          {list.map((o) => (
            <OutletCard outlet={o} key={o.id} />
          ))}
        </div>
      ) : (
        <Empty title="No outlets found" icon={<Store size={26} />}>
          Try another area or category.
        </Empty>
      )}
    </div>
  );
}

export function ProductDetail({ id }: { id: string }) {
  const { data: p, loading, error, refresh } = useData<Product>('/products/' + id);
  const { add, area, openLocation, inCart, cart, quantity } = useApp();
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(0);
  const { data: related } = useData<Product[]>(p ? `/products?location=${p.location_id}&outlet=${p.outlet_id}` : null);
  if (loading && !p)
    return (
      <div className="container page">
        <Skeleton count={2} className="detail-skeleton" />
      </div>
    );
  if (error || !p)
    return (
      <div className="container page">
        <ErrorBox error={error || 'Product not found.'} retry={refresh} />
      </div>
    );
  const line = cart.find((i) => i.product.id === p.id);
  const wrongArea = !!area && area.id !== p.location_id;
  const more = (related || []).filter((r) => r.id !== p.id).slice(0, 4);
  return (
    <div className="container page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <ChevronRight size={14} />
        <Link href={'/search?category=' + encodeURIComponent(p.category)}>{p.category}</Link>
        <ChevronRight size={14} />
        <span>{p.name}</span>
      </nav>
      <div className="detail">
        <div className="gallery">
          <div className="gallery-main">
            <img src={p.images[img] || p.images[0]} alt={p.name} />
            {p.discount > 0 && <span className="badge-offer large">-{p.discount}%</span>}
          </div>
          {p.images.length > 1 && (
            <div className="gallery-thumbs">
              {p.images.map((url, i) => (
                <button
                  key={url + i}
                  className={i === img ? 'selected' : ''}
                  onClick={() => setImg(i)}
                  aria-label={`View image ${i + 1}`}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-info">
          <Link href={'/outlets/' + p.outlet_id} className="detail-outlet">
            <Store size={15} /> {p.outlet_name} <ChevronRight size={14} />
          </Link>
          <h1>{p.name}</h1>
          <div className="detail-price">
            <strong>{money(p.effective_price)}</strong>
            {p.discount > 0 && (
              <>
                <del>{money(p.price)}</del>
                <span className="save">Save {money(p.price - p.effective_price)}</span>
              </>
            )}
          </div>
          {p.deal && (
            <span className="deal">
              <Zap size={14} /> {p.deal}
            </span>
          )}
          <div className="detail-chips">
            <span>
              <Clock size={15} /> {p.delivery_minutes}–{p.delivery_minutes + 10} min
            </span>
            <span>
              <Package size={15} /> {p.unit}
            </span>
            <span className={p.stock > 0 ? 'ok' : 'bad'}>
              {p.stock > 0 ? (p.stock < 10 ? `Only ${p.stock} left` : 'In stock') : 'Sold out'}
            </span>
          </div>
          <p className="detail-desc">{p.description}</p>
          <div className="buy-box">
            {wrongArea && (
              <div className="alert warn">
                Not available in {area!.name}.{' '}
                <button className="link" onClick={() => openLocation(true)}>
                  Change location
                </button>
              </div>
            )}
            {line ? (
              <div className="buy-row">
                <Quantity value={line.quantity} onChange={(v) => quantity(p.id, v)} max={Math.min(p.stock, 99)} />
                <button className="button large grow" onClick={() => router.push('/cart')}>
                  In cart · Go to cart <ArrowRight size={18} />
                </button>
              </div>
            ) : (
              <div className="buy-row">
                <Quantity value={qty} onChange={(v) => setQty(Math.max(1, v))} max={Math.min(p.stock, 99)} />
                <button className="button large grow" disabled={!p.stock || wrongArea} onClick={() => add(p, qty)}>
                  <ShoppingCart size={18} /> Add to cart · {money(p.effective_price * qty)}
                </button>
              </div>
            )}
            {!line && (
              <button
                className="button ghost full"
                disabled={!p.stock || wrongArea}
                onClick={() => {
                  if (add(p, qty)) router.push('/checkout');
                }}
              >
                Buy now
              </button>
            )}
          </div>
          <div className="assurances">
            <span>
              <Truck size={16} /> Delivered by Dellvit riders
            </span>
            <span>
              <ShieldCheck size={16} /> OTP-verified handover
            </span>
          </div>
          <div className="included">
            <div>
              <h3>What’s included</h3>
              <ul>
                {p.includes
                  .split(/,|\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((s) => (
                    <li key={s}>
                      <Check size={15} /> {s}
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <h3>Not included</h3>
              <ul className="excluded">
                {p.excludes
                  .split(/,|\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((s) => (
                    <li key={s}>
                      <X size={15} /> {s}
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      {more.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">From {p.outlet_name}</span>
              <h2>More from this outlet</h2>
            </div>
            <Link className="button ghost small" href={'/outlets/' + p.outlet_id}>
              View outlet <ArrowRight size={15} />
            </Link>
          </div>
          <div className="product-grid">
            {more.map((r) => (
              <ProductCard key={r.id} product={r} />
            ))}
          </div>
        </section>
      )}
      {inCart(p.id) && <div className="sr-only">This item is in your cart.</div>}
    </div>
  );
}
