-- Fix constraint and index names on discovery_checkpoints
-- The table was renamed from discovery_cursors → discovery_checkpoints
-- but PostgreSQL preserved original constraint/index names.

DO $$
BEGIN
  -- Rename primary key index
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'discovery_cursors_pkey') THEN
    ALTER INDEX "discovery_cursors_pkey" RENAME TO "discovery_checkpoints_pkey";
  END IF;
  
  -- Rename unique index
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'discovery_cursors_provider_query_fingerprint_key') THEN
    ALTER INDEX "discovery_cursors_provider_query_fingerprint_key" RENAME TO "discovery_checkpoints_provider_query_fingerprint_key";
  END IF;
  
  -- Rename NOT NULL constraints (only exist if created by older PG or explicit constraint)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_cursors_id_not_null') THEN
    ALTER TABLE "discovery_checkpoints" RENAME CONSTRAINT "discovery_cursors_id_not_null" TO "discovery_checkpoints_id_not_null";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_cursors_provider_not_null') THEN
    ALTER TABLE "discovery_checkpoints" RENAME CONSTRAINT "discovery_cursors_provider_not_null" TO "discovery_checkpoints_provider_not_null";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_cursors_query_fingerprint_not_null') THEN
    ALTER TABLE "discovery_checkpoints" RENAME CONSTRAINT "discovery_cursors_query_fingerprint_not_null" TO "discovery_checkpoints_query_fingerprint_not_null";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_cursors_contract_version_not_null') THEN
    ALTER TABLE "discovery_checkpoints" RENAME CONSTRAINT "discovery_cursors_contract_version_not_null" TO "discovery_checkpoints_contract_version_not_null";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_cursors_created_at_not_null') THEN
    ALTER TABLE "discovery_checkpoints" RENAME CONSTRAINT "discovery_cursors_created_at_not_null" TO "discovery_checkpoints_created_at_not_null";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_cursors_updated_at_not_null') THEN
    ALTER TABLE "discovery_checkpoints" RENAME CONSTRAINT "discovery_cursors_updated_at_not_null" TO "discovery_checkpoints_updated_at_not_null";
  END IF;
END $$;
