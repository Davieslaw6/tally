# TALLY

**Every dollar, accounted for.**

TALLY is a small, private personal finance tracker for one person. It keeps accounts, transactions, monthly budgets, savings goals, and reports in PostgreSQL, behind a single PIN. There are no usernames, invitations, teams, or per-user encryption keys, and no import pipeline, attachments, reconciliation, or background workers.

It is built to run on the free tiers of **Vercel** (app and API) and **Neon** (PostgreSQL).

- One owner, one ledger, one PIN.
- Accounts, transactions with splits and transfers, budgets, goals, and reports.
- NGN, USD, EUR, CAD, and GBP are the five primary currencies.
- Calm ledger interface with dark, light, and high-contrast themes.
- No external queue, cache, object store, or email service.

---

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 22 or newer, TypeScript |
| HTTP | Hono, with a Vercel Node function adapter and `@hono/node-server` locally |
| Database | PostgreSQL 14+ via `pg` (Neon in production); embedded PGlite for local development and tests |
| Frontend | React 19, Vite, React Router, TanStack Query |
| Styling | Tailwind CSS v4 plus hand-written OKLCH design tokens |
| Charts | Chart.js |
| Auth | One PIN hashed with scrypt; stateless HMAC-signed session cookie |

The schema is embedded in `src/server/db/migrations.ts`, so the serverless bundle never reads SQL files at runtime. Migrations run automatically on first request.

---

## Quick start

Requirements: Node.js **22+** and npm.

