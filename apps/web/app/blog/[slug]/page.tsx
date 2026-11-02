import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock, Eye } from 'lucide-react';
import { serverApi, siteUrl } from '@/lib/seo';
import {
  BlogCard,
  BlogComments,
  BlogShare,
  BlogViewCounter,
  blogDate,
  type BlogComment,
  type BlogSettings,
  type BlogSummary,
} from '@/components/Blog';

type Post = BlogSummary & {
  content: string;
  seo: {
    meta_title?: string;
    meta_description?: string;
    keywords?: string;
    canonical?: string;
    og_image?: string;
    noindex?: boolean;
    nofollow?: boolean;
  };
  comments_open: boolean;
  comments: BlogComment[];
  related: BlogSummary[];
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  settings: BlogSettings;
};
type Params = { params: Promise<{ slug: string }> };
const load = async (params: Params['params']) =>
  serverApi<Post>('/blog/' + encodeURIComponent((await params).slug));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await load(params);
  if (!p) return { title: 'Article not found' };
  const image = p.seo.og_image || p.cover_image || p.settings.default_image;
  const description = p.seo.meta_description || p.excerpt;
  return {
    title: p.seo.meta_title || p.title,
    description,
    keywords: p.seo.keywords || undefined,
    authors: p.author_name ? [{ name: p.author_name }] : undefined,
    alternates: { canonical: p.seo.canonical || '/blog/' + p.slug },
    robots: { index: !p.seo.noindex, follow: !p.seo.nofollow },
    openGraph: {
      type: 'article',
      title: p.seo.meta_title || p.title,
      description,
      url: '/blog/' + p.slug,
      publishedTime: p.published_at,
      modifiedTime: p.updated_at,
      authors: p.author_name ? [p.author_name] : undefined,
      tags: p.tags,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: p.title, description },
  };
}

export default async function BlogPost({ params }: Params) {
  const p = await load(params);
  if (!p) notFound();
  const base = siteUrl();
  const image = p.cover_image || p.settings.default_image;
  // Structured data so search engines show the article with its date, author and picture.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: p.seo.meta_description || p.excerpt,
    datePublished: p.published_at,
    dateModified: p.updated_at,
    author: { '@type': 'Person', name: p.author_name || 'Dellvit' },
    publisher: { '@type': 'Organization', name: 'Dellvit', logo: { '@type': 'ImageObject', url: base + '/images/logo.webp' } },
    mainEntityOfPage: base + '/blog/' + p.slug,
    ...(image ? { image: /^https?:/.test(image) ? image : base + image } : {}),
    keywords: p.tags.join(', '),
  };
  return (
    <div className="container page blog-post-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <BlogViewCounter slug={p.slug} />
      <Link href="/blog" className="back-link">
        <ArrowLeft size={16} /> {p.settings.title}
      </Link>
      <article className="blog-article">
        <header>
          {p.category && (
            <Link href={'/blog?category=' + encodeURIComponent(p.category)} className="eyebrow">
              {p.category}
            </Link>
          )}
          <h1>{p.title}</h1>
          {p.excerpt && <p className="blog-lead">{p.excerpt}</p>}
          <div className="blog-meta">
            {p.author_name && <strong>{p.author_name}</strong>}
            <span>{blogDate(p.published_at)}</span>
            <span>
              <Clock size={13} /> {p.reading_minutes} min read
            </span>
            <span>
              <Eye size={13} /> {p.views.toLocaleString('en-PK')}
            </span>
          </div>
        </header>
        {image && <img className="blog-article-cover" src={image} alt="" />}
        {/* Cleaned by the API when it was saved: only safe formatting, pictures, videos and links remain. */}
        <div className="blog-content" dangerouslySetInnerHTML={{ __html: p.content }} />
        {!!p.tags.length && (
          <div className="blog-tags">
            {p.tags.map((t) => (
              <Link key={t} href={'/blog?tag=' + encodeURIComponent(t)} className="chip small">
                #{t}
              </Link>
            ))}
          </div>
        )}
        {p.settings.share_buttons && <BlogShare title={p.title} path={'/blog/' + p.slug} />}
        {(p.previous || p.next) && (
          <nav className="blog-prev-next" aria-label="More articles">
            {p.previous ? (
              <Link href={'/blog/' + p.previous.slug}>
                <small>Previous</small>
                {p.previous.title}
              </Link>
            ) : (
              <span />
            )}
            {p.next && (
              <Link href={'/blog/' + p.next.slug} className="next">
                <small>Next</small>
                {p.next.title}
              </Link>
            )}
          </nav>
        )}
        <BlogComments slug={p.slug} initial={p.comments} open={p.comments_open} guests={p.settings.comments_guests} />
      </article>
      {!!p.related.length && (
        <section className="section">
          <h2>Keep reading</h2>
          <div className="blog-grid">
            {p.related.map((r) => (
              <BlogCard key={r.id} post={r} image={p.settings.default_image} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
