'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  Bell,
  Check,
  CircleCheck,
  Edit3,
  ImagePlus,
  PackageSearch,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, date, money } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Product } from '@/lib/types';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, Empty, ErrorBox, IconAction, Loading, Modal, Stat } from './UI';
import { IMAGE_ACCEPT, prepareImages } from './ImageCropper';

type Match = {
  id: string;
  name: string;
  effective_price: number;
  price: number;
  discount: number;
  image: string;
  unit: string;
  outlet_name: string;
  available: boolean;
};
export type Wish = {
  id: string;
  name: string;
  description: string;
  images: string[];
  max_price: number;
  color: string;
  quality: string;
  quantity: number;
  location_id: string | null;
  notes: string;
  status: 'open' | 'found' | 'closed';
  created_at: string;
  matched_at: string | null;
  matches: Match[];
  // Administrators also see who asked.
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  area_name?: string | null;
};
type Form = Omit<Wish, 'id' | 'status' | 'created_at' | 'matched_at' | 'matches' | 'max_price'> & { id?: string; max_price: string };
const qualities = ['Any', 'Brand new', 'Like new', 'Used', 'Premium', 'Standard', 'Budget'];
const statusText = (w: Wish) =>
  w.status === 'closed'
    ? { text: 'Closed', tone: 'neutral' }
    : w.status === 'found'
      ? { text: 'Found', tone: 'success' }
      : w.matches.length
        ? { text: `${w.matches.length} match${w.matches.length === 1 ? '' : 'es'}`, tone: 'success' }
        : { text: 'Looking', tone: 'info' };

