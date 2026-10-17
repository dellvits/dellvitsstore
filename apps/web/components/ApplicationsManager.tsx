'use client';
import { useState } from 'react';
import { BadgeCheck, Bike, CircleCheck, Clock, FileText, Mail, MapPin, MailWarning, Phone, Send, Store, UserRound } from 'lucide-react';
import { ago, api, date } from '@/lib/api';
import { useData } from '@/lib/useData';
import { inRange, useRange } from '@/lib/range';
import { useApp } from './Provider';
import { Badge, DataTable, ErrorBox, FilterBar, IconAction, Modal, Stat } from './UI';
import { commissionTypes, payoutMethods, vehicleTypes, type Application } from './Partner';

/** A rider's commission as the team sets it when approving; fixed amounts are in rupees here. */
type Commission = { type: 'fixed' | 'percent'; value: string; base: 'delivery_fee' | 'subtotal' | 'total' };
const commissionFor = (type: string): Commission =>
  type === 'percent' ? { type: 'percent', value: '80', base: 'delivery_fee' } : { type: 'fixed', value: '100', base: 'delivery_fee' };

/** An application with the account it belongs to, as administrators see it. */
type Row = Application & {
  user_id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  location_id: string;
  email_verified: boolean;
  active: boolean;
  login_id: string | null;
  registered_at: string;
  reviewed_by_name: string | null;
  created_at: string;
};
/** Where an application stands, including the account's own state (email, blocked). */
type Stage = 'unverified' | 'draft' | 'pending' | 'rejected' | 'approved' | 'blocked';
const stages: Record<Stage, { text: string; tone: string }> = {
  unverified: { text: 'Email not verified', tone: 'neutral' },
  draft: { text: 'Waiting for details', tone: 'info' },
  pending: { text: 'Waiting for review', tone: 'warn' },
  rejected: { text: 'Sent back', tone: 'danger' },
  approved: { text: 'Approved', tone: 'success' },
  blocked: { text: 'Blocked', tone: 'danger' },
};
const stageOf = (a: Row): Stage =>
  a.status === 'approved' ? 'approved' : !a.active ? 'blocked' : !a.email_verified ? 'unverified' : a.status;
const hasDetails = (a: Row) => Object.keys(a.details || {}).length > 0;
// The most urgent first: waiting for review, then the rest by date.
const order: Stage[] = ['pending', 'rejected', 'draft', 'unverified', 'blocked', 'approved'];
const sorted = (rows: Row[]) =>
  [...rows].sort(
    (a, b) =>
      order.indexOf(stageOf(a)) - order.indexOf(stageOf(b)) ||
      (b.submitted_at || b.created_at).localeCompare(a.submitted_at || a.created_at),
  );

/**
 * The review actions shared by the Pending verification page and the Riders and Outlets pages:
 * the details popup with approve and send back, and the status menu.
 */
