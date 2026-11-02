import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, describeQr, dynamicQr, parseTlv, raastQr, readRaastQr, validIban } from '../apps/api/src/emvqr.js';

test('a Raast QR for an IBAN carries the amount, reference and expiry', () => {
  assert.equal(validIban('PK36SCBL0000001123456702'), true);
  assert.equal(validIban('PK36SCBL0000001123456703'), false);
  const q = raastQr({
    iban: 'pk36 scbl 0000 0011 2345 6702',
    amount: 150000,
    bankName: 'Standard Chartered',
    particulars: 'Dellvit DLVAB12',
    now: new Date('2026-11-02T10:00:00Z'),
  })!;
  // Bank name and particulars are only added when asked for.
  assert.equal(
    q.slice(0, -4),
    '000202' + '010212' + '020200' + '0318Standard Chartered' + '0424PK36SCBL0000001123456702' + '05041500' +
      '0615Dellvit DLVAB12' + '0712021120261700' + '1004',
  );
  assert.equal(q.slice(-4), crc16(q.slice(0, -4)));
  const tags = Object.fromEntries(parseTlv(q)!.map((f) => [f.tag, f.value]));
  assert.equal(tags['05'], '1500');
  // Five in the afternoon in Pakistan, two hours after 10:00 UTC.
  assert.equal(tags['07'], '021120261700');
  assert.equal(raastQr({ iban: 'PK36SCBL0000001123456702', amount: 12345 })!.includes('0506123.45'), true);
  assert.equal(raastQr({ iban: 'PK00NOPE', amount: 100 }), null);
});

const field = (t: string, v: string) => t + String(v.length).padStart(2, '0') + v;
/** A static merchant QR such as a wallet or bank issues, with made-up account details. */
function merchantQr() {
  const account = field('00', 'com.example.wallet') + field('01', 'PK36SCBL0000001123456702');
  const body =
    field('00', '01') + field('01', '11') + field('26', account) + field('52', '5411') + field('53', '586') +
    field('58', 'PK') + field('59', 'DELLVIT STORE') + field('60', 'RAWALPINDI') + '6304';
  return body + crc16(body);
}

test('the checksum matches the example in the EMVCo merchant QR specification', () => {
  const spec =
    '00020101021229300012D156000000000510A93FO3230Q31280012D15600000001030812345678520441115802CN5914BEST TRANSPORT6007BEIJING64200002ZH0104最佳运输0202北京540523.7253031565502016233030412340603***0708A60086670902ME91320016A0112233449988770708123456786304A13A';
  assert.equal(crc16(spec.slice(0, -4)), 'A13A');
  assert.equal(describeQr(spec).valid, true);
});

test('a merchant QR becomes a dynamic QR with the amount and reference', () => {
  const base = merchantQr();
  const info = describeQr(base);
  assert.equal(info.valid, true);
  assert.equal(info.merchant_name, 'DELLVIT STORE');
  assert.deepEqual(info.schemes, ['com.example.wallet']);
  const dyn = dynamicQr(base, 123450, 'DLVABC123')!;
  assert.equal(describeQr(dyn).valid, true);
  const tags = Object.fromEntries(parseTlv(dyn)!.map((f) => [f.tag, f.value]));
  assert.equal(tags['00'], '01');
  assert.equal(tags['01'], '12');
  assert.equal(tags['54'], '1234.50');
  assert.equal(tags['53'], '586');
  // The merchant's account is untouched.
  assert.equal(tags['26'], parseTlv(base)!.find((f) => f.tag === '26')!.value);
  const extra = Object.fromEntries(parseTlv(tags['62'])!.map((f) => [f.tag, f.value]));
  assert.equal(extra['01'], 'DLVABC123');
  assert.equal(extra['05'], 'DLVABC123');
  assert.ok(dyn.startsWith('000201') && /6304[0-9A-F]{4}$/.test(dyn));
});

test('a QR that does not follow the standard is not changed', () => {
  assert.equal(dynamicQr('https://example.com/pay/123', 1000, 'X'), null);
  const broken = merchantQr().slice(0, -4) + '0000';
  assert.equal(describeQr(broken).valid, false);
});

test('the QR matches what easypaisa makes for the same account and amount', () => {
  // Decoded from easypaisa's "Create QR" for Rs 1000; only the expiry differs per QR.
  const easypaisa = '0002020102120202000424PK44TMFB00000000681657130504100007122711202619011004411D';
  assert.equal(crc16(easypaisa.slice(0, -4)), '411D');
  const ours = raastQr({ iban: 'PK44TMFB0000000068165713', amount: 100000, now: new Date('2026-11-27T14:01:00Z'), validMinutes: 0 })!;
  assert.equal(ours, easypaisa);
  assert.deepEqual(readRaastQr(easypaisa), { iban: 'PK44TMFB0000000068165713', amount: '1000', dynamic: true });
  assert.equal(readRaastQr('0002020102110202000424PK44TMFB00000000681657131004EF24')?.iban, 'PK44TMFB0000000068165713');
  assert.equal(readRaastQr(easypaisa.slice(0, -4) + '0000'), null);
});
