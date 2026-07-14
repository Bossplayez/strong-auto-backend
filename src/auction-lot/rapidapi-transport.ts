// ─────────────────────────────────────────────────────────────
// Strong Auto — RapidAPI Transport Layer (Task 036)
// Centralized transport for Copart/IAAI RapidAPI calls.
//
// VERIFIED API CONTRACT:
//   auction_type=1 → Copart, auction_type=2 → IAAI
//   per_page=N (NOT limit)
//   cursor=<opaque> (NOT page) — forwarded byte-for-byte from meta.next_cursor
//   NEVER generate/increment cursor tokens
// ─────────────────────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  providerFetch,
  type ProviderFetchConfig,
  type ProviderFetchOutcome,
} from '../copart/provider-fetch';
import type { ProviderId } from '../copart/provider-lease.service';
import type { RequestBudgetService, FailureKind } from '../copart/request-budget.service';

/** Map provider string to auction_type parameter. */
const AUCTION_TYPE_MAP: Record<ProviderId, number> = {
  copart: 1,
  iaai: 2,
};

/** Reverse map: auction_type → provider string (for validation). */
const PROVIDER_FROM_AUCTION_TYPE: Record<number, ProviderId> = {
  1: 'copart',
  2: 'iaai',
};

/** Default per_page for production use. */
const DEFAULT_PER_PAGE = 20;

/** Sanitized response metadata returned by the transport. */
export interface TransportMeta {
  next_cursor: string | null;
  prev_cursor: string | null;
  per_page: number;
}

/** Sanitized transport result — no credentials, no raw payload. */
export interface TransportResult {
  items: Record<string, any>[];
  meta: TransportMeta;
  requestCount: number;
  retryCount: number;
}

/** Options for a transport list call. */
export interface TransportListOptions {
  provider: ProviderId;
  perPage?: number;
  cursor?: string | null;
  /** Additional query params (make, year, search, etc.) */
  filters?: Record<string, string | number | boolean | undefined>;
  /** Job deadline in ms epoch. If not set, uses config default. */
  jobDeadlineMs?: number;
}

/** Error thrown when provider identity mismatch is detected. */
export class ProviderMismatchError extends Error {
  constructor(
    public readonly expectedProvider: ProviderId,
    public readonly actualPlatform: string,
    message?: string,
  ) {
    super(
      message ??
        `Provider mismatch: expected "${expectedProvider}" but items identify as "${actualPlatform}"`,
    );
    this.name = 'ProviderMismatchError';
  }
}

/** Error thrown when the API response is malformed. */
export class TransportMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportMalformedError';
  }
}

/**
 * Centralized RapidAPI transport for Copart/IAAI.
 *
 * Responsibilities:
 * - Map provider → auction_type
 * - Use per_page (not limit)
 * - Forward opaque cursor byte-for-byte
 * - NEVER generate/increment cursor tokens
 * - Reject responses where items identify as wrong provider
 * - Reserve → confirm → complete budget lifecycle
 */
export class RapidApiTransport {
  private readonly logger: Logger;
  private readonly RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
  private readonly RAPIDAPI_BASE = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com';

  constructor(
    private readonly config: ConfigService,
    private readonly budgetService: RequestBudgetService,
    logger?: Logger,
  ) {
    this.logger = logger ?? new Logger(RapidApiTransport.name);
  }