```bash
git clone <your-repo> tally
cd tally
npm install

# Optional: copy the example environment file.
cp .env.example .env

# Start the API and the Vite dev server together.
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the API on port 3000.

Without `DATABASE_URL`, TALLY uses an embedded PGlite database under `./tally-data/pglite`, so no PostgreSQL server is needed locally. To use Neon or a local PostgreSQL instance, set `DATABASE_URL` and restart. Use Neon's **pooled** connection string for serverless deployments.

On first launch TALLY asks you to choose a PIN (4–12 digits) and optionally set a display name and currency. The PIN is the only key to the ledger. There is no recovery flow, so store it safely.

> Starting fresh: TALLY uses the migration ID `0001_core`. If you have an older local `tally-data` directory from a previous version, move it aside before starting.

### First five minutes

1. Add a checking, savings, credit, cash, or investment account on **Accounts**.
2. Add a transaction, or record a transfer between two accounts.
3. Open **Overview** to see balances, inflow vs. outflow, spending by category, and recent activity.
4. Set a monthly budget or a savings goal on **Plan**.
5. Use **Reports** for cash-flow, spending, monthly summaries, and CSV exports.

### Production build

```bash
npm run build
NODE_ENV=production \
APP_SECRET="<at-least-32-random-characters>" \
DATABASE_URL="postgresql://user:password@host/db?sslmode=require" \
npm start
```

`npm start` serves the API and the built frontend from one process on port 3000. On Vercel, the frontend is served as static output and every `/api/*` request is handled by `api/[...path].ts`.

---

## Deploy to Vercel + Neon

1. **Create the database.** In Neon, create a project and copy the **pooled** connection string. It should include `sslmode=require`.
2. **Import the repository.** In Vercel, add the project. `vercel.json` already sets the Vite framework, the `npm run build:client` build command, `dist/client` output, the SPA rewrite, and a 10-second function limit.
3. **Add environment variables** in Project Settings → Environment Variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | The Neon pooled connection string. |
   | `APP_SECRET` | At least 32 random characters. |

   Generate a secret with:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

4. **Deploy.** The first request applies the embedded migration to Neon.
5. **Open the deployment** and choose your PIN.

Vercel sets `NODE_ENV=production` for deployed functions. TALLY refuses to start in production without `DATABASE_URL` and a 32+ character `APP_SECRET`; PGlite is never loaded in production.

The free Neon tier can suspend an idle database. The first request after a suspension may take a moment while the compute wakes and the connection is established.

---

## Navigation

| Page | What it does |
| --- | --- |
| **Overview** | Total balance, inflow, outflow, net saved, the Inflow vs. outflow chart, spending by category, top merchants, recent activity. |
| **Transactions** | Search, date/account/category/direction filters, sorting, manual entry, transfers, split categories, tags, notes, bulk categorize/exclude/include/delete. |
| **Plan** | Monthly budgets with progress and threshold indicators, savings goals, and contributions or withdrawals. |
| **Reports** | Cash-flow over time, spending by category, net worth, monthly summary, and CSV exports. |
| **Accounts** | Account balances, archive/restore, categories, and currency-aware totals. |
| **Settings** | Profile, currency, locale, timezone, theme, density, chart defaults, PIN change, and CSV exports. |

### The cash-flow chart

- **Views:** grouped bars (default), area, and line.
- **Ranges:** 1M, 3M, 6M, 1Y, YTD, and custom.
- **Endpoint:** `GET /api/reports/cash-flow?from=&to=&granularity=day|week|month&account_ids=&category_ids=` returns an array of periods with `periodStart`, `periodEnd`, `inflow`, `outflow`, `net`, and `transactionCount`.
- **Exclusions:** transfers between your own accounts and transactions marked “exclude from reports” never appear in spending or cash-flow figures.
- **Accessibility:** the canvas has a spoken summary, keyboard-focusable bars, a live readout, and an accessible data table.
- **Exports:** CSV includes the TALLY wordmark, currency, period rows, totals, and the exclusion note. PNG renders the chart and wordmark at 1600×1000.
- **Persistence:** the chosen view and default range live in settings.

---

## Currencies

Currency definitions live in `src/shared/currencies.ts` and are exposed by `GET /api/meta`.

**Primary currencies, in order:** `NGN`, `USD`, `EUR`, `CAD`, `GBP`.

Additional currencies are available without changing the application context. Amounts are stored as signed integer minor units (cents) and formatted with `Intl.NumberFormat` using your locale and currency. The workspace currency can only be changed while no accounts exist.

---

## Configuration

Environment variables are read from the process and from an optional `.env` file.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables secure cookies, HSTS, and strict secret checks. |
| `PORT` | `3000` | Local HTTP port. |
| `HOST` | `0.0.0.0` | Local bind address. |
| `APP_SECRET` | dev-only constant | **Required in production**, at least 32 random characters. Signs session cookies; changing it signs every browser out. |
| `DATABASE_URL` | unset | PostgreSQL connection string. **Required in production.** Use the Neon pooled string. When unset locally, TALLY uses PGlite. |
| `COOKIE_SECURE` | `true` in production | Set `false` only for local HTTP testing. |
| `SESSION_DAYS` | `30` | Session cookie lifetime. |
| `TALLY_DATA_DIR` | `./tally-data` | Root for the local embedded database. |
| `TALLY_PGLITE_DIR` | `<data>/pglite` | Local PGlite data directory. Use `memory://` for an ephemeral database. |
| `TALLY_CLIENT_DIST` | `./dist/client` | Built frontend served by `npm start`. |
| `DATABASE_POOL_MAX` | `5` | Maximum `pg` pool connections. |
| `DATABASE_CONNECT_TIMEOUT_MS` | `10000` | PostgreSQL connection timeout. |
| `TALLY_MAX_TRANSACTIONS` | `500000` | Transaction ceiling for the ledger. |
| `LOG_LEVEL` | `info` (`silent` in tests) | JSON log level. |

---

## Data model

Ten tables plus one reporting view:

`owner`, `settings`, `categories`, `accounts`, `transactions`, `transaction_splits`, `budgets`, `goals`, `goal_contributions`, `schema_migrations`, and the `transaction_allocations` view.

The `owner` table is a singleton (`id = 'owner'`) and stores the PIN hash and salt, session epoch, failed-attempt count, and lockout timestamp. There is no user table and no per-user data partitioning.

---

## API

All routes except the public set require a valid session cookie.

| Area | Routes |
| --- | --- |
| Public | `GET /api/health`, `GET /api/meta`, `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout` |
| Session | `POST /api/auth/change-pin`, `GET /api/me`, `GET/PATCH /api/settings`, `PATCH /api/profile` |
| Accounts | `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/:id` |
| Categories | `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id` |
| Transactions | `GET/POST /api/transactions`, `GET/PATCH/DELETE /api/transactions/:id`, `POST /api/transactions/transfer`, `POST /api/transactions/bulk` |
| Planning | `GET/POST /api/budgets`, `PATCH/DELETE /api/budgets/:id`, `POST /api/budgets/copy`, `GET/POST /api/goals`, `PATCH/DELETE /api/goals/:id`, `GET/POST /api/goals/:id/contributions`, `DELETE /api/goals/:id/contributions/:contributionId` |
| Reports | `GET /api/reports/cash-flow`, `/cash-flow.csv`, `/summary`, `/spending`, `/net-worth`, `/monthly`, `/transactions.csv` |

Errors use `{ "error": "CODE", "message": "..." }`. Authenticated API responses are sent with `Cache-Control: no-store`.

---

## Security

- PINs are hashed with scrypt (`N=16384, r=8, p=1`) and a random salt.
- Five wrong attempts lock PIN entry for 5 minutes. Lockout state is stored in the `owner` row.
- Sessions are stateless HMAC-SHA256 tokens in an `HttpOnly`, `SameSite=Lax` cookie; `Secure` is enabled in production.
- Changing the PIN increments `session_epoch`, which invalidates every existing session. The browser that changed it receives a fresh cookie.
- State-changing requests are checked against `Origin`/`Host` and `Sec-Fetch-Site`.
- Security headers include CSP, HSTS in production, frame denial, referrer policy, and cross-origin isolation headers.
- CSV exports neutralise spreadsheet formulas in user-controlled cells.
- Request bodies are limited to 1 MB. The API is deliberately small and has no file uploads.

There is no password or PIN recovery. If the PIN is lost, the data is still in PostgreSQL, but regaining access requires a manual database intervention.

---

## Testing

```bash
npm test                 # backend/API tests (24)
npm run test:ui          # chart UI tests (8)
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint
npm run test:coverage    # V8 coverage report in ./coverage
```

The backend suite covers PIN setup, login, lockout, PIN changes, CSRF rejection, the ledger, transfers, splits, bulk actions, budgets, goals, account archiving, cash-flow bucketing and filters, and report exports. UI tests cover chart controls, accessibility, loading/error/empty states, and CSV/PNG exports.

### End-to-end smoke test

```bash
# Terminal 1: ephemeral PGlite database
TALLY_PGLITE_DIR=memory:// PORT=3210 COOKIE_SECURE=false npx tsx src/index.ts

# Terminal 2
node scripts/smoke-test.mjs http://127.0.0.1:3210
```

The smoke script sets up the owner, creates accounts and transactions, checks transfer exclusion, search and filters, cash-flow totals, budgets, goals, and logout/session revocation.

`npx tsx scripts/smoke-db.mjs` applies the embedded migrations to `DATABASE_URL` when set, otherwise to an in-memory PGlite database, and prints the resulting tables and reporting view.

### Demo data

```bash
npm run seed -- --pin 482915 --currency NGN
```

`seed` refuses to touch a ledger that already has a PIN. It also refuses a production database unless `--force` is supplied.

---

## Project structure

```text
tally/
├─ api/
│  └─ [...path].ts              # Vercel Node function adapter
├─ src/
│  ├─ index.ts                  # local process entry and graceful shutdown
│  ├─ server/
│  │  ├─ app.ts                 # Hono wiring, auth gate, static serving, errors
│  │  ├─ config.ts              # environment parsing and production guards
│  │  ├─ context.ts             # service container
│  │  ├─ db/                    # pg and PGlite engines, SQL adapter, embedded migrations
│  │  ├─ http/                  # cookies, auth middleware, request schemas
│  │  ├─ routes/                # auth, accounts, transactions, me, reports, planning
│  │  ├─ services/              # owner, accounts, ledger, cash flow, reports, planning
│  │  └─ security/              # scrypt PIN hashing and HMAC session tokens
│  ├─ client/
│  │  ├─ pages/                 # Overview, Transactions, Plan, Reports, Accounts, Settings, Auth
│  │  ├─ components/            # chart, shell, dialogs, toast, shared UI
│  │  ├─ lib/                   # typed fetch client, session context, formatting
│  │  └─ styles.css             # OKLCH tokens, themes, density, responsive layout
│  └─ shared/                   # currencies, dates, money, locale, DTO types
├─ scripts/                     # seed, API smoke test, database smoke test
├─ test/                        # backend, UI, and shared test helpers
├─ vercel.json
└─ package.json
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `DATABASE_URL is required in production` | No database configured | Set the Neon pooled connection string in Vercel. |
| `APP_SECRET is required in production` | Missing or short secret | Set a 32+ character random value. |
| `CSRF_INVALID` | Request came from another origin | Use the deployed URL directly and reload the tab. |
| Login returns `429` | Five wrong PIN attempts | Wait 5 minutes, then try again. |
| The first request after idling is slow | Neon compute was suspended | Wait for the database to wake. |
| `Cannot connect to the TALLY database` | Bad `DATABASE_URL` or suspended Neon project | Check the connection string and the Neon console. |
| PGlite directory is locked | A second local process is using the same directory | Stop the other process; PGlite is single-process. |
| Stale local schema | An older `tally-data` directory is still present | Move it aside and start with a fresh database. |

---

## License

Private project. Add a license before distributing.
#   t a l l y  
 