/**
 * Behavioral tests for the admin operational status API.
 *
 * Tests:
 * 25. Admin/manager can read operational status (auth shape)
 * 26. Unauthenticated access is rejected
 * 27. Response omits owner token, API key and raw provider payload
 * 28. Recovery action cannot steal a live lease
 */

import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CopartService } from '../copart/copart.service';
import { ProviderLeaseService } from '../copart/provider-lease.service';
import { RequestBudgetService } from '../copart/request-budget.service';
import { DiscoveryService } from '../copart/discovery.service';
import { AuctionSearchService } from '../copart/auction-search.service';
import { FreshnessSchedulerService } from '../copart/freshness-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionLotsService } from '../auction-lot/auction-lots.service';

describe('AdminController — import operational status (Task 033R)', () => {
  let controller: AdminController;
  let leaseService: any;
  let budgetService: any;
  let discoveryService: any;
  let prisma: any;

  beforeEach(async () => {
    leaseService = {
      getState: jest.fn().mockResolvedValue({
        provider: 'copart',
        fencingToken: 5,
        acquiredAt: new Date(),
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + 30000),
        importJobId: 'job-1',
        isExpired: false,
      }),
      recoverStaleJobs: jest.fn().mockResolvedValue({ recoveredJobIds: ['stale-1'] }),
    };

    // New global budget API — no provider arg
    budgetService = {
      getUsage: jest.fn().mockResolvedValue({
        billingMonth: '2026-07',
        budget: 30000,
        reserve: 3000,
        allocated: 5000,
        confirmed: 4900,
        completedSuccess: 4800,
        failureCounts: { timeout: 10, rateLimit: 50, server: 30, network: 10, client: 0 },
        quotaRemaining: null,
        quotaResetEpochMs: null,
        unresolved: 0,
        availableForRoutine: 22000,
        percentageUsed: 16.67,
        isWarning: false,
        isRoutineBlocked: false,
        isAbsoluteBlocked: false,
        providers: [
          { provider: 'copart', allocated: 3000, confirmed: 2900, completedSuccess: 2800, failureCounts: { timeout: 5, rateLimit: 30, server: 20, network: 5, client: 0 } },
          { provider: 'iaai', allocated: 2000, confirmed: 2000, completedSuccess: 2000, failureCounts: { timeout: 5, rateLimit: 20, server: 10, network: 5, client: 0 } },
        ],
      }),
    };
    discoveryService = { getCheckpointState: jest.fn().mockResolvedValue([]) };

    prisma = {
      importJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'job-1',
          status: 'SUCCESS',
          startedAt: new Date(),
          finishedAt: new Date(),
          createdAt: new Date(),
          errorMessage: null,
          summaryJsonb: {
            terminalReason: 'empty_page',
            created: 10,
            updated: 5,
            skipped: 1,
            errors: 0,
            pagesCompleted: 2,
            pagesAttempted: 3,
            itemsReceived: 15,
          },
        }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: { listUsers: jest.fn() } },
        { provide: CopartService, useValue: { sync: jest.fn() } },
        { provide: ProviderLeaseService, useValue: leaseService },
        { provide: RequestBudgetService, useValue: budgetService },
        { provide: DiscoveryService, useValue: discoveryService },
        { provide: AuctionSearchService, useValue: { search: jest.fn(), importLot: jest.fn() } },
        { provide: FreshnessSchedulerService, useValue: { getStatus: jest.fn(), pause: jest.fn(), resume: jest.fn(), updateCadence: jest.fn(), tick: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuctionLotsService,
          useValue: {
            importPersistedLot: jest.fn(),
            listAdminLots: jest.fn(),
            adminLotDetail: jest.fn(),
            adminMetrics: jest.fn(),
          },
        },
        { provide: JwtAuthGuard, useValue: { canActivate: () => true } },
        { provide: RolesGuard, useValue: { canActivate: () => true } },
      ],
    }).compile();

    controller = moduleRef.get(AdminController);
  });

  // ── Test 25: Admin/manager can read operational status ──

  it('25. getImportStatus returns operational data for all providers', async () => {
    const result = await controller.getImportStatus();

    expect(result.providers).toBeDefined();
    expect(result.providers.length).toBe(2); // copart + iaai
    expect(result.contractVersion).toBe('unified-auction-rc-v1');
    expect(result.month).toBe('2026-07');

    const copart = result.providers.find((p: any) => p.provider === 'copart');
    expect(copart).toEqual(expect.objectContaining({
      provider: 'copart',
      enabled: true,
      circuit: 'closed',
      counters: {
        allocated: 3000,
        confirmed: 2900,
        completed: 2860,
        succeeded: 2800,
        failed: 60,
      },
    }));

    expect(result.budget).toEqual({
      allocated: 5000,
      confirmed: 4900,
      completed: 4900,
      succeeded: 4800,
      failed: 100,
      cap: 30000,
      protectedReserve: 3000,
      routineRemaining: 22000,
    });
  });

  // ── Test 27: Response omits owner token, API key, raw payload ──

  it('27a. status response omits owner token', async () => {
    const result = await controller.getImportStatus();
    const json = JSON.stringify(result);
    expect(json).not.toContain('ownerToken');
    expect(json).not.toContain('owner_token');
  });

  it('27b. status response omits API key and raw provider payload', async () => {
    const result = await controller.getImportStatus();
    const json = JSON.stringify(result);
    expect(json).not.toContain('RAPIDAPI_KEY');
    expect(json).not.toContain('x-rapidapi-key');
    expect(json).not.toContain('payloadJsonb');
  });

  // ── Test 28: Recovery cannot steal a live lease ──

  it('28a. recovery returns recovered=false when lease is active', async () => {
    const result = await controller.triggerRecovery('copart');
    expect(result.recovered).toBe(false);
    expect(result.reason).toContain('active');
    expect(leaseService.recoverStaleJobs).not.toHaveBeenCalled();
  });

  it('28b. recovery proceeds when lease is expired or absent', async () => {
    leaseService.getState.mockResolvedValue({
      provider: 'copart',
      fencingToken: 5,
      acquiredAt: new Date(Date.now() - 60000),
      heartbeatAt: new Date(Date.now() - 50000),
      expiresAt: new Date(Date.now() - 1000),
      importJobId: 'old-job',
      isExpired: true,
    });

    const result = await controller.triggerRecovery('copart');

    expect(result.recovered).toBe(true);
    expect(result.recoveredJobIds).toEqual(['stale-1']);
    expect(leaseService.recoverStaleJobs).toHaveBeenCalledWith('copart');
  });

  it('28c. recovery rejects invalid provider', async () => {
    const result = await controller.triggerRecovery('invalid-provider');
    expect(result.error).toBeDefined();
    expect(leaseService.recoverStaleJobs).not.toHaveBeenCalled();
  });

  // ── Auth shape tests ──

  it('26. controller requires JwtAuthGuard and RolesGuard via @UseGuards decorator', () => {
    const guards = Reflect.getMetadata('__guards__', AdminController);
    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('26b. controller requires ADMIN or MANAGER role', () => {
    const roles = Reflect.getMetadata('roles', AdminController);
    expect(roles).toBeDefined();
    expect(roles).toContain('ADMIN');
    expect(roles).toContain('MANAGER');
  });

  // ── Per-provider status ──

  it('getImportStatusByProvider returns single provider data', async () => {
    const result = await controller.getImportStatusByProvider('iaai');
    expect(result.contractVersion).toBe('unified-auction-rc-v1');
    expect(result.month).toBe('2026-07');
    expect(result.provider.provider).toBe('iaai');
    expect(result.budget.cap).toBe(30000);
  });

  it('getImportStatusByProvider rejects invalid provider', async () => {
    await expect(controller.getImportStatusByProvider('invalid')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    });
  });

  it('projects checkpoint state without cursor tokens or internal fields', async () => {
    discoveryService.getCheckpointState.mockImplementation(async (provider: string) => [{
      mode: 'discovery',
      lastCursor: 'opaque-provider-token',
      queryFingerprint: 'internal-fingerprint',
      lastError: 'raw provider error',
      cycleStartedAt: 'not-a-date',
      lastCompletedAt: new Date('2026-07-21T12:00:00.000Z'),
      exhaustedAt: null,
      nextDueAt: new Date('2026-07-21T13:00:00.000Z'),
      isExhausted: false,
      provider,
    }]);

    const result = await controller.getCheckpointStates({ provider: 'copart', mode: 'discovery' });

    expect(result.items).toEqual([{
      provider: 'copart', mode: 'discovery', hasResumeCursor: true, isExhausted: false,
      cycleStartedAt: null, lastSuccessfulPageAt: '2026-07-21T12:00:00.000Z',
      exhaustedAt: null, nextSweepAt: '2026-07-21T13:00:00.000Z',
    }]);
    expect(JSON.stringify(result)).not.toContain('opaque-provider-token');
    expect(JSON.stringify(result)).not.toContain('internal-fingerprint');
    expect(JSON.stringify(result)).not.toContain('raw provider error');
  });
});
