'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  MapPin,
  Zap,
  ShieldCheck,
  Package,
  Headphones,
  ShoppingBag,
  Truck,
  Tag,
  Navigation,
  Wallet,
  Heart,
} from 'lucide-react';
import { useApp } from './Provider';
import { api } from '@/lib/api';
import type { Product, Ad } from '@/lib/types';
import { ProductCard, ErrorBox } from './UI';
const categories = [
  {
    name: 'Food delivery',
    category: 'Food',
    text: 'Your cravings. Your favourite local kitchens.',
    img: 'food',
    color: 'rose',
  },
  {
    name: 'Groceries',
    category: 'Groceries',
    text: 'Fresh picks and pantry staples, sorted.',
    img: 'groceries',
    color: 'green',
  },
  {
    name: 'Parcels',
    category: 'Parcels',
    text: 'Send a little something across town.',
    img: 'parcel',
    color: 'orange',
  },
  {
    name: 'More services',
    category: 'More',
    text: 'The essentials that keep your day going.',
    img: 'essentials',
    color: 'purple',
  },
];
export default function Home() {
  const { area, locations, setArea, openLocation } = useApp();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [ad, setAd] = useState<Ad | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Ad>('/ad')
      .then(setAd)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!area) return;
    let alive = true;
    api<Product[]>('/products?location=' + area.id)
      .then((p) => {
        if (alive) {
          setProducts(p);
          setError('');
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [area]);
  return (
    <div className="home">
      <section className="hero container">
        <div className="hero-copy">
          <div className="eyebrow hero-kicker">
            <span />A little local. A lot to love.
          </div>
          <h1>
            Food, groceries
            <br />
            and more,
            <br />
            <span>delivered to you.</span>
          </h1>
          <p>
            From your favourite meals to everyday essentials
            <br className="desktop-break" /> and beyond — we deliver goodness, faster.
          </p>
          <form
            className="location-search"
            onSubmit={(e) => {
              e.preventDefault();
              router.push('/search');
            }}
          >
            <MapPin size={22} />
            <select
              aria-label="Your delivery location"
              value={area?.id || ''}
              onChange={(e) => {
                const a = locations.find((l) => l.id === e.target.value);
                if (a) setArea(a);
              }}
            >
              <option value="" disabled>
                Enter your delivery location
              </option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button type="submit" className="button">
              Find nearby <ArrowRight size={17} />
            </button>
          </form>
          <div className="popular-chips">
            <span>In the mood for</span>
            {categories.slice(0, 3).map((c) => (
              <Link key={c.category} href={'/search?category=' + c.category}>
                <img src={'/images/' + c.img + '.webp'} alt="" width="27" height="27" />
                {c.category}
              </Link>
            ))}
          </div>
        </div>
        <div className="hero-visual">
          <img
            className="hero-art"
            src="/images/hero-phone.webp"
            alt="Dellvit delivery app concept surrounded by food, fresh groceries and a parcel"
            width="1536"
            height="1024"
            fetchPriority="high"
          />
          <div className="delivery-note">
            <span>
              <ShieldCheck size={22} />
            </span>
            <div>
              <strong>A good day, delivered.</strong>
              <small>From your neighbourhood to your door</small>
            </div>
          </div>
        </div>
      </section>
      <section className="trust-bar container" aria-label="Dellvit service benefits">
        {[
          [Zap, 'Fast delivery', 'Less waiting. More living.'],
          [ShieldCheck, 'Safe & reliable', 'Care in every delivery.'],
          [Package, 'Local coverage', 'Your neighbourhood, connected.'],
          [Headphones, 'Here to help', 'Support when you need it.'],
        ].map(([Icon, title, desc]) => {
          const I = Icon as typeof Zap;
          return (
            <div key={String(title)}>
              <I size={30} />
              <span>
                <strong>{String(title)}</strong>
                <small>{String(desc)}</small>
              </span>
            </div>
          );
        })}
      </section>
      <section className="section container">
        <div className="section-head">
          <h2>
            More than food.
            <br />
            We deliver <em>it all.</em>
          </h2>
          <span className="section-note">What can we bring you today?</span>
        </div>
        <div className="category-grid">
          {categories.map((c) => (
            <Link
              className={'category-card ' + c.color}
              href={'/search?category=' + c.category}
              key={c.name}
            >
              <img
                src={'/images/' + c.img + '.webp'}
                alt={c.name}
                width="400"
                height="300"
                loading="lazy"
              />
              <div>
                <h3>{c.name}</h3>
                <p>{c.text}</p>
                <span className="category-arrow">
                  <ArrowUpRight size={20} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <section className="section container nearby-section">
        <div className="section-head">
          <div>
            <div className="eyebrow accent">Made nearby. Loved locally.</div>
            <h2>Good things near you.</h2>
            <button className="area-inline" onClick={() => openLocation(true)}>
              <MapPin size={15} />
              {area?.name || 'Choose an area'}
            </button>
          </div>
          <Link href="/search" className="text-button">
            Explore all <ArrowRight size={18} />
          </Link>
        </div>
        {error ? (
          <ErrorBox error={error} />
        ) : products.length ? (
          <div className="product-grid">
            {products.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="muted">Choose your delivery area to discover local favourites.</p>
        )}
      </section>
      <section className="how-section container">
        <h2>
          How <span className="accent">Dellvit</span> works
        </h2>
        <div className="how-grid">
          {[
            [MapPin, '01', 'Choose', 'Set your location and find something you love.'],
            [ShoppingBag, '02', 'Order', 'Add to your basket and tell us where to go.'],
            [Truck, '03', 'Delivered', 'We bring it to your door. You enjoy your day.'],
          ].map(([Icon, n, title, desc]) => {
            const I = Icon as typeof MapPin;
            return (
              <div key={String(n)}>
                <span className="how-icon">
                  <I size={30} />
                </span>
                <div>
                  <small>STEP {String(n)}</small>
                  <h3>{String(title)}</h3>
                  <p>{String(desc)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {ad?.active && (
        <section className="ad-banner container">
          <div className="ad-copy">
            <span className="eyebrow">{ad.label} · ADVERTISEMENT</span>
            <h2>{ad.title}</h2>
            <p>{ad.description}</p>
            <Link className="button white" href={ad.link}>
              Explore now <ArrowRight size={18} />
            </Link>
          </div>
          <img
            src={ad.image}
            alt="Dellvit rider bringing an order to your neighbourhood"
            width="600"
            height="400"
            loading="lazy"
          />
          <div className="ad-side">
            <img src="/images/app-logo.webp" alt="Dellvit app logo" width="100" height="100" />
            <h3>
              A little more local.
              <br />A little more Dellvit.
            </h3>
            <Link href="/contact">
              Advertise with us <ArrowUpRight size={17} />
            </Link>
          </div>
        </section>
      )}
      <section className="why-section container">
        <h2>
          Everyday reasons to choose <span className="accent">Dellvit.</span>
        </h2>
        <div>
          {[
            [Tag, 'Local deals'],
            [Navigation, 'Order updates'],
            [Wallet, 'Cash on delivery'],
            [ShieldCheck, 'Delivery verification'],
            [Heart, 'Neighbourhood favourites'],
          ].map(([Icon, title]) => {
            const I = Icon as typeof Tag;
            return (
              <span key={String(title)}>
                <I size={23} />
                {String(title)}
              </span>
            );
          })}
        </div>
      </section>
    </div>
  );
}
