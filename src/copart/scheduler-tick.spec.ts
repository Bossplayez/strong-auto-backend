/**
 * Task 040 — Focused tests for the unified tick dispatcher.
 *
 * Verifies pacing, provider fairness, budget gate, and real results.
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FreshnessSchedulerService } from './freshness-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestBudgetService } from './request-budget.service';
import { DiscoveryService } from './discovery.service';
import { ProviderLeaseService } from './provider-lease.service';
import { Logger } from '@nestjs/common';

function makeBudgetSnapshot(overrides: Partial<any> = {}) {
  return {
    billingMonth: '2026-07',
    budget: 30000,
    reserve: 3000,
    allocated: 100,
    confirmed: 90,
    completedSuccess: 80,
    failureCounts: { timeout: 0, rateLimit: 0, server: 0, network: 0, client: 0 },
    quotaRemaining: null,
    quotaResetEpochMs: null,
    unresolved: 0,
    availableForRoutine: 26900,
    percentageUsed: 0.33,
    isWarning: false,
    isRoutineBlocked: false,
    isAbsoluteBlocked: false,
    providers: [],
    dailyCap: 900,
    dailyUsed: 0,
    dailyRemaining: 900,
    dailyUtcBoundary: new Date(Date.UTC(2026, 6, 17)).toISOString(),
    routineAllocatedToday: 0,
    manualAllocatedToday: 0,
    remainingUtcDays: 15,
    dailyBlockReason: null,
    ...overrides,
  };
}

describe('FreshnessSchedulerService tick (Task 040)', () => {
  let service: FreshnessSchedulerService;
  let prisma: any;
  let budgetService: any;
  let discoveryService: any;
  let leaseService: any;

  beforeEach(async () => {
    prisma = {
      schedulerState: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sch-1',
          isPaused: false,
          hotIntervalMs: 300000,
          warmIntervalMs: 600000,
          coldIntervalMs: 3600000,
          lastRunAt: null,
          nextRunAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'sch-1' }),
      },
      discoveredLot: { count: jest.fn().mockResolvedValue(0) },
      discoveryCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
    };

    budgetService = {
      getUsage: jest.fn().mockResolvedValue(makeBudgetSnapshot()),
    };

    discoveryService = {
      runDiscovery: jest.fn().mockResolvedValue({
        provider: 'copart',
        queryFingerprint: 'fp_test',
        pagesCompleted: 1,
        lotsDiscovered: 20,
        lotsUpdated: 5,
        newLots: 15,
        lotsObserved: 20,
        lotsPersisted: 20,
        checkpointAdvanced: true,
        exhausted: false,
        terminalReason: 'completed',
        nextPage: null,
        errors: [],
      }),
    };

    leaseService = {
      getState: jest.fn().mockResolvedValue({
        provider: 'copart',
        fencingToken: 1,
        acquiredAt: new Date(),
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        isExpired: false,
        importJobId: null,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FreshnessSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: RequestBudgetService, useValue: budgetService },
        { provide: DiscoveryService, useValue: discoveryService },
        { provide: ProviderLeaseService, useValue: leaseService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              const map: Record<string, any> = {
                SCHEDULER_ENABLED: false,
                SCHEDULER_TICK_INTERVAL_MS: 300000,
                SCHEDULER_HOT_INTERVAL_MS: 300000,
                SCHEDULER_WARM_INTERVAL_MS: 600000,
                SCHEDULER_COLD_INTERVAL_MS: 3600000,
              };
              return map[key] ?? defaultValue;
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(FreshnessSchedulerService);
  });

  it('T1. tick returns zero results when budget is blocked', async () => {
    budgetService.getUsage.mockResolvedValue(
      makeBudgetSnapshot({ isRoutineBlocked: true, dailyRemaining: 0, dailyBlockReason: 'daily_routine_cap_reached' }),
    );
    const result = await service.tick();
    expect(result.processed).toBe(0);
    expect(result.requestsUsed).toBe(0);
    expect(result.errors).toContain('budget_blocked:daily_routine_cap_reached');
    expect(discoveryService.runDiscovery).not.toHaveBeenCalled();
  });

  it('T2. tick processes providers and returns real page/lot counts', async () => {
    const result = await service.tick();
    expect(result.processed).toBeGreaterThan(0);
    expect(result.requestsUsed).toBeGreaterThan(0);
    expect(discoveryService.runDiscovery).toHaveBeenCalled();
  });

  it('T3. tick does not exceed 4 pages per tick', async () => {
    // Override budget to have high dailyUsed so pacing allows max tickPages
    budgetService.getUsage.mockResolvedValue(
      makeBudgetSnapshot({ dailyUsed: 800, dailyRemaining: 100 }),
    );
    await service.tick();
    const calls = discoveryService.runDiscovery.mock.calls;
    const totalPages = calls.reduce((sum: number, [, pages]: any) => sum + pages, 0);
    expect(totalPages).toBeLessThanOrEqual(4);
  });

  it('T4. one provider failure does not block the other', async () => {
    discoveryService.runDiscovery
      .mockRejectedValueOnce(new Error('Copart down'))
      .mockResolvedValueOnce({
        provider: 'iaai',
        queryFingerprint: 'fp_iaai',
        pagesCompleted: 1,
        lotsDiscovered: 20,
        lotsUpdated: 10,
        newLots: 10,
        lotsObserved: 20,
        lotsPersisted: 20,
        checkpointAdvanced: true,
        exhausted: false,
        terminalReason: 'completed',
        nextPage: null,
        errors: [],
      });

    const result = await service.tick();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Copart down');
    // IAAI still processed
    expect(result.processed).toBe(20);
    expect(result.requestsUsed).toBe(1);
  });

  it('T5. exhausted provider lends remaining pages to the other', async () => {
    // Copart completes 0 pages (lease held), IAAI should get the extra page
    discoveryService.runDiscovery
      .mockResolvedValueOnce({
        provider: 'copart',
        queryFingerprint: 'fp_copart',
        pagesCompleted: 0,
        lotsDiscovered: 0,
        lotsUpdated: 0,
        newLots: 0,
        lotsObserved: 0,
        lotsPersisted: 0,
        checkpointAdvanced: false,
        exhausted: false,
        terminalReason: 'lease_held',
        nextPage: null,
        errors: ['Provider lease is held by another owner'],
      })
      .mockResolvedValueOnce({
        provider: 'iaai',
        queryFingerprint: 'fp_iaai',
        pagesCompleted: 1,
        lotsDiscovered: 20,
        lotsUpdated: 5,
        newLots: 15,
        lotsObserved: 20,
        lotsPersisted: 20,
        checkpointAdvanced: true,
        exhausted: false,
        terminalReason: 'completed',
        nextPage: null,
        errors: [],
      });

    const result = await service.tick();
    // Both providers were called
    expect(discoveryService.runDiscovery).toHaveBeenCalledTimes(2);
  });

  it('T6. paused scheduler returns zero results', async () => {
    prisma.schedulerState.findFirst.mockResolvedValue({
      id: 'sch-1',
      isPaused: true,
      hotIntervalMs: 300000,
      warmIntervalMs: 600000,
      coldIntervalMs: 3600000,
      lastRunAt: null,
      nextRunAt: null,
    });
    const result = await service.tick();
    expect(result.processed).toBe(0);
    expect(result.requestsUsed).toBe(0);
    expect(discoveryService.runDiscovery).not.toHaveBeenCalled();
  });

  it('T7. status exposes daily cap fields from the ledger', async () => {
    const status = await service.getStatus();
    expect(status).toHaveProperty('dailyCap');
    expect(status).toHaveProperty('dailyRemaining');
    expect(status).toHaveProperty('dailyUtcBoundary');
    expect(status).toHaveProperty('routineAllocatedToday');
    expect(status).toHaveProperty('manualAllocatedToday');
    expect(status).toHaveProperty('dailyBlockReason');
    expect(status.dailyCap).toBe(900);
    expect(status.dailyRemaining).toBe(900);
  });
});
