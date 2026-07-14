// ─────────────────────────────────────────────────────────────
// Strong Auto — Provider Adapter Interface (Task 036)
// Abstract interface that both Copart and IAAI adapters implement.
// Supports both page-based and cursor-based pagination adapters.
// ─────────────────────────────────────────────────────────────

import type {
  NormalizedAuctionLot,
  DiscoveryPartition,
  DiscoveryResult,
} from './types';

/**
 * Opaque continuation token. Never synthesized by the framework.
 * Only provider adapters may create or interpret these.
 */
export type ContinuationToken = string;

/**
 * Sanitized request metadata returned after each provider call.
 * Does NOT include credentials, lease tokens, or internal state.
 */
export interface ProviderRequestMetadata {
  requestCount: number;          // Requests made for this call
  endpoint: string;              // Which endpoint was called
  partitionLabel?: string;       // Human-readable partition description
  retryCount: number;            // Retries attempted (0 = no retry)
}

/**
 * Result of a listPartition call.
 */
export interface ListPartitionResult {
  lots: NormalizedAuctionLot[];
  totalFetched: number;
  nextContinuation?: ContinuationToken | null;
  exhausted: boolean;
  metadata: ProviderRequestMetadata;
}

/**
 * Result of a getDetail call.
 * Returns optional hydration data for a single lot.
 * Used only for missing required fields, HOT/live/near-auction lots,
 * Buy Now lots, tracked/viewed lots, import candidates, or
 * explicit protected admin actions.
 */
export interface DetailResult {
  lot?: NormalizedAuctionLot | null;
  metadata: ProviderRequestMetadata;
}

/**
 * Abstract provider adapter interface.
 * Implementations must handle:
 * - Page-based pagination (Copart/IAAI current contract)
 * - Cursor-based pagination (future providers)
 * - Unsupported filter rejection (never silently ignore)
 * - Repeated page/token detection and loop stopping
 * - Sanitization of sensitive fields (seller info, credentials)
 */
export interface ProviderAdapter {
  /** Unique provider identifier (e.g. "copart", "iaai") */
  readonly providerId: string;

  /**
   * Fetch lots for a given partition.
   * Returns normalized lots plus opaque continuation token.
   * The continuation token is provider-specific and must not be
   * interpreted by the discovery framework.
   *
   * @throws {UnsupportedFilterError} if an unsupported filter is used
   * @throws {ProviderRateLimitError} if rate limited
   * @throws {ProviderAuthError} if authentication fails
   */
  listPartition(
    partition: DiscoveryPartition,
    continuation?: ContinuationToken,
  ): Promise<ListPartitionResult>;

  /**
   * Fetch detail for a single lot.
   * Used selectively for hydration — NOT for default lot display.
   */
  getDetail(
    provider: string,
    externalLotId: string,
  ): Promise<DetailResult>;

  /**
   * Validate that a continuation token belongs to this provider.
   * Returns false for tokens from other providers or malformed tokens.
   */
  isValidContinuation(token: ContinuationToken): boolean;

  /**
   * Check if a filter key is supported by this provider.
   */
  supportsFilter(filterKey: string): boolean;
}

/**
 * Error thrown when an unsupported filter is requested.
 */
export class UnsupportedFilterError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly filterKey: string,
    message?: string,
  ) {
    super(
      message ??
        `Provider "${providerId}" does not support filter "${filterKey}"`,
    );
    this.name = 'UnsupportedFilterError';
  }
}

/**
 * Error thrown when the provider rate limits the request.
 */
export class ProviderRateLimitError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly retryAfterMs?: number,
    message?: string,
  ) {
    super(
      message ?? `Provider "${providerId}" rate limited the request`,
    );
    this.name = 'ProviderRateLimitError';
  }
}

/**
 * Error thrown when provider authentication fails.
 */
export class ProviderAuthError extends Error {
  constructor(
    public readonly providerId: string,
    message?: string,
  ) {
    super(
      message ?? `Provider "${providerId}" authentication failed`,
    );
    this.name = 'ProviderAuthError';
  }
}
