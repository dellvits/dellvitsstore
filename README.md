# Dellvit delivery platform

Responsive Next.js storefront and role-based workspaces backed by Express and SQLite. Categories, products, orders, campaigns, permissions, delivery settings, and payment settings are persisted in the API database.

## Start with real data

Requires Node.js 24 or later. Run commands from the project root. On PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

```powershell
npm.cmd install
$env:ADMIN_EMAIL = 'your-admin@example.com'
$env:ADMIN_NAME = 'Store owner'
# Set ADMIN_PASSWORD to a unique password of at least 12 characters in your local environment.
npm.cmd run bootstrap
npm.cmd run dev
```

Open `http://localhost:3000/admin/login`. Bootstrap creates only the super administrator; it never creates inventory, riders, customers, orders, or sample campaigns. It refuses to overwrite an existing super administrator. Remove ADMIN_PASSWORD from your shell environment after bootstrap.

For an existing installation, the one-time platform migration preserves all data and gives the earliest existing administrator super-admin access. Other existing administrators receive no module permissions until assigned by the super administrator. The migration does not delete existing demonstration records.

Configure your store in this order:

1. Delivery areas, service radius, and fees.
2. Categories and category images.
3. Outlets and their credentials; then products, images, prices, stock, and discounts.
4. Riders, assigned areas, availability, and delivery capacity.
5. Payment methods and customer instructions.
6. Website sections, hero artwork, banners, coupons, support details, and checkout settings.
7. Delegated administrator accounts and their module permissions.

## Workspaces

| Audience                            | Route                    | Access                                                                       |
| ----------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| Super administrator / administrator | `/admin/login`, `/admin` | Separate login endpoint; server-enforced module permissions                  |
| Outlet                              | `/portal/outlet`         | Own products and orders                                                      |
| Rider                               | `/portal/rider`          | Assigned deliveries, duty status, browser GPS sharing, delivery verification |
| Customer                            | `/account`, `/orders`    | Own profile, password, order summaries, tracking and cancellation            |

Administrator account creation, account disabling, permission changes, and session revocation are available only to the super administrator. Module permissions grant read and write access within that module. Account ownership restrictions remain enforced for customers, outlets, and riders. The workspace hides modules the administrator cannot access, and the API independently checks every request.

Existing secure cookie sessions, password hashing, origin checks, login rate limits, upload validation, private outlet documents, stock transactions, checkout idempotency, and delivery OTP verification are retained. Browsers use one account session at a time; use separate browser profiles for simultaneous roles.

## Store and operations controls

- Dynamic categories, images, product catalog, stock, outlet accounts, rider accounts, order progression and assignment.
- Homepage hero copy and artwork, ordered content sections, banners, advertising, and section visibility. Hero artwork has irregular curved feathered edges; the original artwork remains sharp.
- Store settings for support contacts, About copy, checkout pause and minimum order subtotal.
- Coupons with fixed or percentage discounts, minimum subtotal, start/end dates, and global redemption limits. Checkout validates discounts atomically against actual products and limits.
- Per-area delivery fees and radius; paused areas reject new orders. Automatic and manual dispatch respect rider availability and capacity.
- Customer directory with account disabling; administrator activity log with the latest 200 successful changes.
- Responsive layouts, searchable management lists, permission checkboxes, image uploads, explicit empty states, and customer order summaries.

Amounts in the API are integer paisa. Delivery pricing forms display PKR. Coupon and minimum-order forms explicitly label values in paisa.

## Customer experience

- Customers must sign in or create an account before placing an order; the API rejects guest orders with 401. The cart is kept while they sign in.
- On the first visit the browser location is detected and matched to the nearest delivery area within its radius. Customers can change it at any time. If no area covers them, the home page asks them to choose one.
- Home page: hero, benefits, **Good things near you** (products for the selected area), one section per category marked **Show on home page** (up to 8 products in two columns with **Explore all**), then a horizontally scrolling **Outlets near you** row with **Explore more**.
- Product cards show a cart icon; once an item is in the cart the icon becomes an arrow that opens the cart.
- Checkout has **Use my current location** to fill the doorstep latitude and longitude, which can still be edited by hand.

