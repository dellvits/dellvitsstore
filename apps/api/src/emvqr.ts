/**
 * Payment QR codes in the EMVCo merchant-presented format, which Pakistan's interoperable QR
 * standard (Raast P2M, JazzCash, Easypaisa and bank merchant QRs) is built on.
 *
 * An administrator imports the store's own merchant QR, as its bank or wallet issued it. For each
 * checkout it is turned into a dynamic QR: point of initiation 12, the amount (tag 54) in PKR
 * (tag 53 = 586) and an order reference (tag 62), with a new checksum (tag 63). The merchant's
 * account details (tags 26-51) are kept exactly as issued, so payments reach the same account.
 */

export type Tlv = { tag: string; value: string };

/** Splits an EMV payload into its tag-length-value fields; null when it is not well formed. */
export function parseTlv(payload: string): Tlv[] | null {
  const out: Tlv[] = [];
  let i = 0;
  while (i < payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(payload.slice(i + 2, i + 4))) return null;
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

const field = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;

/** CRC-16/CCITT-FALSE (polynomial 0x1021, start 0xFFFF), as EMVCo asks for tag 63. */
export function crc16(text: string) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type MerchantQr = {
  /** True when the payload is a valid EMVCo merchant QR whose checksum matches. */
  valid: boolean;
  merchant_name: string;
  merchant_city: string;
  /** The scheme ids found in the merchant account fields, such as a Raast or wallet id. */
  schemes: string[];
  /** Whether the original already asked for a fixed amount. */
  had_amount: boolean;
};

/** Reads what an imported QR says about the merchant. */
export function describeQr(payload: string): MerchantQr {
  const fields = parseTlv(payload.trim());
  const get = (tag: string) => fields?.find((f) => f.tag === tag)?.value || '';
  const crcField = fields?.at(-1);
  const valid =
    !!fields &&
    get('00') === '01' &&
    crcField?.tag === '63' &&
    crcField.value.toUpperCase() === crc16(payload.trim().slice(0, -4)) &&
    fields.some((f) => Number(f.tag) >= 2 && Number(f.tag) <= 51);
  const schemes = (fields || [])
    .filter((f) => Number(f.tag) >= 26 && Number(f.tag) <= 51)
    .map((f) => parseTlv(f.value)?.find((s) => s.tag === '00')?.value || 'tag ' + f.tag);
  return {
    valid,
    merchant_name: get('59'),
    merchant_city: get('60'),
    schemes,
    had_amount: !!get('54'),
  };
}

/** A Pakistani IBAN with a correct ISO 13616 check (mod 97). */
export function validIban(iban: string) {
  const v = iban.replace(/\s/g, '').toUpperCase();
  if (!/^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(v)) return false;
  const digits = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** Day, month, year, hour and minute in Pakistan time, as DDMMYYYYHHmm. */
function pakistanTime(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}${p.month}${p.year}${p.hour}${p.minute}`;
}

/**
 * A Raast QR for paying an IBAN, made from the payment method's own details: no QR has to be
 * uploaded. This is the layout easypaisa, JazzCash, NayaPay and Faysal Bank print, checked
 * against QRs decoded from those apps (easypaisa "Create QR" for Rs 1000 reads
 * 000202 010212 020200 0424<IBAN> 05041000 0712<DDMMYYYYHHmm> 1004<CRC>):
 * 00 = 02 (Raast P2P), 01 = 12 (dynamic, with an amount), 02 = 00 (scheme), 04 IBAN,
 * 05 amount in rupees, 07 expiry in Pakistan time (apps ignore an amount without one) and
 * 10 = CRC-16/CCITT-FALSE. The optional 03 (bank name) and 06 (particulars) are only added
 * when asked for, since the wallets themselves leave them out.
 */
export function raastQr({
  iban,
  amount,
  bankName = '',
  particulars = '',
  validMinutes = 120,
  now = new Date(),
}: {
  iban: string;
  /** In paisa. */
  amount: number;
  bankName?: string;
  particulars?: string;
  validMinutes?: number;
  now?: Date;
}) {
  const account = iban.replace(/\s/g, '').toUpperCase();
  if (!validIban(account) || !(amount > 0)) return null;
  const rupees = amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2);
  if (rupees.length > 10) return null;
  const clean = (s: string, max: number) => s.replace(/[^\w .,&/-]/g, '').trim().slice(0, max);
  const body =
    field('00', '02') +
    field('01', '12') +
    field('02', '00') +
    (clean(bankName, 25) ? field('03', clean(bankName, 25)) : '') +
    field('04', account) +
    field('05', rupees) +
    (clean(particulars, 30) ? field('06', clean(particulars, 30)) : '') +
    field('07', pakistanTime(new Date(now.getTime() + validMinutes * 60000))) +
    '1004';
  return body + crc16(body);
}

/**
 * Reads a Raast QR such as a wallet or bank app shows under "My QR" (00 = 02). Answers its IBAN
 * and amount, or null when it is not one or its checksum is wrong.
 */
export function readRaastQr(payload: string) {
  const text = payload.trim();
  const fields = parseTlv(text);
  const get = (tag: string) => fields?.find((f) => f.tag === tag)?.value || '';
  if (!fields || get('00') !== '02' || fields.at(-1)?.tag !== '10') return null;
  if (fields.at(-1)!.value.toUpperCase() !== crc16(text.slice(0, -4))) return null;
  const iban = get('04');
  return validIban(iban) ? { iban, amount: get('05'), dynamic: get('01') === '12' } : null;
}

/**
 * A dynamic copy of a merchant QR for one payment. `amount` is in paisa; `reference` (letters
 * and digits, up to 25) is put in the bill number and reference label so the payment can be
 * matched to the order. Answers null when the imported QR is not a valid EMVCo merchant QR.
 */
export function dynamicQr(payload: string, amount: number, reference: string, purpose = 'Dellvit order') {
  const base = payload.trim();
  if (!describeQr(base).valid) return null;
  const fields = parseTlv(base)!.filter((f) => !['01', '53', '54', '55', '56', '57', '58', '62', '63'].includes(f.tag));
  const ref = reference.replace(/[^A-Za-z0-9-]/g, '').slice(0, 25);
  const original = parseTlv(base)!;
  const additional = (parseTlv(original.find((f) => f.tag === '62')?.value || '') || []).filter(
    (f) => !['01', '05', '08'].includes(f.tag),
  );
  const extra = [
    ...(ref ? [{ tag: '01', value: ref }, { tag: '05', value: ref }] : []),
    ...additional,
    { tag: '08', value: purpose.slice(0, 25) },
  ].sort((a, b) => a.tag.localeCompare(b.tag));
  const out: Tlv[] = [
    ...fields,
    // 12 = dynamic: valid for this one payment, with the amount fixed.
    { tag: '01', value: '12' },
    { tag: '53', value: '586' },
    { tag: '54', value: (amount / 100).toFixed(2) },
    { tag: '58', value: 'PK' },
    { tag: '62', value: extra.map((f) => field(f.tag, f.value)).join('') },
  ].sort((a, b) => a.tag.localeCompare(b.tag));
  const body = out.map((f) => field(f.tag, f.value)).join('') + '6304';
  return body + crc16(body);
}
