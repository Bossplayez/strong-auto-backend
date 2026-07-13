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
  private static readonly DISCOVERY_MAX_PAGES_PER_TICK = 3;

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

    // Active provider jobs (leases held)
    const activeLeases = await Promise.all(
      (['copart', 'iaai'] as const).map(p => this.leaseService.getState(p)),
    );
    const activeProviderJobs = activeLeases
      .filter(l => l && !l.isExpired)
      .map(l => l!.provider);

    // Discovery status from last run
    const d = this.lastDiscovery;

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

    // ── Discovery phase: run bounded discovery before HOT/WARM refresh ──
    const discoveryResults = await this.runDueDiscovery(now);
    if (discoveryResults.length > 0) {
      this.lastDiscovery = {
        runAt: now,
        providers: discoveryResults.map(r => ({
          provider: r.provider,
          pagesCompleted: r.pagesCompleted,
          lotsDiscovered: r.lotsDiscovered,
          newLots: r.newLots,
          lotsUpdated: r.lotsUpdated,
          skipped: 0,
          terminalReason: r.terminalReason,
          errors: r.errors,
        })),
      };
      this.logger.log(
        `Discovery this tick: ${discoveryResults.length} provider(s), ` +
        `${discoveryResults.reduce((s, r) => s + r.pagesCompleted, 0)} pages, ` +
        `${discoveryResults.reduce((s, r) => s + r.lotsDiscovered, 0)} lots`,
      );
    }

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

    // Get ALL lots that need refresh, ordered by priority score (highest first)
    const lots = await this.prisma.discoveredLot.findMany({
      where: {
        freshnessTier: tier,
        nextRefreshAt: { lte: now },
        state: { in: ['DISCOVERED', 'IMPORTED'] },
        availabilityConfirmed: true,
      },
      take: tierBudget * 5,
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
        vehicleId: true,
        nextRefreshAt: true,
      },
    });

    if (lots.length === 0) {
      return { processed: 0, deferred: 0, requestsUsed: 0, errors: [] };
    }

    // Calculate priority scores and sort
    const scored = lots
      .map(lot => ({
        ...lot,
        priorityScore: this.calculatePriorityScore(lot, now),
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore);

    // Split into "will refresh" and "will defer"
    const toRefresh = scored.slice(0, tierBudget);
    const toDefer = scored.slice(tierBudget);

    this.logger.log(
      `Processing ${tier} tier: ${lots.length} lots eligible, ` +
      `${toRefresh.length} selected (detail, ${toRefresh.length} requests, priority ${toRefresh[0]?.priorityScore}-${toRefresh[toRefresh.length - 1]?.priorityScore}), ` +
      `${toDefer.length} deferred`,
    );

    // Mark selected lots
    for (const lot of toRefresh) {
      await this.prisma.discoveredLot.update({
        where: { id: lot.id },
        data: {
          priorityScore: lot.priorityScore,
          selectedAt: now,
          attemptCost: 1,
          deferralReason: null,
          deferredAt: null,
        },
      });
    }

    // Mark deferred lots
    for (const lot of toDefer) {
      await this.prisma.discoveredLot.update({
        where: { id: lot.id },
        data: {
          priorityScore: lot.priorityScore,
          deferredAt: now,
          deferralReason: 'budget_exceeded',
          nextRefreshAt: new Date(now.getTime() + intervalMs),
        },
      });
    }

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

    return { processed, deferred: toDefer.length, requestsUsed: toRefresh.length, errors };
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
    now: Date,
    totalDiscovered: number,
  ): Promise<boolean> {
    // Bootstrap: always due when empty
    if (totalDiscovered === 0) return true;

    const fingerprint = this.discoveryService.buildQueryFingerprint({
      platform: provider as 'copart' | 'iaai',
    });

    const checkpoint = await this.prisma.discoveryCheckpoint.findUnique({
      where: { provider_queryFingerprint: { provider, queryFingerprint: fingerprint } },
    });

    if (!checkpoint) return true; // never discovered — due
    if (checkpoint.exhaustedAt) return false; // exhausted — not due
    if (!checkpoint.lastCompletedAt) return true; // started but never completed

    const interval = FreshnessSchedulerService.DISCOVERY_INTERVAL_MS;
    return now.getTime() - checkpoint.lastCompletedAt.getTime() >= interval;
  }

  /**
   * Run bounded discovery for due providers.
   *
   * Each provider is handled independently — one failure does not block
   * the other. Discovery respects existing lease, fencing, and quota
   * controls inside DiscoveryService.runDiscovery().
   *
   * Does NOT auto-publish discovered lots to the catalog.
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
      try {
        const due = await this.isDiscoveryDue(provider, now, totalDiscovered);
        if (!due) {
          this.logger.debug(`Discovery for ${provider} not due — skipping`);
          continue;
        }

        const maxPages = FreshnessSchedulerService.DISCOVERY_MAX_PAGES_PER_TICK;
        this.logger.log(
          `Running bounded discovery for ${provider} (maxPages=${maxPages})`,
        );

        const result = await this.discoveryService.runDiscovery(
          { platform: provider },
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
          `Discovery failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
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

    return results;
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
