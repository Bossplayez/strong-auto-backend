// ─────────────────────────────────────────────────────────────
// Strong Auto — Quota Simulation Tests (Task 036 Phase C)
// Deterministic 30-day simulation proving routine/reserve/hard-cap
// behavior and degradation order.
// ─────────────────────────────────────────────────────────────

import {
  simulateQuota,
  QuotaLedger,
  MONTHLY_CAP,
  PROTECTED_RESERVE,
  ROUTINE_CAPACITY,
} from './quota-ledger';

describe('Quota Simulation — 30-day deterministic', () => {
  it('routine capacity is 27,000 (monthly cap minus protected reserve)', () => {
    expect(ROUTINE_CAPACITY).toBe(27_000);
    expect(PROTECTED_RESERVE).toBe(3_000);
    expect(MONTHLY_CAP).toBe(30_000);
  });

  it('under normal usage, routine never exhausts in 30 days', () => {
    const result = simulateQuota(800, 50, 30);
    expect(result.routineExhaustedDay).toBeNull();
    expect(result.totalUsed).toBe(24_000);
    expect(result.totalRemaining).toBe(6_000);
    expect(result.degradationOrder).toHaveLength(0);
  });

  it('routine exhausts before reserve, reserve before hard stop', () => {
    const result = simulateQuota(1500, 500, 30);
    expect(result.routineExhaustedDay).not.toBeNull();
    expect(result.routineExhaustedDay).toBe(18); // 27000 / 1500 = 18
    expect(result.reserveExhaustedDay).not.toBeNull();
    expect(result.reserveExhaustedDay!).toBeGreaterThanOrEqual(result.routineExhaustedDay!);
    expect(result.degradationOrder[0]).toBe('ROUTINE_EXHAUSTED');
    expect(result.degradationOrder[1]).toBe('RESERVE_EXHAUSTED');
  });

  it('hard stop means zero remaining quota', () => {
    const result = simulateQuota(2000, 500, 30);
    if (result.reserveExhaustedDay !== null) {
      const afterExhaustion = result.usage.find(
        (u) => u.day >= result.reserveExhaustedDay!,
      );
      expect(afterExhaustion?.remaining).toBe(0);
    }
  });

  it('reserve is never touched while routine capacity remains', () => {
    const result = simulateQuota(800, 100, 30);
    const reserveUsedBeforeRoutineExhaustion = result.usage
      .filter((u) => result.routineExhaustedDay === null || u.day < result.routineExhaustedDay)
      .every((u) => u.reserve === 0);
    expect(reserveUsedBeforeRoutineExhaustion).toBe(true);
  });

  it('total consumed never exceeds monthly cap', () => {
    const result = simulateQuota(5000, 1000, 30);
    expect(result.totalUsed).toBeLessThanOrEqual(MONTHLY_CAP);
  });

  it('degradation order is always ROUTINE → RESERVE → HARD_STOP', () => {
    const result = simulateQuota(3000, 500, 30);
    const order = result.degradationOrder;
    expect(order.indexOf('ROUTINE_EXHAUSTED')).toBeLessThan(order.indexOf('RESERVE_EXHAUSTED'));
    if (order.includes('HARD_STOP')) {
      expect(order.indexOf('RESERVE_EXHAUSTED')).toBeLessThan(order.indexOf('HARD_STOP'));
    }
  });

  it('light usage preserves full reserve at end of month', () => {
    const result = simulateQuota(100, 0, 30);
    expect(result.totalUsed).toBe(3_000);
    expect(result.totalRemaining).toBe(27_000);
    expect(result.routineExhaustedDay).toBeNull();
  });
});

describe('QuotaLedger', () => {
  it('starts with full capacity', () => {
    const ledger = new QuotaLedger();
    expect(ledger.routineRemaining).toBe(ROUTINE_CAPACITY);
    expect(ledger.reserveRemaining).toBe(PROTECTED_RESERVE);
    expect(ledger.totalRemaining).toBe(MONTHLY_CAP);
    expect(ledger.isExhausted).toBe(false);
  });

  it('records routine usage', () => {
    const ledger = new QuotaLedger();
    expect(ledger.recordRoutine('copart', 100)).toBe(true);
    expect(ledger.routineRemaining).toBe(ROUTINE_CAPACITY - 100);
    expect(ledger.getProviderBreakdown()['copart']).toBe(100);
  });

  it('rejects routine usage exceeding capacity', () => {
    const ledger = new QuotaLedger();
    expect(ledger.recordRoutine('copart', ROUTINE_CAPACITY + 1)).toBe(false);
  });

  it('records reserve usage separately', () => {
    const ledger = new QuotaLedger();
    expect(ledger.recordReserve('iaai', 500)).toBe(true);
    expect(ledger.reserveRemaining).toBe(PROTECTED_RESERVE - 500);
    expect(ledger.routineRemaining).toBe(ROUTINE_CAPACITY); // unchanged
  });

  it('tracks provider breakdown across both routine and reserve', () => {
    const ledger = new QuotaLedger();
    ledger.recordRoutine('copart', 100);
    ledger.recordReserve('copart', 50);
    ledger.recordRoutine('iaai', 200);
    expect(ledger.getProviderBreakdown()['copart']).toBe(150);
    expect(ledger.getProviderBreakdown()['iaai']).toBe(200);
  });

  it('reset clears all usage', () => {
    const ledger = new QuotaLedger();
    ledger.recordRoutine('copart', 100);
    ledger.recordReserve('iaai', 50);
    ledger.reset();
    expect(ledger.routineRemaining).toBe(ROUTINE_CAPACITY);
    expect(ledger.reserveRemaining).toBe(PROTECTED_RESERVE);
    expect(ledger.getProviderBreakdown()).toEqual({});
  });

  it('isExhausted becomes true when both routine and reserve are 0', () => {
    const ledger = new QuotaLedger();
    ledger.recordRoutine('copart', ROUTINE_CAPACITY);
    ledger.recordReserve('copart', PROTECTED_RESERVE);
    expect(ledger.isExhausted).toBe(true);
    expect(ledger.totalRemaining).toBe(0);
  });
});
