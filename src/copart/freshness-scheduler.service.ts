/**
 * Quota-aware scheduler for list-only provider supply.
 *
 * Task 040: Unified single-sweep model. Discovery and refresh are the same
 * operation — a paginated GET /vehicles cycle. One sweep both discovers
 * new lots and refreshes existing ones. No duplicate discovery+refresh.
 *
 * Pacing: On each 5-minute tick, compute how many pages the daily budget
 * allows at this point in the UTC day.
 *   pacedTarget = floor(dailyCap * elapsedUtcDayMs / 86_400_000)
 *   tickPages   = min(dailyRemaining, max(0, pacedTarget - dailyUsed), 4)
 *
 * Provider fairness: round-robin across Copart/IAAI. If one provider is
 * exhausted/cooling/leased/failing, the other may borrow unused capacity.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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
  // Phase 3 extended fields
  selectedToday: number;
  deferredToday: number;
  completedToday: number;
  failedToday: number;
  projectedMonthEndUsage: number;
  // Phase 15 automatic scheduler fields
  autoEnabled: boolean;
  autoTickIntervalMs: number;
  lastSuccessfulRunAt: Date | null;
  activeProviderJobs: string[];
  isCurrentlyTicking: boolean;
  // Phase 033T — discovery integration
  lastDiscoveryRunAt: Date | null;
  nextDiscoveryRunAt: Date | null;
  discoveryPagesAttempted: number;
  discoveryLotsReceived: number;
  discoveryCreated: number;
  discoveryUpdated: number;
  discoverySkipped: number;
  discoveryTerminalReason: string | null;
  // Task 040 — unified daily cap diagnostics from the shared ledger
  dailyCap: number;
  dailyRemaining: number;
  dailyUtcBoundary: string | null;
  routineAllocatedToday: number;
  manualAllocatedToday: number;
  dailyBlockReason: string | null;
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
export class FreshnessSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FreshnessSchedulerService.name);
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;
  private static readonly TICK_LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 min max per tick

  // Discovery cadence: how often to run discovery per provider.
  // Bootstrap interval — used when no lots exist (seed the database).
  private static readonly DISCOVERY_BOOTSTRAP_INTERVAL_MS = 30 * 60 * 1000; // 30 min
  // Normal interval — used when lots already exist.
  private static readonly DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h
  // Max pages per discovery run per provider per tick (bounded to protect budget).
  private static readonly DISCOVERY_MAX_PAGES_PER_TICK = 2;

  // Track latest discovery results for admin status.
  private lastDiscovery: {
    runAt: Date;
    providers: Array<{
      provider: string;
      pagesCompleted: number;
      lotsDiscovered: number;
      newLots: number;
      lotsUpdated: number;
      skipped: number;
      terminalReason: string | null;
      errors: string[];
    }>;
  } | null = null;

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

  // ─── Automatic Scheduler Lifecycle ───

  /**
   * OnModuleInit: start automatic scheduler if enabled.
   *
   * The scheduler uses setInterval to call guardedTick() periodically.
   * Each tick acquires a provider lease before doing work, ensuring
   * no two instances (Railway replicas) process simultaneously.
   */
  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<boolean>('SCHEDULER_ENABLED', false);
    if (!enabled) {
      this.logger.log('Automatic scheduler DISABLED (SCHEDULER_ENABLED=false)');
      return;
    }

    const intervalMs = this.config.get<number>('SCHEDULER_TICK_INTERVAL_MS', 5 * 60 * 1000);
    this.logger.log(`Automatic scheduler ENABLED — tick every ${intervalMs}ms`);

    // Run startup recovery for stale jobs (non-blocking)
    this.runStartupRecovery().catch(err => {
      this.logger.error(`Startup recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Start periodic tick
    this.tickTimer = setInterval(() => {
      this.guardedTick().catch(err => {
        this.logger.error(`Unhandled scheduler tick error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
  }

  /**
   * OnModuleDestroy: clear timer and log shutdown.
   * Does NOT abort in-flight ticks (they finish naturally).
   */
  async onModuleDestroy(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      this.logger.log('Automatic scheduler timer stopped (graceful shutdown)');
    }
  }

  /**
   * Run startup recovery for stale jobs.
   * Recovers jobs that were left RUNNING by a crashed instance.
   */
  private async runStartupRecovery(): Promise<void> {
    for (const provider of ['copart', 'iaai'] as const) {
      try {
        const result = await this.leaseService.recoverStaleJobs(provider);
        if (result.recoveredJobIds.length > 0) {
          this.logger.log(`Startup recovery for ${provider}: recovered ${result.recoveredJobIds.length} stale jobs`);
        }
      } catch (err) {
        this.logger.error(`Startup recovery error for ${provider}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Guarded tick — prevents overlapping ticks, wraps errors.
   *
   * Lease-based multi-instance safety:
   * 1. Check if already ticking locally (isTicking flag)
   * 2. Try to acquire lease for each provider independently
   * 3. Run tick() if lease acquired
   * 4. Release lease after work (success or failure)
   *
   * Provider isolation: Copart and IAAI are independent.
   * No overlapping Copart jobs. No overlapping IAAI jobs.
   */
  private async guardedTick(): Promise<void> {
    // Local overlap guard
    if (this.isTicking) {
      this.logger.debug('Skipping tick — previous tick still running');
      return;
    }

    this.isTicking = true;
    const tickStart = Date.now();

    try {
      // Check if scheduler is paused
      const state = await this.getState();
      if (state.isPaused) {
        this.logger.debug('Scheduler paused — skipping automatic tick');
        return;
      }

      // Check budget before doing anything
      const budget = await this.budgetService.getUsage();
      if (budget.isRoutineBlocked) {
        this.logger.warn('Automatic tick: routine budget exhausted — skipping');
        return;
      }

      // Run the same guarded pipeline as manual admin trigger
      // Both automatic and manual use the same tick() method
      const result = await this.tick();

      const elapsed = Date.now() - tickStart;
      this.logger.log(
        `Automatic tick completed in ${elapsed}ms: ` +
        `processed=${result.processed}, deferred=${result.deferred}, ` +
        `requests=${result.requestsUsed}, errors=${result.errors.length}`,
      );
    } catch (err) {
      this.logger.error(
        `Automatic tick failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      // Swallow error — scheduler failures must NOT crash the API process
    } finally {
      this.isTicking = false;
    }
  }

  /**
   * Calculate priority score for a lot.
   *
   * Priority factors (higher = more urgent):
   * 1. Auction time proximity (closer = higher)
   * 2. Active bidding (auctionState open/active)
   * 3. Tracked/favorited (imported vehicles)
   * 4. Buy Now availability
   * 5. Most overdue nextRefreshAt
   * 6. Stable lot ID tie-break
   */
  calculatePriorityScore(lot: {
    ad?: Date | null;
    auctionState?: string | null;
    isBuyNow?: boolean;
    vehicleId?: string | null;
    nextRefreshAt?: Date | null;
    externalLotId: string;
  }, now: Date = new Date()): number {
    let score = 0;

    // 1. Auction time proximity (0-500 points)
    if (lot.ad) {
      const hoursUntilAuction = (new Date(lot.ad).getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntilAuction > 0 && hoursUntilAuction <= 24) {
        score += Math.round(500 - (hoursUntilAuction * 20)); // 500 at 0h, 20 at 24h
      } else if (hoursUntilAuction <= 0) {
        score += 500; // auction started
      }
    }

    // 2. Active bidding (200 points)
    if (lot.auctionState === 'open' || lot.auctionState === 'active') {
      score += 200;
    }

    // 3. Tracked/favorited — imported as vehicle (150 points)
    if (lot.vehicleId) {
      score += 150;
    }

    // 4. Buy Now (100 points)
    if (lot.isBuyNow) {
      score += 100;
    }

    // 5. Most overdue (0-100 points based on how overdue)
    if (lot.nextRefreshAt) {
      const overdueMs = now.getTime() - new Date(lot.nextRefreshAt).getTime();
      if (overdueMs > 0) {
        const overdueHours = overdueMs / (1000 * 60 * 60);
        score += Math.min(100, Math.round(overdueHours * 2));
      }
    }

    // 6. Stable tie-break: hash of lot ID (0-10 points)
    const hash = lot.externalLotId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    score += hash % 10;

    return score;
  }

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

  /** Retained quota-allocation helper for scheduler status compatibility. */
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

    const [pendingHot, pendingWarm, pendingCold, totalDiscovered, selectedToday, deferredToday, completedToday, failedToday] = await Promise.all([
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
      // Selected today
      this.prisma.discoveredLot.count({
        where: { selectedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      }),
      // Deferred today
      this.prisma.discoveredLot.count({
        where: { deferredAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      }),
      // Completed today (recently updated, not failed)
      this.prisma.discoveredLot.count({
        where: {
          lastProviderUpdateAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          consecutiveMisses: 0,
        },
      }),
      // Failed today
      this.prisma.discoveredLot.count({
        where: {
          lastProviderUpdateAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          consecutiveMisses: { gt: 0 },
        },
      }),
    ]);

    // Projected month-end usage = current usage + (dailyEnvelope × remainingDays)
    const projectedMonthEndUsage = (budget.allocated ?? 0) + (dailyEnvelope * remainingDays);

    // Task 040: expose unified daily cap diagnostics from the ledger
    const dailyCap = budget.dailyCap ?? dailyEnvelope;
    const dailyUsed = budget.dailyUsed ?? 0;
    const dailyRemaining = budget.dailyRemaining ?? 0;

    // Active provider jobs (leases held)
    const activeLeases = await Promise.all(
      (['copart', 'iaai'] as const).map(p => this.leaseService.getState(p)),
    );
    const activeProviderJobs = activeLeases
      .filter(l => l && !l.isExpired)
      .map(l => l!.provider);

    // Discovery status from last run (in-memory or fallback to DB checkpoints)
    let d = this.lastDiscovery;
    if (!d) {
      const checkpoints = await this.prisma.discoveryCheckpoint.findMany({
        where: { lastCompletedAt: { not: null } },
        orderBy: { lastCompletedAt: 'desc' },
      });
      if (checkpoints.length > 0) {
        const latest = checkpoints[0];
        d = {
          runAt: latest.lastCompletedAt!,
          providers: checkpoints.map(cp => ({
            provider: cp.provider,
            pagesCompleted: 0,
            lotsDiscovered: 0,
            newLots: 0,
            lotsUpdated: 0,
            skipped: 0,
            terminalReason: cp.exhaustedAt ? 'exhausted' : cp.lastError ? 'error' : null,
            errors: cp.lastError ? [cp.lastError] : [],
          })),
        };
      }
    }

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
      dailyEnvelope: dailyCap,
      dailyUsed,
      dailyCap,
      dailyRemaining,
      dailyUtcBoundary: budget.dailyUtcBoundary ?? null,
      routineAllocatedToday: budget.routineAllocatedToday ?? 0,
      manualAllocatedToday: budget.manualAllocatedToday ?? 0,
      dailyBlockReason: budget.dailyBlockReason ?? null,
      monthlyUsed: budget.allocated ?? 0,
      monthlyBudget: budget.budget ?? 30000,
      monthlyRemaining,
      remainingDays,
      selectedToday,
      deferredToday,
      completedToday,
      failedToday,
      projectedMonthEndUsage,
      // Phase 15 automatic scheduler fields
      autoEnabled: this.config.get<boolean>('SCHEDULER_ENABLED', false),
      autoTickIntervalMs: this.config.get<number>('SCHEDULER_TICK_INTERVAL_MS', 5 * 60 * 1000),
      lastSuccessfulRunAt: state.lastRunAt,
      activeProviderJobs,
      isCurrentlyTicking: this.isTicking,
      // Phase 033T — discovery integration
      lastDiscoveryRunAt: d ? d.runAt : null,
      nextDiscoveryRunAt: this.computeNextDiscoveryAt(now, totalDiscovered),
      discoveryPagesAttempted: d ? d.providers.reduce((s, p) => s + p.pagesCompleted, 0) : 0,
      discoveryLotsReceived: d ? d.providers.reduce((s, p) => s + p.lotsDiscovered, 0) : 0,
      discoveryCreated: d ? d.providers.reduce((s, p) => s + p.newLots, 0) : 0,
      discoveryUpdated: d ? d.providers.reduce((s, p) => s + p.lotsUpdated, 0) : 0,
      discoverySkipped: d ? d.providers.reduce((s, p) => s + p.skipped, 0) : 0,
      discoveryTerminalReason: d
        ? d.providers.find(p => p.terminalReason)?.terminalReason ?? null
        : null,
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

  /** Run one bounded sweep cycle with shared tick queue and attempt budget. Task 042 rework. */
  async tick(): Promise<{ processed: number; deferred: number; requestsUsed: number; errors: string[] }> {
    const state = await this.getState();

    if (state.isPaused) {
      this.logger.log('Scheduler is paused — skipping tick');
      return { processed: 0, deferred: 0, requestsUsed: 0, errors: [] };
    }

    // ── Read daily budget from the ledger ──
    const budget = await this.budgetService.getUsage();
    if (budget.isRoutineBlocked || budget.dailyRemaining <= 0) {
      this.logger.warn(
        `Scheduler: budget blocked — daily=${budget.dailyRemaining}, monthly=${budget.availableForRoutine}, reason=${budget.dailyBlockReason}`,
      );
      return { processed: 0, deferred: 0, requestsUsed: 0, errors: [`budget_blocked:${budget.dailyBlockReason ?? 'unknown'}`] };
    }

    // ── Pacing: how many charged attempts this tick? ──
    const now = new Date();
    const utcDayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const elapsedUtcDayMs = Math.max(0, now.getTime() - utcDayStartMs);
    const tickIntervalMs = this.config.get<number>('SCHEDULER_TICK_INTERVAL_MS', 5 * 60 * 1000);
    const pacedTarget = Math.floor((budget.dailyCap * elapsedUtcDayMs) / 86_400_000);
    const tickPages = Math.min(budget.dailyRemaining, Math.max(0, pacedTarget - budget.dailyUsed), 4);

    if (tickPages <= 0) {
      this.logger.debug(
        `Scheduler: ahead of pace — dailyCap=${budget.dailyCap}, elapsed=${elapsedUtcDayMs}ms, used=${budget.dailyUsed}, target=${pacedTarget}`,
      );
      await this.prisma.schedulerState.update({
        where: { id: state.id },
        data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + tickIntervalMs) },
      });
      return { processed: 0, deferred: 0, requestsUsed: 0, errors: [] };
    }

    // ── Determine provider rotation order (Task 042: true round-robin) ──
    const slot = Math.floor(elapsedUtcDayMs / tickIntervalMs);
    const first: ProviderId = slot % 2 === 0 ? 'copart' : 'iaai';
    const second: ProviderId = first === 'copart' ? 'iaai' : 'copart';
    const providerOrder: ProviderId[] = [first, second];

    this.logger.log(
      `Scheduler tick: slot=${slot}, first=${first}, dailyCap=${budget.dailyCap}, ` +
      `dailyUsed=${budget.dailyUsed}, tickPages=${tickPages}`,
    );

    // ── Shared attempt budget and tick queue (Task 042: real lending) ──
    const attemptBudget = { remaining: tickPages, used: 0 };
    const runnableProviders = new Set<ProviderId>([first, second]);
    const unavailableReasons = new Set([
      'lease_held', 'configuration_error', 'not_due',
      'exhausted', 'lease_lost', 'persistence_error', 'provider_error',
    ]);

    const errors: string[] = [];
    let totalProcessed = 0;
    let slotIdx = 0;
    const discoveryResults: any[] = [];

    while (attemptBudget.remaining > 0 && runnableProviders.size > 0) {
      // Select next runnable provider in rotating order
      let provider: ProviderId | null = null;
      for (let i = 0; i < providerOrder.length; i++) {
        const idx = (slotIdx + i) % providerOrder.length;
        if (runnableProviders.has(providerOrder[idx])) {
          provider = providerOrder[idx];
          break;
        }
      }
      if (!provider) break;
      slotIdx++;

      const pages = Math.min(attemptBudget.remaining, FreshnessSchedulerService.DISCOVERY_MAX_PAGES_PER_TICK);

      try {
        const result = await this.discoveryService.runDiscovery(
          { platform: provider, mode: 'discovery' },
          pages,
          attemptBudget,
        );

        totalProcessed += result.lotsPersisted;

        discoveryResults.push({
          provider: result.provider,
          pagesCompleted: result.pagesCompleted,
          lotsDiscovered: result.lotsDiscovered,
          newLots: result.newLots,
          lotsUpdated: result.lotsUpdated,
          attemptsReserved: result.attemptsReserved,
          terminalReason: result.terminalReason,
          errors: result.errors,
        });

        if (unavailableReasons.has(result.terminalReason)) {
          runnableProviders.delete(provider);
          this.logger.log(`Provider ${provider} unavailable (${result.terminalReason}) — removed from tick queue`);
        }
      } catch (err) {
        this.logger.error(
          `Sweep failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
        );
        errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
        runnableProviders.delete(provider);
      }
    }

    if (discoveryResults.length > 0) {
      this.lastDiscovery = { runAt: now, providers: discoveryResults };
    }

    // ── Lifecycle reconciliation (Task 044) ──
    // Transition active lots whose auction time has passed to ENDED
    try {
      const reconciledNow = new Date();
      const result = await this.prisma.discoveredLot.updateMany({
        where: {
          lifecycleState: { in: ['UPCOMING', 'OPEN', 'LIVE'] as any },
          auctionTime: { lt: reconciledNow },
          state: { in: ['DISCOVERED', 'IMPORTED'] },
        },
        data: {
          lifecycleState: 'ENDED' as any,
          freshnessState: 'TERMINAL' as any,
          terminalAt: reconciledNow,
        },
      });
      if (result.count > 0) {
        this.logger.log(`Lifecycle reconciliation: ${result.count} lots → ENDED`);
      }
    } catch (err) {
      this.logger.error(`Lifecycle reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Update scheduler state — use resolved tick interval (not hot freshness interval)
    await this.prisma.schedulerState.update({
      where: { id: state.id },
      data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + tickIntervalMs) },
    });

    this.logger.log(
      `Tick done: processed=${totalProcessed}, requestsUsed=${attemptBudget.used}, ` +
      `tickPages=${tickPages}, errors=${errors.length}`,
    );

    return { processed: totalProcessed, deferred: 0, requestsUsed: attemptBudget.used, errors };
  }

  // ─── Discovery Integration ───

  /**
   * Determine when the next discovery run should happen.
   * Uses bootstrap interval when no lots exist, normal interval otherwise.
   */
  private computeNextDiscoveryAt(now: Date, totalDiscovered: number): Date | null {
    if (!this.lastDiscovery) return now; // due immediately
    const interval =
      totalDiscovered === 0
        ? FreshnessSchedulerService.DISCOVERY_BOOTSTRAP_INTERVAL_MS
        : FreshnessSchedulerService.DISCOVERY_INTERVAL_MS;
    return new Date(this.lastDiscovery.runAt.getTime() + interval);
  }

  /**
   * Check whether a provider's discovery profile is due.
   *
   * A profile is due when:
   * - totalDiscovered === 0 (bootstrap — need to seed the database), OR
   * - no checkpoint exists for the default profile (never discovered), OR
   * - checkpoint exists but lastCompletedAt is older than the interval.
   *
   * Exhausted checkpoints are NOT due (end of pagination reached).
   */
  private async isDiscoveryDue(
    provider: string,
    mode: 'discovery' | 'refresh',
    now: Date,
    totalDiscovered: number,
  ): Promise<boolean> {
    const fingerprint = this.discoveryService.buildQueryFingerprint({
      platform: provider as 'copart' | 'iaai',
    });

    const checkpoint = await this.prisma.discoveryCheckpoint.findUnique({
      where: { provider_queryFingerprint: { provider, queryFingerprint: `${mode}:${fingerprint}` } },
    });

    if (!checkpoint) return true; // never discovered — due
    if (checkpoint.exhaustedAt) return !checkpoint.nextDueAt || checkpoint.nextDueAt <= now;
    if (!checkpoint.lastCompletedAt) return true; // started but never completed

    const interval = totalDiscovered === 0
      ? FreshnessSchedulerService.DISCOVERY_BOOTSTRAP_INTERVAL_MS
      : FreshnessSchedulerService.DISCOVERY_INTERVAL_MS;
    return now.getTime() - checkpoint.lastCompletedAt.getTime() >= interval;
  }

  /**
   * Run a unified sweep for due providers (Task 040 single-sweep model).
   * Called by tick() with page allocation from pacing logic.
   * Kept for compatibility with manual admin triggers.
   */
  private async runDueDiscovery(
    now: Date,
  ): Promise<
    Array<{
      provider: string;
      pagesCompleted: number;
      lotsDiscovered: number;
      lotsUpdated: number;
      newLots: number;
      terminalReason: string;
      errors: string[];
    }>
  > {
    const totalDiscovered = await this.prisma.discoveredLot.count();
    const results: Array<{
      provider: string;
      pagesCompleted: number;
      lotsDiscovered: number;
      lotsUpdated: number;
      newLots: number;
      terminalReason: string;
      errors: string[];
    }> = [];

    for (const provider of ['copart', 'iaai'] as const) {
      for (const mode of ['discovery', 'refresh'] as const) {
        try {
          const due = await this.isDiscoveryDue(provider, mode, now, totalDiscovered);
          if (!due) {
            this.logger.debug(`${mode} for ${provider} not due — skipping`);
            continue;
          }

          const maxPages = FreshnessSchedulerService.DISCOVERY_MAX_PAGES_PER_TICK;
          this.logger.log(`Running bounded ${mode} for ${provider} (maxPages=${maxPages})`);

          const result = await this.discoveryService.runDiscovery(
            { platform: provider, mode },
            maxPages,
          );

          results.push({
            provider: result.provider,
            pagesCompleted: result.pagesCompleted,
            lotsDiscovered: result.lotsDiscovered,
            lotsUpdated: result.lotsUpdated,
            newLots: result.newLots,
            terminalReason: result.terminalReason,
            errors: result.errors,
          });
        } catch (err) {
          this.logger.error(
            `${mode} failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
          );
          results.push({
            provider,
            pagesCompleted: 0,
            lotsDiscovered: 0,
            lotsUpdated: 0,
            newLots: 0,
            terminalReason: 'error',
            errors: [err instanceof Error ? err.message : String(err)],
          });
        }
      }
    }

    return results;
  }

  /** Preserve tier classification for status and scheduling policy consumers. */
  private classifyTier(lot: {
    ad?: Date | string | null;
    auctionState?: string | null;
    isBuyNow?: boolean | null;
    lastSeenAt?: Date | string | null;
  }): 'HOT' | 'WARM' | 'COLD' {
    if (lot.ad) {
      const auctionDate = new Date(lot.ad);
      const hoursUntilAuction = (auctionDate.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilAuction > 0 && hoursUntilAuction <= 24) return 'HOT';
    }

    if (lot.auctionState === 'open' || lot.auctionState === 'active') return 'HOT';
    if (lot.isBuyNow) return 'WARM';

    if (lot.lastSeenAt) {
      const daysSinceSeen =
        (Date.now() - new Date(lot.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceSeen <= 7) return 'WARM';
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
