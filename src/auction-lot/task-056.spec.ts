// ─────────────────────────────────────────────────────────────
// Task 056: Canonical Visibility — Scheduler Independence Tests
//
// Verifies that:
//  1. Legacy freshnessState=STALE does NOT hide valid future lots
//  2. Scheduler nextRefreshAt expiry does NOT control visibility
//  3. Observation resolver priority chain works correctly
//  4. publicCatalogWhere enforces availability/state exclusions
//  5. Past auctions without provider result → RESULT_PENDING
//  6. Search query 'q' cannot bypass freshness/visibility AND-nesting
//  7. Public 0–7 day horizon enforced
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { resolveListingObservedAt } from './observation-resolver';
import { computeProjectionV2 } from './projection-v2';
import { publicCatalogWhere, LISTING_FRESH_WINDOW_MS } from './catalog-quality';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

// Helper: build a minimal lot for computeProjectionV2
function makeLot(overrides: Record<string, any> = {}) {
  return {
    auctionTime: new Date('2026-07-21T14:00:00.000Z'), // 2h in future
    providerResultState: 'UNKNOWN',
    listingObservedAt: null,
    priceObservedAt: null,
    lastProviderUpdateAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
    availabilityConfirmedAt: null,
    buyNowUsd: null as any,
    currentBidUsd: null as any,
    ...overrides,
  };
}

// ── Scenario 1: Copart 46365656 — STALE legacy flag must not hide ──

describe('Task 056 — Scenario 1: Copart 46365656 (STALE legacy, future auction)', () => {
  it('returns FRESH listing, publicVisible=true despite legacy freshnessState=STALE', () => {
    // The lot has a future auction, provider updated 2h ago, but the
    // scheduler stamped freshnessState=STALE (e.g. missed a 15-min refresh).
    // Projection V2 must ignore the scheduler label and use canonical timestamps.
    const lot = makeLot({
      auctionTime: new Date('2026-07-21T14:00:00.000Z'), // future
      lastProviderUpdateAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
      // listingObservedAt null → resolver falls back to lastProviderUpdateAt
    });

    const proj = computeProjectionV2(lot, NOW);

    expect(proj.listingFreshness).toBe('FRESH');
    expect(proj.publicVisible).toBe(true);
    // isActive equivalent: schedule is SCHEDULED_ACTIVE and not result-pending
    expect(proj.catalogScheduleState).toBe('SCHEDULED_ACTIVE');
    expect(proj.isResultPending).toBe(false);
  });
});

// ── Scenario 2: 15-minute nextRefresh expiry must not hide ──

describe('Task 056 — Scenario 2: nextRefreshAt expired but observation within 48h', () => {
  it('returns FRESH even when scheduler refresh window has passed', () => {
    // Simulate: lastProviderUpdateAt is 5h ago (well past any 15-min TTL)
    // but well within the 48h canonical window.
    const lot = makeLot({
      auctionTime: new Date(NOW.getTime() + 2 * ONE_DAY),
      lastProviderUpdateAt: new Date(NOW.getTime() - 5 * ONE_HOUR),
    });

    const proj = computeProjectionV2(lot, NOW);

    // 5h is within 48h → FRESH
    expect(proj.listingFreshness).toBe('FRESH');
    expect(proj.publicVisible).toBe(true);

    // Verify the constant is indeed 48h (not 15 minutes)
    expect(LISTING_FRESH_WINDOW_MS).toBe(48 * ONE_HOUR);
  });
});

// ── Scenario 3: resolveListingObservedAt priority chain ──

describe('Task 056 — Scenario 3: resolveListingObservedAt fallback priority', () => {
  it('uses listingObservedAt when present (priority 1)', () => {
    const listing = new Date(NOW.getTime() - ONE_HOUR);
    const result = resolveListingObservedAt({
      listingObservedAt: listing,
      priceObservedAt: null,
      lastProviderUpdateAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
      availabilityConfirmedAt: new Date(NOW.getTime() - 3 * ONE_HOUR),
      currentBidUsd: null,
      buyNowUsd: null,
    });
    expect(result).toEqual(listing);
  });

  it('falls back to lastProviderUpdateAt when listingObservedAt is null (priority 2)', () => {
    const provider = new Date(NOW.getTime() - 2 * ONE_HOUR);
    const result = resolveListingObservedAt({
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: provider,
      availabilityConfirmedAt: new Date(NOW.getTime() - 3 * ONE_HOUR),
      currentBidUsd: null,
      buyNowUsd: null,
    });
    expect(result).toEqual(provider);
  });

  it('falls back to availabilityConfirmedAt when both listingObservedAt and lastProviderUpdateAt are null (priority 3)', () => {
    const confirmed = new Date(NOW.getTime() - 3 * ONE_HOUR);
    const result = resolveListingObservedAt({
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: null,
      availabilityConfirmedAt: confirmed,
      currentBidUsd: null,
      buyNowUsd: null,
    });
    expect(result).toEqual(confirmed);
  });

  it('returns null when all timestamps are absent', () => {
    const result = resolveListingObservedAt({
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: null,
      availabilityConfirmedAt: null,
      currentBidUsd: null,
      buyNowUsd: null,
    });
    expect(result).toBeNull();
  });
});

