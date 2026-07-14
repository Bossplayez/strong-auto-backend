// ─────────────────────────────────────────────────────────────
// Strong Auto — Lifecycle Normalization (Task 036)
// Single tested function that maps provider-specific auction
// state strings to internal AuctionLifecycleState.
// Never invents timezone, lifecycle or freshness.
// ─────────────────────────────────────────────────────────────

import { AuctionLifecycleState, AuctionFreshnessState } from './types';

/**
 * Provider state → internal lifecycle mapping.
 * Each provider may use different strings for the same concept.
 * This function is the ONLY place where this mapping happens.
 */
export function normalizeLifecycleState(
  providerRawState: string | null | undefined,
  auctionDate: Date | null | undefined,
  now: Date = new Date(),
): AuctionLifecycleState {
  if (!providerRawState) {
    // No state string — rely on auction date
    if (!auctionDate) return AuctionLifecycleState.NOT_READY;
    return auctionDate > now
      ? AuctionLifecycleState.UPCOMING
      : AuctionLifecycleState.ENDED;
  }

  const s = providerRawState.toLowerCase().trim();

  // Terminal states
  if (s === 'sold' || s.includes('sold')) return AuctionLifecycleState.SOLD;
  if (s === 'removed' || s === 'cancelled' || s === 'canceled' || s.includes('withdrawn'))
    return AuctionLifecycleState.REMOVED;
  if (s === 'ended' || s.includes('ended') || s.includes('closed'))
    return AuctionLifecycleState.ENDED;

  // Active states
  if (s === 'live' || s.includes('live')) return AuctionLifecycleState.LIVE;
  if (s === 'open' || s === 'on' || s.includes('open') || s.includes('bidding'))
    return AuctionLifecycleState.OPEN;

  // Upcoming — has future auction date
  if (auctionDate && auctionDate > now) return AuctionLifecycleState.UPCOMING;

  // If we have a past date but no terminal state, treat as ended
  if (auctionDate && auctionDate <= now) return AuctionLifecycleState.ENDED;

  // No date, unknown state
  return AuctionLifecycleState.NOT_READY;
}

/**
 * Determine freshness state from observed fields.
 * Only tested rules mark stale/terminal — never guessed.
 */
export function computeFreshnessState(
  lastSeenAt: Date,
  nextRefreshAt: Date | null,
  consecutiveMisses: number,
  availabilityConfirmed: boolean,
  lifecycleState: AuctionLifecycleState,
  staleAfterMs: number,
  now: Date = new Date(),
): AuctionFreshnessState {
  // Terminal lifecycle → terminal freshness
  if (
    lifecycleState === AuctionLifecycleState.SOLD ||
    lifecycleState === AuctionLifecycleState.REMOVED
  ) {
    return AuctionFreshnessState.TERMINAL;
  }

  // Too many misses without confirmation → terminal
  if (!availabilityConfirmed && consecutiveMisses >= 3) {
    return AuctionFreshnessState.TERMINAL;
  }

  // Past nextRefreshAt with misses → stale
  if (nextRefreshAt && nextRefreshAt < now && consecutiveMisses >= 2) {
    return AuctionFreshnessState.STALE;
  }

  // Exceeded stale window
  const ageMs = now.getTime() - lastSeenAt.getTime();
  if (ageMs > staleAfterMs && consecutiveMisses >= 1) {
    return AuctionFreshnessState.STALE;
  }

  // Default fresh
  return AuctionFreshnessState.FRESH;
}

/**
 * Default stale-after duration: 6 hours in ms.
 * HOT lots: 15min, WARM: 3h, COLD: 12h.
 */
export const STALE_AFTER_MS = {
  HOT: 15 * 60 * 1000,
  WARM: 3 * 60 * 60 * 1000,
  COLD: 12 * 60 * 60 * 1000,
} as const;

/**
 * Check if a lot is public-eligible:
 * - FRESH freshness
 * - Non-terminal lifecycle
 * - availabilityConfirmed = true
 * - consecutiveMisses < 3
 */
export function isPublicEligible(
  freshnessState: AuctionFreshnessState,
  lifecycleState: AuctionLifecycleState,
  availabilityConfirmed: boolean,
  consecutiveMisses: number,
): boolean {
  if (!availabilityConfirmed) return false;
  if (consecutiveMisses >= 3) return false;
  if (freshnessState === AuctionFreshnessState.TERMINAL) return false;
  if (freshnessState === AuctionFreshnessState.STALE) return false;
  if (
    lifecycleState === AuctionLifecycleState.SOLD ||
    lifecycleState === AuctionLifecycleState.REMOVED
  )
    return false;
  return true;
}

/**
 * Map lifecycle state to the set of provider auction states
 * that should be queried for each lifecycle filter.
 * Used by discovery partitions and public API filters.
 */
export function lifecycleToProviderStates(
  state: AuctionLifecycleState,
): string[] {
  switch (state) {
    case AuctionLifecycleState.NOT_READY:
      return [''];
    case AuctionLifecycleState.UPCOMING:
      return ['upcoming', 'pending', 'scheduled'];
    case AuctionLifecycleState.OPEN:
      return ['open', 'on', 'bidding'];
    case AuctionLifecycleState.LIVE:
      return ['live', 'on'];
    case AuctionLifecycleState.ENDED:
      return ['ended', 'closed'];
    case AuctionLifecycleState.SOLD:
      return ['sold'];
    case AuctionLifecycleState.REMOVED:
      return ['removed', 'cancelled', 'canceled', 'withdrawn'];
    default:
      return [];
  }
}
