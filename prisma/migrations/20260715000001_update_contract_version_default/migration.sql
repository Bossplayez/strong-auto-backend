-- Update contract_version default from v1_page to v2_cursor
ALTER TABLE "discovery_checkpoints" ALTER COLUMN "contract_version" SET DEFAULT 'v2_cursor';
