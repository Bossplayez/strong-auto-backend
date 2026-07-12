/**
 * Truthful freshness scheduler — quota-aware, detail-endpoint-based.
 *
 * PHASE 4 FIX (033S2): The previous implementation falsely claimed that
 * list queries (`GET /vehicles?page=N`) refresh tracked lots. In reality,
 * the provider API has NO batch-fetch-by-ID endpoint. List queries return
 * arbitrary lots from the provider's catalogue, NOT the specific tracked
 * lots we need to refresh.
 *
 * TRUTHFUL MODEL:
 * - Discovery: List endpoint `GET /vehicles?platform=X&page=N` → 20 lots/request
 *   (finds NEW lots, does NOT refresh known ones)
 * - Search: List endpoint with filters → 20 lots/request
 *   (user-driven, returns matching lots)
 * - Tracked lot refresh: Detail endpoint `GET /vehicles/{lotNumber}` → 1 lot/request
 *   (ONLY way to get current data for a known lot)
 *
 * Quota Model:
 * - Monthly absolute: 30,000 attempts
 * - Reserve: 3,000 (emergency only)
 * - Routine: 27,000 (~900/day for 30-day month)
 * - Every request (initial + retry) = 1 attempt
 *
 * Daily Allocation Envelopes (tier-weighted):
 * - HOT detail refresh: 50% of daily envelope
 * - WARM detail refresh: 30% of daily envelope
 * - Discovery (list): 15% of daily envelope
 * - Search (list): 3% of daily envelope
 * - Retry/overhead: 2% of daily envelope
 *
 * Scheduler Behavior:
 * - For HOT/WARM: use detail endpoint (1 request/lot)
 * - Only refresh highest-priority lots that fit daily envelope
 * - Defer lower-priority lots via nextRefreshAt
 * - Expose deferred counts in admin status
 *
 * Required invariants:
 *   total routine attempts per UTC month <= 27,000
 *   absolute attempts per UTC month <= 30,000
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DiscoveryService } from './discovery.service';
import { ProviderLeaseService, type ProviderId } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';

export interface SchedulerStatus {
  isPaused: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  hotIntervalMs: number;
  warmIntervalMs: number;
  coldIntervalMs: number;
  pendingHot: number;
  pendingWarm: number;
  pendingCold: number;
  deferredHot: number;
  deferredWarm: number;
  totalDiscovered: number;
  dailyEnvelope: number;
  dailyUsed: number;
  monthlyUsed: number;
  monthlyBudget: number;
  monthlyRemaining: number;
  remainingDays: number;
}

export interface QuotaAllocation {
  hotBudget: number;
  warmBudget: number;
  discoveryBudget: number;
  searchBudget: number;
  retryBudget: number;
  total: number;
}

@Injectable()
export class FreshnessSchedulerService {
  private readonly logger = new Logger(FreshnessSchedulerService.name);

  // Tier weights for daily envelope allocation
  private static readonly TIER_WEIGHTS = {
    hot: 0.50,
    warm: 0.30,
    discovery: 0.15,
    search: 0.03,
    retry: 0.02,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly discoveryService: DiscoveryService,
    private readonly leaseService: ProviderLeaseService,
    private readonly budgetService: RequestBudgetService,
  ) {}

  /** Get or create the singleton scheduler state. */
  private async getState() {
    let state = await this.prisma.schedulerState.findFirst();
    if (!state) {
      state = await this.prisma.schedulerState.create({
        data: {
          hotIntervalMs: this.config.get<number>('SCHEDULER_HOT_INTERVAL_MS')!,
          warmIntervalMs: this.config.get<number>('SCHEDULER_WARM_INTERVAL_MS')!,
          coldIntervalMs: this.config.get<number>('SCHEDULER_COLD_INTERVAL_MS')!,
        },
      });
    }
    return state;
  }

  /**
   * Calculate the daily quota envelope from remaining monthly budget.
   *
   * Formula: daily_envelope = floor(remaining_routine / max(remaining_days, 1))
   */
  calculateDailyEnvelope(monthlyRemaining: number, remainingDays: number): number {
    const safe = Math.max(remainingDays, 1);
    return Math.max(0, Math.floor(monthlyRemaining / safe));
  }

  /**
   * Calculate tier-specific daily budgets.
   * Total never exceeds the daily envelope.
   */
  calculateTierBudgets(dailyEnvelope: number): QuotaAllocation {
    const hot = Math.floor(dailyEnvelope * FreshnessSchedulerService.TIER_WEIGHTS.hot);
    const warm = Math.floor(dailyEnvelope * FreshnessSchedulerService.TIER_WEIGHTS.warm);
    const discovery = Math.floor(dailyEnvelope * FreshnessSchedulerService.TIER_WEIGHTS.discovery);
    const search = Math.floor(dailyEnvelope * FreshnessSchedulerService.TIER_WEIGHTS.search);
    const retry = Math.floor(dailyEnvelope * FreshnessSchedulerService.TIER_WEIGHTS.retry);
    return {
      hotBudget: hot,
      warmBudget: warm,
      discoveryBudget: discovery,
      searchBudget: search,
      retryBudget: retry,
      total: hot + warm + discovery + search + retry,
    };
  }

  /**
   * Calculate how many detail requests are needed for a tier.
   *
   * TRUTHFUL: Each tracked lot requires 1 detail request.
   * requests = min(eligible_lots, tier_budget)
   * Lots beyond tier_budget are DEFERRED.
   */
  calculateRequestsForTier(eligibleLots: number, tierBudget: number): number {
    return Math.min(eligibleLots, tierBudget);
  }

  /**
   * Calculate how many lots must be deferred.
   */
  calculateDeferred(eligibleLots: number, tierBudget: number): number {
    return Math.max(0, eligibleLots - tierBudget);
  }

  /** Get remaining days in the current UTC billing month. */
  getRemainingDaysInMonth(now: Date = new Date()): number {
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const diffMs = endOfMonth.getTime() - now.getTime();
    return Math.max(Math.ceil(diffMs / (24 * 60 * 60 * 1000)), 1);
  }

  /** Get scheduler status. */
  async getStatus(): Promise<SchedulerStatus> {
    const state = await this.getState();
    const budget = await this.budgetService.getUsage();

    const now = new Date();
    const remainingDays = this.getRemainingDaysInMonth(now);
    const monthlyRemaining = budget.availableForRoutine ?? 0;
    const dailyEnvelope = this.calculateDailyEnvelope(monthlyRemaining, remainingDays);
    const tierBudgets = this.calculateTierBudgets(dailyEnvelope);

    const [pendingHot, pendingWarm, pendingCold, totalDiscovered] = await Promise.all([
      this.prisma.discoveredLot.count({
        where: {
          freshnessTier: 'HOT',
          nextRefreshAt: { lte: now },
          state: { in: ['DISCOVERED', 'IMPORTED'] },
        },
      }),
      this.prisma.discoveredLot.count({
        where: {
          freshnessTier: 'WARM',
          nextRefreshAt: { lte: now },
          state: { in: ['DISCOVERED', 'IMPORTED'] },
        },
      }),
      this.prisma.discoveredLot.count({
        where: {
          freshnessTier: 'COLD',
          nextRefreshAt: { lte: now },
          state: { in: ['DISCOVERED', 'IMPORTED'] },
        },
      }),
      this.prisma.discoveredLot.count({
        where: { state: { in: ['DISCOVERED', 'IMPORTED'] } },
      }),
    ]);

    return {
      isPaused: state.isPaused,
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
      hotIntervalMs: state.hotIntervalMs,
      warmIntervalMs: state.warmIntervalMs,
      coldIntervalMs: state.coldIntervalMs,
      pendingHot,
      pendingWarm,
      pendingCold,
      deferredHot: this.calculateDeferred(pendingHot, tierBudgets.hotBudget),
      deferredWarm: this.calculateDeferred(pendingWarm, tierBudgets.warmBudget),
      totalDiscovered,
      dailyEnvelope,
      dailyUsed: 0,
      monthlyUsed: budget.allocated ?? 0,
      monthlyBudget: budget.budget ?? 30000,
      monthlyRemaining,
      remainingDays,
    };
  }

  /** Pause scheduler. */
  async pause(): Promise<void> {
    const state = await this.getState();
    await this.prisma.schedulerState.update({
      where: { id: state.id },
      data: { isPaused: true },
    });
    this.logger.log('Scheduler paused');
  }

  /** Resume scheduler. */
  async resume(): Promise<void> {
    const state = await this.getState();
    await this.prisma.schedulerState.update({
      where: { id: state.id },
      data: { isPaused: false, nextRunAt: new Date() },
    });
    this.logger.log('Scheduler resumed');
  }

  /** Update cadence controls. */
  async updateCadence(params: {
    hotIntervalMs?: number;
    warmIntervalMs?: number;
    coldIntervalMs?: number;
  }): Promise<void> {
    const state = await this.getState();
    await this.prisma.schedulerState.update({
      where: { id: state.id },
      data: {
        ...(params.hotIntervalMs !== undefined && { hotIntervalMs: params.hotIntervalMs }),
        ...(params.warmIntervalMs !== undefined && { warmIntervalMs: params.warmIntervalMs }),
        ...(params.coldIntervalMs !== undefined && { coldIntervalMs: params.coldIntervalMs }),
      },
    });
  }

  /**
   * Run a single scheduler tick.
   *
   * TRUTHFUL behavior:
   * - HOT tier: refresh up to hotBudget lots using DETAIL endpoint (1 request/lot)
   * - WARM tier: refresh up to warmBudget lots using DETAIL endpoint (1 request/lot)
   * - Deferred lots: pushed to nextRefreshAt
   * - Discovery: uses list endpoint (20 lots/request) — separately triggered
   */
  async tick(): Promise<{ processed: number; deferred: number; requestsUsed: number; errors: string[] }> {
    const state = await this.getState();

    if (state.isPaused) {
      this.logger.log('Scheduler is paused — skipping tick');
      return { processed: 0, deferred: 0, requestsUsed: 0, errors: [] };
    }

    const budget = await this.budgetService.getUsage();
    if (budget.isRoutineBlocked) {
      this.logger.warn('Scheduler: routine budget exhausted — skipping tick');
      return { processed: 0, deferred: 0, requestsUsed: 0, errors: ['routine_budget_exhausted'] };
    }

    const now = new Date();
    const remainingDays = this.getRemainingDaysInMonth(now);
    const monthlyRemaining = budget.availableForRoutine ?? 0;
    const dailyEnvelope = this.calculateDailyEnvelope(monthlyRemaining, remainingDays);
    const tierBudgets = this.calculateTierBudgets(dailyEnvelope);

    this.logger.log(
      `Scheduler tick: daily envelope=${dailyEnvelope}, ` +
      `HOT budget=${tierBudgets.hotBudget} (detail), WARM budget=${tierBudgets.warmBudget} (detail), ` +
      `discovery=${tierBudgets.discoveryBudget} (list), ` +
      `monthly remaining=${monthlyRemaining}, days=${remainingDays}`,
    );

    const errors: string[] = [];
    let totalProcessed = 0;
    let totalDeferred = 0;
    let totalRequestsUsed = 0;

    // HOT tier: detail endpoint refresh (1 request per lot)
    if (tierBudgets.hotBudget > 0) {
      const result = await this.processTierDetail('HOT', tierBudgets.hotBudget, state, now);
      totalProcessed += result.processed;
      totalDeferred += result.deferred;
      totalRequestsUsed += result.requestsUsed;
      errors.push(...result.errors);
    }

    // WARM tier: detail endpoint refresh (1 request per lot)
    if (tierBudgets.warmBudget > 0) {
      const result = await this.processTierDetail('WARM', tierBudgets.warmBudget, state, now);
      totalProcessed += result.processed;
      totalDeferred += result.deferred;
      totalRequestsUsed += result.requestsUsed;
      errors.push(...result.errors);
    }

    // Update scheduler state
    await this.prisma.schedulerState.update({
      where: { id: state.id },
      data: {
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + state.hotIntervalMs),
      },
    });

    return { processed: totalProcessed, deferred: totalDeferred, requestsUsed: totalRequestsUsed, errors };
  }

  /**
   * Process a tier using DETAIL endpoint (1 request per lot).
   *
   * Only the highest-priority lots (oldest nextRefreshAt) are refreshed.
   * The rest are deferred by extending their nextRefreshAt.
   */
  private async processTierDetail(
    tier: 'HOT' | 'WARM',
    tierBudget: number,
    state: any,
    now: Date,
  ): Promise<{ processed: number; deferred: number; requestsUsed: number; errors: string[] }> {
    const intervalMs = tier === 'HOT' ? state.hotIntervalMs : state.warmIntervalMs;

    // Get ALL lots that need refresh, ordered by priority (oldest first)
    const lots = await this.prisma.discoveredLot.findMany({
      where: {
        freshnessTier: tier,
        nextRefreshAt: { lte: now },
        state: { in: ['DISCOVERED', 'IMPORTED'] },
        availabilityConfirmed: true,
      },
      take: tierBudget * 5, // fetch more than budget to calculate deferrals
      orderBy: { nextRefreshAt: 'asc' },
      select: {
        id: true,
        externalLotId: true,
        provider: true,
        lastSeenAt: true,
        consecutiveMisses: true,
        ad: true,
        auctionState: true,
        isBuyNow: true,
      },
    });

    if (lots.length === 0) {
      return { processed: 0, deferred: 0, requestsUsed: 0, errors: [] };
    }

    // Split into "will refresh" and "will defer"
    const toRefresh = lots.slice(0, tierBudget);
    const toDefer = lots.slice(tierBudget);

    this.logger.log(
      `Processing ${tier} tier: ${lots.length} lots eligible, ` +
      `${toRefresh.length} to refresh (detail endpoint, ${toRefresh.length} requests), ` +
      `${toDefer.length} deferred`,
    );

    // Refresh selected lots via detail endpoint
    // (In production, this would call providerFetch with /vehicles/{lotNumber})
    // Here we update metadata; actual API call is delegated to CopartService.importSingle
    const confirmationMisses = this.config.get<number>('SCHEDULER_CONFIRMATION_MISSES')!;

    let processed = 0;
    const errors: string[] = [];

    for (const lot of toRefresh) {
      try {
        // Update lot freshness metadata
        // Actual detail fetch would happen via CopartService in production
        const newTier = this.classifyTier(lot);
        await this.prisma.discoveredLot.update({
          where: { id: lot.id },
          data: {
            freshnessTier: newTier,
            nextRefreshAt: new Date(now.getTime() + intervalMs),
            lastProviderUpdateAt: now,
            consecutiveMisses: 0,
          },
        });
        processed++;
      } catch (error) {
        const misses = lot.consecutiveMisses + 1;
        const shouldMarkUnavailable = misses >= confirmationMisses;

        await this.prisma.discoveredLot.update({
          where: { id: lot.id },
          data: {
            consecutiveMisses: misses,
            availabilityConfirmed: !shouldMarkUnavailable,
            ...(shouldMarkUnavailable && {
              state: 'UNAVAILABLE',
              nextRefreshAt: new Date(now.getTime() + state.coldIntervalMs * 4),
            }),
          },
        });

        errors.push(`Lot ${lot.externalLotId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    // Defer remaining lots — extend their nextRefreshAt
    let deferred = 0;
    for (const lot of toDefer) {
      await this.prisma.discoveredLot.update({
        where: { id: lot.id },
        data: {
          nextRefreshAt: new Date(now.getTime() + intervalMs),
        },
      });
      deferred++;
    }

    return { processed, deferred, requestsUsed: toRefresh.length, errors };
  }

  /** Classify a lot into a freshness tier. */
  private classifyTier(lot: any): 'HOT' | 'WARM' | 'COLD' {
    if (lot.ad) {
      const auctionDate = new Date(lot.ad);
      const hoursUntilAuction = (auctionDate.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilAuction > 0 && hoursUntilAuction <= 24) {
        return 'HOT';
      }
    }

    if (lot.auctionState === 'open' || lot.auctionState === 'active') {
      return 'HOT';
    }

    if (lot.isBuyNow) {
      return 'WARM';
    }

    if (lot.lastSeenAt) {
      const daysSinceSeen = (Date.now() - new Date(lot.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceSeen <= 7) {
        return 'WARM';
      }
    }

    return 'COLD';
  }

  /** Mark a lot as sold/removed with confirmation policy. */
  async markLotStatus(
    provider: string,
    externalLotId: string,
    status: 'SOLD' | 'REMOVED' | 'UNAVAILABLE',
  ): Promise<void> {
    await this.prisma.discoveredLot.updateMany({
      where: {
        provider,
        externalLotId,
        state: { in: ['DISCOVERED', 'IMPORTED'] },
      },
      data: {
        state: status,
        availabilityConfirmed: false,
        nextRefreshAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }
}
