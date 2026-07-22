import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeFreshnessState,
  normalizeLifecycleState,
  providerResultStateFromRaw,
  STALE_AFTER_MS,
} from '../auction-lot/lifecycle-mapping';
import { normalizeAuctionTimestamp } from '../auction-lot/time-normalization';
import {
  RapidApiTransport,
  TransportLeaseLostError,
  TransportMalformedError,
  type AttemptBudget,
} from '../auction-lot/rapidapi-transport';
import { isProviderAutomobile, normalizeDiscoveredLot } from './lot-normalizer';
import { ProviderLeaseService, type ProviderId } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { validateProviderResponse } from './response-validator';
import { isPassengerAutomobile } from '../auction-lot/catalog-quality';

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
  attemptsReserved: number;
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
    attemptBudget?: AttemptBudget,
  ): Promise<DiscoveryResult> {
    const mode = params.mode ?? 'discovery';
    const queryFingerprint = this.buildQueryFingerprint(params);
    const checkpointFingerprint = `${mode}:${queryFingerprint}`;
    const pageLimit = Math.min(2, Math.max(1, maxPages ?? 2));

    // Local attempt budget — creates a permissive one if not passed (manual calls)
    const localBudget: AttemptBudget = attemptBudget ?? { remaining: Number.MAX_SAFE_INTEGER, used: 0 };
    const usedBeforeRun = localBudget.used;

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
        if (localBudget.remaining <= 0) {
          terminalReason = 'tick_attempt_cap_reached';
          break;
        }

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
            attemptBudget: localBudget,
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
              if (!isProviderAutomobile(raw)) {
                this.logger.warn(`${params.platform}: skipped non-automobile inventory ${lotId}`);
                continue;
              }
              const normalized = normalizeDiscoveredLot(raw as Record<string, unknown>, params.platform);
              if (!isPassengerAutomobile(normalized)) {
                this.logger.warn(`${params.platform}: skipped non-passenger asset ${lotId}`);
                continue;
              }
              normalizedById.set(lotId, normalized);
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
                  const providerResultState = providerResultStateFromRaw(
                    normalized.auctionState,
                    normalized.auctionTime ?? normalized.ad,
                    observedAt,
                  );
                  // Task 044: Provider-confirmed SOLD detection
                  const isSold = (lifecycleState as any) === 'SOLD';
                  const isTerminalResult = ['SOLD', 'UNSOLD', 'REMOVED'].includes(providerResultState);
                  const soldPriceUsd: number | null = isSold
                    ? (normalized as any).lastSoldPriceUsd ?? null
                    : null;
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
                  const { providerAuctionTimestampRaw: _rawTs, hasPricingData: _hasPricing, buyNowExplicitlyAbsent: _bnAbsent, ...prismaNormalized } = normalized;
                  const data: Record<string, unknown> = {
                    ...prismaNormalized,
                    lifecycleState,
                    providerResultState,
                    freshnessState,
                    lastSeenAt: observedAt,
                    lastProviderUpdateAt: observedAt,
                    consecutiveMisses: 0,
                    availabilityConfirmed: normalized.availabilityConfirmed,
                  };

                  // Task 053: Truth Contract V2 — strict time normalization
                  const timeResult = normalizeAuctionTimestamp(
                    normalized.providerAuctionTimestampRaw,
                    normalized.facilityState,
                  );
                  data.providerAuctionTimestampRaw = timeResult.raw;
                  data.auctionTimestampEvidence = timeResult.evidence;
                  data.listingObservedAt = observedAt; // successful provider observation

                  // Only update auctionTime if we have confirmed UTC
                  if (timeResult.auctionAtUtc) {
                    data.auctionTime = timeResult.auctionAtUtc;
                  } else {
                    // Unconfirmed — clear derived schedule state
                    data.auctionTime = null;
                  }

                  // Task 053: Price freshness — only when provider explicitly supplied pricing
                  if (normalized.hasPricingData) {
                    data.priceObservedAt = observedAt;
                  }
                  // If pricing missing entirely, do not refresh old price freshness
                  // Explicit provider result is terminal. An elapsed timestamp alone is not.
                  if (isTerminalResult) {
                    data.isBuyNow = false;
                    data.terminalAt = observedAt;
                    if (soldPriceUsd !== null) data.lastSoldPriceUsd = soldPriceUsd;
                  }

                  // Task 050B: Explicitly clear Buy Now when provider says it's gone.
                  // Task 053: Also use buyNowExplicitlyAbsent flag from normalizer.
                  if (!normalized.isBuyNow || !(normalized.buyNowUsd && normalized.buyNowUsd > 0) || normalized.buyNowExplicitlyAbsent) {
                    data.isBuyNow = false;
                    data.buyNowUsd = null;
                  }

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
      // Check if failure was due to tick attempt budget exhaustion
      if (localBudget.remaining <= 0) {
        terminalReason = 'tick_attempt_cap_reached';
      } else if (error instanceof TransportMalformedError
          && error.message.includes('tick_attempt_cap_reached')) {
        terminalReason = 'tick_attempt_cap_reached';
      } else {
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
      attemptsReserved: localBudget.used - usedBeforeRun,
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
      attemptsReserved: 0,
      ...overrides,
    };
  }
}
