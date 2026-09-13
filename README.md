# Dellvit — web delivery platform

A runnable web project based on the supplied Dellvit design, brand assets and client requirements. The frontend uses **Next.js 16.3.4, React 19, TypeScript and Tailwind CSS 4**. The separate backend uses **Express 5, TypeScript and SQLite** through Node's built-in SQLite driver.

The customer website, admin dashboard, outlet portal and rider portal use the same REST API. The future Flutter app can use this API as well; it should never connect directly to the SQLite file.

## Quick start — Windows, macOS or Linux

Install **Node.js 24 LTS** first. Extract this ZIP, open a terminal inside `dellvit-web`, and run:

```bash
npm install
npm run seed
npm run dev
```

Run these commands **once from the project root**. npm workspaces install the web and API dependencies together; you do not need separate installs inside the two app folders.

Open **http://localhost:3000**. Express runs at **http://localhost:4000**. The Next.js `/api/*` proxy keeps browser requests and cookies on the web origin.

`npm run seed` creates the example delivery areas, outlets, products and accounts. It is safe to run again; it does not overwrite an existing database. The app does not automatically recreate demo accounts on every startup.

## Demo accounts

All the following **local demo accounts** use password **`Dellvit@2026`**.

| Role                       | Login                    | Page             |
| -------------------------- | ------------------------ | ---------------- |
| Administrator              | `admin@dellvit.local`    | `/admin`         |
| Customer                   | `customer@dellvit.local` | `/account`       |
| Burger Kitchen outlet      | `DLV-001`                | `/portal/outlet` |
| Fresh Basket outlet        | `DLV-002`                | `/portal/outlet` |
| Parcel Point outlet        | `DLV-003`                | `/portal/outlet` |
| Everyday Essentials outlet | `DLV-004`                | `/portal/outlet` |
| Capital Burger outlet      | `DLV-005`                | `/portal/outlet` |
| Rawalpindi rider           | `DRV-001`                | `/portal/rider`  |
| Islamabad rider            | `DRV-002`                | `/portal/rider`  |

Use separate browser profiles or different browsers when demonstrating customer, outlet and rider accounts simultaneously. Each browser session has one signed-in role. Signing out of a staff account also allows guest checkout.

The demo stores, product descriptions, prices, stock, staff details and delivery estimates are sample data, not verified merchant listings. The client-provided Dellvit contact information is used as supplied.

## Environment setup

No environment file is required for the default local setup. To customize it, copy the examples:

**PowerShell**

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

**macOS / Linux**

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

| File                  | Variable           | Default / purpose                                                                    |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `apps/api/.env`       | `PORT`             | `4000`                                                                               |
| `apps/api/.env`       | `WEB_ORIGIN`       | `http://localhost:3000`; exact browser origin allowed to make authenticated requests |
| `apps/api/.env`       | `DATABASE_PATH`    | `./data/dellvit.sqlite`, resolved relative to the API workspace                      |
| `apps/api/.env`       | `UPLOAD_DIR`       | `./data/uploads`, resolved relative to the API workspace                             |
| `apps/api/.env`       | `NODE_ENV`         | `development` locally; `production` enables HTTPS-only cookies                       |
| `apps/api/.env`       | `TRUST_PROXY`      | `0`; set to `1` only behind one known reverse proxy                                  |
| `apps/web/.env.local` | `API_INTERNAL_URL` | `http://127.0.0.1:4000`; backend destination for the Next.js proxy                   |

Keep `.env` files and the `data/` folder out of source control. The ZIP intentionally excludes installed dependencies, build output and databases containing sessions or test orders.

### Testing on your phone over Wi-Fi

Use your computer's LAN IP, for example `192.168.1.103`. Set `WEB_ORIGIN=http://192.168.1.103:3000` in the API environment, restart both apps, and open that exact URL on your phone. The frontend always uses `/api`, so it will not try to connect to the phone's own localhost. Allow port 3000 through the local firewall. Development over a LAN uses HTTP; production requires HTTPS.

Next.js may ask you to configure `allowedDevOrigins` for your LAN host in `apps/web/next.config.ts`. Add the IP to the existing configuration if your local Next.js development origin check requests it. The API origin setting and Next.js development origin setting are separate controls.

## What is implemented

### Customer web experience

- Responsive Dellvit homepage using the supplied logo and red, orange, gold and cream palette.
- Generated WebP phone concept, rider and four service-category images. Generated prompts are included.
- Header navigation for Home, Search, Cart, Orders, Outlets, About, Contact, Log in and Sign up, with a mobile menu.
- Delivery-area selection that filters actual product and outlet locations.
- Search, category filters, price sorting and discount sorting.
- Outlet pages and product detail pages with photos, quantity, unit, original/discounted price, included/excluded items and estimated delivery time.
- Device-local basket drafts, quantity updates, remove and clear actions. Checkout validates against the database.
- Customer registration, login, profile updates and password change.
- Saved customer delivery details, an order-only address override and delivery notes.
- Guest checkout and guest order history tied to a private browser session. Guest orders are attached to a customer account when that browser registers or logs in as a customer.
- Cash-on-delivery checkout with server-controlled totals, a unique reference and a private six-digit delivery OTP.
- Order status timeline, rider contact details and pickup/drop map.
- Cancellation before preparation for signed-in customers, with stock restoration.
- Contact form stored in the admin inbox; working telephone and email links.

### Admin dashboard

