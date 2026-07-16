// ─────────────────────────────────────────────────────────────
// Strong Auto — Lifecycle Mapping Tests (Task 036 Phase A)
// Tests that fail for missing adapter behavior, lifecycle writing,
// current counters, and normalization rules.
// ─────────────────────────────────────────────────────────────

import {
  normalizeLifecycleState,
  computeFreshnessState,
  isPublicEligible,
  lifecycleToProviderStates,
  STALE_AFTER_MS,
} from './lifecycle-mapping';
import { AuctionLifecycleState, AuctionFreshnessState } from './types';

describe('normalizeLifecycleState', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  const future = new Date('2026-08-01T12:00:00Z');
  const past = new Date('2026-06-01T12:00:00Z');

  it('returns NOT_READY when no state and no date', () => {
    expect(normalizeLifecycleState(null, null, now)).toBe(AuctionLifecycleState.NOT_READY);
    expect(normalizeLifecycleState(undefined, undefined, now)).toBe(AuctionLifecycleState.NOT_READY);
    expect(normalizeLifecycleState('', null, now)).toBe(AuctionLifecycleState.NOT_READY);
  });

  it('returns UPCOMING when no state but future date', () => {
    expect(normalizeLifecycleState(null, future, now)).toBe(AuctionLifecycleState.UPCOMING);
  });

  it('returns ENDED when no state but past date', () => {
    expect(normalizeLifecycleState(null, past, now)).toBe(AuctionLifecycleState.ENDED);
  });

  it('maps SOLD states correctly', () => {
    expect(normalizeLifecycleState('sold', future, now)).toBe(AuctionLifecycleState.SOLD);
    expect(normalizeLifecycleState('Sold', past, now)).toBe(AuctionLifecycleState.SOLD);
    expect(normalizeLifecycleState('SOLD', null, now)).toBe(AuctionLifecycleState.SOLD);
  });

  it('maps REMOVED states correctly', () => {
    expect(normalizeLifecycleState('removed', null, now)).toBe(AuctionLifecycleState.REMOVED);
    expect(normalizeLifecycleState('cancelled', null, now)).toBe(AuctionLifecycleState.REMOVED);
    expect(normalizeLifecycleState('canceled', null, now)).toBe(AuctionLifecycleState.REMOVED);
    expect(normalizeLifecycleState('withdrawn', null, now)).toBe(AuctionLifecycleState.REMOVED);
  });

  it('maps ENDED states correctly', () => {
    expect(normalizeLifecycleState('ended', null, now)).toBe(AuctionLifecycleState.ENDED);
    expect(normalizeLifecycleState('closed', null, now)).toBe(AuctionLifecycleState.ENDED);
  });

  it('maps LIVE states correctly', () => {
    expect(normalizeLifecycleState('live', null, now)).toBe(AuctionLifecycleState.LIVE);
    expect(normalizeLifecycleState('Live', future, now)).toBe(AuctionLifecycleState.LIVE);
  });

  it('maps OPEN states correctly', () => {
    expect(normalizeLifecycleState('open', null, now)).toBe(AuctionLifecycleState.OPEN);
    expect(normalizeLifecycleState('on', null, now)).toBe(AuctionLifecycleState.OPEN);
    expect(normalizeLifecycleState('bidding', null, now)).toBe(AuctionLifecycleState.OPEN);
  });

  it('maps UPCOMING from state string', () => {
    expect(normalizeLifecycleState('upcoming', future, now)).toBe(AuctionLifecycleState.UPCOMING);
    expect(normalizeLifecycleState('pending', future, now)).toBe(AuctionLifecycleState.UPCOMING);
  });

  it('falls back to NOT_READY for unknown state without date', () => {
    expect(normalizeLifecycleState('unknown_status', null, now)).toBe(AuctionLifecycleState.NOT_READY);
  });

  it('handles whitespace and case variations', () => {
    expect(normalizeLifecycleState('  LIVE  ', null, now)).toBe(AuctionLifecycleState.LIVE);
    expect(normalizeLifecycleState('Sold ', null, now)).toBe(AuctionLifecycleState.SOLD);
  });
});

