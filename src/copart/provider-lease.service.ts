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

/** Result of a combined claim-with-recovery operation. */
export interface ClaimWithRecoveryResult extends LeaseClaimResult {
  recoveredJobIds: string[];
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
   * Ensure a durable coordination row exists for the provider, then
   * lock it for the current transaction.
   *
   * This method guarantees that `SELECT ... FOR UPDATE` always finds
   * a row, even on first-ever use or after a release.
   *
   * Must be called inside a transaction.
   */
  private async ensureAndLockLeaseRow(
    tx: any,
    provider: ProviderId,
  ): Promise<LeaseRow | null> {
    // Ensure row exists (INSERT ON CONFLICT DO NOTHING)
    await tx.$executeRaw`
      INSERT INTO provider_leases (id, provider, owner_token, fencing_token, acquired_at, heartbeat_at, expires_at)
      VALUES (gen_random_uuid(), ${provider}, '', 0, NOW(), NOW(), '1970-01-01'::timestamp)
      ON CONFLICT (provider) DO NOTHING
    `;

    // Lock the row
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

    return rows[0] ?? null;
  }

  /**
   * Attempt to claim a lease for the given provider.
   *
   * Uses a durable coordination row pattern: the row always exists
   * (created via INSERT ON CONFLICT DO NOTHING), so SELECT FOR UPDATE
   * always finds a lockable row.
   *
   * - If no prior owner: claim with fencing_token = 1.
   * - If expired: reclaim with fencing_token + 1.
   * - If same owner: idempotent renewal.
   * - If different owner (not expired): deny.
   */
  async claim(
    provider: ProviderId,
    ownerToken: string,
    ttlMs: number,
    importJobId?: string,
  ): Promise<LeaseClaimResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await this.ensureAndLockLeaseRow(tx, provider);

        // Gracefully handle the seeded placeholder row
        const hasOwner = existing && existing.ownerToken !== '';
        const now = new Date();
        const expired = !hasOwner || (existing!.expiresAt.getTime() < now.getTime());

