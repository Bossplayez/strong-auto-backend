// ─────────────────────────────────────────────────────────────
// Strong Auto — Public Auction Lots Service (Task 036)
// Read-only service for public auction lot queries.
// Reads from Strong Auto PostgreSQL only. Never calls providers.
// ─────────────────────────────────────────────────────────────

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PublicAuctionLotCardDto,
  PublicAuctionLotDetailDto,
  PublicAuctionLotStatsDto,
  PublicAuctionLotListResponse,
} from './dto/public-auction-lot.dto';

/**
 * Map a DiscoveredLot Prisma record to a public card DTO.
 * Only allowlisted fields are exposed.
 * Sensitive fields (VIN, seller info, raw payload, lease state) are excluded.
 */
function toPublicCardDto(lot: any): PublicAuctionLotCardDto {
  return {
    provider: lot.provider,
    externalLotId: lot.externalLotId,
    make: lot.make,
    model: lot.model,
    year: lot.year,
    title: lot.title || null,
    bodyStyle: lot.bodyStyle || null,
    fuelType: lot.fuelType || null,
    driveType: lot.driveType || null,
    odometerKm: lot.odometerKm || null,
    odometerMi: lot.odometerMi || null,
    lifecycleState: mapLifecycleState(lot.auctionState, lot.ad),
    auctionTimestamp: lot.ad ? lot.ad.toISOString() : null,
    auctionTimezoneOffset: null, // TODO: derive from provider facility data
    currentBidUsd: lot.currentBidUsd ? Number(lot.currentBidUsd) : null,
    buyNowUsd: lot.buyNowUsd ? Number(lot.buyNowUsd) : null,
    currency: 'USD',
    thumbnailUrl: null, // TODO: derive from media URLs
    mediaCount: lot.thumbsCount ?? 0,
    locationDisplay: lot.locationDisplay || null,
    locationState: lot.locationState || null,
    freshnessState: mapFreshnessState(
      lot.freshnessTier,
      lot.consecutiveMisses,
      lot.availabilityConfirmed,
      lot.nextRefreshAt,
    ),
    freshnessTimestamp: (lot.lastProviderUpdateAt || lot.lastSeenAt).toISOString(),
    importedVehicleId: lot.vehicleId || null,
  };
}

/**
 * Map lifecycle state from provider auction state + timestamp.
 * This is a best-effort mapping; the exact state depends on provider contract.
 */
function mapLifecycleState(
  auctionState: string | null,
  auctionDate: Date | null,
): string {
  if (!auctionState) {
    return 'NOT_READY';
  }

  const state = auctionState.toLowerCase();

  // Terminal states
  if (state.includes('sold') || state === 'sold') return 'SOLD';
  if (state.includes('removed') || state === 'cancelled') return 'REMOVED';
  if (state.includes('ended')) return 'ENDED';

  // Active states
  if (state.includes('live') || state.includes('open')) return 'LIVE';
  if (state.includes('on') || state.includes('open')) return 'OPEN';

  // Upcoming — has a future auction date
  if (auctionDate && auctionDate > new Date()) {
    return 'UPCOMING';
  }

  // Default to upcoming if we have a date, otherwise not ready
  return auctionDate ? 'UPCOMING' : 'NOT_READY';
}

/**
 * Map freshness state from existing DiscoveredLot fields.
 * HOT → FRESH, WARM → FRESH, COLD + high misses → STALE,
 * deferred → DEFERRED, consecutive misses >= 3 → TERMINAL.
 */
function mapFreshnessState(
  tier: string,
  consecutiveMisses: number,
  availabilityConfirmed: boolean,
  nextRefreshAt: Date | null,
): string {
  if (!availabilityConfirmed && consecutiveMisses >= 3) {
    return 'TERMINAL';
  }
  if (nextRefreshAt && nextRefreshAt < new Date() && consecutiveMisses >= 2) {
    return 'STALE';
  }
  if (tier === 'COLD' && consecutiveMisses >= 1) {
    return 'STALE';
  }
  return 'FRESH';
}

/**
 * Map a DiscoveredLot to a public detail DTO.
 */
function toPublicDetailDto(lot: any): PublicAuctionLotDetailDto {
  const card = toPublicCardDto(lot);
  return {
    ...card,
    primaryDamage: lot.primaryDamage || null,
    secondaryDamage: lot.secondaryDamage || null,
    engine: lot.engine || null,
    transmission: lot.transmission || null,
    exteriorColor: lot.exteriorColor || null,
    mediaUrls: [], // TODO: populate from media table or lot data
    has360: lot.has360 ?? false,
    hasVideo: lot.hasVideo ?? false,
  };
}

