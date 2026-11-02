import type { Express, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';
import { z } from 'zod';
import { atomicRoute } from './atomic-route.js';
import { all, afterCommit, one, run, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { adminsWith, notify } from './notifications.js';
import { objects } from './storage.js';

/**
 * The blog: articles written in the admin panel's editor with pictures, videos and links,
 * shown on the website and in the app. Settings cover comments, search engines, the sitemap,
 * the RSS feed and posting to a Facebook Page and an Instagram business account.
 */

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const now = () => new Date().toISOString();

const settingsSchema = z.object({
  enabled: z.boolean().default(true),
  title: z.string().trim().max(80).default('Dellvit Blog'),
  description: z.string().trim().max(300).default('News, guides and offers from Dellvit.'),
  posts_per_page: z.number().int().min(3).max(48).default(9),
  // Shown in the website menu and the app, and as a section on the home page.
  show_in_menu: z.boolean().default(true),
  show_on_home: z.boolean().default(true),
  home_count: z.number().int().min(1).max(12).default(3),
  // Comments: on or off everywhere, held for approval, and whether visitors who are not signed in may write.
  comments_enabled: z.boolean().default(true),
  comments_moderation: z.boolean().default(true),
  comments_guests: z.boolean().default(false),
  // Search engines.
  indexing: z.boolean().default(true),
  sitemap: z.boolean().default(true),
  rss: z.boolean().default(true),
  default_image: z
    .string()
    .max(500)
    .refine((v) => !v || /^\/(images|api\/media)\/[\w.-]+\.(webp|png|jpg|jpeg)$/.test(v))
    .default(''),
  share_buttons: z.boolean().default(true),
  // Posting to social media through Meta's Graph API.
  facebook_page_id: z.string().trim().max(40).regex(/^\d*$/, 'The Page ID is a number.').default(''),
  instagram_account_id: z
    .string()
    .trim()
    .max(40)
    .regex(/^\d*$/, 'The Instagram account ID is a number.')
    .default(''),
  // A long-lived Page access token. Never sent back to the browser.
  facebook_token: z.string().trim().max(600).default(''),
  // Posts new articles to the connected accounts the first time they are published.
  auto_share: z.boolean().default(false),
});
type Settings = z.infer<typeof settingsSchema>;

export async function blogSettings(): Promise<Settings> {
  const row = await one("SELECT data FROM platform_records WHERE kind='blog' AND id='settings'");
  return settingsSchema.parse(row ? JSON.parse(row.data) : {});
}
/** What visitors may know about the blog's settings. */
export async function publicBlogSettings() {
  const s = await blogSettings();
  return {
    enabled: s.enabled,
    title: s.title,
    description: s.description,
    posts_per_page: s.posts_per_page,
    show_in_menu: s.show_in_menu,
    show_on_home: s.show_on_home,
    home_count: s.home_count,
    comments_enabled: s.comments_enabled,
    comments_guests: s.comments_guests,
    indexing: s.indexing,
    rss: s.rss,
    default_image: s.default_image,
    share_buttons: s.share_buttons,
  };
}

/** The public address of the site, for links in the feed and for social media. */
async function siteUrl() {
  const s = await one("SELECT data FROM platform_records WHERE kind='settings' AND id='global'");
  const url =
    (s && JSON.parse(s.data).site_url) || process.env.WEB_ORIGIN?.split(',')[0].trim() || '';
  return url.replace(/\/+$/, '');
}

/** Keeps only safe formatting, pictures, videos from Dellvit, YouTube, Vimeo and Facebook, and links. */
export function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'mark',
      'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'hr', 'code', 'pre', 'span',
      'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'video', 'source', 'iframe',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'width', 'height', 'loading', 'title'],
      video: ['src', 'controls', 'poster', 'width', 'height', 'playsinline', 'preload'],
      source: ['src', 'type'],
      iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'title', 'loading'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      div: ['class'],
      figure: ['class'],
      '*': ['style'],
    },
    allowedClasses: { div: ['video-embed', 'callout'], figure: ['wide', 'full'] },
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify)$/],
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https'], video: ['https'], source: ['https'] },
    allowProtocolRelative: false,
    allowedIframeHostnames: [
      'www.youtube.com',
      'www.youtube-nocookie.com',
      'player.vimeo.com',
      'www.facebook.com',
    ],
    transformTags: {
      // Links to other websites open in a new tab and pass no rank or referrer.
      a: (tag, attribs) => ({
        tagName: 'a',
        attribs: /^https?:\/\//.test(attribs.href || '')
          ? { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' }
          : attribs,
      }),
      img: (tag, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy' } }),
    },
  });
}
const plain = (html: string) =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'post';

