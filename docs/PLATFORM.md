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
| `/payments`                   | GET       | Enabled checkout methods; `?products=a,b` keeps those every product accepts  |
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

Outlet settings (`outlet_settings`) hold the commission rate, whether the outlet is taking orders, opening hours (`opens_at`/`closes_at`, Pakistan time as `HH:MM`, both empty for 24 hours), a minimum order in paisa, the featured flag and a storefront description. Checkout refuses orders while an outlet is paused, outside its hours, or below its minimum. The contact person, settlement account and internal notes are returned only to administrators.

`DELETE /admin/riders/:id` deletes a rider: it is refused while the rider has an order in progress, cash in hand, unpaid earnings or a deposit or payout request waiting for review; a rider with history is closed for good with the sign-in and personal details erased (the name stays on past orders and payments), and one with no history is removed outright. Rider settings (`rider_settings`) hold the commission plus the vehicle, CNIC, licence, emergency contact, usual payout account and internal notes; the notes are returned only to administrators. `GET /admin/riders` returns each rider with these, their duty state, capacity, last position, load and balances in one query, and `PATCH /admin/riders/:id` changes `active`, `available` or `capacity` on its own. A rider saved without an email gets a placeholder address, since riders sign in with their rider ID.

Area settings (`area_settings`) hold whether the area takes orders, its radius and delivery fee, plus a minimum order, a free-delivery threshold (`free_delivery_over`, on the item subtotal) and delivery hours (`opens_at`/`closes_at`, Pakistan time). `/quote` and checkout apply the free threshold; checkout also refuses orders below the area minimum or outside its hours. `POST`/`PUT /admin/locations` save an area and its settings in one request, `PATCH /admin/area-settings/:id` switches `active` alone, and `DELETE /admin/locations/:id` deletes an area: it is refused while the area has an order in progress or outlets or products that are not deleted; accounts in the area are left without one; an area with past orders is closed and hidden for good (`deleted_at`) and one with no history is removed outright. `GET /admin/area-settings` and `GET /admin/riders` accept `from`/`to` for their time-frame figures.

Customer accounts verify their email before they can sign in. `POST /auth/register` creates the account without a session and emails a 6-digit code (10 minutes, 5 attempts, one resend a minute); `POST /auth/verify-email` checks it and signs the customer in; `POST /auth/resend-code` sends another. Signing in before that returns 403 with `code: "verify_email"` and sends a fresh code. Outlets, riders and administrators are not asked to verify. Each account can be sent one code a minute and five an hour; the server enforces both and answers 429 with `retry_in` seconds. Email is sent with nodemailer using the SMTP details saved under Store settings (`GET`/`PUT /admin/email-settings`, `POST /admin/email-settings/test`; the password is stored in the private `settings` table and never returned), falling back to `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`; only a hash of each code is stored (`email_codes`).

Administrators with the `customers` module can list customers with their order history (`GET /admin/customers`, with `from`/`to`), add and edit them, block them or mark the email verified (`PATCH`), email a new code, sign them out everywhere and delete them. Deleting a customer with past orders closes the account and erases its personal details while the orders stay; a customer with an order in progress cannot be deleted.

Home page content records have a `type` (`hero`, `section`, `banner`, `announcement`, `embed`), a `layout`, a colour `theme`, a `placement` slot on the page, a `devices` setting, optional `location_ids` (areas that see the block), an optional schedule (`starts_at`/`ends_at`) and, for video blocks, a YouTube or Vimeo `embed_url`. `/site` returns only enabled content that is inside its schedule; area and device targeting are applied in the browser. The blocks are rendered by `apps/web/components/ContentBlocks.tsx`, which the admin editor also uses for its live preview.

Category records also carry `home_limit` (products in the home page section, 1–24), `show_in_filters` (storefront filter chips) and an optional `commission_rate` that new outlets in the category start on; the commission is never returned by public routes. The admin list adds how many products and outlets use each category.

The settings record uses ID `global`. Category names update corresponding products and outlets when renamed. Records are disabled instead of destructively deleted. Historical orders retain their original product names, prices, payment instructions, and discounts.

## Checkout and tracking

Checkout accepts `payment_method` as a configured method ID and optional `coupon_code`. Prices and discounts are computed from the database inside the existing order transaction. One coupon redemption is persisted per order; replaying the same idempotency key does not consume an additional redemption. Cancellation does not release a coupon redemption. Coupon limits are global, not per customer.

Quotes are advisory. Final checkout revalidates availability, stock, per-order limits, delivery area, radius, checkout pause, minimum subtotal, payment method (enabled and accepted by every item), and coupon state. Client totals never determine the order amount.

