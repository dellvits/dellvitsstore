'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Copy, Edit3, MapPin, MessageSquareShare, Plus, Search, ShoppingBag, Smartphone, Trash2, X } from 'lucide-react';
import { api, date, money } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Product } from '@/lib/types';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, ErrorBox, IconAction, Modal, Stat, Toggle } from './UI';
import { ImageField, localDate } from './Platform';

/** A pop-up the mobile app shows when it opens, with products to tempt the shopper. */
type Popup = {
  id: string;
  name: string;
  title: string;
  message: string;
  image: string;
  product_ids: string[];
  frequency: 'every_open' | 'daily' | 'once';
  delay: number;
  audience: 'all' | 'guests' | 'customers';
  location_ids: string[];
  starts_at: string;
  ends_at: string;
  active: boolean;
  position: number;
};
const blank = (): Popup => ({
  id: crypto.randomUUID(),
  name: '',
  title: '',
  message: '',
  image: '',
  product_ids: [],
  frequency: 'daily',
  delay: 2,
  audience: 'all',
  location_ids: [],
  starts_at: '',
  ends_at: '',
  active: true,
  position: 0,
});
const frequencies = { every_open: 'Every time the app opens', daily: 'Once a day', once: 'Only once' } as const;
const audiences = { all: 'Everyone', guests: 'Guests only', customers: 'Signed-in customers' } as const;

/** Whether the pop-up shows right now, and if not, why. */
function status(p: Popup) {
  const at = new Date().toISOString();
  if (!p.active) return { key: 'off', text: 'Disabled', tone: 'neutral' };
  if (p.starts_at && p.starts_at > at) return { key: 'scheduled', text: 'Scheduled', tone: 'info', note: 'Starts ' + date(p.starts_at) };
  if (p.ends_at && p.ends_at <= at) return { key: 'ended', text: 'Ended', tone: 'neutral', note: 'Ended ' + date(p.ends_at) };
  return { key: 'live', text: 'Live', tone: 'success', note: p.ends_at ? 'Until ' + date(p.ends_at) : undefined };
}

