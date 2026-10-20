# HubSpot Order Sync

This repository implements Phase 6 of a signed order-webhook integration. It uses an Express/TypeScript API, PostgreSQL, Prisma ORM, a React/Vite/Tailwind sync-monitoring dashboard, and a standalone Python accounting exporter.

## Prerequisites

- Node.js 20.19+, 22.12+, or 24+
- Python 3.11+ (for the standalone CSV exporter)
- Docker and Docker Compose (for local PostgreSQL)
- npm 10+

The project pins Prisma ORM and Prisma Client at `7.10.1`. Prisma 7 uses a `prisma.config.ts` datasource configuration and the PostgreSQL driver adapter at runtime; `DATABASE_URL` is intentionally not stored in `schema.prisma`.

## Quick start

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate:deploy
npm run db:generate
npm run dev
```

The API listens at `http://localhost:3000`, and Vite serves the dashboard at `http://localhost:5173`. The Vite development server proxies `/api` to the backend.

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"up"}
```

To stop the database without removing data:

```bash
docker compose down
```

To remove the local PostgreSQL volume as well (this deletes local development data):

```bash
docker compose down -v
```

## Database commands

```bash
# Apply committed migrations (CI, Docker, and production-like environments)
npm run db:migrate:deploy

# Create a new migration while developing a schema change
npm run db:migrate:dev -- --name describe_change

# Regenerate the typed Prisma client after schema changes
npm run db:generate

# Inspect local data
npm run db:studio
```

The provided `DATABASE_URL` targets Docker Compose PostgreSQL. For another PostgreSQL server, use a standard URL such as `postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public`; URL-encode special characters in credentials.

## Architecture

```text
backend/src/
  routes/        HTTP route registration
  controllers/   Thin request/response adapters
  services/      Business use-cases
  repositories/  PostgreSQL/Prisma data access
  middleware/    Shared HTTP behavior and safe errors
  validators/    Zod schemas and safe payload parsing
  jobs/          Durable HubSpot synchronization worker
  config/        Validated environment and database client
  tests/         API tests
backend/prisma/
  schema.prisma
  migrations/
frontend/        React + Vite + Tailwind dashboard
scripts/         Python CSV exporter, Python tests, and webhook sender
```

The initial migration creates `orders`, `sync_attempts`, and `sync_jobs`. A signed webhook transactionally creates its `Order` and exactly one pending `SyncJob` in one Prisma nested write. PostgreSQL's unique `orders.order_id` constraint handles concurrent duplicate deliveries: the winner creates the order/job pair, and every losing request reads and returns that existing order. The separate worker conditionally updates a pending row to `PROCESSING`, so concurrent worker processes cannot claim the same job.

Controllers only adapt HTTP requests and responses. The webhook service parses and validates the payload before delegating persistence; the repository is the only layer that performs Prisma database operations.

## Secure order webhooks

`POST /api/webhooks/orders` accepts only the supplied `order.created` shape. Send the exact JSON bytes with:

```text
X-Webhook-Signature: sha256=<lowercase_hex_hmac_sha256>
```

The backend reads the raw request bytes (up to 100kb), calculates HMAC-SHA256 with `WEBHOOK_SIGNING_SECRET`, and performs a length-checked `timingSafeEqual` comparison before parsing JSON or validating it with Zod.

- Missing, malformed, invalid, or tampered signatures return `401` with `INVALID_SIGNATURE`.
- A correctly signed but malformed JSON or invalid `order.created` payload returns `400` with `INVALID_PAYLOAD` and safe field-level messages.
- A valid delivery returns `202` with its order ID, `PENDING` state, and whether it was a duplicate. The response never includes the stored payload.
- Repeated or simultaneous valid deliveries return `202` and leave one order plus one initial durable job in PostgreSQL.

## HubSpot synchronization worker

The separate worker uses HubSpot's current dated `2026-09` CRM API paths and never exposes the access token to the browser.

```bash
# Terminal 1: API and dashboard
npm run dev

