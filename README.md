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
   ```
4. Run the UI locally:
   ```bash
   npm run dev
   ```

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

## Scripts

- `npm run dev` – local SSR via React Router dev
- `npm run build` – build SSR + client assets
- `npm run deploy:web` – deploy UI worker
- `npm run deploy:api` – deploy API worker
- `npm run verify` – lint + format + typecheck + test
