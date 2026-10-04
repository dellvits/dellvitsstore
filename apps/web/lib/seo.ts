/** Server-side reads of the API for the page <head>, sitemap.xml and robots.txt. */

// On Vercel the API is served from the site's own domain; locally it runs beside Next.js.
export const apiBase = () =>
  process.env.VERCEL
    ? process.env.WEB_ORIGIN?.split(',')[0].trim().replace(/\/+$/, '') ||
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';

/** A public API read, cached for a minute so saved changes and new products show up shortly. */
export async function serverApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}/api${path}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export type SitemapData = {
  indexing: boolean;
  enabled: boolean;
  site_url: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  pages: boolean;
  images: boolean;
  outlets: { id: string; image: string }[];
  products: { id: string; images: string[] }[];
  categories: string[];
};

export const sitemapData = () => serverApi<SitemapData>('/site/sitemap');

/** The public address used in sitemap links: Store settings first, then the deployment's own. */
export const siteUrl = (d?: Pick<SitemapData, 'site_url'> | null) =>
  (
    d?.site_url ||
    process.env.WEB_ORIGIN?.split(',')[0].trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000')
  ).replace(/\/+$/, '');

/** During `next build` the API may be unreachable; anywhere else a failed read keeps the last good file. */
export const building = () => process.env.NEXT_PHASE === 'phase-production-build';
