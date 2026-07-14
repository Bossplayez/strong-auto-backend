// ─────────────────────────────────────────────────────────────
// Strong Auto — Page-Limit Provider Adapter (Task 036 Phase C)
// Wraps the existing Copart/IAAI search service behind the
// ProviderAdapter interface. Page-based pagination.
// ─────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import type {
  ProviderAdapter,
  ContinuationToken,
  ListPartitionResult,
  DetailResult,
} from './provider-adapter.interface';
import type {
  NormalizedAuctionLot,
  DiscoveryPartition,
  AuctionLifecycleState,
} from './types';
import { normalizeLifecycleState } from './lifecycle-mapping';

/**
 * Page-based continuation token.
 * Encoded as base64 JSON: { page, exhausted }
 */
function encodeToken(page: number, exhausted: boolean): ContinuationToken {
  return Buffer.from(JSON.stringify({ page, exhausted })).toString('base64');
}

function decodeToken(token: ContinuationToken): { page: number; exhausted: boolean } | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    if (typeof decoded.page !== 'number' || typeof decoded.exhausted !== 'boolean') return null;
    if (decoded.page < 1) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Supported filter keys for page-based providers.
 */
const SUPPORTED_FILTERS = new Set([
  'make', 'model', 'year', 'buyNow', 'lifecycleState',
]);

@Injectable()
export class PageLimitProviderAdapter implements ProviderAdapter {
  private readonly logger = new Logger(PageLimitProviderAdapter.name);
  readonly providerId: string;

  constructor(providerId: string = 'copart') {
    this.providerId = providerId;
  }

  async listPartition(
    partition: DiscoveryPartition,
    continuation?: ContinuationToken,
  ): Promise<ListPartitionResult> {
    const { page } = continuation
      ? (decodeToken(continuation) ?? { page: 1 })
      : { page: 1 };

    const startTime = Date.now();

    try {
      // In production this calls the real provider client.
      // For now, returns empty result — no provider call is authorized.
      // The adapter structure is complete and tested with fixtures.
      this.logger.debug(
        `${this.providerId}: listPartition page=${page} partition=${JSON.stringify(partition)}`,
      );

      // No provider call — return empty exhausted result
      // Real implementation will call the existing search service
      const lots: NormalizedAuctionLot[] = [];
      const exhausted = true;

      return {
        lots,
        totalFetched: 0,
        nextContinuation: exhausted ? null : encodeToken(page + 1, false),
        exhausted,
        metadata: {
          requestCount: 0,
          endpoint: 'search',
          partitionLabel: `${this.providerId}:${partition.lifecycleFilter?.join(',') ?? 'all'}`,
          retryCount: 0,
        },
      };
    } catch (error) {
      this.logger.error(`${this.providerId}: listPartition failed: ${error}`);
      throw error;
    }
  }

  async getDetail(
    provider: string,
    externalLotId: string,
  ): Promise<DetailResult> {
    this.logger.debug(`${provider}: getDetail lot=${externalLotId}`);

    // No provider call — returns null
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
    return decodeToken(token) !== null;
  }

  supportsFilter(filterKey: string): boolean {
    return SUPPORTED_FILTERS.has(filterKey);
  }
}

/**
 * Detect repeated page/token loops.
 * Tracks seen tokens and pages to prevent duplicate processing.
 */
export class LoopDetector {
  private seen = new Set<string>();

  /**
   * Check if a continuation token has been seen before.
   * Returns true if this is a duplicate (loop detected).
   */
  isDuplicate(token: ContinuationToken): boolean {
    if (this.seen.has(token)) return true;
    this.seen.add(token);
    return false;
  }

  /**
   * Check if a page number has been seen before.
   */
  isPageDuplicate(page: number): boolean {
    const key = `page:${page}`;
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    return false;
  }

  reset(): void {
    this.seen.clear();
  }
}
