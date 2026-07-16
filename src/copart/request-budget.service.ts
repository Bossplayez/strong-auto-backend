import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { ProviderId } from './provider-lease.service';

/**
 * Failure classification matching provider-fetch failure kinds.
 */
export type FailureKind =
  | 'timeout'
  | 'rateLimit'
  | 'server'
  | 'network'
  | 'client'
  | 'clientContract'
  | 'persistence'
  | 'leaseLost';

/**
 * Allocation/reservation mode.
 * - routine: background sync, must respect reserve
 * - manual: admin-triggered, may consume reserve with explicit override
 */
export type AllocationMode = 'routine' | 'manual';

/**
 * Status of an individual attempt reservation.
 */
export type ReservationStatus = 'allocated' | 'confirmed' | 'completed_success' | 'completed_failure';

/**
 * Public global usage snapshot — no secrets, no raw response data.
 */
export interface GlobalUsageSnapshot {
  billingMonth: string;
  budget: number;
  reserve: number;
  allocated: number;
  confirmed: number;
  completedSuccess: number;
  failureCounts: { timeout: number; rateLimit: number; server: number; network: number; client: number };
  quotaRemaining: number | null;
  quotaResetEpochMs: number | null;
  unresolved: number;
  availableForRoutine: number;
  percentageUsed: number;
  isWarning: boolean;
  isRoutineBlocked: boolean;
  isAbsoluteBlocked: boolean;
  providers: ProviderBreakdown[];
}

export interface ProviderBreakdown {
  provider: string;
  allocated: number;
  confirmed: number;
  completedSuccess: number;
  failureCounts: { timeout: number; rateLimit: number; server: number; network: number; client: number };
}

/**
 * Result of an atomic reservation attempt.
 */
export interface ReservationResult {
  allowed: boolean;
  attemptId: string;
  status: ReservationStatus;
  reason?: string;
  usage: GlobalUsageSnapshot;
}

/**
 * Global billing-account budget service.
 *
 * Enforces one shared monthly RapidAPI cap across Copart + IAAI.
 * Uses PostgreSQL row-level locking for atomic reservation.
 *
 * Lifecycle per attempt:
 * 1. reserve() — atomically allocate capacity (allocated++)
 * 2. confirm() — mark as reached provider (confirmed++)
 * 3. complete() — record outcome (completedSuccess++ or failureXxx++)
 *
 * Unresolved allocations (allocated but not confirmed) remain charged
 * conservatively — they are never auto-refunded because the provider
 * may have received the request.
 */