/** Pictures for a request: cropped first, then uploaded. */
function WishPictures({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { notice } = useApp();
  const [busy, setBusy] = useState(false);
  async function add(files: File[]) {
    setBusy(true);
    let urls = value;
    try {
      for (const f of await prepareImages(files.slice(0, 6 - value.length))) {
        const form = new FormData();
        form.append('file', f);
        const r = await api<{ url: string }>('/uploads/images', { method: 'POST', body: form });
        urls = [...urls, r.url];
        onChange(urls);
      }
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="image-upload">
      {value.map((url, i) => (
        <div className="upload-preview" key={url}>
          <img src={url} alt={'Picture ' + (i + 1)} />
          <button type="button" onClick={() => onChange(value.filter((x) => x !== url))} aria-label={'Remove picture ' + (i + 1)}>
            <X size={13} />
          </button>
        </div>
      ))}
      {value.length < 6 && (
        <label className="upload-tile">
          <ImagePlus size={18} />
          <span>{busy ? 'Uploading…' : 'Add pictures'}</span>
          <input
            type="file"
            hidden
            multiple
            accept={IMAGE_ACCEPT}
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.length) add([...e.target.files]);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

function MatchList({ matches }: { matches: Match[] }) {
  return (
    <div className="wish-matches">
      {matches.map((m) => (
        <Link key={m.id} href={'/products/' + m.id} className={'wish-match' + (m.available ? '' : ' off')}>
          {m.image ? <img src={m.image} alt="" /> : <span className="cell-thumb placeholder" />}
          <span className="cell-stack">
            <strong>{m.name}</strong>
            <small>
              {m.outlet_name} · {m.unit}
            </small>
          </span>
          <span className="cell-stack end">
            <strong>{money(m.effective_price)}</strong>
            {!m.available && <small>Sold out</small>}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** The customer's "Find my product" page in their account. */
export function FindMyProduct() {
  const { notice, locations, user } = useApp();
  const { data, error, loading, refresh, setData } = useData<Wish[]>('/wishes', 60000);
  const [edit, setEdit] = useState<Form | null>(null);
  const [remove, setRemove] = useState<Wish | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const start = (w?: Wish) => {
    setFormError('');
    setEdit(
      w
        ? { ...w, max_price: w.max_price ? String(w.max_price / 100) : '' }
        : {
            name: '',
            description: '',
            images: [],
            max_price: '',
            color: '',
            quality: '',
            quantity: 1,
            location_id: user?.location_id || null,
            notes: '',
          },
    );
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      const { id, ...body } = edit;
      const r = await api<Wish & { found?: number }>('/wishes' + (id ? '/' + id : ''), {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...body, max_price: Math.round(Number(body.max_price || 0) * 100), quality: body.quality === 'Any' ? '' : body.quality }),
      });
      setEdit(null);
      refresh();
      notice(
        r.matches.length
          ? `Good news: ${r.matches.length} product${r.matches.length === 1 ? '' : 's'} on Dellvit already match${r.matches.length === 1 ? 'es' : ''}.`
          : 'Saved. We will tell you as soon as a matching product arrives on Dellvit.',
      );
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(w: Wish, status: Wish['status']) {
    setData((list) => list && list.map((x) => (x.id === w.id ? { ...x, status } : x)));
    try {
      await api('/wishes/' + w.id, { method: 'PATCH', body: JSON.stringify({ status }) });
      notice(status === 'open' ? 'We are looking again.' : status === 'found' ? 'Marked as found.' : 'Request closed.');
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  const list = data || [];
  return (
    <div className="stack">
      <section className="card wish-intro">
        <span className="wish-intro-icon">
          <PackageSearch size={26} />
        </span>
        <div>
          <h3>Can’t find something? Tell us what you want.</h3>
          <p className="muted">
            Add pictures, the product name and what matters to you: price, colour, quality, quantity and area. We compare it with
            everything on Dellvit right now and with every new product that arrives, and notify you the moment it is here.
          </p>
        </div>
        <button className="button" onClick={() => start()}>
          <Plus size={16} /> New request
        </button>
      </section>
      {error && <ErrorBox error={error} retry={refresh} />}
      {loading && !data ? (
        <Loading />
      ) : !list.length ? (
        <Empty title="No requests yet" icon={<Search size={26} />}>
          Your requests and the products we find for them appear here.
        </Empty>
      ) : (
        list.map((w) => {
          const st = statusText(w);
          return (
            <article className={'card wish-card' + (w.status === 'closed' ? ' off' : '')} key={w.id}>
              <div className="wish-head">
                {w.images[0] ? <img src={w.images[0]} alt="" className="wish-thumb" /> : <span className="wish-thumb placeholder"><PackageSearch size={20} /></span>}
                <div className="cell-stack">
                  <strong>{w.name}</strong>
                  <small>
                    {[
                      w.max_price ? 'Up to ' + money(w.max_price) : '',
                      w.color,
                      w.quality,
                      w.quantity > 1 ? `${w.quantity} pieces` : '',
                      locations.find((l) => l.id === w.location_id)?.name || 'Any area',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <small className="muted">Asked {date(w.created_at)}</small>
                </div>
                <Badge tone={st.tone}>{st.text}</Badge>
              </div>
              {w.description && <p className="wish-desc">{w.description}</p>}
              {w.matches.length > 0 ? (
                <>
                  <h4 className="wish-sub">
                    <Sparkles size={14} /> Your desired products on Dellvit
                  </h4>
                  <MatchList matches={w.matches} />
                </>
              ) : (
                w.status === 'open' && (
                  <p className="muted small">
                    <Bell size={13} /> Nothing yet. You will get a notification when it arrives.
                  </p>
                )
              )}
              <div className="wish-actions">
                <button className="button ghost small" onClick={() => start(w)}>
                  <Edit3 size={14} /> Edit
                </button>
                {w.status === 'open' ? (
                  <>
                    {w.matches.length > 0 && (
                      <button className="button ghost small" onClick={() => setStatus(w, 'found')}>
                        <CircleCheck size={14} /> I found it
                      </button>
                    )}
                    <button className="button ghost small" onClick={() => setStatus(w, 'closed')}>
                      <X size={14} /> Stop looking
                    </button>
                  </>
                ) : (
                  <button className="button ghost small" onClick={() => setStatus(w, 'open')}>
                    <RotateCcw size={14} /> Look again
                  </button>
                )}
                <button className="button danger-ghost small" onClick={() => setRemove(w)}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </article>
          );
        })
      )}
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={edit?.id ? 'Edit request' : 'Find my product'} size="lg">
        {edit && (
          <form className="stack" onSubmit={save}>
            <div className="field">
              <span className="field-label">Pictures of the product (up to 6)</span>
              <WishPictures value={edit.images} onChange={(v) => set('images', v)} />
            </div>
            <div className="form-grid">
              <label className="span-2">
                Product name
                <input required minLength={2} maxLength={150} value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Samsung Galaxy A15, red sneakers size 42" />
              </label>
              <label className="span-2">
                Description
                <textarea rows={3} maxLength={2000} value={edit.description} onChange={(e) => set('description', e.target.value)} placeholder="Model, size, brand or anything that helps us find it" />
              </label>
              <h4 className="span-2 form-section">Key features</h4>
              <label>
                Most you want to pay (PKR) <span className="muted">(optional)</span>
                <input type="number" min={0} step="1" value={edit.max_price} onChange={(e) => set('max_price', e.target.value)} placeholder="Any price" />
              </label>
              <label>
                Colour <span className="muted">(optional)</span>
                <input maxLength={60} value={edit.color} onChange={(e) => set('color', e.target.value)} />
              </label>
              <label>
                Quality
                <select value={edit.quality || 'Any'} onChange={(e) => set('quality', e.target.value)}>
                  {[...new Set([...qualities, edit.quality || 'Any'])].map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input type="number" min={1} max={100000} required value={edit.quantity} onChange={(e) => set('quantity', Number(e.target.value))} />
              </label>
              <label className="span-2">
                Location
                <select value={edit.location_id || ''} onChange={(e) => set('location_id', e.target.value || null)}>
                  <option value="">Any area (Nation Wide)</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Anything else <span className="muted">(optional)</span>
                <textarea rows={2} maxLength={1000} value={edit.notes} onChange={(e) => set('notes', e.target.value)} />
              </label>
            </div>
            {formError && <ErrorBox error={formError} />}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setEdit(null)} disabled={busy}>
                Cancel
              </button>
              <button className="button" disabled={busy}>
                <Search size={15} /> {busy ? 'Searching…' : edit.id ? 'Save and search again' : 'Find it for me'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete this request?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/wishes/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        “{remove?.name}” will be removed and you will not be told about new matches.
      </Confirm>
    </div>
  );
}

/** What customers are looking for, so the team can find suppliers and sell to them directly. */
export function WishesManager() {
  const { notice, locations } = useApp();
  const { data, setData, error, loading, refresh } = useData<{ wishes: Wish[]; top: { word: string; count: number }[] }>('/admin/wishes', 60000);
  const { data: products } = useData<Product[]>('/manage/products');
  const [view, setView] = useState<Wish | null>(null);
  const [suggest, setSuggest] = useState('');
  const [remove, setRemove] = useState<Wish | null>(null);
  const [busy, setBusy] = useState(false);
  const list = data?.wishes || [];
  const statsBusy = loading && !data;
  async function setStatus(w: Wish, status: Wish['status']) {
    setData((d) => d && { ...d, wishes: d.wishes.map((x) => (x.id === w.id ? { ...x, status } : x)) });
    try {
      await api('/admin/wishes/' + w.id, { method: 'PATCH', body: JSON.stringify({ status }) });
      notice(status === 'closed' ? 'Request closed.' : 'Request reopened.');
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  async function send() {
    if (!view || !suggest) return;
    setBusy(true);
    try {
      await api('/admin/wishes/' + view.id + '/suggest', { method: 'POST', body: JSON.stringify({ product_id: suggest }) });
      notice('Sent. The customer has been notified.');
      setSuggest('');
      setView(null);
      refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="stats">
        <Stat icon={<PackageSearch size={20} />} label="Requests" value={list.length} hint={`${list.filter((w) => w.status === 'open').length} still looking`} tone="blue" loading={statsBusy} />
        <Stat
          icon={<Sparkles size={20} />}
          label="Matched"
          value={list.filter((w) => w.matches.length).length}
          hint="Found products on Dellvit"
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<Search size={20} />}
          label="Not on Dellvit yet"
          value={list.filter((w) => w.status === 'open' && !w.matches.length).length}
          hint="Chances for new products"
          tone="orange"
          loading={statsBusy}
        />
        <Stat icon={<Users size={20} />} label="Customers" value={new Set(list.map((w) => w.customer_email)).size} hint="Who asked" tone="purple" loading={statsBusy} />
      </div>
      {!!data?.top.length && (
        <section className="card">
          <div className="card-head">
            <h3>What people look for most</h3>
          </div>
          <div className="chip-list wish-top">
            {data.top.map((t) => (
              <span key={t.word} className="chip">
                {t.word} <b>{t.count}</b>
              </span>
            ))}
          </div>
        </section>
      )}
      <DataTable
        rows={data ? list : null}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(w) => w.id}
        onRowClick={(w) => setView(w)}
        search={(w) => `${w.name} ${w.description} ${w.color} ${w.customer_name} ${w.customer_email} ${w.customer_phone}`}
        searchPlaceholder="Search requests or customers"
        empty="No customer has asked for a product yet."
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'waiting', label: 'Not found yet' },
              { value: 'matched', label: 'Matched' },
              { value: 'found', label: 'Found by customer' },
              { value: 'closed', label: 'Closed' },
            ],
            test: (w, v) =>
              v === 'waiting'
                ? w.status === 'open' && !w.matches.length
                : v === 'matched'
                  ? w.status === 'open' && !!w.matches.length
                  : w.status === v,
          },
          {
            key: 'area',
            label: 'Areas',
            options: locations.map((l) => ({ value: l.id, label: l.name })),
            test: (w, v) => w.location_id === v,
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Wanted',
            sort: (w) => w.name.toLowerCase(),
            render: (w) => (
              <div className="cell-main">
                {w.images[0] ? <img className="cell-thumb" src={w.images[0]} alt="" /> : <span className="cell-thumb placeholder" />}
                <span className="cell-stack">
                  <strong>{w.name}</strong>
                  <small>
                    {[w.max_price ? 'Up to ' + money(w.max_price) : '', w.color, w.quality, w.quantity > 1 ? `× ${w.quantity}` : '']
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </small>
                </span>
              </div>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            render: (w) => (
              <span className="cell-stack">
                <span>{w.customer_name}</span>
                <small>{w.customer_phone || w.customer_email}</small>
              </span>
            ),
          },
          { key: 'area', header: 'Area', render: (w) => w.area_name || 'Any' },
          { key: 'matches', header: 'Matches', sort: (w) => w.matches.length, render: (w) => w.matches.length || <span className="muted">None</span> },
          {
            key: 'status',
            header: 'Status',
            render: (w) => <Badge tone={statusText(w).tone}>{statusText(w).text}</Badge>,
          },
          { key: 'at', header: 'Asked', sort: (w) => w.created_at, render: (w) => date(w.created_at) },
        ]}
        actions={(w) => (
          <>
            <IconAction label="Suggest a product" onClick={() => setView(w)}>
              <Send size={16} />
            </IconAction>
            {w.status === 'closed' ? (
              <IconAction label="Reopen" onClick={() => setStatus(w, 'open')}>
                <RotateCcw size={16} />
              </IconAction>
            ) : (
              <IconAction label="Close" onClick={() => setStatus(w, 'closed')}>
                <Check size={16} />
              </IconAction>
            )}
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(w)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!view} onClose={() => setView(null)} title={view?.name || ''} size="lg">
        {view && (
          <div className="stack">
            {!!view.images.length && (
              <div className="wish-gallery">
                {view.images.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    <img src={u} alt="" />
                  </a>
                ))}
              </div>
            )}
            {view.description && <p>{view.description}</p>}
            <div className="meta-grid">
              <span>
                <small className="muted">Budget</small> {view.max_price ? 'Up to ' + money(view.max_price) : 'Any'}
              </span>
              <span>
                <small className="muted">Colour</small> {view.color || 'Any'}
              </span>
              <span>
                <small className="muted">Quality</small> {view.quality || 'Any'}
              </span>
              <span>
                <small className="muted">Quantity</small> {view.quantity}
              </span>
              <span>
                <small className="muted">Area</small> {view.area_name || 'Any'}
              </span>
              <span>
                <small className="muted">Customer</small> {view.customer_name} · {view.customer_phone} · {view.customer_email}
              </span>
            </div>
            {view.notes && <p className="muted">{view.notes}</p>}
            {view.matches.length > 0 && (
              <>
                <h4 className="form-section">Matched products</h4>
                <MatchList matches={view.matches} />
              </>
            )}
            <h4 className="form-section">Suggest a product to this customer</h4>
            <div className="suggest-row">
              <select value={suggest} onChange={(e) => setSuggest(e.target.value)}>
                <option value="">Choose a listed product…</option>
                {(products || [])
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.outlet_name} · {money(p.effective_price)}
                    </option>
                  ))}
              </select>
              <button className="button" onClick={send} disabled={!suggest || busy}>
                <Send size={15} /> Notify customer
              </button>
            </div>
            <small className="muted">The customer gets a notification with a link to the product.</small>
          </div>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete this request?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/wishes/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        The customer’s request “{remove?.name}” will be removed permanently.
      </Confirm>
    </div>
  );
}
