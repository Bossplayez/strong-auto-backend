// ─────────────────────────────────────────────────────────────
// Strong Auto — Cursor Provider Adapter (Task 036)
// Real adapter using RapidApiTransport with cursor-based pagination.
//
// VERIFIED CONTRACT:
//   auction_type=1 (copart) / 2 (iaai)
//   per_page=N (default 20)
//   cursor=<opaque> from meta.next_cursor — forwarded byte-for-byte
//   NEVER generate/increment cursor tokens
// ─────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ProviderAdapter,
  ContinuationToken,
  ListPartitionResult,
  DetailResult,
} from './provider-adapter.interface';
import type {
  NormalizedAuctionLot,
  DiscoveryPartition,
} from './types';
import { AuctionLifecycleState, AuctionFreshnessState } from './types';
import { RapidApiTransport, ProviderMismatchError } from './rapidapi-transport';
import { RequestBudgetService } from '../copart/request-budget.service';
import { normalizeDiscoveredLot } from '../copart/lot-normalizer';
import type { ProviderId } from '../copart/provider-lease.service';

/**
 * Cursor-based continuation token.
 * Stores the opaque cursor from the provider's meta.next_cursor.
 * The cursor is NEVER decoded or generated — only forwarded.
 */
function encodeCursorToken(cursor: string, exhausted: boolean): ContinuationToken {
  return Buffer.from(JSON.stringify({ cursor, exhausted })).toString('base64');
}

function decodeCursorToken(token: ContinuationToken): { cursor: string; exhausted: boolean } | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    if (typeof decoded.cursor !== 'string' || typeof decoded.exhausted !== 'boolean') return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Supported filter keys for cursor-based providers.
 */
const SUPPORTED_FILTERS = new Set([
  'make', 'model', 'year', 'buyNow', 'lifecycleState',
  'dateFrom', 'dateTo',
]);

/**
 * Map a NormalizedLotData (from lot-normalizer) to NormalizedAuctionLot.
 * The normalizer produces a flat object suitable for DB persistence;
 * we need to add lifecycle/freshness fields for the adapter interface.
 */
function toNormalizedAuctionLot(
  normalized: ReturnType<typeof normalizeDiscoveredLot>,
  provider: string,
  externalLotId: string,
): NormalizedAuctionLot {
  const now = new Date();
  return {
    provider,
    externalLotId,
    make: normalized.make,
    model: normalized.model,
    year: normalized.year,
    title: normalized.title,
    bodyStyle: normalized.bodyStyle,
    fuelType: normalized.fuelType,
    driveType: normalized.driveType,
    odometerKm: normalized.odometerKm,
    odometerMi: normalized.odometerMi,
    locationDisplay: normalized.locationDisplay,
    locationState: normalized.locationState,
    lifecycleState: deriveLifecycleState(normalized.auctionState),
    auctionTimestamp: normalized.ad,
    auctionRawState: normalized.auctionState,
    currentBidUsd: normalized.currentBidUsd,
    buyNowUsd: normalized.buyNowUsd,
    currency: 'USD',
    thumbnailUrl: null,
    mediaUrls: [],
    mediaCount: normalized.thumbsCount,
    freshnessState: AuctionFreshnessState.FRESH,
    firstSeenAt: now,
    lastSeenAt: now,
    lastProviderUpdateAt: now,
    nextRefreshAt: null,
    staleAfterMs: 300_000, // 5 min default
    terminalAt: null,
    consecutiveMisses: 0,
    attemptCost: 1,
  };
}

/** Derive lifecycle state from raw auction state string. */
function deriveLifecycleState(auctionState: string | null): AuctionLifecycleState {
  if (!auctionState) return AuctionLifecycleState.NOT_READY;
  const s = auctionState.toLowerCase();
  if (s.includes('sold')) return AuctionLifecycleState.SOLD;
  if (s.includes('ended') || s.includes('closed')) return AuctionLifecycleState.ENDED;
  if (s.includes('live') || s.includes('open')) return AuctionLifecycleState.OPEN;
  if (s.includes('upcoming') || s.includes('pending')) return AuctionLifecycleState.UPCOMING;
  if (s.includes('removed') || s.includes('withdrawn')) return AuctionLifecycleState.REMOVED;
  return AuctionLifecycleState.NOT_READY;
}

