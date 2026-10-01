-- Removes the card payment integration and the payment method display order.
-- Safe to run more than once. Run in the Supabase SQL Editor, or use npm run db:migrate.
BEGIN;
SET LOCAL search_path TO dellvit, public;

-- Card payment methods, including their saved gateway keys and webhook secrets.
DELETE FROM platform_records WHERE kind = 'payments' AND (data::jsonb ->> 'type') = 'card';

-- Card settings and the display order left on the remaining payment methods.
UPDATE platform_records
SET data = (
  data::jsonb
    - 'position'
    - 'card_networks'
    - 'gateway'
    - 'environment'
    - 'merchant_id'
    - 'public_key'
    - 'secret_key'
    - 'webhook_secret'
    - 'api_base_url'
    - 'three_d_secure'
)::text
WHERE kind = 'payments';

COMMIT;
