import type { Request } from 'express';
import type { Row } from './db.js';

/**
 * Card gateway adapters. Card numbers and CVV never reach this server: the browser hands them to the
 * gateway (see apps/web/lib/cardGateways.ts), which returns a single-use token that is charged here with
 * the secret key saved in Admin → Payments.
 */
export type CardCharge = {
  /** The saved card payment method, including its secret settings. */
  method: Row;
  token: string;
  /** Amount in paisa. */
  amount: number;
  currency: 'PKR';
  reference: string;
  customer: { name: string; email: string; phone: string };
};
export type CardResult =
  | { status: 'paid'; transaction_id: string }
  /** 3-D Secure or another customer step; the webhook confirms the outcome later. */
  | { status: 'requires_action'; transaction_id: string; redirect_url: string }
  | { status: 'failed'; message: string };
export type CardWebhookResult = {
  reference: string;
  status: 'paid' | 'failed';
  transaction_id: string;
  message?: string;
};
export interface CardGateway {
  charge(charge: CardCharge): Promise<CardResult>;
  /** Verify the gateway's signature (req.rawBody + method.webhook_secret) and describe the event. */
  webhook?(req: Request & { rawBody?: Buffer }, method: Row): Promise<CardWebhookResult | null>;
}

/** Register adapters by the gateway name chosen in the admin panel, e.g. `Safepay: safepayGateway`. */
export const cardGateways: Record<string, CardGateway> = {};

export const cardGateway = (method: Row | undefined) =>
  method?.type === 'card' ? cardGateways[method.gateway] : undefined;
