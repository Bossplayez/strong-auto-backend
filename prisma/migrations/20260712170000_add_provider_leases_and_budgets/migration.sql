-- AlterEnum: Add ABANDONED to ImportJobStatus enum
-- Note: Prisma generates enum type name as "ImportJobStatus" (PascalCase)
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'ABANDONED';

-- CreateTable: ProviderLease
CREATE TABLE IF NOT EXISTS "provider_leases" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "owner_token" TEXT NOT NULL,
    "fencing_token" INTEGER NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "import_job_id" TEXT,

    CONSTRAINT "provider_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_leases_provider_key" ON "provider_leases"("provider");

-- CreateTable: GlobalRequestBudget — one shared monthly cap
CREATE TABLE IF NOT EXISTS "global_request_budgets" (
    "id" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "completed_success" INTEGER NOT NULL DEFAULT 0,
    "failure_timeout" INTEGER NOT NULL DEFAULT 0,
    "failure_rate_limit" INTEGER NOT NULL DEFAULT 0,
    "failure_server" INTEGER NOT NULL DEFAULT 0,
    "failure_network" INTEGER NOT NULL DEFAULT 0,
    "failure_client" INTEGER NOT NULL DEFAULT 0,
    "quota_remaining" INTEGER,
    "quota_reset_epoch_ms" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_request_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "global_request_budgets_billing_month_key"
    ON "global_request_budgets"("billing_month");

-- CreateTable: ProviderRequestBreakdown — denormalized per-provider counters
CREATE TABLE IF NOT EXISTS "provider_request_breakdowns" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "completed_success" INTEGER NOT NULL DEFAULT 0,
    "failure_timeout" INTEGER NOT NULL DEFAULT 0,
    "failure_rate_limit" INTEGER NOT NULL DEFAULT 0,
    "failure_server" INTEGER NOT NULL DEFAULT 0,
    "failure_network" INTEGER NOT NULL DEFAULT 0,
    "failure_client" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_request_breakdowns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_request_breakdowns_provider_billing_month_key"
    ON "provider_request_breakdowns"("provider", "billing_month");

-- CreateTable: RequestAttemptReservation — idempotent attempt tracking
CREATE TABLE IF NOT EXISTS "request_attempt_reservations" (
    "id" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "job_id" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'allocated',
    "failure_kind" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "request_attempt_reservations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "request_attempt_reservations_billing_month_provider_idx"
    ON "request_attempt_reservations"("billing_month", "provider");

CREATE INDEX IF NOT EXISTS "request_attempt_reservations_billing_month_status_idx"
    ON "request_attempt_reservations"("billing_month", "status");
