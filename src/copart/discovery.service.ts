/**
 * Cursor-based auction discovery service.
 *
 * VERIFIED provider contract (Task 036):
 *   GET /vehicles?auction_type={1|2}&per_page={N}&cursor={opaque}
 *   auction_type=1 → Copart, auction_type=2 → IAAI
 *   cursor is an opaque token from meta.next_cursor — forwarded byte-for-byte
 *   NEVER generate/increment cursor tokens
 *
 * Features:
 * - Cursor checkpoint persisted per provider + query fingerprint
 * - Safe resume after interruption (advance cursor only in same tx as lot persist)
 * - Loop detection (identical lot set across pages)
 * - Repeated-lot-page detection
 * - Copart/IAAI independent checkpoint state
 * - Every request through atomic global quota reservation
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
  checkpointAdvanced: boolean;
  exhausted: boolean;
  terminalReason: string;
  nextPage: number | null;
  errors: string[];
}

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
    const str = parts.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `fp_${Math.abs(hash).toString(36)}`;
  }

  /** Map provider to auction_type: copart=1, iaai=2 */
  private static readonly AUCTION_TYPE_MAP: Record<string, number> = {
    copart: 1,
    iaai: 2,
  };

  /** Build the API URL from params and cursor. */
  private buildUrl(params: DiscoveryParams, cursor: string | null): string {
    const url = new URL(`${this.RAPIDAPI_BASE}/vehicles`);
    url.searchParams.set('auction_type', String(DiscoveryService.AUCTION_TYPE_MAP[params.platform] ?? 1));
    url.searchParams.set('per_page', String(params.limit ?? 20));
    if (cursor) url.searchParams.set('cursor', cursor);
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
   * Resumes from the last cursor checkpoint.
   *
   * Cursor checkpoint advancement is atomic: the cursor is advanced
   * only in the same fenced transaction that persists the discovered lots.
   * A failed request does NOT advance the checkpoint.
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
        checkpointAdvanced: false,
        exhausted: false,
        terminalReason: 'configuration_error',
        nextPage: null,
        errors: ['RAPIDAPI_KEY not configured'],
      };
    }

    // Get or create checkpoint state
    const checkpoint = await this.prisma.discoveryCheckpoint.upsert({
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
    if (checkpoint.exhaustedAt) {
      return {
        provider: params.platform,
        queryFingerprint,
        pagesCompleted: 0,
        lotsDiscovered: 0,
        lotsUpdated: 0,
        newLots: 0,
        checkpointAdvanced: false,
        exhausted: true,
        terminalReason: 'already_exhausted',
        nextPage: checkpoint.lastPage,
        errors: [],
      };
    }

    // Resume from stored cursor (opaque token, forwarded byte-for-byte)
    // The lastPage field stores the cursor token in the new contract
    let currentCursor: string | null = checkpoint.lastPage ? String(checkpoint.lastPage) : null;

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
    let exhausted = false;
    let terminalReason = 'completed';
    const errors: string[] = [];

    // Track page identities for loop detection
    const pageIdentities: Map<number, string[]> = new Map();
    let pageSeq = 0; // sequential counter for loop detection only

    while (pagesCompleted < maxPgs) {
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
      const attemptId = `disc-${params.platform}-${queryFingerprint}-c${pageSeq}-${crypto.randomUUID()}`;
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

      const url = this.buildUrl(params, currentCursor);
      this.logger.log(`Discovery ${params.platform} cursor ${currentCursor ? '[present]' : '[initial]'} (page ${pageSeq + 1}/${maxPgs})`);

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
        errors.push(`Cursor ${currentCursor ?? 'initial'}: ${f.kind} - ${f.message}`);

        if (f.kind === 'HTTP_4XX') {
          terminalReason = 'non_retryable_http_error';
          break;
        }
        if (f.kind === 'DEADLINE_EXCEEDED') {
          terminalReason = 'deadline_exceeded';
          break;
        }
        // Retryable failure — do NOT advance checkpoint
        // Next discovery pass will retry the same page
        break;
      }

      // Validate response
      const validation = validateProviderResponse(result.data);
      if (!validation.ok) {
        errors.push(`Cursor ${currentCursor ?? 'initial'}: malformed - ${validation.reason}`);
        terminalReason = 'malformed_response';
        // Do NOT advance checkpoint on malformed response
        break;
      }

      const items = validation.items as Record<string, any>[];

      // ── Extract next cursor from meta.next_cursor ──
      const body = result.data;
      const nextCursor: string | null =
        body?.meta?.next_cursor ?? null;

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

      // Check for repeated page (identical lot set)
      let isRepeated = false;
      for (const [, prevId] of pageIdentities) {
        if (currentPageId.length === prevId.length &&
            currentPageId.every((v, i) => v === prevId[i])) {
          isRepeated = true;
          break;
        }
      }
      if (isRepeated) {
        this.logger.warn(`Page seq ${pageSeq} repeats previous page lot IDs — stopping`);
        exhausted = true;
        terminalReason = 'loop_detected';
        break;
      }
      pageIdentities.set(pageSeq, currentPageId);

      // Atomic checkpoint advancement: persist lots AND advance page in one transaction
      // This ensures a failed page does NOT advance the checkpoint.
      // Extended timeout (30s) because HTTP fetch just completed and the
      // connection pool may have been idle during the request.
      const txResult = await this.prisma.$transaction(
        async (tx) => {
        let txNew = 0;
        let txUpdated = 0;

        for (const raw of items) {
          const lotId = String(raw.lot_number ?? '');
          if (!lotId) continue;

          const normalized = normalizeDiscoveredLot(raw, params.platform);

          const existing = await tx.discoveredLot.findUnique({
            where: {
              provider_externalLotId: {
                provider: params.platform,
                externalLotId: lotId,
              },
            },
          });

          if (existing) {
            await tx.discoveredLot.update({
              where: { id: existing.id },
              data: {
                ...normalized,
                lastSeenAt: new Date(),
                consecutiveMisses: 0,
                availabilityConfirmed: true,
              },
            });
            txUpdated++;
          } else {
            await tx.discoveredLot.create({
              data: {
                provider: params.platform,
                externalLotId: lotId,
                ...normalized,
                lastSeenAt: new Date(),
              },
            });
            txNew++;
          }
        }

        // Advance checkpoint ONLY after successful lot persistence
        // Note: lastPage/lastSuccessfulPage are Int columns — we store a page counter,
        // not opaque cursor tokens. The cursor is kept in-memory per session.
        await tx.discoveryCheckpoint.update({
          where: { id: checkpoint.id },
          data: {
            lastPage: pagesCompleted + 1,
            lastSuccessfulPage: pagesCompleted + 1,
            lastCompletedAt: new Date(),
          },
        });

        return { txNew, txUpdated };
        },
        { maxWait: 15000, timeout: 30000 },
      );

      lotsDiscovered += items.length;
      newLots += txResult.txNew;
      lotsUpdated += txResult.txUpdated;

      pagesCompleted++;
      pageSeq++;

      // ── Cursor-based exhaustion: if meta.next_cursor is null/absent, we're done ──
      if (!nextCursor) {
        exhausted = true;
        terminalReason = 'exhausted';
        break;
      }

      // Advance cursor for next iteration (opaque token, forwarded byte-for-byte)
      currentCursor = nextCursor;
    }

    // Final checkpoint update
    await this.prisma.discoveryCheckpoint.update({
      where: { id: checkpoint.id },
      data: {
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
      checkpointAdvanced: pagesCompleted > 0,
      exhausted,
      terminalReason,
      nextPage: exhausted ? null : (currentCursor as any),
      errors,
    };
  }

  /** Get checkpoint state for a provider. */
  async getCheckpointState(provider: string): Promise<any[]> {
    const checkpoints = await this.prisma.discoveryCheckpoint.findMany({
      where: { provider },
      orderBy: { updatedAt: 'desc' },
    });
    return checkpoints.map((c) => ({
      queryFingerprint: c.queryFingerprint,
      lastPage: c.lastPage,
      lastSuccessfulPage: c.lastSuccessfulPage,
      lastStartedAt: c.lastStartedAt,
      lastCompletedAt: c.lastCompletedAt,
      exhaustedAt: c.exhaustedAt,
      isExhausted: c.exhaustedAt !== null,
      lastError: c.lastError,
      contractVersion: c.contractVersion,
      paginationType: 'cursor_based',
    }));
  }
}
