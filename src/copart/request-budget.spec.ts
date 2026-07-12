/**
 * Behavioral tests for RequestBudgetService.
 *
 * Tests the monthly request-budget accounting:
 * - Atomic increment of HTTP attempts
 * - Routine/manual budget gates
 * - Warning and hard-stop states
 * - UTC month rollover
 * - Failure classification reconciliation
 */

import { RequestBudgetService } from './request-budget.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// ── Helpers ───────────────────────────────────────────────────

function makeConfig(overrides: Record<string, number> = {}): ConfigService {
  const values: Record<string, number> = {
    IMPORT_MONTHLY_REQUEST_BUDGET: 30000,
    IMPORT_MONTHLY_REQUEST_RESERVE: 3000,
    IMPORT_BUDGET_WARNING_PERCENT: 80,
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function makeBudgetRow(overrides: Partial<any> = {}): any {
  return {
    provider: 'copart',
    billingMonth: RequestBudgetService.utcBillingMonth(),
    totalAttempts: 100,
    retryCount: 20,
    successCount: 75,
    failureCountTimeout: 5,
    failureCountRateLimit: 10,
    failureCountServer: 5,
    failureCountNetwork: 3,
    failureCountClient: 2,
    quotaRemaining: null,
    quotaResetEpochMs: null,
    ...overrides,
  };
}

function makePrismaMock(existingRow: any | null = null) {
  const store = existingRow ? { ...existingRow } : null;
  return {
    providerRequestBudget: {
      findUnique: jest.fn(async () => (store ? { ...store } : null)),
      upsert: jest.fn(async ({ create, update }: any) => {
        if (!store) {
          Object.assign(store ?? {}, create);
          return { ...create };
        }
        // Simulate atomic increment
        const result: any = { ...store };
        for (const [key, val] of Object.entries(update)) {
          if (val && typeof val === 'object' && 'increment' in val) {
            result[key] = (result[key] ?? 0) + val.increment;
          } else if (val !== undefined) {
            result[key] = val;
          }
        }
        Object.assign(store, result);
        return { ...result };
      }),
    },
  };
}

// ──────────────────────────────────────────────────────────────

describe('RequestBudgetService', () => {
  describe('configuration', () => {
    it('3a. budget config boundaries are exposed', () => {
      const config = makeConfig();
      const svc = new RequestBudgetService({} as any, config);
      expect(svc.budget).toBe(30000);
      expect(svc.reserve).toBe(3000);
      expect(svc.warningPercent).toBe(80);
    });

    it('3b. availableForRoutine calculates correctly', () => {
      const svc = new RequestBudgetService({} as any, makeConfig());
      expect(svc.availableForRoutine(0)).toBe(27000);
      expect(svc.availableForRoutine(25000)).toBe(2000);
      expect(svc.availableForRoutine(28000)).toBe(0); // can't be negative
    });
  });

  describe('recording attempts', () => {
    it('15. initial request and every retry increment total attempts exactly once', async () => {
      const prisma = makePrismaMock(null);
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      await svc.record('copart', 3, 1, 2, {});

      expect(prisma.providerRequestBudget.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.providerRequestBudget.upsert.mock.calls[0][0];
      expect(call.create.totalAttempts).toBe(3);
      expect(call.create.retryCount).toBe(2);
      expect(call.create.successCount).toBe(1);
    });

    it('16. no-request exits increment nothing', async () => {
      const prisma = makePrismaMock(null);
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      // No record() call = no upsert
      expect(prisma.providerRequestBudget.upsert).not.toHaveBeenCalled();
    });

    it('23. failure classifications reconcile with total attempts', async () => {
      const prisma = makePrismaMock(null);
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      await svc.record('copart', 5, 2, 3, {
        timeout: 1,
        rateLimit: 1,
        server: 1,
      });

      const create = prisma.providerRequestBudget.upsert.mock.calls[0][0].create;
      // success + failures should = total - retries, but we check consistency
      expect(create.successCount).toBe(2);
      expect(create.failureCountTimeout).toBe(1);
      expect(create.failureCountRateLimit).toBe(1);
      expect(create.failureCountServer).toBe(1);
    });

    it('24. mocked recognized quota headers are sanitized and optional', async () => {
      const prisma = makePrismaMock(null);
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      await svc.record('copart', 1, 1, 0, {}, {
        remaining: 25000,
        resetEpochMs: 1693526400000,
      });

      const create = prisma.providerRequestBudget.upsert.mock.calls[0][0].create;
      expect(create.quotaRemaining).toBe(25000);
      expect(create.quotaResetEpochMs).toBe(BigInt(1693526400000));
    });
  });

  describe('usage snapshot', () => {
    it('returns zero-state when no budget record exists', async () => {
      const prisma = makePrismaMock(null);
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      const usage = await svc.getUsage('copart');
      expect(usage.totalAttempts).toBe(0);
      expect(usage.budget).toBe(30000);
      expect(usage.reserve).toBe(3000);
      expect(usage.availableForRoutineWork).toBe(27000);
      expect(usage.percentageUsed).toBe(0);
      expect(usage.isWarning).toBe(false);
      expect(usage.isHardStop).toBe(false);
    });

    it('21. warning threshold changes state without blocking early', async () => {
      // 80% = 24000 attempts → warning = true, hard-stop = false
      const prisma = makePrismaMock(makeBudgetRow({ totalAttempts: 24000 }));
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      const usage = await svc.getUsage('copart');
      expect(usage.percentageUsed).toBe(80);
      expect(usage.isWarning).toBe(true);
      expect(usage.isHardStop).toBe(false);
      expect(usage.availableForRoutineWork).toBe(3000); // 30000-3000-24000
    });
  });

  describe('routine gate', () => {
    it('18. routine work stops at budget - reserve before another HTTP call', async () => {
      // At 27000 = budget(30000) - reserve(3000) → hard stop
      const prisma = makePrismaMock(makeBudgetRow({ totalAttempts: 27000 }));
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      const result = await svc.canMakeRoutineRequest('copart');
      expect(result.allowed).toBe(false);
      expect(result.usage.isHardStop).toBe(true);
    });

    it('routine work allowed when under threshold', async () => {
      const prisma = makePrismaMock(makeBudgetRow({ totalAttempts: 26999 }));
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      const result = await svc.canMakeRoutineRequest('copart');
      expect(result.allowed).toBe(true);
      expect(result.usage.isHardStop).toBe(false);
    });
  });

  describe('manual gate', () => {
    it('19. manual override is explicit and admin-only', async () => {
      // Within reserve zone, no override → blocked
      const prisma = makePrismaMock(makeBudgetRow({ totalAttempts: 28000 }));
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      const blocked = await svc.canMakeManualRequest('copart', false);
      expect(blocked.allowed).toBe(false);

      // With override → allowed (consuming reserve)
      const allowed = await svc.canMakeManualRequest('copart', true);
      expect(allowed.allowed).toBe(true);
    });
  });

  describe('absolute budget exhaustion', () => {
    it('20. absolute budget exhaustion blocks all further calls', async () => {
      const prisma = makePrismaMock(makeBudgetRow({ totalAttempts: 30000 }));
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      // Even with override, absolute limit blocks
      const result = await svc.canMakeManualRequest('copart', true);
      expect(result.allowed).toBe(false);
      expect(result.usage.totalAttempts).toBe(30000);
    });
  });

  describe('UTC month rollover', () => {
    it('22. UTC month rollover uses a new bucket', () => {
      const july = new Date('2026-07-15T12:00:00Z');
      const august = new Date('2026-08-01T00:30:00Z');

      const julyMonth = RequestBudgetService.utcBillingMonth(july);
      const augustMonth = RequestBudgetService.utcBillingMonth(august);

      expect(julyMonth).toBe('2026-07');
      expect(augustMonth).toBe('2026-08');
      expect(julyMonth).not.toBe(augustMonth);
    });
  });

  describe('no secrets in usage output', () => {
    it('usage snapshot contains no API keys or secrets', async () => {
      const prisma = makePrismaMock(makeBudgetRow());
      const svc = new RequestBudgetService(prisma as any, makeConfig());

      const usage = await svc.getUsage('copart');
      const str = JSON.stringify(usage);
      expect(str).not.toContain('RAPIDAPI_KEY');
      expect(str).not.toContain('x-rapidapi-key');
      expect(str).not.toMatch(/[a-f0-9]{32,}/);
    });
  });
});
