'use client';
import { useState, type FormEvent } from 'react';
import {
  CalendarClock,
  Check,
  Copy,
  Edit3,
  EyeOff,
  Image as ImageIcon,
  Layers,
  LayoutPanelTop,
  MapPin,
  Megaphone,
  Monitor,
  Plus,
  RectangleHorizontal,
  Smartphone,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import { api, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, ErrorBox, IconAction, Modal, Stat, Toggle } from './UI';
import { ImageField, localDate } from './Platform';
import {
  ContentBlock,
  HeroPreview,
  contentTypes,
  deviceLabels,
  layouts,
  placements,
  themes,
  type ContentItem,
  type Placement,
} from './ContentBlocks';

type Item = ContentItem & { active: boolean; position: number };
const typeIcons: Record<Item['type'], typeof Layers> = {
  hero: LayoutPanelTop,
  section: ImageIcon,
  banner: RectangleHorizontal,
  announcement: Megaphone,
  embed: Video,
};
const blank = (type: Item['type'] = 'section', placement: Placement = 'after_outlets'): Item => ({
  id: crypto.randomUUID(),
  name: '',
  type,
  description: '',
  image: '',
  link: '/search',
  button: type === 'hero' ? 'Start shopping' : 'Explore',
  eyebrow: '',
  layout: 'image-right',
  theme: type === 'announcement' ? 'brand' : 'light',
  placement,
  devices: 'all',
  location_ids: [],
  starts_at: '',
  ends_at: '',
  embed_url: '',
  active: true,
  position: 0,
});

/** Whether a block is on the home page right now, and if not, why. */
function status(c: Item, liveHero?: string): { key: string; text: string; tone: string; note?: string } {
  const now = new Date().toISOString();
  if (!c.active) return { key: 'off', text: 'Disabled', tone: 'neutral' };
  if (c.starts_at && c.starts_at > now)
    return { key: 'scheduled', text: 'Scheduled', tone: 'info', note: 'Starts ' + date(c.starts_at) };
  if (c.ends_at && c.ends_at <= now) return { key: 'expired', text: 'Expired', tone: 'danger', note: 'Ended ' + date(c.ends_at) };
  if (c.type === 'hero' && liveHero && liveHero !== c.id && !c.location_ids?.length)
    return { key: 'backup', text: 'Backup', tone: 'warn', note: 'Another hero comes first' };
  return { key: 'live', text: 'Live', tone: 'success', note: c.ends_at ? 'Until ' + date(c.ends_at) : undefined };
}
const whereText = (c: Item) =>
  c.type === 'hero' ? 'Top of the page' : c.type === 'announcement' ? 'Above the hero' : placements[c.placement || 'after_outlets'];

export function ContentManager() {
  const { notice, locations } = useApp();
  const { data, setData, error, loading, refresh } = useData<Item[]>('/admin/records/content');
  // The built-in sections are switched on and off in Store settings; the outline shows their state.
  const { data: site } = useData<{ settings: Record<string, any> | null }>('/site');
  const [edit, setEdit] = useState<Item | null>(null);
  const [remove, setRemove] = useState<Item | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const list = data || [];
  const isNew = !!edit && !list.some((c) => c.id === edit.id);
  const now = new Date().toISOString();
  const inSchedule = (c: Item) => c.active && (!c.starts_at || c.starts_at <= now) && (!c.ends_at || c.ends_at > now);
  // The hero every visitor sees unless one aimed at their area comes before it.
  const liveHero = list.find((c) => c.type === 'hero' && inSchedule(c) && !c.location_ids?.length)?.id;
  const state = (c: Item) => status(c, liveHero);
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const start = (c: Item) => {
    setFormError('');
    setEdit({ ...blank(c.type), ...c });
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setFormError('');
    try {
      const { id, ...body } = edit;
      await api('/admin/records/content/' + id, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null);
      refresh();
      notice(isNew ? 'Block added to the home page.' : 'Block saved.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Flips the switch at once and saves just that; the list reloads only if the save fails. */
  async function setActive(c: Item, v: boolean) {
    setData((rows) => rows && rows.map((x) => (x.id === c.id ? { ...x, active: v } : x)));
    try {
      await api('/admin/records/content/' + c.id, { method: 'PATCH', body: JSON.stringify({ active: v }) });
      notice(v ? 'Block enabled.' : 'Block hidden from the home page.');
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  const statsBusy = loading && !data;
  const count = (key: string) => list.filter((c) => state(c).key === key).length;
  const builtIn = (key: string) => site?.settings?.['show_' + key] !== false;
  const inSlot = (p: Placement) =>
    list.filter((c) => !['hero', 'announcement'].includes(c.type) && (c.placement || 'after_outlets') === p);
  /** One row of the page outline: either a built-in section or a slot for the administrator's blocks. */
  const fixed = (title: string, on: boolean) => (
    <li className={'outline-fixed' + (on ? '' : ' off')}>
      <span>{title}</span>
      <small>{on ? 'Built in' : 'Hidden in Store settings'}</small>
    </li>
  );
  const slotRow = (title: string, blocks: Item[], add: () => void) => (
    <li className="outline-slot">
      <div className="outline-slot-head">
        <small>{title}</small>
        <button type="button" className="link" onClick={add}>
          <Plus size={13} /> Add
        </button>
      </div>
      {blocks.map((c) => {
        const Icon = typeIcons[c.type];
        return (
          <button type="button" key={c.id} className={'outline-block' + (state(c).key === 'live' ? '' : ' off')} onClick={() => start(c)}>
            <Icon size={14} />
            <span>{c.name}</span>
            <Badge tone={state(c).tone}>{state(c).text}</Badge>
          </button>
        );
      })}
    </li>
  );
  const preview = edit && (edit.type === 'hero' ? <HeroPreview item={edit} /> : <ContentBlock item={edit} preview />);
  const hasImage = !!edit && edit.type !== 'announcement' && edit.type !== 'embed' && !(edit.type === 'section' && edit.layout === 'centered');
  return (
    <div className="stack">
      <div className="stats">
        <Stat
          icon={<Layers size={20} />}
          label="Content blocks"
          value={list.length}
          hint={`${list.filter((c) => c.type !== 'hero' && c.type !== 'announcement').length} sections · ${list.filter((c) => c.type === 'hero').length} heroes`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<Sparkles size={20} />}
          label="Live now"
          value={count('live')}
          hint="Showing on the home page"
          tone="green"
          loading={statsBusy}
        />
        <Stat
          icon={<CalendarClock size={20} />}
          label="Scheduled"
          value={count('scheduled')}
          hint="Will appear on their start date"
          tone="purple"
          quiet={!count('scheduled')}
          loading={statsBusy}
        />
        <Stat
          icon={<EyeOff size={20} />}
          label="Not showing"
          value={count('off') + count('expired') + count('backup')}
          hint={`${count('expired')} expired · ${count('off')} disabled`}
          tone="orange"
          quiet={!(count('off') + count('expired') + count('backup'))}
          loading={statsBusy}
        />
      </div>
      <div className="content-builder">
        <aside className="card outline">
          <div className="card-head">
            <h3>Home page layout</h3>
          </div>
          <small className="muted">Top to bottom, as customers see it. Add a block where you want it.</small>
          <ol className="outline-list">
            {slotRow(
              'Announcement bar',
              list.filter((c) => c.type === 'announcement'),
              () => start(blank('announcement')),
            )}
            {slotRow(
              'Hero',
              list.filter((c) => c.type === 'hero'),
              () => start(blank('hero')),
            )}
            {fixed('Benefits bar', builtIn('trust'))}
            {slotRow(placements.top, inSlot('top'), () => start(blank('section', 'top')))}
            {fixed('Good things near you', builtIn('nearby'))}
            {slotRow(placements.after_nearby, inSlot('after_nearby'), () => start(blank('section', 'after_nearby')))}
            {fixed('Category sections', builtIn('category_products'))}
            {slotRow(placements.after_categories, inSlot('after_categories'), () => start(blank('section', 'after_categories')))}
            {fixed('Outlets near you', builtIn('outlets'))}
            {slotRow(placements.after_outlets, inSlot('after_outlets'), () => start(blank('section', 'after_outlets')))}
            {fixed('How it works', builtIn('how'))}
            {slotRow(placements.bottom, inSlot('bottom'), () => start(blank('section', 'bottom')))}
            {fixed('Advertising', builtIn('ad'))}
          </ol>
        </aside>
        <DataTable
          rows={data}
          loading={loading}
          error={error}
          onRetry={refresh}
          rowKey={(c) => c.id}
          onRowClick={(c) => start(c)}
          search={(c) => `${c.name} ${c.description} ${c.eyebrow || ''}`}
          searchPlaceholder="Search content"
          empty="No content yet. Add a hero or a promo section to shape your home page."
          toolbar={
            <button className="button" onClick={() => start(blank())}>
              <Plus size={16} /> Add block
            </button>
          }
          filters={[
            {
              key: 'type',
              label: 'Types',
              options: Object.entries(contentTypes).map(([value, t]) => ({ value, label: t.title })),
              test: (c, v) => c.type === v,
            },
            {
              key: 'status',
              label: 'Statuses',
              options: [
                { value: 'live', label: 'Live' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'expired', label: 'Expired' },
                { value: 'off', label: 'Disabled' },
              ],
              test: (c, v) => state(c).key === v,
            },
            {
              key: 'audience',
              label: 'Audiences',
              options: [
                { value: 'everyone', label: 'Everyone' },
                { value: 'areas', label: 'Selected areas' },
                { value: 'desktop', label: 'Desktop only' },
                { value: 'mobile', label: 'Mobile only' },
              ],
              test: (c, v) =>
                v === 'everyone'
                  ? !c.location_ids?.length && (c.devices || 'all') === 'all'
                  : v === 'areas'
                    ? !!c.location_ids?.length
                    : c.devices === v,
            },
          ]}
          columns={[
            {
              key: 'name',
              header: 'Block',
              sort: (c) => c.name.toLowerCase(),
              render: (c) => {
                const Icon = typeIcons[c.type];
                return (
                  <div className="cell-main">
                    {c.image ? (
                      <img className="cell-thumb" src={c.image} alt="" />
                    ) : (
                      <span className="n-icon order">
                        <Icon size={15} />
                      </span>
                    )}
                    <span className="cell-stack">
                      <strong>{c.name}</strong>
                      <small>
                        {contentTypes[c.type].title}
                        {(c.type === 'section' || c.type === 'embed') && ' · ' + layouts[c.layout || 'image-right']}
                        {c.type !== 'hero' && ' · ' + themes[c.theme || 'light']}
                      </small>
                    </span>
                  </div>
                );
              },
            },
            {
              key: 'where',
              header: 'Position',
              sort: (c) => c.position,
              render: (c) => (
                <span className="cell-stack">
                  <span>{whereText(c)}</span>
                  <small>Order {c.position}</small>
                </span>
              ),
            },
            {
              key: 'audience',
              header: 'Shown to',
              render: (c) => (
                <span className="cell-stack">
                  <span>
                    {c.location_ids?.length
                      ? `${c.location_ids.length} area${c.location_ids.length === 1 ? '' : 's'}`
                      : 'All areas'}
                  </span>
                  <small>{deviceLabels[c.devices || 'all']}</small>
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (c) => {
                const s = state(c);
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
              render: (c) => <Toggle checked={!!c.active} onChange={(v) => setActive(c, v)} />,
            },
          ]}
          actions={(c) => (
            <>
              <IconAction label="Edit" onClick={() => start(c)}>
                <Edit3 size={16} />
              </IconAction>
              <IconAction
                label="Duplicate"
                onClick={() => start({ ...c, id: crypto.randomUUID(), name: c.name + ' (copy)', active: false })}
              >
                <Copy size={16} />
              </IconAction>
              <IconAction label="Delete" tone="danger" onClick={() => setRemove(c)}>
                <Trash2 size={16} />
              </IconAction>
            </>
          )}
        />
      </div>
      <Modal open={!!edit} onClose={() => !busy && setEdit(null)} title={isNew ? 'Add content block' : 'Edit content block'} size="xl">
        {edit && (
          <form className="content-editor" onSubmit={save}>
            <div className="stack">
              <div className="type-grid">
                {(Object.keys(contentTypes) as Item['type'][]).map((t) => {
                  const Icon = typeIcons[t];
                  return (
                    <button
                      type="button"
                      key={t}
                      className={'type-card' + (edit.type === t ? ' selected' : '')}
                      onClick={() =>
                        setEdit({
                          ...edit,
                          type: t,
                          // The button text follows the type until the administrator writes their own.
                          button:
                            edit.button === 'Explore' || edit.button === 'Start shopping'
                              ? t === 'hero'
                                ? 'Start shopping'
                                : 'Explore'
                              : edit.button,
                        })
                      }
                    >
                      <Icon size={20} />
                      <strong>{contentTypes[t].title}</strong>
                      <small>{contentTypes[t].hint}</small>
                    </button>
                  );
                })}
              </div>
              <div className="form-grid">
                <h4 className="span-2 form-section">Content</h4>
                <label className="span-2">
                  {edit.type === 'announcement' ? 'Message' : 'Headline'}
                  <input required maxLength={200} value={edit.name} onChange={(e) => set('name', e.target.value)} />
                </label>
                {edit.type !== 'announcement' && (
                  <label className="span-2">
                    Small label above the headline <span className="muted">(optional)</span>
                    <input
                      maxLength={80}
                      value={edit.eyebrow}
                      onChange={(e) => set('eyebrow', e.target.value)}
                      placeholder={edit.type === 'hero' ? 'Fast local delivery' : 'e.g. New this week'}
                    />
                  </label>
                )}
                <label className="span-2">
                  {edit.type === 'announcement' ? 'More detail' : 'Text'} <span className="muted">(optional)</span>
                  <textarea
                    rows={edit.type === 'announcement' ? 1 : 3}
                    maxLength={2000}
                    value={edit.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                </label>
                {edit.type === 'embed' && (
                  <label className="span-2">
                    Video link
                    <input
                      required
                      type="url"
                      maxLength={300}
                      value={edit.embed_url}
                      onChange={(e) => set('embed_url', e.target.value.trim())}
                      placeholder="https://www.youtube.com/watch?v=…"
                    />
                    <small>YouTube and Vimeo links are supported.</small>
                  </label>
                )}
                <label>
                  Button label
                  <input maxLength={80} value={edit.button} onChange={(e) => set('button', e.target.value)} />
                </label>
                <label>
                  Button link <span className="muted">(a page on this site)</span>
                  <input
                    value={edit.link}
                    pattern="/([^/].*)?"
                    title="A path on this site, such as /search"
                    onChange={(e) => set('link', e.target.value.trim())}
                    placeholder="/search?category=Food"
                  />
                  {edit.type !== 'hero' && <small>Leave empty for no button.</small>}
                </label>
                {hasImage && (
                  <div className="field span-2">
                    <span className="field-label">{edit.type === 'hero' ? 'Hero picture' : 'Picture'}</span>
                    <ImageField value={edit.image} onChange={(v) => set('image', v)} />
                  </div>
                )}

                {edit.type !== 'hero' && (
                  <>
                    <h4 className="span-2 form-section">Design</h4>
                    {(edit.type === 'section' || edit.type === 'embed') && (
                      <div className="field span-2">
                        <span className="field-label">Layout</span>
                        <div className="choice-row">
                          {(Object.keys(layouts) as (keyof typeof layouts)[])
                            .filter((l) => edit.type === 'section' || l === 'image-left' || l === 'image-right')
                            .map((l) => (
                              <button
                                type="button"
                                key={l}
                                className={'choice layout-' + l + ((edit.layout || 'image-right') === l ? ' selected' : '')}
                                onClick={() => set('layout', l)}
                              >
                                <i aria-hidden />
                                {edit.type === 'embed' ? layouts[l].replace('Picture', 'Video') : layouts[l]}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                    <div className="field span-2">
                      <span className="field-label">Colour</span>
                      <div className="choice-row">
                        {(Object.keys(themes) as (keyof typeof themes)[]).map((t) => (
                          <button
                            type="button"
                            key={t}
                            className={'choice swatch theme-' + t + ((edit.theme || 'light') === t ? ' selected' : '')}
                            onClick={() => set('theme', t)}
                          >
                            <i aria-hidden>{(edit.theme || 'light') === t && <Check size={12} strokeWidth={3} />}</i>
                            {themes[t]}
                          </button>
                        ))}
                      </div>
                      {edit.type === 'section' && edit.layout === 'image-background' && (
                        <small className="muted">With a picture behind the text, the text is always white.</small>
                      )}
                    </div>
                  </>
                )}

                <h4 className="span-2 form-section">Position</h4>
                {edit.type === 'hero' || edit.type === 'announcement' ? (
                  <p className="span-2 muted" style={{ margin: 0 }}>
                    {edit.type === 'hero'
                      ? 'The hero is always the top of the page. With several enabled, the first in display order is shown.'
                      : 'Announcements sit above the hero, in display order.'}
                  </p>
                ) : (
                  <label>
                    Place on the page
                    <select value={edit.placement} onChange={(e) => set('placement', e.target.value as Placement)}>
                      {Object.entries(placements).map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Display order
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={edit.position}
                    onChange={(e) => set('position', Number(e.target.value))}
                  />
                  <small>Lower numbers come first within the same place.</small>
                </label>

                <h4 className="span-2 form-section">Who sees it</h4>
                <div className="field span-2">
                  <span className="field-label">Devices</span>
                  <div className="segmented">
                    {(Object.keys(deviceLabels) as (keyof typeof deviceLabels)[]).map((d) => (
                      <button type="button" key={d} className={(edit.devices || 'all') === d ? 'selected' : ''} onClick={() => set('devices', d)}>
                        {deviceLabels[d]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field span-2">
                  <span className="field-label">
                    Delivery areas
                    {!!edit.location_ids?.length && (
                      <button type="button" className="link" onClick={() => set('location_ids', [])}>
                        Show in every area
                      </button>
                    )}
                  </span>
                  <div className="choice-row">
                    {locations.map((l) => {
                      const on = !!edit.location_ids?.includes(l.id);
                      return (
                        <button
                          type="button"
                          key={l.id}
                          className={'choice' + (on ? ' selected' : '')}
                          onClick={() =>
                            set('location_ids', on ? edit.location_ids!.filter((x) => x !== l.id) : [...(edit.location_ids || []), l.id])
                          }
                        >
                          <MapPin size={13} /> {l.name}
                        </button>
                      );
                    })}
                  </div>
                  <small className="muted">
                    {edit.location_ids?.length
                      ? 'Only customers who chose one of the selected areas see this block.'
                      : 'None selected: the block is shown in every area.'}
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
              </div>
              <Toggle checked={!!edit.active} onChange={(v) => set('active', v)} label="Enabled" />
              {formError && <ErrorBox error={formError} />}
              <div className="form-foot">
                <button type="button" className="button ghost" onClick={() => setEdit(null)}>
                  Cancel
                </button>
                <button className="button" disabled={busy}>
                  {busy ? 'Saving…' : isNew ? 'Add to home page' : 'Save block'}
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
              <div className={'content-stage ' + device}>{preview}</div>
              <small className="muted">
                {edit.devices && edit.devices !== 'all' && device !== edit.devices
                  ? `This block is set to ${label(edit.devices)} only, so it will not appear on ${device}.`
                  : 'The preview updates as you type. Buttons do not open links here.'}
              </small>
            </aside>
          </form>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete content block?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/records/content/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            notice('Block deleted.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        “{remove?.name}” will be removed from the home page permanently. You can disable it instead to keep it.
      </Confirm>
    </div>
  );
}
