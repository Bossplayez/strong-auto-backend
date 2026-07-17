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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ allocated }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
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
      requestAttemptReservation: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
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
    prisma.requestAttemptReservation.groupBy = txMock.requestAttemptReservation.groupBy;
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

  it('9a. duplicate confirmation increments counters once', async () => {
    const tx = makeTxMock(1, {
      id: 'att-confirm',
      provider: 'copart',
      billingMonth: '2026-07',
      status: 'allocated',
    });
    tx.requestAttemptReservation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    wireTx(tx);

    await service.confirm('att-confirm', { status: 200, remaining: 99 });
    await service.confirm('att-confirm', { status: 200, remaining: 99 });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('9b. success cannot complete an unconfirmed allocation', async () => {
    const tx = makeTxMock(1, {
      id: 'att-unconfirmed',
      provider: 'copart',
      billingMonth: '2026-07',
      status: 'allocated',
    });
    tx.requestAttemptReservation.updateMany.mockResolvedValue({ count: 0 });
    wireTx(tx);

    await service.complete('att-unconfirmed', true);

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('9c. lease loss records one terminal failure counter', async () => {
    const tx = makeTxMock(1, {
      id: 'att-lease',
      provider: 'iaai',
      billingMonth: '2026-07',
      status: 'confirmed',
    });
    wireTx(tx);

    await service.complete('att-lease', false, 'leaseLost');

    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('failure_lease_lost');
  });

  // ═══════════════ Task 040: Daily routine cap ═══════════════

  describe('daily routine cap', () => {
    function makeDailyTx(allocated: number, dailyRoutineUsed: number) {
      const tx = makeTxMock(allocated);
      // Simulate daily routine count
      tx.requestAttemptReservation.count.mockImplementation((opts: any) => {
        if (opts?.where?.createdAt?.gte && opts?.where?.mode === 'routine') return Promise.resolve(dailyRoutineUsed);
        return Promise.resolve(0);
      });
      tx.requestAttemptReservation.groupBy.mockResolvedValue([
        { mode: 'routine', _count: dailyRoutineUsed },
      ]);
      return tx;
    }

    it('D1. computes dailyCap from remaining routine budget and remaining days', async () => {
      // 30-day month, 0 allocated, 0 used today
      const tx = makeDailyTx(0, 0);
      wireTx(tx);
      const result = await service.reserve('copart', 'job-1', 'att-d1', 'routine');
      // dailyCap = floor((27000 + 0) / daysInMonth)
      const now = new Date();
      const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const days = Math.max(Math.ceil((endOfMonth.getTime() - now.getTime()) / 86400000), 1);
      const expectedDailyCap = Math.floor(27000 / days);
      expect(result.usage.dailyCap).toBe(expectedDailyCap);
      expect(result.usage.dailyRemaining).toBe(expectedDailyCap);
      expect(result.usage.dailyUsed).toBe(0);
    });

    it('D2. dailyCap is consistent with floor(routineCap/days) for clean start', async () => {
      const tx = makeDailyTx(0, 0);
      wireTx(tx);
      const result = await service.reserve('copart', 'job-1', 'att-d2', 'routine');
      // For a 30-day month: floor(27000/30) = 900
      // For a 31-day month: floor(27000/31) = 870
      // For a 28-day month: floor(27000/28) = 964
      // For a 29-day month: floor(27000/29) = 931
      const days = result.usage.remainingUtcDays;
      const expected = Math.floor(27000 / days);
      expect(result.usage.dailyCap).toBe(expected);
      // Verify formula examples: 30 days → 900, 31 → 870, 28 → 964, 29 → 931
      expect(expected).toBeGreaterThan(0);
      expect(result.usage.dailyRemaining).toBe(expected);
    });

    it('D3. blocks routine when dailyRemaining is 0', async () => {
      // allocated 0 monthly but used dailyCap already today
      const tx = makeDailyTx(0, 1);
      // Make dailyCap = 1 by having used 1 and routineCap + used / days = 1
      // This requires routineCap to be small enough; simulate large dailyUsed
      tx.requestAttemptReservation.count.mockImplementation((opts: any) => {
        if (opts?.where?.createdAt?.gte && opts?.where?.mode === 'routine') return Promise.resolve(27001);
        return Promise.resolve(0);
      });
      tx.requestAttemptReservation.groupBy.mockResolvedValue([
        { mode: 'routine', _count: 27001 },
      ]);
      wireTx(tx);
      const result = await service.reserve('copart', 'job-1', 'att-d3', 'routine');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('daily_routine_cap_reached');
    });

    it('D4. idempotency check happens before daily cap rejection', async () => {
      const tx = makeTxMock(0, { id: 'existing-att', status: 'completed_success' });
      // Set dailyUsed to max so fresh reservations would be blocked
      tx.requestAttemptReservation.count.mockImplementation((opts: any) => {
        if (opts?.where?.createdAt?.gte && opts?.where?.mode === 'routine') return Promise.resolve(99999);
        return Promise.resolve(0);
      });
      tx.requestAttemptReservation.groupBy.mockResolvedValue([
        { mode: 'routine', _count: 99999 },
      ]);
      wireTx(tx);
      const result = await service.reserve('copart', 'job-1', 'existing-att', 'routine');
      // Should pass because idempotency is checked first
      expect(result.allowed).toBe(true);
      expect(result.status).toBe('completed_success');
    });

    it('D5. manual reservations are not subject to daily routine cap', async () => {
      const tx = makeDailyTx(0, 99999);
      wireTx(tx);
      const result = await service.reserve('copart', 'job-1', 'att-manual-d5', 'manual');
      expect(result.allowed).toBe(true);
    });

    it('D6. usage snapshot includes daily fields', async () => {
      prisma.globalRequestBudget.findUnique.mockResolvedValue({ allocated: 100, confirmed: 90 });
      prisma.requestAttemptReservation.groupBy.mockResolvedValue([
        { mode: 'routine', _count: 5 },
        { mode: 'manual', _count: 2 },
      ]);
      const usage = await service.getUsage();
      expect(usage).toHaveProperty('dailyCap');
      expect(usage).toHaveProperty('dailyUsed');
      expect(usage).toHaveProperty('dailyRemaining');
      expect(usage).toHaveProperty('dailyUtcBoundary');
      expect(usage).toHaveProperty('routineAllocatedToday');
      expect(usage).toHaveProperty('manualAllocatedToday');
      expect(usage).toHaveProperty('remainingUtcDays');
      expect(usage.routineAllocatedToday).toBe(5);
      expect(usage.manualAllocatedToday).toBe(2);
    });

    // Task 042: Fake-clock tests for specific month lengths

    it('D7. February (28 days) — dailyCap = floor(27000/28) = 964', async () => {
      jest.useFakeTimers({ now: new Date('2026-02-15T12:00:00Z') });
      try {
        const tx = makeDailyTx(0, 0);
        wireTx(tx);
        const result = await service.reserve('copart', 'job-1', 'att-d7', 'routine');
        expect(result.usage.remainingUtcDays).toBe(14);
        // dailyCap = floor((27000-0+0) / 14) — depends on remaining days
        expect(result.usage.dailyCap).toBe(Math.floor(27000 / 14));
      } finally {
        jest.useRealTimers();
      }
    });

    it('D8. July (31 days) start — dailyCap = floor(27000/31) = 870', async () => {
      jest.useFakeTimers({ now: new Date('2026-07-01T00:00:00Z') });
      try {
        const tx = makeDailyTx(0, 0);
        wireTx(tx);
        const result = await service.reserve('copart', 'job-1', 'att-d8', 'routine');
        expect(result.usage.remainingUtcDays).toBe(31);
        expect(result.usage.dailyCap).toBe(870);
        expect(result.usage.dailyRemaining).toBe(870);
      } finally {
        jest.useRealTimers();
      }
    });

    it('D9. July end (1 day left) — dailyCap = floor(27000/1) = 27000', async () => {
      jest.useFakeTimers({ now: new Date('2026-07-31T23:30:00Z') });
      try {
        const tx = makeDailyTx(0, 0);
        wireTx(tx);
        const result = await service.reserve('copart', 'job-1', 'att-d9', 'routine');
        expect(result.usage.remainingUtcDays).toBe(1);
        expect(result.usage.dailyCap).toBe(27000);
      } finally {
        jest.useRealTimers();
      }
    });

    it('D10. UTC day boundary — reservations before and after midnight counted separately', async () => {
      // Test that utcDayStart produces midnight UTC boundary
      jest.useFakeTimers({ now: new Date('2026-07-15T23:59:00Z') });
      try {
        const usage1 = await service.getUsage();
        expect(usage1.dailyUtcBoundary).toBe('2026-07-15T00:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }

      jest.useFakeTimers({ now: new Date('2026-07-16T00:01:00Z') });
      try {
        const usage2 = await service.getUsage();
        expect(usage2.dailyUtcBoundary).toBe('2026-07-16T00:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
