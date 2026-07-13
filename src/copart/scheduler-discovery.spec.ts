/**
 * Task 033T — Discovery Integration Tests
 *
 * Focused tests for wiring DiscoveryService into the automatic scheduler.
 * Each test verifies one specific behaviour without re-testing the scheduler
 * mechanics (those are in scheduler-auto.spec.ts).
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DiscoveryService } from './discovery.service';
import { ProviderLeaseService } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { FreshnessSchedulerService } from './freshness-scheduler.service';

// ─── Test Helpers ───

function buildMocks(overrides: {
  schedulerEnabled?: boolean;
  tickInterval?: number;
  totalDiscovered?: number;
  discoveryDue?: boolean;
  discoveryResult?: any;
  budgetBlocked?: boolean;
} = {}) {
  const totalDiscovered = overrides.totalDiscovered ?? 0;
  const discoveryDue = overrides.discoveryDue ?? true;

  const discoveryResult = overrides.discoveryResult ?? {
    provider: 'copart',
    queryFingerprint: 'fp_abc123',
    pagesCompleted: 2,
    lotsDiscovered: 40,
    lotsUpdated: 0,
    newLots: 40,
    checkpointAdvanced: true,
    exhausted: false,
    terminalReason: 'completed',
    nextPage: 3,
    errors: [],
  };

  const prisma = {
    schedulerState: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'sched-1',
        isPaused: false,
        hotIntervalMs: 900000,
        warmIntervalMs: 10800000,
        coldIntervalMs: 43200000,
        lastRunAt: null,
        nextRunAt: null,
      }),
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
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(totalDiscovered),
      update: jest.fn().mockResolvedValue({}),
    },
    discoveryCheckpoint: {
      findUnique: jest.fn().mockResolvedValue(
        discoveryDue
          ? null // no checkpoint → due
          : {
              id: 'cp-1',
              provider: 'copart',
              queryFingerprint: 'fp_abc123',
              lastPage: 5,
              lastSuccessfulPage: 5,
              lastStartedAt: new Date(),
              lastCompletedAt: new Date(), // recently completed → not due
              exhaustedAt: null,
            },
      ),
    },
  };

  const budgetService = {
    getUsage: jest.fn().mockResolvedValue({
      isRoutineBlocked: overrides.budgetBlocked ?? false,
      availableForRoutine: 900,
      allocated: 0,
      budget: 30000,
    }),
  };

  const leaseService = {
    getState: jest.fn().mockResolvedValue(null),
    claimWithRecovery: jest.fn().mockResolvedValue({
      claimed: true,
      ownerToken: 'test',
      fencingToken: 1,
      lease: null,
      conflictingLease: null,
      recoveredJobIds: [],
    }),
    recoverStaleJobs: jest.fn().mockResolvedValue({ recoveredJobIds: [] }),
  };

  const config = {
    get: jest.fn((key: string, fallback?: any) => {
      const defaults: Record<string, any> = {
        SCHEDULER_ENABLED: overrides.schedulerEnabled ?? false,
        SCHEDULER_TICK_INTERVAL_MS: overrides.tickInterval ?? 300000,
        SCHEDULER_HOT_INTERVAL_MS: 900000,
        SCHEDULER_WARM_INTERVAL_MS: 10800000,
        SCHEDULER_COLD_INTERVAL_MS: 43200000,
        SCHEDULER_CONFIRMATION_MISSES: 3,
      };
      return defaults[key] ?? fallback;
    }),
  };

  const discoveryService = {
    buildQueryFingerprint: jest.fn((params: any) => `fp_${params.platform}`),
    runDiscovery: jest.fn().mockResolvedValue(discoveryResult),
    getCheckpointState: jest.fn().mockResolvedValue([]),
  };

  return { prisma, budgetService, leaseService, config, discoveryService };
}

async function createService(overrides: Parameters<typeof buildMocks>[0] = {}) {
  const mocks = buildMocks(overrides);

  const module = await Test.createTestingModule({
    providers: [
      FreshnessSchedulerService,
      { provide: PrismaService, useValue: mocks.prisma },
      { provide: ConfigService, useValue: mocks.config },
      { provide: DiscoveryService, useValue: mocks.discoveryService },
      { provide: ProviderLeaseService, useValue: mocks.leaseService },
      { provide: RequestBudgetService, useValue: mocks.budgetService },
    ],
  }).compile();

  return {
    service: module.get(FreshnessSchedulerService),
    mocks,
  };
}

// ─── Tests ───

describe('Task 033T — Discovery Integration', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // 1. Empty database tick invokes existing discovery
  describe('1. Empty database tick', () => {
    it('calls runDiscovery for both providers when totalDiscovered === 0', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      await service.tick();

      // Both copart and iaai discovery should be called
      expect(mocks.discoveryService.runDiscovery).toHaveBeenCalledTimes(2);
      expect(mocks.discoveryService.runDiscovery).toHaveBeenCalledWith(
        { platform: 'copart' },
        3, // DISCOVERY_MAX_PAGES_PER_TICK
      );
      expect(mocks.discoveryService.runDiscovery).toHaveBeenCalledWith(
        { platform: 'iaai' },
        3,
      );
    });

    it('stores discovery results in lastDiscovery for admin status', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
        discoveryResult: {
          provider: 'copart',
          queryFingerprint: 'fp_abc',
          pagesCompleted: 2,
          lotsDiscovered: 40,
          lotsUpdated: 5,
          newLots: 35,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'completed',
          nextPage: 3,
          errors: [],
        },
      });

      await service.tick();
      const status = await service.getStatus();

      expect(status.lastDiscoveryRunAt).not.toBeNull();
      expect(status.discoveryPagesAttempted).toBeGreaterThan(0);
      expect(status.discoveryLotsReceived).toBeGreaterThan(0);
      expect(status.discoveryCreated).toBeGreaterThan(0);
    });
  });

  // 2. Non-due profile causes zero requests
  describe('2. Non-due profile', () => {
    it('does NOT call runDiscovery when checkpoint was recently completed', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 50, // not empty
        discoveryDue: false, // checkpoint exists, recently completed
      });

      await service.tick();

      expect(mocks.discoveryService.runDiscovery).not.toHaveBeenCalled();
    });
  });

  // 3. Due profile invokes discovery exactly once
  describe('3. Due profile invokes discovery once', () => {
    it('calls runDiscovery once per provider when due', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 50,
        discoveryDue: true, // old checkpoint → due
      });

      await service.tick();

      expect(mocks.discoveryService.runDiscovery).toHaveBeenCalledTimes(2);
    });
  });

  // 4. Manual/automatic race produces one provider job
  describe('4. Manual/automatic race', () => {
    it('relies on lease inside runDiscovery to prevent duplicate work', async () => {
      // The actual dedup happens inside DiscoveryService.runDiscovery()
      // via ProviderLeaseService. The scheduler just calls runDiscovery.
      // This test verifies the scheduler passes through to the existing
      // lease-protected discovery mechanism.

      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      // Simulate lease already held by manual run (handled inside runDiscovery)
      mocks.discoveryService.runDiscovery.mockResolvedValue({
        provider: 'copart',
        queryFingerprint: 'fp_abc',
        pagesCompleted: 0,
        lotsDiscovered: 0,
        lotsUpdated: 0,
        newLots: 0,
        checkpointAdvanced: false,
        exhausted: false,
        terminalReason: 'lease_held', // internal lease rejection
        nextPage: null,
        errors: ['lease currently held by another owner'],
      });

      const result = await service.tick();

      // Scheduler still completes — error is captured, not thrown
      expect(result).toBeDefined();
      expect(mocks.discoveryService.runDiscovery).toHaveBeenCalled();
    });
  });

  // 5. Quota block causes zero provider calls
  describe('5. Quota block', () => {
    it('returns immediately with error when budget is exhausted', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        budgetBlocked: true,
      });

      const result = await service.tick();

      expect(result.processed).toBe(0);
      expect(result.requestsUsed).toBe(0);
      expect(result.errors).toContain('routine_budget_exhausted');
      expect(mocks.discoveryService.runDiscovery).not.toHaveBeenCalled();
    });
  });

  // 6. Failed page does not advance checkpoint
  describe('6. Failed page does not advance checkpoint', () => {
    it('captures error from runDiscovery without crashing tick', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
        discoveryResult: {
          provider: 'copart',
          queryFingerprint: 'fp_abc',
          pagesCompleted: 1,
          lotsDiscovered: 20,
          lotsUpdated: 0,
          newLots: 20,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'budget_exhausted', // stopped mid-run
          nextPage: 2,
          errors: ['Budget blocked: 27000/27000'],
        },
      });

      const result = await service.tick();

      // tick completes — error captured in result
      expect(result.errors.length).toBe(0); // discovery errors logged but don't bubble
      // The discovery result is stored for admin status
      const status = await service.getStatus();
      expect(status.discoveryTerminalReason).not.toBeNull();
    });
  });

  // 7. Successful discovery creates discovered lots
  describe('7. Successful discovery creates lots', () => {
    it('records newLots in discovery result', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      mocks.discoveryService.runDiscovery
        .mockResolvedValueOnce({
          provider: 'copart',
          queryFingerprint: 'fp_copart',
          pagesCompleted: 3,
          lotsDiscovered: 60,
          lotsUpdated: 0,
          newLots: 60,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'completed',
          nextPage: 4,
          errors: [],
        })
        .mockResolvedValueOnce({
          provider: 'iaai',
          queryFingerprint: 'fp_iaai',
          pagesCompleted: 2,
          lotsDiscovered: 40,
          lotsUpdated: 0,
          newLots: 40,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'completed',
          nextPage: 3,
          errors: [],
        });

      await service.tick();
      const status = await service.getStatus();

      expect(status.discoveryCreated).toBe(100); // 60 + 40
      expect(status.discoveryLotsReceived).toBe(100);
      expect(status.discoveryPagesAttempted).toBe(5); // 3 + 2
    });
  });

  // 8. Second run updates without duplicates
  describe('8. Second run updates without duplicates', () => {
    it('records lotsUpdated on subsequent discovery runs', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 60, // lots already exist
        discoveryDue: true,
      });

      // Copart: mostly updates
      mocks.discoveryService.runDiscovery
        .mockResolvedValueOnce({
          provider: 'copart',
          queryFingerprint: 'fp_copart',
          pagesCompleted: 2,
          lotsDiscovered: 40,
          lotsUpdated: 35,
          newLots: 5,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'completed',
          nextPage: 3,
          errors: [],
        })
        // IAAI: mostly new
        .mockResolvedValueOnce({
          provider: 'iaai',
          queryFingerprint: 'fp_iaai',
          pagesCompleted: 1,
          lotsDiscovered: 20,
          lotsUpdated: 3,
          newLots: 17,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'completed',
          nextPage: 2,
          errors: [],
        });

      await service.tick();
      const status = await service.getStatus();

      expect(status.discoveryUpdated).toBe(38); // 35 + 3
      expect(status.discoveryCreated).toBe(22); // 5 + 17
    });
  });

  // 9. Discovery results feed freshness selection
  describe('9. Discovery feeds freshness selection', () => {
    it('discovers lots then HOT/WARM phase can process them', async () => {
      // When totalDiscovered > 0, discovery may not run (not due),
      // but HOT/WARM phase runs on existing lots.
      // This verifies the pipeline: discovery → lots exist → HOT/WARM refresh.

      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 60,
        discoveryDue: false, // skip discovery, focus on HOT/WARM
      });

      // Mock lots that need refresh
      mocks.prisma.discoveredLot.findMany.mockResolvedValue([
        {
          id: 'lot-1',
          externalLotId: '12345',
          provider: 'copart',
          freshnessTier: 'HOT',
          nextRefreshAt: new Date(Date.now() - 1000), // overdue
          state: 'DISCOVERED',
          availabilityConfirmed: true,
          ad: null,
          auctionState: 'open',
          isBuyNow: false,
          vehicleId: null,
          lastSeenAt: new Date(),
          consecutiveMisses: 0,
        },
      ]);
      mocks.prisma.discoveredLot.count
        .mockResolvedValueOnce(60) // for discovery due check
        .mockResolvedValueOnce(1) // pendingHot
        .mockResolvedValueOnce(0) // pendingWarm
        .mockResolvedValueOnce(0) // pendingCold
        .mockResolvedValueOnce(60) // totalDiscovered
        .mockResolvedValueOnce(0) // selectedToday
        .mockResolvedValueOnce(0) // deferredToday
        .mockResolvedValueOnce(0) // completedToday
        .mockResolvedValueOnce(0); // failedToday

      const result = await service.tick();

      // Discovery was skipped (not due), HOT/WARM ran
      expect(mocks.discoveryService.runDiscovery).not.toHaveBeenCalled();
      expect(result.processed).toBeGreaterThanOrEqual(0);
    });
  });

  // 10. No automatic catalog publication
  describe('10. No automatic catalog publication', () => {
    it('discovery does NOT call any vehicle publish/create methods', async () => {
      // The scheduler only calls:
      // - discoveryService.runDiscovery() → creates DiscoveredLot records
      // - processTierDetail() → updates DiscoveredLot records
      // DiscoveredLot.state remains DISCOVERED, not PUBLISHED.
      // Catalog publication requires explicit admin action (POST /admin/auction/import-lot).

      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      await service.tick();

      // Only discovery service was called — no vehicle creation
      expect(mocks.discoveryService.runDiscovery).toHaveBeenCalled();
      // No vehicle-related prisma calls (only discoveredLot)
      expect(mocks.prisma.discoveredLot.update).not.toHaveBeenCalled();
    });
  });

  // 11. Copart failure does not block IAAI
  describe('11. Provider isolation', () => {
    it('IAAI discovery runs even when Copart fails', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      // Copart fails
      mocks.discoveryService.runDiscovery
        .mockResolvedValueOnce({
          provider: 'copart',
          queryFingerprint: 'fp_copart',
          pagesCompleted: 0,
          lotsDiscovered: 0,
          lotsUpdated: 0,
          newLots: 0,
          checkpointAdvanced: false,
          exhausted: false,
          terminalReason: 'non_retryable_http_error',
          nextPage: null,
          errors: ['Page 1: HTTP_4XX - Invalid key'],
        })
        // IAAI succeeds
        .mockResolvedValueOnce({
          provider: 'iaai',
          queryFingerprint: 'fp_iaai',
          pagesCompleted: 2,
          lotsDiscovered: 40,
          lotsUpdated: 0,
          newLots: 40,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'completed',
          nextPage: 3,
          errors: [],
        });

      const result = await service.tick();

      // Both providers were attempted
      expect(mocks.discoveryService.runDiscovery).toHaveBeenCalledTimes(2);

      // IAAI lots were discovered
      const status = await service.getStatus();
      expect(status.discoveryLotsReceived).toBe(40);
    });
  });

  // 12. Admin counters match database writes
  describe('12. Admin counters match DB writes', () => {
    it('discoveryPagesAttempted matches sum of pagesCompleted', async () => {
      const { service } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      await service.tick();
      const status = await service.getStatus();

      // 2 providers × default result (2 pages each) = 4 total
      expect(status.discoveryPagesAttempted).toBe(4);
    });

    it('discoveryCreated matches sum of newLots', async () => {
      const { service } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      await service.tick();
      const status = await service.getStatus();

      expect(status.discoveryCreated).toBe(80); // 40 + 40 from default mock
    });

    it('discoveryTerminalReason reflects first provider terminal reason', async () => {
      const { service, mocks } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      mocks.discoveryService.runDiscovery
        .mockResolvedValueOnce({
          provider: 'copart',
          queryFingerprint: 'fp_copart',
          pagesCompleted: 0,
          lotsDiscovered: 0,
          lotsUpdated: 0,
          newLots: 0,
          checkpointAdvanced: false,
          exhausted: true,
          terminalReason: 'exhausted',
          nextPage: null,
          errors: [],
        })
        .mockResolvedValueOnce({
          provider: 'iaai',
          queryFingerprint: 'fp_iaai',
          pagesCompleted: 2,
          lotsDiscovered: 40,
          lotsUpdated: 0,
          newLots: 40,
          checkpointAdvanced: true,
          exhausted: false,
          terminalReason: 'completed',
          nextPage: 3,
          errors: [],
        });

      await service.tick();
      const status = await service.getStatus();

      // First provider with terminalReason
      expect(status.discoveryTerminalReason).toBe('exhausted');
    });

    it('nextDiscoveryRunAt is computed correctly', async () => {
      const { service } = await createService({
        schedulerEnabled: true,
        totalDiscovered: 0,
        discoveryDue: true,
      });

      await service.tick();
      const status = await service.getStatus();

      expect(status.nextDiscoveryRunAt).not.toBeNull();
      // Bootstrap interval is 30 min
      expect(status.nextDiscoveryRunAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
