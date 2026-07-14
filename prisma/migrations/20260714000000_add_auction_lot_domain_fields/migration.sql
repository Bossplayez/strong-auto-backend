-- Task 036: Add AuctionLot domain fields to DiscoveredLot
-- Additive migration only — no deletions, no renames.

-- New lifecycle enum (replaces DiscoveredLotState for auction-specific tracking)
CREATE TYPE "AuctionLifecycleState" AS ENUM (
  'NOT_READY', 'UPCOMING', 'OPEN', 'LIVE', 'ENDED', 'SOLD', 'REMOVED'
);

-- New freshness enum (extends FreshnessTier with more granular states)
CREATE TYPE "AuctionFreshnessState" AS ENUM (
  'FRESH', 'STALE', 'DEFERRED', 'TERMINAL'
);

-- Add new columns to discovered_lots (all nullable for backward compatibility)
ALTER TABLE "discovered_lots"
  ADD COLUMN "lifecycle_state" "AuctionLifecycleState" NOT NULL DEFAULT 'NOT_READY',
  ADD COLUMN "freshness_state" "AuctionFreshnessState" NOT NULL DEFAULT 'FRESH',
  ADD COLUMN "auction_time" TIMESTAMP(3),
  ADD COLUMN "auction_timezone_offset" INTEGER,
  ADD COLUMN "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  ADD COLUMN "terminal_at" TIMESTAMP(3),
  ADD COLUMN "media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Populate first_seen_at from created_at for existing rows
UPDATE "discovered_lots" SET first_seen_at = created_at WHERE first_seen_at IS NULL;

-- Populate lifecycle_state from auction_state where available
UPDATE "discovered_lots" SET lifecycle_state = CASE
  WHEN LOWER(auction_state) IN ('sold') THEN 'SOLD'::"AuctionLifecycleState"
  WHEN LOWER(auction_state) IN ('removed', 'cancelled') THEN 'REMOVED'::"AuctionLifecycleState"
  WHEN LOWER(auction_state) IN ('ended') THEN 'ENDED'::"AuctionLifecycleState"
  WHEN LOWER(auction_state) IN ('live', 'on', 'open') THEN 'LIVE'::"AuctionLifecycleState"
  WHEN LOWER(auction_state) IN ('upcoming', 'pending') THEN 'UPCOMING'::"AuctionLifecycleState"
  ELSE 'NOT_READY'::"AuctionLifecycleState"
END WHERE auction_state IS NOT NULL;

-- Populate freshness_state from existing tier/misses
UPDATE "discovered_lots" SET freshness_state = CASE
  WHEN NOT availability_confirmed AND consecutive_misses >= 3 THEN 'TERMINAL'::"AuctionFreshnessState"
  WHEN consecutive_misses >= 2 THEN 'STALE'::"AuctionFreshnessState"
  WHEN freshness_tier = 'COLD' AND consecutive_misses >= 1 THEN 'STALE'::"AuctionFreshnessState"
  ELSE 'FRESH'::"AuctionFreshnessState"
END;

-- Indexes for public eligibility queries
CREATE INDEX "discovered_lots_lifecycle_freshness_idx"
  ON "discovered_lots" (lifecycle_state, freshness_state)
  WHERE availability_confirmed = true AND consecutive_misses < 3;

CREATE INDEX "discovered_lots_auction_time_idx"
  ON "discovered_lots" (auction_time)
  WHERE auction_time IS NOT NULL;

CREATE INDEX "discovered_lots_buy_now_active_idx"
  ON "discovered_lots" (buy_now_usd)
  WHERE is_buy_now = true AND availability_confirmed = true AND consecutive_misses < 3;

CREATE INDEX "discovered_lots_first_seen_idx"
  ON "discovered_lots" (first_seen_at);
