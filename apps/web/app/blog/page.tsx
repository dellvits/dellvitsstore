import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Rss, Search } from 'lucide-react';
import { serverApi } from '@/lib/seo';
import { BlogCard, type BlogSettings, type BlogSummary } from '@/components/Blog';

type List = {
  posts: BlogSummary[];
  total: number;
  page: number;
  pages: number;
  categories: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  settings: BlogSettings;
};
type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

/** The blog's list page, read on the server so search engines see every article link. */
async function load(searchParams: Params['searchParams']) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ['page', 'q', 'category', 'tag']) if (one(sp[k])) q.set(k, one(sp[k]));
  return { list: await serverApi<List>('/blog?' + q), filters: Object.fromEntries(q) as Record<string, string> };
}

export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  const { list, filters } = await load(searchParams);
  const s = list?.settings;
  const filtered = Object.keys(filters).some((k) => k !== 'page');
  return {
    title: s?.title || 'Blog',
    description: s?.description,
    alternates: {
      canonical: '/blog',
      ...(s?.rss ? { types: { 'application/rss+xml': '/api/blog/rss.xml' } } : {}),
    },
    // Search and filter results are not separate pages for search engines.
    ...(!s?.indexing || filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BlogIndex({ searchParams }: Params) {
  const { list, filters } = await load(searchParams);
  if (!list || !list.settings.enabled) notFound();
  const link = (change: Record<string, string>) => {
    const q = new URLSearchParams({ ...filters, ...change });
    for (const [k, v] of [...q.entries()]) if (!v || (k === 'page' && v === '1')) q.delete(k);
    return '/blog' + (q.size ? '?' + q : '');
  };
  const [first, ...rest] = list.posts;
  const lead = list.page === 1 && !filters.q && first;
  return (
    <div className="container page blog-page">
      <header className="blog-hero">
        <span className="eyebrow">Dellvit</span>
        <h1>{list.settings.title}</h1>
        {list.settings.description && <p>{list.settings.description}</p>}
        <form action="/blog" className="blog-search">
          <Search size={16} />
          <input name="q" defaultValue={filters.q} placeholder="Search articles" aria-label="Search articles" />
          {filters.category && <input type="hidden" name="category" value={filters.category} />}
        </form>
      </header>
      {!!list.categories.length && (
        <nav className="blog-cats" aria-label="Categories">
          <Link href={link({ category: '', page: '' })} className={!filters.category ? 'active' : ''}>
            All
          </Link>
          {list.categories.map((c) => (
            <Link key={c.name} href={link({ category: c.name, page: '' })} className={filters.category === c.name ? 'active' : ''}>
              {c.name} <small>{c.count}</small>
            </Link>
          ))}
        </nav>
      )}
      {(filters.tag || filters.q) && (
        <p className="muted">
          {list.total} article{list.total === 1 ? '' : 's'}
          {filters.q && <> for “{filters.q}”</>}
          {filters.tag && <> tagged #{filters.tag}</>} · <Link href="/blog">Show all</Link>
        </p>
      )}
      {!list.posts.length ? (
        <div className="empty-state">
          <h3>No articles yet</h3>
          <p className="muted">Check back soon.</p>
        </div>
      ) : (
        <>
          {lead && <BlogCard post={first} image={list.settings.default_image} large />}
          <div className="blog-grid">
            {(lead ? rest : list.posts).map((p) => (
              <BlogCard key={p.id} post={p} image={list.settings.default_image} />
            ))}
          </div>
        </>
      )}
      {list.pages > 1 && (
        <nav className="blog-pages" aria-label="Pages">
          {list.page > 1 && <Link href={link({ page: String(list.page - 1) })}>← Newer</Link>}
          <span>
            Page {list.page} of {list.pages}
          </span>
          {list.page < list.pages && <Link href={link({ page: String(list.page + 1) })}>Older →</Link>}
        </nav>
      )}
      {!!list.tags.length && (
        <div className="blog-tags">
          {list.tags.map((t) => (
            <Link key={t.name} href={link({ tag: t.name, page: '' })} className="chip small">
              #{t.name}
            </Link>
          ))}
        </div>
      )}
      {list.settings.rss && (
        <a className="blog-rss muted small" href="/api/blog/rss.xml">
          <Rss size={13} /> RSS feed
        </a>
      )}
    </div>
  );
}
