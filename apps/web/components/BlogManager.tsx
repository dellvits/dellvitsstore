'use client';
import { useState, type FormEvent } from 'react';
import {
  Check,
  Edit3,
  ExternalLink,
  Eye,
  Facebook,
  FileText,
  Instagram,
  MessageSquare,
  Newspaper,
  Plus,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api, date } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, ErrorBox, IconAction, Modal, Stat, Toggle } from './UI';
import { ImageField, localDate } from './Platform';
import { RichEditor } from './RichEditor';

type Seo = {
  meta_title: string;
  meta_description: string;
  focus_keyword: string;
  keywords: string;
  canonical: string;
  og_image: string;
  noindex: boolean;
  nofollow: boolean;
  sitemap: boolean;
};
type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_image: string;
  category: string;
  tags: string[];
  featured: boolean;
  author_name: string;
  published_at: string | null;
  updated_at: string;
  created_at: string;
  views: number;
  reading_minutes: number;
  status: 'draft' | 'published';
  allow_comments: boolean;
  comments: number;
  pending: number;
  shared: { facebook?: { at: string }; instagram?: { at: string } };
  seo: Partial<Seo>;
};
type Draft = Omit<Post, 'comments' | 'pending' | 'views' | 'reading_minutes' | 'updated_at' | 'created_at' | 'shared' | 'seo'> & {
  content: string;
  seo: Seo;
  isNew: boolean;
};
type Comment = { id: string; post_title: string; post_slug: string; name: string; body: string; status: string; created_at: string };
type BlogSettingsForm = {
  enabled: boolean;
  title: string;
  description: string;
  posts_per_page: number;
  show_in_menu: boolean;
  show_on_home: boolean;
  home_count: number;
  comments_enabled: boolean;
  comments_moderation: boolean;
  comments_guests: boolean;
  indexing: boolean;
  sitemap: boolean;
  rss: boolean;
  default_image: string;
  share_buttons: boolean;
  facebook_page_id: string;
  instagram_account_id: string;
  facebook_token: string;
  has_facebook_token: boolean;
  auto_share: boolean;
};
type Data = { posts: Post[]; comments: Comment[]; settings: BlogSettingsForm };

