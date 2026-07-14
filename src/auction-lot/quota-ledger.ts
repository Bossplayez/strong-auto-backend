// ─────────────────────────────────────────────────────────────
// Strong Auto — Quota Ledger (Task 036 Phase C)
// Global quota enforcement with routine/reserve/hard-cap behavior.
// Deterministic 30-day simulation for testing.
// ─────────────────────────────────────────────────────────────

export const MONTHLY_CAP = 30_000;
export const PROTECTED_RESERVE = 3_000;
export const ROUTINE_CAPACITY = MONTHLY_CAP - PROTECTED_RESERVE; // 27,000

export interface DailyUsage {
  day: number;
  routine: number;
  reserve: number;
  total: number;
  remaining: number;
}

export interface QuotaSimulationResult {
  usage: DailyUsage[];
  routineExhaustedDay: number | null;
  reserveExhaustedDay: number | null;
  totalUsed: number;
  totalRemaining: number;
  degradationOrder: string[];
}

/**
 * Simulate 30 days of quota consumption.
 * - Routine requests use ROUTINE_CAPACITY first.
 * - When routine is exhausted, reserve kicks in for critical work only.
 * - When reserve is exhausted, all requests are rejected.
 * - Degradation order: routine → reserve-only → hard-stop.
 */
export function simulateQuota(
  dailyRoutine: number,
  dailyReserveCritical: number,
  days: number = 30,
): QuotaSimulationResult {
  let routineRemaining = ROUTINE_CAPACITY;
  let reserveRemaining = PROTECTED_RESERVE;
  const usage: DailyUsage[] = [];
  const degradationOrder: string[] = [];
  let routineExhaustedDay: number | null = null;
  let reserveExhaustedDay: number | null = null;

  for (let day = 1; day <= days; day++) {
    let routineUsed = 0;
    let reserveUsed = 0;

    // Use routine capacity first
    if (routineRemaining > 0) {
      const canUse = Math.min(dailyRoutine, routineRemaining);
      routineUsed = canUse;
      routineRemaining -= canUse;
    }

    // Detect routine exhaustion
    if (routineRemaining === 0 && routineExhaustedDay === null) {
      routineExhaustedDay = day;
      degradationOrder.push('ROUTINE_EXHAUSTED');
    }

    // If routine exhausted, use reserve for critical work only
    if (routineRemaining === 0 && reserveRemaining > 0) {
      const canUseReserve = Math.min(dailyReserveCritical, reserveRemaining);
      reserveUsed = canUseReserve;
      reserveRemaining -= canUseReserve;
    }

    // Detect reserve exhaustion
    if (reserveRemaining === 0 && reserveExhaustedDay === null) {
      reserveExhaustedDay = day;
      degradationOrder.push('RESERVE_EXHAUSTED');
    }

    if (routineRemaining === 0 && reserveRemaining === 0) {
      if (!degradationOrder.includes('HARD_STOP')) {
        degradationOrder.push('HARD_STOP');
      }
    }

    const totalUsed = routineUsed + reserveUsed;
    const remaining = routineRemaining + reserveRemaining;

    usage.push({
      day,
      routine: routineUsed,
      reserve: reserveUsed,
      total: totalUsed,
      remaining,
    });
  }

  return {
    usage,
    routineExhaustedDay,
    reserveExhaustedDay,
    totalUsed: MONTHLY_CAP - routineRemaining - reserveRemaining,
    totalRemaining: routineRemaining + reserveRemaining,
    degradationOrder,
  };
}

/**
 * Quota ledger — single global enforcement.
 * Provider breakdown is subordinate accounting only.
 */
export class QuotaLedger {
  private routineUsed = 0;
  private reserveUsed = 0;
  private providerBreakdown: Record<string, number> = {};

  get routineRemaining(): number {
    return Math.max(0, ROUTINE_CAPACITY - this.routineUsed);
  }

  get reserveRemaining(): number {
    return Math.max(0, PROTECTED_RESERVE - this.reserveUsed);
  }

  get totalRemaining(): number {
    return this.routineRemaining + this.reserveRemaining;
  }

  get isExhausted(): boolean {
    return this.totalRemaining === 0;
  }

  recordRoutine(provider: string, count: number): boolean {
    if (this.routineRemaining < count) return false;
    this.routineUsed += count;
    this.providerBreakdown[provider] = (this.providerBreakdown[provider] ?? 0) + count;
    return true;
  }

  recordReserve(provider: string, count: number): boolean {
    if (this.reserveRemaining < count) return false;
    this.reserveUsed += count;
    this.providerBreakdown[provider] = (this.providerBreakdown[provider] ?? 0) + count;
    return true;
  }

  getProviderBreakdown(): Record<string, number> {
    return { ...this.providerBreakdown };
  }

  reset(): void {
    this.routineUsed = 0;
    this.reserveUsed = 0;
    this.providerBreakdown = {};
  }
}