- Order counts, in-progress orders, active outlets and delivered sales totals.
- Create/edit/disable outlets with name, phone, email, delivery area, pickup address, coordinates and a unique customer ID used for login.
- Set or reset outlet passwords without revealing existing passwords.
- Product creation, editing, archive/restore, images, prices, stock, discounts, deal labels and service areas.
- Product image uploads converted to WebP on the server.
- PDF document upload, download and deletion for each outlet; **admin-only API authorization**. Outlet accounts have no document access.
- Create/edit/disable rider accounts and assign their delivery areas.
- Automatic rider selection at checkout and manual reassignment by admins.
- Order progression and early cancellation.
- Create/edit delivery areas.
- Editable homepage advertisement: image, label, text, link and visibility.
- Contact-message inbox with reply-by-email links.

### Outlet portal

- Login using customer ID and password.
- Manage only the outlet's own products, images, stock and deals.
- See only that outlet's orders and delivery details.
- Accept orders, start preparation and mark orders ready for pickup.
- No access to private documents, other outlets' products or customer delivery OTPs.

### Rider portal

- Assigned deliveries only, with pickup address, drop address, notes and customer contact.
- COD amount and a delivery countdown.
- OpenStreetMap map and OSRM road route, plus a Google Maps navigation link.
- Confirm pickup once the outlet marks the order ready.
- Confirm cash collection and enter the customer's delivery OTP to complete delivery.
- Five incorrect OTP attempts lock verification for 15 minutes. Riders cannot retrieve the customer's OTP through the API.

## Run the delivery demo

1. Select **6th Road, Rawalpindi** and add a Burger Kitchen product.
2. Check out as the customer or a guest. Choose a delivery pin within 8 km of the area centre.
3. Note the displayed order reference and delivery code on the customer order page.
4. In another browser profile, log in as `DLV-001`. Accept the order, start preparation and mark it ready.
5. In another browser profile, log in as `DRV-001`. Open the assigned delivery and confirm pickup.
6. Confirm cash collection, enter the customer's six-digit code and complete the delivery.
7. The customer timeline and admin totals update on their next automatic refresh.

For an area with no active rider, an order is saved as awaiting assignment. Create or activate a rider in that area, then assign them through the admin order panel.

## Commands

```bash
npm run dev         # Web and API together
npm run seed        # Seed an empty local database
npm run typecheck   # Check frontend and backend TypeScript
npm test            # Isolated API integration suite
npm run build       # Compile Express and build Next.js
npm start           # Run both production builds locally
npm run format      # Format authored source and docs
```

For local testing with `npm start`, keep `NODE_ENV=development` in the API unless you are serving HTTPS. Next.js itself uses its production build; the API's `NODE_ENV=production` deliberately makes session cookies secure.

## Project structure

```text
dellvit-web/
  apps/
    web/                 Next.js App Router frontend
      app/               Routes, layout and responsive stylesheet
      components/        Customer screens and staff portals
      lib/               API client, types and state loading
      public/images/     Supplied branding and generated WebP assets
    api/                 Separate Express backend
      src/app.ts         Validated endpoints and role/ownership checks
      src/db.ts          SQLite schema, queries and transactions
      src/security.ts    Password hashing and opaque sessions
      src/seed.ts        Explicit demo seed
      src/index.ts       HTTP server
  tests/api.test.ts      Isolated workflow and authorization tests
  docs/                 API contract, requirements and migration notes
  package.json          Root workspace commands
```

## Important boundaries for this web version

- Flutter is not built in this ZIP. `docs/API.md` describes the shared API for that next phase.
- Supabase is not connected yet. SQLite is the active database; see `docs/ARCHITECTURE.md` for the Postgres migration plan.
- Payment is cash on delivery. No card, JazzCash or Easypaisa gateway is connected.
- Maps require internet access. OSRM's public demo routing service has no service guarantee; the UI explicitly marks the fallback as a connector between locations, not a drivable route. Replace public demo routing with a production service before launch.
- Order status polling is implemented. Live rider GPS streaming, background app tracking, SMS/email OTP dispatch and push notifications are not implemented. The delivery OTP is shown directly on the customer's order screen, as the brief specifies.
- The advertising area is functional and admin-editable. An external ad-network account or script is not connected.
- Guest history is tied to that browser's seven-day session. Account order history persists in the database after sign-in.
- A basket holds one outlet's products at a time; checkout enforces this. Products and delivery fees use integer paisa to avoid floating-point money calculations. The default delivery fee is PKR 150, configurable in `src/app.ts` and the shared frontend fee constant.
- Parcel listings represent a pickup from the listed outlet. A separate arbitrary-origin courier booking flow was not specified in the PDF and is not included.
- Uploaded outlet documents are PDF-only, up to 8 MB. Product uploads accept raster images and convert them to WebP. Malware scanning and full document-content validation require a production upload pipeline.
- This is a locally runnable implementation for client review. Before public launch, replace demo data and passwords, confirm real service areas/fees/policies, configure HTTPS and production hosting, schedule database/upload backups, and complete deployment-specific security and browser/device acceptance testing.

## Validation performed

The delivered source passes the Next.js production build and TypeScript checks. The included API integration suite exercises catalog filtering, guest isolation, server pricing, duplicate checkout, stock handling, role boundaries, order transitions, OTP lockout/completion, cancellation, product/outlet/rider management, private document handling, WebP upload, contact/advertisement persistence and account changes. See `docs/VALIDATION.md` for the recorded results and limits.

No browser or physical-device visual acceptance test was performed in this build session. Responsive layouts are implemented in source, and page assets were inspected separately.

## References

The supplied PDF and design are the product specification. [Oderela](https://www.oderela.com/) was reviewed for the location-filtered outlet/product concept; no source code or merchant photography was copied. Framework references: [Next.js](https://nextjs.org/docs), [Express](https://expressjs.com/en/5x/api/), [Node SQLite](https://nodejs.org/api/sqlite.html).