@Injectable()
export class CursorProviderAdapter implements ProviderAdapter {
  private readonly logger = new Logger(CursorProviderAdapter.name);
  readonly providerId: string;
  private readonly transport: RapidApiTransport;

  constructor(
    providerId: string = 'iaai',
    config?: ConfigService,
    budgetService?: RequestBudgetService,
  ) {
    this.providerId = providerId;
    if (config && budgetService) {
      this.transport = new RapidApiTransport(config, budgetService, this.logger);
    } else {
      // Will be set via setTransport or used in tests with mock
      this.transport = null as any;
    }
  }

  /** Allow injecting a transport (for testing or DI). */
  setTransport(transport: RapidApiTransport): void {
    (this as any).transport = transport;
  }

  async listPartition(
    partition: DiscoveryPartition,
    continuation?: ContinuationToken,
  ): Promise<ListPartitionResult> {
    const { cursor, exhausted: tokenExhausted } = continuation
      ? (decodeCursorToken(continuation) ?? { cursor: '', exhausted: false })
      : { cursor: '', exhausted: false };

    // If token says exhausted, return empty immediately
    if (tokenExhausted) {
      return {
        lots: [],
        totalFetched: 0,
        nextContinuation: null,
        exhausted: true,
        metadata: {
          requestCount: 0,
          endpoint: 'search',
          partitionLabel: `${this.providerId}:${partition.lifecycleFilter?.join(',') ?? 'all'}`,
          retryCount: 0,
        },
      };
    }

    // Build filters from partition
    const filters: Record<string, string | number | boolean | undefined> = {};
    if (partition.makeFilter) filters.make = partition.makeFilter;
    if (partition.modelFilter) filters.model = partition.modelFilter;
    if (partition.buyNowFirst) filters.buy_now = 'true';

    const result = await this.transport.listVehicles({
      provider: this.providerId as ProviderId,
      perPage: 20,
      cursor: cursor || null,
      filters,
    });

    // Map raw items to NormalizedAuctionLot
    const lots: NormalizedAuctionLot[] = [];
    for (const raw of result.items) {
      const lotId = String(raw.lot_number ?? '');
      if (!lotId) continue;

      const normalized = normalizeDiscoveredLot(raw, this.providerId);
      lots.push(toNormalizedAuctionLot(normalized, this.providerId, lotId));
    }

    // Determine exhaustion from meta.next_cursor
    const nextCursor = result.meta.next_cursor;
    const isExhausted = nextCursor === null || nextCursor === undefined || nextCursor === '';

    return {
      lots,
      totalFetched: result.items.length,
      nextContinuation: isExhausted ? null : encodeCursorToken(nextCursor, false),
      exhausted: isExhausted,
      metadata: {
        requestCount: result.requestCount,
        endpoint: 'search',
        partitionLabel: `${this.providerId}:${partition.lifecycleFilter?.join(',') ?? 'all'}`,
        retryCount: result.retryCount,
      },
    };
  }

  async getDetail(
    provider: string,
    externalLotId: string,
  ): Promise<DetailResult> {
    this.logger.debug(`${provider}: getDetail lot=${externalLotId}`);
    // Detail calls would use the transport's fetch for /vehicles/:id
    // For now, return null — detail hydration is a separate concern
    return {
      lot: null,
      metadata: {
        requestCount: 0,
        endpoint: 'detail',
        retryCount: 0,
      },
    };
  }

  isValidContinuation(token: ContinuationToken): boolean {
    return decodeCursorToken(token) !== null;
  }

  supportsFilter(filterKey: string): boolean {
    return SUPPORTED_FILTERS.has(filterKey);
  }
}
