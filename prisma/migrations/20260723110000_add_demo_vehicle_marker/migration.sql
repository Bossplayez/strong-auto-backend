ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "is_demo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "vehicles_is_demo_source_region_idx"
  ON "vehicles"("is_demo", "source_region");