const emptySeo: Seo = {
  meta_title: '',
  meta_description: '',
  focus_keyword: '',
  keywords: '',
  canonical: '',
  og_image: '',
  noindex: false,
  nofollow: false,
  sitemap: true,
};
const state = (p: Pick<Post, 'status' | 'published_at'>) =>
  p.status === 'draft'
    ? { key: 'draft', text: 'Draft', tone: 'neutral' }
    : p.published_at && p.published_at > new Date().toISOString()
      ? { key: 'scheduled', text: 'Scheduled', tone: 'info' }
      : { key: 'live', text: 'Published', tone: 'success' };
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Checks an article against simple search engine advice, as a to-do list. */
function seoChecks(d: Draft) {
  const title = d.seo.meta_title || d.title;
  const description = d.seo.meta_description || d.excerpt;
  const text = plain(d.content).toLowerCase();
  const key = d.seo.focus_keyword.toLowerCase();
  const words = text.split(' ').filter(Boolean).length;
  const images = (d.content.match(/<img /g) || []).length;
  const withoutAlt = (d.content.match(/<img (?![^>]*alt="[^"]+")[^>]*>/g) || []).length;
  return [
    { ok: title.length >= 30 && title.length <= 60, text: `Search title is ${title.length} characters (best 30–60).` },
    { ok: description.length >= 70 && description.length <= 160, text: `Description is ${description.length} characters (best 70–160).` },
    { ok: words >= 300, text: `The article has ${words} words (300 or more ranks better).` },
    { ok: !!key, text: key ? `Focus keyword: “${d.seo.focus_keyword}”.` : 'Choose a focus keyword.' },
    ...(key
      ? [
          { ok: title.toLowerCase().includes(key), text: 'The focus keyword is in the search title.' },
          { ok: description.toLowerCase().includes(key), text: 'The focus keyword is in the description.' },
          { ok: text.slice(0, 600).includes(key), text: 'The focus keyword is in the first paragraph.' },
          { ok: d.slug.includes(key.replace(/\s+/g, '-')), text: 'The focus keyword is in the web address.' },
        ]
      : []),
    { ok: !!(d.cover_image || d.seo.og_image), text: 'A cover picture is set for sharing.' },
    { ok: !images || !withoutAlt, text: images ? `${images - withoutAlt} of ${images} pictures have a description.` : 'Add a picture to the article.' },
    { ok: /<h2/.test(d.content), text: 'The article uses headings.' },
  ];
}

export function BlogManager() {
  const { notice } = useApp();
  const { data, setData, error, loading, refresh } = useData<Data>('/admin/blog');
  const [tab, setTab] = useState<'posts' | 'comments' | 'settings'>('posts');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [side, setSide] = useState<'publish' | 'seo'>('publish');
  const [remove, setRemove] = useState<Post | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [settings, setSettings] = useState<BlogSettingsForm | null>(null);
  const posts = data?.posts || [];
  const comments = data?.comments || [];
  const statsBusy = loading && !data;

  async function open(p?: Post) {
    setFormError('');
    setSide('publish');
    if (!p)
      return setEdit({
        id: crypto.randomUUID(),
        slug: '',
        title: '',
        excerpt: '',
        content: '',
        cover_image: '',
        category: '',
        tags: [],
        featured: false,
        author_name: '',
        published_at: null,
        status: 'draft',
        allow_comments: true,
        seo: { ...emptySeo },
        isNew: true,
      });
    try {
      const full = await api<Post & { content: string }>('/admin/blog/' + p.id);
      setEdit({ ...full, seo: { ...emptySeo, ...full.seo }, isNew: false });
    } catch (e) {
      notice((e as Error).message);
    }
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const setSeo = <K extends keyof Seo>(k: K, v: Seo[K]) => setEdit((e) => (e ? { ...e, seo: { ...e.seo, [k]: v } } : e));
  async function save(status?: 'draft' | 'published', e?: FormEvent) {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    const { id, isNew, ...body } = edit;
    try {
      const r = await api<{ slug: string }>('/admin/blog/' + id, {
        method: 'PUT',
        body: JSON.stringify({ ...body, status: status || edit.status, published_at: edit.published_at || '' }),
      });
      setEdit(null);
      refresh();
      notice(
        (status || edit.status) === 'published'
          ? `Published. It is at /blog/${r.slug}.`
          : 'Draft saved. Visitors cannot see it yet.',
      );
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function quick(p: Post, change: Partial<Post>, done: string) {
    setData((d) => d && { ...d, posts: d.posts.map((x) => (x.id === p.id ? { ...x, ...change } : x)) });
    try {
      await api('/admin/blog/' + p.id, { method: 'PATCH', body: JSON.stringify(change) });
      notice(done);
    } catch (e) {
      notice((e as Error).message);
    }
    refresh();
  }
  async function share(p: Post, network: 'facebook' | 'instagram') {
    if (state(p).key !== 'live') return notice('Publish the article before sharing it.');
    if (!data?.settings.has_facebook_token) {
      // Without a connected account, the share page opens instead.
      if (network === 'facebook')
        window.open(
          'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(location.origin + '/blog/' + p.slug),
          '_blank',
          'noopener,noreferrer,width=640,height=560',
        );
      else notice('Connect your Instagram business account in Blog settings to post from here.');
      return;
    }
    notice(`Posting to ${network === 'facebook' ? 'Facebook' : 'Instagram'}…`);
    try {
      await api('/admin/blog/' + p.id + '/share', { method: 'POST', body: JSON.stringify({ network }) });
      notice(`Posted to ${network === 'facebook' ? 'Facebook' : 'Instagram'}.`);
      refresh();
    } catch (e) {
      notice((e as Error).message);
    }
  }
  async function moderate(c: Comment, status: string) {
    setData((d) => d && { ...d, comments: d.comments.map((x) => (x.id === c.id ? { ...x, status } : x)) });
    try {
      await api('/admin/blog/comments/' + c.id, { method: 'PATCH', body: JSON.stringify({ status }) });
      notice(status === 'approved' ? 'Comment published.' : status === 'spam' ? 'Marked as spam.' : 'Comment hidden.');
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api('/admin/blog/settings', { method: 'PUT', body: JSON.stringify(settings) });
      notice('Blog settings saved.');
      setSettings(null);
      refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const s = settings || data?.settings;
  const setS = <K extends keyof BlogSettingsForm>(k: K, v: BlogSettingsForm[K]) =>
    setSettings({ ...(settings || data!.settings), [k]: v });
  const live = posts.filter((p) => state(p).key === 'live');
  const pendingComments = comments.filter((c) => c.status === 'pending').length;
  const checks = edit ? seoChecks(edit) : [];
  return (
    <div className="stack">
      <div className="stats">
        <Stat icon={<Newspaper size={20} />} label="Articles" value={posts.length} hint={`${live.length} published`} tone="blue" loading={statsBusy} />
        <Stat
          icon={<FileText size={20} />}
          label="Drafts & scheduled"
          value={posts.length - live.length}
          hint={`${posts.filter((p) => state(p).key === 'scheduled').length} scheduled`}
          tone="purple"
          loading={statsBusy}
        />
        <Stat icon={<Eye size={20} />} label="Reads" value={posts.reduce((n, p) => n + p.views, 0)} hint="All articles" tone="green" loading={statsBusy} />
        <Stat
          icon={<MessageSquare size={20} />}
          label="Comments to approve"
          value={pendingComments}
          hint={`${comments.length} comments in all`}
          tone="orange"
          quiet={!pendingComments}
          loading={statsBusy}
        />
      </div>
      <div className="segmented">
        <button className={tab === 'posts' ? 'selected' : ''} onClick={() => setTab('posts')}>
          <Newspaper size={15} /> Articles
        </button>
        <button className={tab === 'comments' ? 'selected' : ''} onClick={() => setTab('comments')}>
          <MessageSquare size={15} /> Comments {pendingComments > 0 && <Badge tone="warn">{pendingComments}</Badge>}
        </button>
        <button className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}>
          <Settings size={15} /> Settings
        </button>
      </div>
      {error && <ErrorBox error={error} retry={refresh} />}

      {tab === 'posts' && (
        <DataTable
          rows={data ? posts : null}
          loading={loading}
          error=""
          onRetry={refresh}
          rowKey={(p) => p.id}
          onRowClick={(p) => open(p)}
          search={(p) => `${p.title} ${p.category} ${p.tags.join(' ')} ${p.slug}`}
          searchPlaceholder="Search articles"
          empty="No articles yet. Write your first one."
          toolbar={
            <button className="button" onClick={() => open()}>
              <Plus size={16} /> Write article
            </button>
          }
          filters={[
            {
              key: 'status',
              label: 'Statuses',
              options: [
                { value: 'live', label: 'Published' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'draft', label: 'Draft' },
              ],
              test: (p, v) => state(p).key === v,
            },
            {
              key: 'category',
              label: 'Categories',
              options: [...new Set(posts.map((p) => p.category).filter(Boolean))].map((c) => ({ value: c, label: c })),
              test: (p, v) => p.category === v,
            },
          ]}
          columns={[
            {
              key: 'title',
              header: 'Article',
              sort: (p) => p.title.toLowerCase(),
              render: (p) => (
                <div className="cell-main">
                  {p.cover_image ? <img className="cell-thumb" src={p.cover_image} alt="" /> : <span className="cell-thumb placeholder" />}
                  <span className="cell-stack">
                    <strong>
                      {p.featured && <Star size={12} className="star-on" />} {p.title}
                    </strong>
                    <small>
                      /blog/{p.slug}
                      {p.category && ' · ' + p.category}
                    </small>
                  </span>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              sort: (p) => p.published_at || '',
              render: (p) => (
                <span className="cell-stack">
                  <Badge tone={state(p).tone}>{state(p).text}</Badge>
                  {p.published_at && <small>{date(p.published_at)}</small>}
                </span>
              ),
            },
            { key: 'views', header: 'Reads', sort: (p) => p.views, render: (p) => p.views.toLocaleString('en-PK') },
            {
              key: 'comments',
              header: 'Comments',
              sort: (p) => p.comments,
              render: (p) => (
                <span className="cell-stack">
                  <span>{p.comments}</span>
                  {p.pending > 0 && <small className="warn-text">{p.pending} to approve</small>}
                </span>
              ),
            },
            {
              key: 'shared',
              header: 'Shared',
              render: (p) => (
                <span className="cell-stack">
                  {p.shared.facebook && <small>Facebook {date(p.shared.facebook.at)}</small>}
                  {p.shared.instagram && <small>Instagram {date(p.shared.instagram.at)}</small>}
                  {!p.shared.facebook && !p.shared.instagram && <span className="muted">—</span>}
                </span>
              ),
            },
            {
              key: 'featured',
              header: 'Featured',
              render: (p) => (
                <Toggle checked={p.featured} onChange={(v) => quick(p, { featured: v }, v ? 'Shown first on the blog.' : 'No longer featured.')} />
              ),
            },
          ]}
          actions={(p) => (
            <>
              <IconAction label="Edit" onClick={() => open(p)}>
                <Edit3 size={16} />
              </IconAction>
              {state(p).key === 'live' && (
                <IconAction label="View on the website" href={'/blog/' + p.slug}>
                  <ExternalLink size={16} />
                </IconAction>
              )}
              <IconAction label="Post to Facebook" onClick={() => share(p, 'facebook')}>
                <Facebook size={16} />
              </IconAction>
              <IconAction label="Post to Instagram" onClick={() => share(p, 'instagram')}>
                <Instagram size={16} />
              </IconAction>
              <IconAction label="Delete" tone="danger" onClick={() => setRemove(p)}>
                <Trash2 size={16} />
              </IconAction>
            </>
          )}
        />
      )}

      {tab === 'comments' && (
        <DataTable
          rows={data ? comments : null}
          loading={loading}
          error=""
          onRetry={refresh}
          rowKey={(c) => c.id}
          search={(c) => `${c.name} ${c.body} ${c.post_title}`}
          searchPlaceholder="Search comments"
          empty="No comments yet."
          filters={[
            {
              key: 'status',
              label: 'Statuses',
              options: [
                { value: 'pending', label: 'To approve' },
                { value: 'approved', label: 'Published' },
                { value: 'spam', label: 'Spam' },
              ],
              test: (c, v) => c.status === v,
            },
          ]}
          columns={[
            {
              key: 'body',
              header: 'Comment',
              render: (c) => (
                <span className="cell-stack">
                  <strong>{c.name}</strong>
                  <small className="clamp-2">{c.body}</small>
                </span>
              ),
            },
            {
              key: 'post',
              header: 'Article',
              render: (c) => (
                <a href={'/blog/' + c.post_slug} target="_blank" rel="noreferrer">
                  {c.post_title}
                </a>
              ),
            },
            { key: 'at', header: 'Written', sort: (c) => c.created_at, render: (c) => date(c.created_at) },
            {
              key: 'status',
              header: 'Status',
              render: (c) => (
                <Badge tone={c.status === 'approved' ? 'success' : c.status === 'spam' ? 'danger' : 'warn'}>
                  {c.status === 'approved' ? 'Published' : c.status === 'spam' ? 'Spam' : 'To approve'}
                </Badge>
              ),
            },
          ]}
          actions={(c) => (
            <>
              {c.status !== 'approved' && (
                <IconAction label="Publish" tone="success" onClick={() => moderate(c, 'approved')}>
                  <Check size={16} />
                </IconAction>
              )}
              {c.status === 'approved' && (
                <IconAction label="Hide" onClick={() => moderate(c, 'pending')}>
                  <X size={16} />
                </IconAction>
              )}
              {c.status !== 'spam' && (
                <IconAction label="Spam" onClick={() => moderate(c, 'spam')}>
                  <ShieldAlert size={16} />
                </IconAction>
              )}
              <IconAction
                label="Delete"
                tone="danger"
                onClick={async () => {
                  try {
                    await api('/admin/blog/comments/' + c.id, { method: 'DELETE' });
                    refresh();
                    notice('Comment deleted.');
                  } catch (e) {
                    notice((e as Error).message);
                  }
                }}
              >
                <Trash2 size={16} />
              </IconAction>
            </>
          )}
        />
      )}

      {tab === 'settings' && s && (
        <form className="card stack" onSubmit={saveSettings}>
          <h3>Blog</h3>
          <div className="toggle-list">
            <Toggle checked={s.enabled} onChange={(v) => setS('enabled', v)} label="Blog is on (website and app)" />
            <Toggle checked={s.show_in_menu} onChange={(v) => setS('show_in_menu', v)} label="Show Blog in the website menu and the app" />
            <Toggle checked={s.show_on_home} onChange={(v) => setS('show_on_home', v)} label="Show the latest articles on the home page" />
            <Toggle checked={s.share_buttons} onChange={(v) => setS('share_buttons', v)} label="Show share buttons under articles" />
          </div>
          <div className="form-grid">
            <label>
              Blog title
              <input required maxLength={80} value={s.title} onChange={(e) => setS('title', e.target.value)} />
            </label>
            <label>
              Articles per page
              <input type="number" min={3} max={48} value={s.posts_per_page} onChange={(e) => setS('posts_per_page', Number(e.target.value))} />
            </label>
            <label className="span-2">
              Description <small className="muted">(shown on the blog page and to search engines)</small>
              <textarea rows={2} maxLength={300} value={s.description} onChange={(e) => setS('description', e.target.value)} />
            </label>
            <label>
              Articles on the home page
              <input type="number" min={1} max={12} value={s.home_count} onChange={(e) => setS('home_count', Number(e.target.value))} />
            </label>
            <div className="field">
              <span className="field-label">Picture for articles without a cover</span>
              <ImageField value={s.default_image} onChange={(v) => setS('default_image', v)} />
            </div>
          </div>
          <h4 className="form-section">Comments</h4>
          <div className="toggle-list">
            <Toggle checked={s.comments_enabled} onChange={(v) => setS('comments_enabled', v)} label="Allow comments" />
            <Toggle checked={s.comments_moderation} onChange={(v) => setS('comments_moderation', v)} label="Approve comments before they appear" />
            <Toggle checked={s.comments_guests} onChange={(v) => setS('comments_guests', v)} label="Visitors who are not signed in may comment" />
          </div>
          <h4 className="form-section">Search engines</h4>
          <div className="toggle-list">
            <Toggle checked={s.indexing} onChange={(v) => setS('indexing', v)} label="Let search engines index the blog" />
            <Toggle checked={s.sitemap} onChange={(v) => setS('sitemap', v)} label="List articles in sitemap.xml" />
            <Toggle checked={s.rss} onChange={(v) => setS('rss', v)} label="Publish an RSS feed (/api/blog/rss.xml)" />
          </div>
          <small className="muted">The whole site’s indexing and sitemap switches are in Store settings → Sitemap; they come first.</small>
          <h4 className="form-section">Facebook and Instagram</h4>
          <small className="muted">
            To post articles from here, connect a Facebook Page and the Instagram business account linked to it. In Meta Business
            Suite create a long-lived Page access token with the pages_manage_posts, instagram_basic and instagram_content_publish
            permissions. Without these, the Facebook button opens Facebook’s share page instead.
          </small>
          <div className="form-grid">
            <label>
              Facebook Page ID
              <input inputMode="numeric" value={s.facebook_page_id} onChange={(e) => setS('facebook_page_id', e.target.value.trim())} />
            </label>
            <label>
              Instagram business account ID
              <input inputMode="numeric" value={s.instagram_account_id} onChange={(e) => setS('instagram_account_id', e.target.value.trim())} />
            </label>
            <label className="span-2">
              Page access token
              <input
                type="password"
                autoComplete="off"
                value={s.facebook_token}
                placeholder={s.has_facebook_token ? 'Saved. Paste a new token to replace it.' : 'Paste the token'}
                onChange={(e) => setS('facebook_token', e.target.value)}
              />
              {s.has_facebook_token && (
                <button type="button" className="link" onClick={() => setS('facebook_token', 'remove')}>
                  Remove the saved token
                </button>
              )}
            </label>
          </div>
          <Toggle checked={s.auto_share} onChange={(v) => setS('auto_share', v)} label="Post new articles automatically when they are published" />
          {formError && <ErrorBox error={formError} />}
          <div className="form-foot">
            <button type="button" className="button ghost" disabled={!settings} onClick={() => setSettings(null)}>
              Discard changes
            </button>
            <button className="button" disabled={busy || !settings}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      )}

      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={edit?.isNew ? 'Write article' : 'Edit article'} size="xl">
        {edit && (
          <form className="blog-editor" onSubmit={(e) => save(undefined, e)}>
            <div className="blog-editor-main stack">
              <input
                className="blog-title-input"
                required
                maxLength={200}
                value={edit.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Article title"
                aria-label="Title"
              />
              <label>
                Short summary <small className="muted">(shown on cards and to search engines)</small>
                <textarea rows={2} maxLength={500} value={edit.excerpt} onChange={(e) => set('excerpt', e.target.value)} />
              </label>
              <RichEditor value={edit.content} onChange={(html) => set('content', html)} />
            </div>
            <aside className="blog-editor-side stack">
              <div className="segmented small">
                <button type="button" className={side === 'publish' ? 'selected' : ''} onClick={() => setSide('publish')}>
                  Publish
                </button>
                <button type="button" className={side === 'seo' ? 'selected' : ''} onClick={() => setSide('seo')}>
                  SEO {checks.filter((c) => !c.ok).length > 0 && <Badge tone="warn">{checks.filter((c) => !c.ok).length}</Badge>}
                </button>
              </div>
              {side === 'publish' ? (
                <>
                  <div className="field">
                    <span className="field-label">Cover picture</span>
                    <ImageField value={edit.cover_image} onChange={(v) => set('cover_image', v)} />
                  </div>
                  <label>
                    Web address
                    <span className="input-prefix">
                      <small>/blog/</small>
                      <input
                        value={edit.slug}
                        maxLength={100}
                        placeholder="made-from-the-title"
                        onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
                      />
                    </span>
                  </label>
                  <label>
                    Category
                    <input
                      list="blog-categories"
                      maxLength={60}
                      value={edit.category}
                      onChange={(e) => set('category', e.target.value)}
                      placeholder="News, Recipes, Offers…"
                    />
                    <datalist id="blog-categories">
                      {[...new Set(posts.map((p) => p.category).filter(Boolean))].map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Tags <small className="muted">(comma separated)</small>
                    <input
                      value={edit.tags.join(', ')}
                      onChange={(e) =>
                        set(
                          'tags',
                          e.target.value
                            .split(',')
                            .map((t) => t.trimStart())
                            .slice(0, 20),
                        )
                      }
                      onBlur={() => set('tags', [...new Set(edit.tags.map((t) => t.trim()).filter(Boolean))])}
                    />
                  </label>
                  <label>
                    Author name
                    <input maxLength={100} value={edit.author_name} placeholder="Your name" onChange={(e) => set('author_name', e.target.value)} />
                  </label>
                  <label>
                    Publish date <small className="muted">(a future date schedules it)</small>
                    <input
                      type="datetime-local"
                      value={edit.published_at ? localDate(edit.published_at) : ''}
                      onChange={(e) => set('published_at', e.target.value ? new Date(e.target.value).toISOString() : null)}
                    />
                  </label>
                  <Toggle checked={edit.featured} onChange={(v) => set('featured', v)} label="Featured (shown first)" />
                  <Toggle checked={edit.allow_comments} onChange={(v) => set('allow_comments', v)} label="Allow comments" />
                </>
              ) : (
                <>
                  <div className="serp-preview" aria-label="How it may look on Google">
                    <small>{(typeof location !== 'undefined' ? location.host : 'dellvit.com') + '/blog/' + (edit.slug || 'your-article')}</small>
                    <strong>{(edit.seo.meta_title || edit.title || 'Article title').slice(0, 65)}</strong>
                    <span>{(edit.seo.meta_description || edit.excerpt || plain(edit.content)).slice(0, 160) || 'The summary appears here.'}</span>
                  </div>
                  <label>
                    Search title <small className="muted">{(edit.seo.meta_title || edit.title).length}/60</small>
                    <input maxLength={120} value={edit.seo.meta_title} placeholder={edit.title} onChange={(e) => setSeo('meta_title', e.target.value)} />
                  </label>
                  <label>
                    Search description <small className="muted">{(edit.seo.meta_description || edit.excerpt).length}/160</small>
                    <textarea rows={3} maxLength={320} value={edit.seo.meta_description} placeholder={edit.excerpt} onChange={(e) => setSeo('meta_description', e.target.value)} />
                  </label>
                  <label>
                    Focus keyword
                    <input maxLength={80} value={edit.seo.focus_keyword} onChange={(e) => setSeo('focus_keyword', e.target.value)} />
                  </label>
                  <label>
                    Keywords <small className="muted">(comma separated)</small>
                    <input maxLength={300} value={edit.seo.keywords} onChange={(e) => setSeo('keywords', e.target.value)} />
                  </label>
                  <label>
                    Canonical address <small className="muted">(only if this article first appeared elsewhere)</small>
                    <input maxLength={300} value={edit.seo.canonical} placeholder="https://…" onChange={(e) => setSeo('canonical', e.target.value)} />
                  </label>
                  <div className="field">
                    <span className="field-label">Picture when shared (Facebook, WhatsApp…)</span>
                    <ImageField value={edit.seo.og_image} onChange={(v) => setSeo('og_image', v)} />
                    <small className="muted">Left empty, the cover picture is used.</small>
                  </div>
                  <div className="toggle-list">
                    <Toggle checked={edit.seo.noindex} onChange={(v) => setSeo('noindex', v)} label="Hide from search engines (noindex)" />
                    <Toggle checked={edit.seo.nofollow} onChange={(v) => setSeo('nofollow', v)} label="Ask search engines not to follow its links" />
                    <Toggle checked={edit.seo.sitemap} onChange={(v) => setSeo('sitemap', v)} label="List in sitemap.xml" />
                  </div>
                  <ul className="seo-checks">
                    {checks.map((c) => (
                      <li key={c.text} className={c.ok ? 'ok' : ''}>
                        {c.ok ? <Check size={13} /> : <X size={13} />} {c.text}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {formError && <ErrorBox error={formError} />}
              <div className="blog-editor-actions">
                <button type="button" className="button ghost" disabled={busy} onClick={() => save('draft')}>
                  {edit.status === 'published' ? 'Unpublish (draft)' : 'Save draft'}
                </button>
                <button type="button" className="button" disabled={busy} onClick={() => save('published')}>
                  {busy ? 'Saving…' : edit.published_at && edit.published_at > new Date().toISOString() ? 'Schedule' : edit.status === 'published' ? 'Update' : 'Publish'}
                </button>
              </div>
            </aside>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete article?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/blog/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Article deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        “{remove?.title}” and its comments will be removed permanently. To hide it for now, save it as a draft instead.
      </Confirm>
    </div>
  );
}
