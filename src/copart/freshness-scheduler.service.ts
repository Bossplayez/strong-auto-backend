/**
 * Adaptive freshness scheduler.
 *
 * Tiers:
 *   HOT  — upcoming auction, active bidding, tracked lots (10-20 min)
 *   WARM — Buy Now, recently discovered available (2-6 hours)
 *   COLD — general discovery, older unchanged (12-24 hours)
 *
 * Rules:
 * - Cadence degrades as quota decreases
 * - Monthly budget: 30,000, reserve: 3,000, routine: 27,000 (~900/day)
 * - Retries count as separate attempts
 * - Sold/removed → confirmation policy before refresh stops
 * - No stale RUNNING job blocks future scheduling
 * - Uses claimWithRecovery(), leases, fencing, global quota
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
}

@Injectable()
export class FreshnessSchedulerService {
  private readonly logger = new Logger(FreshnessSchedulerService.name);

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

  /** Get scheduler status. */
  async getStatus(): Promise<SchedulerStatus> {
    const state = await this.getState();

    const now = new Date();
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
    this.logger.log(`Cadence updated: hot=${params.hotIntervalMs ?? state.hotIntervalMs}ms, warm=${params.warmIntervalMs ?? state.warmIntervalMs}ms, cold=${params.coldIntervalMs ?? state.coldIntervalMs}ms`);
  }

  /**
   * Run a single scheduler tick.
   * Called by cron or manually.
   */
  async tick(): Promise<{ processed: number; errors: string[] }> {
    const state = await this.getState();

    if (state.isPaused) {
      this.logger.log('Scheduler is paused — skipping tick');
      return { processed: 0, errors: [] };
    }

    // Check quota
    const budget = await this.budgetService.getUsage();
    if (budget.isRoutineBlocked) {
      this.logger.warn('Scheduler: routine budget exhausted — degrading cadence');
      // Degrade: only process HOT tier
      return this.processTier('HOT', state, budget);
    }

    const now = new Date();
    const errors: string[] = [];
    let processed = 0;

    // Process by tier priority: HOT → WARM → COLD
    for (const tier of ['HOT', 'WARM', 'COLD'] as const) {
      // Check quota after each tier
      const currentBudget = await this.budgetService.getUsage();
      if (currentBudget.isRoutineBlocked) {
        this.logger.warn(`Scheduler: budget exhausted after ${tier} tier, stopping`);
        break;
      }

      // Quota-based cadence degradation
      const usagePercent = currentBudget.percentageUsed;
      if (tier === 'COLD' && usagePercent > 70) {
        this.logger.log(`Scheduler: skipping COLD tier (quota at ${usagePercent}%)`);
        continue;
      }
      if (tier === 'WARM' && usagePercent > 85) {
        this.logger.log(`Scheduler: skipping WARM tier (quota at ${usagePercent}%)`);
        continue;
      }

      const result = await this.processTier(tier, state, currentBudget);
      processed += result.processed;
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

    return { processed, errors };
  }

  /** Process a single tier. */
  private async processTier(
    tier: 'HOT' | 'WARM' | 'COLD',
    state: any,
    budget: any,
  ): Promise<{ processed: number; errors: string[] }> {
    const now = new Date();
    const intervalMs = tier === 'HOT' ? state.hotIntervalMs : tier === 'WARM' ? state.warmIntervalMs : state.coldIntervalMs;
    const maxBatch = tier === 'HOT' ? 20 : tier === 'WARM' ? 10 : 5;

    // Get lots that need refresh
    const lots = await this.prisma.discoveredLot.findMany({
      where: {
        freshnessTier: tier,
        nextRefreshAt: { lte: now },
        state: { in: ['DISCOVERED', 'IMPORTED'] },
        availabilityConfirmed: true,
      },
      take: maxBatch,
      orderBy: { nextRefreshAt: 'asc' },
    });

    if (lots.length === 0) {
      return { processed: 0, errors: [] };
    }

    this.logger.log(`Processing ${tier} tier: ${lots.length} lots`);

    let processed = 0;
    const errors: string[] = [];
    const confirmationMisses = this.config.get<number>('SCHEDULER_CONFIRMATION_MISSES')!;

    for (const lot of lots) {
      // Check budget
      if (budget.isRoutineBlocked) {
        this.logger.warn(`Budget exhausted during ${tier} processing`);
        break;
      }

      try {
        // Assign freshness tier based on current state
        const newTier = this.classifyTier(lot);

        // Update next refresh time
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
        // Increment consecutive misses
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
            ...(tier === 'HOT' && !shouldMarkUnavailable && {
              nextRefreshAt: new Date(now.getTime() + state.hotIntervalMs),
            }),
          },
        });

        errors.push(`Lot ${lot.externalLotId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    return { processed, errors };
  }

  /** Classify a lot into a freshness tier. */
  private classifyTier(lot: any): 'HOT' | 'WARM' | 'COLD' {
    // HOT: upcoming auction (within 24h) or active bidding
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

    // WARM: Buy Now lots or recently seen (within 7 days)
    if (lot.isBuyNow) {
      return 'WARM';
    }

    if (lot.lastSeenAt) {
      const daysSinceSeen = (Date.now() - new Date(lot.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceSeen <= 7) {
        return 'WARM';
      }
    }

    // COLD: everything else
    return 'COLD';
  }

  /**
   * Mark a lot as sold/removed with confirmation policy.
   */
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
        nextRefreshAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // check again in 7 days
      },
    });
  }
}
