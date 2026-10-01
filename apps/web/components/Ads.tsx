'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import { forArea, type Placement } from './ContentBlocks';

export type AdFormat = 'banner' | 'cover' | 'strip' | 'card' | 'image';
export type AdPlacement = Placement | 'search' | 'search_inline' | 'outlets' | 'outlet' | 'product';
/** One advertisement, as the storefront receives it. */
export type AdItem = {
  id: string;
  title: string;
  description: string;
  label: string;
  link: string;
  button: string;
  image: string;
  format: AdFormat;
  theme: 'light' | 'soft' | 'brand' | 'dark' | 'warm';
  placements: AdPlacement[];
  devices: 'all' | 'desktop' | 'mobile';
  /** Delivery areas the ad is shown in; empty means every area. */
  location_ids: string[];
  starts_at: string;
  ends_at: string;
  position: number;
};

export const adFormats: Record<AdFormat, { title: string; hint: string }> = {
  banner: { title: 'Banner', hint: 'Wide, with text beside a picture' },
  cover: { title: 'Cover', hint: 'Text over a full-width picture' },
  strip: { title: 'Strip', hint: 'A slim one-line bar' },
  card: { title: 'Card', hint: 'Compact; several sit side by side' },
  image: { title: 'Picture only', hint: 'Your finished artwork, clickable' },
};
/** Every place an ad can be shown, in the order customers meet them. */
export const adPlacements: Record<AdPlacement, { page: string; title: string }> = {
  top: { page: 'Home page', title: 'Below the benefits bar' },
  after_nearby: { page: 'Home page', title: 'After “Good things near you”' },
  after_categories: { page: 'Home page', title: 'After the category sections' },
  after_outlets: { page: 'Home page', title: 'After “Outlets near you”' },
  bottom: { page: 'Home page', title: 'Bottom of the page' },
  search: { page: 'Search page', title: 'Above the products' },
  search_inline: { page: 'Search page', title: 'Between the products' },
  outlets: { page: 'Outlets page', title: 'Above the outlet list' },
  outlet: { page: 'Outlet menu page', title: 'Below the outlet’s details' },
  product: { page: 'Product page', title: 'Below the product details' },
};

// Each visitor counts once per ad per browser session. Views are sent together, shortly after
// the ads come into sight.
const seen = new Set<string>();
let restored = false;
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
function send(body: { views?: string[]; click?: string }) {
  fetch('/api/ads/track', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}
function trackView(id: string) {
  if (!restored) {
    restored = true;
    try {
      for (const x of JSON.parse(sessionStorage.getItem('ad-views') || '[]')) seen.add(x);
    } catch {}
  }
  if (seen.has(id)) return;
  seen.add(id);
  try {
    sessionStorage.setItem('ad-views', JSON.stringify([...seen].slice(-200)));
  } catch {}
  queue.push(id);
  clearTimeout(timer);
  timer = setTimeout(() => {
    send({ views: queue.splice(0, 20) });
  }, 1200);
}

/**
 * One ad in its chosen design. It sizes itself to the space it is given, so the admin preview at
 * phone width looks like the ad on a phone. With `count`, views and clicks are reported.
 */
export function AdUnit({ ad, preview = false, count = false }: { ad: AdItem; preview?: boolean; count?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!count || !el || typeof IntersectionObserver === 'undefined') return;
    // Seen means at least half of the ad was on screen.
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          trackView(ad.id);
          watch.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [ad.id, count]);
  const format = ad.format || 'banner';
  const theme = format === 'cover' ? 'dark' : ad.theme || 'brand';
  const onColour = theme === 'brand' || theme === 'dark';
  const className = `adu adu-${format} theme-${theme}` + (ad.image ? ' has-image' : '');
  const style = format === 'cover' && ad.image ? { backgroundImage: `url(${ad.image})` } : undefined;
  const inner =
    format === 'image' ? (
      <>
        {ad.image ? <img className="adu-media" src={ad.image} alt={ad.title || ad.label || 'Advertisement'} loading="lazy" /> : <span className="adu-empty">Add your picture</span>}
        {ad.label && <span className="adu-label">{ad.label}</span>}
      </>
    ) : (
      <>
        {ad.image && format !== 'cover' && <img className="adu-media" src={ad.image} alt="" loading="lazy" />}
        <span className="adu-body">
          <span className="adu-copy">
            {ad.label && <span className="adu-label">{ad.label}</span>}
            <strong className="adu-title">{ad.title || 'Your headline'}</strong>
            {ad.description && format !== 'strip' && <span className="adu-text">{ad.description}</span>}
          </span>
          {ad.link && ad.button && (
            <span className={'button' + (onColour ? ' white' : '') + (format === 'banner' || format === 'cover' ? '' : ' small')}>
              {ad.button} <ArrowRight size={15} />
            </span>
          )}
        </span>
      </>
    );
  const attach = (el: HTMLElement | null) => {
    ref.current = el;
  };
  if (preview || !ad.link)
    return (
      <div ref={attach} className={className} style={style}>
        {inner}
      </div>
    );
  const click = () => count && send({ click: ad.id });
  // Another website opens in a new tab and is marked as paid placement.
  return ad.link.startsWith('/') ? (
    <Link ref={attach} href={ad.link} className={className} style={style} onClick={click}>
      {inner}
    </Link>
  ) : (
    <a ref={attach} href={ad.link} target="_blank" rel="noopener noreferrer sponsored" className={className} style={style} onClick={click}>
      {inner}
    </a>
  );
}