## Payments

Administrators manage payment methods in **Payments → Payment methods**. Each method can be enabled, disabled or deleted at any time. Supported types:

| Type                 | Details shown to the customer                                   |
| -------------------- | --------------------------------------------------------------- |
| Cash on delivery     | Rider collects cash                                             |
| Bank transfer (IBFT) | Bank name, account title, account number, IBAN (validated `PK`) |
| Mobile wallet        | JazzCash, Easypaisa, SadaPay, NayaPay or UPaisa; title, number  |
| Raast                | Account title and Raast ID (mobile number) or IBAN              |

For online methods the customer sends the order total, then enters the transaction ID (TID), the sender name and, optionally or when required, a receipt screenshot. The order shows **Verifying** until an administrator approves or rejects it in **Payments → Verification**. A rejection includes a reason, and the customer can resubmit. Outlets cannot accept an order and riders cannot complete it until the payment is verified. Transaction IDs cannot be reused across active orders.

No automatic gateway API is connected; verification is manual against your bank or wallet statement.

## Notifications

Customers, outlets, riders and administrators receive notifications for new orders, status changes, rider assignment, payments to verify, payment decisions, commissions, payouts and contact messages. The header bell shows the latest items with sound alerts; `/notifications` is a filterable inbox with mark read/unread and delete. **Desktop & mobile pop-ups** subscribes the device to Web Push, so notifications appear in Windows, macOS and Android system trays (iOS requires adding the site to the home screen). Push requires HTTPS or `localhost`. VAPID keys are generated once and stored in the database, or can be supplied with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.

## Rider commission

When creating or editing a rider, set a fixed amount per delivery or a percentage of the delivery fee, items subtotal or order total. Commission is recorded when a delivery is verified. Riders see their balance, today and weekly earnings, cash collected and per-order history under **Earnings**. Administrators open **Riders → Earnings & payouts** to review the statement and record payouts, which cannot exceed the balance.

## Rider tracking

Riders can enable GPS sharing during active deliveries. The browser asks for location permission; production requires HTTPS. Sharing works while the rider page is open, not as a background mobile service. Customer tracking is limited to their own active orders; completed and cancelled orders do not expose rider positions. The UI labels stale positions and reports accuracy and update time. Maps use OpenStreetMap and OSRM; an unavailable road route is explicitly identified.

## Configuration and commands

For Vercel storefront settings and backend hosting requirements, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

The API defaults to port 4000 and the web app to port 3000. Browser requests use the Next.js `/api` proxy. Environment examples are in the two app workspaces.

| Variable           | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `DATABASE_PATH`    | SQLite path, relative to API working directory unless absolute |
| `UPLOAD_DIR`       | Uploaded images and private documents                          |
| `WEB_ORIGIN`       | Exact web origin allowed for authenticated browser writes      |
| `PORT`             | API port                                                       |
| `NODE_ENV`         | Production enables HTTPS-only cookies                          |
| `TRUST_PROXY`      | Set only for the trusted reverse proxy configuration           |
| `API_INTERNAL_URL` | Web build/proxy destination; default `http://127.0.0.1:4000`   |
| `NEXT_DIST_DIR`    | Optional isolated web build folder for local previews          |

```text
npm run bootstrap  Create the first super administrator from environment credentials
npm run dev        Start API and web development servers
npm run typecheck  Check both TypeScript workspaces
npm test           Run isolated API integration tests
npm run build      Compile API and build the production web application
npm start          Run production builds
npm run format     Format source and documentation
```

`npm run seed` remains an explicit development-only fixture command. Do not run it for a real store. The original local demonstration logins are `admin@dellvit.local`, `customer@dellvit.local`, outlet IDs `DLV-001` through `DLV-005`, and rider IDs `DRV-001` / `DRV-002`, with the fixture password `Dellvit@2026`. These accounts are created only by the optional seed command or isolated tests.

SQLite and local uploads are the active storage. Hosting, HTTPS, backups, production routing, payment-gateway integration, background mobile tracking, MFA, SMS/email delivery, and deployment acceptance are separate operational work. See [docs/PLATFORM.md](docs/PLATFORM.md) for the API additions and access model.