  /** Build the API URL with verified contract params. */
  private buildUrl(options: TransportListOptions): string {
    const url = new URL(`${this.RAPIDAPI_BASE}/vehicles`);
    const auctionType = AUCTION_TYPE_MAP[options.provider];
    url.searchParams.set('auction_type', String(auctionType));
    url.searchParams.set('per_page', String(options.perPage ?? DEFAULT_PER_PAGE));

    // Forward cursor byte-for-byte — NEVER decode/generate/increment
    if (options.cursor) {
      url.searchParams.set('cursor', options.cursor);
    }

    // Apply additional filters
    if (options.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /** Get fetch config from app config. */
  private getFetchConfig(jobDeadlineMs?: number): ProviderFetchConfig {
    const deadline = jobDeadlineMs ?? Date.now() + this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')! * 2;
    return {
      requestTimeoutMs: this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')!,
      maxRetryAttempts: this.config.get<number>('IMPORT_MAX_RETRY_ATTEMPTS')!,
      initialRetryDelayMs: this.config.get<number>('IMPORT_INITIAL_RETRY_DELAY_MS')!,
      maxRetryDelayMs: this.config.get<number>('IMPORT_MAX_RETRY_DELAY_MS')!,
      jobDeadlineMs: deadline,
    };
  }

  /** Validate that returned items belong to the expected provider. */
  private validateProviderIdentity(
    items: Record<string, any>[],
    expectedProvider: ProviderId,
  ): void {
    if (items.length === 0) return;

    // Check the `platform` field on returned items
    for (const item of items) {
      const platform = item?.platform;
      if (platform === undefined || platform === null) {
        // Missing platform field — reject rather than silently accept
        throw new ProviderMismatchError(
          expectedProvider,
          'missing',
          `Returned item has no 'platform' field (lot: ${item?.lot_number ?? 'unknown'})`,
        );
      }
      const platformStr = String(platform).toLowerCase();
      if (platformStr !== expectedProvider) {
        throw new ProviderMismatchError(expectedProvider, platformStr);
      }
    }
  }

  /**
   * Execute a list request against the RapidAPI /vehicles endpoint.
   *
   * Uses the VERIFIED contract:
   *   auction_type=1 (copart) / 2 (iaai)
   *   per_page=N
   *   cursor=<opaque from meta.next_cursor>
   *
   * Budget lifecycle: reserve → confirm → complete
   */
  async listVehicles(options: TransportListOptions): Promise<TransportResult> {
    const apiKey = this.config.get<string>('RAPIDAPI_KEY');
    if (!apiKey) {
      throw new TransportMalformedError('RAPIDAPI_KEY not configured');
    }

    const url = this.buildUrl(options);
    const fetchConfig = this.getFetchConfig(options.jobDeadlineMs);
    const headers = {
      'x-rapidapi-host': this.RAPIDAPI_HOST,
      'x-rapidapi-key': apiKey,
    };

    // ── Budget reservation via pre-request hook ──
    const attemptCounter = { n: 0 };
    let lastAttemptId: string | undefined;

    const preRequestHook = async () => {
      attemptCounter.n++;
      const attemptId = `transport-${options.provider}-${crypto.randomUUID()}`;
      const reservation = await this.budgetService.reserve(
        options.provider,
        null,
        attemptId,
        'routine',
      );
      if (!reservation.allowed) {
        return { allowed: false, reason: reservation.reason };
      }
      lastAttemptId = attemptId;
      return { allowed: true };
    };

    this.logger.debug(
      `${options.provider}: listVehicles auction_type=${AUCTION_TYPE_MAP[options.provider]} per_page=${options.perPage ?? DEFAULT_PER_PAGE} cursor=${options.cursor ? '[present]' : '[absent]'}`,
    );

    const outcome: ProviderFetchOutcome<any> = await providerFetch<any>(
      url,
      headers,
      fetchConfig,
      this.logger,
      undefined,
      undefined,
      preRequestHook,
    );

    // ── Confirm + complete budget ──
    if (lastAttemptId) {
      await this.budgetService.confirm(lastAttemptId);
      const success = outcome.ok;
      let failureKind: FailureKind | undefined;
      if (!success) {
        const f = outcome.failure;
        if (f.kind === 'HTTP_429') failureKind = 'rateLimit';
        else if (f.kind === 'HTTP_5XX') failureKind = 'server';
        else if (f.kind === 'NETWORK_ERROR') failureKind = 'network';
        else if (f.kind === 'HTTP_4XX') failureKind = 'client';
        else failureKind = 'timeout';
      }
      await this.budgetService.complete(lastAttemptId, success, failureKind);
    }

    if (!outcome.ok) {
      const f = outcome.failure;
      throw new TransportMalformedError(
        `Provider fetch failed: ${f.kind}${f.status ? ` (${f.status})` : ''} — ${f.message}`,
      );
    }

    const body = outcome.data;

    // Validate response shape
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new TransportMalformedError(`Expected JSON object, received ${typeof body}`);
    }

    const items = Array.isArray(body.data) ? body.data : [];
    const rawMeta = body.meta ?? {};

    const meta: TransportMeta = {
      next_cursor: typeof rawMeta.next_cursor === 'string' ? rawMeta.next_cursor : null,
      prev_cursor: typeof rawMeta.prev_cursor === 'string' ? rawMeta.prev_cursor : null,
      per_page: typeof rawMeta.per_page === 'number' ? rawMeta.per_page : (options.perPage ?? DEFAULT_PER_PAGE),
    };

    // ── Provider identity validation ──
    this.validateProviderIdentity(items, options.provider);

    const retryCount = Math.max(0, outcome.attempts - 1);

    this.logger.debug(
      `${options.provider}: listVehicles returned ${items.length} items, next_cursor=${meta.next_cursor ? '[present]' : '[null]'}, attempts=${outcome.attempts}`,
    );

    return {
      items,
      meta,
      requestCount: outcome.attempts,
      retryCount,
    };
  }

  /** Get the auction_type for a provider. */
  static getAuctionType(provider: ProviderId): number {
    return AUCTION_TYPE_MAP[provider];
  }

  /** Get the provider for an auction_type. */
  static getProvider(auctionType: number): ProviderId | undefined {
    return PROVIDER_FROM_AUCTION_TYPE[auctionType];
  }
}
