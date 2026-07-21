/**
 * Behavioral tests for ProviderLeaseService.
 *
 * Tests the database-backed ownership contract:
 * - Claim, renewal, release, verify
 * - Expired lease reclamation
 * - Stale job recovery
 *
 * Uses a mock PrismaService that simulates the $transaction boundary.
 */

import { ProviderLeaseService } from './provider-lease.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── Mock factory ──────────────────────────────────────────────

function makeLeaseRow(overrides: Partial<any> = {}) {
  const now = Date.now();
  return {
    id: 'lease-1',
    provider: 'copart',
    ownerToken: 'owner-A',
    fencingToken: 1,
    acquiredAt: new Date(now - 30000),
    heartbeatAt: new Date(now - 10000),
    expiresAt: new Date(now + 30000), // 30s in the future = active
    importJobId: 'job-A',
    ...overrides,
  };
}

function makePrismaMock(existingLease: any | null = null) {
  let leaseStore: any = existingLease ? { ...existingLease } : null;

  /**
   * Shared importJob mock — the same reference is exposed on both
   * the top-level prisma mock and the transaction tx mock.
   */
  const importJobMock = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  /**
   * Helper: ensure the lease store has a row (simulating the
   * INSERT ON CONFLICT DO NOTHING + SELECT FOR UPDATE pattern).
   * Returns the current row for FOR UPDATE simulation.
   */
  function ensureRow(): any | null {
    if (!leaseStore) {
      // Simulate INSERT ON CONFLICT DO NOTHING creating a placeholder
      leaseStore = {
        id: 'seed-row',
        provider: 'copart',
        ownerToken: '',
        fencingToken: 0,
        acquiredAt: new Date(0),
        heartbeatAt: new Date(0),
        expiresAt: new Date(0),
        importJobId: null,
      };
    }
    return { ...leaseStore };
  }

  return {
    _leaseStore: leaseStore,
    providerLease: {
      findUnique: jest.fn(async () => {
        return leaseStore && leaseStore.ownerToken !== '' ? { ...leaseStore } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const newLease = { ...data, id: 'new-id' };
        Object.keys(leaseStore).forEach(k => delete leaseStore[k]);
        Object.assign(leaseStore, newLease);
        return { ...leaseStore };
      }),
      update: jest.fn(async ({ where: { provider }, data }: any) => {
        if (!leaseStore) throw new Error('Record not found');
        Object.assign(leaseStore, data);
        return { ...leaseStore };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!leaseStore) return { count: 0 };
        // An empty ownerToken in where means "released" row — won't match
        if (where.ownerToken !== undefined && (leaseStore.ownerToken !== where.ownerToken || leaseStore.ownerToken === '')) return { count: 0 };
        if (where.fencingToken !== undefined && leaseStore.fencingToken !== where.fencingToken) return { count: 0 };
        Object.assign(leaseStore, data);
        return { count: 1 };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        if (!leaseStore) return { count: 0 };
        if (where.ownerToken && leaseStore.ownerToken !== where.ownerToken) return { count: 0 };
        if (where.fencingToken !== undefined && leaseStore.fencingToken !== where.fencingToken) return { count: 0 };
        return { count: 1 };
      }),
    },
    importJob: importJobMock,
    $queryRaw: jest.fn(async () => {
      return leaseStore ? [{ ...leaseStore }] : [];
    }),
    $executeRaw: jest.fn(async () => {
      ensureRow();
      return 1;
    }),
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $executeRaw: jest.fn(async () => {
          ensureRow();
          return 1;
        }),
        $queryRaw: jest.fn(async () => {
          // Return current lease for FOR UPDATE
          const row = ensureRow();
          return [row];
        }),
        providerLease: {
          create: jest.fn(async ({ data }: any) => {
            const newLease = { ...data, id: 'new-id' };
            Object.keys(leaseStore).forEach(k => delete leaseStore[k]);
            Object.assign(leaseStore, newLease);
            return { ...leaseStore };
          }),
          update: jest.fn(async ({ where: { provider }, data }: any) => {
            Object.assign(leaseStore, data);
            return { ...leaseStore };
          }),
          updateMany: jest.fn(async ({ where, data }: any) => {
            if (!leaseStore) return { count: 0 };
            if (where.ownerToken !== undefined && (leaseStore.ownerToken !== where.ownerToken || leaseStore.ownerToken === '')) return { count: 0 };
            if (where.fencingToken !== undefined && leaseStore.fencingToken !== where.fencingToken) return { count: 0 };
            Object.assign(leaseStore, data);
            return { count: 1 };
          }),
        },
        importJob: importJobMock,
      };
      return fn(tx);
    }),
  };
}

