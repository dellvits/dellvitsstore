'use client';
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Download, QrCode, ScanLine, Trash2, Upload } from 'lucide-react';
import { api, money } from '@/lib/api';
import { IMAGE_ACCEPT } from './ImageCropper';

type Read = { payload: string; valid: boolean; merchant_name: string; merchant_city: string; schemes: string[] };
/** What checkout receives with a quote for a method that has a QR. */
export type CheckoutQr = {
  dynamic: boolean;
  /** raast: made from the method's IBAN; merchant: from an imported merchant QR. */
  kind?: 'raast' | 'merchant';
  /** The IBAN, shortened, for Raast QRs. */
  account?: string;
  valid_minutes?: number;
  merchant_name: string;
  merchant_city: string;
  amount: number;
  payload: string;
  image: string;
};

/**
 * The payment method form's QR field: the administrator uploads a photo or screenshot of the
 * store's merchant QR from JazzCash, Easypaisa, Raast or the bank (or pastes its text). The text
 * inside it is saved; checkout makes a dynamic QR with the order's amount from it.
 */
export function MerchantQrField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [info, setInfo] = useState<Read | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState(false);
  async function read(body: FormData | string) {
    setBusy(true);
    setError('');
    try {
      const r = await api<Read>('/admin/payments/qr-read', {
        method: 'POST',
        body: typeof body === 'string' ? JSON.stringify({ payload: body }) : body,
      });
      setInfo(r);
      onChange(r.payload);
      setPaste(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // A saved QR is described again when the form opens.
  useEffect(() => {
    if (value) void read(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="field span-2 merchant-qr">
      <span className="field-label">
        <QrCode size={15} /> Payment QR code <span className="muted">(optional)</span>
      </span>
      {value && info ? (
        <div className={'alert ' + (info.valid ? 'success' : 'warn')}>
          {info.valid ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
          <span>
            {info.valid ? (
              <>
                <strong>{info.merchant_name || 'Merchant QR'}</strong>
                {info.merchant_city && ' · ' + info.merchant_city}. Checkout shows a QR with the exact order amount; standard
                wallet and bank apps fill in the merchant and amount when scanned.
              </>
            ) : (
              <>
                This QR does not follow the standard payment QR format (EMVCo), so the amount cannot be added. Checkout shows it as
                it is and the customer types the amount. Use the <b>merchant</b> QR from your JazzCash, Easypaisa, Raast or bank
                merchant account for automatic amounts.
              </>
            )}
          </span>
          <button type="button" className="icon-action" onClick={() => (onChange(''), setInfo(null))} aria-label="Remove QR" title="Remove QR">
            <Trash2 size={15} />
          </button>
        </div>
      ) : (
        <div className="merchant-qr-actions">
          <label className="button ghost small">
            <Upload size={15} /> {busy ? 'Reading…' : 'Upload QR picture'}
            <input
              type="file"
              hidden
              accept={IMAGE_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const form = new FormData();
                form.append('file', f);
                read(form);
              }}
            />
          </label>
          <button type="button" className="link" onClick={() => setPaste((p) => !p)}>
            <ScanLine size={14} /> Paste QR text instead
          </button>
        </div>
      )}
      {paste && (
        <div className="input-with-button">
          <input id="qr-text" placeholder="000201010211…" maxLength={700} />
          <button
            type="button"
            className="button small"
            onClick={() => read((document.getElementById('qr-text') as HTMLInputElement).value.trim())}
          >
            Read
          </button>
        </div>
      )}
      {error && <small className="error-text">{error}</small>}
      <small className="muted">
        Use the merchant QR your wallet or bank gave you (JazzCash Business, Easypaisa Merchant, Raast or bank merchant QR). A
        clear screenshot works best.
      </small>
    </div>
  );
}

/**
 * Reads the IBAN from a wallet's or bank's own "My QR" (JazzCash, Easypaisa, NayaPay, SadaPay or a
 * bank app), so it does not have to be typed. Use the QR of the account customers should pay.
 */
export function IbanFromQr({ onIban }: { onIban: (iban: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <span className="iban-from-qr">
      <label className="link">
        <ScanLine size={13} /> {busy ? 'Reading QR…' : 'Fill IBAN from the account’s QR'}
        <input
          type="file"
          hidden
          accept={IMAGE_ACCEPT}
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setMessage('');
            try {
              const form = new FormData();
              form.append('file', f);
              const r = await api<Read & { kind: string; iban?: string }>('/admin/payments/qr-read', { method: 'POST', body: form });
              if (r.kind === 'raast' && r.iban) {
                onIban(r.iban);
                setMessage('IBAN filled in from the QR. Check that the account name is right before saving.');
              } else setMessage('This QR has no IBAN in it. Use the account’s “My QR” from the wallet or bank app.');
            } catch (err) {
              setMessage((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {message && <small className="muted">{message}</small>}
    </span>
  );
}

/** The QR at checkout: scan it with any wallet or banking app to pay this exact amount. */
export function CheckoutQrCard({
  qr,
  loading,
  compact = false,
}: {
  qr: CheckoutQr | null | undefined;
  loading: boolean;
  /** Stacked for the narrow order summary. */
  compact?: boolean;
}) {
  if (!qr)
    return (
      <div className="checkout-qr loading">
        {loading
          ? 'Preparing your payment QR…'
          : 'No QR code for this payment method yet. Pay to the account details shown in the payment section, then enter the TID.'}
      </div>
    );
  return (
    <div className={'checkout-qr' + (compact ? ' compact' : '')}>
      <img src={qr.image} alt={`Payment QR for ${money(qr.amount)} to ${qr.merchant_name}`} width={220} height={220} />
      <div className="checkout-qr-text">
        <strong>Scan to pay {money(qr.amount)}</strong>
        <span>
          To <b>{qr.merchant_name}</b>
          {qr.merchant_city && ', ' + qr.merchant_city}
          {qr.account && <small className="muted"> · {qr.account}</small>}
        </span>
        {qr.valid_minutes && <small className="muted">This QR works for {qr.valid_minutes} minutes; reload the page for a new one.</small>}
        <small className="muted">
          {qr.dynamic
            ? 'Open JazzCash, Easypaisa or your banking app and scan (Raast QR). The account and amount fill in by themselves.'
            : `Open your wallet or banking app, scan, and enter ${money(qr.amount)} yourself.`}{' '}
          Then enter the transaction ID (TID) below.
        </small>
        <a className="button ghost small" href={qr.image} download={`dellvit-payment-${qr.amount / 100}.png`}>
          <Download size={14} /> Save QR (to pay from this phone)
        </a>
      </div>
    </div>
  );
}