# Terminal 2: after completing the HubSpot setup below
npm run worker
```

For each claimed job, the worker:

1. Verifies that the Deal `external_order_id` property exists and is unique.
2. Normalizes the customer email, then finds and updates a Contact or creates one.
3. Finds a Deal by `external_order_id`; it updates that Deal when found, otherwise creates one.
4. Saves the resolved Contact ID and Deal ID to PostgreSQL immediately after each step.
5. Creates the idempotent default Deal-to-Contact association, then marks the job and order successful.

Deal properties are `external_order_id`, `dealname`, `amount`, `deal_currency_code`, `closedate`, `pipeline`, and `dealstage`. `closedate` is the source `created_at` converted to UTC ISO-8601. HubSpot account currency configuration must allow the source currency (for example, PHP) or the write will be rejected.

If a run is interrupted after a remote create but before local ID persistence, the next run searches by normalized email and the unique external order ID before it ever creates another remote object. If association fails after the Deal ID has been persisted, a later run updates and re-associates that same Deal. Phase 4 schedules transient failures for retry and recovers expired worker leases; permanent failures are retained for inspection.

## Reliability, retries, and failure history

Phase 4 keeps the worker durable across transient HubSpot failures and worker restarts. A `sync_jobs.attempts` value counts **total processing attempts**, including the first run; `WORKER_MAX_ATTEMPTS` defaults to `8`.

- HTTP `429`, `500`, `502`, `503`, `504`, other `5xx` responses, and network failures are retryable. The worker stores the failed attempt, then returns the job to `PENDING` for a later claim.
- Each retry uses capped exponential backoff with full jitter. HubSpot's `Retry-After` response header is honored when it is longer than the jittered delay, but it is capped at `WORKER_RETRY_MAX_DELAY_MS`.
- Validation, authentication, authorization, and other non-429 `4xx` responses are permanent. The job and order become `FAILED` immediately; no unchanged request is retried.
- Every worker claim creates a `sync_attempts` row. It records its attempt number, `PROCESSING`, `SUCCESS`, or `FAILED` state, any IDs already persisted for the Contact/Deal, a sanitized error, and start/completion timestamps. A scheduled retry is a new processing attempt, not a rewrite of history.
- Jobs left in `PROCESSING` after their lease expires are marked as interrupted attempts and safely reclaimed when processing capacity remains. An expired final attempt becomes permanently `FAILED`. Exact lease matching prevents a stale worker from completing or failing a newer claim.

HubSpot error records retain a sanitized category, error code/message, and correlation ID. Email addresses, bearer values, line breaks, and overlong diagnostics are redacted or bounded; access tokens and full webhook payloads are never logged or stored as errors.

Set retry behavior in your uncommitted `.env`:

```text
WORKER_MAX_ATTEMPTS=8
WORKER_RETRY_BASE_DELAY_MS=1000
WORKER_RETRY_MAX_DELAY_MS=60000
```

To inspect jobs and attempt history locally, start Prisma Studio:

```bash
npm run db:studio
```

Open `SyncJob` for its queue state, retry time, and last error; open `SyncAttempt` for the immutable per-run history. Phase 5 will add API endpoints and a dashboard retry button. Until then, do not edit real HubSpot records or manually alter queue rows merely to replay a job.

### Development-only Phase 4 verification

The opt-in PostgreSQL verification suite exercises the real repository and worker while returning mocked HubSpot HTTP responses. It never sends a request to HubSpot, uses unique `PHASE4-VERIFY-*` rows only, and deletes only those rows after each scenario.

Stop `npm run worker` first, then run:

```bash
npm run test:phase4:verify
```

The suite refuses to start if any existing job is `PROCESSING`, preventing it from racing a real worker. It does not reset the database or alter non-verification rows.

| Mocked response | Expected `Order` / `SyncJob` state | Expected `SyncAttempt` history |
| --- | --- | --- |
| `429` + `Retry-After: 5` | `PENDING`; `available_at` at least five seconds later | Attempt 1 `FAILED`, sanitized correlation ID, completion timestamp |
| `500`, then `500` | `PENDING`; second scheduled delay is larger (exponential backoff) | Attempts 1 and 2 both `FAILED` |
| `503` | `PENDING` with a scheduled retry | Attempt 1 `FAILED`, sanitized correlation ID |
| Validation `400` | `FAILED`; no `next_retry_at` | Attempt 1 `FAILED` |
| `503` at configured final attempt | `FAILED`; no `next_retry_at` | Each allowed attempt is retained as `FAILED` |
| Expired worker lease | `SUCCESS` after recovery; job `COMPLETED` | Interrupted attempt `FAILED`, recovered attempt `SUCCESS`; previously stored Contact/Deal IDs are reused |

### HubSpot account and property setup

Use a test portal and a private app token for local development. The private app needs only:

- `crm.objects.contacts.read` and `crm.objects.contacts.write`
- `crm.objects.deals.read` and `crm.objects.deals.write`
- `crm.schemas.deals.read` and `crm.schemas.deals.write` to verify or create the property

Set the token and the pipeline/stage **internal IDs** in your uncommitted `.env`. The worker checks `external_order_id` at startup. If absent, it creates a single-line text Deal property in the `dealinformation` group with `hasUniqueValue: true`; it then verifies the API response. If the existing property is not unique, startup fails without processing a job.

If the token cannot manage schemas, create it manually in **Settings → Data Management → Properties → Deal properties**:

```text
Label:         External Order ID
Internal name: external_order_id
Field type:    Single-line text
Group:         Deal Information
Unique values: enabled (set this when creating the property)
```

Do not use a non-unique property or alter it after orders exist. In HubSpot's `2026-09` API, portal validation rules and required record-creation fields also apply to API writes; configure any extra required Deal fields or associations before enabling the worker.

The worker still requires `crm.schemas.deals.read` to verify that a manually created property is unique before it processes orders. A `403` at worker startup means the token needs the documented schema scopes; add them to the private app, regenerate the token if HubSpot requires it, update `.env`, and restart `npm run worker`.

### Send a signed local demo webhook

With the backend running and a non-placeholder secret in `.env`:

```bash
npm run webhook:send
```

Optionally provide another target URL:

```bash
npm run webhook:send -- http://localhost:3000/api/webhooks/orders
```

The sender generates a fresh demo order ID, signs the precise JSON body with the same `sha256=<hex>` convention, and exits nonzero for a non-2xx response. It never prints the signing secret.

## Environment

`.env.example` contains all expected variables and no credentials. `DATABASE_URL` and a `WEBHOOK_SIGNING_SECRET` of at least 16 characters are required when starting the API. `DASHBOARD_API_TOKEN` is a distinct, high-entropy bearer token required for monitoring, retry, and CSV-download endpoints. `npm run worker` additionally requires `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PIPELINE_ID`, and `HUBSPOT_DEAL_STAGE_ID`. Use unique, high-entropy secrets in deployed environments; do not put them or any HubSpot credential in frontend variables or commit `.env`.

The dashboard CSV bridge additionally uses these server-only settings:

```text
PYTHON_EXECUTABLE=python3.11
EXPORT_TIMEOUT_MS=90000
EXPORT_MAX_CONCURRENT=1
```

Set `PYTHON_EXECUTABLE` to the absolute path of a Python 3.11+ interpreter when `python3.11` is not on `PATH`. `EXPORT_MAX_CONCURRENT` bounds Python subprocesses per API process; the default of one avoids overlapping accounting exports.

## Phase 5 monitoring dashboard

Start the API and Vite dashboard as usual:

```bash
npm run dev
```

Open `http://localhost:5173`. The Vite development server reads `DASHBOARD_API_TOKEN` from the root uncommitted `.env` and injects the `Authorization: Bearer` header only into its local `/api` proxy requests. You do not enter a token in the browser. It is deliberately separate from `HUBSPOT_ACCESS_TOKEN` and is not placed in frontend source, browser storage, or `VITE_*` build-time variables.

