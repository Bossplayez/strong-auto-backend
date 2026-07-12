-- Rename discovery_cursors → discovery_checkpoints
-- Rename cursor columns to page-based checkpoint columns
-- CONFIRMED: provider uses page-based pagination (?page=N), not opaque cursor tokens

ALTER TABLE "discovery_cursors" RENAME TO "discovery_checkpoints";

ALTER TABLE "discovery_checkpoints" RENAME COLUMN "next_cursor" TO "last_page";
ALTER TABLE "discovery_checkpoints" RENAME COLUMN "last_successful_cursor" TO "last_successful_page";

-- Type change: text → int (cursor was text, page is integer)
-- First convert existing values: 'page_N' → N, or set NULL
UPDATE "discovery_checkpoints"
  SET "last_page" = NULL;

UPDATE "discovery_checkpoints"
  SET "last_successful_page" = NULL;

ALTER TABLE "discovery_checkpoints" ALTER COLUMN "last_page" TYPE INTEGER USING NULL;
ALTER TABLE "discovery_checkpoints" ALTER COLUMN "last_successful_page" TYPE INTEGER USING NULL;

-- Remove the previous_cursor column (not needed for page-based pagination)
ALTER TABLE "discovery_checkpoints" DROP COLUMN "previous_cursor";

-- Update contract version default
ALTER TABLE "discovery_checkpoints" ALTER COLUMN "contract_version" SET DEFAULT 'v1_page';

-- Update existing rows to new contract version
UPDATE "discovery_checkpoints" SET "contract_version" = 'v1_page';
