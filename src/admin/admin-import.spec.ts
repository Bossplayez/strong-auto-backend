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
import { PrismaService } from '../prisma/prisma.service';

describe('AdminController — import operational status (Task 033R)', () => {
  let controller: AdminController;
  let leaseService: any;
  let budgetService: any;
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

    budgetService = {
      getUsage: jest.fn().mockResolvedValue({
        provider: 'copart',
        billingMonth: '2026-07',
        totalAttempts: 5000,
        retryCount: 200,
        successCount: 4800,
        failureCounts: { timeout: 10, rateLimit: 50, server: 30, network: 10, client: 0 },
        quotaRemaining: null,
        quotaResetEpochMs: null,
        budget: 30000,
        reserve: 3000,
        availableForRoutineWork: 22000,
        percentageUsed: 16.67,
        isWarning: false,
        isHardStop: false,
      }),
    };

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
        { provide: PrismaService, useValue: prisma },
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

    const copart = result.providers.find((p: any) => p.provider === 'copart');
    expect(copart).toBeDefined();
    expect(copart.lease).not.toBeNull();
    expect(copart.lease.fencingToken).toBe(5);
    expect(copart.budget.budget).toBe(30000);
    expect(copart.lastJob).not.toBeNull();
    expect(copart.lastJob.status).toBe('SUCCESS');
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
    expect(json).not.toMatch(/[a-f0-9]{32,}/); // no long hex strings
  });

  // ── Test 28: Recovery cannot steal a live lease ──

  it('28a. recovery returns recovered=false when lease is active', async () => {
    // Lease is active (not expired) — set up in beforeEach
    const result = await controller.triggerRecovery('copart');

    expect(result.recovered).toBe(false);
    expect(result.reason).toContain('active');
    expect(leaseService.recoverStaleJobs).not.toHaveBeenCalled();
  });

  it('28b. recovery proceeds when lease is expired or absent', async () => {
    // Set lease to expired
    leaseService.getState.mockResolvedValue({
      provider: 'copart',
      fencingToken: 5,
      acquiredAt: new Date(Date.now() - 60000),
      heartbeatAt: new Date(Date.now() - 50000),
      expiresAt: new Date(Date.now() - 1000), // expired
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
    // Verify guards are applied at the class level via decorator metadata
    // This is a structural check — the actual auth is tested in e2e
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

    expect(result.provider).toBe('iaai');
    expect(result.budget).toBeDefined();
    expect(result.lease).not.toBeNull();
  });

  it('getImportStatusByProvider rejects invalid provider', async () => {
    const result = await controller.getImportStatusByProvider('invalid');
    expect(result.error).toBeDefined();
  });
});