For a deployed system, place the API/dashboard behind SSO or an authenticated reverse proxy and replace the shared local-demo bearer token with the organization’s identity mechanism. The API is fail-closed: if `DASHBOARD_API_TOKEN` is absent, dashboard endpoints return `503 DASHBOARD_AUTH_NOT_CONFIGURED`; missing or invalid credentials return `401`.

| Method | Endpoint | Result |
| --- | --- | --- |
| `GET` | `/api/syncs?orderStatus=FAILED&q=ORD-10482&limit=20&page=1` | Up to 50 newest matching real attempt records, paginated; optional current-order status and search filters |
| `GET` | `/api/syncs/stats` | Current `orders` counts: successful, failed, pending, and processing |
| `GET` | `/api/syncs/:id` | One sync attempt with sanitized error, available HubSpot diagnostics, and known IDs |
| `GET` | `/api/orders?status=FAILED&q=ORD-10482&limit=20&page=1` | Paginated current orders joined with durable job state; optional status and search filters |
| `GET` | `/api/orders/:orderId/attempts` | All persisted immutable attempt rows for one order, newest attempt number first |
| `GET` | `/api/orders/failed?limit=50&offset=0` | Paginated current failed orders from `orders`/`sync_jobs`, including failures with no `sync_attempts` row |
| `POST` | `/api/orders/:orderId/retry` | Atomically requeues an unclaimed failed order for the existing worker |
| `GET` | `/api/exports/deals?days=7` | Runs the existing Python exporter server-side and downloads a CSV; `days` is 1–30, default 7 |

