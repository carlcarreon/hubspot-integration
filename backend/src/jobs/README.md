# Durable jobs

`SyncJob` is already persisted by the Phase 1 Prisma migration. In later phases, a worker in this directory will atomically claim eligible rows using `status`, `availableAt`, and `processingLeaseUntil`, then create `SyncAttempt` history records. No background HubSpot work runs in Phase 1.