@Injectable()
export class AuctionLotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get paginated public auction lots.
   * Filters by provider, make, model, year, lifecycle, buyNow.
   * Sorts by auction date (upcoming first) by default.
   */
  async findAll(query: {
    page?: number;
    pageSize?: number;
    provider?: string;
    make?: string;
    model?: string;
    year?: number;
    lifecycleState?: string;
    buyNow?: boolean;
    sort?: string;
    sortDir?: 'asc' | 'desc';
  }): Promise<PublicAuctionLotListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    // Build where clause — only public-eligible lots
    const where: any = {
      // Exclude terminal lots from default public view
      availabilityConfirmed: true,
      consecutiveMisses: { lt: 3 },
    };

    if (query.provider) where.provider = query.provider;
    if (query.make) where.make = query.make;
    if (query.model) where.model = query.model;
    if (query.year) where.year = query.year;
    if (query.buyNow) {
      where.isBuyNow = true;
      where.buyNowUsd = { not: null };
    }
    if (query.lifecycleState) {
      // Map lifecycle state back to provider auction state filter
      where.auctionState = this.mapLifecycleStateFilter(query.lifecycleState);
    }

    // Build order by
    const orderBy: any = [];
    if (query.sort === 'price_asc') {
      orderBy.push({ currentBidUsd: 'asc' });
    } else if (query.sort === 'price_desc') {
      orderBy.push({ currentBidUsd: 'desc' });
    } else if (query.sort === 'year_asc') {
      orderBy.push({ year: 'asc' });
    } else if (query.sort === 'year_desc') {
      orderBy.push({ year: 'desc' });
    } else {
      // Default: upcoming auctions first, then by last seen
      orderBy.push({ ad: 'asc' });
      orderBy.push({ lastSeenAt: 'desc' });
    }
    if (query.sortDir) {
      orderBy[0] = { [Object.keys(orderBy[0])[0]]: query.sortDir };
    }

    const [lots, total] = await Promise.all([
      this.prisma.discoveredLot.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
      }),
      this.prisma.discoveredLot.count({ where }),
    ]);

    return {
      items: lots.map(toPublicCardDto),
      total,
      page,
      pageSize,
      hasMore: skip + lots.length < total,
    };
  }

  /**
   * Get a single public auction lot by provider and external lot ID.
   */
  async findOne(
    provider: string,
    externalLotId: string,
  ): Promise<PublicAuctionLotDetailDto> {
    const lot = await this.prisma.discoveredLot.findUnique({
      where: { provider_externalLotId: { provider, externalLotId } },
    });

    if (!lot) {
      throw new NotFoundException(
        `Auction lot ${provider}/${externalLotId} not found`,
      );
    }

    return toPublicDetailDto(lot);
  }

  /**
   * Get public auction lot stats (semantic counters).
   */
  async getStats(): Promise<PublicAuctionLotStatsDto> {
    const now = new Date();

    // currentLotCount: FRESH, nonterminal, active lifecycle states
    const [currentLotCount, liveLotCount, buyNowCount, upcomingCount, curatedCount] = await Promise.all([
      // Current lots: active lifecycle, not terminal
      this.prisma.discoveredLot.count({
        where: {
          availabilityConfirmed: true,
          consecutiveMisses: { lt: 3 },
          auctionState: { in: ['on', 'open', 'live', 'upcoming', 'pending'] },
        },
      }),
      // Live lots: LIVE state
      this.prisma.discoveredLot.count({
        where: {
          availabilityConfirmed: true,
          consecutiveMisses: { lt: 3 },
          auctionState: { in: ['live', 'on'] },
        },
      }),
      // Buy Now lots
      this.prisma.discoveredLot.count({
        where: {
          availabilityConfirmed: true,
          consecutiveMisses: { lt: 3 },
          isBuyNow: true,
          buyNowUsd: { not: null },
        },
      }),
      // Upcoming lots: future auction date
      this.prisma.discoveredLot.count({
        where: {
          availabilityConfirmed: true,
          consecutiveMisses: { lt: 3 },
          ad: { gt: now },
        },
      }),
      // Curated published vehicles (separate counter)
      this.prisma.vehicle.count({
        where: { publicationStatus: 'PUBLISHED' },
      }),
    ]);

    return {
      currentLotCount,
      liveLotCount,
      buyNowCount,
      upcomingCount,
      curatedVehicleCount: curatedCount,
    };
  }

  /**
   * Map public lifecycle state filter to provider auction state.
   */
  private mapLifecycleStateFilter(lifecycleState: string): any {
    switch (lifecycleState) {
      case 'LIVE':
      case 'OPEN':
        return { in: ['on', 'open', 'live'] };
      case 'UPCOMING':
        return { in: ['upcoming', 'pending'] };
      case 'ENDED':
        return 'ended';
      case 'SOLD':
        return 'sold';
      case 'REMOVED':
        return { in: ['removed', 'cancelled'] };
      default:
        return undefined;
    }
  }
}
