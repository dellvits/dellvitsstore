import type { Metadata } from 'next';
import { createElement, Fragment, type ReactNode } from 'react';

/** Search engine verification and analytics saved in Store settings. */
export type HeadSettings = {
  google_site_verification: string;
  bing_site_verification: string;
  google_analytics_id: string;
  google_tag_manager_id: string;
  facebook_pixel_id: string;
  custom_head_code: string;
};

// On Vercel the API is served from the site's own domain; locally it runs beside Next.js.
const apiBase = () =>
  process.env.VERCEL
    ? process.env.WEB_ORIGIN?.split(',')[0].trim().replace(/\/+$/, '') ||
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';

/** Read on the server and cached for a minute, so saved changes reach every page shortly after. */
export async function headSettings(): Promise<Partial<HeadSettings>> {
  try {
    const res = await fetch(`${apiBase()}/api/site/head`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? await res.json() : {};
  } catch {
    // Without the API (for example during a local build) the pages render without these tags.
    return {};
  }
}

// The API validates these too; checking again keeps anything else out of the inline scripts.
const valid = {
  ga: /^(?:G|AW|DC)-[A-Z0-9]{4,20}$/,
  gtm: /^GTM-[A-Z0-9]{4,12}$/,
  pixel: /^\d{6,20}$/,
};

export function headMetadata(s: Partial<HeadSettings>): Metadata {
  const other: Record<string, string> = {};
  if (s.bing_site_verification) other['msvalidate.01'] = s.bing_site_verification;
  return s.google_site_verification || s.bing_site_verification
    ? { verification: { google: s.google_site_verification || undefined, other } }
    : {};
}

export function AnalyticsTags({ s }: { s: Partial<HeadSettings> }) {
  const ga = valid.ga.test(s.google_analytics_id || '') ? s.google_analytics_id : '';
  const gtm = valid.gtm.test(s.google_tag_manager_id || '') ? s.google_tag_manager_id : '';
  const pixel = valid.pixel.test(s.facebook_pixel_id || '') ? s.facebook_pixel_id : '';
  return (
    <>
      {gtm && (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`,
          }}
        />
      )}
      {ga && (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} />
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');`,
            }}
          />
        </>
      )}
      {pixel && (
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixel}');fbq('track','PageView');`,
          }}
        />
      )}
      <CustomHeadCode code={s.custom_head_code || ''} />
    </>
  );
}

/* ---------- Custom head code ---------- */

// React cannot insert raw HTML into <head>, so the pasted code is turned into elements. Only tags
// that belong in <head> are kept; anything else is skipped.
const tagPattern = /<(meta|link|script|style|noscript)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>(?:([\s\S]*?)<\/\1\s*>)?/gi;
const attrPattern = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const propNames: Record<string, string> = {
  charset: 'charSet',
  'http-equiv': 'httpEquiv',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  nomodule: 'noModule',
  class: 'className',
  fetchpriority: 'fetchPriority',
  hreflang: 'hrefLang',
};
const booleanAttrs = new Set(['async', 'defer', 'nomodule']);
const decode = (v: string) =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function attributes(source: string) {
  const props: Record<string, string | boolean> = {};
  for (const [, raw, d, s, u] of source.matchAll(attrPattern)) {
    const name = raw.toLowerCase();
    // Event handler attributes cannot be rendered by React.
    if (name.startsWith('on')) continue;
    const value = d ?? s ?? u;
    props[propNames[name] || name] = value === undefined ? booleanAttrs.has(name) || '' : decode(value);
  }
  return props;
}

function CustomHeadCode({ code }: { code: string }) {
  const html = code.replace(/<!--[\s\S]*?-->/g, '');
  const elements: ReactNode[] = [];
  let i = 0;
  for (const [, tag, attrs, inner] of html.matchAll(tagPattern)) {
    const name = tag.toLowerCase();
    const props = { key: i++, ...attributes(attrs) };
    elements.push(
      name === 'meta' || name === 'link'
        ? createElement(name, props)
        : createElement(name, { ...props, dangerouslySetInnerHTML: { __html: inner || '' } }),
    );
  }
  return createElement(Fragment, null, ...elements);
}
