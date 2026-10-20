# Durable jobs

`SyncJob` is persisted by the initial Prisma migration and is created transactionally with every unique valid order webhook. `sync-worker.ts` runs as a separate process, conditionally claims `PENDING` rows, synchronizes their contacts/deals, and persists IDs before marking the job complete. It does not run in the API process.

Phase 4 records a `SyncAttempt` for every claim. Retryable HubSpot 429/5xx/network failures are scheduled back to `PENDING`; permanent failures are retained as `FAILED`. Expired `PROCESSING` leases are marked as interrupted attempts and safely reclaimed by a subsequent worker.
