'use client';
import { useState, type FormEvent } from 'react';
import { Bike, Copy, Eye, Megaphone, Plus, Send, Smartphone, Store, Undo2, UserRound, Users } from 'lucide-react';
import { ago, api, date } from '@/lib/api';
import { useData } from '@/lib/useData';
import { inRange, useRange } from '@/lib/range';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, ErrorBox, FilterBar, IconAction, Modal, Stat } from './UI';

type Role = 'customer' | 'rider' | 'outlet';
/** An announcement sent from this page, with how far it reached. */
type Broadcast = {
  id: string;
  title: string;
  body: string;
  link: string;
  audience: Role[];
  sent_by_name: string | null;
  recipients: number;
  phones: number;
  browsers: number;
  opened: number;
  created_at: string;
  withdrawn_at: string | null;
};
type Data = {
  items: Broadcast[];
  audience: Record<Role, { people: number; phones: number }>;
  phone_push: boolean;
};
type Draft = { id: string; title: string; body: string; link: string; audience: Role[] };

const roles: { key: Role; title: string; plural: string; icon: typeof Users }[] = [
  { key: 'customer', title: 'Customers', plural: 'customers', icon: UserRound },
  { key: 'rider', title: 'Riders', plural: 'riders', icon: Bike },
  { key: 'outlet', title: 'Outlets', plural: 'outlets', icon: Store },
];
const blank = (): Draft => ({ id: crypto.randomUUID(), title: '', body: '', link: '', audience: ['customer', 'rider', 'outlet'] });
const count = (n: number) => n.toLocaleString('en-PK');
const audienceText = (a: Role[]) =>
  a.length === roles.length ? 'Everyone' : roles.filter((r) => a.includes(r.key)).map((r) => r.title).join(' & ');

/**
 * Announcements: news and updates for customers, riders, outlets or everyone. Each lands in the
 * inbox on the website and in the app, pops up in browsers that allow it, and shows in the
 * notification centre of every phone signed in to the app.
 */
