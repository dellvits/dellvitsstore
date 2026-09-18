import type { PaymentMethod } from './types';
import { logoPath } from './paymentProviders';

export type CardBrand = {
  /** Matches the accepted-card names saved in Admin → Payments. */
  name: 'Visa' | 'Mastercard' | 'UnionPay' | 'PayPak' | 'American Express';
  logo: string;
  pattern?: RegExp;
  lengths: number[];
  cvc: number;
};
export const cardBrands: CardBrand[] = [
  { name: 'Visa', logo: logoPath('visa'), pattern: /^4/, lengths: [13, 16, 19], cvc: 3 },
  {
    name: 'Mastercard',
    logo: logoPath('mastercard'),
    pattern: /^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/,
    lengths: [16],
    cvc: 3,
  },
  { name: 'American Express', logo: logoPath('amex'), pattern: /^3[47]/, lengths: [15], cvc: 4 },
  { name: 'UnionPay', logo: logoPath('unionpay'), pattern: /^62/, lengths: [16, 17, 18, 19], cvc: 3 },
  // PayPak numbers are not matched by prefix; the gateway identifies them.
  { name: 'PayPak', logo: logoPath('paypak'), lengths: [16], cvc: 3 },
];

export const detectBrand = (digits: string) => cardBrands.find((b) => b.pattern?.test(digits));

export const formatCardNumber = (digits: string) =>
  detectBrand(digits)?.name === 'American Express'
    ? digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '))
    : digits.replace(/(\d{4})(?=\d)/g, '$1 ');

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export type CardInput = { number: string; name: string; expiry: string; cvc: string };
export type CardErrors = Partial<Record<keyof CardInput, string>>;

export function validateCard(card: CardInput, accepted: string[]): CardErrors {
  const errors: CardErrors = {};
  const digits = card.number.replace(/\D/g, '');
  const brand = detectBrand(digits);
  if (brand && !accepted.includes(brand.name)) errors.number = `${brand.name} cards are not accepted.`;
  else if (!brand && !accepted.includes('PayPak')) errors.number = 'Enter a valid card number.';
  else if (!(brand ? brand.lengths : [16]).includes(digits.length) || !luhn(digits))
    errors.number = 'Enter a valid card number.';
  if (card.name.trim().length < 2) errors.name = 'Enter the name on the card.';
  const [mm, yy] = card.expiry.split('/').map(Number);
  const now = new Date();
  const expired = 2000 + yy < now.getFullYear() || (2000 + yy === now.getFullYear() && mm < now.getMonth() + 1);
  if (!mm || mm > 12 || !yy || expired) errors.expiry = !mm || mm > 12 || !yy ? 'Use MM/YY.' : 'This card has expired.';
  if (card.cvc.length !== (brand?.cvc || 3)) errors.cvc = `Enter the ${brand?.cvc || 3}-digit security code.`;
  return errors;
}

/**
 * Client side of a card gateway. `tokenize` must send the card details straight to the gateway (using
 * method.public_key / method.environment) and return its single-use token; card data must never be sent to
 * the Dellvit API. Pair each entry with a server adapter of the same name in apps/api/src/cards.ts.
 */
type ClientCardGateway = { tokenize(card: CardInput, method: PaymentMethod): Promise<string> };
const clientGateways: Record<string, ClientCardGateway> = {};

export async function tokenizeCard(card: CardInput, method: PaymentMethod) {
  const gateway = clientGateways[method.gateway || ''];
  if (!gateway)
    throw new Error('Card payments are not available right now. Please choose another payment method.');
  return gateway.tokenize(card, method);
}
