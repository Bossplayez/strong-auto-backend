import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeFreshnessState,
  normalizeLifecycleState,
  STALE_AFTER_MS,
} from '../auction-lot/lifecycle-mapping';
import {
  RapidApiTransport,
  TransportLeaseLostError,
  TransportMalformedError,
} from '../auction-lot/rapidapi-transport';
import { normalizeDiscoveredLot } from './lot-normalizer';
import { ProviderLeaseService, type ProviderId } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { validateProviderResponse } from './response-validator';

export type DiscoveryMode = 'discovery' | 'refresh';

export interface DiscoveryParams {
  platform: ProviderId;
  mode?: DiscoveryMode;
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
  lotsObserved: number;
  lotsPersisted: number;
  checkpointAdvanced: boolean;
  exhausted: boolean;
  terminalReason: string;
  nextPage: number | null;
  errors: string[];
}

interface PageCommitResult {
  observed: number;
  persisted: number;
  created: number;
  updated: number;
  exhausted: boolean;
  nextCursor: string | null;
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private static readonly CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly leaseService: ProviderLeaseService,
    private readonly budgetService: RequestBudgetService,
  ) {}

  buildQueryFingerprint(params: DiscoveryParams): string {
    const parts: string[] = [params.platform];
    if (params.make) parts.push(`make=${params.make.toUpperCase()}`);
    if (params.year) parts.push(`year=${params.year}`);
    if (params.search) parts.push(`search=${params.search.toLowerCase()}`);
    if (params.buyNow) parts.push('buy_now=true');
    if (params.saleStatus) parts.push(`sale_status=${params.saleStatus}`);
    if (params.sort) parts.push(`sort=${params.sort}`);
    const value = parts.join('|');
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(index);
      hash |= 0;
    }
    return `fp_${Math.abs(hash).toString(36)}`;
  }

  async runDiscovery(
    params: DiscoveryParams,
    maxPages?: number,
  ): Promise<DiscoveryResult> {
    const mode = params.mode ?? 'discovery';
    const queryFingerprint = this.buildQueryFingerprint(params);
    const checkpointFingerprint = `${mode}:${queryFingerprint}`;
    const pageLimit = Math.min(2, Math.max(1, maxPages ?? 2));

    if (!this.config.get<string>('RAPIDAPI_KEY')) {
      return this.result(params.platform, queryFingerprint, 'configuration_error', [
        'RAPIDAPI_KEY not configured',
      ]);
    }

    const ownerToken = `supply-${params.platform}-${mode}-${crypto.randomUUID()}`;
    const jobTimeoutMs = this.config.get<number>('IMPORT_JOB_TIMEOUT_MS') ?? 120_000;
    const claim = await this.leaseService.claim(
      params.platform,
      ownerToken,
      jobTimeoutMs + 60_000,
    );

    if (!claim.claimed || claim.fencingToken === null) {
      return this.result(params.platform, queryFingerprint, 'lease_held', [
        'Provider lease is held by another owner',
      ]);
    }

    const fencingToken = claim.fencingToken;
    const transport = new RapidApiTransport(this.config, this.budgetService, this.logger);
    const jobDeadlineMs = Date.now() + jobTimeoutMs;
    let checkpoint: any;
    let currentCursor: string | null = null;
    let cycleStartedAt = new Date();
    let pagesCompleted = 0;
    let lotsObserved = 0;
    let lotsPersisted = 0;
    let newLots = 0;
    let lotsUpdated = 0;
    let exhausted = false;
    let terminalReason = 'completed';
    const errors: string[] = [];

    try {
      const now = new Date();
      checkpoint = await this.prisma.discoveryCheckpoint.upsert({
        where: {
          provider_queryFingerprint: {
            provider: params.platform,
            queryFingerprint: checkpointFingerprint,
          },
        },
        create: {
          provider: params.platform,
          queryFingerprint: checkpointFingerprint,
          mode,
          cycleStartedAt: now,
          lastStartedAt: now,
        },
        update: { mode, lastStartedAt: now, lastError: null },
      });

      if (checkpoint.exhaustedAt) {
        if (checkpoint.nextDueAt && checkpoint.nextDueAt > now) {
          return this.result(params.platform, queryFingerprint, 'not_due', [], {
            exhausted: true,
          });
        }

        const restarted = await this.leaseService.withLeasedTransaction(
          params.platform,
          ownerToken,
          fencingToken,
          async (tx) => tx.discoveryCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
              exhaustedAt: null,
              lastCursor: null,
              lastSuccessfulCursor: null,
              cycleStartedAt: now,
              nextDueAt: null,
              lastStartedAt: now,
              lastError: null,
            },
          }),
        );
        if (!restarted) throw new TransportLeaseLostError();
        checkpoint = restarted;
      } else if (!checkpoint.cycleStartedAt) {
        const started = await this.leaseService.withLeasedTransaction(
          params.platform,
          ownerToken,
          fencingToken,
          async (tx) => tx.discoveryCheckpoint.update({
            where: { id: checkpoint.id },
            data: { cycleStartedAt: now },
          }),
        );
        if (!started) throw new TransportLeaseLostError();
        checkpoint = started;
      }

      currentCursor = checkpoint.lastCursor ?? null;
      cycleStartedAt = checkpoint.cycleStartedAt ?? now;

      while (pagesCompleted < pageLimit && Date.now() < jobDeadlineMs) {
        let committed: PageCommitResult | null = null;

        await transport.listVehicles(
          {
            provider: params.platform,
            perPage: 20,
            cursor: currentCursor,
            jobDeadlineMs,
            filters: {
              make: params.make,
              year: params.year,
              search: params.search,
              buy_now: params.buyNow ? true : undefined,
              sale_status: params.saleStatus,
              sort: params.sort,
            },
          },
          async (page) => {
            const validation = validateProviderResponse({ data: page.items });
            if (!validation.ok) {
              throw new TransportMalformedError(
                `${validation.reason}: ${validation.detail}`,
              );
            }

            const nextCursor = page.meta.next_cursor;
            if (nextCursor !== null && nextCursor === currentCursor) {
              throw new TransportMalformedError('Provider repeated the current cursor');
            }

            const normalizedById = new Map<
              string,
              ReturnType<typeof normalizeDiscoveredLot>
            >();
            for (const raw of validation.items) {
              if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
              const lotId = String((raw as Record<string, unknown>).lot_number ?? '');
              if (!lotId) continue;
              normalizedById.set(
                lotId,
                normalizeDiscoveredLot(raw as Record<string, unknown>, params.platform),
              );
            }

            const observedAt = new Date();
            const pageExhausted = nextCursor === null;
            const persisted = await this.leaseService.withLeasedTransaction(
              params.platform,
              ownerToken,
              fencingToken,
              async (tx) => {
                let created = 0;
                let updated = 0;

                for (const [externalLotId, normalized] of normalizedById) {
                  const lifecycleState = normalizeLifecycleState(
                    normalized.auctionState,
                    normalized.auctionTime ?? normalized.ad,
                    observedAt,
                    normalized.isBuyNow,
                    normalized.buyNowUsd,
                  );
                  const freshnessState = computeFreshnessState(
                    observedAt,
                    null,
                    0,
                    true,
                    lifecycleState,
                    STALE_AFTER_MS.COLD,
                    observedAt,
                  );
                  const existing = await tx.discoveredLot.findUnique({
                    where: {
                      provider_externalLotId: {
                        provider: params.platform,
                        externalLotId,
                      },
                    },
                    select: { id: true },
                  });
                  const data = {
                    ...normalized,
                    lifecycleState,
                    freshnessState,
                    lastSeenAt: observedAt,
                    lastProviderUpdateAt: observedAt,
                    consecutiveMisses: 0,
                    availabilityConfirmed: true,
                  };

                  if (existing) {
                    await tx.discoveredLot.update({ where: { id: existing.id }, data });
                    updated++;
                  } else {
                    await tx.discoveredLot.create({
                      data: {
                        provider: params.platform,
                        externalLotId,
                        ...data,
                      },
                    });
                    created++;
                  }
                }

                if (pageExhausted) {
                  // Task 040: unified sweep — any complete lease-fenced exhausted sweep
                  // may increment misses. Partial/failed/quota-blocked cycles never do.
                  await tx.discoveredLot.updateMany({
                    where: {
                      provider: params.platform,
                      state: { in: ['DISCOVERED', 'IMPORTED'] },
                      lifecycleState: { notIn: ['SOLD', 'ENDED', 'REMOVED'] },
                      lastSeenAt: { lt: cycleStartedAt },
                      OR: [
                        { nextRefreshAt: null },
                        { nextRefreshAt: { lte: cycleStartedAt } },
                      ],
                    },
                    data: { consecutiveMisses: { increment: 1 } },
                  });
                }

                await tx.discoveryCheckpoint.update({
                  where: { id: checkpoint.id },
                  data: {
                    lastCursor: nextCursor,
                    lastSuccessfulCursor: nextCursor,
                    lastPage: { increment: 1 },
                    lastSuccessfulPage: { increment: 1 },
                    lastCompletedAt: observedAt,
                    exhaustedAt: pageExhausted ? observedAt : null,
                    nextDueAt: pageExhausted
                      ? new Date(observedAt.getTime() + DiscoveryService.CYCLE_INTERVAL_MS)
                      : null,
                    lastError: null,
                  },
                });

                return {
                  observed: normalizedById.size,
                  persisted: created + updated,
                  created,
                  updated,
                  exhausted: pageExhausted,
                  nextCursor,
                };
              },
            );

            if (!persisted) throw new TransportLeaseLostError();
            committed = persisted;
          },
        );

        if (!committed) throw new Error('Provider page returned without persistence');
        const pageCommit = committed as PageCommitResult;
        pagesCompleted++;
        lotsObserved += pageCommit.observed;
        lotsPersisted += pageCommit.persisted;
        newLots += pageCommit.created;
        lotsUpdated += pageCommit.updated;
        exhausted = pageCommit.exhausted;
        currentCursor = pageCommit.nextCursor;
        if (exhausted) {
          terminalReason = 'exhausted';
          break;
        }
      }

      if (Date.now() >= jobDeadlineMs && !exhausted) terminalReason = 'deadline_exceeded';
    } catch (error) {
      terminalReason = error instanceof TransportLeaseLostError
        ? 'lease_lost'
        : error instanceof TransportMalformedError
          ? 'provider_error'
          : 'persistence_error';
      errors.push(error instanceof Error ? error.message : String(error));

      if (!(error instanceof TransportLeaseLostError) && checkpoint) {
        await this.leaseService.withLeasedTransaction(
          params.platform,
          ownerToken,
          fencingToken,
          async (tx) => tx.discoveryCheckpoint.update({
            where: { id: checkpoint.id },
            data: { lastError: errors[errors.length - 1] },
          }),
        );
      }
    } finally {
      await this.leaseService.release(params.platform, ownerToken, fencingToken);
    }

    this.logger.log(
      `${params.platform}/${mode}: ${pagesCompleted} successful pages, ` +
      `${lotsObserved} observed, ${lotsPersisted} persisted [${terminalReason}]`,
    );

    return {
      provider: params.platform,
      queryFingerprint,
      pagesCompleted,
      lotsDiscovered: lotsObserved,
      lotsUpdated,
      newLots,
      lotsObserved,
      lotsPersisted,
      checkpointAdvanced: pagesCompleted > 0,
      exhausted,
      terminalReason,
      nextPage: null,
      errors,
    };
  }

  async getCheckpointState(provider: string): Promise<any[]> {
    const checkpoints = await this.prisma.discoveryCheckpoint.findMany({
      where: { provider },
      orderBy: { updatedAt: 'desc' },
    });
    return checkpoints.map((checkpoint) => ({
      queryFingerprint: checkpoint.queryFingerprint,
      mode: checkpoint.mode,
      lastCursor: checkpoint.lastCursor,
      lastSuccessfulCursor: checkpoint.lastSuccessfulCursor,
      lastPage: checkpoint.lastPage,
      lastSuccessfulPage: checkpoint.lastSuccessfulPage,
      lastStartedAt: checkpoint.lastStartedAt,
      cycleStartedAt: checkpoint.cycleStartedAt,
      lastCompletedAt: checkpoint.lastCompletedAt,
      exhaustedAt: checkpoint.exhaustedAt,
      nextDueAt: checkpoint.nextDueAt,
      isExhausted: checkpoint.exhaustedAt !== null,
      lastError: checkpoint.lastError,
      contractVersion: checkpoint.contractVersion,
      paginationType: 'cursor_based',
    }));
  }

  private result(
    provider: ProviderId,
    queryFingerprint: string,
    terminalReason: string,
    errors: string[],
    overrides: Partial<DiscoveryResult> = {},
  ): DiscoveryResult {
    return {
      provider,
      queryFingerprint,
      pagesCompleted: 0,
      lotsDiscovered: 0,
      lotsUpdated: 0,
      newLots: 0,
      lotsObserved: 0,
      lotsPersisted: 0,
      checkpointAdvanced: false,
      exhausted: false,
      terminalReason,
      nextPage: null,
      errors,
      ...overrides,
    };
  }
}
