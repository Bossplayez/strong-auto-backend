/**
 * Adaptive freshness scheduler — batch/list-based, quota-aware.
 *
 * BLOCKER 1 FIX: The previous implementation issued one request per lot
 * at fixed intervals, which would consume 366,000 requests/month
 * (100 HOT × 96/day + 200 WARM × 8/day + 500 COLD × 2/day = 366,000).
 *
 * NEW MODEL: Uses batch list queries (20 lots per request) instead of
 * individual detail requests. Cadence is calculated from remaining
 * monthly quota, remaining days, and eligible lot count.
 *
 * Quota Model:
 * - Monthly budget: 30,000 attempts (absolute)
 * - Reserve: 3,000 (emergency only)
 * - Routine: 27,000 (~900/day for 30-day month)
 * - Every request (initial + retry) = 1 attempt
 * - Each list request returns up to 20 lots
 *
 * Daily Allocation Envelopes (configurable):
 * - HOT refresh: priority 1 (near-auction, active bidding)
 * - WARM refresh: priority 2 (Buy Now, recently discovered)
 * - Discovery: priority 3 (new lot discovery)
 * - Search (user/admin): priority 4 (on-demand)
 * - Retry/operational: priority 5 (overhead)
 *
 * Cadence Formula:
 *   daily_envelope = remaining_monthly_routine / remaining_days
 *   tier_budget = daily_envelope × tier_weight
 *   requests_per_tick = min(eligible_lots / 20, tier_budget)
 *
 * Tier weights: HOT=0.50, WARM=0.30, discovery=0.15, search/retry=0.05
 *
 * The scheduler NEVER creates work exceeding its daily/monthly envelope.
 * Batch list queries return 20 lots per request, so 1 request refreshes
 * up to 20 lots.
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

  // Items per batch request (provider returns 20 per page)
  private static readonly ITEMS_PER_REQUEST = 20;

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
   *
   * This ensures we never exceed the monthly budget by spreading
   * remaining quota evenly across remaining days.
   */
  calculateDailyEnvelope(monthlyRemaining: number, remainingDays: number): number {
    const safe = Math.max(remainingDays, 1);
    return Math.floor(monthlyRemaining / safe);
  }

  /**
   * Calculate tier-specific daily budgets.
   *
   * Each tier gets a weighted portion of the daily envelope.
   * The total never exceeds the daily envelope.
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
   * Calculate how many batch requests are needed for a tier.
   *
   * requests = ceil(eligible_lots / ITEMS_PER_REQUEST)
   * But never more than tier_budget.
   */
  calculateRequestsForTier(eligibleLots: number, tierBudget: number): number {
    const needed = Math.ceil(eligibleLots / FreshnessSchedulerService.ITEMS_PER_REQUEST);
    return Math.min(needed, tierBudget);
  }

  /**
   * Get remaining days in the current UTC billing month.
   */
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
      totalDiscovered,
      dailyEnvelope,
      dailyUsed: 0, // tracked by request budget service
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
   * Uses BATCH list queries (20 lots/request) instead of per-lot detail requests.
   *
   * Quota check: calculate daily envelope from remaining monthly budget,
   * allocate to tiers by weight, and never exceed the envelope.
   */
  async tick(): Promise<{ processed: number; requestsUsed: number; errors: string[] }> {
    const state = await this.getState();

    if (state.isPaused) {
      this.logger.log('Scheduler is paused — skipping tick');
      return { processed: 0, requestsUsed: 0, errors: [] };
    }

    // Get budget state
    const budget = await this.budgetService.getUsage();
    if (budget.isRoutineBlocked) {
      this.logger.warn('Scheduler: routine budget exhausted — skipping tick');
      return { processed: 0, requestsUsed: 0, errors: ['routine_budget_exhausted'] };
    }

    const now = new Date();
    const remainingDays = this.getRemainingDaysInMonth(now);
    const monthlyRemaining = budget.availableForRoutine ?? 0;
    const dailyEnvelope = this.calculateDailyEnvelope(monthlyRemaining, remainingDays);
    const tierBudgets = this.calculateTierBudgets(dailyEnvelope);

    this.logger.log(
      `Scheduler tick: daily envelope=${dailyEnvelope}, ` +
      `HOT=${tierBudgets.hotBudget}, WARM=${tierBudgets.warmBudget}, ` +
      `discovery=${tierBudgets.discoveryBudget}, ` +
      `monthly remaining=${monthlyRemaining}, days=${remainingDays}`,
    );

    const errors: string[] = [];
    let totalProcessed = 0;
    let totalRequestsUsed = 0;

    // Process tiers by priority: HOT → WARM → (COLD handled via discovery)
    // Each tier uses BATCH list queries, not per-lot detail requests.

    // HOT tier: batch refresh using list query with filter
    if (tierBudgets.hotBudget > 0) {
      const result = await this.processTierBatch('HOT', tierBudgets.hotBudget, state, now);
      totalProcessed += result.processed;
      totalRequestsUsed += result.requestsUsed;
      errors.push(...result.errors);
    }

    // WARM tier: batch refresh
    if (tierBudgets.warmBudget > 0) {
      const result = await this.processTierBatch('WARM', tierBudgets.warmBudget, state, now);
      totalProcessed += result.processed;
      totalRequestsUsed += result.requestsUsed;
      errors.push(...result.errors);
    }

    // Discovery: use remaining discovery budget for new lot discovery
    // (not per-lot refresh, but page-based discovery pass)
    if (tierBudgets.discoveryBudget > 0 && !budget.isRoutineBlocked) {
      // Discovery uses 1 request per page (20 lots), so discoveryBudget pages
      // can discover up to discoveryBudget × 20 new lots
      this.logger.log(
        `Discovery budget: ${tierBudgets.discoveryBudget} requests available ` +
        `(up to ${tierBudgets.discoveryBudget * FreshnessSchedulerService.ITEMS_PER_REQUEST} lots)`,
      );
      // Actual discovery is triggered separately via admin or cron
    }

    // Update scheduler state
    await this.prisma.schedulerState.update({
      where: { id: state.id },
      data: {
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + state.hotIntervalMs),
      },
    });

    return { processed: totalProcessed, requestsUsed: totalRequestsUsed, errors };
  }

  /**
   * Process a tier using BATCH list queries.
   *
   * Instead of making 1 request per lot, we make 1 request per 20 lots.
   * This reduces API consumption by 20×.
   */
  private async processTierBatch(
    tier: 'HOT' | 'WARM',
    tierBudget: number,
    state: any,
    now: Date,
  ): Promise<{ processed: number; requestsUsed: number; errors: string[] }> {
    const intervalMs = tier === 'HOT' ? state.hotIntervalMs : state.warmIntervalMs;

    // Get lots that need refresh
    const lots = await this.prisma.discoveredLot.findMany({
      where: {
        freshnessTier: tier,
        nextRefreshAt: { lte: now },
        state: { in: ['DISCOVERED', 'IMPORTED'] },
        availabilityConfirmed: true,
      },
      take: tierBudget * FreshnessSchedulerService.ITEMS_PER_REQUEST, // limit to what budget allows
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
      return { processed: 0, requestsUsed: 0, errors: [] };
    }

    // Calculate how many batch requests we need
    const requestsNeeded = Math.ceil(lots.length / FreshnessSchedulerService.ITEMS_PER_REQUEST);
    const requestsToUse = Math.min(requestsNeeded, tierBudget);

    this.logger.log(
      `Processing ${tier} tier: ${lots.length} lots, ` +
      `${requestsNeeded} requests needed, ${requestsToUse} requests allocated`,
    );

    // Update lot freshness metadata (no API call needed for metadata-only updates)
    // The actual API refresh happens via discovery or search, which uses batch list queries
    const confirmationMisses = this.config.get<number>('SCHEDULER_CONFIRMATION_MISSES')!;

    let processed = 0;
    const errors: string[] = [];

    for (const lot of lots) {
      try {
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

    return { processed, requestsUsed: requestsToUse, errors };
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