/** Shows one ad at a time and moves to the next every few seconds. */
function AdRotator({ ads, count }: { ads: AdItem[]; count: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (ads.length < 2 || paused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setIndex((n) => n + 1), 7000);
    return () => clearInterval(t);
  }, [ads.length, paused]);
  const current = index % ads.length;
  return (
    <div
      className="ad-rotator"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <AdUnit key={ads[current].id} ad={ads[current]} count={count} />
      {ads.length > 1 && (
        <div className="ad-dots">
          {ads.map((a, n) => (
            <button
              type="button"
              key={a.id}
              className={n === current ? 'on' : ''}
              aria-label={`Show advertisement ${n + 1} of ${ads.length}`}
              aria-current={n === current}
              onClick={() => setIndex(n)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** True on phone-sized screens; false until the page has loaded in the browser. */
function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  return mobile;
}

/**
 * The ads for one place on the storefront, for the visitor's delivery area and device. Cards sit
 * side by side; the wider designs take turns when there are several.
 */
export function AdSlot({
  placement,
  inline = false,
  className = '',
}: {
  placement: AdPlacement;
  /** Inside a page that already has its own width, such as search results. */
  inline?: boolean;
  className?: string;
}) {
  const { data: site } = useData<{ ads?: AdItem[] }>('/site');
  const { area, user } = useApp();
  const mobile = useMobile();
  const ads = (site?.ads || []).filter(
    (a) =>
      a.placements?.includes(placement) &&
      forArea(a, area?.id) &&
      (!a.devices || a.devices === 'all' || a.devices === (mobile ? 'mobile' : 'desktop')),
  );
  if (!ads.length) return null;
  // Staff looking at the storefront do not count as an audience.
  const count = !user || user.role === 'customer';
  const cards = ads.filter((a) => a.format === 'card');
  const wide = ads.filter((a) => a.format !== 'card');
  return (
    <aside className={'ad-slot' + (inline ? ' inline' : ' container') + (className ? ' ' + className : '')} aria-label="Advertisement">
      {!!wide.length && <AdRotator ads={wide} count={count} />}
      {!!cards.length && (
        <div className="ad-cards">
          {cards.slice(0, 4).map((a) => (
            <AdUnit key={a.id} ad={a} count={count} />
          ))}
        </div>
      )}
    </aside>
  );
}
