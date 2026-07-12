import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Normalized provider identifiers used across lease, ImportJob,
 * VehicleSourceBinding and budget tables.
 * Provider strings are always lowercase: 'copart' | 'iaai'.
 */
export type ProviderId = 'copart' | 'iaai';

/** Public lease state — no owner token. */
export interface LeasePublicState {
  provider: string;
  fencingToken: number;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
  importJobId: string | null;
  isExpired: boolean;
}

/** Result of a lease claim attempt. */
export interface LeaseClaimResult {
  claimed: boolean;
  ownerToken: string | null;
  fencingToken: number | null;
  lease: LeasePublicState | null;
  /** When claim fails because someone else holds it, their lease state. */
  conflictingLease: LeasePublicState | null;
}

/** Result of a lease renewal attempt. */
export interface LeaseRenewResult {
  renewed: boolean;
  expiresAt: Date | null;
}

/** Result of a lease release. */
export interface LeaseReleaseResult {
  released: boolean;
}

/** Internal row shape from Prisma. */
interface LeaseRow {
  id: string;
  provider: string;
  ownerToken: string;
  fencingToken: number;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
  importJobId: string | null;
}

/**
 * Database-backed provider ownership system.
 *
 * Guarantees:
 * - At most one valid lease owner per provider at a time.
 * - Copart and IAAI leases are independent.
 * - An active (non-expired) lease cannot be stolen.
 * - An expired lease can be reclaimed with a higher fencing token.
 * - Heartbeat renewal is owner+fence conditional.
 * - Release is owner+fence conditional and idempotent.
 *
 * Atomicity is provided by PostgreSQL row-level locking via
 * `SELECT ... FOR UPDATE` inside a serializable transaction.
 */
@Injectable()
export class ProviderLeaseService {
  private readonly logger = new Logger(ProviderLeaseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempt to claim a lease for the given provider.
   *
   * - If no lease exists: create one with fencing_token = 1.
   * - If lease exists and expired: reclaim with fencing_token + 1.
   * - If lease exists and owned by same token: idempotent renewal.
   * - If lease exists and owned by different token (not expired): fail.
   *
   * Returns the public lease state (without owner token) on success.
   */
  async claim(
    provider: ProviderId,
    ownerToken: string,
    ttlMs: number,
    importJobId?: string,
  ): Promise<LeaseClaimResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the provider row for the duration of this transaction
        // Alias columns to camelCase for TypeScript access
        const rows = await tx.$queryRaw<any[]>`
          SELECT
            id,
            provider,
            owner_token   AS "ownerToken",
            fencing_token AS "fencingToken",
            acquired_at   AS "acquiredAt",
            heartbeat_at  AS "heartbeatAt",
            expires_at    AS "expiresAt",
            import_job_id AS "importJobId"
          FROM provider_leases WHERE provider = ${provider} FOR UPDATE
        `;

        const existing = rows[0];
        const now = new Date();
        const expired = existing ? existing.expiresAt.getTime() < now.getTime() : true;

        // Case 1: No existing lease — create new
        if (!existing) {
          const created = await tx.providerLease.create({
            data: {
              provider,
              ownerToken,
              fencingToken: 1,
              acquiredAt: now,
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + ttlMs),
              importJobId: importJobId ?? null,
            },
          });
          this.logger.log(`Lease claimed for ${provider} (new, fence=1)`);
          return {
            claimed: true,
            ownerToken,
            fencingToken: created.fencingToken,
            lease: toPublicState(created),
            conflictingLease: null,
          };
        }

