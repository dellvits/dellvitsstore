# Deploy Dellvit with Supabase, Cloudflare R2 and Vercel

The repository now deploys the storefront and Express API together in **one Vercel project**. Supabase stores application data and Cloudflare **R2** stores uploaded images, payment receipts and outlet PDFs. The domain serves the website at `/` and the API at `/api`. You no longer need a separate backend hostname or `API_INTERNAL_URL` on Vercel.

## 1. Create the Supabase database

1. Create a project at [Supabase](https://supabase.com/dashboard). Save the database password.
2. Open **SQL Editor**, create a new query, paste the entire contents of [`supabase/migrations/202609180001_initial.sql`](../supabase/migrations/202609180001_initial.sql), and run it once.
3. Open **Connect**, select the **Transaction pooler** connection, and copy its PostgreSQL URI. Use port **6543** for the Vercel app. Replace the password placeholder with your database password, URL-encoding special characters in the password. Copy your project's actual hostname, region and username; the sample below is only a format example.

```text
postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
```

This becomes `DATABASE_URL`. It is a database connection string, not the Supabase project URL, publishable/anon key or service-role API key. The API uses PostgreSQL directly with verified TLS and unnamed queries compatible with transaction pooling. If your connection requires Supabase's CA certificate, download it from the database SSL settings and put its complete PEM contents in `DATABASE_SSL_CA`; do not disable certificate verification.

In the Table Editor, select the **`dellvit` schema** to see the tables. Keep that schema out of the Supabase Data API's exposed schemas. Row level security is enabled with no browser policies: Express performs account and role checks, and only the server's database connection accesses these tables. Existing Dellvit authentication is retained; application users will not appear in Supabase Auth.

Alternatively, with `DATABASE_URL` configured in `apps/api/.env`, run `npm run db:migrate` locally. Use the SQL Editor for initial setup if your local network cannot connect to the database. Database setup runs separately from Vercel builds.

[Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres)

## 2. Create the Cloudflare R2 bucket

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **R2 Object Storage** and enable R2 if needed.
2. Create a standard bucket named `dellvit-uploads`. Use the default jurisdiction for this configuration.
3. Keep the bucket **private**: do not enable public `r2.dev` access or attach a public custom domain. It holds private receipts and documents as well as product images.
4. In R2's account details, open **Manage API Tokens** and create an R2 token with **Object Read & Write** permissions, scoped to this bucket.
5. Save the generated **Access Key ID**, **Secret Access Key**, and your Cloudflare **Account ID**. The R2 secret is shown only when created.

The app constructs the S3 endpoint from the account ID. Browser CORS settings on the bucket are unnecessary because uploads and downloads pass through Express. Public images use `/api/media/<id>.webp`; private files keep their existing authorized endpoints. Uploads are limited to **4 MiB** to leave room for multipart framing within Vercel's request limit.

[Cloudflare R2 credentials documentation](https://developers.cloudflare.com/r2/api/tokens/)

## 3. Configure one Vercel project

Commit and push the changes, then import the GitHub repository or update the existing project:

| Setting                            | Value                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Project name                       | `dellvit` or your preferred available name                                                    |
| Root Directory                     | Repository root: **`.`**, not `apps/web` or `apps/api`                                        |
| Framework Preset                   | **Services**; each service then declares its own framework in `vercel.json`                   |
| Node.js Version                    | **24.x**                                                                                      |
| Build / Install / Output overrides | **Off**; use the service settings in the root `vercel.json`                                   |

The root `vercel.json` declares `web` (Next.js) and `api` (Express), installation including development dependencies, and shared routing. Clear previous dashboard overrides for the old single-app deployment: leave Build Command, Install Command and Output Directory unset so the service settings apply.

Both services install with `npm ci --include=dev --include-workspace-root`, which resolves the workspace lockfile from the repository root and installs development dependencies. That is what fixes the original `tsc: command not found` failure: Vercel's default production install omitted `devDependencies`, so TypeScript was missing.

Add these variables to the **Production** environment:

| Variable               | Value to supply                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Your Supabase Transaction pooler URI from step 1                                               |
| `R2_ACCOUNT_ID`        | Cloudflare account ID                                                                          |
| `R2_ACCESS_KEY_ID`     | R2 Access Key ID                                                                               |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Access Key                                                                           |
| `R2_BUCKET_NAME`       | `dellvit-uploads`, or your actual bucket name                                                  |
| `WEB_ORIGIN`           | Your exact public site origin, e.g. `https://dellvit.vercel.app`, **without a trailing slash** |
| `NODE_ENV`             | `production`                                                                                   |
| `TRUST_PROXY`          | `1` for Vercel's trusted proxy                                                                 |
| `DATABASE_SSL_CA`      | Only if needed: the Supabase CA certificate PEM                                                |

The site address is an example; use the actual domain assigned to your project. Update `WEB_ORIGIN` if you later switch to a custom domain, then redeploy. An incorrect origin causes browser writes to return 403.

Remove obsolete `DATABASE_PATH`, `UPLOAD_DIR`, `API_INTERNAL_URL`, and manually configured `PORT` values from Vercel. Never prefix database or R2 secrets with `NEXT_PUBLIC_`. For Preview deployments, use a separate Supabase database and R2 bucket and configure that preview's exact `WEB_ORIGIN`; the current API permits one browser origin.

[Vercel Services documentation](https://vercel.com/docs/services)

## 4. Create the administrator

For a **new store**, create `apps/api/.env` locally from `apps/api/.env.example`. Fill in the same Supabase connection, then add:

```dotenv
ADMIN_EMAIL=your-email@example.com
ADMIN_NAME=Store owner
ADMIN_PASSWORD=YOUR_OWN_UNIQUE_PASSWORD_OF_AT_LEAST_12_CHARACTERS
```

From the repository root, run:

```powershell
npm.cmd ci --include=dev
npm.cmd run bootstrap
```

This connects to your Supabase database and creates the first administrator. It does not need an R2 connection and refuses to overwrite an existing super administrator. Remove `ADMIN_PASSWORD` from the local file afterwards. Do not add it to Vercel or commit `.env`. Do not run bootstrap in every build, and do not seed demo accounts in your production database.

## Existing local store: import instead of bootstrap

If you already have real data, stop the old application, back up its SQLite database and uploads, and initialize a **fresh** Supabase schema. Configure the Supabase and R2 variables locally. Set `SQLITE_IMPORT_PATH` to the absolute path of the old SQLite file, and `LOCAL_UPLOAD_DIR` to the absolute path of its upload directory, then run:

```powershell
npm.cmd run import:local
```

The tool opens SQLite read-only, preserves IDs and password hashes, copies uploaded objects to the appropriate R2 prefixes, and inserts database rows in one transaction. Public image paths stay unchanged. It refuses a populated destination database or a conflicting R2 object. If interrupted before the database commits, rerunning safely reuses identical uploaded objects. Uploads copied before a failed database import may remain in R2; no source files are deleted. Migrate the current Dellvit schema, including its admin permission tables, before retiring the old deployment.

An imported store already has administrator accounts, so skip bootstrap and use your existing login. Fresh Supabase setup alone does not copy your local data automatically.

## 5. Deploy and verify

Deploy in Vercel, then open `https://YOUR-SITE/api/health`. A successful response is `{"ok":true,"service":"dellvit-api"}` and confirms the database schema is reachable. Open `/admin/login`, sign in, create a category/product, upload an image, and verify it remains available after redeploying. Also verify a private receipt/PDF while signed in and that it is blocked when signed out.

`npm test` uses an isolated embedded PostgreSQL engine and an in-memory object storage test double. It covers the existing API workflows, concurrent checkout, rollback, shared rate limits, private-file authorization, upload limits and local-data import. It does not contact your cloud accounts. Supabase connectivity, R2 credentials and Vercel routing still need the live verification above.

## Local development

Use a separate Supabase project/bucket for development. Copy both app environment examples, run `npm run db:migrate`, bootstrap once, then run `npm run dev`. The local Next.js proxy still uses `API_INTERNAL_URL=http://127.0.0.1:4000`. Keep `NODE_ENV=development` and `TRUST_PROXY=0` for direct local use. Web Push VAPID keys are generated in PostgreSQL on demand, or can be supplied with the optional environment variables in the API example.
