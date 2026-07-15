// ─────────────────────────────────────────────────────────────
// Strong Auto — AuctionLot Domain Types (Task 036)
// Internal normalized types for auction lot processing.
// NOT exposed directly to public or admin DTOs.
// ─────────────────────────────────────────────────────────────

/**
 * Auction lifecycle states — derived from provider auction state
 * and timestamp evidence. Maps to provider-specific status strings.
 */
export enum AuctionLifecycleState {
  NOT_READY = 'NOT_READY',     // Auction date unknown or far future
  UPCOMING = 'UPCOMING',       // Has future auction timestamp
  OPEN = 'OPEN',               // Bidding open
  LIVE = 'LIVE',               // Active live auction
  ENDED = 'ENDED',             // Auction ended, result pending
  SOLD = 'SOLD',               // Sold confirmed
  REMOVED = 'REMOVED',         // Removed/withdrawn by seller
}

/**
 * Freshness axis — reflects how recently the lot was confirmed
 * with the provider and whether it should still be considered active.
 */
export enum AuctionFreshnessState {
  FRESH = 'FRESH',             // Recently confirmed, data reliable
  STALE = 'STALE',             // Missed refresh, may be outdated
  DEFERRED = 'DEFERRED',       // Intentionally deferred (budget/low priority)
  TERMINAL = 'TERMINAL',       // No longer available, no further refreshes
}

/**
 * Normalized auction lot — internal representation used by
 * discovery, adapters, and services. Maps to DiscoveredLot Prisma model
 * with additional computed fields (lifecycle, freshness, timezone).
 */
export interface NormalizedAuctionLot {
  // Identity
  provider: string;
  externalLotId: string;

  // Vehicle facts
  make: string;
  model: string;
  year: number | null;
  title: string;
  bodyStyle?: string | null;
  fuelType?: string | null;
  driveType?: string | null;
  odometerKm?: number | null;
  odometerMi?: number | null;

  // Location (sanitized — no raw facility codes)
  locationDisplay?: string | null;
  locationState?: string | null;

  // Auction lifecycle
  lifecycleState: AuctionLifecycleState;
  auctionTimestamp: Date | null;       // When auction occurs/sold
  auctionTimezoneOffset?: number | null; // UTC offset in minutes; null = unknown
  auctionRawState?: string | null;       // Original provider state string

  // Pricing
  currentBidUsd: number | null;
  buyNowUsd: number | null;
  currency: 'USD';

  // Media (allowlisted URLs only)
  thumbnailUrl?: string | null;
  mediaUrls: string[];
  mediaCount: number;

  // Freshness tracking
  freshnessState: AuctionFreshnessState;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastProviderUpdateAt: Date | null;
  nextRefreshAt: Date | null;
  staleAfterMs: number;             // How long before marking STALE
  terminalAt: Date | null;          // When marked TERMINAL

  // Import linkage (optional — only set when lot has been imported)
  importedVehicleId?: string | null;

  // Scheduler metadata
  consecutiveMisses: number;
  attemptCost: number;
}

/**
 * Provider partition — used to scope discovery queries.
 * Partitions are evaluated in priority order.
 */
export interface DiscoveryPartition {
  provider: string;
  lifecycleFilter?: AuctionLifecycleState[];
  dateWindowStart?: Date;
  dateWindowEnd?: Date;
  buyNowFirst?: boolean;
  makeFilter?: string;
  modelFilter?: string;
  priority: number;  // Lower = higher priority
}

/**
 * Discovery result from a single partition query.
 */
export interface DiscoveryResult {
  partition: DiscoveryPartition;
  lots: NormalizedAuctionLot[];
  totalFetched: number;          // Raw count from provider response
  uniqueNew: number;             // Lots seen for first time
  uniqueUpdated: number;         // Lots with changed data
  duplicates: number;            // Already known, unchanged
  exhausted: boolean;            // No more pages/results in this partition
  continuation?: string | null;  // Opaque continuation token (provider-specific)
}

/**
 * Quota accounting — global and provider breakdown.
 */
export interface QuotaSnapshot {
  monthlyCap: number;            // 30,000 absolute
  protectedReserve: number;      // 3,000
  routineCapacity: number;       // 27,000
  usedThisMonth: number;
  remainingThisMonth: number;
  providerBreakdown: Record<string, number>; // provider → requests used
}
