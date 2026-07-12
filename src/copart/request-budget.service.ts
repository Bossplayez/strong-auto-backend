import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { ProviderId } from './provider-lease.service';

/**
 * Classified failure counts matching provider-fetch failure kinds.
 */
interface BudgetFailureCounts {
  timeout: number;
  rateLimit: number;
  server: number;
  network: number;
  client: number;
}

/**
 * Public usage snapshot — no secrets, no raw response data.
 */
export interface BudgetUsageSnapshot {
  provider: string;
  billingMonth: string;
  totalAttempts: number;
  retryCount: number;
  successCount: number;
  failureCounts: BudgetFailureCounts;
  quotaRemaining: number | null;
  quotaResetEpochMs: number | null;
  budget: number;
  reserve: number;
  availableForRoutineWork: number;
  percentageUsed: number;
  isWarning: boolean;
  isHardStop: boolean;
}

/**
 * Result of recording provider request attempts.
 */
interface RecordResult {
  recorded: boolean;
  currentUsage: BudgetUsageSnapshot;
}

/**
 * Persistent monthly request-budget accounting.
 *
 * Counts every actual outbound provider HTTP attempt (including retries)
 * exactly once. Does not count cache hits, validation failures before
 * request, blocked lease claims, or deadline checks that make no HTTP call.
 *
 * Uses atomic increment via Prisma updateMany with atomic operations.
 */
@Injectable()
export class RequestBudgetService {
  private readonly logger = new Logger(RequestBudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Current UTC billing month in YYYY-MM format. */
  static utcBillingMonth(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** Configured budget for the month. */
  get budget(): number {
    return this.config.get<number>('IMPORT_MONTHLY_REQUEST_BUDGET')!;
  }

  /** Configured reserve (routine work must stop before consuming). */
  get reserve(): number {
    return this.config.get<number>('IMPORT_MONTHLY_REQUEST_RESERVE')!;
  }

  /** Warning threshold percentage. */
  get warningPercent(): number {
    return this.config.get<number>('IMPORT_BUDGET_WARNING_PERCENT')!;
  }

  /** Available for routine work = budget - reserve - used. */
  availableForRoutine(used: number): number {
    return Math.max(0, this.budget - this.reserve - used);
  }

  /**
   * Record actual provider HTTP attempts atomically.
   *
   * Each call to providerFetch that makes a real HTTP request counts
   * as one "attempt" — the initial request plus each retry.
   *
   * @param provider - 'copart' | 'iaai'
   * @param attempts - Total HTTP attempts made (1 for success, N for retries+success)
   * @param success - 1 if the final attempt succeeded, 0 otherwise
   * @param retries - Number of retry attempts (attempts - 1)
   * @param failureDelta - Incremental failure counts by kind
   * @param quotaHeaders - Optional: { remaining?, resetEpochMs? } from response headers
   */
  async record(
    provider: ProviderId,
    attempts: number,
    success: number,
    retries: number,
    failureDelta: Partial<BudgetFailureCounts>,
    quotaHeaders?: { remaining?: number; resetEpochMs?: number },
  ): Promise<RecordResult> {
    const billingMonth = RequestBudgetService.utcBillingMonth();

    // Use upsert to handle first request of the month
    await this.prisma.providerRequestBudget.upsert({
      where: {
        provider_billingMonth: { provider, billingMonth },
      },
      create: {
        provider,
        billingMonth,
        totalAttempts: attempts,
        retryCount: retries,
        successCount: success,
        failureCountTimeout: failureDelta.timeout ?? 0,
        failureCountRateLimit: failureDelta.rateLimit ?? 0,
        failureCountServer: failureDelta.server ?? 0,
        failureCountNetwork: failureDelta.network ?? 0,
        failureCountClient: failureDelta.client ?? 0,
        quotaRemaining: quotaHeaders?.remaining ?? null,
        quotaResetEpochMs: quotaHeaders?.resetEpochMs
          ? BigInt(quotaHeaders.resetEpochMs)
          : null,
      },
      update: {
        totalAttempts: { increment: attempts },
        retryCount: { increment: retries },
        successCount: { increment: success },
        failureCountTimeout: { increment: failureDelta.timeout ?? 0 },
        failureCountRateLimit: { increment: failureDelta.rateLimit ?? 0 },
        failureCountServer: { increment: failureDelta.server ?? 0 },
        failureCountNetwork: { increment: failureDelta.network ?? 0 },
        failureCountClient: { increment: failureDelta.client ?? 0 },
        quotaRemaining: quotaHeaders?.remaining ?? undefined,
        quotaResetEpochMs: quotaHeaders?.resetEpochMs
          ? BigInt(quotaHeaders.resetEpochMs)
          : undefined,
      },
    });

    const currentUsage = await this.getUsage(provider);

    return { recorded: true, currentUsage };
  }

  /**
   * Get the current usage snapshot for a provider.
   * Creates no rows — returns zero-state if no budget record exists.
   */
  async getUsage(provider: ProviderId): Promise<BudgetUsageSnapshot> {
    const billingMonth = RequestBudgetService.utcBillingMonth();
    const budget = this.budget;
    const reserve = this.reserve;

    const row = await this.prisma.providerRequestBudget.findUnique({
      where: {
        provider_billingMonth: { provider, billingMonth },
      },
    });

    const totalAttempts = row?.totalAttempts ?? 0;
    const failureCounts: BudgetFailureCounts = {
      timeout: row?.failureCountTimeout ?? 0,
      rateLimit: row?.failureCountRateLimit ?? 0,
      server: row?.failureCountServer ?? 0,
      network: row?.failureCountNetwork ?? 0,
      client: row?.failureCountClient ?? 0,
    };
    const percentageUsed = budget > 0 ? Math.round((totalAttempts / budget) * 10000) / 100 : 0;

    return {
      provider,
      billingMonth,
      totalAttempts,
      retryCount: row?.retryCount ?? 0,
      successCount: row?.successCount ?? 0,
      failureCounts,
      quotaRemaining: row?.quotaRemaining ?? null,
      quotaResetEpochMs: row?.quotaResetEpochMs ? Number(row.quotaResetEpochMs) : null,
      budget,
      reserve,
      availableForRoutineWork: Math.max(0, budget - reserve - totalAttempts),
      percentageUsed,
      isWarning: percentageUsed >= this.warningPercent,
      isHardStop: totalAttempts >= budget - reserve,
    };
  }

  /**
   * Check if routine (background) work can make another HTTP request.
   * Stops when used >= budget - reserve.
   */
  async canMakeRoutineRequest(provider: ProviderId): Promise<{ allowed: boolean; usage: BudgetUsageSnapshot }> {
    const usage = await this.getUsage(provider);
    return {
      allowed: !usage.isHardStop,
      usage,
    };
  }

  /**
   * Check if a manual/admin job with explicit override can proceed.
   * Override allows consuming the reserve.
   * Absolute budget exhaustion blocks ALL calls.
   */
  async canMakeManualRequest(
    provider: ProviderId,
    override: boolean = false,
  ): Promise<{ allowed: boolean; usage: BudgetUsageSnapshot }> {
    const usage = await this.getUsage(provider);

    // Absolute hard stop: budget fully consumed
    if (usage.totalAttempts >= usage.budget) {
      return { allowed: false, usage };
    }

    // If within reserve, only override allowed
    if (usage.availableForRoutineWork <= 0 && !override) {
      return { allowed: false, usage };
    }

    return { allowed: true, usage };
  }
}