All dashboard endpoints require the dashboard bearer token. The lists intentionally do not return webhook payloads. The dashboard’s default **Orders & Sync Status** table reads `/api/orders`, not `/api/syncs`: it lists current orders and their durable job state, server-side filtered by `status` and paginated in stable `updated_at` order. It shows the latest recorded attempt when one exists, but an absent attempt remains absent.

The Failed filter uses `GET /api/orders?status=FAILED`, so its total and rows use the same `orders.status = FAILED` predicate as the Failed summary card. It therefore includes older failed orders created before `sync_attempts` auditing was introduced. Those rows show no latest attempt and expand to an explicit “No recorded sync attempts” state; the application never fabricates audit history. The legacy `/api/orders/failed` endpoint remains available for direct operational use.

The same table has an **Attempts (Latest 50)** view backed by `/api/syncs`. It is an immutable audit view: it returns at most its newest 50 real records, and its optional `orderStatus` filter filters those attempt records by their *current* parent-order state. Selecting an order’s attempt count in the Orders view requests `/api/orders/:orderId/attempts` and expands only that order’s persisted history. Each compact history card shows the attempt number, status, start/completion times, stored Contact/Deal IDs, and the complete sanitized stored failure text. Successful cards explicitly say “No error recorded.” A failed card is labelled as retry scheduled, retried later, or terminal when that conclusion is available from the current durable job; prior failures remain visible after a later success. Where a stored HubSpot error has them, the API also exposes its HTTP status, category, and correlation ID. No request headers, access tokens, or webhook payloads are returned. Both views show known Contact/Deal IDs where available, so a retry retains partial HubSpot completion instead of creating a new remote Deal.

Manual retry is allowed only while both the order and its durable job are `FAILED`. The database transaction conditionally changes the failed job to `PENDING`, clears its lease/scheduled error, and leaves `sync_attempts`, payload, HubSpot Contact ID, and HubSpot Deal ID untouched. Attempt numbers stay monotonic so audit history remains valid; an exhausted job receives one new bounded `WORKER_MAX_ATTEMPTS` allowance. A simultaneous second retry conditionally updates zero rows and receives `409 RETRY_NOT_AVAILABLE`. The normal database-backed worker claims the pending job; the dashboard never calls HubSpot directly.

The dashboard includes summary cards, a single responsive Orders & Sync Status table, server-side status filtering and search, expandable audit history, an explicit latest-50 Attempts view, manual refresh, loading/empty/error states, accessible status labels, a confirmation dialog, disabled retry controls for non-eligible jobs, and success/error notices. Search matches order ID, the stored customer email, and known HubSpot Contact/Deal IDs in PostgreSQL before pagination. Typing is debounced by 300ms, and the clear control resets the search and page.

Both views use validated 10, 20 (default), or 50 row pages. Pagination displays the first/last three pages, the current page and its neighbors, and ellipses only across gaps; mobile layouts show a smaller page-number range. The response includes `page`, `limit`, `totalItems`, and `totalPages` and the UI displays the shown record range.

View, status, search query, page, and row limit are restored from the URL, for example `/?view=orders&status=failed&q=ORD-DEMO&page=3&limit=20`. Click navigation uses browser history; debounced typing replaces the current history entry. **A search query can contain an email address and is therefore personal data.** Avoid sharing, logging, or retaining dashboard URLs containing `q`; URLs never include credentials or HubSpot tokens. A failed order can be retried from either view only when its current durable job is terminal `FAILED`; the protected transaction remains the authority if another request wins the race. Its **Export Deals (Last 7 Days)** button calls the protected Express endpoint through the existing Vite proxy, downloads the returned CSV, and releases the browser object URL after download. The browser never receives `HUBSPOT_ACCESS_TOKEN`.

