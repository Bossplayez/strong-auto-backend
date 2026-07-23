-- Auction assistance is a specialised lead.  Existing generic leads remain
-- untouched and have a NULL assistance_status.
ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'BID_ASSISTANCE';
ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'BUY_NOW_ASSISTANCE';

DO $$ BEGIN
  CREATE TYPE "AssistanceRequestStatus" AS ENUM ('NEW', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "discovered_lot_id" TEXT,
  ADD COLUMN IF NOT EXISTS "assistance_status" "AssistanceRequestStatus",
  ADD COLUMN IF NOT EXISTS "auction_price_usd" DECIMAL,
  ADD COLUMN IF NOT EXISTS "auction_price_basis" TEXT,
  ADD COLUMN IF NOT EXISTS "auction_price_observed_at" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "leads_discovered_lot_id_fkey"
    FOREIGN KEY ("discovered_lot_id") REFERENCES "discovered_lots"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "leads_customer_lot_type_created_idx"
  ON "leads"("customer_user_id", "discovered_lot_id", "lead_type", "created_at");
CREATE INDEX IF NOT EXISTS "leads_discovered_lot_id_idx"
  ON "leads"("discovered_lot_id");