@Injectable()
export class RequestBudgetService {
  private readonly logger = new Logger(RequestBudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  static utcBillingMonth(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  get budget(): number {
    return this.config.get<number>('IMPORT_MONTHLY_REQUEST_BUDGET')!;
  }

  get reserveAmount(): number {
    return this.config.get<number>('IMPORT_MONTHLY_REQUEST_RESERVE')!;
  }

  get warningPercent(): number {
    return this.config.get<number>('IMPORT_BUDGET_WARNING_PERCENT')!;
  }

  /**
   * Atomically reserve one request attempt against the global cap.
   *
   * Idempotent: repeating the same attemptId returns the existing
   * reservation without incrementing counters.
   *
   * Concurrent callers contend on the same global monthly aggregate
   * via SELECT FOR UPDATE inside a transaction.
   */
  async reserve(
    provider: ProviderId,
    jobId: string | null,
    attemptId: string,
    mode: AllocationMode = 'routine',
  ): Promise<ReservationResult> {
    const billingMonth = RequestBudgetService.utcBillingMonth();
    const budget = this.budget;
    const reserve = this.reserveAmount;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Ensure the global budget row exists
        await tx.$executeRaw`
          INSERT INTO "global_request_budgets" ("id", "billing_month", "allocated", "created_at", "updated_at")
          VALUES (gen_random_uuid(), ${billingMonth}, 0, NOW(), NOW())
          ON CONFLICT ("billing_month") DO NOTHING
        `;

        // 2. Lock the global budget row FOR UPDATE (serializes concurrent callers)
        const globalRows = await tx.$queryRaw<{ allocated: number }[]>`
          SELECT allocated FROM "global_request_budgets"
          WHERE "billing_month" = ${billingMonth}
          FOR UPDATE
        `;

        const currentAllocated = globalRows[0]?.allocated ?? 0;

        // 3. Check idempotency AFTER acquiring lock (prevents race)
        const existing = await tx.requestAttemptReservation.findUnique({
          where: { id: attemptId },
        });

        if (existing) {
          const usage = await this.buildSnapshot(tx, billingMonth, budget, this.reserveAmount);
          return {
            allowed: true,
            attemptId,
            status: existing.status as ReservationStatus,
            usage,
          };
        }

        // 3. Determine effective cap based on mode
        const routineCap = budget - reserve;
        const effectiveCap = mode === 'manual' ? budget : routineCap;

        if (currentAllocated >= effectiveCap) {
          const usage = await this.buildSnapshot(tx, billingMonth, budget, this.reserveAmount);
          return {
            allowed: false,
            attemptId,
            status: 'allocated',
            reason: mode === 'manual'
              ? 'Absolute budget cap reached'
              : 'Routine reserve reached — manual override required',
            usage,
          };
        }

        // 4. Atomically increment global + breakdown + insert reservation
        await tx.$executeRaw`
          UPDATE "global_request_budgets"
          SET "allocated" = "allocated" + 1, "updated_at" = NOW()
          WHERE "billing_month" = ${billingMonth}
        `;

        await tx.$executeRaw`
          INSERT INTO "provider_request_breakdowns" ("id", "provider", "billing_month", "allocated", "created_at", "updated_at")
          VALUES (gen_random_uuid(), ${provider}, ${billingMonth}, 1, NOW(), NOW())
          ON CONFLICT ("provider", "billing_month")
          DO UPDATE SET "allocated" = "provider_request_breakdowns"."allocated" + 1, "updated_at" = NOW()
        `;

        await tx.requestAttemptReservation.create({
          data: {
            id: attemptId,
            billingMonth,
            provider,
            jobId,
            mode,
            status: 'allocated',
          },
        });

        const usage = await this.buildSnapshot(tx, billingMonth, budget, this.reserveAmount);
        return {
          allowed: true,
          attemptId,
          status: 'allocated',
          usage,
        };
      });
    } catch (error) {
      this.logger.error(`Reservation error: ${error}`);
      const usage = await this.getUsage();
      return {
        allowed: false,
        attemptId,
        status: 'allocated',
        reason: 'Database error during reservation',
        usage,
      };
    }
  }

  /**
   * Confirm that an attempt reached the provider fetch boundary.
   */
  async confirm(
    attemptId: string,
    evidence?: { status?: number; remaining?: number; resetEpochMs?: number },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.requestAttemptReservation.findUnique({
        where: { id: attemptId },
      });

      if (!reservation) return;
      const billingMonth = reservation.billingMonth;
      const transitioned = await tx.requestAttemptReservation.updateMany({
        where: { id: attemptId, status: 'allocated' },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          responseStatus: evidence?.status,
          rateLimitRemaining: evidence?.remaining,
          rateLimitResetAt: evidence?.resetEpochMs
            ? new Date(evidence.resetEpochMs)
            : undefined,
        },
      });
      if (transitioned.count === 0) return;

      await tx.$executeRaw`
        UPDATE "global_request_budgets"
        SET "confirmed" = "confirmed" + 1, "updated_at" = NOW()
        WHERE "billing_month" = ${billingMonth}
      `;

      await tx.$executeRaw`
        UPDATE "provider_request_breakdowns"
        SET "confirmed" = "provider_request_breakdowns"."confirmed" + 1, "updated_at" = NOW()
        WHERE "provider" = ${reservation.provider} AND "billing_month" = ${billingMonth}
      `;
    });
  }

  /**
   * Record the outcome of a completed attempt.
   */
  async complete(
    attemptId: string,
    success: boolean,
    failureKind?: FailureKind,
    quotaHeaders?: { remaining?: number; resetEpochMs?: number },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.requestAttemptReservation.findUnique({
        where: { id: attemptId },
      });

      if (!reservation) return;
      const billingMonth = reservation.billingMonth;

      const newStatus = success ? 'completed_success' : 'completed_failure';

      const transitioned = await tx.requestAttemptReservation.updateMany({
        where: {
          id: attemptId,
          status: success ? 'confirmed' : { in: ['allocated', 'confirmed'] },
        },
        data: {
          status: newStatus,
          failureKind: success ? null : (failureKind ?? null),
          completedAt: new Date(),
        },
      });
      if (transitioned.count === 0) return;

      // Update global counters
      if (success) {
        await tx.$executeRaw`
          UPDATE "global_request_budgets"
          SET "completed_success" = "completed_success" + 1, "updated_at" = NOW()
          WHERE "billing_month" = ${billingMonth}
        `;
        await tx.$executeRaw`
          UPDATE "provider_request_breakdowns"
          SET "completed_success" = "provider_request_breakdowns"."completed_success" + 1, "updated_at" = NOW()
          WHERE "provider" = ${reservation.provider} AND "billing_month" = ${billingMonth}
        `;
      } else if (failureKind) {
        // Use $executeRawUnsafe for dynamic column names (validated enum)
        const columns: Record<FailureKind, string> = {
          timeout: 'failure_timeout',
          rateLimit: 'failure_rate_limit',
          server: 'failure_server',
          network: 'failure_network',
          client: 'failure_client',
          clientContract: 'failure_client_contract',
          persistence: 'failure_persistence',
          leaseLost: 'failure_lease_lost',
        };
        const column = columns[failureKind];
        if (column) {
          await tx.$executeRawUnsafe(
            `UPDATE "global_request_budgets" SET "${column}" = "${column}" + 1, "updated_at" = NOW() WHERE "billing_month" = $1`,
            billingMonth,
          );
          await tx.$executeRawUnsafe(
            `UPDATE "provider_request_breakdowns" SET "${column}" = "${column}" + 1, "updated_at" = NOW() WHERE "provider" = $1 AND "billing_month" = $2`,
            reservation.provider,
            billingMonth,
          );
        }
      }

      // Update quota headers if provided
      if (quotaHeaders) {
        if (quotaHeaders.remaining !== undefined) {
          await tx.$executeRaw`UPDATE "global_request_budgets" SET "quota_remaining" = ${quotaHeaders.remaining} WHERE "billing_month" = ${billingMonth}`;
        }
        if (quotaHeaders.resetEpochMs !== undefined) {
          await tx.$executeRaw`UPDATE "global_request_budgets" SET "quota_reset_epoch_ms" = ${BigInt(quotaHeaders.resetEpochMs)} WHERE "billing_month" = ${billingMonth}`;
        }
      }
    });
  }

  /**
   * Get the current global usage snapshot.
   */
  async getUsage(): Promise<GlobalUsageSnapshot> {
    const billingMonth = RequestBudgetService.utcBillingMonth();
    return this.buildSnapshot(this.prisma, billingMonth, this.budget, this.reserveAmount);
  }

  /**
   * Check if a routine request can proceed (for compatibility).
   */
  async canMakeRoutineRequest(): Promise<{ allowed: boolean; usage: GlobalUsageSnapshot }> {
    const usage = await this.getUsage();
    return { allowed: !usage.isRoutineBlocked, usage };
  }

  /**
   * Check if a manual request with override can proceed (for compatibility).
   */
  async canMakeManualRequest(
    _provider: ProviderId,
    override: boolean = false,
  ): Promise<{ allowed: boolean; usage: GlobalUsageSnapshot }> {
    const usage = await this.getUsage();
    if (usage.allocated >= usage.budget) return { allowed: false, usage };
    if (usage.availableForRoutine <= 0 && !override) return { allowed: false, usage };
    return { allowed: true, usage };
  }

  /**
   * Build the usage snapshot from a transaction client.
   */
  private async buildSnapshot(
    tx: PrismaService | any,
    billingMonth: string,
    budget: number,
    reserve: number,
  ): Promise<GlobalUsageSnapshot> {
    const globalRow = await tx.globalRequestBudget.findUnique({
      where: { billingMonth },
    });

    const breakdowns = await tx.providerRequestBreakdown.findMany({
      where: { billingMonth },
    });

    const unresolvedReservations = await tx.requestAttemptReservation.count({
      where: { billingMonth, status: { in: ['allocated', 'confirmed'] } },
    });

    const allocated = globalRow?.allocated ?? 0;
    const confirmed = globalRow?.confirmed ?? 0;
    const completedSuccess = globalRow?.completedSuccess ?? 0;
    const failureCounts = {
      timeout: globalRow?.failureTimeout ?? 0,
      rateLimit: globalRow?.failureRateLimit ?? 0,
      server: globalRow?.failureServer ?? 0,
      network: globalRow?.failureNetwork ?? 0,
      client: globalRow?.failureClient ?? 0,
    };

    const providers: ProviderBreakdown[] = breakdowns.map((b: any) => ({
      provider: b.provider,
      allocated: b.allocated,
      confirmed: b.confirmed,
      completedSuccess: b.completedSuccess,
      failureCounts: {
        timeout: b.failureTimeout,
        rateLimit: b.failureRateLimit,
        server: b.failureServer,
        network: b.failureNetwork,
        client: b.failureClient,
      },
    }));

    const availableForRoutine = Math.max(0, budget - reserve - allocated);
    const percentageUsed = budget > 0 ? Math.round((allocated / budget) * 10000) / 100 : 0;

    return {
      billingMonth,
      budget,
      reserve,
      allocated,
      confirmed,
      completedSuccess,
      failureCounts,
      quotaRemaining: globalRow?.quotaRemaining ?? null,
      quotaResetEpochMs: globalRow?.quotaResetEpochMs ? Number(globalRow.quotaResetEpochMs) : null,
      unresolved: unresolvedReservations,
      availableForRoutine,
      percentageUsed,
      isWarning: percentageUsed >= this.warningPercent,
      isRoutineBlocked: allocated >= budget - reserve,
      isAbsoluteBlocked: allocated >= budget,
      providers,
    };
  }
}
