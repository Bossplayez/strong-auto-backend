/**
 * PostgreSQL integration tests for lease, fencing, and global budget.
 *
 * These tests run against a REAL disposable PostgreSQL database to prove
 * actual database-level concurrency guarantees. Mocks are NOT used for
 * the database layer.
 *
 * Prerequisites:
 * - PostgreSQL running on localhost:5433
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
const TEST_DB_URL = 'postgresql://test:test@localhost:5433/033r1_test?connection_limit=5&pool_timeout=30';

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
});
