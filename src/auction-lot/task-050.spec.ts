/**
 * Task 050 Focused Tests
 */
import { normalizeLifecycleState, computeFreshnessState } from './lifecycle-mapping';
import { AuctionLifecycleState, AuctionFreshnessState } from './types';
import { publicCatalogWhere } from './catalog-quality';
import { priceFact } from './inventory-projection';

describe('Task 050: Stale lifecycle gate', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  it('past auctionAt is ENDED regardless of Buy Now', () => {
    const pastDate = new Date('2026-07-19T12:00:00Z');
    expect(normalizeLifecycleState('open', pastDate, now, true, 5000))
      .toBe(AuctionLifecycleState.ENDED);
  });

  it('future auctionAt with active state is OPEN', () => {
    const futureDate = new Date('2026-07-21T12:00:00Z');
    expect(normalizeLifecycleState('open', futureDate, now, false, null))
      .toBe(AuctionLifecycleState.OPEN);
  });

  it('stale by time alone without consecutive misses', () => {
    const oldSeen = new Date('2026-07-20T11:00:00Z'); // 1h ago
    const future = new Date('2026-07-20T18:00:00Z');
    expect(computeFreshnessState(
      oldSeen, future, 0, true,
      AuctionLifecycleState.OPEN, 15 * 60 * 1000, now, // 15min HOT window
    )).toBe(AuctionFreshnessState.STALE);
  });

  it('publicCatalogWhere excludes past auctionAt', () => {
    const where = publicCatalogWhere();
    expect(where.auctionTime).toBeDefined();
    expect((where.auctionTime as any).gte).toBeDefined();
  });
});

describe('Task 050: Price basis selection', () => {
  it('uses buyNow as primary when available', () => {
    const result = priceFact({
      buyNowUsd: 5000,
      currentBidUsd: 3000,
      isBuyNow: true,
    });
    expect(result.primaryUsd).toBe(5000);
    expect(result.basis).toBe('buyNow');
    expect(result.buyNowAvailable).toBe(true);
  });

  it('uses currentBid when buyNow absent', () => {
    const result = priceFact({
      buyNowUsd: null,
      currentBidUsd: 3000,
      isBuyNow: false,
    });
    expect(result.primaryUsd).toBe(3000);
    expect(result.basis).toBe('currentBid');
    expect(result.buyNowAvailable).toBe(false);
  });

  it('clears buyNow when isBuyNow is false', () => {
    const result = priceFact({
      buyNowUsd: 5000,
      currentBidUsd: 3000,
      isBuyNow: false,
    });
    expect(result.buyNowAvailable).toBe(false);
  });
});
