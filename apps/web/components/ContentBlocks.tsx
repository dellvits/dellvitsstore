'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Megaphone, Zap } from 'lucide-react';

/** One piece of home page content that an administrator manages. */
export type ContentItem = {
  id: string;
  name: string;
  type: 'hero' | 'section' | 'banner' | 'announcement' | 'embed';
  description: string;
  image: string;
  link: string;
  button: string;
  eyebrow?: string;
  layout?: 'image-right' | 'image-left' | 'image-background' | 'centered';
  theme?: 'light' | 'soft' | 'brand' | 'dark' | 'warm';
  placement?: Placement;
  devices?: 'all' | 'desktop' | 'mobile';
  /** Delivery areas the block is shown in; empty means every area. */
  location_ids?: string[];
  starts_at?: string;
  ends_at?: string;
  embed_url?: string;
  active?: boolean;
  position?: number;
};
export type Placement = 'top' | 'after_nearby' | 'after_categories' | 'after_outlets' | 'bottom';

export const contentTypes: Record<ContentItem['type'], { title: string; hint: string }> = {
  hero: { title: 'Hero', hint: 'The main headline at the top of the page' },
  section: { title: 'Promo section', hint: 'Text beside or over a picture' },
  banner: { title: 'Banner', hint: 'A slim strip with one message and a button' },
  announcement: { title: 'Announcement', hint: 'A thin bar above everything else' },
  embed: { title: 'Video', hint: 'A YouTube or Vimeo video with text' },
};
export const layouts: Record<NonNullable<ContentItem['layout']>, string> = {
  'image-right': 'Picture right',
  'image-left': 'Picture left',
  'image-background': 'Picture behind text',
  centered: 'Centred text',
};
export const themes: Record<NonNullable<ContentItem['theme']>, string> = {
  light: 'Light',
  soft: 'Soft',
  warm: 'Warm',
  brand: 'Brand',
  dark: 'Dark',
};
/** The slots a block can sit in, in the order they come down the home page. */
export const placements: Record<Placement, string> = {
  top: 'Below the benefits bar',
  after_nearby: 'After “Good things near you”',
  after_categories: 'After the category sections',
  after_outlets: 'After “Outlets near you”',
  bottom: 'After “How it works”',
};
export const deviceLabels: Record<NonNullable<ContentItem['devices']>, string> = {
  all: 'All devices',
  desktop: 'Desktop only',
  mobile: 'Mobile only',
};

/** Whether a block or an ad is meant for the visitor's delivery area. */
export const forArea = (c: { location_ids?: string[] }, areaId?: string) =>
  !c.location_ids?.length || (!!areaId && c.location_ids.includes(areaId));

/** Turns a YouTube or Vimeo page address into the address of its player; empty when it is neither. */
export function embedSource(url = '') {
  const youtube = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (youtube) return 'https://www.youtube-nocookie.com/embed/' + youtube[1];
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return vimeo ? 'https://player.vimeo.com/video/' + vimeo[1] : '';
}

/** The block's call to action. In the admin preview it looks the same but goes nowhere. */
function Action({ item: c, preview, className }: { item: ContentItem; preview?: boolean; className: string }) {
  if (!c.link) return null;
  const inner = (
    <>
      {c.button || 'Explore'} <ArrowRight size={16} />
    </>
  );
  return preview ? (
    <span className={className}>{inner}</span>
  ) : (
    <Link className={className} href={c.link}>
      {inner}
    </Link>
  );
}

/**
 * Renders a home page block. It sizes itself to the space it is given, not to the screen, so the
 * admin preview at phone width looks exactly like the page on a phone.
 */
export function ContentBlock({ item: c, preview = false }: { item: ContentItem; preview?: boolean }) {
  const theme = c.theme || 'light';
  const onColour = theme === 'brand' || theme === 'dark';
  const outer =
    'cb-slot' + (preview ? ' preview' : ' container') + (c.devices && c.devices !== 'all' ? ' only-' + c.devices : '');
  if (c.type === 'announcement')
    return (
      <div className={outer}>
        <div className={'cb-announce theme-' + theme}>
          <Megaphone size={16} />
          <p>
            <strong>{c.name}</strong>
            {c.description && <span>{c.description}</span>}
          </p>
          <Action item={c} preview={preview} className="cb-announce-link" />
        </div>
      </div>
    );
  const button = 'button' + (onColour ? ' white' : '');
  const copy = (extra?: ReactNode) => (
    <div className="cb-copy">
      {c.eyebrow && <span className={'eyebrow' + (onColour ? ' light' : '')}>{c.eyebrow}</span>}
      <h2>{c.name || 'Your headline'}</h2>
      {c.description && <p>{c.description}</p>}
      {extra}
    </div>
  );
  if (c.type === 'banner')
    return (
      <div className={outer}>
        <section className={'cb cb-banner theme-' + theme}>
          {c.image && <img src={c.image} alt="" loading="lazy" />}
          {copy()}
          <Action item={c} preview={preview} className={button} />
        </section>
      </div>
    );
  const layout = c.layout || 'image-right';
  const video = c.type === 'embed' ? embedSource(c.embed_url) : '';
  // A video cannot sit behind text or be dropped, so those two layouts fall back to the side.
  const side = c.type === 'embed' && (layout === 'image-background' || layout === 'centered') ? 'image-right' : layout;
  const behind = side === 'image-background' && !!c.image;
  return (
    <div className={outer}>
      <section
        className={'cb cb-section layout-' + side + ' theme-' + (behind ? 'dark' : theme) + (behind ? ' has-backdrop' : '')}
        style={behind ? { backgroundImage: `url(${c.image})` } : undefined}
      >
        {copy(<Action item={c} preview={preview} className={behind ? 'button white' : button} />)}
        {c.type === 'embed' ? (
          <div className="cb-media cb-video">
            {video ? (
              <iframe
                src={video}
                title={c.name}
                loading="lazy"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <span>Paste a YouTube or Vimeo link</span>
            )}
          </div>
        ) : (
          side !== 'centered' && !behind && c.image && <img className="cb-media" src={c.image} alt="" loading="lazy" />
        )}
      </section>
    </div>
  );
}

/** A small stand-in for the top of the home page, for previewing a hero while it is edited. */
export function HeroPreview({ item: c }: { item: ContentItem }) {
  return (
    <div className="cb-slot preview">
      <div className="cb-hero">
        <div className="cb-copy">
          <span className="hero-tag">
            <Zap size={14} /> {c.eyebrow || 'Fast local delivery'}
          </span>
          <h2>{c.name || 'Your headline'}</h2>
          <p>{c.description || 'Meals, groceries and essentials from outlets near you.'}</p>
          <span className="button">
            {c.button || 'Start shopping'} <ArrowRight size={16} />
          </span>
        </div>
        <img src={c.image || '/images/hero-phone.webp'} alt="" />
      </div>
    </div>
  );
}
