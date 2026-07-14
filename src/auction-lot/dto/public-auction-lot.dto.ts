// ─────────────────────────────────────────────────────────────
// Strong Auto — Public AuctionLot DTOs (Task 036)
// Allowlisted fields exposed to public API consumers.
// NEVER includes: raw payload, seller info, credentials,
// lease state, request ledger, admin diagnostics, VIN.
// ─────────────────────────────────────────────────────────────

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public auction lot card — minimal data for list view.
 */
export class PublicAuctionLotCardDto {
  @ApiProperty({ description: 'Provider label (copart, iaai)' })
  provider: string;

  @ApiProperty({ description: 'External lot number' })
  externalLotId: string;

  @ApiProperty({ description: 'Vehicle make' })
  make: string;

  @ApiProperty({ description: 'Vehicle model' })
  model: string;

  @ApiProperty({ description: 'Vehicle year' })
  year: number;

  @ApiPropertyOptional({ description: 'Vehicle title' })
  title?: string | null;

  @ApiPropertyOptional({ description: 'Body style' })
  bodyStyle?: string | null;

  @ApiPropertyOptional({ description: 'Fuel type' })
  fuelType?: string | null;

  @ApiPropertyOptional({ description: 'Drive type' })
  driveType?: string | null;

  @ApiPropertyOptional({ description: 'Odometer in km' })
  odometerKm?: number | null;

  @ApiPropertyOptional({ description: 'Odometer in miles' })
  odometerMi?: number | null;

  @ApiProperty({ description: 'Auction lifecycle state', enum: [
    'NOT_READY', 'UPCOMING', 'OPEN', 'LIVE', 'ENDED', 'SOLD', 'REMOVED',
  ]})
  lifecycleState: string;

  @ApiPropertyOptional({
    description: 'Auction timestamp (ISO 8601). Null if unknown.',
  })
  auctionTimestamp?: string | null;

  @ApiPropertyOptional({
    description: 'Timezone offset in minutes from UTC. Null if unknown.',
  })
  auctionTimezoneOffset?: number | null;

  @ApiPropertyOptional({ description: 'Current bid in USD' })
  currentBidUsd?: number | null;

  @ApiPropertyOptional({ description: 'Buy Now price in USD' })
  buyNowUsd?: number | null;

  @ApiProperty({ description: 'Currency (always USD)' })
  currency: 'USD';

  @ApiPropertyOptional({ description: 'Thumbnail image URL' })
  thumbnailUrl?: string | null;

  @ApiProperty({ description: 'Number of available images' })
  mediaCount: number;

  @ApiPropertyOptional({ description: 'Location display text' })
  locationDisplay?: string | null;

  @ApiPropertyOptional({ description: 'Location state' })
  locationState?: string | null;

  @ApiProperty({ description: 'Freshness state', enum: [
    'FRESH', 'STALE', 'DEFERRED', 'TERMINAL',
  ]})
  freshnessState: string;

  @ApiProperty({ description: 'Freshness timestamp (ISO 8601)' })
  freshnessTimestamp: string;

  @ApiPropertyOptional({
    description: 'Linked curated Vehicle ID (only when imported and safe)',
  })
  importedVehicleId?: string | null;
}

/**
 * Public auction lot detail — all safe fields for detail view.
 */
export class PublicAuctionLotDetailDto extends PublicAuctionLotCardDto {
  @ApiPropertyOptional({ description: 'Primary damage description' })
  primaryDamage?: string | null;

  @ApiPropertyOptional({ description: 'Secondary damage description' })
  secondaryDamage?: string | null;

  @ApiPropertyOptional({ description: 'Engine description' })
  engine?: string | null;

  @ApiPropertyOptional({ description: 'Transmission type' })
  transmission?: string | null;

  @ApiPropertyOptional({ description: 'Exterior color' })
  exteriorColor?: string | null;

  @ApiProperty({ description: 'All safe media URLs', type: [String] })
  mediaUrls: string[];

  @ApiPropertyOptional({ description: 'Has 360° view' })
  has360?: boolean;

  @ApiPropertyOptional({ description: 'Has video' })
  hasVideo?: boolean;
}

/**
 * Public auction lot stats — semantic counters.
 */
export class PublicAuctionLotStatsDto {
  @ApiProperty({ description: 'Public-eligible, FRESH, nonterminal lots in NOT_READY|UPCOMING|OPEN|LIVE' })
  currentLotCount: number;

  @ApiProperty({ description: 'FRESH LIVE lots only' })
  liveLotCount: number;

  @ApiProperty({ description: 'Current lots with valid active Buy Now amount' })
  buyNowCount: number;

  @ApiProperty({ description: 'FRESH UPCOMING lots with valid future auction timestamp' })
  upcomingCount: number;

  @ApiProperty({ description: 'Curated published Vehicle count (separate from auction lots)' })
  curatedVehicleCount: number;
}

/**
 * Public auction lot list query parameters.
 */
export class PublicAuctionLotQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)' })
  page?: number;

  @ApiPropertyOptional({ description: 'Page size (max 50)' })
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Filter by provider (copart, iaai)' })
  provider?: string;

  @ApiPropertyOptional({ description: 'Filter by make' })
  make?: string;

  @ApiPropertyOptional({ description: 'Filter by model' })
  model?: string;

  @ApiPropertyOptional({ description: 'Filter by year' })
  year?: number;

  @ApiPropertyOptional({ description: 'Filter by lifecycle state' })
  lifecycleState?: string;

  @ApiPropertyOptional({ description: 'Filter by Buy Now availability' })
  buyNow?: boolean;

  @ApiPropertyOptional({ description: 'Sort field' })
  sort?: string;

  @ApiPropertyOptional({ description: 'Sort direction (asc, desc)' })
  sortDir?: 'asc' | 'desc';
}

/**
 * Paginated public auction lot list response.
 */
export class PublicAuctionLotListResponse {
  @ApiProperty({ type: [PublicAuctionLotCardDto] })
  items: PublicAuctionLotCardDto[];

  @ApiProperty({ description: 'Total matching lots' })
  total: number;

  @ApiProperty({ description: 'Current page' })
  page: number;

  @ApiProperty({ description: 'Page size' })
  pageSize: number;

  @ApiProperty({ description: 'Has more pages' })
  hasMore: boolean;
}
