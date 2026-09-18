'use client';
import Link from 'next/link';
import { useRef } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Headphones,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Zap,
  Package,
  Store,
} from 'lucide-react';
import { useApp } from './Provider';
import { useData } from '@/lib/useData';
import type { Product, Ad, Outlet } from '@/lib/types';
import { ProductCard, OutletCard, ErrorBox, Skeleton, Empty } from './UI';

type Site = {
  settings: Record<string, any> | null;
  content: {
    id: string;
    name: string;
    type: string;
    description: string;
    image: string;
    link: string;
    button: string;
  }[];
};
type Feed = {
  nearby: Product[];
  categories: { id: string; name: string; description: string; products: Product[] }[];
  outlets: Outlet[];
};

function SectionHead({
  eyebrow,
  title,
  href,
  action = 'Explore all',
  children,
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  action?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      <div className="section-tools">
        {children}
        {href && (
          <Link href={href} className="button ghost small">
            {action} <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </div>
  );
}

function ChooseLocation() {
  const { openLocation, detectArea, areaStatus } = useApp();
  return (
    <div className="location-cta">
      <span className="location-cta-icon">
        <MapPin size={24} />
      </span>
      <div>
        <strong>
          {areaStatus === 'outside'
            ? 'We don’t deliver to your location yet'
            : 'Choose your location to see what’s nearby'}
        </strong>
        <p>Products and outlets are shown for your delivery area.</p>
      </div>
      <div className="location-cta-actions">
        <button className="button ghost" onClick={() => detectArea()} disabled={areaStatus === 'detecting'}>
          {areaStatus === 'detecting' ? <LoaderCircle className="spin" size={16} /> : <Crosshair size={16} />}
          Detect
        </button>
        <button className="button" onClick={() => openLocation(true)}>
          Select location
        </button>
      </div>
    </div>
  );
}

function OutletRail({ outlets }: { outlets: Outlet[] }) {
  const rail = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) =>
    rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="section container">
      <SectionHead eyebrow="Shops & kitchens" title="Outlets near you" href="/outlets" action="Explore more">
        {outlets.length > 3 && (
          <div className="rail-arrows">
            <button className="round-btn" onClick={() => scroll(-1)} aria-label="Scroll outlets left">
              <ChevronLeft size={18} />
            </button>
            <button className="round-btn" onClick={() => scroll(1)} aria-label="Scroll outlets right">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </SectionHead>
      <div className="rail" ref={rail}>
        {outlets.map((o) => (
          <OutletCard outlet={o} key={o.id} />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const { data: site, error: siteError } = useData<Site>('/site');
  const { data: ad } = useData<Ad>('/ad');
  const { area, areaStatus, openLocation } = useApp();
  const { data: feed, loading, error, refresh } = useData<Feed>(area ? '/home?location=' + area.id : null);
  const show = (k: string) => site?.settings?.['show_' + k] !== false;
  const hero = site?.content.find((c) => c.type === 'hero');
  const waiting = areaStatus === 'loading' || areaStatus === 'detecting' || (area && loading && !feed);
  return (
    <div className="home">
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="hero-tag">
              <Zap size={14} /> Fast local delivery
            </span>
            <h1>
              {hero?.name || (
                <>
                  Everything you need, <span>delivered fast.</span>
                </>
              )}
            </h1>
            <p>{hero?.description || 'Meals, groceries and essentials from outlets near you.'}</p>
            <div className="hero-actions">
              <button className="hero-location" onClick={() => openLocation(true)}>
                <MapPin size={18} />
                <span>
                  <small>Delivering to</small>
                  <strong>
                    {areaStatus === 'detecting' ? 'Detecting your location…' : area?.name || 'Select your location'}
                  </strong>
                </span>
              </button>
              <Link href="/search" className="button large">
                Start shopping <ArrowRight size={18} />
              </Link>
            </div>
            <div className="hero-stats">
              <span>
                <strong>30 min</strong> avg. delivery
              </span>
              <span>
                <strong>COD</strong> & online payments
              </span>
              <span>
                <strong>OTP</strong> secured handover
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <img
              src={hero?.image || '/images/hero-phone.webp'}
              alt="Dellvit delivery app with food, groceries and parcels"
              width="1536"
              height="1024"
              fetchPriority="high"
            />
          </div>
        </div>
      </section>

      {show('trust') && (
        <section className="container trust">
          {[
            [Zap, 'Fast delivery', 'Riders close to you'],
            [ShieldCheck, 'Secure handover', 'OTP-verified delivery'],
            [Package, 'Local outlets', 'Shops you already love'],
            [Headphones, 'Real support', 'We’re here to help'],
          ].map(([Icon, title, desc]) => {
            const I = Icon as typeof Zap;
            return (
              <div key={String(title)}>
                <span>
                  <I size={20} />
                </span>
                <p>
                  <strong>{String(title)}</strong>
                  <small>{String(desc)}</small>
                </p>
              </div>
            );
          })}
        </section>
      )}

      {siteError && (
        <div className="container">
          <ErrorBox error={siteError} />
        </div>
      )}

      {show('nearby') && (
        <section className="section container">
          <SectionHead
            eyebrow="Made nearby. Loved locally."
            title="Good things near you"
            href={area && feed?.nearby.length ? '/search' : undefined}
          >
            {area && (
              <button className="area-link" onClick={() => openLocation(true)}>
                <MapPin size={14} /> {area.name}
              </button>
            )}
          </SectionHead>
          {waiting ? (
            <Skeleton count={4} />
          ) : !area ? (
            <ChooseLocation />
          ) : error ? (
            <ErrorBox error={error} retry={refresh} />
          ) : !feed?.nearby.length ? (
            <div className="location-cta">
              <span className="location-cta-icon">
                <Store size={24} />
              </span>
              <div>
                <strong>Nothing available in {area.name} yet</strong>
                <p>Try another delivery area to discover products.</p>
              </div>
              <div className="location-cta-actions">
                <button className="button" onClick={() => openLocation(true)}>
                  Change location
                </button>
              </div>
            </div>
          ) : (
            <div className="product-grid">
              {feed.nearby.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </section>
      )}

      {show('category_products') &&
        feed?.categories.map((c) => (
          <section className="section container" key={c.id}>
            <SectionHead
              eyebrow={c.description || 'Category'}
              title={c.name}
              href={'/search?category=' + encodeURIComponent(c.name)}
            />
            <div className="product-rows">
              {c.products.map((p) => (
                <ProductCard key={p.id} product={p} layout="row" />
              ))}
            </div>
          </section>
        ))}

      {show('outlets') && area && !!feed?.outlets.length && <OutletRail outlets={feed.outlets} />}

      {site?.content
        .filter((c) => c.type !== 'hero')
        .map((c) => (
          <section key={c.id} className={'container promo ' + c.type}>
            <div>
              <h2>{c.name}</h2>
              {c.description && <p>{c.description}</p>}
              {c.link && (
                <Link className="button" href={c.link}>
                  {c.button || 'Explore'} <ArrowRight size={16} />
                </Link>
              )}
            </div>
            {c.image && <img src={c.image} alt="" loading="lazy" />}
          </section>
        ))}

      {show('how') && (
        <section className="section container">
          <SectionHead eyebrow="Simple as 1-2-3" title="How Dellvit works" />
          <div className="steps">
            {[
              [MapPin, 'Set your location', 'We show outlets that deliver to you.'],
              [ShoppingBag, 'Fill your cart', 'Pay cash on delivery or online.'],
              [Truck, 'Track & receive', 'Share your code when it arrives.'],
            ].map(([Icon, title, desc], i) => {
              const I = Icon as typeof MapPin;
              return (
                <div className="step" key={String(title)}>
                  <span className="step-no">0{i + 1}</span>
                  <span className="step-icon">
                    <I size={22} />
                  </span>
                  <strong>{String(title)}</strong>
                  <small>{String(desc)}</small>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {show('ad') && ad?.active && (
        <section className="container ad">
          <div className="ad-copy">
            <span className="eyebrow light">{ad.label}</span>
            <h2>{ad.title}</h2>
            <p>{ad.description}</p>
            <Link className="button white" href={ad.link}>
              Explore now <ArrowRight size={16} />
            </Link>
          </div>
          <img src={ad.image} alt="" loading="lazy" />
        </section>
      )}

      {!area && areaStatus !== 'detecting' && areaStatus !== 'loading' && !show('nearby') && (
        <div className="container section">
          <Empty title="Select your delivery location" />
        </div>
      )}
    </div>
  );
}
