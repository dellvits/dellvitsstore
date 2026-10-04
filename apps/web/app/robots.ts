import type { MetadataRoute } from 'next';
import { building, sitemapData, siteUrl } from '@/lib/seo';

// Pages that are personal or only for staff. /api stays open: search engines need it to render
// product and outlet pages.
const privatePages = [
  '/admin',
  '/portal',
  '/account',
  '/cart',
  '/checkout',
  '/orders',
  '/notifications',
  '/support',
  '/verify',
  '/forgot-password',
];

/** robots.txt, following Store settings → Sitemap. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const d = await sitemapData();
  if (!d && !building()) throw new Error('The robots.txt settings could not be loaded.');
  if (d && !d.indexing) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: privatePages },
    ...(d?.enabled ? { sitemap: siteUrl(d) + '/sitemap.xml' } : {}),
  };
}
