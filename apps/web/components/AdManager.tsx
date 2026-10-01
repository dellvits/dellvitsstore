'use client';
import { useState, type FormEvent } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  Copy,
  Edit3,
  Eye,
  Image as ImageIcon,
  LayoutGrid,
  MapPin,
  Megaphone,
  Minus,
  Monitor,
  MousePointerClick,
  Percent,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { api, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useRange } from '@/lib/range';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, ErrorBox, FilterBar, IconAction, Modal, Stat, Toggle } from './UI';
import { ImageField, localDate } from './Platform';
import { deviceLabels, forArea, themes } from './ContentBlocks';
import { AdUnit, adFormats, adPlacements, type AdFormat, type AdItem, type AdPlacement } from './Ads';

type Ad = AdItem & {
  name: string;
  advertiser: string;
  notes: string;
  max_views: number;
  active: boolean;
  /** All-time counts, and the same for the period chosen at the top of the page. */
  views: number;
  clicks: number;
  views_range: number;
  clicks_range: number;
};
type Report = { ads: Ad[]; days: { day: string; views: number; clicks: number }[] };
type Site = { settings: Record<string, any> | null; categories?: { id: string; name: string }[] };

const formatIcons: Record<AdFormat, typeof Megaphone> = {
  banner: RectangleHorizontal,
  cover: ImageIcon,
  strip: Minus,
  card: LayoutGrid,
  image: Camera,
};
const placementKeys = Object.keys(adPlacements) as AdPlacement[];
const placeText = (p: AdPlacement) => `${adPlacements[p].page.replace(' page', '')} · ${adPlacements[p].title}`;
const blank = (placements: AdPlacement[] = ['bottom']): Ad => ({
  id: crypto.randomUUID(),
  name: '',
  advertiser: '',
  label: 'Sponsored',
  title: '',
  description: '',
  link: '/search',
  button: 'Explore now',
  image: '',
  format: 'banner',
  theme: 'brand',
  placements,
  devices: 'all',
  location_ids: [],
  starts_at: '',
  ends_at: '',
  max_views: 0,
  notes: '',
  position: 0,
  active: true,
  views: 0,
  clicks: 0,
  views_range: 0,
  clicks_range: 0,
});
const number = (n: number) => (n || 0).toLocaleString('en-PK');
/** Clicks per hundred views, e.g. "3.2%". */
const rate = (clicks: number, views: number) => (views ? ((clicks / views) * 100).toFixed(clicks * 10 < views ? 2 : 1) + '%' : '—');

/** Whether an ad is being shown right now, and if not, why. */
function status(a: Ad): { key: string; text: string; tone: string; note?: string } {
  const now = new Date().toISOString();
  if (!a.active) return { key: 'off', text: 'Paused', tone: 'neutral' };
  if (a.starts_at && a.starts_at > now) return { key: 'scheduled', text: 'Scheduled', tone: 'info', note: 'Starts ' + date(a.starts_at) };
  if (a.ends_at && a.ends_at <= now) return { key: 'expired', text: 'Ended', tone: 'danger', note: 'Ended ' + date(a.ends_at) };
  if (a.max_views > 0 && a.views >= a.max_views)
    return { key: 'done', text: 'Limit reached', tone: 'warn', note: number(a.max_views) + ' views delivered' };
  return {
    key: 'live',
    text: 'Live',
    tone: 'success',
    note: a.ends_at
      ? 'Until ' + date(a.ends_at)
      : a.max_views > 0
        ? `${number(a.views)} of ${number(a.max_views)} views`
        : undefined,
  };
}

