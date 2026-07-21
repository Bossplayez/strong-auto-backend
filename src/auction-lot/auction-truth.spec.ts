import {
  AUCTION_HORIZON_MS,
  LISTING_FRESH_WINDOW_MS,
  deriveAuctionLifecycle,
  evaluateAuctionTruth,
  freshAuctionPriceWhere,
  hasFreshAuctionPrice,
  publicCatalogWhere,
} from './public-eligibility';
import { Prisma } from '@prisma/client';
import { providerResultStateFromRaw } from './lifecycle-mapping';
import { computeProjectionV2 } from './projection-v2';

const now = new Date('2026-07-21T12:00:00.000Z');
const base = () => ({
  auctionTime: new Date(now.getTime() + 60_000),
  providerResultState: 'UNKNOWN',
  listingObservedAt: new Date(now.getTime() - LISTING_FRESH_WINDOW_MS),
  lastProviderUpdateAt: null,
  availabilityConfirmed: true,
  lastSeenAt: now,
  state: 'DISCOVERED',
  consecutiveMisses: 0,
});

describe('auction truth policy', () => {
  it.each([
    [0, true],
    [1, true],
    [-1, false],
  ])('uses an inclusive 48h listing boundary (%ims)', (delta, visible) => {
    const lot = base();
    lot.listingObservedAt = new Date(now.getTime() - LISTING_FRESH_WINDOW_MS + delta);
    expect(evaluateAuctionTruth(lot, now).publicVisible).toBe(visible);
  });

  it.each([
    [0, true],
    [AUCTION_HORIZON_MS - 1, true],
    [AUCTION_HORIZON_MS, false],
    [-1, false],
  ])('uses [now, now+7d) auction boundaries (%ims)', (offset, visible) => {
    const lot = base();
    lot.auctionTime = new Date(now.getTime() + offset);
    expect(evaluateAuctionTruth(lot, now).publicVisible).toBe(visible);
  });

  it.each(['SOLD', 'UNSOLD', 'REMOVED'])('excludes explicit terminal provider result %s', (providerResultState) => {
    expect(evaluateAuctionTruth({ ...base(), providerResultState }, now).reasonCode).toBe('TERMINAL_RESULT');
  });

  it('marks elapsed unknown result pending and never consults legacy lifecycle/freshness', () => {
    expect(evaluateAuctionTruth({ ...base(), auctionTime: new Date(now.getTime() - 1) }, now).reasonCode).toBe('RESULT_PENDING');
  });

  it('keeps an explicit pending result out of every public surface even when the schedule is future-dated', () => {
    const lot = { ...base(), providerResultState: 'RESULT_PENDING' };
    expect(evaluateAuctionTruth(lot, now)).toEqual({ publicVisible: false, reasonCode: 'RESULT_PENDING' });
    expect(deriveAuctionLifecycle(lot, now)).toBe('ENDED');
  });

  it('does not expose a legacy ENDED scheduler value as a terminal auction result', () => {
    expect(deriveAuctionLifecycle({ ...base(), lifecycleState: 'ENDED', auctionState: 'OPEN' }, now)).toBe('UPCOMING');
    expect(deriveAuctionLifecycle({ ...base(), auctionTime: new Date(now.getTime() + AUCTION_HORIZON_MS), lifecycleState: 'ENDED' }, now)).toBe('UPCOMING');
    expect(deriveAuctionLifecycle({ ...base(), auctionTime: new Date(now.getTime() - 1), lifecycleState: 'OPEN' }, now)).toBe('ENDED');
    expect(deriveAuctionLifecycle({ ...base(), providerResultState: 'SOLD', lifecycleState: 'OPEN' }, now)).toBe('SOLD');
  });

  it('uses only the observation fallback chain and rejects unavailable lots', () => {
    const fallback = { ...base(), listingObservedAt: null, lastProviderUpdateAt: new Date(now.getTime() - 1) };
    expect(evaluateAuctionTruth(fallback, now).publicVisible).toBe(true);
    expect(evaluateAuctionTruth({ ...fallback, lastProviderUpdateAt: null, lastSeenAt: new Date(now.getTime() - 1) }, now).publicVisible).toBe(true);
    expect(evaluateAuctionTruth({ ...base(), availabilityConfirmed: false }, now).reasonCode).toBe('UNAVAILABLE');
  });

  it('builds a matching exclusive upper horizon predicate', () => {
    const where = publicCatalogWhere(undefined, now);
    const rules = where.AND as Array<Record<string, unknown>>;
    expect(rules).toContainEqual({ auctionTime: { gte: now, lt: new Date(now.getTime() + AUCTION_HORIZON_MS) } });
    expect(JSON.stringify(where)).not.toContain('freshnessState');
    expect(JSON.stringify(where)).not.toContain('lifecycleState');
  });

  it('keeps elapsed provider-unknown records pending and applies separate V2 price freshness', () => {
    expect(providerResultStateFromRaw('ended', new Date(now.getTime() - 1), now)).toBe('RESULT_PENDING');
    const projection = computeProjectionV2({
      auctionTime: new Date(now.getTime() + 60_000),
      providerResultState: 'UNKNOWN',
      listingObservedAt: now,
      priceObservedAt: null,
      lastProviderUpdateAt: now,
      availabilityConfirmedAt: now,
      currentBidUsd: new Prisma.Decimal(100),
      buyNowUsd: null,
    }, now);
    expect(projection.publicVisible).toBe(true);
    expect(projection.showPriceAndCta).toBe(true);
  });

  it('requires price evidence for public price filtering without hiding the listing itself', () => {
    const lot = {
      auctionTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      priceObservedAt: new Date(now.getTime() - 5 * 60 * 60 * 1000),
      lastProviderUpdateAt: null,
      currentBidUsd: 100,
      buyNowUsd: null,
    };
    expect(hasFreshAuctionPrice(lot, now)).toBe(true);
    expect(hasFreshAuctionPrice({ ...lot, priceObservedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000 - 1) }, now)).toBe(false);
    const where = freshAuctionPriceWhere(now);
    expect(JSON.stringify(where)).toContain('priceObservedAt');
    expect(evaluateAuctionTruth({ ...base(), listingObservedAt: now }, now).publicVisible).toBe(true);
  });

  it('uses fresh provider observation as price evidence only when a real price exists', () => {
    const lot = {
      auctionTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      priceObservedAt: null,
      lastProviderUpdateAt: new Date(now.getTime() - 5 * 60 * 60 * 1000),
      currentBidUsd: 1250,
      buyNowUsd: null,
    };
    expect(hasFreshAuctionPrice(lot, now)).toBe(true);
    expect(hasFreshAuctionPrice({ ...lot, currentBidUsd: null }, now)).toBe(false);
  });
});