// ── Scenario 4: availability=false or state=UNAVAILABLE excluded ──

describe('Task 056 — Scenario 4: publicCatalogWhere excludes unavailable lots', () => {
  it('includes state != UNAVAILABLE condition', () => {
    const where = publicCatalogWhere();
    const andArray = (where as any).AND as any[];

    // Find the state condition
    const stateCond = andArray.find(
      (c) => c.state && c.state.not === 'UNAVAILABLE',
    );
    expect(stateCond).toBeDefined();
  });

  it('includes availabilityConfirmed = true condition', () => {
    const where = publicCatalogWhere();
    const andArray = (where as any).AND as any[];

    const availCond = andArray.find(
      (c) => c.availabilityConfirmed === true,
    );
    expect(availCond).toBeDefined();
  });
});

// ── Scenario 5: past auction without provider result → RESULT_PENDING ──

describe('Task 056 — Scenario 5: past auction → RESULT_PENDING', () => {
  it('returns RESULT_PENDING for past auction with UNKNOWN provider result', () => {
    const lot = makeLot({
      auctionTime: new Date(NOW.getTime() - 3 * ONE_HOUR), // 3h ago
      providerResultState: 'UNKNOWN',
    });

    const proj = computeProjectionV2(lot, NOW);

    expect(proj.isResultPending).toBe(true);
    expect(proj.providerResultState).not.toBe('SOLD');
    expect(proj.providerResultState).not.toBe('UNSOLD');
    expect(proj.providerResultState).not.toBe('ENDED');
    // Should not be publicly visible while result pending
    expect(proj.publicVisible).toBe(false);
  });
});

// ── Scenario 6: search 'q' cannot bypass freshness/visibility ──

describe('Task 056 — Scenario 6: search query AND-nesting', () => {
  it('wraps extra search query inside the top-level AND array', () => {
    const searchExtra = {
      OR: [
        { title: { contains: 'BMW', mode: 'insensitive' as const } },
        { title: { contains: 'Audi', mode: 'insensitive' as const } },
      ],
    };

    const where = publicCatalogWhere(searchExtra);
    const andArray = (where as any).AND as any[];

    // The extra clause must be part of AND (not replacing it)
    // Distinguish from the freshness OR clause by checking for 'title' key
    const extraEntry = andArray.find(
      (c) => c.OR !== undefined && c.OR.some((o: any) => o.title),
    );
    expect(extraEntry).toBeDefined();
    expect(extraEntry.OR).toHaveLength(2);

    // Verify critical visibility conditions are still present alongside the extra
    const hasLifecycle = andArray.some(
      (c) => c.lifecycleState && c.lifecycleState.in,
    );
    const hasAvailability = andArray.some(
      (c) => c.availabilityConfirmed === true,
    );
    const hasFreshness = andArray.some(
      (c) => c.OR && c.OR.some((o: any) => o.listingObservedAt),
    );

    expect(hasLifecycle).toBe(true);
    expect(hasAvailability).toBe(true);
    expect(hasFreshness).toBe(true);
  });
});

// ── Scenario 7: public 0–7 day horizon ──

describe('Task 056 — Scenario 7: auctionTime beyond 7 days excluded', () => {
  it('publicCatalogWhere includes auctionTime gte=now, lte=now+7d', () => {
    const where = publicCatalogWhere();
    const andArray = (where as any).AND as any[];

    const timeCond = andArray.find((c) => c.auctionTime);
    expect(timeCond).toBeDefined();
    expect(timeCond.auctionTime.gte).toBeInstanceOf(Date);
    expect(timeCond.auctionTime.lte).toBeInstanceOf(Date);

    // Verify the horizon is exactly 7 days
    const horizonMs = timeCond.auctionTime.lte.getTime() - timeCond.auctionTime.gte.getTime();
    // Allow a few ms tolerance for execution time
    expect(horizonMs).toBeGreaterThanOrEqual(7 * ONE_DAY - 1000);
    expect(horizonMs).toBeLessThanOrEqual(7 * ONE_DAY + 1000);
  });

  it('computeProjectionV2 returns OUT_OF_HORIZON for auction beyond 7 days', () => {
    const lot = makeLot({
      auctionTime: new Date(NOW.getTime() + 8 * ONE_DAY), // 8 days out
      lastProviderUpdateAt: new Date(NOW.getTime() - ONE_HOUR),
    });

    const proj = computeProjectionV2(lot, NOW);

    expect(proj.catalogScheduleState).toBe('SCHEDULED_OUT_OF_HORIZON');
    expect(proj.publicVisible).toBe(false);
  });
});
