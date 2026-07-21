// Task 053: Auction Truth Contract V2 — focused tests
import { normalizeAuctionTimestamp } from './time-normalization';
import {
  computeProjectionV2,
  deriveCatalogScheduleState,
  deriveListingFreshness,
  derivePriceFreshness,
  isPublicV2Enabled,
} from './projection-v2';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

// ── Time normalization tests ──────────────────────────────

describe('Task 053: Strict time normalization', () => {
  it('accepts RFC3339 with Z suffix', () => {
    const r = normalizeAuctionTimestamp('2026-07-25T15:00:00.000Z');
    expect(r.evidence).toBe('UTC_OFFSET');
    expect(r.auctionAtUtc).not.toBeNull();
    expect(r.auctionAtUtc!.toISOString()).toBe('2026-07-25T15:00:00.000Z');
  });

  it('accepts explicit numeric offset', () => {
    const r = normalizeAuctionTimestamp('2026-07-25T10:00:00-05:00');
    expect(r.evidence).toBe('UTC_OFFSET');
    expect(r.auctionAtUtc!.toISOString()).toBe('2026-07-25T15:00:00.000Z');
  });

  it('rejects date-only values', () => {
    const r = normalizeAuctionTimestamp('2026-07-20');
    expect(r.evidence).toBe('NONE');
    expect(r.auctionAtUtc).toBeNull();
  });

  it('rejects local datetime without timezone evidence', () => {
    const r = normalizeAuctionTimestamp('2026-07-20T15:00:00');
    expect(r.evidence).toBe('NONE');
    expect(r.auctionAtUtc).toBeNull();
  });

  it('accepts local datetime with known facility state timezone', () => {
    const r = normalizeAuctionTimestamp('2026-07-20T10:00:00', 'CA');
    expect(r.evidence).toBe('PROVIDER_TIMEZONE');
    expect(r.auctionAtUtc).not.toBeNull();
    // California is UTC-7 in July (PDT)
    // So 10:00 local = 17:00 UTC
    expect(r.auctionAtUtc!.toISOString()).toBe('2026-07-20T17:00:00.000Z');
  });

  it('preserves raw timestamp for diagnostics', () => {
    const r = normalizeAuctionTimestamp('2026-07-20T10:00:00-05:00');
    expect(r.raw).toBe('2026-07-20T10:00:00-05:00');
  });

  it('rejects null/undefined input', () => {
    expect(normalizeAuctionTimestamp(null).evidence).toBe('NONE');
    expect(normalizeAuctionTimestamp(undefined).evidence).toBe('NONE');
  });
});

// ── Schedule state derivation tests ─────────────────────────

