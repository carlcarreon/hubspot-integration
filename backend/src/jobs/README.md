# Durable jobs

`SyncJob` is persisted by the initial Prisma migration and is created transactionally with every unique valid order webhook. `sync-worker.ts` runs as a separate process, conditionally claims `PENDING` rows, synchronizes their contacts/deals, and persists IDs before marking the job complete. It does not run in the API process.

Phase 4 will extend this with expired-lease recovery, retry scheduling, and `SyncAttempt` audit records.
