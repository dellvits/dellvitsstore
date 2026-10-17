'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Bike, CircleCheck, Clock, Crosshair, FileText, LoaderCircle, LogOut, Send, Store, TriangleAlert } from 'lucide-react';
import { useApp } from './Provider';
import { api, currentPosition } from '@/lib/api';
import { useData } from '@/lib/useData';
import type { Category, User } from '@/lib/types';
import { Empty, ErrorBox, PageLoading } from './UI';
import { portalPath } from './Shell';

/** A rider's or outlet's application, as the server keeps it. */
export type Application = {
  kind: 'rider' | 'outlet';
  status: 'draft' | 'pending' | 'rejected' | 'approved';
  details: Record<string, string | number | null>;
  note: string;
  submitted_at: string | null;
  reviewed_at: string | null;
};
export const vehicleTypes = { motorbike: 'Motorbike', bicycle: 'Bicycle', car: 'Car', rickshaw: 'Rickshaw', on_foot: 'On foot' } as const;
export const commissionTypes = { fixed: 'A fixed amount per delivery', percent: 'A percentage of the delivery fee' } as const;
export const payoutMethods = { cash: 'Cash (collect from the office)', bank: 'Bank account', wallet: 'Mobile wallet', raast: 'Raast ID' } as const;

/**
 * Where a rider or outlet that signed up itself sends its details and waits. Until an
 * administrator approves it, this is all the account can open.
 */
