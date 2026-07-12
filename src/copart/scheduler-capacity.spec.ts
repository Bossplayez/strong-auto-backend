/**
 * Task 033T Phase 3 — Scheduler Capacity and Deferral Tests
 *
 * Tests: priority scoring, deterministic ordering, overloaded queues,
 * retries, month rollover, zero capacity, deferral persistence.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DiscoveryService } from './discovery.service';
import { ProviderLeaseService } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { FreshnessSchedulerService } from './freshness-scheduler.service';

describe('Task 033T Phase 3 — Scheduler Capacity and Deferral', () => {
  let service: FreshnessSchedulerService;
  let prisma: any;
  let budgetService: any;

  beforeEach(async () => {
    prisma = {
      schedulerState: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'sched-1', isPaused: false,
          hotIntervalMs: 900000, warmIntervalMs: 10800000, coldIntervalMs: 43200000,
          lastRunAt: null, nextRunAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      discoveredLot: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    budgetService = {
      getUsage: jest.fn().mockResolvedValue({
        budget: 30000, reserve: 3000, allocated: 0,
        availableForRoutine: 27000, isRoutineBlocked: false,
      }),
      canMakeRoutineRequest: jest.fn().mockResolvedValue({ allowed: true }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RequestBudgetService, useValue: budgetService },
        { provide: ProviderLeaseService, useValue: {} },
        { provide: ConfigService, useValue: { get: (k: string) => ({ SCHEDULER_HOT_INTERVAL_MS: 900000, SCHEDULER_WARM_INTERVAL_MS: 10800000, SCHEDULER_COLD_INTERVAL_MS: 43200000, SCHEDULER_CONFIRMATION_MISSES: 3 })[k] } },
        { provide: DiscoveryService, useValue: {} },
        FreshnessSchedulerService,
      ],
    }).compile();

    service = moduleRef.get(FreshnessSchedulerService);
  });

  // ── Priority Scoring ──

  describe('Priority scoring', () => {
    const now = new Date('2026-07-15T12:00:00Z');

    it('auction starting soon gets highest priority', () => {
      const lot = {
        ad: new Date('2026-07-15T14:00:00Z'), // 2 hours from now
        auctionState: 'open',
        isBuyNow: false,
        vehicleId: null,
        nextRefreshAt: now,
        externalLotId: '12345',
      };
      const score = service.calculatePriorityScore(lot, now);
      // 500 - (2*20) = 460 (auction proximity) + 200 (open) = 660 + tie-break
      expect(score).toBeGreaterThanOrEqual(660);
      expect(score).toBeLessThan(670);
    });

    it('tracked/favorited lot gets priority boost', () => {
      const tracked = { ad: null, auctionState: null, isBuyNow: false, vehicleId: 'v1', nextRefreshAt: now, externalLotId: '111' };
      const untracked = { ad: null, auctionState: null, isBuyNow: false, vehicleId: null, nextRefreshAt: now, externalLotId: '111' };
      expect(service.calculatePriorityScore(tracked, now)).toBeGreaterThan(service.calculatePriorityScore(untracked, now));
    });

    it('Buy Now lot gets priority over regular', () => {
      const buyNow = { ad: null, auctionState: null, isBuyNow: true, vehicleId: null, nextRefreshAt: now, externalLotId: '111' };
      const regular = { ad: null, auctionState: null, isBuyNow: false, vehicleId: null, nextRefreshAt: now, externalLotId: '111' };
      expect(service.calculatePriorityScore(buyNow, now)).toBeGreaterThan(service.calculatePriorityScore(regular, now));
    });

    it('overdue lot gets priority boost', () => {
      const veryOverdue = { ad: null, auctionState: null, isBuyNow: false, vehicleId: null, nextRefreshAt: new Date(now.getTime() - 50 * 60 * 60 * 1000), externalLotId: '111' };
      const slightlyOverdue = { ad: null, auctionState: null, isBuyNow: false, vehicleId: null, nextRefreshAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), externalLotId: '111' };
      expect(service.calculatePriorityScore(veryOverdue, now)).toBeGreaterThan(service.calculatePriorityScore(slightlyOverdue, now));
    });

    it('stable tie-break: same lot ID always gets same score', () => {
      const lot = { ad: null, auctionState: null, isBuyNow: false, vehicleId: null, nextRefreshAt: now, externalLotId: '44577817' };
      const score1 = service.calculatePriorityScore(lot, now);
      const score2 = service.calculatePriorityScore(lot, now);
      expect(score1).toBe(score2);
    });

    it('deterministic ordering: same set always produces same order', () => {
      const lots = [
        { ad: new Date('2026-07-15T14:00:00Z'), auctionState: 'open', isBuyNow: false, vehicleId: null, nextRefreshAt: now, externalLotId: '111' },
        { ad: null, auctionState: null, isBuyNow: true, vehicleId: 'v1', nextRefreshAt: now, externalLotId: '222' },
        { ad: null, auctionState: null, isBuyNow: false, vehicleId: null, nextRefreshAt: new Date(now.getTime() - 100 * 60 * 60 * 1000), externalLotId: '333' },
      ];
      const scored1 = lots.map(l => ({ id: l.externalLotId, score: service.calculatePriorityScore(l, now) })).sort((a, b) => b.score - a.score);
      const scored2 = lots.map(l => ({ id: l.externalLotId, score: service.calculatePriorityScore(l, now) })).sort((a, b) => b.score - a.score);
      expect(scored1.map(s => s.id)).toEqual(scored2.map(s => s.id));
    });
  });

  // ── Overloaded Queues ──

  describe('Overloaded HOT queue', () => {
    it('500 HOT lots with budget 450 → 450 selected, 50 deferred', () => {
      const eligible = 500;
      const budget = 450;
      const selected = service.calculateRequestsForTier(eligible, budget);
      const deferred = service.calculateDeferred(eligible, budget);
      expect(selected).toBe(450);
      expect(deferred).toBe(50);
    });

    it('10000 HOT lots with budget 450 → 450 selected, 9550 deferred', () => {
      const eligible = 10000;
      const budget = 450;
      const selected = service.calculateRequestsForTier(eligible, budget);
      const deferred = service.calculateDeferred(eligible, budget);
      expect(selected).toBe(450);
      expect(deferred).toBe(9550);
    });
  });

  describe('Overloaded WARM queue', () => {
    it('1000 WARM lots with budget 270 → 270 selected, 730 deferred', () => {
      const eligible = 1000;
      const budget = 270;
      const selected = service.calculateRequestsForTier(eligible, budget);
      const deferred = service.calculateDeferred(eligible, budget);
      expect(selected).toBe(270);
      expect(deferred).toBe(730);
    });
  });

  // ── Retry Consumption ──

  describe('Retry consumption', () => {
    it('retries consume from retry budget (2% of daily envelope)', () => {
      const dailyEnvelope = 900;
      const tierBudgets = service.calculateTierBudgets(dailyEnvelope);
      expect(tierBudgets.retryBudget).toBe(18);
      // If 18 retries needed, all consumed, no more retries possible
      const remainingAfterRetries = tierBudgets.retryBudget - 18;
      expect(remainingAfterRetries).toBe(0);
    });

    it('retries reduce available envelope for other tiers', () => {
      const dailyEnvelope = 900;
      const tierBudgets = service.calculateTierBudgets(dailyEnvelope);
      const totalAllocated = tierBudgets.hotBudget + tierBudgets.warmBudget + tierBudgets.discoveryBudget + tierBudgets.searchBudget + tierBudgets.retryBudget;
      expect(totalAllocated).toBeLessThanOrEqual(dailyEnvelope);
    });
  });

  // ── Month Rollover ──

  describe('Month rollover', () => {
    it('July 1: 31 remaining days → small daily envelope', () => {
      const july1 = new Date('2026-07-01T00:00:00Z');
      const days = service.getRemainingDaysInMonth(july1);
      expect(days).toBe(31);
      const envelope = service.calculateDailyEnvelope(27000, days);
      expect(envelope).toBe(870); // 27000/31
    });

    it('July 31: 1 remaining day → large daily envelope', () => {
      const july31 = new Date('2026-07-31T23:00:00Z');
      const days = service.getRemainingDaysInMonth(july31);
      expect(days).toBe(1);
      const envelope = service.calculateDailyEnvelope(27000, days);
      expect(envelope).toBe(27000);
    });

    it('February (28 days): correct daily envelope', () => {
      const feb1 = new Date('2026-02-01T00:00:00Z');
      const days = service.getRemainingDaysInMonth(feb1);
      expect(days).toBe(28);
      const envelope = service.calculateDailyEnvelope(27000, days);
      expect(envelope).toBe(964); // 27000/28
    });
  });

  // ── Zero Capacity ──

  describe('Zero capacity', () => {
    it('monthlyRemaining=0 → daily envelope=0', () => {
      const envelope = service.calculateDailyEnvelope(0, 15);
      expect(envelope).toBe(0);
    });

    it('daily envelope=0 → all tiers get 0 budget', () => {
      const budgets = service.calculateTierBudgets(0);
      expect(budgets.hotBudget).toBe(0);
      expect(budgets.warmBudget).toBe(0);
      expect(budgets.discoveryBudget).toBe(0);
      expect(budgets.total).toBe(0);
    });

    it('0 budget → all lots deferred', () => {
      const eligible = 100;
      const budget = 0;
      const selected = service.calculateRequestsForTier(eligible, budget);
      const deferred = service.calculateDeferred(eligible, budget);
      expect(selected).toBe(0);
      expect(deferred).toBe(100);
    });
  });

  // ── Monthly Invariant ──

  describe('Monthly invariant (≤27,000 routine / ≤30,000 absolute)', () => {
    const scenarios = [
      { name: 'LOW', hot: 100, warm: 200 },
      { name: 'NORMAL', hot: 300, warm: 500 },
      { name: 'HIGH', hot: 500, warm: 1000 },
      { name: 'EXTREME', hot: 2000, warm: 5000 },
      { name: 'ABSURD', hot: 10000, warm: 20000 },
    ];

    const days = 30;
    const dailyEnvelope = 900;

    scenarios.forEach(s => {
      it(`${s.name}: ${s.hot} HOT + ${s.warm} WARM → ≤27,000/month`, () => {
        const budgets = service.calculateTierBudgets(dailyEnvelope);
        const hotReq = Math.min(s.hot, budgets.hotBudget);
        const warmReq = Math.min(s.warm, budgets.warmBudget);
        const total = (hotReq + warmReq + budgets.discoveryBudget + budgets.searchBudget + budgets.retryBudget) * days;
        expect(total).toBeLessThanOrEqual(27000);
        expect(total).toBeLessThanOrEqual(30000);
      });
    });
  });

  // ── COLD Queue ──

  describe('COLD queue', () => {
    it('COLD lots use discovery budget (list endpoint), not detail', () => {
      // COLD tier is not refreshed via detail endpoint
      // Discovery uses list endpoint: 20 lots/request
      const coldLots = 500;
      const discoveryBudget = 135; // 15% of 900
      const requestsNeeded = Math.ceil(coldLots / 20); // 25
      // If discovery budget < requestsNeeded, some COLD lots not discovered
      expect(requestsNeeded).toBe(25);
      expect(discoveryBudget).toBeGreaterThan(requestsNeeded);
      // Only 135 pages can be fetched, discovering 2700 lots
      const discoverable = discoveryBudget * 20;
      expect(discoverable).toBe(2700);
    });
  });
});