Each product selects the payment methods it accepts, so adding a method offers it nowhere until products select it. Disabling a method hides it on every product but keeps their selections, so enabling it again restores them. Deleting a method removes it from every product. Payment methods are `cod` or `manual`. There is no simulated gateway. Transfer confirmation is a deliberate administrator action after external verification. The rider must still verify the delivery OTP. Historical manual transfers are not automatically refunded on cancellation.

Rider assignment checks active account, area, availability, and capacity. Location endpoints derive rider identity from the authenticated session. Order serialization shares the assigned rider's location only through the normal order-ownership checks, and hides it once the order is delivered or cancelled. The timestamp and accuracy are included so stale positions are distinguishable from recent positions.

## Storage and migration

Additional tables are created without rebuilding or deleting existing core tables: `admin_access`, `platform_records`, `area_settings`, `rider_state`, `audit_log`, `order_details`, and `coupon_uses`. Existing category names are migrated from real existing products/outlets. Cash on delivery is the initial operating payment configuration. Empty stores receive no inventory, customers, rider accounts, orders, or campaigns automatically.

The existing `seed` command is explicitly development-only. Browser review fixtures use a separate database under the ignored `data/ux-review` directory. They do not alter an existing store database.

## Advertising

Administrators with the `ads` permission manage any number of ads on the Advertising page. Each ad has:

- a design: banner (text beside a picture), cover (text over a picture), strip (one slim line), card (several side by side) or picture only, and a colour;
- one or more places: five slots on the home page, the top of the search page and the top of the outlets page. Several wide ads in one place take turns every few seconds; cards sit in a row of up to four;
- an audience: every delivery area or selected ones, and all devices, desktop only or mobile only;
- an optional schedule and an optional view limit, after which the ad stops by itself;
- a campaign name, advertiser and private notes that customers never receive.

Views and clicks are counted per ad per day (Pakistan time) in `ad_stats`. A view is counted once per browser session when at least half of the ad was on screen; staff accounts are not counted. The storefront reports them to `POST /api/ads/track`, which ignores unknown ads and is rate limited per visitor. Deleting an ad deletes its counts.

The `show_ad` switch in Store settings turns all advertising off. Migration `202610010008_ads.sql` creates `ad_stats` and turns the single banner used before into the first ad.

## Support chat and messages

Customers, outlets and riders reach the support team from the message icon in the header (`/support` for customers, the Support chat tab in the outlet and rider portals). Each account has one conversation, stored in `support_threads` (status, who handles it, unread counters, last message) and `support_messages`. Attachments are stored privately under `support/` in object storage: pictures are re-encoded as WebP, PDFs are kept as they are.

Administrators with the `messages` permission work in Admin → Messages: conversations waiting for a reply, assignment to a colleague, closing and reopening, quick replies, and the contact form inbox with new / read / resolved and a private note. A new message from either side reopens a closed conversation. The first unread message raises one notification, not one per message. Deleting a customer deletes their conversation and its files.

The chat is refreshed every few seconds while it is open; it is not a live socket connection.

## Coupons

Besides a percentage or a fixed amount, a coupon can give free delivery. Optional rules: a cap on a percentage discount, a minimum subtotal, a total number of redemptions, a number per customer, first order only, selected delivery areas and a schedule. A coupon marked public is listed at checkout for one-tap use. The Coupons page shows redemptions, discount given and sales for a chosen period, and the orders each coupon was used on.

## Administrators and the owner account

Admin access lists every administrator with role, job title, modules, last sign-in, signed-in devices and changes in the last 30 days. Super administrators add, edit, disable, sign out and delete administrators, including other super administrators. The owner account, set by `OWNER_EMAIL` (default `dellvitsupport@gmail.com`), is protected: nobody else can edit, disable, sign out or delete it. Deleting an administrator keeps their entries in the activity log, shown as "Deleted administrator".

## Accounts, devices and notifications

Every account has a profile inside its own workspace: `/account` for customers, and the Profile and Notifications tabs in the admin, outlet and rider portals. The profile shows details, a password form, and the devices the account is signed in on, with sign-out for each one or all others. Notification kinds can be silenced per account; a silenced kind still arrives in the inbox but plays no sound and sends no pop-up. Customers get a dashboard on `/account` (orders on the way, figures for a chosen period, outlets to order from again, offers); riders get a Dashboard tab (queues, earnings for a chosen period, deliveries in hand).

## Store settings

Store settings cover the store name and tagline, contact details (email, phone, WhatsApp, hours, address), social links and a footer note, ordering (accept orders, the message shown while paused, the minimum order), a notice bar across every store page, customer access (sign-ups, contact form, support chat and its welcome line), the built-in home page sections including category shortcuts, and the mail server.
