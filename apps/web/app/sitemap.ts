import type { MetadataRoute } from 'next';
import { building, sitemapData, siteUrl } from '@/lib/seo';

/**
 * sitemap.xml, built from the live store: new outlets and products appear within a minute, and
 * hidden or deleted ones drop out. What it lists is chosen in Store settings → Sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const d = await sitemapData();
  if (!d) {
    // Throwing keeps the previously generated file; a build without the API lists the home page.
    if (!building()) throw new Error('The sitemap data could not be loaded.');
    return [{ url: siteUrl() + '/' }];
  }
  if (!d.enabled) return [];
  const base = siteUrl(d);
  const absolute = (p: string) => (/^https?:\/\//.test(p) ? p : base + (p.startsWith('/') ? p : '/' + p));
  const entry = (path: string, priority: number, images: string[] = []) => ({
    url: base + path,
    changeFrequency: d.frequency,
    priority,
    ...(d.images && images.length ? { images: images.filter(Boolean).map(absolute) } : {}),
  });
  return [
    entry('/', 1),
    ...(d.pages
      ? [entry('/search', 0.8), entry('/outlets', 0.8), entry('/about', 0.4), entry('/contact', 0.4)]
      : []),
    ...d.categories.map((c) => entry('/search?category=' + encodeURIComponent(c), 0.6)),
    ...d.outlets.map((o) => entry('/outlets/' + o.id, 0.7, [o.image])),
    ...d.products.map((p) => entry('/products/' + p.id, 0.6, p.images)),
  ];
}
