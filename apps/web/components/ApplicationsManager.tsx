'use client';
import { useState } from 'react';
import { BadgeCheck, Bike, CircleCheck, Clock, FileText, Mail, MapPin, Phone, Send, Store, UserRound } from 'lucide-react';
import { ago, api, date } from '@/lib/api';
import { useData } from '@/lib/useData';
import { inRange, useRange } from '@/lib/range';
import { useApp } from './Provider';
import { Badge, DataTable, ErrorBox, FilterBar, IconAction, Modal, Stat } from './UI';
import { payoutMethods, vehicleTypes, type Application } from './Partner';

/** An application with the account it belongs to, as administrators see it. */
type Row = Application & {
  user_id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  location_id: string;
  email_verified: boolean;
  login_id: string | null;
  registered_at: string;
  reviewed_by_name: string | null;
  created_at: string;
};
const statuses = {
  draft: { text: 'Waiting for details', tone: 'neutral' },
  pending: { text: 'Waiting for review', tone: 'warn' },
  rejected: { text: 'Sent back', tone: 'danger' },
  approved: { text: 'Approved', tone: 'success' },
} as const;

/**
 * Pending verification: riders and outlets who signed up themselves. Their details are checked
 * here, then the account is approved (it becomes a rider or outlet with its own ID) or sent back
 * with a reason. Administrators see the kinds their Riders and Outlets permissions allow.
 */
export function ApplicationsManager() {
  const { notice, locations } = useApp();
  const { data, error, loading, refresh } = useData<Row[]>('/admin/applications', 30000);
  const { range, setRange, label: rangeText } = useRange('30d');
  const [open, setOpen] = useState<Row | null>(null);
  const [note, setNote] = useState('');
  const [sendBack, setSendBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const list = data || [];
  const count = (s: Row['status']) => list.filter((a) => a.status === s).length;
  const areaName = (id: string) => locations.find((l) => l.id === id)?.name || id || '—';
  const statsBusy = loading && !data;

  function show(a: Row) {
    setOpen(a);
    setNote('');
    setSendBack(false);
    setFormError('');
  }
  async function decide(approve: boolean) {
    if (!open) return;
    if (!approve && !note.trim()) return setFormError('Write what the applicant should change.');
    setBusy(true);
    setFormError('');
    try {
      const r = await api<{ login_id?: string }>(`/admin/applications/${open.user_id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify(approve ? {} : { note: note.trim() }),
      });
      setOpen(null);
      refresh();
      notice(
        approve
          ? `${open.name} is approved as ${open.kind === 'rider' ? 'a rider' : 'an outlet'} with ID ${r.login_id}. They were emailed.`
          : `The application was sent back to ${open.name}.`,
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <FilterBar title="Pending verification" hint={`Decisions in ${rangeText.toLowerCase()}`} range={range} onRange={setRange} />
      <div className="stats">
        <Stat
          icon={<Clock size={20} />}
          label="Waiting for review"
          value={count('pending')}
          hint={`${list.filter((a) => a.status === 'pending' && a.kind === 'rider').length} riders · ${list.filter((a) => a.status === 'pending' && a.kind === 'outlet').length} outlets`}
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
        onRowClick={show}
        search={(a) => `${a.name} ${a.email} ${a.phone} ${a.details.business_name || ''} ${a.details.cnic || a.details.owner_cnic || ''}`}
        searchPlaceholder="Search name, email, phone or CNIC"
        empty="No rider or outlet applications yet. People apply from the sign-up page."
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            initial: 'pending',
            options: Object.entries(statuses).map(([value, s]) => ({ value, label: s.text })),
            test: (a, v) => a.status === v,
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
            render: (a) => (
              <span className="cell-stack">
                <strong>{a.kind === 'outlet' && a.details.business_name ? String(a.details.business_name) : a.name}</strong>
                <small>
                  {a.email} {a.email_verified ? '' : '· email not verified'}
                </small>
              </span>
            ),
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
                <Badge tone={statuses[a.status].tone}>{statuses[a.status].text}</Badge>
                {a.status === 'approved' && a.login_id && <small>{a.login_id}</small>}
              </span>
            ),
          },
          {
            key: 'submitted_at',
            header: 'Sent',
            sort: (a) => a.submitted_at || a.created_at,
            render: (a) => (
              <span title={date(a.submitted_at || a.created_at)}>{a.submitted_at ? ago(a.submitted_at) : 'Not yet'}</span>
            ),
          },
        ]}
        actions={(a) => (
          <IconAction label="Review" onClick={() => show(a)}>
            <FileText size={16} />
          </IconAction>
        )}
      />

      <Modal open={!!open} onClose={() => !busy && setOpen(null)} title={open ? `${open.kind === 'rider' ? 'Rider' : 'Outlet'} application` : ''} size="lg">
        {open && (
          <div className="stack">
            <div className="application-head">
              <span className="feature-icon">{open.kind === 'rider' ? <Bike size={22} /> : <Store size={22} />}</span>
              <div>
                <strong>{open.kind === 'outlet' && open.details.business_name ? String(open.details.business_name) : open.name}</strong>
                <Badge tone={statuses[open.status].tone}>{statuses[open.status].text}</Badge>
              </div>
            </div>
            <div className="application-contact">
              <span>
                <UserRound size={14} /> {open.name}
              </span>
              <span>
                <Mail size={14} /> {open.email} {open.email_verified ? <CircleCheck size={13} className="ok" aria-label="verified" /> : '(not verified)'}
              </span>
              <span>
                <Phone size={14} /> {open.phone}
              </span>
              <span>
                <MapPin size={14} /> {open.address} · {areaName(open.location_id)}
              </span>
            </div>
            {open.status === 'draft' ? (
              <div className="alert info">They have not sent their details yet.</div>
            ) : (
              <dl className="application-details">{detailRows(open).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || '—'}</dd>
                </div>
              ))}</dl>
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
            {open.status === 'pending' && (
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
                {formError && <ErrorBox error={formError} />}
                <div className="form-foot">
                  {sendBack ? (
                    <>
                      <button className="button ghost" onClick={() => setSendBack(false)} disabled={busy}>
                        Cancel
                      </button>
                      <button className="button danger" onClick={() => decide(false)} disabled={busy}>
                        <Send size={16} /> Send back
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="button ghost" onClick={() => setSendBack(true)} disabled={busy}>
                        Send back for changes
                      </button>
                      <button className="button" onClick={() => decide(true)} disabled={busy}>
                        <BadgeCheck size={16} /> {busy ? 'Approving…' : `Approve ${open.kind}`}
                      </button>
                    </>
                  )}
                </div>
                <small className="muted">
                  {open.kind === 'rider'
                    ? 'Approving gives them a rider ID and opens the rider app for them. Set their commission on the Riders page.'
                    : 'Approving creates the outlet in their area with its own outlet ID. Add products, a picture and its delivery areas on the Outlets page.'}
                </small>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
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
