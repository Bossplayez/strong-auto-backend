-- AlterTable: Add ABANDONED to ImportJobStatus enum
ALTER TYPE "import_jobs_status_enum" ADD VALUE IF NOT EXISTS 'ABANDONED';

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

-- CreateIndex: Unique provider
CREATE UNIQUE INDEX IF NOT EXISTS "provider_leases_provider_key" ON "provider_leases"("provider");

-- CreateTable: ProviderRequestBudget
CREATE TABLE IF NOT EXISTS "provider_request_budgets" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "total_attempts" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count_timeout" INTEGER NOT NULL DEFAULT 0,
    "failure_count_rate_limit" INTEGER NOT NULL DEFAULT 0,
    "failure_count_server" INTEGER NOT NULL DEFAULT 0,
    "failure_count_network" INTEGER NOT NULL DEFAULT 0,
    "failure_count_client" INTEGER NOT NULL DEFAULT 0,
    "quota_remaining" INTEGER,
    "quota_reset_epoch_ms" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_request_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique provider + billing_month
CREATE UNIQUE INDEX IF NOT EXISTS "provider_request_budgets_provider_billing_month_key"
    ON "provider_request_budgets"("provider", "billing_month");
