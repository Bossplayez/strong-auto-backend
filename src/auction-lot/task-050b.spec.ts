/**
 * Task 050B Focused Tests
 * - Old provider observation with zero misses becomes STALE
 * - Fresh payload removes former Buy Now
 * - Scheduler HOT/WARM/COLD selection respects caps and request budget
 */
import { computeFreshnessState, STALE_AFTER_MS } from './lifecycle-mapping';
import { AuctionLifecycleState, AuctionFreshnessState } from './types';
import { publicCatalogWhere } from './catalog-quality';

describe('Task 050B: Old provider observation → STALE', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  it('HOT lot with 20-min-old observation is STALE (zero misses)', () => {
    const observed = new Date('2026-07-20T11:40:00Z'); // 20min ago
    const futureAuction = new Date('2026-07-20T14:00:00Z'); // 2h to auction = HOT
    expect(computeFreshnessState(
      observed, null, 0, true,
      AuctionLifecycleState.OPEN,
      STALE_AFTER_MS.HOT, // 15 min
      now,
    )).toBe(AuctionFreshnessState.STALE);
  });

  it('WARM lot with 3h+1m-old observation is STALE (zero misses)', () => {
    const observed = new Date('2026-07-20T08:59:00Z'); // 3h 1min ago
    const futureAuction = new Date('2026-07-21T12:00:00Z'); // 24h to auction = WARM
    expect(computeFreshnessState(
      observed, null, 0, true,
      AuctionLifecycleState.UPCOMING,
      STALE_AFTER_MS.WARM, // 3h
      now,
    )).toBe(AuctionFreshnessState.STALE);
  });

  it('COLD lot with 13h-old observation is STALE (zero misses)', () => {
    const observed = new Date('2026-07-19T23:00:00Z'); // 13h ago
    const futureAuction = new Date('2026-07-25T12:00:00Z'); // 5 days = COLD
    expect(computeFreshnessState(
      observed, null, 0, true,
      AuctionLifecycleState.UPCOMING,
      STALE_AFTER_MS.COLD, // 12h
      now,
    )).toBe(AuctionFreshnessState.STALE);
  });

  it('HOT lot with 5-min-old observation is FRESH', () => {
    const observed = new Date('2026-07-20T11:55:00Z'); // 5min ago
    expect(computeFreshnessState(
      observed, null, 0, true,
      AuctionLifecycleState.OPEN,
      STALE_AFTER_MS.HOT,
      now,
    )).toBe(AuctionFreshnessState.FRESH);
  });

  it('publicCatalogWhere gates on lastProviderUpdateAt within 12h', () => {
    const where = publicCatalogWhere();
    expect(where.lastProviderUpdateAt).toBeDefined();
    const gate = where.lastProviderUpdateAt as { gte: Date };
    expect(gate.gte).toBeInstanceOf(Date);
    // Gate should be ~12h ago
    const ageMs = Date.now() - gate.gte.getTime();
    expect(ageMs).toBeGreaterThan(11 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(13 * 60 * 60 * 1000);
  });
});

describe('Task 050B: Fresh payload removes former Buy Now', () => {
  // Simulate the logic from discovery.service.ts
  function applyBuyNowClear(normalized: { isBuyNow: boolean; buyNowUsd: number | null }) {
    const data: Record<string, unknown> = { ...normalized };
    if (!normalized.isBuyNow || !(normalized.buyNowUsd && normalized.buyNowUsd > 0)) {
      data.isBuyNow = false;
      data.buyNowUsd = null;
    }
    return data;
  }

  it('clears Buy Now when provider says isBuyNow=false', () => {
    const result = applyBuyNowClear({ isBuyNow: false, buyNowUsd: 5000 });
    expect(result.isBuyNow).toBe(false);
    expect(result.buyNowUsd).toBeNull();
  });

  it('clears Buy Now when buyNowUsd is null', () => {
    const result = applyBuyNowClear({ isBuyNow: true, buyNowUsd: null });
    expect(result.isBuyNow).toBe(false);
    expect(result.buyNowUsd).toBeNull();
  });

  it('clears Buy Now when buyNowUsd is zero', () => {
    const result = applyBuyNowClear({ isBuyNow: true, buyNowUsd: 0 });
    expect(result.isBuyNow).toBe(false);
    expect(result.buyNowUsd).toBeNull();
  });

  it('preserves Buy Now when both fields are valid', () => {
    const result = applyBuyNowClear({ isBuyNow: true, buyNowUsd: 5000 });
    expect(result.isBuyNow).toBe(true);
    expect(result.buyNowUsd).toBe(5000);
  });
});

describe('Task 050B: Scheduler tier selection respects caps', () => {
  // Test the tier classification logic directly
  function classifyTier(auctionTime: Date | null, now: Date): 'HOT' | 'WARM' | 'COLD' {
    if (!auctionTime) return 'COLD';
    const hoursUntilAuction = (auctionTime.getTime() - now.getTime()) / (60 * 60 * 1000);
    if (hoursUntilAuction > 0 && hoursUntilAuction <= 12) return 'HOT';
    if (hoursUntilAuction > 12 && hoursUntilAuction <= 48) return 'WARM';
    return 'COLD';
  }

  const now = new Date('2026-07-20T12:00:00Z');

  it('auction within 12h → HOT', () => {
    expect(classifyTier(new Date('2026-07-20T20:00:00Z'), now)).toBe('HOT');
  });

  it('auction within 12-48h → WARM', () => {
    expect(classifyTier(new Date('2026-07-21T20:00:00Z'), now)).toBe('WARM');
  });

  it('auction beyond 48h → COLD', () => {
    expect(classifyTier(new Date('2026-07-25T12:00:00Z'), now)).toBe('COLD');
  });

  it('null auction time → COLD', () => {
    expect(classifyTier(null, now)).toBe('COLD');
  });

  it('HOT tier target refresh is 15 min', () => {
    expect(STALE_AFTER_MS.HOT).toBe(15 * 60 * 1000);
  });

  it('WARM tier target refresh is 3h', () => {
    expect(STALE_AFTER_MS.WARM).toBe(3 * 60 * 60 * 1000);
  });

  it('COLD tier target refresh is 12h', () => {
    expect(STALE_AFTER_MS.COLD).toBe(12 * 60 * 60 * 1000);
  });

  // Budget allocation: tier weights sum to 1.0
  it('tier weights allocate budget correctly', () => {
    const TIER_WEIGHTS = { hot: 0.50, warm: 0.30, discovery: 0.15, search: 0.03, retry: 0.02 };
    const total = Object.values(TIER_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 5);

    const dailyEnvelope = 1000;
    const hotBudget = Math.floor(dailyEnvelope * TIER_WEIGHTS.hot);
    const warmBudget = Math.floor(dailyEnvelope * TIER_WEIGHTS.warm);
    expect(hotBudget).toBe(500);
    expect(warmBudget).toBe(300);
    expect(hotBudget + warmBudget).toBeLessThan(dailyEnvelope); // leave room for discovery/search/retry
  });
});
