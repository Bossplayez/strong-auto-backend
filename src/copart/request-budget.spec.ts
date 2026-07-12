/**
 * Unit tests for the global billing-account budget service.
 *
 * Mock-based tests for lifecycle, idempotency, and budget gate logic.
 * For real PostgreSQL concurrency evidence see `pg-concurrency.spec.ts`.
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RequestBudgetService } from './request-budget.service';
import { PrismaService } from '../prisma/prisma.service';

function makeConfigMock() {
  return {
    get: (key: string) => {
      const map: Record<string, number> = {
        IMPORT_MONTHLY_REQUEST_BUDGET: 30000,
        IMPORT_MONTHLY_REQUEST_RESERVE: 3000,
        IMPORT_BUDGET_WARNING_PERCENT: 80,
      };
      return map[key];
    },
  };
}

function makeTxMock(allocated: number, existing: any = null) {
  return {
    requestAttemptReservation: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ allocated }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    globalRequestBudget: {
      findUnique: jest.fn().mockResolvedValue({
        allocated,
        confirmed: Math.floor(allocated * 0.9),
        completedSuccess: Math.floor(allocated * 0.8),
        failureTimeout: 0, failureRateLimit: 0, failureServer: 0, failureNetwork: 0, failureClient: 0,
      }),
    },
    providerRequestBreakdown: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('RequestBudgetService (global billing account)', () => {
  let service: RequestBudgetService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      globalRequestBudget: { findUnique: jest.fn() },
      providerRequestBreakdown: { findMany: jest.fn().mockResolvedValue([]) },
      requestAttemptReservation: { count: jest.fn().mockResolvedValue(0) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestBudgetService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: makeConfigMock() },
      ],
    }).compile();

    service = moduleRef.get(RequestBudgetService);
  });

  function wireTx(txMock: any) {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(txMock));
    prisma.globalRequestBudget.findUnique = txMock.globalRequestBudget.findUnique;
    prisma.providerRequestBreakdown.findMany = txMock.providerRequestBreakdown.findMany;
    prisma.requestAttemptReservation.count = txMock.requestAttemptReservation.count;
  }

  // 1. Global budget
  it('1a. budget is a single global value', () => {
    expect(service.budget).toBe(30000);
    expect(service.reserveAmount).toBe(3000);
  });

  it('1b. getUsage returns global snapshot', async () => {
    prisma.globalRequestBudget.findUnique.mockResolvedValue({ allocated: 5000, confirmed: 4900, completedSuccess: 4800 });
    const usage = await service.getUsage();
    expect(usage.budget).toBe(30000);
    expect(usage.allocated).toBe(5000);
  });

  // 2. Atomic reservation
  it('2a. reserve() returns allowed=true when under cap', async () => {
    const tx = makeTxMock(100);
    wireTx(tx);
    const result = await service.reserve('copart', 'job-1', 'attempt-1', 'routine');
    expect(result.allowed).toBe(true);
  });

  it('2b. blocked at routine cap performs zero allocations', async () => {
    const tx = makeTxMock(28000);
    wireTx(tx);
    const result = await service.reserve('copart', 'job-1', 'attempt-blocked', 'routine');
    expect(result.allowed).toBe(false);
    expect(tx.requestAttemptReservation.create).not.toHaveBeenCalled();
  });

  // 3. Unresolved
  it('3a. unresolved count exposed in snapshot', async () => {
    prisma.globalRequestBudget.findUnique.mockResolvedValue({ allocated: 100, confirmed: 90 });
    prisma.requestAttemptReservation.count = jest.fn().mockResolvedValue(10);
    const usage = await service.getUsage();
    expect(usage.unresolved).toBe(10);
  });

  // 4. Breakdown reconciles
  it('4a. provider breakdown sums to global', async () => {
    prisma.globalRequestBudget.findUnique.mockResolvedValue({ allocated: 5000, confirmed: 4900, completedSuccess: 4800 });
    prisma.providerRequestBreakdown.findMany.mockResolvedValue([
      { provider: 'copart', allocated: 3000, confirmed: 2900, completedSuccess: 2800 },
      { provider: 'iaai', allocated: 2000, confirmed: 2000, completedSuccess: 2000 },
    ]);
    const usage = await service.getUsage();
    const sum = usage.providers.reduce((s, p) => s + p.allocated, 0);
    expect(sum).toBe(usage.allocated);
  });

  // 5. UTC month
  it('5a. utcBillingMonth format', () => {
    expect(RequestBudgetService.utcBillingMonth(new Date('2026-07-15T12:00Z'))).toBe('2026-07');
    expect(RequestBudgetService.utcBillingMonth(new Date('2026-08-01T00:01Z'))).toBe('2026-08');
  });

  // 6. Idempotency
  it('6a. repeating attemptId returns existing status, no double allocate', async () => {
    const tx = makeTxMock(100, { id: 'att-1', status: 'completed_success' });
    wireTx(tx);
    const result = await service.reserve('copart', 'job-1', 'att-1', 'routine');
    expect(result.allowed).toBe(true);
    expect(result.status).toBe('completed_success');
    expect(tx.requestAttemptReservation.create).not.toHaveBeenCalled();
  });

  // 7. Routine vs manual
  it('7a. routine stops at budget - reserve', async () => {
    const tx = makeTxMock(27000);
    wireTx(tx);
    const result = await service.reserve('copart', 'job-1', 'att-r', 'routine');
    expect(result.allowed).toBe(false);
  });

  it('7b. manual can consume reserve', async () => {
    const tx = makeTxMock(27000);
    wireTx(tx);
    const result = await service.reserve('copart', 'job-1', 'att-m', 'manual');
    expect(result.allowed).toBe(true);
  });

  it('7c. manual blocked at absolute', async () => {
    const tx = makeTxMock(30000);
    wireTx(tx);
    const result = await service.reserve('copart', 'job-1', 'att-abs', 'manual');
    expect(result.allowed).toBe(false);
  });

  // 8. Warning threshold
  it('8a. warning flag set when percentage >= threshold', async () => {
    prisma.globalRequestBudget.findUnique.mockResolvedValue({ allocated: 25000, confirmed: 24000, completedSuccess: 23000 });
    const usage = await service.getUsage();
    expect(usage.percentageUsed).toBe(83.33);
    expect(usage.isWarning).toBe(true);
  });
});
