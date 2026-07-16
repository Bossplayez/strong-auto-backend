-- AP-TASK-0010: additive supply-cycle and attempt evidence.
-- Existing checkpoints remain readable; the backfill is deterministic and does
-- not change lots, Vehicles, lifecycle, freshness, publication, or restores.

ALTER TABLE "discovery_checkpoints"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'discovery',
  ADD COLUMN "cycle_started_at" TIMESTAMP(3),
  ADD COLUMN "next_due_at" TIMESTAMP(3);

ALTER TABLE "request_attempt_reservations"
  ADD COLUMN "response_status" INTEGER,
  ADD COLUMN "rate_limit_remaining" INTEGER,
  ADD COLUMN "rate_limit_reset_at" TIMESTAMP(3);

ALTER TABLE "global_request_budgets"
  ADD COLUMN "failure_client_contract" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_persistence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_lease_lost" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "provider_request_breakdowns"
  ADD COLUMN "failure_client_contract" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_persistence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_lease_lost" INTEGER NOT NULL DEFAULT 0;

-- The only evidence available for an older in-progress cycle is when it began.
-- Exhausted rows remain exhausted and are only scheduled by application cadence.
UPDATE "discovery_checkpoints"
SET "cycle_started_at" = COALESCE("last_started_at", "created_at")
WHERE "cycle_started_at" IS NULL
  AND "last_cursor" IS NOT NULL;

CREATE INDEX "discovery_checkpoints_provider_mode_next_due_idx"
  ON "discovery_checkpoints" ("provider", "mode", "next_due_at");
