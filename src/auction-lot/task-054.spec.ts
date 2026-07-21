// ─────────────────────────────────────────────────────────────
// Task 054: Observation Resolver + Freshness Fallback + runCondition
// ─────────────────────────────────────────────────────────────

import {
  resolveListingObservedAt,
  resolvePriceObservedAt,
  resolveObservations,
} from './observation-resolver';
import {
  deriveListingFreshness,
  derivePriceFreshness,
  computeProjectionV2,
} from './projection-v2';

const NOW = new Date('2026-07-21T06:48:52.000Z');
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

// ── Observation Resolver ─────────────────────────────────────

describe('Task 054: resolveListingObservedAt', () => {
  it('uses listingObservedAt when present', () => {
    const listing = new Date(NOW.getTime() - ONE_HOUR);
    const result = resolveListingObservedAt({
      listingObservedAt: listing,
      priceObservedAt: null,
      lastProviderUpdateAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
      availabilityConfirmedAt: null,
      currentBidUsd: null,
      buyNowUsd: null,
    });
    expect(result).toEqual(listing);
  });

  it('falls back to lastProviderUpdateAt when listingObservedAt is null', () => {
    const provider = new Date(NOW.getTime() - 2 * ONE_HOUR);
    const result = resolveListingObservedAt({
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: provider,
      availabilityConfirmedAt: null,
      currentBidUsd: null,
      buyNowUsd: null,
    });
    expect(result).toEqual(provider);
  });

  it('falls back to availabilityConfirmedAt when both listingObservedAt and lastProviderUpdateAt are null', () => {
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

  it('returns null when no valid evidence exists', () => {
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

  it('never uses firstSeenAt (not in input)', () => {
    // Verify that even with all null V2/provider fields, we get null, not a fallback to firstSeen
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

describe('Task 054: resolvePriceObservedAt', () => {
  it('uses priceObservedAt when present', () => {
    const price = new Date(NOW.getTime() - ONE_HOUR);
    const result = resolvePriceObservedAt({
      listingObservedAt: null,
      priceObservedAt: price,
      lastProviderUpdateAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
      availabilityConfirmedAt: null,
      currentBidUsd: 5000,
      buyNowUsd: null,
    });
    expect(result).toEqual(price);
  });

  it('falls back to lastProviderUpdateAt when pricing evidence exists', () => {
    const provider = new Date(NOW.getTime() - 2 * ONE_HOUR);
    const result = resolvePriceObservedAt({
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: provider,
      availabilityConfirmedAt: null,
      currentBidUsd: 5000,
      buyNowUsd: null,
    });
    expect(result).toEqual(provider);
  });

  it('does NOT fall back to lastProviderUpdateAt when no pricing evidence', () => {
    const result = resolvePriceObservedAt({
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: new Date(NOW.getTime() - ONE_HOUR),
      availabilityConfirmedAt: null,
      currentBidUsd: null,
      buyNowUsd: null,
    });
    expect(result).toBeNull();
  });
});

// ── computeProjectionV2 with resolver fallback ───────────────

describe('Task 054: computeProjectionV2 with resolver fallback', () => {
  it('lot 46365656 scenario: listingObservedAt=null, lastProviderUpdateAt=2h ago → FRESH', () => {
    // This is the exact scenario of the bug: lot 46365656
    const auctionAt = new Date('2026-07-21T14:00:00.000Z'); // ~7h from NOW
    const providerObs = new Date('2026-07-21T04:57:49.000Z'); // ~2h ago
    const v2 = computeProjectionV2({
      auctionTime: auctionAt,
      providerResultState: 'UNKNOWN',
      listingObservedAt: null,   // V2 field missing
      priceObservedAt: null,     // V2 field missing
      lastProviderUpdateAt: providerObs,  // ← fallback source
      availabilityConfirmedAt: null,
      buyNowUsd: null,
      currentBidUsd: 5000 as any,       // has pricing
    }, NOW);

    // With resolver: listingObservedAt falls back to lastProviderUpdateAt (2h ago)
    // → 2h < 48h → FRESH
    expect(v2.listingFreshness).toBe('FRESH');
    expect(v2.catalogScheduleState).toBe('SCHEDULED_ACTIVE');
    expect(v2.publicVisible).toBe(true);
    expect(v2.reasonCode.code).not.toBe('STALE_LISTING');
  });

  it('all null observation fields → STALE_LISTING (no fallback possible)', () => {
    const v2 = computeProjectionV2({
      auctionTime: new Date(NOW.getTime() + ONE_DAY),
      providerResultState: 'UNKNOWN',
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: null,
      availabilityConfirmedAt: null,
      buyNowUsd: null,
      currentBidUsd: null,
    }, NOW);

    expect(v2.listingFreshness).toBe('STALE');
    expect(v2.reasonCode.code).toBe('STALE_LISTING');
  });

  it('availabilityConfirmedAt fallback works for listing freshness', () => {
    const confirmed = new Date(NOW.getTime() - 5 * ONE_HOUR);
    const v2 = computeProjectionV2({
      auctionTime: new Date(NOW.getTime() + ONE_DAY),
      providerResultState: 'UNKNOWN',
      listingObservedAt: null,
      priceObservedAt: null,
      lastProviderUpdateAt: null,
      availabilityConfirmedAt: confirmed,
      buyNowUsd: null,
      currentBidUsd: null,
    }, NOW);

    expect(v2.listingFreshness).toBe('FRESH');
    expect(v2.reasonCode.code).not.toBe('STALE_LISTING');
  });

  it('listing fresh via V2 field (no fallback needed)', () => {
    const listing = new Date(NOW.getTime() - ONE_HOUR);
    const v2 = computeProjectionV2({
      auctionTime: new Date(NOW.getTime() + ONE_DAY),
      providerResultState: 'UNKNOWN',
      listingObservedAt: listing,
      priceObservedAt: listing,
      lastProviderUpdateAt: null,
      availabilityConfirmedAt: null,
      buyNowUsd: null,
      currentBidUsd: null,
    }, NOW);

    expect(v2.listingFreshness).toBe('FRESH');
    expect(v2.reasonCode.code).toBe('OK'); // price timestamp exists & fresh
  });
});
