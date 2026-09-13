# Architecture and the Flutter / Supabase next phase

## Current boundaries

The Next.js frontend requests `/api/*`. A server-side rewrite sends those requests to the Express service. Express owns validation, authentication, role authorization, stock, totals, order state transitions, OTP verification and persistence.

SQLite is opened only by the API. The frontend never receives a database path or database credentials. Browser storage holds only basket drafts and the selected delivery area, not authoritative accounts, orders or inventory.

The data model includes locations, users, sessions, outlets, products, orders, order items, order events, private documents, contact messages and site settings. Product images are public generated filenames; document bytes are served only through admin-authorized download endpoints.

Money is stored as integer paisa. A price of `69000` means PKR 690. Discounted prices are rounded to the nearest paisa. The checkout transaction reads current active products, checks stock, enforces the selected delivery area and one outlet, reserves stock, creates the order and creates its event/item records atomically.

A unique idempotency key prevents a network retry from creating another order. A single synchronous SQLite connection with `BEGIN IMMEDIATE` serializes write transactions. This suits local development and a single small server; it is not a horizontally distributed deployment.

## Authentication and authorization

Passwords use scrypt with random per-password salts. Sessions use random 256-bit opaque tokens whose SHA-256 hashes are stored in SQLite. Browser tokens are HttpOnly, SameSite=Lax cookies; secure cookies are enabled for production. Password changes invalidate other sessions. Role and resource ownership checks run on the server, independently of the visible portal navigation.

The API supports mobile bearer tokens: login/register with `X-Client: mobile` and store the returned token using Flutter's secure storage. Subsequent calls send `Authorization: Bearer TOKEN`. Tokens expire after seven days; this implementation requires another login after expiry and has no refresh-token flow.

Browser writes reject unapproved origins; cookie-authenticated writes require an Origin header. Requests authenticated with bearer tokens do not depend on browser cookie-origin checks. Rate limits protect login, checkout, uploads, contact submissions and delivery-code attempts. Production needs shared rate-limit storage if the API has multiple instances.

Delivery OTPs are six random digits, visible only to the order's owning customer/session. Staff serialization omits OTP and guest session identifiers. Riders must be assigned to the order and must have picked it up before verification. Five incorrect attempts create a persistent 15-minute lock. Completion requires confirmation of cash collection and the correct code. OTPs are stored in the database to allow the customer to retrieve their code; production can encrypt these at rest with a managed key.

## Flutter integration

Build the mobile customer, outlet and rider experiences against the same endpoints in `API.md`. Use a configurable API base URL, secure token storage and shared response types. Use device GPS permission only for a feature that needs it. Real-time location updates and push notifications can be added later without changing which service owns orders.

Do not expose the SQLite file to the app. Sharing a database means sharing the API that owns that database.

For Android emulator development the host is normally `10.0.2.2`; a physical device uses the computer's LAN address. A deployed app uses the HTTPS API hostname. Browser CORS settings are not Flutter network configuration.

## Moving to Supabase Postgres

This is an explicit backend migration, not an environment-variable-only switch.

1. Keep the Express endpoint contract and client request shapes stable.
2. Create the same relational model in Supabase Postgres using migrations. Convert SQLite integer booleans, text timestamps and JSON strings to suitable Postgres types. Preserve user/order/outlet IDs and integer paisa.
3. Replace `DatabaseSync`, question-mark parameters and synchronous helpers in `db.ts` / `app.ts` with a Postgres data layer. Use server-side transaction support for checkout, stock restoration and order completion.
4. Replace SQLite `BEGIN IMMEDIATE` serialization with transactional row locks or conditional stock updates. Preserve the unique idempotency key and validate it under concurrent requests.
5. Migrate data in dependency order: locations, users, outlets, products, orders, order items/events, sessions if desired, documents, messages and settings.
6. Move uploaded images and documents to separate public/private Supabase Storage buckets. Return public product image URLs and short-lived signed document URLs only after admin authorization.
7. Keep service-role credentials exclusively in Express. If Flutter continues to use Express, do not ship those credentials or database access to the app.
8. Decide separately whether to retain current password/session authentication or move to Supabase Auth. If changing auth, preserve application roles in a server-controlled mapping and plan account migration/reset flows.
9. Run the same integration tests against Postgres and add concurrent stock tests before switching traffic. Back up the SQLite database and upload directory before cutover.

If you instead decide to access Supabase directly from Flutter, that is a separate architecture change requiring complete RLS policies and transactional server functions. The recommended path for this project is to keep Express as the shared boundary.

## Deployment needs

Deploy Next.js and Express on a Node-compatible host. SQLite needs a persistent writable disk and one authoritative API instance. An ephemeral serverless filesystem is not durable storage. A multi-instance API should use Postgres before scaling horizontally.

Configure the Next.js API destination at build/runtime according to the host, the exact allowed browser origin, trusted proxy behavior and HTTPS cookies. Keep database files, private documents and secrets outside the web public directory. Back up the database together with uploads, use an appropriate logging/monitoring system, and replace the example accounts before public use.
