-- Task 036: Additive migration — opaque cursor fields + nullable year
-- Forward-only: adds new columns, deprecates old Int page fields.
-- No destructive changes; old columns retained for compatibility.

-- 1. DiscoveryCheckpoint: add opaque cursor columns
ALTER TABLE "discovery_checkpoints"
  ADD COLUMN "last_cursor" TEXT,
  ADD COLUMN "last_successful_cursor" TEXT;

-- 2. DiscoveredLot: make year nullable (unknown year = NOT_READY)
ALTER TABLE "discovered_lots"
  ALTER COLUMN "year" DROP NOT NULL;

-- 2b. Vehicle: make year nullable (unknown year should not be fabricated)
ALTER TABLE "vehicles"
  ALTER COLUMN "year" DROP NOT NULL;

-- 3. Update contract version for new checkpoints
UPDATE "discovery_checkpoints"
  SET contract_version = 'v2_cursor'
  WHERE last_cursor IS NOT NULL;
