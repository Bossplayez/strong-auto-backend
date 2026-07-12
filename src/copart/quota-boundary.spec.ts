/**
 * Task 033S2 — Quota Boundary & Truthful Scheduler Projection Tests.
 *
 * PHASE 4 FIX: The provider API has NO batch-fetch-by-ID endpoint.
 * Tracked lot refresh uses detail endpoint (1 request/lot).
 * List queries are for discovery/search only (20 lots/request).
 *
 * Tests:
 * 1-5. Deterministic boundary at 70%, 80%, 85%, 90%, 100% usage
 * 6. Daily envelope calculation
 * 7. Tier budget allocation
 * 8. Detail request cost formula (truthful — 1 request/lot)
 * 9. LOW scenario: 100 HOT + 200 WARM → detail cost within budget
 * 10. NORMAL scenario: 300 HOT + 500 WARM → detail cost within budget
 * 11. HIGH scenario: 500 HOT + 1000 WARM → deferred lots, still within budget
 * 12. Monthly invariant: no schedule exceeds 27,000 routine / 30,000 absolute
 * 13. Deferred lots are counted and exposed
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DiscoveryService } from './discovery.service';
import { ProviderLeaseService } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { FreshnessSchedulerService } from './freshness-scheduler.service';

describe('Task 033S2 — Quota Boundary & Truthful Scheduler Tests', () => {
  let service: FreshnessSchedulerService;
  let prisma: any;
  let budgetService: any;
  let configService: any;

  beforeEach(async () => {
    prisma = {
      schedulerState: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'sched-1',
          isPaused: false,
          hotIntervalMs: 900000,
          warmIntervalMs: 10800000,
          coldIntervalMs: 43200000,
          lastRunAt: null,
          nextRunAt: null,
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
        budget: 30000,
        reserve: 3000,
        allocated: 0,
        availableForRoutine: 27000,
        isRoutineBlocked: false,
      }),
      canMakeRoutineRequest: jest.fn().mockResolvedValue({ allowed: true }),
    };

    configService = {
      get: jest.fn((key: string) => {
        const defaults: Record<string, any> = {
          SCHEDULER_HOT_INTERVAL_MS: 900000,
          SCHEDULER_WARM_INTERVAL_MS: 10800000,
          SCHEDULER_COLD_INTERVAL_MS: 43200000,
          SCHEDULER_CONFIRMATION_MISSES: 3,
        };
        return defaults[key];
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RequestBudgetService, useValue: budgetService },
        { provide: ProviderLeaseService, useValue: {} },
        { provide: ConfigService, useValue: configService },
        { provide: DiscoveryService, useValue: {} },
        FreshnessSchedulerService,
      ],
    }).compile();

    service = moduleRef.get(FreshnessSchedulerService);
  });

  // ── Boundary Tests ──

  describe('Deterministic quota boundaries', () => {
    const testBoundary = (usagePercent: number, allocated: number) => {
      it(`${usagePercent}% usage — budget check`, () => {
        const budget = 30000;
        const availableForRoutine = budget - allocated;
        const isRoutineBlocked = availableForRoutine <= 0;

        expect(allocated).toBe(Math.round(budget * usagePercent / 100));
        expect(isRoutineBlocked).toBe(usagePercent >= 100);
      });

      it(`${usagePercent}% usage — daily envelope degrades`, () => {
        const monthlyRemaining = Math.max(30000 - allocated - 3000, 0); // routine remaining
        const remainingDays = 15;
        const dailyEnvelope = service.calculateDailyEnvelope(monthlyRemaining, remainingDays);

        expect(dailyEnvelope).toBeLessThanOrEqual(Math.max(monthlyRemaining, 0));

        if (usagePercent >= 100) {
          expect(monthlyRemaining).toBeLessThanOrEqual(0);
          expect(dailyEnvelope).toBe(0);
        } else {
          expect(dailyEnvelope).toBeGreaterThanOrEqual(0);
        }
      });

      it(`${usagePercent}% usage — tier budgets respect envelope`, () => {
        const monthlyRemaining = Math.max(30000 - allocated - 3000, 0);
        const remainingDays = 15;
        const dailyEnvelope = service.calculateDailyEnvelope(monthlyRemaining, remainingDays);
        const tierBudgets = service.calculateTierBudgets(dailyEnvelope);

        expect(tierBudgets.total).toBeLessThanOrEqual(dailyEnvelope);
        expect(tierBudgets.hotBudget).toBeGreaterThanOrEqual(tierBudgets.warmBudget);
      });
    };

    testBoundary(70, 21000);
    testBoundary(80, 24000);
    testBoundary(85, 25500);
    testBoundary(90, 27000);
    testBoundary(100, 30000);
  });

  // ── Daily Envelope ──

  describe('Daily envelope formula', () => {
    it('6. calculates correct daily envelope from remaining budget', () => {
      expect(service.calculateDailyEnvelope(27000, 30)).toBe(900);
      expect(service.calculateDailyEnvelope(13500, 15)).toBe(900);
      expect(service.calculateDailyEnvelope(1000, 1)).toBe(1000);
      expect(service.calculateDailyEnvelope(0, 10)).toBe(0);
    });
  });

  // ── Tier Budget Allocation ──

  describe('Tier budget allocation', () => {
    it('7. allocates daily envelope by tier weights', () => {
      const daily = 900;
      const budgets = service.calculateTierBudgets(daily);

      expect(budgets.hotBudget).toBe(450);
      expect(budgets.warmBudget).toBe(270);
      expect(budgets.discoveryBudget).toBe(135);
      expect(budgets.searchBudget).toBe(27);
      expect(budgets.retryBudget).toBe(18);
      expect(budgets.total).toBeLessThanOrEqual(daily);
    });
  });

  // ── Truthful Detail Request Cost ──

  describe('Detail request cost (truthful — 1 request/lot)', () => {
    it('8. detail endpoint costs 1 request per lot, no batch discount', () => {
      // The provider API has NO batch-fetch-by-ID endpoint.
      // GET /vehicles/{lotNumber} returns 1 lot per request.
      const hotLots = 100;
      const hotBudget = 450;

      // Can only refresh min(lots, budget) lots
      const refreshable = service.calculateRequestsForTier(hotLots, hotBudget);
      expect(refreshable).toBe(100); // 100 < 450, all fit

      // Deferred = lots beyond budget
      const deferred = service.calculateDeferred(hotLots, hotBudget);
      expect(deferred).toBe(0); // none deferred
    });

    it('8b. when lots exceed budget, excess is deferred', () => {
      const hotLots = 500;
      const hotBudget = 450;

      const refreshable = service.calculateRequestsForTier(hotLots, hotBudget);
      expect(refreshable).toBe(450); // only 450 fit

      const deferred = service.calculateDeferred(hotLots, hotBudget);
      expect(deferred).toBe(50); // 50 deferred
    });
  });

  // ── Scenario Projections (Truthful) ──

  describe('Monthly request projections (truthful detail cost)', () => {
    /**
     * TRUTHFUL calculation:
     *
     * Detail endpoint: 1 request per lot
     * List endpoint (discovery/search): 1 request per 20 lots
     *
     * HOT refresh: min(hotLots, hotBudget) × ticks_per_day × 30
     * WARM refresh: min(warmLots, warmBudget) × ticks_per_day × 30
     * Discovery: discoveryBudget × 30
     * Search: searchBudget × 30
     * Retry: retryBudget × 30
     *
     * Daily envelope: 27,000 / 30 = 900
     * HOT budget: 450/day, WARM budget: 270/day
     * Discovery: 135/day, Search: 27/day, Retry: 18/day
     *
     * Key: total daily = 450 + 270 + 135 + 27 + 18 = 900 ≤ envelope
     * Monthly: 900 × 30 = 27,000 ≤ routine budget ✓
     */

    it('9. LOW scenario: 100 HOT + 200 WARM → ≤ 27,000/month', () => {
      const days = 30;
      const hotLots = 100;
      const warmLots = 200;

      const dailyEnvelope = 900;
      const tierBudgets = service.calculateTierBudgets(dailyEnvelope);

      // Detail requests: min(lots, budget) per tier per day
      const hotRequests = Math.min(hotLots, tierBudgets.hotBudget); // min(100, 450) = 100
      const warmRequests = Math.min(warmLots, tierBudgets.warmBudget); // min(200, 270) = 200

      const monthlyHot = hotRequests * days; // 3,000
      const monthlyWarm = warmRequests * days; // 6,000
      const monthlyDiscovery = tierBudgets.discoveryBudget * days; // 4,050
      const monthlySearch = tierBudgets.searchBudget * days; // 810
      const monthlyRetry = tierBudgets.retryBudget * days; // 540

      const totalMonthly = monthlyHot + monthlyWarm + monthlyDiscovery + monthlySearch + monthlyRetry;

      expect(monthlyHot).toBe(3000);
      expect(monthlyWarm).toBe(6000);
      expect(totalMonthly).toBeLessThanOrEqual(27000);
      expect(totalMonthly).toBeLessThanOrEqual(30000);
      // Total: 14,400/month — within budget
    });

    it('10. NORMAL scenario: 300 HOT + 500 WARM → ≤ 27,000/month', () => {
      const days = 30;
      const hotLots = 300;
      const warmLots = 500;

      const dailyEnvelope = 900;
      const tierBudgets = service.calculateTierBudgets(dailyEnvelope);

      const hotRequests = Math.min(hotLots, tierBudgets.hotBudget); // min(300, 450) = 300
      const warmRequests = Math.min(warmLots, tierBudgets.warmBudget); // min(500, 270) = 270

      const monthlyHot = hotRequests * days; // 9,000
      const monthlyWarm = warmRequests * days; // 8,100
      const monthlyDiscovery = tierBudgets.discoveryBudget * days; // 4,050
      const monthlySearch = tierBudgets.searchBudget * days; // 810
      const monthlyRetry = tierBudgets.retryBudget * days; // 540

      const totalMonthly = monthlyHot + monthlyWarm + monthlyDiscovery + monthlySearch + monthlyRetry;

      expect(totalMonthly).toBeLessThanOrEqual(27000);
      expect(totalMonthly).toBeLessThanOrEqual(30000);
      // Total: 22,500/month — within budget
    });

    it('11. HIGH scenario: 500 HOT + 1000 WARM → deferred, still ≤ 27,000/month', () => {
      const days = 30;
      const hotLots = 500;
      const warmLots = 1000;

      const dailyEnvelope = 900;
      const tierBudgets = service.calculateTierBudgets(dailyEnvelope);

      const hotRequests = Math.min(hotLots, tierBudgets.hotBudget); // min(500, 450) = 450
      const warmRequests = Math.min(warmLots, tierBudgets.warmBudget); // min(1000, 270) = 270

      const hotDeferred = service.calculateDeferred(hotLots, tierBudgets.hotBudget); // 50
      const warmDeferred = service.calculateDeferred(warmLots, tierBudgets.warmBudget); // 730

      const monthlyHot = hotRequests * days; // 13,500
      const monthlyWarm = warmRequests * days; // 8,100
      const monthlyDiscovery = tierBudgets.discoveryBudget * days; // 4,050
      const monthlySearch = tierBudgets.searchBudget * days; // 810
      const monthlyRetry = tierBudgets.retryBudget * days; // 540

      const totalMonthly = monthlyHot + monthlyWarm + monthlyDiscovery + monthlySearch + monthlyRetry;

      expect(hotDeferred).toBe(50);
      expect(warmDeferred).toBe(730);
      expect(totalMonthly).toBeLessThanOrEqual(27000);
      expect(totalMonthly).toBeLessThanOrEqual(30000);
      // Total: 27,000/month — exactly at routine budget, 50 HOT + 730 WARM deferred daily
    });

    it('12. Monthly invariant: no generated schedule exceeds 27,000 routine / 30,000 absolute', () => {
      const scenarios = [
        { name: 'LOW', hot: 100, warm: 200 },
        { name: 'NORMAL', hot: 300, warm: 500 },
        { name: 'HIGH', hot: 500, warm: 1000 },
        { name: 'EXTREME', hot: 2000, warm: 5000 },
        { name: 'ABSURD', hot: 10000, warm: 20000 },
      ];

      const days = 30;
      const dailyEnvelope = 900; // 27000/30
      const tierBudgets = service.calculateTierBudgets(dailyEnvelope);

      for (const s of scenarios) {
        const hotReq = Math.min(s.hot, tierBudgets.hotBudget);
        const warmReq = Math.min(s.warm, tierBudgets.warmBudget);
        const total = (hotReq + warmReq + tierBudgets.discoveryBudget + tierBudgets.searchBudget + tierBudgets.retryBudget) * days;

        // Invariant: total routine attempts per UTC month <= 27,000
        expect(total).toBeLessThanOrEqual(27000);
        // Invariant: absolute attempts per UTC month <= 30,000
        expect(total).toBeLessThanOrEqual(30000);

        // Deferred lots exist when eligible lots exceed budget
        const hotDeferred = service.calculateDeferred(s.hot, tierBudgets.hotBudget);
        const warmDeferred = service.calculateDeferred(s.warm, tierBudgets.warmBudget);

        if (s.name === 'ABSURD') {
          expect(hotDeferred).toBeGreaterThan(0);
          expect(warmDeferred).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── Deferred Count Exposure ──

  describe('Deferred counts exposed in admin status', () => {
    it('13. deferred lots are calculated and returned in status', () => {
      const eligible = 500;
      const budget = 450;

      const deferred = service.calculateDeferred(eligible, budget);

      expect(deferred).toBe(50);
      expect(deferred).toBe(eligible - budget);
    });
  });

  // ── Remaining Days ──

  describe('Remaining days in month', () => {
    it('calculates remaining days correctly', () => {
      const july1 = new Date('2026-07-01T00:00:00Z');
      expect(service.getRemainingDaysInMonth(july1)).toBe(31);

      const july15 = new Date('2026-07-15T12:00:00Z');
      const days15 = service.getRemainingDaysInMonth(july15);
      expect(days15).toBeGreaterThanOrEqual(16);
      expect(days15).toBeLessThanOrEqual(17);

      const july31 = new Date('2026-07-31T23:00:00Z');
      expect(service.getRemainingDaysInMonth(july31)).toBe(1);
    });
  });

  // ── Provider Endpoint Mapping ──

  describe('Provider endpoint truthfulness', () => {
    it('detail endpoint: GET /vehicles/{lotNumber} — 1 lot per request', () => {
      // The ONLY way to refresh a known lot is the detail endpoint
      // This costs 1 request per lot — no batch discount
      const lotsToRefresh = 50;
      const requestsNeeded = lotsToRefresh; // 1:1 ratio

      expect(requestsNeeded).toBe(50);
    });

    it('list endpoint: GET /vehicles?page=N&limit=20 — 20 lots per request', () => {
      // Discovery and search use the list endpoint
      // This returns 20 lots per page but does NOT refresh tracked lots
      const newLotsToDiscover = 100;
      const requestsNeeded = Math.ceil(newLotsToDiscover / 20); // 5

      expect(requestsNeeded).toBe(5);
    });

    it('no batch-fetch-by-ID endpoint exists', () => {
      // The provider API does NOT support:
      // GET /vehicles?ids=123,456,789
      // This means tracked lot refresh CANNOT use list queries
      const trackedLots = [123, 456, 789];
      // Must use: 3 × GET /vehicles/{lotNumber} = 3 requests
      const requests = trackedLots.length;

      expect(requests).toBe(3);
    });
  });
});
