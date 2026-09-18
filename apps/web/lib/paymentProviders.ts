import type { PaymentMethod } from './types';

export type PaymentProvider = { name: string; slug: string };

/** Logos live in public/paymentmethods/<slug>.png */
export const logoPath = (slug: string) => `/paymentmethods/${slug}.png`;

export const banks: PaymentProvider[] = [
  // Public sector
  { name: 'National Bank of Pakistan', slug: 'nbp' },
  { name: 'The Bank of Punjab', slug: 'bank-of-punjab' },
  { name: 'Bank of Khyber', slug: 'bank-of-khyber' },
  { name: 'Sindh Bank', slug: 'sindh-bank' },
  { name: 'First Women Bank', slug: 'first-women-bank' },
  // Private commercial
  { name: 'Allied Bank', slug: 'allied-bank' },
  { name: 'Askari Bank', slug: 'askari-bank' },
  { name: 'Bank Alfalah', slug: 'bank-alfalah' },
  { name: 'Bank Al Habib', slug: 'bank-al-habib' },
  { name: 'Bank Makramah', slug: 'bank-makramah' },
  { name: 'Faysal Bank', slug: 'faysal-bank' },
  { name: 'Habib Bank Limited (HBL)', slug: 'hbl' },
  { name: 'Habib Metropolitan Bank', slug: 'habib-metro' },
  { name: 'JS Bank', slug: 'js-bank' },
  { name: 'MCB Bank', slug: 'mcb' },
  { name: 'Samba Bank', slug: 'samba-bank' },
  { name: 'Silkbank', slug: 'silkbank' },
  { name: 'Soneri Bank', slug: 'soneri-bank' },
  { name: 'Standard Chartered', slug: 'standard-chartered' },
  { name: 'United Bank Limited (UBL)', slug: 'ubl' },
  // Islamic
  { name: 'Meezan Bank', slug: 'meezan-bank' },
  { name: 'BankIslami', slug: 'bankislami' },
  { name: 'Dubai Islamic Bank', slug: 'dubai-islamic-bank' },
  { name: 'Al Baraka Bank', slug: 'al-baraka-bank' },
  { name: 'MCB Islamic Bank', slug: 'mcb-islamic' },
  // Foreign
  { name: 'Citibank', slug: 'citibank' },
  { name: 'Deutsche Bank', slug: 'deutsche-bank' },
  { name: 'Bank of China', slug: 'bank-of-china' },
  { name: 'ICBC', slug: 'icbc' },
  // Specialised
  { name: 'Zarai Taraqiati Bank (ZTBL)', slug: 'ztbl' },
  { name: 'SME Bank', slug: 'sme-bank' },
  { name: 'Punjab Provincial Cooperative Bank', slug: 'ppcbl' },
  // Digital
  { name: 'Easypaisa Bank', slug: 'easypaisa-bank' },
  { name: 'Mashreq Bank Pakistan', slug: 'mashreq-bank' },
  { name: 'Raqami Islamic Digital Bank', slug: 'raqami-bank' },
  // Microfinance
  { name: 'Mobilink Microfinance Bank', slug: 'mobilink-microfinance-bank' },
  { name: 'Khushhali Microfinance Bank', slug: 'khushhali-bank' },
  { name: 'HBL Microfinance Bank', slug: 'hbl-microfinance-bank' },
  { name: 'The First MicroFinance Bank', slug: 'first-microfinance-bank' },
  { name: 'NRSP Microfinance Bank', slug: 'nrsp-bank' },
  { name: 'U Microfinance Bank', slug: 'u-bank' },
  { name: 'FINCA Microfinance Bank', slug: 'finca-bank' },
  { name: 'Pak Oman Microfinance Bank', slug: 'pak-oman-microfinance-bank' },
  { name: 'Sindh Microfinance Bank', slug: 'sindh-microfinance-bank' },
  { name: 'Apna Microfinance Bank', slug: 'apna-microfinance-bank' },
];

/** Keep in sync with walletProviders in apps/api/src/platform.ts */
export const wallets: PaymentProvider[] = [
  { name: 'JazzCash', slug: 'jazzcash' },
  { name: 'Easypaisa', slug: 'easypaisa' },
  { name: 'SadaPay', slug: 'sadapay' },
  { name: 'NayaPay', slug: 'nayapay' },
  { name: 'UPaisa', slug: 'upaisa' },
  { name: 'Konnect by HBL', slug: 'konnect' },
  { name: 'Zindigi', slug: 'zindigi' },
  { name: 'SimSim', slug: 'simsim' },
  { name: 'MCB Lite', slug: 'mcb-lite' },
  { name: 'Alfa by Bank Alfalah', slug: 'alfa' },
];

export const cardGateways: PaymentProvider[] = [
  { name: 'Safepay', slug: 'safepay' },
  { name: 'PayFast', slug: 'payfast' },
];

const all = [...banks, ...wallets, ...cardGateways];

/** The provider a method belongs to: the wallet, card gateway, or bank. */
export const providerName = (m: Partial<PaymentMethod>) =>
  (m.type === 'wallet' ? m.provider : m.type === 'card' ? m.gateway : m.bank_name) || '';

/** Logo picked automatically from the selected provider; empty when the admin must upload one. */
export function autoLogo(m: Partial<PaymentMethod>) {
  if (m.type === 'cod') return logoPath('cash-on-delivery');
  if (m.type === 'raast') return logoPath('raast');
  // Customers see a card logo; the gateway behind it is an admin detail.
  if (m.type === 'card') return logoPath('card');
  const p = all.find((x) => x.name === providerName(m));
  if (p) return logoPath(p.slug);
  return '';
}

export const methodLogo = (m: Partial<PaymentMethod>) => autoLogo(m) || m.logo || '';
