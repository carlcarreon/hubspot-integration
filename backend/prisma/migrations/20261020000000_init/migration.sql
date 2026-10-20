-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "hubspot_contact_id" TEXT,
    "hubspot_deal_id" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "processing_lease_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_attempts" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'PROCESSING',
    "hubspot_contact_id" TEXT,
    "hubspot_deal_id" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "sync_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_lease_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_id_key" ON "orders"("order_id");
CREATE INDEX "orders_status_next_retry_at_idx" ON "orders"("status", "next_retry_at");
CREATE INDEX "orders_processing_lease_until_idx" ON "orders"("processing_lease_until");
CREATE UNIQUE INDEX "sync_attempts_order_id_attempt_number_key" ON "sync_attempts"("order_id", "attempt_number");
CREATE INDEX "sync_attempts_started_at_idx" ON "sync_attempts"("started_at");
CREATE INDEX "sync_attempts_status_started_at_idx" ON "sync_attempts"("status", "started_at");
CREATE UNIQUE INDEX "sync_jobs_order_id_key" ON "sync_jobs"("order_id");
CREATE INDEX "sync_jobs_status_available_at_idx" ON "sync_jobs"("status", "available_at");
CREATE INDEX "sync_jobs_processing_lease_until_idx" ON "sync_jobs"("processing_lease_until");

-- AddForeignKey
ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
