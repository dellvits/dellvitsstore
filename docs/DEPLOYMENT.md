# Deploying Dellvit

This repository contains two applications: the Next.js storefront in `apps/web` and the Express API in `apps/api`. Deploying the API alone does not deploy the storefront.

The API currently writes its SQLite database and uploaded images/documents to local disk. It needs a Node.js 24 server with persistent writable storage. Vercel Functions do not provide the shared persistent local filesystem this backend requires. Setting `DATABASE_PATH` or `UPLOAD_DIR` to `/tmp` is not a production solution: data can disappear and is not shared across instances. See [Vercel's SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).

## Vercel storefront

Import the GitHub repository with these settings:

| Setting | Value |
| --- | --- |
| Project name | `dellvit` or another available name |
| Application / Framework Preset | **Next.js** |
| Root Directory | **`apps/web`** |
| Install Command | `npm ci --include=dev --include-workspace-root` |
| Build Command | `npm run build` |
| Output Directory | Leave the default; keep override disabled |
| Node.js Version | **24.x** |

Keep **Include source files outside of the Root Directory in the Build Step** enabled in the project's Root Directory settings so the repository's workspace manifest and lockfile are available. `apps/web/vercel.json` supplies the framework, install and build settings once these changes are pushed.

Add this environment variable to the Vercel project's Production environment before building:

```dotenv
API_INTERNAL_URL=https://YOUR-ACTUAL-BACKEND-HOST
```

Replace the placeholder with the deployed API's publicly reachable HTTPS origin. Do not append `/api` or a trailing slash: `next.config.ts` appends `/api/:path*`. Do not use `localhost`; on Vercel it does not point to your computer or a separate backend. Redeploy after changing this value because the rewrite destination is set during the build.

Remove the detected API example variables from the storefront project. `PORT`, `DATABASE_PATH`, `UPLOAD_DIR`, `WEB_ORIGIN` and `TRUST_PROXY` belong to the backend. Do not copy `NODE_ENV=development` to Vercel; leave `NODE_ENV` unset so the platform uses its production default.

Browser requests already use the storefront's `/api` rewrite, so no `NEXT_PUBLIC_API_URL` is required. For preview deployments use a separate backend configured for that preview's exact web origin; the API currently permits one `WEB_ORIGIN`.

## Backend on a server with persistent storage

Use a Node.js 24 service with a persistent disk and a public HTTPS endpoint. Keep one API instance with this local SQLite architecture. Run these commands from the repository root:

```sh
npm ci --include=dev
npm run build -w @dellvit/api
npm run start -w @dellvit/api
```

Configure the backend environment as follows. `/data` is an example disk mount: substitute the actual persistent mount supplied by your host.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | The exact storefront origin, such as `https://dellvit.vercel.app`, with no trailing slash |
| `DATABASE_PATH` | `/data/dellvit.sqlite` |
| `UPLOAD_DIR` | `/data/uploads` |
| `PORT` | Use the host-provided port; otherwise `4000` |
| `TRUST_PROXY` | `0` by default; use `1` only after verifying exactly one trusted reverse proxy in front of Express |

If the hosting path contains multiple proxies, configure Express's proxy trust for that topology before production use; the existing `TRUST_PROXY` switch only enables one trusted hop. Back up both the database and uploaded files. An empty disk creates a new database; existing local store data is not automatically transferred from your computer.

Create the administrator once, in a backend runtime shell with the same persistent disk mounted and the same `DATABASE_PATH`. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (a unique password of at least 12 characters), and optionally `ADMIN_NAME`, then run `npm run bootstrap` from the repository root. This command requires the build/dev dependencies to remain installed. Remove the bootstrap password from the environment afterward. Do not run bootstrap during every build or run `npm run seed` for a real store.

Web Push keys are generated and saved in the database. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are optional overrides, not required to fix the build.

After deployment, verify `/api/health` on both the backend origin and the storefront origin. Both should return `{"ok":true,"service":"dellvit-api"}`. Then verify administrator login, an upload, and data persistence after restarting the backend.

## Why `tsc: command not found` happened

`tsc` is the TypeScript compiler. The failed build could not find it in the installed dependencies. Previously it was declared only in the repository root, so an installation scoped to the API workspace could omit it. Both applications now explicitly declare TypeScript and Node.js types in their own development dependencies.

Development dependencies must also be installed during the build. `npm ci --include=dev --include-workspace-root` includes them and the root tools even if the environment selects production mode. See [Vercel's missing dependencies guidance](https://vercel.com/kb/guide/dependencies-from-package-json-missing-after-install).

The `sharp` approval warning in the supplied log is separate; the build exits because `tsc` is missing. Fixing the compiler installation does not remove the API's persistent-storage requirement. Hosting the API on Vercel requires code changes to use a remote database and durable object storage; adding database environment variables alone cannot migrate the existing storage code.
