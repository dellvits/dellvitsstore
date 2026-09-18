# Architecture

The Next.js frontend requests `/api/*`. Vercel Services routes those requests to Express in the same project and domain. Local development uses a Next.js rewrite to the API on port 4000. Express owns validation, authentication, role authorization, pricing, stock, order transitions, delivery verification and persistence.

## Supabase PostgreSQL

`apps/api/src/db.ts` uses a small node-postgres connection pool with verified TLS. Application queries run against the private `dellvit` schema. No database connection string or privileged credential is sent to the browser. The initial migration is in `supabase/migrations/202609180001_initial.sql`; migrations run explicitly, not on function startup.

The schema preserves existing IDs, integer paisa, integer flags, ISO timestamp strings and JSON text to retain the API contract and support importing existing data. `sort_order` identity columns replace SQLite's implicit row ordering for products and order events. PostgreSQL bigint aggregates are parsed as safe JavaScript integers.

Queries and request handlers are asynchronous. A transaction uses one checked-out connection; AsyncLocalStorage propagates that connection through nested helpers. A PostgreSQL transaction-scoped advisory lock serializes business writes across API instances, preserving the original single-writer behavior for stock, coupons, payouts and workflow transitions. This favors correctness for the current store workload; high write throughput would require finer-grained locks. Read-only requests do not take that lock.

The final handlers for write routes use `atomicRoute`, which includes validation reads in the transaction and delays the response until commit. Checkout has an explicit transaction so external card calls happen after inventory reservation commits. Unique idempotency keys prevent duplicate orders. An incorrect delivery OTP returns a validation response after saving the attempt count, so lockout survives subsequent requests. Outbound push notifications registered inside a transaction run only after commit and are awaited before the invocation completes.

## Cloudflare R2

`storage.ts` uses Cloudflare's S3-compatible endpoint. One private bucket contains `images/`, `proofs/` and `documents/` prefixes. Product images remain public through `/api/media/<id>.webp`; only that prefix can be read through the public route. Payment receipts require ownership or an authorized administrator, and PDFs use the administrator permission checks. Private responses use no-store caching. Public image filenames are immutable random IDs.

Image conversion uses Sharp in memory. Multipart files are limited to 4 MiB. Function instances create no upload directories or local database. Existing static artwork in `apps/web/public` remains a repository asset.

## Authentication and authorization

Existing scrypt passwords and opaque cookie/bearer sessions are retained; this migration does not switch to Supabase Auth. Session token hashes, administrator permissions, delivery OTP attempts and shared request-rate counters are stored in PostgreSQL. Browser cookies are HttpOnly and SameSite=Lax, with Secure enabled in production. Cookie-authenticated writes require the configured browser origin. Password changes invalidate other sessions.

Row level security is enabled without browser policies, and the private schema is not exposed through the Supabase Data API. The trusted backend uses the server-side database connection and enforces roles and resource ownership. Mobile apps must also call Express, rather than receive database/R2 secrets. Login/register with `X-Client: mobile` returns a bearer token; keep it in secure device storage. Tokens expire after seven days; there is no refresh-token flow.

## Migration and verification

`npm run import:local` reads a stopped, backed-up SQLite installation without modifying it, copies uploads, and imports records into a fresh PostgreSQL destination. It preserves current account permissions, IDs and password hashes. It does not merge two live stores.

The test suite runs PostgreSQL semantics through PGlite, with a storage test double. It exercises the full API workflow plus concurrent stock reservations, idempotency, rollback, shared counters, private files and importing local data. Actual cloud connectivity and routing are verified after credentials are configured. See [DEPLOYMENT.md](DEPLOYMENT.md) for setup and checks.