describe('computeFreshnessState', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  const recentSeen = new Date('2026-07-14T11:30:00Z');
  const oldSeen = new Date('2026-07-13T00:00:00Z');
  const futureRefresh = new Date('2026-07-14T18:00:00Z');
  const pastRefresh = new Date('2026-07-14T06:00:00Z');

  it('returns TERMINAL for SOLD lifecycle', () => {
    expect(computeFreshnessState(
      recentSeen, futureRefresh, 0, true,
      AuctionLifecycleState.SOLD, STALE_AFTER_MS.HOT, now,
    )).toBe(AuctionFreshnessState.TERMINAL);
  });

  it('returns TERMINAL for REMOVED lifecycle', () => {
    expect(computeFreshnessState(
      recentSeen, futureRefresh, 0, true,
      AuctionLifecycleState.REMOVED, STALE_AFTER_MS.HOT, now,
    )).toBe(AuctionFreshnessState.TERMINAL);
  });

  it('returns TERMINAL when not confirmed and 3+ misses', () => {
    expect(computeFreshnessState(
      recentSeen, futureRefresh, 3, false,
      AuctionLifecycleState.OPEN, STALE_AFTER_MS.HOT, now,
    )).toBe(AuctionFreshnessState.TERMINAL);
  });

  it('returns STALE when past nextRefreshAt with 2+ misses', () => {
    expect(computeFreshnessState(
      recentSeen, pastRefresh, 2, true,
      AuctionLifecycleState.OPEN, STALE_AFTER_MS.HOT, now,
    )).toBe(AuctionFreshnessState.STALE);
  });

  it('returns STALE when exceeded stale window with 1+ miss', () => {
    expect(computeFreshnessState(
      oldSeen, futureRefresh, 1, true,
      AuctionLifecycleState.OPEN, STALE_AFTER_MS.HOT, now,
    )).toBe(AuctionFreshnessState.STALE);
  });

  it('returns FRESH for recently seen lot with no misses', () => {
    expect(computeFreshnessState(
      recentSeen, futureRefresh, 0, true,
      AuctionLifecycleState.OPEN, STALE_AFTER_MS.HOT, now,
    )).toBe(AuctionFreshnessState.FRESH);
  });

  it('returns FRESH for WARM lot within stale window', () => {
    const warmSeen = new Date('2026-07-14T10:00:00Z'); // 2h ago
    expect(computeFreshnessState(
      warmSeen, futureRefresh, 0, true,
      AuctionLifecycleState.UPCOMING, STALE_AFTER_MS.WARM, now,
    )).toBe(AuctionFreshnessState.FRESH);
  });

  it('returns FRESH for COLD lot within stale window', () => {
    const coldSeen = new Date('2026-07-14T00:00:00Z'); // 12h ago
    expect(computeFreshnessState(
      coldSeen, futureRefresh, 0, true,
      AuctionLifecycleState.NOT_READY, STALE_AFTER_MS.COLD, now,
    )).toBe(AuctionFreshnessState.FRESH);
  });
});

describe('isPublicEligible', () => {
  it('returns false when not availabilityConfirmed', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.OPEN, false, 0,
    )).toBe(false);
  });

  it('returns false when consecutiveMisses >= 3', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.OPEN, true, 3,
    )).toBe(false);
  });

  it('returns false when TERMINAL freshness', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.TERMINAL, AuctionLifecycleState.OPEN, true, 0,
    )).toBe(false);
  });

  it('returns false when STALE freshness', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.STALE, AuctionLifecycleState.OPEN, true, 0,
    )).toBe(false);
  });

  it('returns false for SOLD lifecycle', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.SOLD, true, 0,
    )).toBe(false);
  });

  it('returns false for REMOVED lifecycle', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.REMOVED, true, 0,
    )).toBe(false);
  });

  it('returns true for FRESH OPEN lot with no misses', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.OPEN, true, 0,
    )).toBe(true);
  });

  it('returns true for FRESH UPCOMING lot', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.UPCOMING, true, 1,
    )).toBe(true);
  });

  it('returns true for FRESH LIVE lot', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.LIVE, true, 0,
    )).toBe(true);
  });

  it('returns false for FRESH NOT_READY lot', () => {
    expect(isPublicEligible(
      AuctionFreshnessState.FRESH, AuctionLifecycleState.NOT_READY, true, 0,
    )).toBe(false);
  });
});

describe('lifecycleToProviderStates', () => {
  it('returns upcoming states', () => {
    expect(lifecycleToProviderStates(AuctionLifecycleState.UPCOMING)).toContain('upcoming');
    expect(lifecycleToProviderStates(AuctionLifecycleState.UPCOMING)).toContain('pending');
  });

  it('returns live states', () => {
    expect(lifecycleToProviderStates(AuctionLifecycleState.LIVE)).toContain('live');
  });

  it('returns sold states', () => {
    expect(lifecycleToProviderStates(AuctionLifecycleState.SOLD)).toContain('sold');
  });

  it('returns removed states', () => {
    const states = lifecycleToProviderStates(AuctionLifecycleState.REMOVED);
    expect(states).toContain('removed');
    expect(states).toContain('cancelled');
  });
});

describe('STALE_AFTER_MS', () => {
  it('HOT is 15 minutes', () => {
    expect(STALE_AFTER_MS.HOT).toBe(15 * 60 * 1000);
  });

  it('WARM is 3 hours', () => {
    expect(STALE_AFTER_MS.WARM).toBe(3 * 60 * 60 * 1000);
  });

  it('COLD is 12 hours', () => {
    expect(STALE_AFTER_MS.COLD).toBe(12 * 60 * 60 * 1000);
  });
});
