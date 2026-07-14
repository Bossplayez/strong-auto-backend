// ─────────────────────────────────────────────────────────────
// Strong Auto — Public Auction Lots Service (Task 036)
// Read-only service for public auction lot queries.
// Reads from Strong Auto PostgreSQL only. Never calls providers.
// Uses tested lifecycle-mapping for all state transitions.
// ─────────────────────────────────────────────────────────────

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DiscoveredLot } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  normalizeLifecycleState,
  computeFreshnessState,
  isPublicEligible,
  STALE_AFTER_MS,
} from './lifecycle-mapping';
import { AuctionLifecycleState, AuctionFreshnessState } from './types';
import type {
  PublicAuctionLotCardDto,
  PublicAuctionLotDetailDto,
  PublicAuctionLotStatsDto,
  PublicAuctionLotListResponse,
} from './dto/public-auction-lot.dto';

const VALID_PROVIDERS = ['copart', 'iaai'] as const;
const VALID_LIFECYCLE_STATES = [
  'NOT_READY', 'UPCOMING', 'OPEN', 'LIVE', 'ENDED', 'SOLD', 'REMOVED',
] as const;
type ProviderType = typeof VALID_PROVIDERS[number];
type LifecycleStateType = typeof VALID_LIFECYCLE_STATES[number];
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Map a DiscoveredLot Prisma record to a public card DTO.
 * Only allowlisted fields are exposed.
 * Sensitive fields (VIN, seller info, raw payload, lease state) are excluded.
 */
function toPublicCardDto(lot: DiscoveredLot): PublicAuctionLotCardDto {
  const now = new Date();
  const lifecycleState = normalizeLifecycleState(
    lot.auctionState,
    lot.auctionTime ?? lot.ad,
    now,
  );

  const tier = lot.freshnessTier ?? 'COLD';
  const staleAfterMs =
    tier === 'HOT' ? STALE_AFTER_MS.HOT :
    tier === 'WARM' ? STALE_AFTER_MS.WARM :
    STALE_AFTER_MS.COLD;

  const freshnessState = computeFreshnessState(
    lot.lastSeenAt ?? new Date(),
    lot.nextRefreshAt,
    lot.consecutiveMisses ?? 0,
    lot.availabilityConfirmed ?? false,
    lifecycleState as AuctionLifecycleState,
    staleAfterMs,
    now,
  );

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
    lifecycleState,
    auctionTimestamp: (lot.auctionTime ?? lot.ad) ? (lot.auctionTime ?? lot.ad)!.toISOString() : null,
    auctionTimezoneOffset: lot.auctionTimezoneOffset ?? null,
    currentBidUsd: lot.currentBidUsd ? Number(lot.currentBidUsd) : null,
    buyNowUsd: lot.buyNowUsd ? Number(lot.buyNowUsd) : null,
    currency: 'USD',
    thumbnailUrl: lot.mediaUrls?.[0] ?? null,
    mediaCount: lot.mediaUrls?.length ?? lot.thumbsCount ?? 0,
    locationDisplay: lot.locationDisplay || null,
    locationState: lot.locationState || null,
    freshnessState,
    freshnessTimestamp: (lot.lastProviderUpdateAt ?? lot.lastSeenAt ?? new Date()).toISOString(),
    importedVehicleId: lot.vehicleId || null,
  };
}

/**
 * Map a DiscoveredLot to a public detail DTO.
 */
function toPublicDetailDto(lot: DiscoveredLot): PublicAuctionLotDetailDto {
  const card = toPublicCardDto(lot);
  return {
    ...card,
    primaryDamage: lot.primaryDamage || null,
    secondaryDamage: lot.secondaryDamage || null,
    engine: lot.engine || null,
    transmission: lot.transmission || null,
    exteriorColor: lot.exteriorColor || null,
    mediaUrls: lot.mediaUrls ?? [],
    has360: lot.has360 ?? false,
    hasVideo: lot.hasVideo ?? false,
  };
}

/**
 * Check if a lot counts as "current" for public stats.
 * Must be: public-eligible, FRESH, nonterminal, NOT_READY|UPCOMING|OPEN|LIVE
 */
function isCurrentLot(lot: Pick<DiscoveredLot, 'auctionState' | 'auctionTime' | 'ad' | 'lastSeenAt' | 'nextRefreshAt' | 'consecutiveMisses' | 'availabilityConfirmed' | 'freshnessTier' | 'lifecycleState' | 'freshnessState' | 'isBuyNow' | 'buyNowUsd'>): boolean {
  const now = new Date();
  const lifecycle = normalizeLifecycleState(
    lot.auctionState,
    lot.auctionTime ?? lot.ad,
    now,
  );
  const tier = lot.freshnessTier ?? 'COLD';
  const staleAfterMs =
    tier === 'HOT' ? STALE_AFTER_MS.HOT :
    tier === 'WARM' ? STALE_AFTER_MS.WARM :
    STALE_AFTER_MS.COLD;
  const freshness = computeFreshnessState(
    lot.lastSeenAt ?? new Date(),
    lot.nextRefreshAt,
    lot.consecutiveMisses ?? 0,
    lot.availabilityConfirmed ?? false,
    lifecycle,
    staleAfterMs,
    now,
  );

  if (!isPublicEligible(freshness as AuctionFreshnessState, lifecycle as AuctionLifecycleState, lot.availabilityConfirmed ?? false, lot.consecutiveMisses ?? 0))
    return false;

  return [
    AuctionLifecycleState.NOT_READY,
    AuctionLifecycleState.UPCOMING,
    AuctionLifecycleState.OPEN,
    AuctionLifecycleState.LIVE,
  ].includes(lifecycle as AuctionLifecycleState);
}

