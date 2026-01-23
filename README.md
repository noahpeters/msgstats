# msgstats

Local, portable messaging analytics for Meta inboxes.

## Setup

Node 20 LTS is required for `better-sqlite3` builds.

1. Install dependencies:
   ```bash
   nvm use
   ```
   ```bash
   npm install
   ```
2. Copy env template:
   ```bash
   cp .env.example .env
   ```
3. Fill in `.env`.
4. Start dev server:
   ```bash
   npm run dev
   ```

## Meta app setup notes

- Create a Meta app in the Facebook Developer dashboard.
- Add Facebook Login and set the OAuth redirect URI to `META_REDIRECT_URI`.
- Required permissions for v1 (Messenger read-only):
  - `pages_show_list`
  - `pages_manage_metadata`
  - `business_management`
  - `pages_messaging`
- The app discovers Pages via the Business Portfolio (`owned_pages` first,
  fallback to `client_pages`). You must be an admin of the Business.
- Optional (future IG sync):
  - `instagram_basic`
  - `instagram_manage_messages`

## Scripts

- `npm run dev`: start server + Vite SSR
- `npm run migrate`: run database migrations once
- `npm run build`: build client + SSR bundle
- `npm run start`: run production build
- `npm run verify`: lint, format check, typecheck, tests

## Notes

- Tokens are encrypted at rest using `APP_ENCRYPTION_KEY`.
- Read-only sync: no message sending is implemented.
- Instagram sync is feature-flagged via `IG_ENABLED` and currently includes TODO placeholders.