export function PopupManager() {
  const { notice, locations } = useApp();
  const { data, setData, error, loading, refresh } = useData<Partial<Popup>[]>('/admin/records/popups');
  const { data: products } = useData<Product[]>('/manage/products');
  const [edit, setEdit] = useState<Popup | null>(null);
  const [remove, setRemove] = useState<Popup | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const list = (data || []).map((p) => ({ ...blank(), ...p }) as Popup);
  const isNew = !!edit && !list.some((p) => p.id === edit.id);
  const byId = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);
  const set = <K extends keyof Popup>(k: K, v: Popup[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const areaText = (p: Popup) =>
    !p.location_ids.length
      ? 'Every area'
      : p.location_ids.length === 1
        ? locations.find((l) => l.id === p.location_ids[0])?.name || '1 area'
        : `${p.location_ids.length} areas`;
  function start(p: Popup) {
    setFormError('');
    setEdit(p);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (!edit.product_ids.length) return setFormError('Choose at least one product.');
    setBusy(true);
    setFormError('');
    try {
      const { id, ...body } = edit;
      await api('/admin/records/popups/' + id, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null);
      refresh();
      notice(isNew ? 'Pop-up created.' : 'Pop-up saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips the switch at once and saves just that; the list reloads only if the save fails. */
  async function setActive(p: Popup, v: boolean) {
    setData((rows) => rows && rows.map((x) => (x.id === p.id ? { ...x, active: v } : x)));
    try {
      await api('/admin/records/popups/' + p.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
      notice(v ? 'Pop-up enabled.' : 'Pop-up disabled.');
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  const statsBusy = loading && !data;
  const live = list.filter((p) => status(p).key === 'live');
  return (
    <div className="stack">
      <div className="stats">
        <Stat
          icon={<MessageSquareShare size={20} />}
          label="Live pop-ups"
          value={live.length}
          hint={`${list.length} in total · ${list.filter((p) => status(p).key === 'scheduled').length} scheduled`}
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<ShoppingBag size={20} />}
          label="Products featured"
          value={new Set(live.flatMap((p) => p.product_ids)).size}
          hint="Across live pop-ups"
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<Smartphone size={20} />}
          label="Shown first"
          value={live[0]?.name || '—'}
          hint={live.length > 1 ? 'The first live pop-up for a shopper is shown' : 'The app shows one pop-up at a time'}
          tone="purple"
          loading={statsBusy}
        />
      </div>
      <div className="alert info">
        The Dellvit app shows one pop-up when it opens: the first live one in this list that is meant for the
        shopper and their delivery area. Products that are sold out, disabled or not sold in the shopper’s area are
        left out of it.
      </div>
      <DataTable
        rows={data ? list : data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(p) => p.id}
        search={(p) => `${p.name} ${p.title} ${p.message}`}
        searchPlaceholder="Search pop-ups"
        empty="No app pop-ups yet. Create one to show products when the app opens."
        toolbar={
          <button className="button" onClick={() => start(blank())}>
            <Plus size={16} /> New pop-up
          </button>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'live', label: 'Live' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'ended', label: 'Ended' },
              { value: 'off', label: 'Disabled' },
            ],
            test: (p, v) => status(p).key === v,
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Pop-up',
            sort: (p) => p.name.toLowerCase(),
            render: (p) => (
              <div className="cell-main">
                {p.image ? (
                  <img className="cell-thumb" src={p.image} alt="" />
                ) : (
                  <span className="cell-thumb popup-thumb">
                    <MessageSquareShare size={16} />
                  </span>
                )}
                <span className="cell-stack">
                  <strong>{p.name}</strong>
                  <small>{p.title || 'Picture only'}</small>
                </span>
              </div>
            ),
          },
          {
            key: 'products',
            header: 'Products',
            sort: (p) => p.product_ids.length,
            render: (p) => (
              <span className="cell-stack">
                <span className="popup-faces">
                  {p.product_ids.slice(0, 4).map((id) =>
                    byId.get(id)?.images[0] ? <img key={id} src={byId.get(id)!.images[0]} alt="" /> : null,
                  )}
                </span>
                <small>
                  {p.product_ids.length} product{p.product_ids.length === 1 ? '' : 's'}
                </small>
              </span>
            ),
          },
          {
            key: 'rules',
            header: 'Who and how often',
            render: (p) => (
              <span className="cell-stack">
                <span>{frequencies[p.frequency]}</span>
                <small>
                  {audiences[p.audience]} · {areaText(p)}
                </small>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (p) => {
              const s = status(p);
              return (
                <span className="cell-stack">
                  <Badge tone={s.tone}>{s.text}</Badge>
                  {s.note && <small>{s.note}</small>}
                </span>
              );
            },
          },
          {
            key: 'active',
            header: 'Enabled',
            render: (p) => <Toggle checked={!!p.active} onChange={(v) => setActive(p, v)} />,
          },
        ]}
        actions={(p) => (
          <>
            <IconAction label="Edit" onClick={() => start(p)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction
              label="Duplicate"
              onClick={() => start({ ...p, id: crypto.randomUUID(), name: p.name + ' (copy)', active: false })}
            >
              <Copy size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(p)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={isNew ? 'New app pop-up' : 'Edit app pop-up'} size="xl">
        {edit && (
          <form className="popup-editor" onSubmit={save}>
            <div className="stack">
              <div className="form-grid">
                <label className="span-2">
                  Campaign name
                  <input required maxLength={200} value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Weekend deals" />
                  <small className="muted">Only administrators see this.</small>
                </label>
                <label className="span-2">
                  Headline
                  <input maxLength={80} value={edit.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Picked for you today" />
                </label>
                <label className="span-2">
                  Message <span className="muted">(optional)</span>
                  <textarea rows={2} maxLength={200} value={edit.message} onChange={(e) => set('message', e.target.value)} placeholder="e.g. Fresh deals from outlets near you. Tap a product to add it." />
                </label>
                <div className="field span-2">
                  <span className="field-label">
                    Banner picture <span className="muted">(optional, wide pictures work best)</span>
                  </span>
                  <ImageField value={edit.image} onChange={(v) => set('image', v)} />
                </div>

                <h4 className="span-2 form-section">Products</h4>
                <div className="field span-2">
                  <ProductPicker products={products} value={edit.product_ids} onChange={(ids) => set('product_ids', ids)} />
                </div>

                <h4 className="span-2 form-section">Who sees it and how often</h4>
                <label>
                  Show it
                  <select value={edit.frequency} onChange={(e) => set('frequency', e.target.value as Popup['frequency'])}>
                    {Object.entries(frequencies).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  To
                  <select value={edit.audience} onChange={(e) => set('audience', e.target.value as Popup['audience'])}>
                    {Object.entries(audiences).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Wait before showing <span className="muted">(seconds)</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={edit.delay}
                    onChange={(e) => set('delay', Math.max(0, Math.min(30, Math.round(Number(e.target.value) || 0))))}
                  />
                </label>
                <div className="field span-2">
                  <span className="field-label">
                    Delivery areas
                    {!!edit.location_ids.length && (
                      <button type="button" className="link" onClick={() => set('location_ids', [])}>
                        Show in every area
                      </button>
                    )}
                  </span>
                  <div className="choice-row">
                    {locations.map((l) => {
                      const on = edit.location_ids.includes(l.id);
                      return (
                        <button
                          type="button"
                          key={l.id}
                          className={'choice' + (on ? ' selected' : '')}
                          aria-pressed={on}
                          onClick={() => set('location_ids', on ? edit.location_ids.filter((x) => x !== l.id) : [...edit.location_ids, l.id])}
                        >
                          <MapPin size={13} /> {l.name}
                        </button>
                      );
                    })}
                  </div>
                  <small className="muted">
                    {edit.location_ids.length
                      ? 'Shown only to shoppers who chose one of these areas. Shoppers browsing Nation Wide do not see it.'
                      : 'None selected: shown in every area, and to shoppers browsing Nation Wide.'}
                  </small>
                </div>

                <h4 className="span-2 form-section">Schedule</h4>
                <label>
                  Starts <span className="muted">(optional)</span>
                  <input
                    type="datetime-local"
                    value={edit.starts_at ? localDate(edit.starts_at) : ''}
                    onChange={(e) => set('starts_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                  />
                </label>
                <label>
                  Ends <span className="muted">(optional)</span>
                  <input
                    type="datetime-local"
                    value={edit.ends_at ? localDate(edit.ends_at) : ''}
                    onChange={(e) => set('ends_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                  />
                </label>
                <label>
                  Order in the list
                  <input type="number" min={0} max={999} value={edit.position} onChange={(e) => set('position', Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0))))} />
                  <small className="muted">Lower numbers are checked first.</small>
                </label>
              </div>
              <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Enabled" />
              {formError && <ErrorBox error={formError} />}
              <div className="form-foot">
                <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                  Cancel
                </button>
                <button className="button" disabled={busy}>
                  {busy ? 'Saving…' : isNew ? 'Create pop-up' : 'Save pop-up'}
                </button>
              </div>
            </div>
            <PhonePreview popup={edit} products={edit.product_ids.map((id) => byId.get(id)).filter((p): p is Product => !!p)} />
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete pop-up?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/records/popups/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Pop-up deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {remove?.name} will stop showing in the app at once. Disable it instead to keep it for later.
      </Confirm>
    </div>
  );
}

/** Search the catalogue and pick up to twelve products, in the order they should appear. */
function ProductPicker({
  products,
  value,
  onChange,
}: {
  products: Product[] | null | undefined;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const byId = new Map((products || []).map((p) => [p.id, p]));
  const found = (products || [])
    .filter((p) => p.active && !value.includes(p.id))
    .filter((p) => `${p.name} ${p.outlet_name} ${p.category}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 30);
  const full = value.length >= 12;
  return (
    <div className="popup-picker">
      <div className="popup-chosen">
        {!value.length && <p className="muted small">No products chosen yet. Search below and add up to 12.</p>}
        {value.map((id, i) => {
          const p = byId.get(id);
          return (
            <span key={id} className="popup-chip">
              <b>{i + 1}</b>
              {p?.images[0] && <img src={p.images[0]} alt="" />}
              <span>{p?.name || 'Removed product'}</span>
              <button type="button" aria-label="Remove" onClick={() => onChange(value.filter((x) => x !== id))}>
                <X size={13} />
              </button>
            </span>
          );
        })}
      </div>
      <div className="input-icon">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={full ? 'Twelve products is the most' : 'Search products or outlets'} disabled={full} />
      </div>
      <div className="popup-results">
        {!products ? (
          <p className="muted small">Loading products…</p>
        ) : !found.length ? (
          <p className="muted small">No matching products.</p>
        ) : (
          found.map((p) => (
            <button type="button" key={p.id} disabled={full} onClick={() => onChange([...value, p.id])}>
              {p.images[0] && <img src={p.images[0]} alt="" />}
              <span className="cell-stack">
                <strong>{p.name}</strong>
                <small>
                  {p.outlet_name} · {money(p.effective_price ?? p.price)}
                  {p.stock === 0 ? ' · sold out' : ''}
                </small>
              </span>
              <Plus size={16} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Roughly what shoppers will see in the app. */
function PhonePreview({ popup, products }: { popup: Popup; products: Product[] }) {
  return (
    <aside className="popup-preview" aria-label="Preview">
      <small className="muted">
        <Smartphone size={13} /> In the app
      </small>
      <div className="popup-phone">
        <div className="popup-sheet">
          {popup.image && <img className="popup-banner" src={popup.image} alt="" />}
          <strong>{popup.title || 'Your headline'}</strong>
          {popup.message && <p>{popup.message}</p>}
          <div className="popup-cards">
            {(products.length ? products : [null, null]).slice(0, 4).map((p, i) => (
              <div key={p?.id || i} className="popup-card">
                {p?.images[0] ? <img src={p.images[0]} alt="" /> : <span />}
                <em>{p?.name || 'Product'}</em>
                <b>{p ? money(p.effective_price ?? p.price) : 'PKR —'}</b>
              </div>
            ))}
          </div>
          <span className="popup-cta">Shop now</span>
        </div>
      </div>
      <small className="muted">
        <CalendarClock size={13} /> {frequencies[popup.frequency]}, {popup.delay}s after opening
      </small>
    </aside>
  );
}