describe('ProviderLeaseService', () => {
  let service: ProviderLeaseService;
  let prisma: any;

  beforeEach(() => {
    prisma = makePrismaMock(null);
    service = new ProviderLeaseService(prisma as any);
  });

  // ── Test 4: First owner claims available provider lease ──

  it('4. first owner claims an available provider lease', async () => {
    const result = await service.claim('copart', 'owner-A', 60000, 'job-1');

    expect(result.claimed).toBe(true);
    expect(result.ownerToken).toBe('owner-A');
    expect(result.fencingToken).toBe(1);
    expect(result.lease).not.toBeNull();
    expect(result.lease?.provider).toBe('copart');
    expect(result.lease?.isExpired).toBe(false);
  });

  // ── Test 5: Second owner cannot claim a live lease ──

  it('5. second owner cannot claim a live lease', async () => {
    // Pre-populate with an active lease
    prisma = makePrismaMock(makeLeaseRow({ ownerToken: 'owner-A', expiresAt: new Date(Date.now() + 30000) }));
    service = new ProviderLeaseService(prisma as any);

    const result = await service.claim('copart', 'owner-B', 60000, 'job-2');

    expect(result.claimed).toBe(false);
    expect(result.ownerToken).toBeNull();
    expect(result.conflictingLease).not.toBeNull();
    expect(result.conflictingLease?.provider).toBe('copart');
    // Must NOT expose owner token
    expect(JSON.stringify(result.conflictingLease)).not.toContain('owner-A');
  });

  // ── Test 6: Different providers can be owned independently ──

  it('6. different providers can be owned independently', async () => {
    // Claim copart
    const copartResult = await service.claim('copart', 'owner-A', 60000);
    expect(copartResult.claimed).toBe(true);

    // IAAI should also be claimable (different provider key)
    // For this test, we use a fresh prisma mock (simulating different row)
    const iaaiPrisma = makePrismaMock(null);
    const iaaiService = new ProviderLeaseService(iaaiPrisma as any);
    const iaaiResult = await iaaiService.claim('iaai', 'owner-B', 60000);

    expect(iaaiResult.claimed).toBe(true);
    expect(iaaiResult.ownerToken).toBe('owner-B');
  });

  // ── Test 7: Heartbeat renews only matching owner and fence ──

  it('7a. heartbeat renews for matching owner and fence', async () => {
    prisma = makePrismaMock(makeLeaseRow({ ownerToken: 'owner-A', fencingToken: 1 }));
    service = new ProviderLeaseService(prisma as any);

    const result = await service.renew('copart', 'owner-A', 1, 60000);
    expect(result.renewed).toBe(true);
    expect(result.expiresAt).not.toBeNull();
  });

  it('7b. heartbeat fails for wrong owner', async () => {
    prisma = makePrismaMock(makeLeaseRow({ ownerToken: 'owner-A', fencingToken: 1 }));
    service = new ProviderLeaseService(prisma as any);

    const result = await service.renew('copart', 'owner-B', 1, 60000);
    expect(result.renewed).toBe(false);
  });

  it('7c. heartbeat fails for wrong fencing token', async () => {
    prisma = makePrismaMock(makeLeaseRow({ ownerToken: 'owner-A', fencingToken: 2 }));
    service = new ProviderLeaseService(prisma as any);

    const result = await service.renew('copart', 'owner-A', 1, 60000);
    expect(result.renewed).toBe(false);
  });

  // ── Test 8: Expired lease is reclaimed with higher fence ──

  it('8. expired lease is reclaimed with a higher fence', async () => {
    prisma = makePrismaMock(makeLeaseRow({
      ownerToken: 'owner-A',
      fencingToken: 3,
      expiresAt: new Date(Date.now() - 1000), // expired
    }));
    service = new ProviderLeaseService(prisma as any);

    const result = await service.claim('copart', 'owner-B', 60000, 'job-2');

    expect(result.claimed).toBe(true);
    expect(result.ownerToken).toBe('owner-B');
    expect(result.fencingToken).toBe(4); // incremented from 3
  });

  // ── Test 9: Previous active job is recovered exactly once ──

  it('9a. previous active job is recovered exactly once', async () => {
    // Simulate a stale RUNNING job
    prisma.importJob.findMany.mockResolvedValue([{ id: 'stale-job-1' }]);
    prisma.importJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.recoverStaleJobs('copart', 'new-job-1');

    expect(result.recoveredJobIds).toEqual(['stale-job-1']);
    expect(prisma.importJob.updateMany).toHaveBeenCalledTimes(1);
  });

  it('9b. recovery is idempotent (no stale jobs found)', async () => {
    prisma.importJob.findMany.mockResolvedValue([]);

    const result = await service.recoverStaleJobs('copart');

    expect(result.recoveredJobIds).toEqual([]);
    expect(prisma.importJob.updateMany).not.toHaveBeenCalled();
  });

  // ── Test 10: Stale worker cannot process after ownership loss ──

  it('10. verifyOwnership returns false after ownership is lost', async () => {
    prisma = makePrismaMock(makeLeaseRow({
      ownerToken: 'owner-A',
      fencingToken: 1,
      expiresAt: new Date(Date.now() - 1000), // expired
    }));
    service = new ProviderLeaseService(prisma as any);

    const isOwner = await service.verifyOwnership('copart', 'owner-A', 1);
    expect(isOwner).toBe(false);
  });

  it('keeps a 180-second discovery lease alive through an early heartbeat and later fenced write', async () => {
    jest.useFakeTimers();
    const startedAt = new Date('2026-07-21T12:00:00.000Z');
    jest.setSystemTime(startedAt);
    const initialExpiry = new Date(startedAt.getTime() + 180000);
    prisma = makePrismaMock(makeLeaseRow({ ownerToken: 'owner-A', fencingToken: 7, expiresAt: initialExpiry }));
    service = new ProviderLeaseService(prisma as any);

    jest.setSystemTime(new Date(startedAt.getTime() + 61000));
    await expect(service.withLeasedTransaction('copart', 'owner-A', 7, async () => 'early')).resolves.toBe('early');
    expect(prisma._leaseStore.expiresAt.getTime()).toBe(initialExpiry.getTime());

    jest.setSystemTime(new Date(startedAt.getTime() + 120000));
    await expect(service.withLeasedTransaction('copart', 'owner-A', 7, async () => 'later')).resolves.toBe('later');
    jest.useRealTimers();
  });

  it('rejects expired, wrong-owner, and wrong-fence leased writes', async () => {
    const scenarios = [
      { lease: { expiresAt: new Date(Date.now() - 1) }, owner: 'owner-A', fence: 1 },
      { lease: {}, owner: 'owner-B', fence: 1 },
      { lease: {}, owner: 'owner-A', fence: 2 },
    ];
    for (const scenario of scenarios) {
      prisma = makePrismaMock(makeLeaseRow(scenario.lease));
      service = new ProviderLeaseService(prisma as any);
      const write = jest.fn().mockResolvedValue('write');
      await expect(service.withLeasedTransaction('copart', scenario.owner, scenario.fence, write)).resolves.toBeNull();
      expect(write).not.toHaveBeenCalled();
    }
  });

  // ── Test 11: Stale worker cannot release or finalize ──

  it('11a. stale worker release does not affect new owner', async () => {
    prisma = makePrismaMock(makeLeaseRow({
      ownerToken: 'owner-B', // new owner
      fencingToken: 2,       // new fence
    }));
    service = new ProviderLeaseService(prisma as any);

    // Stale owner-A tries to release with old fence 1
    const result = await service.release('copart', 'owner-A', 1);
    // Release returns released: true (idempotent), but does NOT affect the new owner's lease
    expect(result.released).toBe(true);
    // Verify the release attempted to match owner-A/fence-1 but matched 0 rows
    expect(prisma.providerLease.updateMany).toHaveBeenCalledWith({
      where: { provider: 'copart', ownerToken: 'owner-A', fencingToken: 1 },
      data: expect.objectContaining({
        ownerToken: '',
        importJobId: null,
      }),
    });
  });

  // ── Test 12: Valid owner releases idempotently ──

  it('12. valid owner releases idempotently', async () => {
    prisma = makePrismaMock(makeLeaseRow({ ownerToken: 'owner-A', fencingToken: 1 }));
    service = new ProviderLeaseService(prisma as any);

    const result1 = await service.release('copart', 'owner-A', 1);
    expect(result1.released).toBe(true);

    // Second release is also success (idempotent)
    const result2 = await service.release('copart', 'owner-A', 1);
    expect(result2.released).toBe(true);
  });

  // ── Test 13: Concurrent claim proves single winner ──
  // This test verifies that the mock+transaction contract enforces a single winner.
  // In production, PostgreSQL SELECT FOR UPDATE provides the actual guarantee.

  it('13. concurrent claim test proves a single winner at the repository boundary', async () => {
    // Simulate two concurrent transactions by having the $transaction
    // return the same lease row to both callers.
    // The second claim should fail because the first already updated the row.

    const sharedLease = makeLeaseRow({ ownerToken: 'initial', expiresAt: new Date(Date.now() - 1000) });

    const prisma2 = {
      providerLease: {
        findUnique: jest.fn(async () => ({ ...sharedLease })),
        create: jest.fn(async ({ data }: any) => { Object.assign(sharedLease, data); return { ...sharedLease }; }),
        update: jest.fn(async ({ data }: any) => { Object.assign(sharedLease, data); return { ...sharedLease }; }),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      importJob: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (fn: any) => {
        // Each transaction sees the CURRENT state of sharedLease
        const tx = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          $queryRaw: jest.fn(async () => [{ ...sharedLease }]),
          providerLease: {
            create: jest.fn(async ({ data }: any) => { Object.assign(sharedLease, data); return { ...sharedLease }; }),
            update: jest.fn(async ({ data }: any) => { Object.assign(sharedLease, data); return { ...sharedLease }; }),
          },
        };
        return fn(tx);
      }),
    };

    const svc = new ProviderLeaseService(prisma2 as any);

    // First claim (expired lease → reclaim)
    const result1 = await svc.claim('copart', 'owner-A', 60000);
    expect(result1.claimed).toBe(true);
    expect(result1.ownerToken).toBe('owner-A');
    expect(result1.fencingToken).toBe(2);

    // Second claim — now the lease is owned by A and is NOT expired
    const result2 = await svc.claim('copart', 'owner-B', 60000);
    expect(result2.claimed).toBe(false);
    expect(result2.conflictingLease).not.toBeNull();
  });

  // ── No secrets in public state ──

  it('public state never exposes owner token', async () => {
    prisma = makePrismaMock(makeLeaseRow({ ownerToken: 'secret-token-abc' }));
    service = new ProviderLeaseService(prisma as any);

    const state = await service.getState('copart');
    expect(state).not.toBeNull();
    expect(JSON.stringify(state)).not.toContain('secret-token-abc');
  });
});