function useReview(refresh: () => void) {
  const { notice } = useApp();
  const [open, setOpen] = useState<Row | null>(null);
  const [note, setNote] = useState('');
  const [sendBack, setSendBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [commission, setCommission] = useState<Commission>(commissionFor('fixed'));

  function show(a: Row, back = false) {
    setOpen(a);
    setCommission(commissionFor(String(a.details.commission_type || 'fixed')));
    setNote('');
    setSendBack(back);
    setFormError('');
  }
  /** Approving and sending back need the application to wait for review; it is put there first. */
  async function decide(a: Row, approve: boolean, why = '') {
    if (!approve && !why.trim()) return setFormError('Write what the applicant should change.');
    setBusy(true);
    setFormError('');
    try {
      if (a.status !== 'pending' || !a.active || !a.email_verified)
        await api(`/admin/applications/${a.user_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'pending', email_verified: true, active: true }),
        });
      const r = await api<{ login_id?: string }>(`/admin/applications/${a.user_id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify(
          !approve
            ? { note: why.trim() }
            : a.kind === 'rider'
              ? {
                  commission_type: commission.type,
                  // Fixed amounts travel in paisa.
                  commission_value:
                    commission.type === 'fixed' ? Math.round(Number(commission.value) * 100) : Number(commission.value),
                  commission_base: commission.base,
                }
              : {},
        ),
      });
      setOpen(null);
      refresh();
      notice(
        approve
          ? `${a.name} is approved as ${a.kind === 'rider' ? 'a rider' : 'an outlet'} with ID ${r.login_id}. They were emailed.`
          : `The application was sent back to ${a.name}.`,
      );
    } catch (e) {
      setFormError((e as Error).message);
      if (!open) notice((e as Error).message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  /** The status menu: changes take effect at once; approving and sending back open the popup. */
  async function setStage(a: Row, to: Stage) {
    if (to === stageOf(a)) return;
    if (to === 'approved' || to === 'rejected') {
      if (!hasDetails(a)) return notice('They have not sent their details yet.');
      return show(a, to === 'rejected');
    }
    const body =
      to === 'blocked'
        ? { active: false }
        : to === 'unverified'
          ? { email_verified: false, status: 'draft', active: true }
          : { email_verified: true, status: to, active: true };
    try {
      await api(`/admin/applications/${a.user_id}`, { method: 'PATCH', body: JSON.stringify(body) });
      notice(`${a.name}: ${stages[to].text.toLowerCase()}.`);
    } catch (e) {
      notice((e as Error).message);
    }
    refresh();
  }

  const select = (a: Row) => {
    const now = stageOf(a);
    return (
      <span className="select-wrap small" onClick={(e) => e.stopPropagation()}>
        <select
          aria-label={`Status of ${a.name}`}
          value={now}
          disabled={now === 'approved' || busy}
          onChange={(e) => setStage(a, e.target.value as Stage)}
        >
          {(Object.keys(stages) as Stage[])
            .filter((s) => now === 'approved' || s !== 'approved' || hasDetails(a))
            .map((s) => (
              <option key={s} value={s} disabled={(s === 'pending' || s === 'rejected') && !hasDetails(a)}>
                {s === 'approved' && now !== 'approved' ? 'Approve' : s === 'rejected' && now !== 'rejected' ? 'Send back…' : stages[s].text}
              </option>
            ))}
        </select>
      </span>
    );
  };

  const modal = (
    <ReviewModal
      app={open}
      commission={commission}
      setCommission={setCommission}
      note={note}
      setNote={setNote}
      sendBack={sendBack}
      setSendBack={setSendBack}
      busy={busy}
      error={formError}
      onClose={() => !busy && setOpen(null)}
      onDecide={(approve) => open && decide(open, approve, note)}
    />
  );
  return { show, select, modal };
}

/**
 * Pending verification: riders and outlets who signed up themselves, from the moment they sign
 * up (before their email is verified) until they are approved. Administrators see the kinds
 * their Riders and Outlets permissions allow.
 */
export function ApplicationsManager() {
  const { locations } = useApp();
  const { data, error, loading, refresh } = useData<Row[]>('/admin/applications', 30000);
  const { range, setRange, label: rangeText } = useRange('30d');
  const review = useReview(refresh);
  const list = sorted(data || []);
  const count = (s: Stage) => list.filter((a) => stageOf(a) === s).length;
  const areaName = (id: string) => locations.find((l) => l.id === id)?.name || id || '—';
  const statsBusy = loading && !data;
  return (
    <div className="stack">
      <FilterBar title="Pending verification" hint={`Approvals in ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Clock size={20} />}
          label="Waiting for review"
          value={count('pending')}
          hint={`${list.filter((a) => stageOf(a) === 'pending' && a.kind === 'rider').length} riders · ${list.filter((a) => stageOf(a) === 'pending' && a.kind === 'outlet').length} outlets`}
          tone="orange"
          quiet={!count('pending')}
          loading={statsBusy}
        />
        <Stat
          icon={<FileText size={20} />}
          label="Waiting for details"
          value={count('draft') + count('rejected')}
          hint={`${count('rejected')} sent back to correct`}
          tone="blue"
          loading={statsBusy}
        />
        <Stat
          icon={<MailWarning size={20} />}
          label="Email not verified"
          value={count('unverified')}
          hint={`${count('blocked')} blocked`}
          tone="purple"
          quiet={!count('unverified')}
          loading={statsBusy}
        />
        <Stat
          icon={<BadgeCheck size={20} />}
          label="Approved"
          value={list.filter((a) => a.status === 'approved' && inRange(a.reviewed_at, range)).length}
          hint={`${count('approved')} in total`}
          tone="green"
          loading={statsBusy}
        />
      </div>
      <DataTable
        rows={data ? list : data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(a) => a.user_id}
        onRowClick={(a) => review.show(a)}
        search={(a) => `${a.name} ${a.email} ${a.phone} ${a.details.business_name || ''} ${a.details.cnic || a.details.owner_cnic || ''}`}
        searchPlaceholder="Search name, email, phone or CNIC"
        empty="No rider or outlet sign-ups yet. People apply from the sign-up page."
        filters={[
          {
            key: 'stage',
            label: 'Statuses',
            options: (Object.keys(stages) as Stage[]).map((value) => ({ value, label: stages[value].text })),
            test: (a, v) => stageOf(a) === v,
          },
          {
            key: 'kind',
            label: 'Types',
            options: [
              { value: 'rider', label: 'Riders' },
              { value: 'outlet', label: 'Outlets' },
            ],
            test: (a, v) => a.kind === v,
          },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Applicant',
            sort: (a) => a.name.toLowerCase(),
            render: (a) => <Applicant a={a} />,
          },
          {
            key: 'kind',
            header: 'Type',
            render: (a) => (
              <span className="cell-stack">
                <span>{a.kind === 'rider' ? 'Rider' : 'Outlet'}</span>
                <small>{areaName(String(a.details.location_id || a.location_id))}</small>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (a) => (
              <span className="cell-stack">
                {review.select(a)}
                {a.status === 'approved' && a.login_id && <small>{a.login_id}</small>}
              </span>
            ),
          },
          {
            key: 'submitted_at',
            header: 'Signed up',
            sort: (a) => a.submitted_at || a.created_at,
            render: (a) => <Dates a={a} />,
          },
        ]}
        actions={(a) => (
          <IconAction label="Review" onClick={() => review.show(a)}>
            <FileText size={16} />
          </IconAction>
        )}
      />
      {review.modal}
    </div>
  );
}

/**
 * Sign-ups of one kind, shown on the Riders or Outlets page: everyone not approved yet, with the
 * same status menu and review popup as the Pending verification page.
 */
export function ApplicantsPanel({ kind, onOpenAll }: { kind: 'rider' | 'outlet'; onOpenAll: () => void }) {
  const { data, error, refresh } = useData<Row[]>('/admin/applications', 30000);
  const review = useReview(refresh);
  const rows = sorted((data || []).filter((a) => a.kind === kind && a.status !== 'approved'));
  if (!rows.length && !error) return null;
  const waiting = rows.filter((a) => stageOf(a) === 'pending').length;
  return (
    <section className="card applicants-panel">
      <div className="applicants-head">
        <div>
          <strong>
            {kind === 'rider' ? 'Rider' : 'Outlet'} sign-ups not approved yet ({rows.length})
          </strong>
          <small className="muted">
            {waiting ? `${waiting} waiting for your review. ` : ''}They cannot sign in as {kind === 'rider' ? 'riders' : 'outlets'} or get
            orders until approved.
          </small>
        </div>
        <button className="button ghost small" onClick={onOpenAll}>
          Pending verification
        </button>
      </div>
      {error && <ErrorBox error={error} retry={refresh} />}
      <div className="applicants-list">
        {rows.slice(0, 8).map((a) => (
          <div key={a.user_id} className="applicant-row" onClick={() => review.show(a)}>
            <Applicant a={a} />
            <Dates a={a} />
            {review.select(a)}
          </div>
        ))}
      </div>
      {rows.length > 8 && (
        <button className="link" onClick={onOpenAll}>
          See all {rows.length} on Pending verification
        </button>
      )}
      {review.modal}
    </section>
  );
}

function Applicant({ a }: { a: Row }) {
  return (
    <span className="cell-stack">
      <strong>{a.kind === 'outlet' && a.details.business_name ? String(a.details.business_name) : a.name}</strong>
      <small>
        {a.email}
        {a.phone ? ' · ' + a.phone : ''}
      </small>
    </span>
  );
}

function Dates({ a }: { a: Row }) {
  return (
    <span className="cell-stack">
      <span title={date(a.registered_at || a.created_at)}>{ago(a.registered_at || a.created_at)}</span>
      <small>{a.submitted_at ? 'Details sent ' + ago(a.submitted_at) : 'No details yet'}</small>
    </span>
  );
}

function ReviewModal({
  app: open,
  commission,
  setCommission,
  note,
  setNote,
  sendBack,
  setSendBack,
  busy,
  error,
  onClose,
  onDecide,
}: {
  app: Row | null;
  commission: Commission;
  setCommission: (c: Commission) => void;
  note: string;
  setNote: (v: string) => void;
  sendBack: boolean;
  setSendBack: (v: boolean) => void;
  busy: boolean;
  error: string;
  onClose: () => void;
  onDecide: (approve: boolean) => void;
}) {
  const { locations } = useApp();
  const areaName = (id: string) => locations.find((l) => l.id === id)?.name || id || '—';
  const stage = open ? stageOf(open) : 'draft';
  return (
    <Modal open={!!open} onClose={onClose} title={open ? `${open.kind === 'rider' ? 'Rider' : 'Outlet'} application` : ''} size="lg">
      {open && (
        <div className="stack">
          <div className="application-head">
            <span className="feature-icon">{open.kind === 'rider' ? <Bike size={22} /> : <Store size={22} />}</span>
            <div>
              <strong>{open.kind === 'outlet' && open.details.business_name ? String(open.details.business_name) : open.name}</strong>
              <Badge tone={stages[stage].tone}>{stages[stage].text}</Badge>
            </div>
          </div>
          <div className="application-contact">
            <span>
              <UserRound size={14} /> {open.name}
            </span>
            <span>
              <Mail size={14} /> {open.email}{' '}
              {open.email_verified ? <CircleCheck size={13} className="ok" aria-label="verified" /> : '(not verified)'}
            </span>
            <span>
              <Phone size={14} /> {open.phone}
            </span>
            <span>
              <MapPin size={14} /> {open.address} · {areaName(open.location_id)}
            </span>
          </div>
          {!hasDetails(open) ? (
            <div className="alert info">
              {open.email_verified
                ? 'They have not sent their details yet.'
                : 'They have not verified their email yet, so they cannot sign in and send their details. If they cannot get the code, set their status to "Waiting for details".'}
            </div>
          ) : (
            <dl className="application-details">
              {detailRows(open).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
          {open.status === 'rejected' && open.note && (
            <div className="alert warn">
              <strong>Sent back:</strong> {open.note}
            </div>
          )}
          {open.reviewed_at && (
            <small className="muted">
              Last decided {date(open.reviewed_at)}
              {open.reviewed_by_name ? ' by ' + open.reviewed_by_name : ''}
            </small>
          )}
          {hasDetails(open) && open.status !== 'approved' && (
            <>
              {sendBack && (
                <label>
                  What should they change?
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. The CNIC number does not match the name. Please check it."
                    autoFocus
                  />
                </label>
              )}
              {open.kind === 'rider' && !sendBack && (
                <fieldset className="fieldset">
                  <legend>Commission per delivery</legend>
                  <div className="segmented">
                    {(['fixed', 'percent'] as const).map((t) => (
                      <button
                        type="button"
                        key={t}
                        className={commission.type === t ? 'selected' : ''}
                        onClick={() => commission.type !== t && setCommission(commissionFor(t))}
                      >
                        {t === 'fixed' ? 'Fixed amount' : 'Percentage'}
                      </button>
                    ))}
                  </div>
                  <div className="form-grid">
                    <label>
                      {commission.type === 'fixed' ? 'Amount per delivery (PKR)' : 'Percentage (%)'}
                      <input
                        type="number"
                        min="0"
                        max={commission.type === 'percent' ? 100 : undefined}
                        step={commission.type === 'percent' ? '0.1' : '1'}
                        value={commission.value}
                        onChange={(e) => setCommission({ ...commission, value: e.target.value })}
                      />
                    </label>
                    {commission.type === 'percent' && (
                      <label>
                        Calculated on
                        <select
                          value={commission.base}
                          onChange={(e) => setCommission({ ...commission, base: e.target.value as Commission['base'] })}
                        >
                          <option value="delivery_fee">Delivery fee</option>
                          <option value="subtotal">Items subtotal</option>
                          <option value="total">Order total</option>
                        </select>
                      </label>
                    )}
                  </div>
                  <small className="muted">
                    They asked for {commissionTypes[String(open.details.commission_type || 'fixed') as keyof typeof commissionTypes].toLowerCase()}.
                    You can change it later on the Riders page.
                  </small>
                </fieldset>
              )}
              {error && <ErrorBox error={error} />}
              <div className="form-foot">
                {sendBack ? (
                  <>
                    <button className="button ghost" onClick={() => setSendBack(false)} disabled={busy}>
                      Cancel
                    </button>
                    <button className="button danger" onClick={() => onDecide(false)} disabled={busy}>
                      <Send size={16} /> Send back
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button ghost" onClick={() => setSendBack(true)} disabled={busy}>
                      Send back for changes
                    </button>
                    <button className="button" onClick={() => onDecide(true)} disabled={busy}>
                      <BadgeCheck size={16} /> {busy ? 'Approving…' : `Approve ${open.kind}`}
                    </button>
                  </>
                )}
              </div>
              <small className="muted">
                {open.kind === 'rider'
                  ? 'Approving gives them a rider ID, saves this commission and opens the rider app for them.'
                  : 'Approving creates the outlet in their area with its own outlet ID. Add products, a picture and its delivery areas on the Outlets page.'}
              </small>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** The details an application holds, as label and value. */
function detailRows(a: Row): [string, string][] {
  const d = a.details;
  const s = (k: string) => (d[k] == null ? '' : String(d[k]));
  const pay: [string, string][] = [
    ['Payout bank or wallet', s('payout_bank')],
    ['Account title', s('payout_title')],
    ['Account number', s('payout_account')],
  ];
  if (a.kind === 'rider')
    return [
      ['CNIC', s('cnic')],
      ['Vehicle', vehicleTypes[s('vehicle_type') as keyof typeof vehicleTypes] || s('vehicle_type')],
      ['Vehicle number', s('vehicle_number')],
      ['Driving licence', s('license_number')],
      ['Emergency contact', [s('emergency_name'), s('emergency_phone')].filter(Boolean).join(' · ')],
      ['Wants to earn', commissionTypes[(s('commission_type') || 'fixed') as keyof typeof commissionTypes]],
      ['Paid by', payoutMethods[s('payout_method') as keyof typeof payoutMethods] || s('payout_method')],
      ...(s('payout_method') === 'cash' ? [] : pay),
      ['About them', s('about')],
    ];
  return [
    ['Outlet name', s('business_name')],
    ['Category', s('category')],
    ['Outlet phone', s('business_phone')],
    ['Owner', s('owner_name')],
    ['Owner CNIC', s('owner_cnic')],
    ['Address', s('address')],
    ['Map location', d.lat != null && d.lng != null ? `${Number(d.lat).toFixed(5)}, ${Number(d.lng).toFixed(5)}` : 'Not shared (the area centre is used)'],
    ['Hours', s('opens_at') && s('closes_at') ? `${s('opens_at')} – ${s('closes_at')}` : 'Not given'],
    ['About the outlet', s('description')],
    ...pay,
  ];
}
