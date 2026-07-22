/**
 * Filtered auction search service with cache and deduplication.
 *
 * VERIFIED RapidAPI contract (Task 036):
 *   auction_type=1 (copart) / 2 (iaai)
 *   per_page=N (not limit)
 *   cursor=<opaque> from meta.next_cursor
 *
 * Features:
 * - Normalize and validate all query parameters
 * - Sanitized normalized lots + cursor metadata
 * - Short-lived cache keyed by normalized query fingerprint
 * - Deduplicate concurrent identical requests
 * - Cache hits consume zero RapidAPI requests
 * - Live results ≠ published catalog vehicles
 * - Explicit idempotent import/upsert for selected lots
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveredLotState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  providerFetch,
  type ProviderFetchConfig,
} from './provider-fetch';
import { RequestBudgetService, type FailureKind } from './request-budget.service';
import type { ProviderId } from './provider-lease.service';
import { normalizeDiscoveredLot, sanitizeLotForResponse } from './lot-normalizer';
import { normalizeLifecycleState, providerResultStateFromRaw, computeFreshnessState, STALE_AFTER_MS } from '../auction-lot/lifecycle-mapping';
import { AuctionLifecycleState } from '../auction-lot/types';
import { normalizeAuctionTimestamp } from '../auction-lot/time-normalization';

export interface SearchParams {
  platform: 'copart' | 'iaai';
  make?: string;
  year?: number;
  search?: string;
  buyNow?: boolean;
  saleStatus?: string;
  sort?: string;
  cursor?: string | null;
  limit?: number;
}

export interface SearchResult {
  items: any[];
  cursor: string | null;
  hasMore: boolean;
  cached: boolean;
  provider: string;
}

@Injectable()
export class AuctionSearchService {
  private readonly logger = new Logger(AuctionSearchService.name);
  private readonly RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
  private readonly RAPIDAPI_BASE = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com';

  private inflightRequests = new Map<string, Promise<SearchResult>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly budgetService: RequestBudgetService,
  ) {}

  /** Map provider to auction_type: copart=1, iaai=2 */
  private static readonly AUCTION_TYPE_MAP: Record<string, number> = {
    copart: 1,
    iaai: 2,
  };

  /** Build a stable fingerprint from normalized search params. */
  buildQueryFingerprint(params: SearchParams): string {
    const parts: string[] = [params.platform];
    if (params.make) parts.push(`make=${params.make.toUpperCase().trim()}`);
    if (params.year) parts.push(`year=${params.year}`);
    if (params.search) parts.push(`search=${params.search.toLowerCase().trim()}`);
    if (params.buyNow) parts.push(`buy_now=true`);
    if (params.saleStatus) parts.push(`sale_status=${params.saleStatus}`);
    if (params.sort) parts.push(`sort=${params.sort}`);
    parts.push(`cursor=${params.cursor ?? 'initial'}`);
    parts.push(`per_page=${params.limit ?? 20}`);

    const str = parts.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `search_${Math.abs(hash).toString(36)}`;
  }

  /** Validate and normalize search parameters. */
  normalizeParams(raw: Record<string, any>): SearchParams {
    const platform = raw.platform === 'iaai' ? 'iaai' : 'copart';
    const limit = Math.max(1, Math.min(Number(raw.limit) || 20, 50));
    const cursor = raw.cursor ? String(raw.cursor) : null;

    const params: SearchParams = { platform, cursor, limit };

    if (raw.make && typeof raw.make === 'string') {
      params.make = raw.make.trim().slice(0, 50);
    }
    if (raw.year) {
      const y = Number(raw.year);
      if (Number.isFinite(y) && y >= 1900 && y <= new Date().getFullYear() + 1) {
        params.year = y;
      }
    }
    if (raw.search && typeof raw.search === 'string') {
      params.search = raw.search.trim().slice(0, 100);
    }
    if (raw.buy_now === 'true' || raw.buy_now === true) {
      params.buyNow = true;
    }
    if (raw.sale_status && typeof raw.sale_status === 'string') {
      params.saleStatus = raw.sale_status.slice(0, 30);
    }
    if (raw.sort && typeof raw.sort === 'string') {
      const validSorts = ['year_desc', 'year_asc', 'price_asc', 'price_desc', 'date_desc', 'date_asc'];
      if (validSorts.includes(raw.sort)) {
        params.sort = raw.sort;
      }
    }

    return params;
  }

  /** Search with cache + dedup. */
  async search(rawParams: Record<string, any>): Promise<SearchResult> {
    const params = this.normalizeParams(rawParams);
    const fingerprint = this.buildQueryFingerprint(params);

    // 1. Check cache
    const cached = await this.getFromCache(fingerprint);
    if (cached) {
      this.logger.log(`Cache hit for search ${fingerprint}`);
      return { ...cached, cached: true };
    }

    // 2. Check in-flight dedup
    const inflight = this.inflightRequests.get(fingerprint);
    if (inflight) {
      this.logger.log(`Deduplicating in-flight request ${fingerprint}`);
      return inflight;
    }

    // 3. Make new request
    const request = this.executeSearch(params, fingerprint);
    this.inflightRequests.set(fingerprint, request);

    try {
      const result = await request;
      // Store in cache
      await this.storeInCache(fingerprint, params, result);
      return result;
    } finally {
      this.inflightRequests.delete(fingerprint);
    }
  }

  /** Execute the actual API search. */
  private async executeSearch(params: SearchParams, fingerprint: string): Promise<SearchResult> {
    const apiKey = this.config.get<string>('RAPIDAPI_KEY');
    if (!apiKey) {
      throw new Error('RAPIDAPI_KEY not configured');
    }

    // Budget gate
    const budgetCheck = await this.budgetService.canMakeRoutineRequest();
    if (!budgetCheck.allowed) {
      throw new Error(`Budget exhausted: ${budgetCheck.usage.allocated}/${budgetCheck.usage.budget}`);
    }

    // Budget reservation
    const attemptId = `search-${fingerprint}-${crypto.randomUUID()}`;
    const reservation = await this.budgetService.reserve(
      params.platform as ProviderId,
      null,
      attemptId,
      'routine',
    );
    if (!reservation.allowed) {
      throw new Error(`Budget reservation denied: ${reservation.reason}`);
    }

    const url = new URL(`${this.RAPIDAPI_BASE}/vehicles`);
    url.searchParams.set('auction_type', String(AuctionSearchService.AUCTION_TYPE_MAP[params.platform] ?? 1));
    url.searchParams.set('per_page', String(params.limit));
    if (params.cursor) url.searchParams.set('cursor', params.cursor);
    if (params.make) url.searchParams.set('make', params.make);
    if (params.year) url.searchParams.set('year', String(params.year));
    if (params.search) url.searchParams.set('search', params.search);
    if (params.buyNow) url.searchParams.set('buy_now', 'true');
    if (params.saleStatus) url.searchParams.set('sale_status', params.saleStatus);
    if (params.sort) url.searchParams.set('sort', params.sort);

    const fetchConfig: ProviderFetchConfig = {
      requestTimeoutMs: this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')!,
      maxRetryAttempts: this.config.get<number>('IMPORT_MAX_RETRY_ATTEMPTS')!,
      initialRetryDelayMs: this.config.get<number>('IMPORT_INITIAL_RETRY_DELAY_MS')!,
      maxRetryDelayMs: this.config.get<number>('IMPORT_MAX_RETRY_DELAY_MS')!,
      jobDeadlineMs: Date.now() + this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')! * 2,
    };

    const result = await providerFetch<any>(
      url.toString(),
      {
        'x-rapidapi-host': this.RAPIDAPI_HOST,
        'x-rapidapi-key': apiKey,
      },
      fetchConfig,
      this.logger,
    );

    // Confirm + complete budget
    await this.budgetService.confirm(attemptId);
    const success = result.ok;
    let failureKind: FailureKind | undefined;
    if (!success) {
      const f = result.failure;
      if (f.kind === 'HTTP_429') failureKind = 'rateLimit';
      else if (f.kind === 'HTTP_5XX') failureKind = 'server';
      else if (f.kind === 'NETWORK_ERROR') failureKind = 'network';
      else if (f.kind === 'HTTP_4XX') failureKind = 'client';
      else failureKind = 'timeout';
    }
    await this.budgetService.complete(attemptId, success, failureKind);

    if (!result.ok) {
      throw new Error(`Provider error: ${result.failure.kind} - ${result.failure.message}`);
    }

    const body = result.data;
    const items = body?.data ?? [];
    const nextCursor: string | null = body?.meta?.next_cursor ?? null;

    // Normalize and upsert discovered lots
    const sanitizedItems: any[] = [];
    for (const raw of items) {
      if (!raw?.lot_number) continue;

      const lotId = String(raw.lot_number);
      const normalized = normalizeDiscoveredLot(raw, params.platform);
      const { providerAuctionTimestampRaw: _rawTimestamp, hasPricingData, buyNowExplicitlyAbsent, ...prismaNormalized } = normalized;

      // Compute lifecycle and freshness at write time (same as discovery.service.ts)
      const observedAt = new Date();
      const timeResult = normalizeAuctionTimestamp(
        normalized.providerAuctionTimestampRaw,
        normalized.facilityState,
      );
      const auctionTime = timeResult.auctionAtUtc;
      const lifecycleState = normalizeLifecycleState(
        normalized.auctionState,
        auctionTime ?? normalized.ad,
        observedAt,
        normalized.isBuyNow,
        normalized.buyNowUsd,
      );
      const canonicalLifecycleState = normalized.availabilityConfirmed
        ? lifecycleState
        : AuctionLifecycleState.REMOVED;
      const freshnessState = computeFreshnessState(
        observedAt,
        null,
        0,
        normalized.availabilityConfirmed,
        canonicalLifecycleState,
        STALE_AFTER_MS.COLD,
        observedAt,
      );
      const providerResultState = !normalized.availabilityConfirmed
        ? 'REMOVED'
        : providerResultStateFromRaw(
        normalized.auctionState,
        auctionTime ?? normalized.ad,
        observedAt,
      );
      const isTerminalResult = ['SOLD', 'UNSOLD', 'REMOVED'].includes(providerResultState);
      const priceAndBuyNowData = {
        ...(hasPricingData ? { priceObservedAt: observedAt } : {}),
        ...((isTerminalResult || !normalized.availabilityConfirmed || !normalized.isBuyNow || !(normalized.buyNowUsd && normalized.buyNowUsd > 0) || buyNowExplicitlyAbsent)
          ? { isBuyNow: false, buyNowUsd: null }
          : {}),
        ...((isTerminalResult || !normalized.availabilityConfirmed)
          ? { terminalAt: observedAt, state: DiscoveredLotState.UNAVAILABLE }
          : {}),
      };

      // Idempotent upsert with computed lifecycle/freshness
      await this.prisma.discoveredLot.upsert({
        where: {
          provider_externalLotId: {
            provider: params.platform,
            externalLotId: lotId,
          },
        },
        create: {
          provider: params.platform,
          externalLotId: lotId,
          ...prismaNormalized,
          providerAuctionTimestampRaw: timeResult.raw,
          auctionTimestampEvidence: timeResult.evidence,
          auctionTime,
          lifecycleState: canonicalLifecycleState,
          providerResultState,
          freshnessState,
          lastSeenAt: observedAt,
          lastProviderUpdateAt: observedAt,
          listingObservedAt: observedAt,
          ...priceAndBuyNowData,
          consecutiveMisses: 0,
          availabilityConfirmed: normalized.availabilityConfirmed,
        },
        update: {
          ...prismaNormalized,
          providerAuctionTimestampRaw: timeResult.raw,
          auctionTimestampEvidence: timeResult.evidence,
          auctionTime,
          lifecycleState: canonicalLifecycleState,
          providerResultState,
          freshnessState,
          lastSeenAt: observedAt,
          lastProviderUpdateAt: observedAt,
          listingObservedAt: observedAt,
          ...priceAndBuyNowData,
          consecutiveMisses: 0,
          availabilityConfirmed: normalized.availabilityConfirmed,
        },
      });

      // Get the upserted lot and sanitize for response
      const lot = await this.prisma.discoveredLot.findUnique({
        where: {
          provider_externalLotId: {
            provider: params.platform,
            externalLotId: lotId,
          },
        },
      });

      sanitizedItems.push(sanitizeLotForResponse(lot));
    }

    return {
      items: sanitizedItems,
      cursor: nextCursor,
      hasMore: nextCursor !== null,
      cached: false,
      provider: params.platform,
    };
  }

  /** Get from cache if not expired. */
  private async getFromCache(fingerprint: string): Promise<SearchResult | null> {
    const cached = await this.prisma.searchQueryCache.findUnique({
      where: { queryFingerprint: fingerprint },
    });

    if (!cached) return null;
    if (cached.expiresAt < new Date()) return null;

    return {
      items: cached.results as any[],
      cursor: cached.nextCursor,
      hasMore: cached.nextCursor !== null,
      cached: true,
      provider: cached.provider,
    };
  }

  /** Store result in cache. */
  private async storeInCache(
    fingerprint: string,
    params: SearchParams,
    result: SearchResult,
  ): Promise<void> {
    const ttl = this.config.get<number>('SEARCH_CACHE_TTL_SECONDS')!;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await this.prisma.searchQueryCache.upsert({
      where: { queryFingerprint: fingerprint },
      create: {
        queryFingerprint: fingerprint,
        provider: params.platform,
        params: params as any,
        results: result.items as any,
        nextCursor: result.cursor,
        itemCount: result.items.length,
        ttlSeconds: ttl,
        expiresAt,
      },
      update: {
        results: result.items as any,
        nextCursor: result.cursor,
        itemCount: result.items.length,
        ttlSeconds: ttl,
        expiresAt,
      },
    });
  }

  /** Import a discovered lot into the catalog (idempotent). */
  async importLot(
    lotNumber: string,
    platform: 'copart' | 'iaai',
  ): Promise<{
    imported: boolean;
    alreadyExists: boolean;
    vehicleId?: string;
    slug?: string;
  }> {
    const lot = await this.prisma.discoveredLot.findUnique({
      where: {
        provider_externalLotId: {
          provider: platform,
          externalLotId: lotNumber,
        },
      },
    });

    if (!lot) {
      throw new Error(`Lot ${lotNumber} not found in discovered lots`);
    }

    // Check if already imported
    if (lot.state === 'IMPORTED' && lot.vehicleId) {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: lot.vehicleId },
        select: { id: true, slug: true },
      });
      if (vehicle) {
        return { imported: false, alreadyExists: true, vehicleId: vehicle.id, slug: vehicle.slug };
      }
    }

    // Check existing binding
    const existing = await this.prisma.vehicleSourceBinding.findUnique({
      where: {
        provider_externalLotId: {
          provider: platform,
          externalLotId: lotNumber,
        },
      },
      include: { vehicle: true },
    });

    if (existing) {
      // Update discovered lot state
      await this.prisma.discoveredLot.update({
        where: { id: lot.id },
        data: { state: 'IMPORTED', vehicleId: existing.vehicleId },
      });
      return {
        imported: false,
        alreadyExists: true,
        vehicleId: existing.vehicleId,
        slug: existing.vehicle.slug,
      };
    }

    // Mark as importing
    await this.prisma.discoveredLot.update({
      where: { id: lot.id },
      data: { state: 'IMPORTING' },
    });

    try {
      // Create vehicle from discovered lot data
      const vehicle = await this.prisma.vehicle.create({
        data: {
          slug: await this.generateSlug(lot.title, lot.vin),
          sourceType: platform === 'iaai' ? 'IAAI' : 'COPART',
          sourceRegion: 'USA',
          publicationStatus: 'DRAFT',
          availabilityStatus: 'AVAILABLE',
          title: lot.title,
          make: lot.make,
          model: lot.model,
          year: lot.year,
          priceAmount: lot.currentBidUsd ?? lot.buyNowUsd ?? 0,
          vin: lot.vin,
          odometerValue: lot.odometerKm,
          bodyType: lot.bodyStyle,
          fuelType: lot.fuelType,
          transmission: lot.transmission,
          driveType: lot.driveType,
          damagePrimary: lot.primaryDamage,
          locationCountry: 'US',
          locationState: lot.locationState,
          locationCity: lot.locationDisplay,
        },
      });

      // Create source binding
      await this.prisma.vehicleSourceBinding.create({
        data: {
          vehicleId: vehicle.id,
          provider: platform,
          externalLotId: lotNumber,
          externalUrl: `https://www.${platform}.com/lot/${lotNumber}`,
          saleStatus: lot.auctionState ?? undefined,
          currentBidAmount: lot.currentBidUsd ?? 0,
          buyNowAmount: lot.buyNowUsd ?? 0,
          lastSyncedAt: new Date(),
        },
      });

      // Update discovered lot state
      await this.prisma.discoveredLot.update({
        where: { id: lot.id },
        data: { state: 'IMPORTED', vehicleId: vehicle.id },
      });

      this.logger.log(`Imported lot ${lotNumber} → vehicle ${vehicle.id} (${vehicle.slug})`);

      return {
        imported: true,
        alreadyExists: false,
        vehicleId: vehicle.id,
        slug: vehicle.slug,
      };
    } catch (error) {
      // Revert state on failure
      await this.prisma.discoveredLot.update({
        where: { id: lot.id },
        data: { state: 'DISCOVERED' },
      });
      throw error;
    }
  }

  /** Generate a unique slug. */
  private async generateSlug(title: string, vin: string | null): Promise<string> {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    let slug = base;
    let suffix = 1;
    while (await this.prisma.vehicle.findUnique({ where: { slug } })) {
      slug = `${base}-${suffix++}`;
    }
    return slug;
  }
}
