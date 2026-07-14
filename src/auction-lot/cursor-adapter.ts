// ─────────────────────────────────────────────────────────────
// Strong Auto — Cursor Provider Adapter (Task 036 Phase C)
// Cursor-based pagination adapter. Tested from sanitized fixtures
// so the domain remains contract-agnostic.
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
} from './types';

/**
 * Cursor-based continuation token.
 * Encoded as base64 JSON: { cursor, exhausted }
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

@Injectable()
export class CursorProviderAdapter implements ProviderAdapter {
  private readonly logger = new Logger(CursorProviderAdapter.name);
  readonly providerId: string;

  constructor(providerId: string = 'iaai') {
    this.providerId = providerId;
  }

  async listPartition(
    partition: DiscoveryPartition,
    continuation?: ContinuationToken,
  ): Promise<ListPartitionResult> {
    const { cursor } = continuation
      ? (decodeCursorToken(continuation) ?? { cursor: '' })
      : { cursor: '' };

    this.logger.debug(
      `${this.providerId}: listPartition cursor=${cursor} partition=${JSON.stringify(partition)}`,
    );

    // No provider call — returns empty exhausted result
    // Real implementation will call provider with cursor
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

  async getDetail(
    provider: string,
    externalLotId: string,
  ): Promise<DetailResult> {
    this.logger.debug(`${provider}: getDetail lot=${externalLotId}`);
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
