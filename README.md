# msgstats

Messenger + Instagram analytics deployed on Cloudflare Workers with a D1 database.

## Architecture

- **Frontend Worker** serves React Router SSR and proxies `/api/*` to the private API Worker.
- **API Worker** handles Facebook Login, Meta Graph calls, sync, reporting, and deletion callbacks.
- **D1** stores multi-tenant data keyed by `user_id`. Tokens are stored in plaintext (D1 encrypts at rest).

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a D1 database and apply migrations:
   ```bash
   wrangler d1 create msgstats-db
   npm run db:migrations:local
   ```
3. Configure secrets for the API Worker:
   ```bash
   wrangler secret put META_APP_ID --config wrangler.api.toml
   wrangler secret put META_APP_SECRET --config wrangler.api.toml
   wrangler secret put META_REDIRECT_URI --config wrangler.api.toml
   wrangler secret put SESSION_SECRET --config wrangler.api.toml
   wrangler secret put CLOUDFLARE_ACCOUNT_ID --config wrangler.api.toml
   wrangler secret put CLOUDFLARE_API_TOKEN --config wrangler.api.toml
   wrangler secret put RESEND_API_KEY --config wrangler.api.toml
   ```
4. Optional alerting config (non-secrets):
   ```bash
   wrangler secret put ALERT_EMAIL_TO --config wrangler.api.toml
   wrangler secret put ALERT_EMAIL_FROM --config wrangler.api.toml
   wrangler secret put META_ERROR_RATE_THRESHOLD --config wrangler.api.toml
   wrangler secret put META_MIN_CALLS_THRESHOLD --config wrangler.api.toml
   wrangler secret put APP_ERRORS_THRESHOLD --config wrangler.api.toml
   ```
5. Run local dev (API + web workers + build watch):
   ```bash
   npm run dev
   ```
   - Web worker serves on `http://localhost:5173` (includes `/sync/runs/subscribe`).
   - API worker serves on `http://localhost:8787`.
   - Client assets are built to `./build/client` via `react-router build --watch`.

## Meta app setup

- Create a Meta app and enable Facebook Login.
- Add redirect URI to Facebook Login settings:
  - `https://msgstats.from-trees.com/api/auth/callback` (production)
  - `http://localhost:5173/api/auth/callback` (local dev)
- Required scopes:
  - `pages_show_list`
  - `pages_manage_metadata`
  - `business_management`
  - `pages_messaging`
  - `instagram_basic`
  - `instagram_manage_messages`

## Deployment

```bash
npm run deploy:api
npm run deploy:web
```

## CI & deployments

- **CI** runs on PRs and pushes. It includes `npm run verify`, migration edits check, and a staging remote migration guard when Cloudflare secrets are available.
- **Staging** deploys on push to `main`. It applies staging migrations, deploys API + web, and sets `VITE_STAGING_INFO` for the build banner.
- **Preview** deploys are manual via GitHub Actions. They deploy a web-only worker pointing at the staging API and set `VITE_STAGING_INFO`.
- **Production** promotions are manual via GitHub Actions. They apply prod migrations, deploy API + web, and set `VITE_STAGING_INFO` (banner hidden in prod).
- Required GitHub secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

## Ops dashboard + alerting

- Ops metrics and telemetry are shown on `/ops-dashboard` (requires auth).
- Analytics Engine datasets:
  - `AE_META_CALLS` for Meta API outbound telemetry.
  - `AE_APP_ERRORS` for app error counters.
- `/api/ops/metrics/meta?window=15m` and `/api/ops/metrics/errors?window=60m` serve aggregated AE metrics.
- Cron runs every 5 minutes to evaluate alert thresholds and email via Resend.
- Alert state is deduped in D1 (`ops_alert_state`) to avoid repeated emails.

### Preview deploy

Use the "Deploy Preview" workflow in GitHub Actions.

Inputs:

- `ref`: branch or SHA to deploy (default `main`)
- `preview_name`: base worker name (default `msgstats-web-preview`)
- `slot`: optional suffix (e.g. `pr-123` -> `msgstats-web-preview-pr-123`)

The preview worker is web-only and points to the staging API service binding.

## Scripts

- `npm run dev` – local dev via Wrangler (web worker on :5173, api worker on :8787) + build watch
- `npm run build` – build SSR + client assets
- `npm run deploy:web` – deploy UI worker
- `npm run deploy:api` – deploy API worker
- `npm run db:migrations:staging` – apply staging D1 migrations
- `npm run verify` – lint + format + typecheck + test