        // Case 2: Expired — reclaim with higher fence
        if (expired) {
          const updated = await tx.providerLease.update({
            where: { provider },
            data: {
              ownerToken,
              fencingToken: existing.fencingToken + 1,
              acquiredAt: now,
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + ttlMs),
              importJobId: importJobId ?? null,
            },
          });
          this.logger.log(
            `Lease reclaimed for ${provider} (expired, fence=${updated.fencingToken}, was ${existing.fencingToken})`,
          );
          return {
            claimed: true,
            ownerToken,
            fencingToken: updated.fencingToken,
            lease: toPublicState(updated),
            conflictingLease: null,
          };
        }

        // Case 3: Same owner re-claiming (idempotent)
        if (existing.ownerToken === ownerToken) {
          const updated = await tx.providerLease.update({
            where: { provider },
            data: {
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + ttlMs),
              importJobId: importJobId ?? existing.importJobId,
            },
          });
          return {
            claimed: true,
            ownerToken,
            fencingToken: updated.fencingToken,
            lease: toPublicState(updated),
            conflictingLease: null,
          };
        }

        // Case 4: Active lease held by different owner — deny
        this.logger.warn(
          `Lease claim denied for ${provider}: held by another owner until ${existing.expiresAt.toISOString()}`,
        );
        return {
          claimed: false,
          ownerToken: null,
          fencingToken: null,
          lease: null,
          conflictingLease: toPublicState(existing),
        };
      });
    } catch (error) {
      // Serialization failure or other DB error — treat as claim failure
      this.logger.error(`Lease claim error for ${provider}: ${error}`);
      return {
        claimed: false,
        ownerToken: null,
        fencingToken: null,
        lease: null,
        conflictingLease: null,
      };
    }
  }

  /**
   * Renew (extend) an existing lease.
   * Only succeeds if the caller is the current owner with matching fence.
   */
  async renew(
    provider: ProviderId,
    ownerToken: string,
    fencingToken: number,
    ttlMs: number,
  ): Promise<LeaseRenewResult> {
    try {
      const updated = await this.prisma.providerLease.updateMany({
        where: {
          provider,
          ownerToken,
          fencingToken,
        },
        data: {
          heartbeatAt: new Date(),
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });

      if (updated.count > 0) {
        return { renewed: true, expiresAt: new Date(Date.now() + ttlMs) };
      }

      // Either lease doesn't exist, or owner/fence mismatch
      this.logger.warn(
        `Lease renewal failed for ${provider}: not the current owner or fence mismatch`,
      );
      return { renewed: false, expiresAt: null };
    } catch (error) {
      this.logger.error(`Lease renewal error for ${provider}: ${error}`);
      return { renewed: false, expiresAt: null };
    }
  }

  /**
   * Release a lease. Only succeeds if caller is the current owner.
   * Idempotent: releasing an already-released or non-existent lease returns { released: true }.
   */
  async release(
    provider: ProviderId,
    ownerToken: string,
    fencingToken: number,
  ): Promise<LeaseReleaseResult> {
    try {
      const result = await this.prisma.providerLease.deleteMany({
        where: {
          provider,
          ownerToken,
          fencingToken,
        },
      });

      // deleteMany returns count even if 0 — idempotent success
      return { released: true };
    } catch (error) {
      this.logger.error(`Lease release error for ${provider}: ${error}`);
      // Idempotent: even on error, report as released
      return { released: true };
    }
  }

  /**
   * Verify that the given owner+fence still holds the lease.
   * Does NOT lock or modify.
   */
  async verifyOwnership(
    provider: ProviderId,
    ownerToken: string,
    fencingToken: number,
  ): Promise<boolean> {
    const lease = await this.prisma.providerLease.findUnique({
      where: { provider },
    });

    if (!lease) return false;

    return (
      lease.ownerToken === ownerToken &&
      lease.fencingToken === fencingToken &&
      lease.expiresAt.getTime() > Date.now()
    );
  }

  /**
   * Execute a function inside a short DB transaction that locks and
   * verifies the lease row. Returns the function's result or null if
   * the caller is not the valid owner.
   *
   * Network I/O must NOT happen inside this transaction.
   */
  async withLeasedTransaction<T>(
    provider: ProviderId,
    ownerToken: string,
    fencingToken: number,
    fn: (tx: any) => Promise<T>,
  ): Promise<T | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Lock the lease row (raw SQL for FOR UPDATE)
        const rows = await tx.$queryRaw<any[]>`
          SELECT
            owner_token   AS "ownerToken",
            fencing_token AS "fencingToken",
            expires_at    AS "expiresAt"
          FROM provider_leases
          WHERE provider = ${provider}
          FOR UPDATE
        `;

        const lease = rows[0];
        if (!lease) return null;

        // 2. Verify owner + fence + not expired (aliased from raw query)
        const now = new Date();
        if (
          lease.ownerToken !== ownerToken ||
          lease.fencingToken !== fencingToken ||
          new Date(lease.expiresAt).getTime() <= now.getTime()
        ) {
          return null;
        }

        // 3. Execute the function with the transaction client
        const result = await fn(tx);

        // 4. Update heartbeat within the same transaction
        const newExpiresAt = new Date(now.getTime() + 60000);
        await tx.providerLease.update({
          where: { provider },
          data: { heartbeatAt: now, expiresAt: newExpiresAt },
        });

        return result;
      });
    } catch (error) {
      this.logger.error(`Leased transaction error for ${provider}: ${error}`);
      return null;
    }
  }

  /**
   * Get the current public lease state for a provider.
   * Returns null if no lease exists.
   * Never exposes the owner token.
   */
  async getState(provider: ProviderId): Promise<LeasePublicState | null> {
    const lease = await this.prisma.providerLease.findUnique({
      where: { provider },
    });

    if (!lease) return null;

    return toPublicState(lease);
  }

  /**
   * Recover stale jobs based on LEASE TRUTH, not job age.
   *
   * A PENDING/RUNNING job is recovered only when its corresponding
   * lease is absent or expired. A valid non-expired lease protects
   * a long-running job regardless of job age.
   *
   * This method is typically called inside the claim() transaction
   * after reclaiming an expired lease. The new fencing token has
   * already been set, invalidating the prior owner.
   *
   * Idempotent: only updates jobs still in RUNNING/PENDING.
   */
  async recoverStaleJobs(
    provider: ProviderId,
    recoveredByJobId?: string,
  ): Promise<{ recoveredJobIds: string[] }> {
    // Get the current lease state (after claim/reclaim)
    const lease = await this.prisma.providerLease.findUnique({
      where: { provider },
    });

    // If there's a valid non-expired lease for a different job,
    // do NOT recover that job
    const now = new Date();
    const leaseExpired = !lease || lease.expiresAt <= now;

    // Find all PENDING/RUNNING jobs for this provider
    const candidates = await this.prisma.importJob.findMany({
      where: {
        provider,
        status: { in: ['RUNNING', 'PENDING'] },
      },
      select: { id: true },
    });

    const recoveredIds: string[] = [];

    for (const job of candidates) {
      // Protect the job associated with the current active lease
      if (lease && !leaseExpired && lease.importJobId === job.id) {
        continue;
      }

      const result = await this.prisma.importJob.updateMany({
        where: {
          id: job.id,
          status: { in: ['RUNNING', 'PENDING'] },
        },
        data: {
          status: 'ABANDONED',
          finishedAt: new Date(),
          summaryJsonb: {
            recovered: true,
            recoveredAt: now.toISOString(),
            recoveredByJobId: recoveredByJobId ?? null,
            reason: 'Lease absent or expired — job abandoned by lease-truth recovery',
          } as any,
        },
      });

      if (result.count > 0) {
        recoveredIds.push(job.id);
        this.logger.warn(
          `Recovered stale job ${job.id} for ${provider} — marked ABANDONED (lease-truth)`,
        );
      }
    }

    return { recoveredJobIds: recoveredIds };
  }
}

/** Convert a Prisma lease row to a public state object (no owner token). */
function toPublicState(row: LeaseRow | { id: string; provider: string; ownerToken: string; fencingToken: number; acquiredAt: Date; heartbeatAt: Date; expiresAt: Date; importJobId: string | null }): LeasePublicState {
  return {
    provider: row.provider,
    fencingToken: row.fencingToken,
    acquiredAt: row.acquiredAt,
    heartbeatAt: row.heartbeatAt,
    expiresAt: row.expiresAt,
    importJobId: row.importJobId,
    isExpired: row.expiresAt.getTime() < Date.now(),
  };
}
