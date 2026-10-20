# HubSpot Order Sync

This repository implements Phase 4 of a signed order-webhook integration. It uses an Express/TypeScript API, PostgreSQL, Prisma ORM, a React/Vite/Tailwind dashboard, and reserves Python for the later CSV exporter.

## Prerequisites

- Node.js 20.19+, 22.12+, or 24+
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
scripts/         Future Python CSV exporter and webhook sender
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

`.env.example` contains all expected variables and no credentials. `DATABASE_URL` and a `WEBHOOK_SIGNING_SECRET` of at least 16 characters are required when starting the API. `npm run worker` additionally requires `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PIPELINE_ID`, and `HUBSPOT_DEAL_STAGE_ID`. Use unique, high-entropy secrets in deployed environments; do not put them or any HubSpot credential in frontend variables or commit `.env`.

## Checks

```bash
npm run lint
npm test
npm run build
```

`npm test` includes PostgreSQL integration coverage for valid, invalid, unsigned, tampered, duplicate, and concurrent webhook deliveries. It also has mock-based tests for contact/deal mapping, update-vs-create behavior, Deal recovery by `external_order_id`, association, and property verification. It makes no real HubSpot requests.

## Current scope

Phase 4 is complete: the API safely accepts durable local work, the separate worker synchronizes an idempotent Contact/Deal association, and transient HubSpot failures are scheduled for durable retry with attempt history and lease recovery. Dashboard operations and the Python exporter are intentionally deferred to later phases.