export function AdManager() {
  const { notice, locations } = useApp();
  const { range, setRange, query, key, label: rangeText } = useRange('30d');
  const { data, setData, error, loading, refresh } = useData<Report>('/admin/ads' + query, 60000, 'ads:' + key);
  // Advertising has a master switch in Store settings; categories suggest links.
  const { data: site } = useData<Site>('/site');
  const [areaId, setAreaId] = useState('');
  const [edit, setEdit] = useState<Ad | null>(null);
  const [remove, setRemove] = useState<Ad | null>(null);
  const [reset, setReset] = useState<Ad | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const all = data?.ads || [];
  // Ads a customer in the chosen area could see: those aimed at it and those shown everywhere.
  const list = areaId ? all.filter((a) => forArea(a, areaId)) : all;
  const isNew = !!edit && !all.some((a) => a.id === edit.id);
  const set = <K extends keyof Ad>(k: K, v: Ad[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const start = (a: Ad) => {
    setFormError('');
    setEdit({ ...blank(), ...a });
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      const { id, views, clicks, views_range, clicks_range, ...body } = edit;
      await api('/admin/records/ads/' + id, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null);
      refresh();
      notice(isNew ? 'Ad created.' : 'Ad saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips the switch at once and saves just that; the list reloads only if the save fails. */
  async function setActive(a: Ad, v: boolean) {
    setData((d) => d && { ...d, ads: d.ads.map((x) => (x.id === a.id ? { ...x, active: v } : x)) });
    try {
      await api('/admin/records/ads/' + a.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
      notice(v ? 'Ad switched on.' : 'Ad paused.');
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  const statsBusy = loading && !data;
  const live = list.filter((a) => status(a).key === 'live');
  const count = (k: string) => list.filter((a) => status(a).key === k).length;
  const views = list.reduce((n, a) => n + a.views_range, 0);
  const clicks = list.reduce((n, a) => n + a.clicks_range, 0);
  const best = [...list].filter((a) => a.views_range >= 20).sort((a, b) => b.clicks_range / b.views_range - a.clicks_range / a.views_range)[0];
  const days = data?.days || [];
  const peak = Math.max(1, ...days.map((d) => d.views));
  const needsPicture = !!edit && (edit.format === 'image' || edit.format === 'cover');
  return (
    <div className="stack">
      {site?.settings?.show_ad === false && (
        <div className="alert warn">
          <Megaphone size={16} /> Advertising is switched off, so customers see no ads.{' '}
          <a href="/admin?tab=settings">Switch it on in Store settings.</a>
        </div>
      )}
      <FilterBar
        title="Advertising"
        hint={`Views and clicks for ${rangeText.toLowerCase()}${areaId ? ' · ads shown in ' + (locations.find((l) => l.id === areaId)?.name || 'this area') : ''}`}
        range={range}
        onRange={setRange}
      >
        <div className="select-wrap">
          <MapPin size={15} className="select-lead" />
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Delivery area">
            <option value="">All delivery areas</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </div>
      </FilterBar>
      <div className="stats">
        <Stat
          icon={<Megaphone size={20} />}
          label="Live ads"
          value={live.length}
          hint={`${list.length} in total · ${count('scheduled')} scheduled · ${count('off')} paused`}
          tone="green"
          loading={statsBusy}
        />
        <Stat icon={<Eye size={20} />} label="Views" value={number(views)} hint="Times an ad was seen" tone="blue" loading={statsBusy} />
        <Stat
          icon={<MousePointerClick size={20} />}
          label="Clicks"
          value={number(clicks)}
          hint="Times an ad was opened"
          tone="purple"
          loading={statsBusy}
        />
        <Stat
          icon={<Percent size={20} />}
          label="Click rate"
          value={rate(clicks, views)}
          hint={best ? `Best: ${best.name} (${rate(best.clicks_range, best.views_range)})` : 'Clicks per hundred views'}
          tone="orange"
          quiet={!views}
          loading={statsBusy}
        />
      </div>
      <div className="ad-overview">
        <section className="card">
          <div className="card-head">
            <h3>Where ads appear</h3>
            <small className="muted">Live ads in each place</small>
          </div>
          <div className="ad-places">
            {placementKeys.map((p) => {
              const here = live.filter((a) => a.placements?.includes(p));
              return (
                <div className={'ad-place' + (here.length ? ' filled' : '')} key={p}>
                  <small>{adPlacements[p].page}</small>
                  <strong>{adPlacements[p].title}</strong>
                  <span className="ad-place-foot">
                    <Badge tone={here.length ? 'success' : 'neutral'}>{here.length ? `${here.length} live` : 'Empty'}</Badge>
                    <button type="button" className="link" onClick={() => start(blank([p]))}>
                      <Plus size={13} /> Add ad
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h3>Daily views</h3>
            <small className="muted">All ads · darker part is clicks</small>
          </div>
          {days.length ? (
            <>
              <div className="ad-chart" role="img" aria-label={`Views per day, ${rangeText.toLowerCase()}`}>
                {days.map((d) => (
                  <i
                    key={d.day}
                    style={{ height: Math.max(3, (d.views / peak) * 100) + '%' }}
                    title={`${d.day}: ${number(d.views)} views, ${number(d.clicks)} clicks`}
                  >
                    <b style={{ height: (d.views ? Math.min(1, d.clicks / d.views) : 0) * 100 + '%' }} />
                  </i>
                ))}
              </div>
              <div className="ad-chart-foot">
                <small>{days[0].day}</small>
                <small>{days.at(-1)!.day}</small>
              </div>
            </>
          ) : (
            <p className="muted ad-chart-empty">{statsBusy ? 'Loading…' : 'No views were recorded in this period.'}</p>
          )}
        </section>
      </div>
      <DataTable
        rows={data ? list : undefined}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(a) => a.id}
        onRowClick={(a) => start(a)}
        search={(a) => `${a.name} ${a.title} ${a.advertiser} ${a.label}`}
        searchPlaceholder="Search ads or advertisers"
        empty={areaId ? 'No ads are shown in this area yet.' : 'No ads yet. Create your first one.'}
        toolbar={
          <button className="button" onClick={() => start(blank())}>
            <Plus size={16} /> New ad
          </button>
        }
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'live', label: 'Live' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'expired', label: 'Ended' },
              { value: 'done', label: 'Limit reached' },
              { value: 'off', label: 'Paused' },
            ],
            test: (a, v) => status(a).key === v,
          },
          {
            key: 'place',
            label: 'Places',
            options: placementKeys.map((p) => ({ value: p, label: placeText(p) })),
            test: (a, v) => !!a.placements?.includes(v as AdPlacement),
          },
          {
            key: 'format',
            label: 'Designs',
            options: Object.entries(adFormats).map(([value, f]) => ({ value, label: f.title })),
            test: (a, v) => (a.format || 'banner') === v,
          },
          {
            key: 'audience',
            label: 'Audiences',
            options: [
              { value: 'everywhere', label: 'Every area' },
              { value: 'areas', label: 'Selected areas' },
              { value: 'desktop', label: 'Desktop only' },
              { value: 'mobile', label: 'Mobile only' },
            ],
            test: (a, v) =>
              v === 'everywhere' ? !a.location_ids?.length : v === 'areas' ? !!a.location_ids?.length : a.devices === v,
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Ad',
            sort: (a) => a.name.toLowerCase(),
            render: (a) => {
              const Icon = formatIcons[a.format || 'banner'];
              return (
                <div className="cell-main">
                  {a.image ? (
                    <img className="cell-thumb" src={a.image} alt="" />
                  ) : (
                    <span className="n-icon order">
                      <Icon size={15} />
                    </span>
                  )}
                  <span className="cell-stack">
                    <strong>{a.name}</strong>
                    <small>
                      {adFormats[a.format || 'banner'].title}
                      {a.advertiser && ' · ' + a.advertiser}
                    </small>
                  </span>
                </div>
              );
            },
          },
          {
            key: 'where',
            header: 'Shown on',
            sort: (a) => a.position,
            render: (a) => (
              <span className="cell-stack">
                <span>
                  {a.placements?.length === 1
                    ? adPlacements[a.placements[0]].page
                    : `${a.placements?.length || 0} places`}
                </span>
                <small>
                  {a.placements?.length === 1
                    ? adPlacements[a.placements[0]].title
                    : [...new Set((a.placements || []).map((p) => adPlacements[p].page))].join(', ')}
                </small>
              </span>
            ),
          },
          {
            key: 'audience',
            header: 'Shown to',
            render: (a) => (
              <span className="cell-stack">
                <span>
                  {a.location_ids?.length
                    ? a.location_ids.length === 1
                      ? locations.find((l) => l.id === a.location_ids[0])?.name || '1 area'
                      : `${a.location_ids.length} areas`
                    : 'All areas'}
                </span>
                <small>{deviceLabels[a.devices || 'all']}</small>
              </span>
            ),
          },
          {
            key: 'views',
            header: 'Views',
            sort: (a) => a.views_range,
            render: (a) => (
              <span className="cell-stack">
                <span>{number(a.views_range)}</span>
                <small>{number(a.views)} all time</small>
              </span>
            ),
          },
          {
            key: 'clicks',
            header: 'Clicks',
            sort: (a) => a.clicks_range,
            render: (a) => (
              <span className="cell-stack">
                <span>{number(a.clicks_range)}</span>
                <small>{rate(a.clicks_range, a.views_range)} click rate</small>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (a) => {
              const s = status(a);
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
            header: 'On',
            render: (a) => <Toggle checked={!!a.active} onChange={(v) => setActive(a, v)} />,
          },
        ]}
        actions={(a) => (
          <>
            <IconAction label="Edit" onClick={() => start(a)}>
              <Edit3 size={16} />
            </IconAction>
            <IconAction
              label="Duplicate"
              onClick={() =>
                start({ ...a, ...{ views: 0, clicks: 0, views_range: 0, clicks_range: 0 }, id: crypto.randomUUID(), name: a.name + ' (copy)', active: false })
              }
            >
              <Copy size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(a)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={isNew ? 'New ad' : 'Edit ad'} size="xl">
        {edit && (
          <form className="content-editor" onSubmit={save}>
            <div className="stack">
              <div className="form-grid">
                <h4 className="span-2 form-section">Campaign</h4>
                <label>
                  Campaign name
                  <input required maxLength={200} value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Eid offers, Saddar" />
                  <small>Only you see this name.</small>
                </label>
                <label>
                  Advertiser <span className="muted">(optional)</span>
                  <input maxLength={120} value={edit.advertiser} onChange={(e) => set('advertiser', e.target.value)} placeholder="Who the ad is for" />
                </label>
              </div>
              <div className="field">
                <span className="field-label">Design</span>
                <div className="type-grid">
                  {(Object.keys(adFormats) as AdFormat[]).map((f) => {
                    const Icon = formatIcons[f];
                    return (
                      <button type="button" key={f} className={'type-card' + (edit.format === f ? ' selected' : '')} onClick={() => set('format', f)}>
                        <Icon size={20} />
                        <strong>{adFormats[f].title}</strong>
                        <small>{adFormats[f].hint}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="form-grid">
                {edit.format !== 'cover' && edit.format !== 'image' && (
                  <div className="field span-2">
                    <span className="field-label">Colour</span>
                    <div className="choice-row">
                      {(Object.keys(themes) as (keyof typeof themes)[]).map((t) => (
                        <button
                          type="button"
                          key={t}
                          className={'choice swatch theme-' + t + (edit.theme === t ? ' selected' : '')}
                          onClick={() => set('theme', t)}
                        >
                          <i aria-hidden>{edit.theme === t && <Check size={12} strokeWidth={3} />}</i>
                          {themes[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <h4 className="span-2 form-section">Content</h4>
                <label className="span-2">
                  Headline {edit.format === 'image' && <span className="muted">(optional, read aloud by screen readers)</span>}
                  <input required={edit.format !== 'image'} maxLength={120} value={edit.title} onChange={(e) => set('title', e.target.value)} />
                </label>
                {edit.format !== 'image' && edit.format !== 'strip' && (
                  <label className="span-2">
                    Text <span className="muted">(optional)</span>
                    <textarea rows={2} maxLength={300} value={edit.description} onChange={(e) => set('description', e.target.value)} />
                  </label>
                )}
                <label>
                  Small label <span className="muted">(optional)</span>
                  <input maxLength={40} value={edit.label} onChange={(e) => set('label', e.target.value)} placeholder="Sponsored" />
                </label>
                {edit.format !== 'image' && (
                  <label>
                    Button text
                    <input maxLength={40} value={edit.button} onChange={(e) => set('button', e.target.value)} placeholder="Explore now" />
                  </label>
                )}
                <label className="span-2">
                  Opens
                  <input
                    list="ad-links"
                    maxLength={500}
                    value={edit.link}
                    pattern="(/([^/].*)?|https://\S+)"
                    title="A page on this site such as /search, or a full https:// address"
                    onChange={(e) => set('link', e.target.value.trim())}
                    placeholder="/search or https://partner-site.com"
                  />
                  <datalist id="ad-links">
                    <option value="/search">All products</option>
                    <option value="/outlets">All outlets</option>
                    {(site?.categories || []).map((c) => (
                      <option key={c.id} value={'/search?category=' + encodeURIComponent(c.name)}>
                        {c.name}
                      </option>
                    ))}
                  </datalist>
                  <small>A page on this site, or another website (opens in a new tab). Leave empty for an ad that cannot be clicked.</small>
                </label>
                <div className="field span-2">
                  <span className="field-label">
                    Picture {!needsPicture && <span className="muted">(optional)</span>}
                  </span>
                  <ImageField value={edit.image} onChange={(v) => set('image', v)} />
                  {needsPicture && !edit.image && <small className="muted">This design needs a picture.</small>}
                </div>

                <h4 className="span-2 form-section">Where it appears</h4>
                <div className="field span-2">
                  <div className="choice-row">
                    {placementKeys.map((p) => {
                      const on = edit.placements.includes(p);
                      return (
                        <button
                          type="button"
                          key={p}
                          className={'choice' + (on ? ' selected' : '')}
                          aria-pressed={on}
                          onClick={() => set('placements', on ? edit.placements.filter((x) => x !== p) : [...edit.placements, p])}
                        >
                          {on && <Check size={13} strokeWidth={3} />} {placeText(p)}
                        </button>
                      );
                    })}
                  </div>
                  <small className="muted">
                    {edit.placements.length
                      ? 'Choose one place or several. Several wide ads in one place take turns; cards sit side by side.'
                      : 'Choose at least one place.'}
                  </small>
                </div>
                <label>
                  Priority
                  <input type="number" min={0} max={999} value={edit.position} onChange={(e) => set('position', Number(e.target.value))} />
                  <small>Lower numbers are shown first in a place.</small>
                </label>

                <h4 className="span-2 form-section">Who sees it</h4>
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
                      ? 'Only customers who chose one of the selected areas see this ad.'
                      : 'None selected: the ad is shown in every area.'}
                  </small>
                </div>
                <div className="field span-2">
                  <span className="field-label">Devices</span>
                  <div className="segmented">
                    {(Object.keys(deviceLabels) as (keyof typeof deviceLabels)[]).map((d) => (
                      <button type="button" key={d} className={edit.devices === d ? 'selected' : ''} onClick={() => set('devices', d)}>
                        {deviceLabels[d]}
                      </button>
                    ))}
                  </div>
                </div>

                <h4 className="span-2 form-section">Schedule and limit</h4>
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
                  Stop after this many views
                  <input
                    type="number"
                    min={0}
                    max={1000000000}
                    value={edit.max_views || ''}
                    onChange={(e) => set('max_views', Number(e.target.value) || 0)}
                    placeholder="No limit"
                  />
                  <small>Leave empty to keep the ad running.</small>
                </label>
                <label className="span-2">
                  Private notes <span className="muted">(optional)</span>
                  <textarea rows={2} maxLength={1000} value={edit.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Price agreed, contact person, invoice number…" />
                </label>
              </div>
              <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Switched on" />
              {formError && <ErrorBox error={formError} />}
              <div className="form-foot">
                <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                  Cancel
                </button>
                <button className="button" disabled={busy || !edit.placements.length || (needsPicture && !edit.image)}>
                  {busy ? 'Saving…' : isNew ? 'Create ad' : 'Save ad'}
                </button>
              </div>
            </div>
            <aside className="content-preview">
              <div className="content-preview-head">
                <strong>Live preview</strong>
                <div className="segmented">
                  <button type="button" className={device === 'desktop' ? 'selected' : ''} onClick={() => setDevice('desktop')}>
                    <Monitor size={14} /> Desktop
                  </button>
                  <button type="button" className={device === 'mobile' ? 'selected' : ''} onClick={() => setDevice('mobile')}>
                    <Smartphone size={14} /> Mobile
                  </button>
                </div>
              </div>
              <div className={'content-stage ' + device}>
                <div className={'ad-slot preview' + (edit.format === 'card' ? ' narrow' : '')}>
                  <AdUnit ad={edit} preview />
                </div>
              </div>
              <small className="muted">
                {edit.devices !== 'all' && device !== edit.devices
                  ? `This ad is set to ${label(edit.devices)} only, so it will not appear on ${device}.`
                  : 'The preview updates as you type. It does not open links here.'}
              </small>
              {!isNew && (
                <div className="ad-figures">
                  <span>
                    <strong>{number(edit.views)}</strong>
                    <small>Views, all time</small>
                  </span>
                  <span>
                    <strong>{number(edit.clicks)}</strong>
                    <small>Clicks</small>
                  </span>
                  <span>
                    <strong>{rate(edit.clicks, edit.views)}</strong>
                    <small>Click rate</small>
                  </span>
                  <button type="button" className="link" disabled={!edit.views && !edit.clicks} onClick={() => setReset(edit)}>
                    <RotateCcw size={13} /> Reset counts
                  </button>
                </div>
              )}
            </aside>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!reset}
        title="Reset this ad’s counts?"
        confirm="Reset"
        danger
        busy={busy}
        onClose={() => setReset(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/ads/' + reset!.id + '/stats', { method: 'DELETE' });
            setEdit((e) => (e && e.id === reset!.id ? { ...e, views: 0, clicks: 0, views_range: 0, clicks_range: 0 } : e));
            setReset(null);
            refresh();
            notice('Counts reset.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        The views and clicks recorded for “{reset?.name}” will be erased and cannot be brought back. An ad that stopped at
        its view limit starts showing again.
      </Confirm>
      <Confirm
        open={!!remove}
        title="Delete ad?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/records/ads/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Ad deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        “{remove?.name}” and its view and click counts will be removed permanently. You can pause it instead to keep them.
      </Confirm>
    </div>
  );
}