@Injectable()
export class AuctionLotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get paginated public auction lots.
   * Only returns public-eligible lots.
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
    // Validate provider
    if (query.provider && !VALID_PROVIDERS.includes(query.provider as ProviderType)) {
      throw new BadRequestException(
        `Invalid provider "${query.provider}". Valid: ${VALID_PROVIDERS.join(', ')}`,
      );
    }

    // Validate lifecycle state
    if (query.lifecycleState && !VALID_LIFECYCLE_STATES.includes(query.lifecycleState as LifecycleStateType)) {
      throw new BadRequestException(
        `Invalid lifecycleState. Valid: ${VALID_LIFECYCLE_STATES.join(', ')}`,
      );
    }

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    // Build where clause — only public-eligible lots
    const where: Prisma.DiscoveredLotWhereInput = {
      availabilityConfirmed: true,
      consecutiveMisses: { lt: 3 },
      // Exclude terminal freshness
      freshnessState: { not: 'TERMINAL' },
    };

    // Exclude terminal lifecycle
    where.NOT = {
      lifecycleState: { in: ['SOLD', 'REMOVED'] },
    };

    if (query.provider) where.provider = query.provider;
    if (query.make) where.make = { equals: query.make, mode: 'insensitive' };
    if (query.model) where.model = { equals: query.model, mode: 'insensitive' };
    if (query.year) where.year = query.year;
    if (query.buyNow) {
      where.isBuyNow = true;
      where.buyNowUsd = { not: null };
    }
    if (query.lifecycleState) {
      where.lifecycleState = query.lifecycleState as LifecycleStateType;
    }

    // Build order by
    const orderBy: Prisma.DiscoveredLotOrderByWithRelationInput[] = [];
    if (query.sort === 'price_asc') {
      orderBy.push({ currentBidUsd: 'asc' });
    } else if (query.sort === 'price_desc') {
      orderBy.push({ currentBidUsd: 'desc' });
    } else if (query.sort === 'year_asc') {
      orderBy.push({ year: 'asc' });
    } else if (query.sort === 'year_desc') {
      orderBy.push({ year: 'desc' });
    } else if (query.sort === 'auction_asc') {
      orderBy.push({ auctionTime: 'asc' });
    } else if (query.sort === 'auction_desc') {
      orderBy.push({ auctionTime: 'desc' });
    } else {
      // Default: upcoming auctions first, then by last seen
      orderBy.push({ auctionTime: { sort: 'asc', nulls: 'last' } });
      orderBy.push({ lastSeenAt: 'desc' });
    }

    // Apply sortDir to first orderBy entry
    if (query.sortDir && orderBy.length > 0) {
      const firstKey = Object.keys(orderBy[0])[0];
      orderBy[0] = { [firstKey]: query.sortDir };
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
    if (!VALID_PROVIDERS.includes(provider as ProviderType)) {
      throw new BadRequestException(
        `Invalid provider "${provider}". Valid: ${VALID_PROVIDERS.join(', ')}`,
      );
    }

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
   * Counters use tested rules — no unknown/default lot counted as current.
   */
  async getStats(): Promise<PublicAuctionLotStatsDto> {
    const now = new Date();

    // Fetch all candidate lots (public-eligible, non-terminal)
    // In production this would use SQL aggregations, but for correctness
    // we compute eligibility in application code to match the tested rules exactly.
    const candidates = await this.prisma.discoveredLot.findMany({
      where: {
        availabilityConfirmed: true,
        consecutiveMisses: { lt: 3 },
        freshnessState: { not: 'TERMINAL' },
        NOT: { lifecycleState: { in: ['SOLD', 'REMOVED'] } },
      },
      select: {
        auctionState: true,
        auctionTime: true,
        ad: true,
        lastSeenAt: true,
        nextRefreshAt: true,
        consecutiveMisses: true,
        availabilityConfirmed: true,
        freshnessTier: true,
        lifecycleState: true,
        freshnessState: true,
        isBuyNow: true,
        buyNowUsd: true,
      },
    });

    let currentLotCount = 0;
    let liveLotCount = 0;
    let buyNowCount = 0;
    let upcomingCount = 0;

    for (const lot of candidates) {
      if (!isCurrentLot(lot)) continue;

      currentLotCount++;

      const lifecycle = normalizeLifecycleState(
        lot.auctionState,
        lot.auctionTime ?? lot.ad,
        now,
      );

      if (lifecycle === AuctionLifecycleState.LIVE) {
        liveLotCount++;
      }

      if (lot.isBuyNow && lot.buyNowUsd != null) {
        buyNowCount++;
      }

      if (lifecycle === AuctionLifecycleState.UPCOMING) {
        const auctionDate = lot.auctionTime ?? lot.ad;
        if (auctionDate && auctionDate > now) {
          upcomingCount++;
        }
      }
    }

    // Curated published vehicles (separate counter)
    const curatedCount = await this.prisma.vehicle.count({
      where: { publicationStatus: 'PUBLISHED' },
    });

    return {
      currentLotCount,
      liveLotCount,
      buyNowCount,
      upcomingCount,
      curatedVehicleCount: curatedCount,
    };
  }
}