describe('Task 053: Catalog schedule state', () => {
  it('SCHEDULED_ACTIVE for auction within 7 days', () => {
    const future = new Date(NOW.getTime() + 3 * ONE_DAY);
    const r = deriveCatalogScheduleState(future, 'UNKNOWN', NOW);
    expect(r.schedule).toBe('SCHEDULED_ACTIVE');
    expect(r.isResultPending).toBe(false);
    expect(r.isTerminal).toBe(false);
  });

  it('SCHEDULED_OUT_OF_HORIZON for auction beyond 7 days', () => {
    const far = new Date(NOW.getTime() + 10 * ONE_DAY);
    const r = deriveCatalogScheduleState(far, 'UNKNOWN', NOW);
    expect(r.schedule).toBe('SCHEDULED_OUT_OF_HORIZON');
  });

  it('RESULT_PENDING for past auction with UNKNOWN result', () => {
    const past = new Date(NOW.getTime() - ONE_HOUR);
    const r = deriveCatalogScheduleState(past, 'UNKNOWN', NOW);
    expect(r.schedule).toBe('UNSCHEDULED');
    expect(r.isResultPending).toBe(true);
  });

  it('UNSCHEDULED for null auction time', () => {
    const r = deriveCatalogScheduleState(null, 'UNKNOWN', NOW);
    expect(r.schedule).toBe('UNSCHEDULED');
    expect(r.isResultPending).toBe(false);
  });

  it('terminal provider result takes priority over past time', () => {
    const past = new Date(NOW.getTime() - ONE_HOUR);
    const r = deriveCatalogScheduleState(past, 'SOLD', NOW);
    expect(r.isTerminal).toBe(true);
    expect(r.schedule).toBe('UNSCHEDULED');
    expect(r.isResultPending).toBe(false);
  });

  it('past time never produces SOLD automatically', () => {
    const past = new Date(NOW.getTime() - ONE_HOUR);
    const r = deriveCatalogScheduleState(past, 'UNKNOWN', NOW);
    expect(r.isTerminal).toBe(false);
    // RESULT_PENDING, not SOLD
    expect(r.isResultPending).toBe(true);
  });

  it('all state transitions', () => {
    const t = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
    expect(deriveCatalogScheduleState(t(-ONE_HOUR), 'UNKNOWN', NOW).schedule).toBe('UNSCHEDULED');
    expect(deriveCatalogScheduleState(t(0), 'UNKNOWN', NOW).schedule).toBe('SCHEDULED_ACTIVE');
    expect(deriveCatalogScheduleState(t(ONE_HOUR), 'UNKNOWN', NOW).schedule).toBe('SCHEDULED_ACTIVE');
    expect(deriveCatalogScheduleState(t(6 * ONE_DAY), 'UNKNOWN', NOW).schedule).toBe('SCHEDULED_ACTIVE');
    expect(deriveCatalogScheduleState(t(7 * ONE_DAY), 'UNKNOWN', NOW).schedule).toBe('SCHEDULED_OUT_OF_HORIZON');
    expect(deriveCatalogScheduleState(t(30 * ONE_DAY), 'UNKNOWN', NOW).schedule).toBe('SCHEDULED_OUT_OF_HORIZON');
    expect(deriveCatalogScheduleState(null, 'UNKNOWN', NOW).schedule).toBe('UNSCHEDULED');
  });
});

// ── Listing freshness tests ───────────────────────────────

describe('Task 053: Listing freshness', () => {
  it('FRESH when observed within 48h', () => {
    const observed = new Date(NOW.getTime() - 24 * ONE_HOUR);
    expect(deriveListingFreshness(observed, NOW)).toBe('FRESH');
  });

  it('FRESH at exactly 48h boundary', () => {
    const observed = new Date(NOW.getTime() - 48 * ONE_HOUR);
    expect(deriveListingFreshness(observed, NOW)).toBe('FRESH');
  });

  it('STALE when older than 48h', () => {
    const observed = new Date(NOW.getTime() - 49 * ONE_HOUR);
    expect(deriveListingFreshness(observed, NOW)).toBe('STALE');
  });

  it('STALE when listingObservedAt is null', () => {
    expect(deriveListingFreshness(null, NOW)).toBe('STALE');
  });
});

// ── Price freshness tests ─────────────────────────────────

describe('Task 053: Price freshness', () => {
  it('FRESH for auction within 24h, price within 6h', () => {
    const auction = new Date(NOW.getTime() + 12 * ONE_HOUR);
    const price = new Date(NOW.getTime() - 3 * ONE_HOUR);
    expect(derivePriceFreshness(price, auction, NOW)).toBe('FRESH');
  });

  it('MISSING_OR_STALE for auction within 24h, price older than 6h', () => {
    const auction = new Date(NOW.getTime() + 12 * ONE_HOUR);
    const price = new Date(NOW.getTime() - 7 * ONE_HOUR);
    expect(derivePriceFreshness(price, auction, NOW)).toBe('MISSING_OR_STALE');
  });

  it('FRESH for auction in 2 days, price within 12h', () => {
    const auction = new Date(NOW.getTime() + 2 * ONE_DAY);
    const price = new Date(NOW.getTime() - 8 * ONE_HOUR);
    expect(derivePriceFreshness(price, auction, NOW)).toBe('FRESH');
  });

  it('MISSING_OR_STALE for auction in 2 days, price older than 12h', () => {
    const auction = new Date(NOW.getTime() + 2 * ONE_DAY);
    const price = new Date(NOW.getTime() - 13 * ONE_HOUR);
    expect(derivePriceFreshness(price, auction, NOW)).toBe('MISSING_OR_STALE');
  });

  it('MISSING_OR_STALE when priceObservedAt is null', () => {
    expect(derivePriceFreshness(null, null, NOW)).toBe('MISSING_OR_STALE');
  });
});

