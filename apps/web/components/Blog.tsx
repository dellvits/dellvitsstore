'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Clock, Copy, Facebook, Instagram, Linkedin, MessageCircle, Send, Share2, Twitter } from 'lucide-react';
import { api } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import { ErrorBox } from './UI';

/** What visitors may know about the blog's settings (see publicBlogSettings in the API). */
export type BlogSettings = {
  enabled: boolean;
  title: string;
  description: string;
  posts_per_page: number;
  show_in_menu: boolean;
  show_on_home: boolean;
  home_count: number;
  comments_enabled: boolean;
  comments_guests: boolean;
  indexing: boolean;
  rss: boolean;
  default_image: string;
  share_buttons: boolean;
};
export type BlogSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_image: string;
  category: string;
  tags: string[];
  featured: boolean;
  author_name: string;
  published_at: string;
  updated_at: string;
  views: number;
  reading_minutes: number;
};
export type BlogComment = { id: string; name: string; body: string; created_at: string };

export const blogDate = (value: string) =>
  new Date(value).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' });

export function BlogCard({ post, image, large = false }: { post: BlogSummary; image?: string; large?: boolean }) {
  const cover = post.cover_image || image;
  return (
    <Link href={'/blog/' + post.slug} className={'blog-card' + (large ? ' large' : '')}>
      <span className="blog-cover">{cover ? <img src={cover} alt="" loading="lazy" /> : <span className="blog-cover-blank" />}</span>
      <span className="blog-card-text">
        {post.category && <span className="eyebrow">{post.category}</span>}
        <strong>{post.title}</strong>
        <small>{post.excerpt}</small>
        <span className="blog-meta">
          {blogDate(post.published_at)} · <Clock size={12} /> {post.reading_minutes} min read
        </span>
      </span>
    </Link>
  );
}

/** The latest articles on the home page. */
export function BlogSection({ blog }: { blog?: BlogSettings }) {
  const on = !!blog?.enabled && blog.show_on_home;
  const { data } = useData<{ posts: BlogSummary[] }>(on ? '/blog?limit=' + (blog?.home_count || 3) : null);
  if (!on || !data?.posts.length) return null;
  return (
    <section className="section container">
      <div className="section-head">
        <div>
          <span className="eyebrow">{blog!.title}</span>
          <h2>Fresh from the blog</h2>
        </div>
        <div className="section-tools">
          <Link href="/blog" className="button ghost small">
            All articles <ArrowRight size={15} />
          </Link>
        </div>
      </div>
      <div className="blog-grid">
        {data.posts.map((p) => (
          <BlogCard key={p.id} post={p} image={blog!.default_image} />
        ))}
      </div>
    </section>
  );
}

/**
 * Sharing buttons. Facebook, WhatsApp, X and LinkedIn open their share pages. Instagram has no
 * share page on the web: the phone's share sheet is used where there is one, otherwise the link
 * is copied to paste into a post or story.
 */
export function BlogShare({ title, path }: { title: string; path: string }) {
  const { notice } = useApp();
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(location.origin + path), [path]);
  const enc = encodeURIComponent;
  const open = (href: string) => window.open(href, '_blank', 'noopener,noreferrer,width=640,height=560');
  async function copy(message = 'Link copied.') {
    try {
      await navigator.clipboard.writeText(url);
      notice(message);
    } catch {
      notice(url);
    }
  }
  async function native() {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return;
      }
    }
    copy('Link copied. Paste it into your Instagram post or story.');
  }
  return (
    <div className="blog-share" aria-label="Share this article">
      <span className="muted small">
        <Share2 size={14} /> Share
      </span>
      <button type="button" className="share-btn facebook" onClick={() => open('https://www.facebook.com/sharer/sharer.php?u=' + enc(url))} aria-label="Share on Facebook">
        <Facebook size={16} />
      </button>
      <button type="button" className="share-btn instagram" onClick={native} aria-label="Share on Instagram">
        <Instagram size={16} />
      </button>
      <button type="button" className="share-btn whatsapp" onClick={() => open('https://wa.me/?text=' + enc(title + ' ' + url))} aria-label="Share on WhatsApp">
        <MessageCircle size={16} />
      </button>
      <button type="button" className="share-btn" onClick={() => open('https://twitter.com/intent/tweet?text=' + enc(title) + '&url=' + enc(url))} aria-label="Share on X">
        <Twitter size={16} />
      </button>
      <button type="button" className="share-btn" onClick={() => open('https://www.linkedin.com/sharing/share-offsite/?url=' + enc(url))} aria-label="Share on LinkedIn">
        <Linkedin size={16} />
      </button>
      <button type="button" className="share-btn" onClick={() => copy()} aria-label="Copy link">
        <Copy size={16} />
      </button>
    </div>
  );
}

/** Counts one read per visit to an article. */
export function BlogViewCounter({ slug }: { slug: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api('/blog/' + encodeURIComponent(slug) + '/view', { method: 'POST' }).catch(() => {});
  }, [slug]);
  return null;
}

export function BlogComments({
  slug,
  initial,
  open,
  guests,
}: {
  slug: string;
  initial: BlogComment[];
  open: boolean;
  guests: boolean;
}) {
  const { user } = useApp();
  const [comments, setComments] = useState(initial);
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string; status: string }>('/blog/' + encodeURIComponent(slug) + '/comments', {
        method: 'POST',
        body: JSON.stringify({ body, name }),
      });
      if (r.status === 'approved')
        setComments((c) => [...c, { id: r.id, name: user?.name || name, body, created_at: new Date().toISOString() }]);
      setSent(r.status === 'approved' ? 'Thank you, your comment is published.' : 'Thank you. Your comment will appear once it is approved.');
      setBody('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!open && !comments.length) return null;
  return (
    <section className="blog-comments" id="comments">
      <h2>
        {comments.length} comment{comments.length === 1 ? '' : 's'}
      </h2>
      {comments.map((c) => (
        <article className="blog-comment" key={c.id}>
          <span className="avatar">{c.name.slice(0, 1)}</span>
          <div>
            <strong>{c.name}</strong> <small className="muted">{blogDate(c.created_at)}</small>
            <p>{c.body}</p>
          </div>
        </article>
      ))}
      {open &&
        (!user && !guests ? (
          <p className="muted">
            <Link href={'/login?next=' + encodeURIComponent('/blog/' + slug)}>Sign in</Link> to leave a comment.
          </p>
        ) : (
          <form className="stack" onSubmit={submit}>
            <h3>Leave a comment</h3>
            {!user && (
              <label>
                Your name
                <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label>
              Comment
              <textarea required minLength={2} maxLength={2000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            {error && <ErrorBox error={error} />}
            {sent && <div className="alert success">{sent}</div>}
            <div>
              <button className="button" disabled={busy}>
                <Send size={15} /> {busy ? 'Sending…' : 'Post comment'}
              </button>
            </div>
          </form>
        ))}
    </section>
  );
}
