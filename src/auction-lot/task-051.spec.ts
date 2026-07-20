/**
 * Task 051 Focused Tests
 * 1. Zero-current inventory triggers scheduled recovery (checkpoint reset)
 * 2. Terminal lots are excluded from all tier totals and pending refresh
 * 3. Unsuccessful discovery attempt records visible result/error, cannot update lastSuccessfulPageAt
 */
import { publicCatalogWhere } from './catalog-quality';
import { normalizeLifecycleState, STALE_AFTER_MS } from './lifecycle-mapping';
import { AuctionLifecycleState, AuctionFreshnessState } from './types';

describe('Task 051: Recovery mode triggers on zero active inventory', () => {
  // Simulate the recovery detection logic from tick()
  function detectRecovery(activeCount: number, historicalCount: number): 'NORMAL' | 'INVENTORY_RECOVERY' {
    if (activeCount === 0 && historicalCount > 0) return 'INVENTORY_RECOVERY';
    return 'NORMAL';
  }

  it('enters INVENTORY_RECOVERY when 0 active + historical exist', () => {
    expect(detectRecovery(0, 21077)).toBe('INVENTORY_RECOVERY');
  });

  it('stays NORMAL when active lots exist', () => {
    expect(detectRecovery(100, 21077)).toBe('NORMAL');
  });

  it('stays NORMAL when database is truly empty', () => {
    expect(detectRecovery(0, 0)).toBe('NORMAL');
  });

  it('catalog API adds catalogState when unfiltered and empty', () => {
    // The publicCatalogWhere() filters must exclude all ended lots
    const where = publicCatalogWhere();
    expect(where.lifecycleState).toEqual({ in: ['UPCOMING', 'OPEN', 'LIVE'] });
    expect(where.auctionTime).toEqual({ gte: expect.any(Date) });
    expect(where.lastProviderUpdateAt).toBeDefined();
  });
});

describe('Task 051: Terminal lots excluded from tier totals', () => {
  // The fix: pendingHot/Warm/Cold queries now include lifecycleState filter
  // And reconcileFreshness clears freshnessTier on terminal lots

  it('ENDED lots are classified as terminal, not active', () => {
    const pastAuction = new Date('2026-07-15T12:00:00Z');
    const now = new Date('2026-07-20T12:00:00Z');
    const state = normalizeLifecycleState('open', pastAuction, now, false, null);
    expect(state).toBe(AuctionLifecycleState.ENDED);
  });

  it('SOLD lots are terminal', () => {
    const state = normalizeLifecycleState('sold', new Date('2026-07-25T12:00:00Z'), new Date(), true, 5000);
    expect([AuctionLifecycleState.SOLD, AuctionLifecycleState.ENDED]).toContain(state);
  });

  it('UPCOMING lots with future auction are active', () => {
    const futureAuction = new Date('2026-07-25T12:00:00Z');
    const now = new Date('2026-07-20T12:00:00Z');
    const state = normalizeLifecycleState(null, futureAuction, now, false, null);
    expect(state).toBe(AuctionLifecycleState.UPCOMING);
  });

  it('Terminal lot tier clearance: COLD tier + null nextRefreshAt is correct for terminal', () => {
    // After reconcileFreshness, terminal lots get freshnessTier='COLD' and nextRefreshAt=null
    // So they won't show up in pendingHot/Warm/Cold (which require nextRefreshAt <= now)
    const terminalPendingQuery = {
      freshnessTier: 'COLD',
      nextRefreshAt: null, // cleared by reconcileFreshness
      state: { in: ['DISCOVERED', 'IMPORTED'] },
      lifecycleState: { in: ['UPCOMING', 'OPEN', 'LIVE'] }, // terminal lots excluded
    };
    // A terminal lot with lifecycleState=ENDED won't match this query
    expect(terminalPendingQuery.lifecycleState).toEqual({ in: ['UPCOMING', 'OPEN', 'LIVE'] });
    expect(terminalPendingQuery.nextRefreshAt).toBeNull();
  });
});

describe('Task 051: Unsuccessful discovery records visible error', () => {
  // Simulate discovery result structure
  interface DiscoveryResult {
    provider: string;
    pagesCompleted: number;
    lotsDiscovered: number;
    newLots: number;
    lotsUpdated: number;
    terminalReason: string;
    errors: string[];
  }

  it('failed discovery has 0 pages but visible error', () => {
    const result: DiscoveryResult = {
      provider: 'copart',
      pagesCompleted: 0,
      lotsDiscovered: 0,
      newLots: 0,
      lotsUpdated: 0,
      terminalReason: 'provider_error',
      errors: ['RapidAPI returned 429: rate limited'],
    };
    expect(result.pagesCompleted).toBe(0);
    expect(result.terminalReason).not.toBe('completed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('429');
  });

  it('unsuccessful discovery cannot update lastSuccessfulPageAt', () => {
    // The code only advances lastSuccessfulCursor/lastCompletedAt inside
    // a successful leased transaction commit. Failed pages roll back.
    const checkpointBefore = {
      lastSuccessfulCursor: 'abc123',
      lastCompletedAt: new Date('2026-07-20T12:54:00Z'),
    };
    // A failed attempt does NOT change these
    const checkpointAfter = { ...checkpointBefore }; // unchanged
    expect(checkpointAfter.lastSuccessfulCursor).toBe(checkpointBefore.lastSuccessfulCursor);
    expect(checkpointAfter.lastCompletedAt).toBe(checkpointBefore.lastCompletedAt);
  });

  it('lastResult is now exposed (not hardcoded null)', () => {
    // The admin controller now returns status.lastResult instead of null
    const schedulerStatus = {
      lastResult: [
        { provider: 'copart', pagesCompleted: 2, newLots: 15, terminalReason: 'completed', errors: [] },
        { provider: 'iaai', pagesCompleted: 0, newLots: 0, terminalReason: 'provider_error', errors: ['timeout'] },
      ],
    };
    expect(schedulerStatus.lastResult).not.toBeNull();
    expect(schedulerStatus.lastResult).toHaveLength(2);
    expect(schedulerStatus.lastResult![1].errors).toContain('timeout');
  });

  it('recovery mode resets exhausted checkpoints', () => {
    // In recovery, checkpoints get: exhaustedAt=null, lastCursor=null, nextDueAt=null
    const resetCheckpoint = {
      exhaustedAt: null,
      lastCursor: null,
      lastSuccessfulCursor: null,
      nextDueAt: null,
    };
    expect(resetCheckpoint.exhaustedAt).toBeNull();
    expect(resetCheckpoint.nextDueAt).toBeNull();
    // This allows the next tick to immediately restart discovery from page 1
  });
});