// ── Full Projection V2 tests ──────────────────────────────

describe('Task 053: Full Projection V2', () => {
  it('OK state for active + fresh listing + fresh price', () => {
    const auction = new Date(NOW.getTime() + 2 * ONE_DAY);
    const listing = new Date(NOW.getTime() - ONE_HOUR);
    const price = new Date(NOW.getTime() - ONE_HOUR);
    const v2 = computeProjectionV2({
      auctionTime: auction, providerResultState: 'UNKNOWN',
      listingObservedAt: listing, priceObservedAt: price,
      lastProviderUpdateAt: null, availabilityConfirmedAt: null,
      buyNowUsd: null, currentBidUsd: null,
    }, NOW);
    expect(v2.publicVisible).toBe(true);
    expect(v2.showPriceAndCta).toBe(true);
    expect(v2.reasonCode.code).toBe('OK');
  });

  it('STALE_PRICE hides price/CTA but keeps visible', () => {
    const auction = new Date(NOW.getTime() + 2 * ONE_DAY);
    const listing = new Date(NOW.getTime() - ONE_HOUR);
    const v2 = computeProjectionV2({
      auctionTime: auction, providerResultState: 'UNKNOWN',
      listingObservedAt: listing, priceObservedAt: null,
      lastProviderUpdateAt: null, availabilityConfirmedAt: null,
      buyNowUsd: null, currentBidUsd: null,
    }, NOW);
    expect(v2.publicVisible).toBe(true);
    expect(v2.showPriceAndCta).toBe(false);
    expect(v2.reasonCode.code).toBe('STALE_PRICE');
  });

  it('STALE_LISTING hides from browsing', () => {
    const auction = new Date(NOW.getTime() + 2 * ONE_DAY);
    const v2 = computeProjectionV2({
      auctionTime: auction, providerResultState: 'UNKNOWN',
      listingObservedAt: null, priceObservedAt: null,
      lastProviderUpdateAt: null, availabilityConfirmedAt: null,
      buyNowUsd: null, currentBidUsd: null,
    }, NOW);
    expect(v2.publicVisible).toBe(false);
    expect(v2.reasonCode.code).toBe('STALE_LISTING');
  });

  it('RESULT_PENDING hidden from browsing', () => {
    const past = new Date(NOW.getTime() - ONE_HOUR);
    const v2 = computeProjectionV2({
      auctionTime: past, providerResultState: 'UNKNOWN',
      listingObservedAt: new Date(NOW.getTime() - ONE_HOUR), priceObservedAt: new Date(NOW.getTime() - ONE_HOUR),
      lastProviderUpdateAt: null, availabilityConfirmedAt: null,
      buyNowUsd: null, currentBidUsd: null,
    }, NOW);
    expect(v2.publicVisible).toBe(false);
    expect(v2.reasonCode.code).toBe('RESULT_PENDING');
  });

  it('Terminal result hidden from browsing', () => {
    const v2 = computeProjectionV2({
      auctionTime: null, providerResultState: 'SOLD',
      listingObservedAt: new Date(NOW.getTime() - ONE_HOUR), priceObservedAt: new Date(NOW.getTime() - ONE_HOUR),
      lastProviderUpdateAt: null, availabilityConfirmedAt: null,
      buyNowUsd: null, currentBidUsd: null,
    }, NOW);
    expect(v2.publicVisible).toBe(false);
    expect(v2.reasonCode.code).toBe('TERMINAL_RESULT');
  });

  it('Public V2 flag is off by default', () => {
    expect(isPublicV2Enabled()).toBe(false);
  });
});
