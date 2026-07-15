-- Fix discovery checkpoint cursor type: Int -> String for opaque cursor tokens
ALTER TABLE "discovery_checkpoints" ALTER COLUMN "last_page" TYPE TEXT;
ALTER TABLE "discovery_checkpoints" ALTER COLUMN "last_successful_page" TYPE TEXT;
