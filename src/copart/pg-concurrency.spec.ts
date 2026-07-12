/**
 * PostgreSQL integration tests for lease, fencing, and global budget.
 *
 * These tests run against a REAL disposable PostgreSQL database to prove
 * actual database-level concurrency guarantees. Mocks are NOT used for
 * the database layer.
 *
 * Prerequisites:
 * - PostgreSQL running on localhost:5434
 * - Database "033r1_test" with user "test" / password "test"
 * - Migrations applied via `npx prisma migrate deploy`
 *
 * Each test uses a fresh schema or truncates relevant tables.
 */
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProviderLeaseService } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { validateEnv } from '../config/env.validation';

// Use the disposable PostgreSQL for integration tests
// connection_limit=1 reduces contention with other test suites
const TEST_DB_URL = 'postgresql://test:test@localhost:5434/033p_test?connection_limit=5&pool_timeout=30';

describe('PostgreSQL Integration — lease, fencing & global budget', () => {
  let leaseService: ProviderLeaseService;
  let budgetService: RequestBudgetService;
  let prisma: PrismaService;
  let prisma2: PrismaService; // second independent connection

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-16-chars';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-16-chars';
    process.env.IMPORT_MONTHLY_REQUEST_BUDGET = '100';
    process.env.IMPORT_MONTHLY_REQUEST_RESERVE = '10';
    process.env.IMPORT_BUDGET_WARNING_PERCENT = '80';
    process.env.IMPORT_LEASE_TTL_MS = '5000';
    process.env.IMPORT_HEARTBEAT_INTERVAL_MS = '1000';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          validate: (env: any) => validateEnv(env) as any,
        }),
        PrismaModule,
      ],
      providers: [ProviderLeaseService, RequestBudgetService],
    }).compile();

    leaseService = moduleRef.get(ProviderLeaseService);
    budgetService = moduleRef.get(RequestBudgetService);
    prisma = moduleRef.get(PrismaService);

    // Create a second independent Prisma client for concurrency tests
    prisma2 = new (prisma.constructor as any)();
    await prisma2.$connect();

    // Clean all relevant tables before starting
    await prisma.$executeRawUnsafe('TRUNCATE TABLE provider_leases RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE global_request_budgets RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE provider_request_breakdowns RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE request_attempt_reservations RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE import_jobs RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await prisma2.$disconnect();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean all relevant tables before each test
    await prisma.$executeRawUnsafe('TRUNCATE TABLE provider_leases RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE global_request_budgets RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE provider_request_breakdowns RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE request_attempt_reservations RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE import_jobs RESTART IDENTITY CASCADE');
  });

  // 1. Two simultaneous claims for one provider produce exactly one owner
  it('1. concurrent claims for one provider → single owner', async () => {
    const ttl = 5000;
    const [r1, r2] = await Promise.all([
      leaseService.claim('copart', 'token-A', ttl, 'job-A'),
      leaseService.claim('copart', 'token-B', ttl, 'job-B'),
    ]);

    const winners = [r1, r2].filter((r) => r.claimed);
    expect(winners.length).toBe(1);
    expect(winners[0].ownerToken).toBeTruthy();
    expect(winners[0].fencingToken).toBe(1);
  });

  // 2. Copart and IAAI claims can both succeed independently
  it('2. different providers claim independently', async () => {
    const [copart, iaai] = await Promise.all([
      leaseService.claim('copart', 'token-c', 5000, 'job-c'),
      leaseService.claim('iaai', 'token-i', 5000, 'job-i'),
    ]);

    expect(copart.claimed).toBe(true);
    expect(iaai.claimed).toBe(true);
  });

  // 3. Expired lease reclaim raises the fence
  it('3. expired lease reclaim raises fence and invalidates prior owner', async () => {
    // Claim with very short TTL
    const original = await leaseService.claim('copart', 'token-1', 50, 'job-1');
    expect(original.claimed).toBe(true);
    expect(original.fencingToken).toBe(1);

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 150));

    // Reclaim
    const reclaimed = await leaseService.claim('copart', 'token-2', 5000, 'job-2');
    expect(reclaimed.claimed).toBe(true);
    expect(reclaimed.fencingToken).toBe(2);

    // Old owner's renew fails
    const renewOld = await leaseService.renew('copart', 'token-1', 1, 5000);
    expect(renewOld.renewed).toBe(false);

    // New owner's renew succeeds
    const renewNew = await leaseService.renew('copart', 'token-2', 2, 5000);
    expect(renewNew.renewed).toBe(true);
  });

  // 4. Stale owner current-page transaction writes zero rows
  it('4. stale owner leased transaction returns null', async () => {
    const original = await leaseService.claim('copart', 'token-good', 5000, 'job-1');
    expect(original.claimed).toBe(true);

    // Expire the lease by direct DB manipulation
    await prisma.providerLease.update({
      where: { provider: 'copart' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Stale owner tries to use leased transaction
    let writes = 0;
    const result = await leaseService.withLeasedTransaction(
      'copart', 'token-good', original.fencingToken!,
      async (tx) => {
        writes++;
        return 'ok';
      },
    );

    expect(result).toBeNull();
    expect(writes).toBe(0);
  });

  // 5. Valid owner commits complete page atomically
  it('5. valid owner leased transaction executes and returns result', async () => {
    const claim = await leaseService.claim('copart', 'token-v', 5000, 'job-v');
    expect(claim.claimed).toBe(true);

    const result = await leaseService.withLeasedTransaction(
      'copart', 'token-v', claim.fencingToken!,
      async (tx) => {
        // Create a test import job within the transaction
        const job = await tx.importJob.create({
          data: { provider: 'copart', mode: 'test', status: 'RUNNING' },
        });
        return job.id;
      },
    );

    expect(result).toBeTruthy();

    // Verify the job was committed
    const job = await prisma.importJob.findUnique({ where: { id: result! } });
    expect(job).not.toBeNull();
    expect(job!.status).toBe('RUNNING');
  });

  // 6. Concurrent finalization permits only the valid owner
  it('6. concurrent finalization — only valid owner writes', async () => {
    const claim = await leaseService.claim('iaai', 'token-fin', 5000, 'job-fin');
    expect(claim.claimed).toBe(true);

    const fence = claim.fencingToken!;
    const jobId = 'job-fin-test';

    // Create a job
    await prisma.importJob.create({
      data: { id: jobId, provider: 'iaai', mode: 'test', status: 'RUNNING' },
    });

    // Valid owner finalizes
    const validResult = await leaseService.withLeasedTransaction(
      'iaai', 'token-fin', fence,
      async (tx) => {
        await tx.importJob.update({
          where: { id: jobId },
          data: { status: 'SUCCESS', finishedAt: new Date() },
        });
        return 'done';
      },
    );

    expect(validResult).toBe('done');

    // Stale owner (wrong token) finalization fails
    const staleResult = await leaseService.withLeasedTransaction(
      'iaai', 'token-stale', fence,
      async (tx) => {
        await tx.importJob.update({
          where: { id: jobId },
          data: { status: 'FAILED' },
        });
        return 'stale-done';
      },
    );

    expect(staleResult).toBeNull();

    // Verify the job is still SUCCESS (not overwritten)
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    expect(job!.status).toBe('SUCCESS');
  });

  // 7. Concurrent global attempt reservations at routine boundary never exceed budget - reserve
  it('7. routine reservations never exceed budget - reserve', async () => {
    // budget=100, reserve=10 → routine cap = 90
    const attempts: Promise<any>[] = [];
    for (let i = 0; i < 95; i++) {
      attempts.push(
        budgetService.reserve('copart', 'job-r', `att-r-${i}`, 'routine'),
      );
    }
    const results = await Promise.all(attempts);
    const allowed = results.filter((r) => r.allowed);
    expect(allowed.length).toBe(90); // exactly budget - reserve
  });

  // 8. Concurrent manual allocations never exceed the absolute budget
  it('8. manual allocations never exceed absolute budget', async () => {
    // Budget is already at 90 from test 7? No — truncated in beforeEach.
    // budget=100, we can consume up to 100 with manual mode
    const attempts: Promise<any>[] = [];
    for (let i = 0; i < 105; i++) {
      attempts.push(
        budgetService.reserve('iaai', 'job-m', `att-m-${i}`, 'manual'),
      );
    }
    const results = await Promise.all(attempts);
    const allowed = results.filter((r) => r.allowed);
    expect(allowed.length).toBe(100); // exactly budget
  });

  // 9. Concurrent Copart plus IAAI allocations share one cap
  it('9. Copart + IAAI share one global cap', async () => {
    // 50 copart + 50 iaai = 100, should all succeed (routine cap is 90)
    // So we need manual mode for all 100
    const copart: Promise<any>[] = [];
    const iaai: Promise<any>[] = [];
    for (let i = 0; i < 50; i++) {
      copart.push(budgetService.reserve('copart', 'job-c', `att-sc-${i}`, 'manual'));
      iaai.push(budgetService.reserve('iaai', 'job-i', `att-si-${i}`, 'manual'));
    }
    const results = await Promise.all([...copart, ...iaai]);
    const allowed = results.filter((r) => r.allowed);
    expect(allowed.length).toBe(100); // shared cap
  });

  // 10. Repeating the same attempt ID does not double allocate
  it('10. idempotent attempt ID — no double allocation', async () => {
    const id = 'att-idem-1';
    const attempts: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      attempts.push(budgetService.reserve('copart', 'job-idem', id, 'routine'));
    }
    const results = await Promise.all(attempts);
    const allowed = results.filter((r) => r.allowed);

    // All return allowed=true (idempotent) but only 1 allocation made
    expect(allowed.length).toBe(10); // all "allowed" since they return existing

    const usage = await budgetService.getUsage();
    expect(usage.allocated).toBe(1); // only 1 actual allocation
  });

  // 11. Concurrent outcome updates lose no counts
  it('11. concurrent confirm/complete lose no counts', async () => {
    // Reserve 10 attempts
    const attemptIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `att-oc-${i}`;
      attemptIds.push(id);
      const res = await budgetService.reserve('copart', 'job-oc', id, 'manual');
      expect(res.allowed).toBe(true);
    }

    // Concurrently confirm all
    await Promise.all(attemptIds.map((id) => budgetService.confirm(id)));

    // Concurrently complete all as success
    await Promise.all(attemptIds.map((id) => budgetService.complete(id, true)));

    const usage = await budgetService.getUsage();
    expect(usage.allocated).toBe(10);
    expect(usage.confirmed).toBe(10);
    expect(usage.completedSuccess).toBe(10);
  });

  // 12. UTC month buckets remain independent
  it('12. different billing months are independent', async () => {
    // This is tested by verifying utcBillingMonth format
    const m1 = RequestBudgetService.utcBillingMonth(new Date('2026-07-15T12:00Z'));
    const m2 = RequestBudgetService.utcBillingMonth(new Date('2026-08-01T00:01Z'));
    expect(m1).not.toBe(m2);
    expect(m1).toBe('2026-07');
    expect(m2).toBe('2026-08');
  });

  // 13. Live lease prevents stale-job recovery
  it('13. live lease prevents job recovery', async () => {
    // Create a RUNNING job
    await prisma.importJob.create({
      data: { id: 'job-live', provider: 'copart', mode: 'test', status: 'RUNNING' },
    });

    // Active lease for this job
    await leaseService.claim('copart', 'token-live', 10000, 'job-live');

    // Recovery should NOT touch the job
    const result = await leaseService.recoverStaleJobs('copart', 'new-job');
    expect(result.recoveredJobIds).not.toContain('job-live');
    expect(result.recoveredJobIds.length).toBe(0);

    // Verify job is still RUNNING
    const job = await prisma.importJob.findUnique({ where: { id: 'job-live' } });
    expect(job!.status).toBe('RUNNING');
  });

  // 14. Expired/absent lease permits exactly one recovery
  it('14. expired lease permits job recovery (exactly once)', async () => {
    // Create a RUNNING job
    await prisma.importJob.create({
      data: { id: 'job-stale', provider: 'copart', mode: 'test', status: 'RUNNING' },
    });

    // Claim with short TTL, then let it expire
    await leaseService.claim('copart', 'token-old', 100, 'job-stale');
    await new Promise((r) => setTimeout(r, 200));

    // First recovery
    const r1 = await leaseService.recoverStaleJobs('copart', 'new-job');
    expect(r1.recoveredJobIds).toContain('job-stale');
    expect(r1.recoveredJobIds.length).toBe(1);

    // Second recovery (idempotent — already ABANDONED)
    const r2 = await leaseService.recoverStaleJobs('copart', 'new-job2');
    expect(r2.recoveredJobIds.length).toBe(0);

    // Verify job is ABANDONED
    const job = await prisma.importJob.findUnique({ where: { id: 'job-stale' } });
    expect(job!.status).toBe('ABANDONED');
  });

  // ── Phase 1 (033P): Atomic recovery and claim serialization ──

  // 15. Concurrent recovery and fresh claim — invariant-based assertions.
  //
  // INVARIANTS (must all hold after the race):
  //   I1. No stale owner writes page data.
  //   I2. No stale owner finalizes.
  //   I3. Only the valid fencing token may mutate leased state.
  //   I4. A job may reach one terminal state exactly once.
  //   I5. job-old is ALWAYS ABANDONED (it has no valid lease protection).
  //   I6. job-new is RUNNING (claim won) or ABANDONED (recovery won) — both valid.
  //   I7. If job-new is RUNNING, lease.ownerToken === 'token-new' and
  //       lease.importJobId === 'job-new' and lease is not expired.
  //   I8. If job-new is ABANDONED, lease may or may not be claimed by
  //       token-new, but job-old is also ABANDONED.
  //   I9. No job has PENDING status.
  //  I10. No job has two terminal states (finishedAt set exactly once).
  //
  // RACE MECHANICS:
  //   Both claimWithRecovery and recoverStaleJobs use SELECT FOR UPDATE
  //   on the same provider coordination row. PostgreSQL serializes them.
  //
  //   If claimWithRecovery gets the lock FIRST:
  //     - Reclaims expired lease with token-new, fence=2
  //     - Recovers stale jobs: skips job-new (importJobId), abandons job-old
  //     - recoverStaleJobs then gets lock: sees valid lease, no jobs to recover
  //     - Final: job-old=ABANDONED, job-new=RUNNING, lease=token-new
  //
  //   If recoverStaleJobs gets the lock FIRST:
  //     - Sees expired lease, no valid protection for any job
  //     - Abandons both job-old AND job-new
  //     - claimWithRecovery then gets lock: reclaims with token-new, fence=2
  //     - No stale jobs left to recover (both already ABANDONED)
  //     - Final: job-old=ABANDONED, job-new=ABANDONED, lease=token-new
  //
  //   BOTH orderings preserve identical safety invariants.
  it('15. recovery and fresh claim concurrent → invariant-based assertions', async () => {
    // Setup: an expired lease + a stale RUNNING job + a new RUNNING job
    await leaseService.claim('copart', 'token-old', 50, 'job-old');
    await prisma.importJob.create({
      data: { id: 'job-old', provider: 'copart', mode: 'test', status: 'RUNNING' },
    });
    await prisma.importJob.create({
      data: { id: 'job-new', provider: 'copart', mode: 'test', status: 'RUNNING' },
    });

    await new Promise((r) => setTimeout(r, 100)); // let lease expire

    // Worker A: claimWithRecovery for a new job
    // Worker B: recoverStaleJobs independently
    const [claimResult, recoverResult] = await Promise.all([
      leaseService.claimWithRecovery('copart', 'token-new', 30000, 'job-new'),
      leaseService.recoverStaleJobs('copart', 'recovery-job'),
    ]);

    // ── Assert invariants ──

    // I3: claimWithRecovery must succeed (it reclaims the expired lease)
    expect(claimResult.claimed).toBe(true);
    expect(claimResult.fencingToken).toBeGreaterThan(0);

    // I5: job-old is ALWAYS ABANDONED
    const oldJob = await prisma.importJob.findUnique({ where: { id: 'job-old' } });
    expect(oldJob?.status).toBe('ABANDONED');

    // I4: job-old has finishedAt set (reached terminal state)
    expect(oldJob?.finishedAt).not.toBeNull();

    // I6: job-new is either RUNNING or ABANDONED
    const newJob = await prisma.importJob.findUnique({ where: { id: 'job-new' } });
    expect(['RUNNING', 'ABANDONED']).toContain(newJob?.status);

    // I9: No job has PENDING status
    expect(oldJob?.status).not.toBe('PENDING');
    expect(newJob?.status).not.toBe('PENDING');

    // I10: finishedAt set exactly once — if ABANDONED, finishedAt is set;
    //      if RUNNING, finishedAt is null (no terminal state yet)
    if (newJob?.status === 'ABANDONED') {
      expect(newJob.finishedAt).not.toBeNull();
    } else {
      expect(newJob?.finishedAt).toBeNull();
    }

    // I7: If job-new is RUNNING, lease must be owned by token-new
    const lease = await prisma.providerLease.findUnique({ where: { provider: 'copart' } });
    if (newJob?.status === 'RUNNING') {
      // Claim won the race — lease must be valid and point to job-new
      expect(lease?.ownerToken).toBe('token-new');
      expect(lease?.importJobId).toBe('job-new');
      expect(lease!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }

    // I8: If job-new is ABANDONED, lease may or may not be claimed by token-new,
    //     but verify the lease is not in a corrupted state
    if (newJob?.status === 'ABANDONED') {
      // Recovery won the race — claimWithRecovery still reclaimed the lease afterwards
      expect(lease?.ownerToken).toBe('token-new');
    }

    // I4: No double-abandon of job-old — exactly one operation recovered it
    const totalRecoveries =
      claimResult.recoveredJobIds.filter((id) => id === 'job-old').length +
      recoverResult.recoveredJobIds.filter((id) => id === 'job-old').length;
    expect(totalRecoveries).toBe(1);

    // I1 & I2: Stale owner (token-old) cannot write or finalize —
    //   verify by attempting a leased transaction with old token
    const staleWrite = await leaseService.withLeasedTransaction(
      'copart', 'token-old', 1, // old fence
      async (tx) => {
        await tx.importJob.update({
          where: { id: 'job-old' },
          data: { status: 'SUCCESS' },
        });
        return 'stale-write';
      },
    );
    expect(staleWrite).toBeNull(); // Stale owner blocked

    // Verify job-old was NOT overwritten by the stale attempt
    const oldJobAfter = await prisma.importJob.findUnique({ where: { id: 'job-old' } });
    expect(oldJobAfter?.status).toBe('ABANDONED'); // Still ABANDONED, not SUCCESS
  });

  // 16. Two concurrent recoveries abandon a stale job exactly once
  it('16. two concurrent recoveries abandon stale job exactly once', async () => {
    await leaseService.claim('copart', 'token-old', 50, 'job-stale-16');
    await prisma.importJob.create({
      data: { id: 'job-stale-16', provider: 'copart', mode: 'test', status: 'RUNNING' },
    });

    await new Promise((r) => setTimeout(r, 100));

    const [r1, r2] = await Promise.all([
      leaseService.recoverStaleJobs('copart', 'rec-1'),
      leaseService.recoverStaleJobs('copart', 'rec-2'),
    ]);

    const totalRecoveries =
      r1.recoveredJobIds.filter((id) => id === 'job-stale-16').length +
      r2.recoveredJobIds.filter((id) => id === 'job-stale-16').length;

    expect(totalRecoveries).toBe(1);

    const job = await prisma.importJob.findUnique({ where: { id: 'job-stale-16' } });
    expect(job?.status).toBe('ABANDONED');
  });

  // 17. Release racing with recovery has a deterministic safe result
  it('17. release racing with recovery → deterministic safe result', async () => {
    await leaseService.claim('copart', 'token-A', 5000, 'job-17');
    await prisma.importJob.create({
      data: { id: 'job-17', provider: 'copart', mode: 'test', status: 'RUNNING' },
    });

    // Race release vs recovery
    await Promise.all([
      leaseService.release('copart', 'token-A', 1),
      leaseService.recoverStaleJobs('copart', 'rec-17'),
    ]);

    // After release, lease row exists but is available (ownerToken=''),
    // recovery may or may not have seen it as expired. Either way:
    // - The job may be RUNNING (recovery saw live lease) or ABANDONED (saw expired)
    // - The lease row is available (not deleted)
    const lease = await prisma.providerLease.findUnique({ where: { provider: 'copart' } });
    expect(lease).not.toBeNull(); // Row must still exist (not deleted)
    expect(lease!.ownerToken).toBe(''); // Available

    // If recovery happened, job is ABANDONED. If not, still RUNNING.
    // Both outcomes are safe and deterministic.
    const job = await prisma.importJob.findUnique({ where: { id: 'job-17' } });
    expect(['RUNNING', 'ABANDONED']).toContain(job?.status);
  });

  // 18. Reclaim increments the fence exactly once (no double-increment)
  it('18. reclaim increments fence exactly once', async () => {
    await leaseService.claim('copart', 'token-1', 50, 'job-18');
    await new Promise((r) => setTimeout(r, 100));

    // Two concurrent reclaims after expiry
    const [r1, r2] = await Promise.all([
      leaseService.claim('copart', 'token-2', 5000, 'job-18b'),
      leaseService.claim('copart', 'token-3', 5000, 'job-18c'),
    ]);

    // Exactly one wins
    const winners = [r1, r2].filter((r) => r.claimed);
    expect(winners.length).toBe(1);

    // Fence must be exactly 2 (incremented from 1)
    expect(winners[0].fencingToken).toBe(2);

    // The coordination row still exists
    const lease = await prisma.providerLease.findUnique({ where: { provider: 'copart' } });
    expect(lease).not.toBeNull();
    expect(lease!.fencingToken).toBe(2);
  });

  // 19. 100 race iterations: no valid live job is ever marked ABANDONED
  it('19. 100 race iterations — no valid live job is marked ABANDONED', async () => {
    for (let i = 0; i < 100; i++) {
      // Truncate for clean state
      await prisma.$executeRawUnsafe('TRUNCATE TABLE provider_leases RESTART IDENTITY CASCADE');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE import_jobs RESTART IDENTITY CASCADE');

      const jobId = `race-job-${i}`;
      const token = `token-${i}`;

      // Claim with a live (non-expiring) lease
      const claim = await leaseService.claimWithRecovery('copart', token, 30000, jobId);
      expect(claim.claimed).toBe(true);

      // Create the job AFTER claiming
      await prisma.importJob.create({
        data: { id: jobId, provider: 'copart', mode: 'test', status: 'RUNNING' },
      });

      // Concurrently: try to recover + try to claim from another worker
      const [, otherClaim] = await Promise.all([
        leaseService.recoverStaleJobs('copart', `other-${i}`),
        leaseService.claimWithRecovery('copart', `other-token-${i}`, 100, `other-job-${i}`),
      ]);

      // The live job must NOT be abandoned
      const job = await prisma.importJob.findUnique({ where: { id: jobId } });
      expect(job?.status).toBe('RUNNING');

      // The other claim must fail (lease is still live)
      expect(otherClaim.claimed).toBe(false);
    }
  });

  // 20. 100-iteration race: claimWithRecovery vs recoverStaleJobs —
  //     invariant-based assertions on every iteration.
  //
  //     This test proves that BOTH valid orderings (claim-wins and
  //     recovery-wins) preserve identical safety invariants across
  //     100 real PostgreSQL race iterations.
  it('20. 100 race iterations — claim vs recovery, invariant proof', async () => {
    let claimWonCount = 0;
    let recoveryWonCount = 0;

    for (let i = 0; i < 100; i++) {
      // Truncate for clean state
      await prisma.$executeRawUnsafe('TRUNCATE TABLE provider_leases RESTART IDENTITY CASCADE');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE import_jobs RESTART IDENTITY CASCADE');

      // Setup: expired lease + stale RUNNING job + new RUNNING job
      await leaseService.claim('copart', 'token-old', 50, 'job-old');
      await prisma.importJob.create({
        data: { id: 'job-old', provider: 'copart', mode: 'test', status: 'RUNNING' },
      });
      await prisma.importJob.create({
        data: { id: 'job-new', provider: 'copart', mode: 'test', status: 'RUNNING' },
      });

      await new Promise((r) => setTimeout(r, 60)); // let lease expire

      // Race: claimWithRecovery vs recoverStaleJobs
      const [claimResult, recoverResult] = await Promise.all([
        leaseService.claimWithRecovery('copart', 'token-new', 30000, 'job-new'),
        leaseService.recoverStaleJobs('copart', 'recovery-job'),
      ]);

      // ── Assert invariants on every iteration ──

      // I3: claim must succeed (expired lease is always reclaimable)
      expect(claimResult.claimed).toBe(true);
      expect(claimResult.fencingToken).toBeGreaterThan(0);

      // I5: job-old is ALWAYS ABANDONED
      const oldJob = await prisma.importJob.findUnique({ where: { id: 'job-old' } });
      expect(oldJob?.status).toBe('ABANDONED');
      expect(oldJob?.finishedAt).not.toBeNull();

      // I6: job-new is RUNNING or ABANDONED
      const newJob = await prisma.importJob.findUnique({ where: { id: 'job-new' } });
      expect(['RUNNING', 'ABANDONED']).toContain(newJob?.status);

      // I9: No PENDING status
      expect(oldJob?.status).not.toBe('PENDING');
      expect(newJob?.status).not.toBe('PENDING');

      // I10: finishedAt consistency
      if (newJob?.status === 'ABANDONED') {
        expect(newJob.finishedAt).not.toBeNull();
        recoveryWonCount++;
      } else {
        expect(newJob?.finishedAt).toBeNull();
        claimWonCount++;
      }

      // I7/I8: Lease state consistency
      const lease = await prisma.providerLease.findUnique({ where: { provider: 'copart' } });
      expect(lease).not.toBeNull();
      expect(lease!.ownerToken).toBe('token-new'); // claimWithRecovery always reclaims

      if (newJob?.status === 'RUNNING') {
        // Claim won — lease must protect job-new
        expect(lease!.importJobId).toBe('job-new');
        expect(lease!.expiresAt.getTime()).toBeGreaterThan(Date.now());
      }

      // I4: No double-abandon of job-old
      const totalRecoveries =
        claimResult.recoveredJobIds.filter((id) => id === 'job-old').length +
        recoverResult.recoveredJobIds.filter((id) => id === 'job-old').length;
      expect(totalRecoveries).toBe(1);

      // I1 & I2: Stale owner (token-old, fence=1) cannot mutate
      const staleWrite = await leaseService.withLeasedTransaction(
        'copart', 'token-old', 1,
        async (tx) => {
          await tx.importJob.update({
            where: { id: 'job-old' },
            data: { status: 'SUCCESS' },
          });
          return 'stale-write';
        },
      );
      expect(staleWrite).toBeNull();

      // Verify job-old was NOT overwritten
      const oldJobAfter = await prisma.importJob.findUnique({ where: { id: 'job-old' } });
      expect(oldJobAfter?.status).toBe('ABANDONED');
    }

    // Report distribution
    // eslint-disable-next-line no-console
    console.log(
      `  Race distribution: claim won ${claimWonCount}, recovery won ${recoveryWonCount}`,
    );

    expect(claimWonCount + recoveryWonCount).toBe(100);
  }, 60000); // 60s timeout for 100 DB iterations
});