For each dashboard export, Express starts the unchanged standalone Python CLI with `execFile` and explicit arguments—never through a shell. It passes the HubSpot token only in the child environment, gives the request a new OS temporary directory/file, enforces the configured timeout and concurrency cap, and deletes the temporary output after the response completes or on failure. It returns `text/csv` with a fixed safe attachment filename. Start `npm run worker` separately only when you want requeued sync work to be processed; exporting does not use the worker or database.

## Python accounting export

`scripts/export_deals.py` is a standalone, **read-only** Python 3.11+ program. It has no dependency on the backend, worker, frontend, PostgreSQL, or third-party Python packages. It uses the same `HUBSPOT_ACCESS_TOKEN` from the root uncommitted `.env` (or an already-set environment variable) and the existing dated HubSpot Deal Search API path.

The dashboard bridge reuses this exact script with `--days` and an isolated `--output` path; its normal CLI remains available for accounting teams and automation.

The token needs `crm.objects.deals.read`. The exporter makes only `POST /crm/objects/2026-09/deals/search` requests; it never creates, updates, associates, or deletes HubSpot records.

Create an optional virtual environment, then run the unit tests:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python --version
# Python 3.11 or newer
python -m unittest discover -s scripts/tests -t . -v
```

There is no `scripts/requirements.txt` because the exporter uses only the Python standard library.

Export the rolling seven-day window to the default destination:

```bash
python3.11 scripts/export_deals.py
```

Choose a destination or another rolling UTC window:

```bash
python3.11 scripts/export_deals.py --output exports/accounting/deals.csv --days 14
```

The default output is `exports/hubspot_deals_last_7_days.csv`; parent directories are created automatically. The CSV is UTF-8 with standard CSV quoting and these columns:

```text
Deal ID, External Order ID, Deal Name, Amount, Currency, Pipeline ID,
Deal Stage ID, Close Date, Created Date
```

The date range is a rolling inclusive UTC interval from `now - --days` through `now`, not seven calendar dates. HubSpot filters the Deal `createdate` field in milliseconds; the exporter requests all pages (100 records per page) and does not limit records to integration-owned Deals. Monetary values stay as HubSpot-provided strings, avoiding floating-point rounding. Missing properties become empty CSV cells. It requests the required `hs_currency_code` and falls back to `deal_currency_code` when the existing worker/account exposes that property name.

For `429` and temporary `5xx` responses, the exporter makes at most four total requests with capped exponential backoff, jitter, and `Retry-After` honoring. Network errors also retry within that bound. Authentication and other permanent `4xx` errors fail immediately. Diagnostics are bounded and redact a Bearer value; the access token is never printed. An empty result is successful and produces a header-only CSV.

Troubleshooting:

- `HUBSPOT_ACCESS_TOKEN is required`: set it in the root `.env` or the process environment; do not put it in source code.
- `401` or `403`: verify the private-app token and `crm.objects.deals.read` scope.
- `429` or `5xx`: the exporter retries automatically; after the bounded limit, run it again later.
- No rows: the sample webhook timestamp is outside the current rolling window unless you have created a recent Deal.

## Checks

```bash
npm run lint
npm test
npm run build
python3.11 -m unittest discover -s scripts/tests -t . -v
```

`npm test` includes PostgreSQL integration coverage for valid, invalid, unsigned, tampered, duplicate, and concurrent webhook deliveries. It also has mock-based tests for contact/deal mapping, update-vs-create behavior, Deal recovery by `external_order_id`, association, property verification, dashboard API authentication/response structure/retry conflict behavior, CSV-export authentication/validation/attachment/failure/timeout behavior, Python subprocess cleanup/concurrency behavior, and React dashboard loading/retry/download interactions. It makes no real HubSpot requests.

## Current scope

Phase 6 is complete: the API safely accepts durable local work, the separate worker synchronizes an idempotent Contact/Deal association, transient HubSpot failures are scheduled for durable retry with attempt history and lease recovery, the protected React dashboard monitors/requeues failed orders and downloads a server-side CSV export, and the standalone Python exporter writes a rolling UTC Deal CSV. Phase 7 submission work remains deferred.
