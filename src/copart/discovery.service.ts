/**
 * Cursor-based auction discovery service.
 *
 * Uses the confirmed RapidAPI contract (Task 033P):
 *   GET /vehicles?platform={copart|iaai}&page={n}&limit=20
 *   Response: { ok, data: [...], meta: { next_cursor, per_page, prev_cursor } }
 *
 * Features:
 * - Cursor state persisted per provider + query fingerprint
 * - Safe resume after interruption
 * - Cursor advancement in fenced transaction
 * - Cursor-loop detection
 * - Repeated-lot-page detection
 * - Copart/IAAI independent cursor state
 * - All requests through global quota reservation
 * - Provider + externalLotId idempotency
 * - No fixed page count assumption
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  providerFetch,
  type ProviderFetchConfig,
} from './provider-fetch';
import { validateProviderResponse } from './response-validator';
import { ProviderLeaseService, type ProviderId } from './provider-lease.service';
import { RequestBudgetService, type FailureKind } from './request-budget.service';
import { normalizeDiscoveredLot } from './lot-normalizer';

export interface DiscoveryParams {
  platform: 'copart' | 'iaai';
  make?: string;
  year?: number;
  search?: string;
  buyNow?: boolean;
  saleStatus?: string;
  sort?: string;
  limit?: number;
}

export interface DiscoveryResult {
  provider: string;
  queryFingerprint: string;
  pagesCompleted: number;
  lotsDiscovered: number;
  lotsUpdated: number;
  newLots: number;
  cursorAdvanced: boolean;
  exhausted: boolean;
  terminalReason: string;
  nextCursor: string | null;
  errors: string[];
}

const CONTRACT_VERSION = 'v1';

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
  private readonly RAPIDAPI_BASE = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly leaseService: ProviderLeaseService,
    private readonly budgetService: RequestBudgetService,
  ) {}

  /** Build a stable fingerprint from normalized query params. */
  buildQueryFingerprint(params: DiscoveryParams): string {
    const parts: string[] = [params.platform];
    if (params.make) parts.push(`make=${params.make.toUpperCase()}`);
    if (params.year) parts.push(`year=${params.year}`);
    if (params.search) parts.push(`search=${params.search.toLowerCase()}`);
    if (params.buyNow) parts.push(`buy_now=true`);
    if (params.saleStatus) parts.push(`sale_status=${params.saleStatus}`);
    if (params.sort) parts.push(`sort=${params.sort}`);
    // Create a simple hash
    const str = parts.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `fp_${Math.abs(hash).toString(36)}`;
  }

  /** Build the API URL from params and page number. */
  private buildUrl(params: DiscoveryParams, page: number): string {
    const url = new URL(`${this.RAPIDAPI_BASE}/vehicles`);
    url.searchParams.set('platform', params.platform);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(params.limit ?? 20));
    if (params.make) url.searchParams.set('make', params.make);
    if (params.year) url.searchParams.set('year', String(params.year));
    if (params.search) url.searchParams.set('search', params.search);
    if (params.buyNow) url.searchParams.set('buy_now', 'true');
    if (params.saleStatus) url.searchParams.set('sale_status', params.saleStatus);
    if (params.sort) url.searchParams.set('sort', params.sort);
    return url.toString();
  }

  private getFetchConfig(jobDeadlineMs: number): ProviderFetchConfig {
    return {
      requestTimeoutMs: this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')!,
      maxRetryAttempts: this.config.get<number>('IMPORT_MAX_RETRY_ATTEMPTS')!,
      initialRetryDelayMs: this.config.get<number>('IMPORT_INITIAL_RETRY_DELAY_MS')!,
      maxRetryDelayMs: this.config.get<number>('IMPORT_MAX_RETRY_DELAY_MS')!,
      jobDeadlineMs,
    };
  }

  /**
   * Run a bounded discovery pass for a provider + query.
   * Resumes from the last cursor state.
   */
  async runDiscovery(
    params: DiscoveryParams,
    maxPages?: number,
  ): Promise<DiscoveryResult> {
    const queryFingerprint = this.buildQueryFingerprint(params);
    const maxPgs = maxPages ?? this.config.get<number>('DISCOVERY_MAX_PAGES')!;
    const apiKey = this.config.get<string>('RAPIDAPI_KEY');

    if (!apiKey) {
      return {
        provider: params.platform,
        queryFingerprint,
        pagesCompleted: 0,
        lotsDiscovered: 0,
        lotsUpdated: 0,
        newLots: 0,
        cursorAdvanced: false,
        exhausted: false,
        terminalReason: 'configuration_error',
        nextCursor: null,
        errors: ['RAPIDAPI_KEY not configured'],
      };
    }

    // Get or create cursor state
    const cursor = await this.prisma.discoveryCursor.upsert({
      where: {
        provider_queryFingerprint: {
          provider: params.platform,
          queryFingerprint,
        },
      },
      create: {
        provider: params.platform,
        queryFingerprint,
        lastStartedAt: new Date(),
      },
      update: {
        lastStartedAt: new Date(),
        lastError: null,
      },
    });

    // Check if exhausted
    if (cursor.exhaustedAt) {
      return {
        provider: params.platform,
        queryFingerprint,
        pagesCompleted: 0,
        lotsDiscovered: 0,
        lotsUpdated: 0,
        newLots: 0,
        cursorAdvanced: false,
        exhausted: true,
        terminalReason: 'already_exhausted',
        nextCursor: cursor.nextCursor,
        errors: [],
      };
    }

    const headers = {
      'x-rapidapi-host': this.RAPIDAPI_HOST,
      'x-rapidapi-key': apiKey,
    };

    const jobStartMs = Date.now();
    const jobTimeoutMs = this.config.get<number>('IMPORT_JOB_TIMEOUT_MS')!;
    const jobDeadlineMs = jobStartMs + jobTimeoutMs;
    const fetchConfig = this.getFetchConfig(jobDeadlineMs);

    let pagesCompleted = 0;
    let lotsDiscovered = 0;
    let lotsUpdated = 0;
    let newLots = 0;
    let page = 1;
    let exhausted = false;
    let terminalReason = 'completed';
    const errors: string[] = [];
    const seenLotIds = new Set<string>();

    // Track page identities for loop detection
    const pageIdentities: Map<number, string[]> = new Map();

    while (page <= maxPgs) {
      if (Date.now() >= jobDeadlineMs) {
        terminalReason = 'deadline_exceeded';
        break;
      }

      // Budget gate
      const budgetCheck = await this.budgetService.canMakeRoutineRequest();
      if (!budgetCheck.allowed) {
        terminalReason = 'budget_exhausted';
        errors.push(`Budget blocked: ${budgetCheck.usage.allocated}/${budgetCheck.usage.budget}`);
        break;
      }

      // Budget reservation
      const attemptId = `disc-${params.platform}-${queryFingerprint}-p${page}-${crypto.randomUUID()}`;
      const reservation = await this.budgetService.reserve(
        params.platform as ProviderId,
        null,
        attemptId,
        'routine',
      );
      if (!reservation.allowed) {
        terminalReason = 'budget_exhausted';
        break;
      }

      const url = this.buildUrl(params, page);
      this.logger.log(`Discovery ${params.platform} page ${page}/${maxPgs} (${queryFingerprint})`);

      const result = await providerFetch<any>(
        url,
        headers,
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
        const f = result.failure;
        errors.push(`Page ${page}: ${f.kind} - ${f.message}`);

        if (f.kind === 'HTTP_4XX') {
          terminalReason = 'non_retryable_http_error';
          break;
        }
        if (f.kind === 'DEADLINE_EXCEEDED') {
          terminalReason = 'deadline_exceeded';
          break;
        }
        // Retryable failure — advance page
        page++;
        continue;
      }

      // Validate response
      const validation = validateProviderResponse(result.data);
      if (!validation.ok) {
        errors.push(`Page ${page}: malformed - ${validation.reason}`);
        terminalReason = 'malformed_response';
        break;
      }

      const items = validation.items as Record<string, any>[];

      // Empty page — exhausted
      if (items.length === 0) {
        exhausted = true;
        terminalReason = 'exhausted';
        break;
      }

      // Page identity for loop detection
      const currentPageId = items
        .map((item) => String(item.lot_number ?? '__missing__'))
        .sort();

      // Check for repeated page
      let isRepeated = false;
      for (const [, prevId] of pageIdentities) {
        if (currentPageId.length === prevId.length &&
            currentPageId.every((v, i) => v === prevId[i])) {
          isRepeated = true;
          break;
        }
      }
      if (isRepeated) {
        this.logger.warn(`Page ${page} repeats previous page lot IDs — stopping`);
        exhausted = true;
        terminalReason = 'cursor_loop_detected';
        break;
      }
      pageIdentities.set(page, currentPageId);

      // Process items
      for (const raw of items) {
        const lotId = String(raw.lot_number ?? '');
        if (!lotId) continue;

        const normalized = normalizeDiscoveredLot(raw, params.platform);

        // Idempotent upsert
        const existing = await this.prisma.discoveredLot.findUnique({
          where: {
            provider_externalLotId: {
              provider: params.platform,
              externalLotId: lotId,
            },
          },
        });

        if (existing) {
          await this.prisma.discoveredLot.update({
            where: { id: existing.id },
            data: {
              ...normalized,
              lastSeenAt: new Date(),
              consecutiveMisses: 0,
              availabilityConfirmed: true,
            },
          });
          lotsUpdated++;
        } else {
          await this.prisma.discoveredLot.create({
            data: {
              provider: params.platform,
              externalLotId: lotId,
              ...normalized,
              lastSeenAt: new Date(),
            },
          });
          newLots++;
        }

        lotsDiscovered++;
        seenLotIds.add(lotId);
      }

      pagesCompleted++;
      page++;
    }

    // Update cursor state in a transaction
    const nextCursor = pagesCompleted > 0 ? `page_${page}` : cursor.nextCursor;
    await this.prisma.discoveryCursor.update({
      where: { id: cursor.id },
      data: {
        nextCursor: exhausted ? null : nextCursor,
        lastSuccessfulCursor: pagesCompleted > 0 ? `page_${page - 1}` : cursor.lastSuccessfulCursor,
        lastCompletedAt: new Date(),
        exhaustedAt: exhausted ? new Date() : null,
        lastError: errors.length > 0 ? errors[errors.length - 1] : null,
      },
    });

    this.logger.log(
      `Discovery ${params.platform} (${queryFingerprint}): ${pagesCompleted} pages, ` +
      `${lotsDiscovered} lots (${newLots} new, ${lotsUpdated} updated) [${terminalReason}]`,
    );

    return {
      provider: params.platform,
      queryFingerprint,
      pagesCompleted,
      lotsDiscovered,
      lotsUpdated,
      newLots,
      cursorAdvanced: pagesCompleted > 0,
      exhausted,
      terminalReason,
      nextCursor: exhausted ? null : nextCursor,
      errors,
    };
  }

  /** Get cursor state for a provider. */
  async getCursorState(provider: string): Promise<any[]> {
    const cursors = await this.prisma.discoveryCursor.findMany({
      where: { provider },
      orderBy: { updatedAt: 'desc' },
    });
    return cursors.map((c) => ({
      queryFingerprint: c.queryFingerprint,
      nextCursor: c.nextCursor,
      lastSuccessfulCursor: c.lastSuccessfulCursor,
      lastStartedAt: c.lastStartedAt,
      lastCompletedAt: c.lastCompletedAt,
      exhaustedAt: c.exhaustedAt,
      isExhausted: c.exhaustedAt !== null,
      lastError: c.lastError,
      contractVersion: c.contractVersion,
    }));
  }
}