export function BroadcastManager() {
  const { notice } = useApp();
  const { data, error, loading, refresh } = useData<Data>('/admin/broadcasts');
  const { range, setRange, label: rangeText } = useRange('30d');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [withdraw, setWithdraw] = useState<Broadcast | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const list = data?.items || [];
  const inFrame = list.filter((b) => inRange(b.created_at, range));
  const reached = inFrame.reduce((s, b) => s + b.recipients, 0);
  const opened = inFrame.reduce((s, b) => s + (b.withdrawn_at ? 0 : b.opened), 0);
  const delivered = inFrame.filter((b) => !b.withdrawn_at).reduce((s, b) => s + b.recipients, 0);
  const audience = data?.audience;
  const everyone = audience ? roles.reduce((s, r) => s + audience[r.key].people, 0) : 0;
  const withApp = audience ? roles.reduce((s, r) => s + audience[r.key].phones, 0) : 0;
  const people = (d: Draft) => (audience ? d.audience.reduce((s, r) => s + audience[r].people, 0) : 0);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const statsBusy = loading && !data;

  function start(d: Draft) {
    setFormError('');
    setDraft(d);
  }
  function review(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.audience.length) return setFormError('Choose who receives it.');
    setFormError('');
    setConfirm(true);
  }
  async function send() {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api<{ recipients: number }>('/admin/broadcasts', { method: 'POST', body: JSON.stringify(draft) });
      setConfirm(false);
      setDraft(null);
      refresh();
      notice(`Announcement sent to ${count(r.recipients)} ${r.recipients === 1 ? 'person' : 'people'}.`);
    } catch (e) {
      setConfirm(false);
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <FilterBar title="Announcements" hint={`Sent in ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Megaphone size={20} />}
          label="Announcements sent"
          value={inFrame.length}
          hint={`${list.length} in total`}
          tone="red"
          quiet={!inFrame.length}
          loading={statsBusy}
        />
        <Stat
          icon={<Users size={20} />}
          label="Inboxes reached"
          value={count(reached)}
          hint="Each announcement counts every person it went to"
          tone="blue"
          quiet={!reached}
          loading={statsBusy}
        />
        <Stat
          icon={<Eye size={20} />}
          label="Read"
          value={delivered ? Math.round((opened / delivered) * 100) + '%' : '—'}
          hint={delivered ? `${count(opened)} of ${count(delivered)} copies opened` : 'Opened in the inbox or from the pop-up'}
          tone="green"
          quiet={!opened}
          loading={statsBusy}
        />
        <Stat
          icon={<Smartphone size={20} />}
          label="Using the app"
          value={count(withApp)}
          hint={`of ${count(everyone)} customers, riders and outlets`}
          tone="purple"
          loading={statsBusy}
        />
      </div>
      {data && !data.phone_push && (
        <div className="alert warn">
          Phone notifications are not set up on the server (FIREBASE_SERVICE_ACCOUNT), so announcements reach inboxes and
          browsers only.
        </div>
      )}
      <DataTable
        rows={data ? list : data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(b) => b.id}
        search={(b) => `${b.title} ${b.body} ${b.sent_by_name || ''}`}
        searchPlaceholder="Search announcements"
        empty="No announcements yet. Send one to tell people about something new."
        toolbar={
          <button className="button" onClick={() => start(blank())}>
            <Plus size={16} /> New announcement
          </button>
        }
        filters={[
          {
            key: 'audience',
            label: 'Audiences',
            options: roles.map((r) => ({ value: r.key, label: r.title })),
            test: (b, v) => b.audience.includes(v as Role),
          },
          {
            key: 'state',
            label: 'States',
            options: [
              { value: 'sent', label: 'Sent' },
              { value: 'withdrawn', label: 'Withdrawn' },
            ],
            test: (b, v) => (v === 'withdrawn') === !!b.withdrawn_at,
          },
        ]}
        columns={[
          {
            key: 'title',
            header: 'Announcement',
            sort: (b) => b.title.toLowerCase(),
            render: (b) => (
              <div className="cell-main">
                <span className="cell-thumb popup-thumb">
                  <Megaphone size={16} />
                </span>
                <span className="cell-stack bc-text">
                  <strong>{b.title}</strong>
                  {b.body && <small>{b.body}</small>}
                </span>
              </div>
            ),
          },
          {
            key: 'audience',
            header: 'Sent to',
            render: (b) => (
              <span className="cell-stack">
                <span>{audienceText(b.audience)}</span>
                <small>{count(b.recipients)} people</small>
              </span>
            ),
          },
          {
            key: 'reach',
            header: 'Pop-ups',
            render: (b) => (
              <span className="cell-stack">
                <span>{count(b.phones)} phones</span>
                <small>{count(b.browsers)} browsers</small>
              </span>
            ),
          },
          {
            key: 'opened',
            header: 'Read',
            sort: (b) => (b.recipients ? b.opened / b.recipients : 0),
            render: (b) =>
              b.withdrawn_at ? (
                <span className="muted">—</span>
              ) : (
                <span className="cell-stack">
                  <span>{b.recipients ? Math.round((b.opened / b.recipients) * 100) : 0}%</span>
                  <small>{count(b.opened)} opened</small>
                </span>
              ),
          },
          {
            key: 'created_at',
            header: 'Sent',
            sort: (b) => b.created_at,
            render: (b) => (
              <span className="cell-stack">
                <span title={date(b.created_at)}>{ago(b.created_at)}</span>
                <small>{b.withdrawn_at ? <Badge tone="neutral">Withdrawn</Badge> : b.sent_by_name || 'Administrator'}</small>
              </span>
            ),
          },
        ]}
        actions={(b) => (
          <>
            <IconAction
              label="Send again as a new announcement"
              onClick={() => start({ id: crypto.randomUUID(), title: b.title, body: b.body, link: b.link, audience: b.audience })}
            >
              <Copy size={16} />
            </IconAction>
            {!b.withdrawn_at && (
              <IconAction label="Withdraw from inboxes" tone="danger" onClick={() => setWithdraw(b)}>
                <Undo2 size={16} />
              </IconAction>
            )}
          </>
        )}
      />

      <Modal open={!!draft} onClose={() => !busy && setDraft(null)} title="New announcement" size="xl">
        {draft && (
          <form className="popup-editor" onSubmit={review}>
            <div className="stack">
              <div className="form-grid">
                <div className="field span-2">
                  <span className="field-label">
                    Who receives it
                    {draft.audience.length < roles.length && (
                      <button type="button" className="link" onClick={() => set('audience', roles.map((r) => r.key))}>
                        Everyone
                      </button>
                    )}
                  </span>
                  <div className="bc-audience">
                    {roles.map((r) => {
                      const on = draft.audience.includes(r.key);
                      return (
                        <button
                          type="button"
                          key={r.key}
                          className={'bc-target' + (on ? ' selected' : '')}
                          aria-pressed={on}
                          onClick={() =>
                            set('audience', on ? draft.audience.filter((x) => x !== r.key) : roles.map((x) => x.key).filter((x) => x === r.key || draft.audience.includes(x)))
                          }
                        >
                          <r.icon size={20} />
                          <strong>{r.title}</strong>
                          <small>
                            {audience ? `${count(audience[r.key].people)} · ${count(audience[r.key].phones)} with the app` : '…'}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="span-2">
                  Title
                  <input
                    required
                    maxLength={80}
                    value={draft.title}
                    onChange={(e) => set('title', e.target.value)}
                    placeholder="e.g. We now deliver in Bahria Town"
                  />
                  <small className="muted">{80 - draft.title.length} characters left</small>
                </label>
                <label className="span-2">
                  Message <span className="muted">(optional)</span>
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={draft.body}
                    onChange={(e) => set('body', e.target.value)}
                    placeholder="e.g. Order from outlets in Bahria Town from today. Delivery is free this week."
                  />
                  <small className="muted">{500 - draft.body.length} characters left</small>
                </label>
                <label className="span-2">
                  Opens <span className="muted">(optional)</span>
                  <input
                    maxLength={300}
                    value={draft.link}
                    onChange={(e) => set('link', e.target.value)}
                    placeholder="/search, /outlets or https://…"
                  />
                  <small className="muted">
                    A page of the site, such as /search?category=Food. Left empty, tapping it opens the inbox.
                  </small>
                </label>
              </div>
              {formError && <ErrorBox error={formError} />}
              <div className="form-foot">
                <button type="button" className="button ghost" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button className="button" disabled={busy || !draft.audience.length}>
                  <Send size={16} /> Send to {count(people(draft))} {people(draft) === 1 ? 'person' : 'people'}
                </button>
              </div>
            </div>
            <PhonePreview draft={draft} />
          </form>
        )}
      </Modal>
      <Confirm
        open={confirm}
        title="Send this announcement?"
        confirm="Send now"
        busy={busy}
        onClose={() => !busy && setConfirm(false)}
        onConfirm={send}
      >
        {draft && (
          <>
            “{draft.title}” goes to {count(people(draft))} {audienceText(draft.audience).toLowerCase()} at once. You can take it
            out of their inboxes later, but pop-ups already shown on phones stay.
          </>
        )}
      </Confirm>
      <Confirm
        open={!!withdraw}
        title="Withdraw announcement?"
        confirm="Withdraw"
        danger
        busy={busy}
        onClose={() => setWithdraw(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/broadcasts/' + withdraw!.id, { method: 'DELETE' });
            setWithdraw(null);
            refresh();
            notice('Announcement withdrawn from every inbox.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        “{withdraw?.title}” will be removed from {count(withdraw?.recipients || 0)} inboxes on the website and in the app.
        Notifications already shown on phones cannot be taken back.
      </Confirm>
    </div>
  );
}

/** Roughly how it looks in a phone's notification centre. */
function PhonePreview({ draft }: { draft: Draft }) {
  return (
    <aside className="popup-preview" aria-label="Preview">
      <small className="muted">
        <Smartphone size={13} /> On phones
      </small>
      <div className="popup-phone bc-phone">
        <span className="bc-clock">9:41</span>
        <div className="bc-push">
          <div className="bc-push-head">
            <img src="/images/app-logo.webp" alt="" />
            <span>Dellvit · now</span>
          </div>
          <strong>{draft.title || 'Your title'}</strong>
          <p>{draft.body || 'Your message shows here.'}</p>
        </div>
      </div>
      <small className="muted">Also in the inbox on the website and in the app</small>
    </aside>
  );
}
