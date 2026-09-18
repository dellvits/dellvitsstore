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
| GET    | `/outlets`      | Optional `location`; active outlets                                                         |
| GET    | `/outlets/:id`  | Public outlet details                                                                       |
| GET    | `/ad`           | Homepage advertisement object                                                               |
| POST   | `/contact`      | name, email, message; persists to admin inbox                                               |

Product fields: `id`, `outlet_id`, `outlet_name`, `name`, `description`, `category`, `price`, `effective_price`, `stock`, `unit`, `location_id`, `discount`, `deal`, `images[]`, `includes`, `excludes`, `delivery_minutes`, `active`.

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

| Method | Path                   | Access                                                                                          |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/manage/products`     | Admin: all; outlet: own only                                                                    |
| POST   | `/manage/products`     | Admin / outlet create                                                                           |
| PUT    | `/manage/products/:id` | Admin / owner outlet edit or restore archived product                                           |
| DELETE | `/manage/products/:id` | Admin / owner outlet archive; order history preserved                                           |
| POST   | `/manage/images`       | Admin / outlet, multipart field `file`, max 4 MB; returns `{ "url": "/api/media/<uuid>.webp" }` |
| GET    | `/manage/outlet`       | Current outlet's management details                                                             |
| GET    | `/media/:name`         | Public generated WebP image only; PDF documents are not served here                             |

Create/update body:

```json
{
  "outlet_id": "outlet-1",
  "name": "Classic meal",
  "description": "A burger meal with sides.",
  "category": "Food",
  "price": 69000,
  "stock": 30,
  "unit": "1 meal",
  "location_id": "rawalpindi",
  "discount": 15,
  "deal": "Lunch favourite",
  "images": ["/images/food.webp"],
  "includes": "Burger, fries and drink",
  "excludes": "Extra toppings",
  "delivery_minutes": 30,
  "active": 1
}
```

Image URLs must be accepted local asset paths or uploaded media paths; arbitrary remote links are not accepted. PNG/JPEG/WebP uploads are decoded, resized and encoded as WebP.

## Administration

Every route below requires an active admin session. There is no client-provided role bypass.

| Method | Path                           | Purpose                                                          |
| ------ | ------------------------------ | ---------------------------------------------------------------- |
| GET    | `/admin/summary`               | Orders, delivered sales, in-progress orders, active outlets      |
| GET    | `/admin/outlets`               | All outlet records                                               |
| POST   | `/admin/outlets`               | Create outlet and its login account atomically                   |
| PUT    | `/admin/outlets/:id`           | Update outlet and associated account; optional password reset    |
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
| GET    | `/admin/messages`              | Contact form inbox                                               |
| PUT    | `/admin/ad`                    | title, description, label, link, image, active                   |

Outlet write fields: name, phone, email, location_id, address, lat, lng, customer_id, password (required for create, optional for edit), image, category, active. Customer ID uses uppercase letters, digits and hyphens, length 3–30. The same value is the outlet login ID.

Rider write fields: name, email, phone, address, location_id, login_id, password (required for create, optional for edit), active. Login ID uses uppercase letters, digits and hyphens, length 3–30.

Advertisement links accept a local relative route or HTTPS URL. Script URLs are rejected. Contact form submission stores a message; it does not send an email itself. Reply links open the administrator's email app.
