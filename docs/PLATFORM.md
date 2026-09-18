# Platform administration additions

This document supersedes the older feature boundaries in API.md and ARCHITECTURE.md where they describe hard-coded categories, COD-only checkout, a single administrator role, or absent browser GPS.

## Authorization

The database keeps the existing `admin` role for compatibility and stores `is_super_admin` and module permissions in `admin_access`. Public session responses include these two access fields. The first existing administrator is migrated once to super administrator; an empty installation uses `npm run bootstrap` with environment credentials.

`POST /api/auth/admin-login` authenticates only administrators. `POST /api/auth/login` rejects administrators. Both use the existing rate-limited password verification and rotated opaque HTTP-only cookie session. Credentials cannot be used to cross the login boundary. There is no public administrator registration.

Module checks apply to all `/admin/*` requests and to the shared `/orders/*` and `/manage/*` endpoints when the caller is an administrator. Only a super administrator can access `/admin/staff`. Unknown admin modules are denied to delegated admins. Staff updates revoke existing sessions. A super administrator cannot be demoted or disabled through the staff form.

Module access grants both read and write operations. Some workflows need multiple modules: payment review requires Payments and Orders; rider selection requires Orders and Riders. Product outlet selectors use a limited lookup rather than granting full outlet management access.

## Added API endpoints

All paths below start with `/api`.

| Path                          | Method    | Audience / purpose                                                           |
| ----------------------------- | --------- | ---------------------------------------------------------------------------- |
| `/site`                       | GET       | Public categories, active content, payment methods, and store settings       |
| `/categories`                 | GET       | Active category records                                                      |
| `/payments`                   | GET       | Enabled checkout methods; no secret credentials                              |
| `/quote`                      | POST      | Product-based subtotal, delivery fee, coupon discount, total                 |
| `/admin/records/:kind`        | GET       | Module-authorized list, including disabled records                           |
| `/admin/records/:kind/:id`    | PUT       | Validated create/update for categories, content, coupons, payments, settings |
| `/admin/staff`                | GET       | Super administrator: staff and supported permissions                         |
| `/admin/staff/:id`            | PUT       | Super administrator: create/update staff and revoke their sessions           |
| `/admin/customers`            | GET       | Customer directory with actual order totals                                  |
| `/admin/customers/:id`        | PATCH     | Enable/disable a customer and revoke disabled sessions                       |
| `/admin/audit`                | GET       | Latest 200 successful administrator mutations                                |
| `/admin/area-settings`        | GET       | All areas, including paused areas, with pricing and radius                   |
| `/admin/area-settings/:id`    | PUT       | Set fee in paisa, radius in km, active state                                 |
| `/admin/tracking`             | GET       | Rider dispatch state, workload and last shared position                      |
| `/admin/rider-controls/:id`   | PUT       | Assignment availability and maximum active deliveries                        |
| `/admin/payments/:id/confirm` | PATCH     | Confirm receipt of a manual payment for an order                             |
| `/manage/product-outlets`     | GET       | Product-authorized minimal outlet selector data                              |
| `/rider/state`                | GET/PATCH | Own duty status; going off duty clears the stored position                   |
| `/rider/location`             | POST      | Own GPS position during an assigned active delivery                          |

The settings record uses ID `global`. Category names update corresponding products and outlets when renamed. Records are disabled instead of destructively deleted. Historical orders retain their original product names, prices, payment instructions, and discounts.

## Checkout and tracking

Checkout accepts `payment_method` as a configured method ID and optional `coupon_code`. Prices and discounts are computed from the database inside the existing order transaction. One coupon redemption is persisted per order; replaying the same idempotency key does not consume an additional redemption. Cancellation does not release a coupon redemption. Coupon limits are global, not per customer.

Quotes are advisory. Final checkout revalidates availability, stock, delivery area, radius, checkout pause, minimum subtotal, payment method, and coupon state. Client totals never determine the order amount.

Payment methods are `cod` or `manual`. There is no simulated gateway. Transfer confirmation is a deliberate administrator action after external verification. The rider must still verify the delivery OTP. Historical manual transfers are not automatically refunded on cancellation.

Rider assignment checks active account, area, availability, and capacity. Location endpoints derive rider identity from the authenticated session. Order serialization shares the assigned rider's location only through the normal order-ownership checks, and hides it once the order is delivered or cancelled. The timestamp and accuracy are included so stale positions are distinguishable from recent positions.

## Storage and migration

Additional tables are created without rebuilding or deleting existing core tables: `admin_access`, `platform_records`, `area_settings`, `rider_state`, `audit_log`, `order_details`, and `coupon_uses`. Existing category names are migrated from real existing products/outlets. Cash on delivery is the initial operating payment configuration. Empty stores receive no inventory, customers, rider accounts, orders, or campaigns automatically.

The existing `seed` command is explicitly development-only. Browser review fixtures use a separate database under the ignored `data/ux-review` directory. They do not alter an existing store database.
