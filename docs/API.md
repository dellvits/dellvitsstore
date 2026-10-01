# Shared REST API

Local API base: `http://localhost:4000/api`. The browser uses the same-origin Next.js proxy at `/api`.

Content type is `application/json` unless uploading a multipart file. Money fields are **integer paisa**. All times are UTC ISO strings. All record IDs are opaque strings. Errors return `{ "error": "Readable message" }` with an HTTP status.

## Authentication

Browsers automatically receive and send the HttpOnly `dellvit_session` cookie. Flutter should request a bearer token:

```http
POST /api/auth/login
Content-Type: application/json
X-Client: mobile

{"login":"customer@dellvit.local","password":"Dellvit@2026"}
```

Response:

```json
{
  "user": {
    "id": "customer-1",
    "name": "Ayesha Khan",
    "email": "customer@dellvit.local",
    "phone": "03001234567",
    "address": "6th Road, Rawalpindi",
    "location_id": "rawalpindi",
    "role": "customer",
    "active": 1
  },
  "token": "opaque-secret-session-token"
}
```

For subsequent mobile requests send `Authorization: Bearer <token>`. Store this token securely, not in ordinary application preferences. Seven-day expiration requires login again. Logout invalidates the current token. Password changes invalidate the user's other sessions.

The same login endpoint accepts outlet customer IDs (`DLV-001`) and rider IDs (`DRV-001`). Public registration always creates a customer; roles cannot be chosen in the registration payload.

| Method | Path             | Purpose / access                                                                              |
| ------ | ---------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/health`        | Service health                                                                                |
| GET    | `/session`       | Current user or null; creates anonymous browser session if absent                             |
| POST   | `/auth/register` | Customer registration: name, email, phone, address, location_id, password (10–100 characters) |
| POST   | `/auth/login`    | Email or assigned login ID and password                                                       |
| POST   | `/auth/logout`   | Invalidate current session                                                                    |
| PATCH  | `/profile`       | Signed-in user's name, phone, address and location_id                                         |
| POST   | `/auth/password` | Signed-in user: current, password                                                             |

## Catalogue and contact

| Method | Path            | Parameters / result                                                                         |
| ------ | --------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/locations`    | Available areas: id, name, lat, lng                                                         |
| GET    | `/products`     | Optional `location`, `q`, `category`, `outlet`; returns active products from active outlets |
| GET    | `/products/:id` | Product details or 404                                                                      |
| GET    | `/outlets`      | Optional `location`; active outlets, featured first, each with `open`                       |
| GET    | `/outlets/:id`  | Public outlet details: description, opening hours, minimum order, `open`                    |
| POST   | `/ads/track`    | `views` (ad ids, up to 20) and/or `click` (one ad id); counts them for today. Rate limited   |
| POST   | `/contact`      | name, email, message; persists to admin inbox                                               |

Product fields: `id`, `outlet_id`, `outlet_name`, `name`, `description`, `category`, `price`, `effective_price`, `stock`, `max_per_order`, `unit`, `sku`, `location_id`, `discount`, `deal`, `images[]`, `includes`, `excludes`, `delivery_minutes`, `payment_methods[]` (accepted payment method IDs), `active`.

Categories: `Food`, `Groceries`, `Parcels`, `More`. `price` and `effective_price` are integer paisa. `discount` is an integer percentage from 0 to 90. `stock` is a nonnegative integer. `active` is 0 or 1.

## Checkout and orders

```http
POST /api/orders
Content-Type: application/json
Authorization: Bearer <token>

{
  "items": [{"product_id":"product-1","quantity":2}],
  "delivery": {
    "name":"Customer Name",
    "email":"customer@example.com",
    "phone":"03001234567",
    "address":"House 12, 6th Road, Rawalpindi",
    "location_id":"rawalpindi",
    "lat":33.6442,
    "lng":73.0713,
    "notes":"Please call at the gate."
  },
  "payment_method":"cod",
  "idempotency_key":"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
}
```