const image = z
  .string()
  .max(500)
  .refine(
    (v) => !v || /^\/(images|api\/media)\/[\w.-]+\.(webp|png|jpg|jpeg)$/.test(v),
    'Upload the picture again.',
  )
  .default('');
const postSchema = z.object({
  title: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z0-9-]*$/, 'The web address uses lowercase letters, numbers and dashes.')
    .default(''),
  excerpt: z.string().trim().max(500).default(''),
  content: z.string().max(1_500_000).default(''),
  cover_image: image,
  category: z.string().trim().max(60).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  featured: z.boolean().default(false),
  allow_comments: z.boolean().default(true),
  published_at: z
    .string()
    .max(40)
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Choose a valid date.')
    .default(''),
  author_name: z.string().trim().max(100).default(''),
  seo: z
    .object({
      meta_title: z.string().trim().max(120).default(''),
      meta_description: z.string().trim().max(320).default(''),
      focus_keyword: z.string().trim().max(80).default(''),
      keywords: z.string().trim().max(300).default(''),
      canonical: z
        .string()
        .trim()
        .max(300)
        .refine((v) => !v || /^https:\/\/[^\s<>"']+$/.test(v), 'Use a full https:// address.')
        .default(''),
      og_image: image,
      noindex: z.boolean().default(false),
      nofollow: z.boolean().default(false),
      sitemap: z.boolean().default(true),
    })
    .default({
      meta_title: '',
      meta_description: '',
      focus_keyword: '',
      keywords: '',
      canonical: '',
      og_image: '',
      noindex: false,
      nofollow: false,
      sitemap: true,
    }),
});

/** A post as visitors see it in lists. */
function summary(p: Row) {
  const words = plain(p.content || '').split(' ').filter(Boolean).length;
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt || plain(p.content || '').slice(0, 220),
    cover_image: p.cover_image,
    category: p.category,
    tags: JSON.parse(p.tags || '[]'),
    featured: !!p.featured,
    author_name: p.author_name,
    published_at: p.published_at,
    updated_at: p.updated_at,
    views: p.views,
    reading_minutes: Math.max(1, Math.round(words / 200)),
  };
}
const live = "status='published' AND published_at IS NOT NULL AND published_at<=?";

