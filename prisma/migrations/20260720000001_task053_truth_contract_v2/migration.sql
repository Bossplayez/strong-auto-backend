-- Task 053: Auction Truth Contract V2 — additive migration
-- Adds new fields to discovered_lot table. All nullable/defaulted — no data loss.

-- Create enum types first
DO $$ BEGIN
    CREATE TYPE "ProviderResultState" AS ENUM ('UNKNOWN', 'RESULT_PENDING', 'SOLD', 'UNSOLD', 'REMOVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AuctionTimestampEvidence" AS ENUM ('UTC_OFFSET', 'PROVIDER_TIMEZONE', 'NONE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Additive columns (all nullable or have safe defaults)
ALTER TABLE "discovered_lot" ADD COLUMN "provider_lifecycle_state" TEXT;
ALTER TABLE "discovered_lot" ADD COLUMN "provider_result_state" "ProviderResultState" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "discovered_lot" ADD COLUMN "provider_auction_timestamp_raw" TEXT;
ALTER TABLE "discovered_lot" ADD COLUMN "auction_timestamp_evidence" "AuctionTimestampEvidence" NOT NULL DEFAULT 'NONE';
ALTER TABLE "discovered_lot" ADD COLUMN "listing_observed_at" TIMESTAMP(3);
ALTER TABLE "discovered_lot" ADD COLUMN "price_observed_at" TIMESTAMP(3);