        // Case 1: No prior owner (seeded placeholder or truly empty)
        if (!hasOwner) {
          const updated = await tx.providerLease.update({
            where: { provider },
            data: {
              ownerToken,
              fencingToken: existing!.fencingToken > 0 ? existing!.fencingToken + 1 : 1,
              acquiredAt: now,
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + ttlMs),
              importJobId: importJobId ?? null,
            },
          });
          this.logger.log(`Lease claimed for ${provider} (new, fence=${updated.fencingToken})`);
          return {
            claimed: true,
            ownerToken,
            fencingToken: updated.fencingToken,
            lease: toPublicState(updated),
            conflictingLease: null,
          };
        }

        // Case 2: Expired — reclaim with higher fence
        if (expired) {
          const updated = await tx.providerLease.update({
            where: { provider },
            data: {
              ownerToken,
              fencingToken: existing!.fencingToken + 1,
              acquiredAt: now,
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + ttlMs),
              importJobId: importJobId ?? null,
            },
          });
          this.logger.log(
            `Lease reclaimed for ${provider} (expired, fence=${updated.fencingToken}, was ${existing!.fencingToken})`,
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
        if (existing!.ownerToken === ownerToken) {
          const updated = await tx.providerLease.update({
            where: { provider },
            data: {
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + ttlMs),
              importJobId: importJobId ?? existing!.importJobId,
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
          `Lease claim denied for ${provider}: held by another owner`,
        );
        return {
          claimed: false,
          ownerToken: null,
          fencingToken: null,
          lease: null,
          conflictingLease: toPublicState(existing!),
        };
      });
    } catch (error) {
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
   * Combined claim + recovery in a single atomic transaction.
   *
   * This closes the recovery race: claim and recovery cannot
   * interleave because both happen while holding the same
   * `SELECT FOR UPDATE` lock on the provider coordination row.
   *
   * Contract:
   * 1. Begin transaction.
   * 2. Ensure durable coordination row exists.
   * 3. Lock the row FOR UPDATE.
   * 4. Evaluate owner, fencing token, expiry.
   * 5. If reclaiming: mark prior stale jobs ABANDONED while holding
   *    the same lock.
   * 6. Claim/reclaim the lease.
   * 7. Commit.
   */
  async claimWithRecovery(
    provider: ProviderId,
    ownerToken: string,
    ttlMs: number,
    importJobId: string,
  ): Promise<ClaimWithRecoveryResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await this.ensureAndLockLeaseRow(tx, provider);

        const hasOwner = existing && existing.ownerToken !== '';
        const now = new Date();
        const expired = !hasOwner || (existing!.expiresAt.getTime() < now.getTime());

        // Cannot claim: active lease by different owner
        if (hasOwner && !expired && existing!.ownerToken !== ownerToken) {
          this.logger.warn(
            `claimWithRecovery denied for ${provider}: held by another owner`,
          );
          return {
            claimed: false,
            ownerToken: null,
            fencingToken: null,
            lease: null,
            conflictingLease: toPublicState(existing!),
            recoveredJobIds: [],
          };
        }

        // Same owner idempotent re-claim — no recovery needed
        if (hasOwner && !expired && existing!.ownerToken === ownerToken) {
          const updated = await tx.providerLease.update({
            where: { provider },
            data: {
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + ttlMs),
              importJobId: importJobId ?? existing!.importJobId,
            },
          });
          return {
            claimed: true,
            ownerToken,
            fencingToken: updated.fencingToken,
            lease: toPublicState(updated),
            conflictingLease: null,
            recoveredJobIds: [],
          };
        }

        // Claim or reclaim
        const newFence = !hasOwner
          ? (existing!.fencingToken > 0 ? existing!.fencingToken + 1 : 1)
          : existing!.fencingToken + 1;

        const updated = await tx.providerLease.update({
          where: { provider },
          data: {
            ownerToken,
            fencingToken: newFence,
            acquiredAt: now,
            heartbeatAt: now,
            expiresAt: new Date(now.getTime() + ttlMs),
            importJobId,
          },
        });

        this.logger.log(
          `claimWithRecovery for ${provider}: claimed (fence=${newFence}), recovering stale jobs...`,
        );

        // ── Recovery: abandon stale jobs while holding the lock ──
        const recoveredJobIds: string[] = [];

        const candidates = await tx.importJob.findMany({
          where: {
            provider,
            status: { in: ['RUNNING', 'PENDING'] },
          },
          select: { id: true },
        });

        for (const job of candidates) {
          // Don't abandon the job we're claiming for
          if (job.id === importJobId) continue;

          const result = await tx.importJob.updateMany({
            where: {
              id: job.id,
              status: { in: ['RUNNING', 'PENDING'] },
            },
            data: {
              status: 'ABANDONED',
              finishedAt: now,
              summaryJsonb: {
                recovered: true,
                recoveredAt: now.toISOString(),
                recoveredByJobId: importJobId,
                reason: 'Lease absent or expired — job abandoned by atomic claim-with-recovery',
              } as any,
            },
          });

          if (result.count > 0) {
            recoveredJobIds.push(job.id);
            this.logger.warn(
              `Recovered stale job ${job.id} for ${provider} (atomic)`,
            );
          }
        }

        return {
          claimed: true,
          ownerToken,
          fencingToken: newFence,
          lease: toPublicState(updated),
          conflictingLease: null,
          recoveredJobIds,
        };
      });
    } catch (error) {
      this.logger.error(`claimWithRecovery error for ${provider}: ${error}`);
      return {
        claimed: false,
        ownerToken: null,
        fencingToken: null,
        lease: null,
        conflictingLease: null,
        recoveredJobIds: [],
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
   * Release a lease by marking the coordination row as available.
   *
   * The row is NOT deleted — it must remain lockable for future
   * claim/recovery operations. Only the matching owner+fence can
   * release.
   *
   * Idempotent: releasing an already-released lease is a no-op success.
   */
  async release(
    provider: ProviderId,
    ownerToken: string,
    fencingToken: number,
  ): Promise<LeaseReleaseResult> {
    try {
      await this.prisma.providerLease.updateMany({
        where: {
          provider,
          ownerToken,
          fencingToken,
        },
        data: {
          ownerToken: '',
          expiresAt: new Date(0),
          heartbeatAt: new Date(0),
          importJobId: null,
        },
      });
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
        const heartbeatAt = new Date();
        const heartbeatExpiry = new Date(heartbeatAt.getTime() + 60000);
        const existingExpiry = new Date(lease.expiresAt);
        const newExpiresAt = existingExpiry > heartbeatExpiry ? existingExpiry : heartbeatExpiry;
        await tx.providerLease.update({
          where: { provider },
          data: { heartbeatAt, expiresAt: newExpiresAt },
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
   * Recover stale jobs using LEASE TRUTH.
   *
   * Locks the provider coordination row FOR UPDATE, then evaluates
   * which jobs are stale (no valid lease protecting them).
   *
   * This is safe against concurrent claim/release/recovery because
   * it serializes on the same row lock as claim().
   *
   * Idempotent: only updates jobs still in RUNNING/PENDING.
   */
  async recoverStaleJobs(
    provider: ProviderId,
    recoveredByJobId?: string,
  ): Promise<{ recoveredJobIds: string[] }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lease = await this.ensureAndLockLeaseRow(tx, provider);

        const hasOwner = lease && lease.ownerToken !== '';
        const now = new Date();
        const leaseExpired = !hasOwner || lease!.expiresAt.getTime() <= now.getTime();

        // Find all PENDING/RUNNING jobs for this provider
        const candidates = await tx.importJob.findMany({
          where: {
            provider,
            status: { in: ['RUNNING', 'PENDING'] },
          },
          select: { id: true },
        });

        const recoveredIds: string[] = [];

        for (const job of candidates) {
          // Protect the job associated with the current active lease
          if (hasOwner && !leaseExpired && lease!.importJobId === job.id) {
            continue;
          }

          const result = await tx.importJob.updateMany({
            where: {
              id: job.id,
              status: { in: ['RUNNING', 'PENDING'] },
            },
            data: {
              status: 'ABANDONED',
              finishedAt: now,
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
      });
    } catch (error) {
      this.logger.error(`recoverStaleJobs error for ${provider}: ${error}`);
      return { recoveredJobIds: [] };
    }
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
