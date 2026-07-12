-- AlterTable
ALTER TABLE "discovered_lots" ADD COLUMN "priority_score" INTEGER;
ALTER TABLE "discovered_lots" ADD COLUMN "selected_at" TIMESTAMP(3);
ALTER TABLE "discovered_lots" ADD COLUMN "deferred_at" TIMESTAMP(3);
ALTER TABLE "discovered_lots" ADD COLUMN "deferral_reason" TEXT;
ALTER TABLE "discovered_lots" ADD COLUMN "attempt_cost" INTEGER NOT NULL DEFAULT 1;