/** Posts a published article to the connected Facebook Page or Instagram account. */
async function share(post: Row, network: 'facebook' | 'instagram') {
  const s = await blogSettings();
  if (!s.facebook_token) fail('Add the Facebook Page access token in Blog settings first.');
  const base = await siteUrl();
  if (!/^https:\/\//.test(base))
    fail('Set the website address (https://…) in Store settings → Sitemap first.');
  const link = `${base}/blog/${post.slug}`;
  const caption = [post.title, post.excerpt || plain(post.content).slice(0, 300)]
    .filter(Boolean)
    .join('\n\n');
  const graph = async (path: string, body: Record<string, string>) => {
    const r = await fetch('https://graph.facebook.com/v21.0/' + path, {
      method: 'POST',
      body: new URLSearchParams({ ...body, access_token: s.facebook_token }),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await r.json().catch(() => ({}))) as any;
    if (!r.ok || data.error)
      fail(`${network === 'facebook' ? 'Facebook' : 'Instagram'} said: ${data.error?.message || r.statusText}`);
    return data as { id: string };
  };
  let id: string;
  if (network === 'facebook') {
    if (!s.facebook_page_id) fail('Add the Facebook Page ID in Blog settings first.');
    id = (await graph(`${s.facebook_page_id}/feed`, { message: caption, link })).id;
  } else {
    if (!s.instagram_account_id) fail('Add the Instagram business account ID in Blog settings first.');
    if (!(post.cover_image || s.default_image))
      fail('Instagram posts need a picture. Add a cover image to this article.');
    // Instagram only accepts JPEG pictures, so the cover is served as JPEG for it.
    const media = await graph(`${s.instagram_account_id}/media`, {
      image_url: `${base}/api/blog/share-image/${post.id}.jpg`,
      caption: `${caption}\n\nRead more: ${link}`.slice(0, 2200),
    });
    id = (await graph(`${s.instagram_account_id}/media_publish`, { creation_id: media.id })).id;
  }
  const shared = JSON.parse(post.shared || '{}');
  shared[network] = { at: now(), id };
  await run('UPDATE blog_posts SET shared=? WHERE id=?', JSON.stringify(shared), post.id);
  return shared;
}

export function installBlog(app: Express, { writeLimit }: { writeLimit: RequestHandler }) {
  /** Published articles, newest first (featured ones first on page one), with filters. */
  app.get('/api/blog', async (req, res) => {
    const s = await blogSettings();
    if (!s.enabled) return res.json({ posts: [], total: 0, page: 1, pages: 0, categories: [], tags: [], settings: await publicBlogSettings() });
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(1000).default(1),
        limit: z.coerce.number().int().min(1).max(48).optional(),
        q: z.string().trim().max(100).default(''),
        category: z.string().trim().max(60).default(''),
        tag: z.string().trim().max(40).default(''),
      })
      .parse(req.query);
    const limit = q.limit || s.posts_per_page;
    let where = live;
    const args: unknown[] = [now()];
    if (q.q) {
      where += ' AND (title ILIKE ? OR excerpt ILIKE ? OR content ILIKE ?)';
      args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
    }
    if (q.category) {
      where += ' AND category=?';
      args.push(q.category);
    }
    if (q.tag) {
      where += ' AND tags LIKE ?';
      args.push('%' + JSON.stringify(q.tag) + '%');
    }
    const [rows, count, cats, tagRows] = await Promise.all([
      all(
        `SELECT * FROM blog_posts WHERE ${where} ORDER BY featured DESC,published_at DESC LIMIT ${limit} OFFSET ${(q.page - 1) * limit}`,
        ...args,
      ),
      one(`SELECT COUNT(*) n FROM blog_posts WHERE ${where}`, ...args),
      all(
        `SELECT category,COUNT(*) n FROM blog_posts WHERE ${live} AND category<>'' GROUP BY category ORDER BY category`,
        now(),
      ),
      all(`SELECT tags FROM blog_posts WHERE ${live}`, now()),
    ]);
    const tags = new Map<string, number>();
    for (const r of tagRows)
      for (const t of JSON.parse(r.tags || '[]') as string[]) tags.set(t, (tags.get(t) || 0) + 1);
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({
      posts: rows.map(summary),
      total: Number(count?.n || 0),
      page: q.page,
      pages: Math.ceil(Number(count?.n || 0) / limit),
      categories: cats.map((c) => ({ name: c.category, count: Number(c.n) })),
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, count]) => ({ name, count })),
      settings: await publicBlogSettings(),
    });
  });
  /** RSS feed of the latest articles. */
  app.get('/api/blog/rss.xml', async (_req, res) => {
    const s = await blogSettings();
    if (!s.enabled || !s.rss) return res.sendStatus(404);
    const base = await siteUrl();
    const rows = await all(`SELECT * FROM blog_posts WHERE ${live} ORDER BY published_at DESC LIMIT 30`, now());
    const x = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    res.type('application/rss+xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${x(s.title)}</title><link>${x(base)}/blog</link><description>${x(s.description)}</description>${rows
        .map(
          (p) =>
            `<item><title>${x(p.title)}</title><link>${x(base)}/blog/${p.slug}</link><guid>${x(base)}/blog/${p.slug}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate><description>${x(summary(p).excerpt)}</description></item>`,
        )
        .join('')}</channel></rss>`,
    );
  });
  /** A post's cover as JPEG, for Instagram, which does not take WebP. */
  app.get('/api/blog/share-image/:file', async (req, res) => {
    const id = /^([\w-]+)\.jpg$/.exec(String(req.params.file))?.[1];
    const p = id && (await one(`SELECT cover_image FROM blog_posts WHERE id=? AND ${live}`, id, now()));
    const src = (p && p.cover_image) || (await blogSettings()).default_image;
    const name = /^\/api\/media\/([\da-f-]+\.webp)$/.exec(src || '')?.[1];
    const stored = name && (await objects.get('images/' + name));
    if (!stored) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res
      .type('image/jpeg')
      .send(
        await sharp(stored.body)
          .resize(1440, 1440, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 92 })
          .toBuffer(),
      );
  });
  /** One published article with its approved comments and a few related ones. */
  app.get('/api/blog/:slug', async (req, res) => {
    const s = await blogSettings();
    const p = s.enabled
      ? await one(`SELECT * FROM blog_posts WHERE slug=? AND ${live}`, String(req.params.slug), now())
      : null;
    if (!p) fail('Article not found.', 404);
    const commentsOpen = s.comments_enabled && !!p.allow_comments;
    const [comments, related, prev, next] = await Promise.all([
      commentsOpen
        ? all(
            "SELECT id,name,body,created_at FROM blog_comments WHERE post_id=? AND status='approved' ORDER BY created_at",
            p.id,
          )
        : [],
      all(
        `SELECT * FROM blog_posts WHERE ${live} AND id<>? ORDER BY (category=?) DESC,published_at DESC LIMIT 3`,
        now(),
        p.id,
        p.category,
      ),
      one(`SELECT slug,title FROM blog_posts WHERE ${live} AND published_at<? ORDER BY published_at DESC LIMIT 1`, now(), p.published_at),
      one(`SELECT slug,title FROM blog_posts WHERE ${live} AND published_at>? ORDER BY published_at LIMIT 1`, now(), p.published_at),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({
      ...summary(p),
      content: p.content,
      seo: { ...JSON.parse(p.seo || '{}'), noindex: !s.indexing || !!JSON.parse(p.seo || '{}').noindex },
      comments_open: commentsOpen,
      comments,
      related: related.map(summary),
      previous: prev || null,
      next: next || null,
      settings: await publicBlogSettings(),
    });
  });
  /** Counts a read; called once per visit by the website and the app. */
  app.post('/api/blog/:slug/view', writeLimit, async (req, res) => {
    await run(`UPDATE blog_posts SET views=views+1 WHERE slug=? AND ${live}`, String(req.params.slug), now());
    res.json({ ok: true });
  });
  app.post(
    '/api/blog/:slug/comments',
    writeLimit,
    atomicRoute(async (req: AuthRequest, res) => {
      const s = await blogSettings();
      const p = await one(`SELECT * FROM blog_posts WHERE slug=? AND ${live}`, String(req.params.slug), now());
      if (!p || !s.enabled) fail('Article not found.', 404);
      if (!s.comments_enabled || !p.allow_comments) fail('Comments are closed on this article.', 403);
      if (!req.user && !s.comments_guests) fail('Please sign in to comment.', 401);
      const c = z
        .object({
          name: z.string().trim().max(80).default(''),
          body: z.string().trim().min(2).max(2000),
        })
        .parse(req.body);
      const name = req.user?.name || c.name;
      if (!name) fail('Enter your name.');
      const status = s.comments_moderation && req.user?.role !== 'admin' ? 'pending' : 'approved';
      const id = randomUUID();
      await run(
        'INSERT INTO blog_comments(id,post_id,user_id,name,body,status,created_at) VALUES(?,?,?,?,?,?,?)',
        id,
        p.id,
        req.user?.id || null,
        name.slice(0, 80),
        c.body,
        status,
        now(),
      );
      await notify(await adminsWith('blog'), {
        type: 'blog',
        title: status === 'pending' ? 'Comment to approve' : 'New comment',
        body: `${name} on “${p.title}”: ${c.body.slice(0, 100)}`,
        link: '/admin?tab=blog',
      });
      res.status(201).json({ id, status });
    }),
  );

  // ---------- Administration ----------
  app.get('/api/admin/blog', requireRole('admin'), async (_req, res) => {
    const [posts, comments, settings] = await Promise.all([
      all(
        "SELECT p.*,(SELECT COUNT(*) FROM blog_comments c WHERE c.post_id=p.id) comments,(SELECT COUNT(*) FROM blog_comments c WHERE c.post_id=p.id AND c.status='pending') pending FROM blog_posts p ORDER BY COALESCE(p.published_at,p.created_at) DESC",
      ),
      all(
        'SELECT c.*,p.title post_title,p.slug post_slug FROM blog_comments c JOIN blog_posts p ON p.id=c.post_id ORDER BY c.created_at DESC LIMIT 500',
      ),
      blogSettings(),
    ]);
    const { facebook_token, ...safe } = settings;
    res.json({
      posts: posts.map((p) => ({
        ...summary(p),
        status: p.status,
        allow_comments: !!p.allow_comments,
        created_at: p.created_at,
        comments: Number(p.comments),
        pending: Number(p.pending),
        shared: JSON.parse(p.shared || '{}'),
        seo: JSON.parse(p.seo || '{}'),
      })),
      comments,
      settings: { ...safe, facebook_token: '', has_facebook_token: !!facebook_token },
    });
  });
  app.put(
    '/api/admin/blog/settings',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const old = await blogSettings();
      const body = { ...req.body };
      // An empty token field keeps the saved token; "remove" clears it.
      if (!body.facebook_token) body.facebook_token = old.facebook_token;
      if (body.facebook_token === 'remove') body.facebook_token = '';
      delete body.has_facebook_token;
      const s = settingsSchema.parse(body);
      await run(
        "INSERT INTO platform_records VALUES('blog','settings',?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
        JSON.stringify(s),
      );
      res.json({ ok: true });
    }),
  );
  app.patch(
    '/api/admin/blog/comments/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const { status } = z.object({ status: z.enum(['pending', 'approved', 'spam']) }).parse(req.body);
      const r = await run('UPDATE blog_comments SET status=? WHERE id=?', status, String(req.params.id));
      if (!r.changes) fail('Comment not found.', 404);
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/admin/blog/comments/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      await run('DELETE FROM blog_comments WHERE id=?', String(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.get('/api/admin/blog/:id', requireRole('admin'), async (req, res) => {
    const p = await one('SELECT * FROM blog_posts WHERE id=?', String(req.params.id));
    if (!p) fail('Article not found.', 404);
    res.json({
      ...summary(p),
      content: p.content,
      status: p.status,
      allow_comments: !!p.allow_comments,
      seo: JSON.parse(p.seo || '{}'),
      shared: JSON.parse(p.shared || '{}'),
    });
  });
  /** Creates or saves an article. */
  app.put(
    '/api/admin/blog/:id',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const id = String(req.params.id);
      if (!/^[\w-]{8,100}$/.test(id)) fail('Invalid article.');
      const p = postSchema.parse(req.body);
      const old = await one('SELECT * FROM blog_posts WHERE id=?', id);
      // A unique web address: the one given, or one made from the title.
      let slug = p.slug || slugify(p.title);
      for (let n = 2; await one('SELECT id FROM blog_posts WHERE slug=? AND id<>?', slug, id); n++)
        slug = `${(p.slug || slugify(p.title)).slice(0, 85)}-${n}`;
      const content = cleanHtml(p.content);
      const published =
        p.status === 'published'
          ? p.published_at
            ? new Date(p.published_at).toISOString()
            : old?.published_at || now()
          : p.published_at
            ? new Date(p.published_at).toISOString()
            : null;
      const values = [
        slug,
        p.title,
        p.excerpt,
        content,
        p.cover_image,
        p.category,
        JSON.stringify([...new Set(p.tags)]),
        p.status,
        p.featured ? 1 : 0,
        p.allow_comments ? 1 : 0,
        JSON.stringify(p.seo),
        p.author_name || old?.author_name || req.user!.name,
        published,
        now(),
      ];
      if (old)
        await run(
          'UPDATE blog_posts SET slug=?,title=?,excerpt=?,content=?,cover_image=?,category=?,tags=?,status=?,featured=?,allow_comments=?,seo=?,author_name=?,published_at=?,updated_at=? WHERE id=?',
          ...values,
          id,
        );
      else
        await run(
          'INSERT INTO blog_posts(slug,title,excerpt,content,cover_image,category,tags,status,featured,allow_comments,seo,author_name,published_at,updated_at,id,author_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ...values,
          id,
          req.user!.id,
          now(),
        );
      // First publication: post it to the connected accounts if Blog settings ask for that.
      if (p.status === 'published' && old?.status !== 'published') {
        const s = await blogSettings();
        if (s.auto_share && s.facebook_token)
          await afterCommit(async () => {
            const post = await one('SELECT * FROM blog_posts WHERE id=?', id);
            if (!post || post.published_at > now()) return;
            for (const network of ['facebook', 'instagram'] as const)
              if (network === 'facebook' ? s.facebook_page_id : s.instagram_account_id)
                await share(post, network).catch(() => console.error('Blog auto-share failed.'));
          });
      }
      res.json({ id, slug, content });
    }),
  );
  app.patch(
    '/api/admin/blog/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const p = z
        .object({
          status: z.enum(['draft', 'published']).optional(),
          featured: z.boolean().optional(),
          allow_comments: z.boolean().optional(),
        })
        .parse(req.body);
      const old = await one('SELECT * FROM blog_posts WHERE id=?', String(req.params.id));
      if (!old) fail('Article not found.', 404);
      await run(
        'UPDATE blog_posts SET status=?,featured=?,allow_comments=?,published_at=?,updated_at=? WHERE id=?',
        p.status ?? old.status,
        p.featured === undefined ? old.featured : p.featured ? 1 : 0,
        p.allow_comments === undefined ? old.allow_comments : p.allow_comments ? 1 : 0,
        p.status === 'published' && !old.published_at ? now() : old.published_at,
        now(),
        old.id,
      );
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/admin/blog/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      await run('DELETE FROM blog_posts WHERE id=?', String(req.params.id));
      res.json({ ok: true });
    }),
  );
  /** Posts a published article to Facebook or Instagram now. */
  app.post(
    '/api/admin/blog/:id/share',
    requireRole('admin'),
    async (req, res) => {
      const { network } = z.object({ network: z.enum(['facebook', 'instagram']) }).parse(req.body);
      const post = await one(`SELECT * FROM blog_posts WHERE id=? AND ${live}`, String(req.params.id), now());
      if (!post) fail('Publish the article before sharing it.');
      res.json({ shared: await share(post, network) });
    },
  );
}

/** Published articles that belong in the sitemap. */
export async function blogSitemap() {
  const s = await blogSettings();
  if (!s.enabled || !s.indexing || !s.sitemap) return [];
  return (
    await all(`SELECT slug,cover_image,seo,updated_at FROM blog_posts WHERE ${live} ORDER BY published_at DESC LIMIT 5000`, now())
  )
    .filter((p) => {
      const seo = JSON.parse(p.seo || '{}');
      return !seo.noindex && seo.sitemap !== false;
    })
    .map((p) => ({ slug: p.slug, image: p.cover_image || '', updated_at: p.updated_at }));
}
