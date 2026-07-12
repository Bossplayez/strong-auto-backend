-- CreateEnum
CREATE TYPE "FreshnessTier" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "DiscoveredLotState" AS ENUM ('DISCOVERED', 'IMPORTING', 'IMPORTED', 'SOLD', 'REMOVED', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "vehicle_specs" ADD COLUMN     "current_bid" INTEGER,
ADD COLUMN     "sale_status" TEXT;

-- CreateTable
CREATE TABLE "discovery_cursors" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "query_fingerprint" TEXT NOT NULL,
    "next_cursor" TEXT,
    "previous_cursor" TEXT,
    "last_successful_cursor" TEXT,
    "last_started_at" TIMESTAMP(3),
    "last_completed_at" TIMESTAMP(3),
    "exhausted_at" TIMESTAMP(3),
    "contract_version" TEXT NOT NULL DEFAULT 'v1',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_lots" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_lot_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "vin" TEXT,
    "slug_vin" TEXT,
    "platform_id" INTEGER,
    "sub_lot" BOOLEAN NOT NULL DEFAULT false,
    "ad" TIMESTAMP(3),
    "auction_state" TEXT,
    "auction_formatted" TEXT,
    "is_buy_now" BOOLEAN NOT NULL DEFAULT false,
    "buy_now_usd" DECIMAL,
    "current_bid_usd" DECIMAL,
    "estimated_cost_usd" DECIMAL,
    "last_sold_price_usd" DECIMAL,
    "odometer_mi" INTEGER,
    "odometer_km" INTEGER,
    "primary_damage" TEXT,
    "secondary_damage" TEXT,
    "loss" TEXT,
    "run_condition" TEXT,
    "has_key" BOOLEAN,
    "body_style" TEXT,
    "engine" TEXT,
    "drive_type" TEXT,
    "exterior_color" TEXT,
    "fuel_type" TEXT,
    "transmission" TEXT,
    "airbags" TEXT,
    "restraint_system" TEXT,
    "location_display" TEXT,
    "location_state" TEXT,
    "facility_id" TEXT,
    "facility_office_name" TEXT,
    "facility_state" TEXT,
    "facility_zip" TEXT,
    "has_360" BOOLEAN NOT NULL DEFAULT false,
    "has_video" BOOLEAN NOT NULL DEFAULT false,
    "thumbs_count" INTEGER NOT NULL DEFAULT 0,
    "seller_class" TEXT,
    "seller_type" TEXT,
    "sale_document_name" TEXT,
    "sale_document_type" TEXT,
    "source_payload_hash" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_provider_update_at" TIMESTAMP(3),
    "next_refresh_at" TIMESTAMP(3),
    "freshness_tier" "FreshnessTier" NOT NULL DEFAULT 'COLD',
    "consecutive_misses" INTEGER NOT NULL DEFAULT 0,
    "availability_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "state" "DiscoveredLotState" NOT NULL DEFAULT 'DISCOVERED',
    "vehicle_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovered_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_query_cache" (
    "id" TEXT NOT NULL,
    "query_fingerprint" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "next_cursor" TEXT,
    "item_count" INTEGER NOT NULL,
    "ttl_seconds" INTEGER NOT NULL DEFAULT 60,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_query_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_state" (
    "id" TEXT NOT NULL,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "hot_interval_ms" INTEGER NOT NULL DEFAULT 900000,
    "warm_interval_ms" INTEGER NOT NULL DEFAULT 10800000,
    "cold_interval_ms" INTEGER NOT NULL DEFAULT 43200000,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discovery_cursors_provider_query_fingerprint_key" ON "discovery_cursors"("provider", "query_fingerprint");

-- CreateIndex
CREATE INDEX "discovered_lots_provider_freshness_tier_next_refresh_at_idx" ON "discovered_lots"("provider", "freshness_tier", "next_refresh_at");

-- CreateIndex
CREATE INDEX "discovered_lots_provider_state_idx" ON "discovered_lots"("provider", "state");

-- CreateIndex
CREATE INDEX "discovered_lots_next_refresh_at_idx" ON "discovered_lots"("next_refresh_at");

-- CreateIndex
CREATE INDEX "discovered_lots_is_buy_now_auction_state_idx" ON "discovered_lots"("is_buy_now", "auction_state");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_lots_provider_external_lot_id_key" ON "discovered_lots"("provider", "external_lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "search_query_cache_query_fingerprint_key" ON "search_query_cache"("query_fingerprint");

-- CreateIndex
CREATE INDEX "search_query_cache_provider_expires_at_idx" ON "search_query_cache"("provider", "expires_at");
