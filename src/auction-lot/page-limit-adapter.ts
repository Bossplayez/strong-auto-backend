// ─────────────────────────────────────────────────────────────
// Strong Auto — Page-Limit Adapter (DEPRECATED — Task 036)
// This adapter is NOT used for the RapidAPI cursor contract.
// Copart/IAAI now use the CursorProviderAdapter with RapidApiTransport.
// This stub exists only to prevent accidental selection.
// ─────────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import type {
  ProviderAdapter,
  ContinuationToken,
  ListPartitionResult,
  DetailResult,
} from './provider-adapter.interface';
import type { DiscoveryPartition } from './types';

/**
 * @deprecated Page-limit adapter is not used for RapidAPI cursor contract.
 * Use CursorProviderAdapter instead.
 */
@Injectable()
export class PageLimitProviderAdapter implements ProviderAdapter {
  readonly providerId: string;

  constructor(providerId: string = 'copart') {
    this.providerId = providerId;
  }

  async listPartition(
    _partition: DiscoveryPartition,
    _continuation?: ContinuationToken,
  ): Promise<ListPartitionResult> {
    throw new Error(
      'Page-limit adapter is not used for RapidAPI cursor contract. ' +
      'Use CursorProviderAdapter with RapidApiTransport instead.',
    );
  }

  async getDetail(
    _provider: string,
    _externalLotId: string,
  ): Promise<DetailResult> {
    throw new Error(
      'Page-limit adapter is not used for RapidAPI cursor contract. ' +
      'Use CursorProviderAdapter with RapidApiTransport instead.',
    );
  }

  isValidContinuation(_token: ContinuationToken): boolean {
    return false;
  }

  supportsFilter(_filterKey: string): boolean {
    return false;
  }
}

/**
 * @deprecated LoopDetector is preserved for backwards compatibility
 * but should not be used for cursor-based pagination.
 */
export class LoopDetector {
  private seen = new Set<string>();

  isDuplicate(token: ContinuationToken): boolean {
    if (this.seen.has(token)) return true;
    this.seen.add(token);
    return false;
  }

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