export function PartnerApplication() {
  const { user, ready, setUser, logout, notice } = useApp();
  const applicant = user?.role === 'applicant';
  const { data, setData, error, loading } = useData<Application>(applicant ? '/partner/application' : null);
  // Approval changes the account; checking now and then lets the page move on by itself.
  const { data: session } = useData<{ user: User | null }>(applicant ? '/session' : null, 30000);
  useEffect(() => {
    if (session?.user && session.user.role !== 'applicant') setUser(session.user);
  }, [session, setUser]);
  if (!ready) return <PageLoading />;
  if (!user)
    return (
      <div className="container page narrow">
        <Empty title="Sign in to see your application" href="/login?next=/partner" action="Log in" />
      </div>
    );
  if (!applicant)
    return (
      <div className="container page narrow">
        <div className="partner-status approved">
          <CircleCheck size={22} />
          <div>
            <strong>Your account is approved</strong>
            <p>Your {user.role === 'outlet' ? 'outlet' : 'rider'} ID is {user.login_id || 'in your welcome email'}.</p>
          </div>
        </div>
        <Link className="button large" href={portalPath(user.role)}>
          Open your portal
        </Link>
      </div>
    );
  if (loading && !data) return <PageLoading />;
  if (!data) return <div className="container page narrow"><ErrorBox error={error || 'Could not load your application.'} /></div>;
  const rider = data.kind === 'rider';
  return (
    <div className="container page narrow partner-page">
      <span className="eyebrow">{rider ? 'Rider application' : 'Outlet application'}</span>
      <h1>{rider ? 'Become a Dellvit rider' : 'Sell on Dellvit'}</h1>
      <Status app={data} />
      <PartnerForm
        app={data}
        onSent={(a) => {
          setData(a);
          notice(data.status === 'pending' ? 'Your details are updated.' : 'Thank you! Your details are sent for review.');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      <button className="button ghost" onClick={() => logout()}>
        <LogOut size={16} /> Log out
      </button>
    </div>
  );
}

function Status({ app }: { app: Application }) {
  if (app.status === 'pending')
    return (
      <div className="partner-status pending" role="status">
        <Clock size={22} />
        <div>
          <strong>Your account is not approved yet</strong>
          <p>
            Our team is reviewing your details. You will get an email and a notification as soon as your account is
            approved. You can still correct your details below.
          </p>
        </div>
      </div>
    );
  if (app.status === 'rejected')
    return (
      <div className="partner-status rejected" role="alert">
        <TriangleAlert size={22} />
        <div>
          <strong>Please update your application</strong>
          <p>{app.note}</p>
          <p>Correct the details below and send them again.</p>
        </div>
      </div>
    );
  return (
    <div className="partner-status draft">
      <FileText size={22} />
      <div>
        <strong>One more step</strong>
        <p>
          Your email is verified. Send the details below; our team checks them and approves your account. Until then your
          account is not approved yet.
        </p>
      </div>
    </div>
  );
}

/** The rider's or outlet's details, filled in from what was sent before. */
function PartnerForm({ app, onSent }: { app: Application; onSent: (a: Application) => void }) {
  const { locations } = useApp();
  const { data: site } = useData<{ categories?: Category[] }>('/site');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(app.details).map(([k, v]) => [k, v == null ? '' : String(v)])),
  );
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const v = (k: string, d = '') => values[k] ?? d;
  const set = (k: string) => (e: { target: { value: string } }) => setValues((s) => ({ ...s, [k]: e.target.value }));
  const rider = app.kind === 'rider';
  const method = v('payout_method', 'cash');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { ...values };
      if (rider) {
        body.payout_method = method;
        body.commission_type = values.commission_type || 'fixed';
      }
      else {
        body.lat = values.lat ? Number(values.lat) : null;
        body.lng = values.lng ? Number(values.lng) : null;
      }
      if (rider && !body.vehicle_type) body.vehicle_type = 'motorbike';
      onSent(await api<Application>('/partner/application', { method: 'PUT', body: JSON.stringify(body) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function locate() {
    setLocating(true);
    setError('');
    try {
      const p = await currentPosition();
      setValues((s) => ({ ...s, lat: String(p.lat), lng: String(p.lng) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }
  return (
    <form className="card partner-form stack" onSubmit={submit}>
      <h2 className="partner-form-title">
        {rider ? <Bike size={20} /> : <Store size={20} />} {rider ? 'Your rider details' : 'Your outlet details'}
      </h2>
      {rider ? (
        <div className="form-grid">
          <label>
            CNIC number
            <input required value={v('cnic')} onChange={set('cnic')} placeholder="35202-1234567-1" inputMode="numeric" />
          </label>
          <label>
            Vehicle
            <select value={v('vehicle_type', 'motorbike')} onChange={set('vehicle_type')}>
              {Object.entries(vehicleTypes).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle number <span className="muted">(if it has one)</span>
            <input value={v('vehicle_number')} onChange={set('vehicle_number')} placeholder="RIM-1234" maxLength={30} />
          </label>
          <label>
            Driving licence number <span className="muted">(motor vehicles)</span>
            <input value={v('license_number')} onChange={set('license_number')} maxLength={40} />
          </label>
          <label>
            Emergency contact name
            <input required value={v('emergency_name')} onChange={set('emergency_name')} maxLength={100} />
          </label>
          <label>
            Emergency contact phone
            <input required type="tel" value={v('emergency_phone')} onChange={set('emergency_phone')} placeholder="03XX XXXXXXX" />
          </label>
        </div>
      ) : (
        <div className="form-grid">
          <label className="span-2">
            Outlet name
            <input required value={v('business_name')} onChange={set('business_name')} maxLength={150} placeholder="e.g. Fresh Corner" />
          </label>
          <label>
            Category
            <select required value={v('category')} onChange={set('category')}>
              <option value="" disabled>
                Choose a category
              </option>
              {(site?.categories || []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Outlet phone
            <input required type="tel" value={v('business_phone')} onChange={set('business_phone')} placeholder="051 1234567" />
          </label>
          <label>
            Owner name
            <input required value={v('owner_name')} onChange={set('owner_name')} maxLength={100} />
          </label>
          <label>
            Owner CNIC number
            <input required value={v('owner_cnic')} onChange={set('owner_cnic')} placeholder="35202-1234567-1" inputMode="numeric" />
          </label>
          <label>
            Area
            <select required value={v('location_id')} onChange={set('location_id')}>
              <option value="" disabled>
                Choose your area
              </option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="field-label">Map location <span className="muted">(optional)</span></span>
            <button type="button" className="button ghost" onClick={locate} disabled={locating}>
              {locating ? <LoaderCircle className="spin" size={16} /> : <Crosshair size={16} />}
              {v('lat') ? 'Location saved — update' : 'Use my current location'}
            </button>
          </div>
          <label className="span-2">
            Outlet address
            <textarea required rows={2} value={v('address')} onChange={set('address')} maxLength={500} />
          </label>
          <label className="span-2">
            About your outlet <span className="muted">(optional)</span>
            <textarea rows={2} value={v('description')} onChange={set('description')} maxLength={500} />
          </label>
          <label>
            Opens at <span className="muted">(optional)</span>
            <input type="time" value={v('opens_at')} onChange={set('opens_at')} />
          </label>
          <label>
            Closes at <span className="muted">(optional)</span>
            <input type="time" value={v('closes_at')} onChange={set('closes_at')} />
          </label>
        </div>
      )}
      <h3 className="form-section">How you are paid</h3>
      <div className="form-grid">
        {rider && (
          <label className="span-2">
            How you would like to earn
            <select value={v('commission_type', 'fixed')} onChange={set('commission_type')}>
              {Object.entries(commissionTypes).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
            <small className="muted">Our team confirms the exact amount when your account is approved.</small>
          </label>
        )}
        {rider && (
          <label>
            Payment method
            <select value={method} onChange={set('payout_method')}>
              {Object.entries(payoutMethods).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
        {(!rider || method !== 'cash') && (
          <>
            <label>
              Bank or wallet name <span className="muted">{rider ? '' : '(optional)'}</span>
              <input value={v('payout_bank')} onChange={set('payout_bank')} maxLength={100} placeholder="e.g. Meezan Bank, JazzCash" />
            </label>
            <label>
              Account title <span className="muted">{rider ? '' : '(optional)'}</span>
              <input value={v('payout_title')} onChange={set('payout_title')} maxLength={100} />
            </label>
            <label>
              Account number or IBAN <span className="muted">{rider ? '' : '(optional)'}</span>
              <input value={v('payout_account')} onChange={set('payout_account')} maxLength={40} />
            </label>
          </>
        )}
      </div>
      {rider && (
        <label>
          Anything else we should know? <span className="muted">(optional)</span>
          <textarea rows={2} value={v('about')} onChange={set('about')} maxLength={500} placeholder="e.g. delivery experience, the hours you can work" />
        </label>
      )}
      {error && <ErrorBox error={error} />}
      <button className="button large full" disabled={busy}>
        <Send size={17} /> {busy ? 'Sending…' : app.status === 'pending' ? 'Update my details' : 'Send for review'}
      </button>
    </form>
  );
}