Generate a UUID for each checkout attempt and reuse it when retrying that attempt after a network error. Do not generate a new key merely to retry the same order. Server-side validation recalculates totals from the database, reserves stock in a transaction, creates the reference/OTP and assigns an active rider in the selected area when possible. Delivery coordinates must be within 8 km of the selected area's centre. Items must share one outlet and match the delivery area.

Success returns HTTP 201 with the order. The owner receives `otp`; staff never receive this field. The delivery snapshot does not modify the customer's saved profile. A guest can use the same endpoint with the browser session cookie. Signing into a customer account attaches that browser's guest orders to the account.

| Method | Path                 | Access / behaviour                                                                     |
| ------ | -------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/orders`            | Customer: own; guest: current session; outlet: own outlet; rider: assigned; admin: all |
| GET    | `/orders/:id`        | Same ownership rules; includes outlet, rider, items and events                         |
| PATCH  | `/orders/:id/status` | Authorized progression using `{ "status": "..." }`                                     |
| POST   | `/orders/:id/verify` | Assigned rider: `{ "otp": "123456", "cash_received": true }`                           |

State progression:

| Current            | Next      | Allowed actor                                                        |
| ------------------ | --------- | -------------------------------------------------------------------- |
| placed             | confirmed | Outlet owner or admin                                                |
| confirmed          | preparing | Outlet owner or admin                                                |
| preparing          | ready     | Outlet owner or admin                                                |
| ready              | picked_up | Assigned rider or admin                                              |
| picked_up          | delivered | Assigned rider, using verification endpoint and correct customer OTP |
| placed / confirmed | cancelled | Owning signed-in customer or admin                                   |

Cancellation restores stock transactionally, once. Completed/cancelled orders cannot advance. Five wrong OTP attempts create a 15-minute order-specific lock. OTP verification also has request rate limits. Invalid transitions return 400; forbidden actions return 403; inaccessible order IDs return 404.

Order fields include: id, reference, user_id, outlet_id, rider_id, recipient details, location/pin, notes, payment_method, subtotal, delivery_fee, total, status, created_at, deliver_by, delivered_at, outlet, rider, items[], events[] and owner-only otp.

## Product and image management

All `/manage/*` routes require a matching staff role. Outlet ownership is checked on every product operation.

| Method | Path                      | Access                                                                                             |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/manage/products`        | Admin: all; outlet: own only                                                                       |
| POST   | `/manage/products`        | Admin / outlet create                                                                              |
| PUT    | `/manage/products/:id`    | Admin / owner outlet edit or restore archived product                                              |
| DELETE | `/manage/products/:id`    | Admin / owner outlet archive; order history preserved                                              |
| POST   | `/manage/images`          | Admin / outlet, multipart field `file`, max 4 MB; returns `{ "url": "/api/media/<uuid>.webp" }`    |
| GET    | `/manage/outlet`          | Current outlet's management details                                                                |
| GET    | `/manage/payment-methods` | Admin / outlet: every payment method a product can accept, enabled or not, without account details |
| GET    | `/media/:name`            | Public generated WebP image only; PDF documents are not served here                                |

Create/update body:

```json
{
  "outlet_id": "outlet-1",
  "name": "Classic meal",
  "description": "A burger meal with sides.",
  "category": "Food",
  "price": 69000,
  "stock": 30,
  "max_per_order": 10,
  "unit": "1 meal",
  "sku": "BRG-CLASSIC",
  "location_id": "rawalpindi",
  "discount": 15,
  "deal": "Lunch favourite",
  "images": ["/images/food.webp"],
  "includes": "Burger, fries and drink",
  "excludes": "Extra toppings",
  "delivery_minutes": 30,
  "payment_methods": ["cod", "demo-bank"],
  "active": 1
}
```

`location_id` is the delivery area the product is listed in; the product form starts it at the outlet's area. `payment_methods` must name at least one existing method (unknown IDs are dropped), and checkout offers only the enabled ones. `includes`, `excludes`, `deal` and `sku` are optional; a non-empty `sku` must be unique within the outlet. Orders over `max_per_order` (1–99) are rejected.

Image URLs must be accepted local asset paths or uploaded media paths; arbitrary remote links are not accepted. PNG/JPEG/WebP uploads are decoded, resized and encoded as WebP.

## Administration

Every route below requires an active admin session. There is no client-provided role bypass.

| Method | Path                           | Purpose                                                          |
| ------ | ------------------------------ | ---------------------------------------------------------------- |
| GET    | `/admin/summary`               | Orders, delivered sales, in-progress orders, active outlets      |
| GET    | `/admin/outlets`               | All outlets with settings, product and order counts, and sales   |
| POST   | `/admin/outlets`               | Create outlet and its login account atomically                   |
| PUT    | `/admin/outlets/:id`           | Update outlet, its settings and account; optional password reset |
| GET    | `/admin/riders`                | Rider account details, never password hashes                     |
| POST   | `/admin/riders`                | Create a rider account                                           |
| PUT    | `/admin/riders/:id`            | Edit account, assigned area, active status and optional password |
| POST   | `/admin/locations`             | Create area: name, lat, lng                                      |
| PUT    | `/admin/locations/:id`         | Edit area                                                        |
| PATCH  | `/admin/orders/:id/assign`     | `{ "rider_id": "..." }`; rider must be active in matching area   |
| GET    | `/admin/outlets/:id/documents` | Private document metadata                                        |
| POST   | `/admin/outlets/:id/documents` | Multipart `file`; PDF header required; max 4 MB                  |
| GET    | `/admin/documents/:id`         | Authorized attachment download                                   |
| DELETE | `/admin/documents/:id`         | Delete private file and metadata                                 |
| GET    | `/admin/messages`              | Contact form inbox, each with `status` and `note`                |
| PATCH  | `/admin/messages/:id`          | `status` (`new`, `read`, `resolved`) and/or `note`               |
| GET    | `/admin/ads`                   | Optional `from`, `to`; `{ ads, days }` with views and clicks     |
| DELETE | `/admin/ads/:id/stats`         | Erase an ad's view and click counts                              |

Outlet write fields: name, phone, email, location_id, address, lat, lng, customer_id, password (required for create, optional for edit), image, category, active. Customer ID uses uppercase letters, digits and hyphens, length 3–30. The same value is the outlet login ID.

Rider write fields: name, email, phone, address, location_id, login_id, password (required for create, optional for edit), active. Login ID uses uppercase letters, digits and hyphens, length 3–30.

Ads are saved through `/admin/records/ads/:id` (PUT, PATCH `{ active }`, DELETE). Fields: name, advertiser, label, title, description, image, link, button, format (`banner`, `cover`, `strip`, `card`, `image`), theme, placements (one or more of `top`, `after_nearby`, `after_categories`, `after_outlets`, `bottom`, `search`, `outlets`), devices, location_ids, starts_at, ends_at, max_views, notes, position, active. The storefront receives the ads that are live right now in `GET /site` as `ads`. Advertisement links accept a local relative route or HTTPS URL. Script URLs are rejected. Contact form submission stores a message; it does not send an email itself. Reply links open the administrator's email app.

## Support chat

Signed-in customers, outlets and riders each have one conversation with the support team. Messages are sent as JSON (`{ "body": "…" }`) or as multipart form data with `body` and an optional `file` (PNG, JPEG or WebP picture, or a PDF, up to 4 MB). Files are private to the account and the support team.

| Method | Path                          | Notes                                                                    |
| ------ | ----------------------------- | ------------------------------------------------------------------------ |
| GET    | `/support`                    | `{ thread, messages }` for the signed-in account; marks replies as read  |
| POST   | `/support/messages`           | Send a message; rate limited                                             |
| GET    | `/support/files/:messageId`   | The attached file; the account it belongs to, or the support team        |
| GET    | `/admin/support`              | `{ me, threads, contact, team }`; needs the `messages` permission        |
| GET    | `/admin/support/:userId`      | `{ user, thread, messages }`; marks the account's messages as read       |
| POST   | `/admin/support/:userId/messages` | Reply; reopens the conversation and notifies the account             |
| PATCH  | `/admin/support/:userId`      | `status` (`open`, `closed`) and/or `assigned_to` (administrator id or null) |
| DELETE | `/admin/support/:userId`      | Delete the conversation and its files                                    |

`GET /notifications` also returns `support_unread`: replies waiting for the account, or for the support team, unread chat messages plus new contact form messages.

## Coupons

Coupons are saved through `/admin/records/coupons/:id`. Fields: name, code, type (`percent`, `fixed`, `delivery` for free delivery), value, max_discount (cap for percentages, 0 = none), minimum, limit and per_customer (0 = unlimited), first_order, location_ids (empty = every area), public, description, starts_at, ends_at, active.

| Method | Path                        | Notes                                                                 |
| ------ | --------------------------- | --------------------------------------------------------------------- |
| GET    | `/coupons?location=`        | Public coupons that are running and valid in the area, for checkout   |
| GET    | `/admin/coupons`            | Optional `from`, `to`; every coupon with uses, discount and sales     |
| GET    | `/admin/coupons/:id/orders` | The latest 50 orders the coupon was used on                           |

`POST /quote` and `POST /orders` refuse a coupon with the reason: unknown code, not started, expired, wrong area, minimum not reached, fully redeemed, already used by this customer, or first order only.

## Administrators, activity and account controls

Only super administrators reach the staff routes. The owner account (the administrator whose email is `OWNER_EMAIL`, by default `dellvitsupport@gmail.com`) is returned with `is_owner: true` and every write to it is refused with 403. An administrator cannot change, disable or delete their own account through these routes either.

| Method | Path                          | Notes                                                                                   |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/admin/staff`                | `{ permissions, me, users }`; each user has role flags, title, sessions, 30-day changes |
| PUT    | `/admin/staff/:id`            | name, email, phone, title, password (12+, required for new), active, super, permissions |
| PATCH  | `/admin/staff/:id`            | `{ active }`; disabling signs the administrator out                                     |
| POST   | `/admin/staff/:id/sign-out`   | Ends every session of that administrator                                                |
| DELETE | `/admin/staff/:id`            | Removes the administrator; their activity log entries stay                              |
| GET    | `/admin/audit`                | Optional `from`, `to`; the latest 1,000 changes with the administrator's name and email |
| GET    | `/profile/sessions`           | The signed-in account's devices: `id`, `current`, `created_at`, `user_agent`            |
| DELETE | `/profile/sessions[/:id]`     | Signs out one other device, or every other device                                       |
| PUT    | `/notifications/preferences`  | `{ muted: [...] }` of `order`, `delivery`, `payment`, `earning`, `payout`, `message`    |
| POST   | `/notifications/test`         | Sends the account a test notification                                                   |
| DELETE | `/notifications?all=1`        | Empties the inbox; without `all` only read notifications are removed                    |

Store settings (`/admin/records/settings/global`) also accept: tagline, support_hours, whatsapp, facebook_url, instagram_url, tiktok_url, youtube_url, footer_note, notice_enabled, notice, checkout_message, signup_enabled, contact_form_enabled, chat_enabled, chat_greeting. With `signup_enabled`, `contact_form_enabled` or `chat_enabled` off, registration, the contact form and new chat messages are refused with 403. Support chat is refused for visitors who are not signed in and for customers whose email is not verified.

Ads accept three more placements: `search_inline`, `outlet` and `product`.
