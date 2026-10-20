# HubSpot Order Sync

This repository is the Phase 1 foundation for a signed order-webhook integration. It uses an Express/TypeScript API, PostgreSQL, Prisma ORM, a React/Vite/Tailwind dashboard, and reserves Python for the later CSV exporter.

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

The API listens at `http://localhost:3000`, and Vite serves the dashboard at `http://localhost:5173`. The Vite development server proxies `/api` to the backend, so the Phase 1 dashboard verifies the same health endpoint it will use in later phases.

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

## Phase 1 architecture

```text
backend/src/
  routes/        HTTP route registration
  controllers/   Thin request/response adapters
  services/      Business use-cases
  repositories/  PostgreSQL/Prisma data access
  middleware/    Shared HTTP behavior and safe errors
  validators/    Zod schemas (webhook schema comes in Phase 2)
  jobs/          Durable worker implementation (introduced in later phases)
  config/        Validated environment and database client
  tests/         API tests
backend/prisma/
  schema.prisma
  migrations/
frontend/        React + Vite + Tailwind dashboard
scripts/         Future Python CSV exporter and webhook sender
```

The initial migration creates `orders`, `sync_attempts`, and `sync_jobs`. `sync_jobs` is a persistent queue foundation: later webhook handling will transactionally create an order and a pending job; a separate worker will claim jobs using a lease, preserve retry scheduling, and create `sync_attempts` history. Phase 1 deliberately does not receive webhooks or start HubSpot work.

## Environment

`.env.example` contains all expected variables and no credentials. Only `DATABASE_URL` is required to run Phase 1. HubSpot and webhook values are intentionally validated as later features are enabled; do not put them in frontend variables or commit `.env`.

## Checks

```bash
npm run lint
npm test
npm run build
```

## Current scope

Phase 1 is complete when the application installs, PostgreSQL migrations apply, the health endpoint reports database readiness, and the dashboard can reach that API. The webhook receiver, HubSpot client, job execution, operations views, and Python exporter are intentionally deferred to later phases.
