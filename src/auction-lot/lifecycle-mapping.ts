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
 *
 * Priority rules:
 * 1. Terminal provider states (sold, removed, ended/closed) → terminal lifecycle
 * 2. Explicit live provider evidence → LIVE
 * 3. If auction date is in the PAST → ENDED (unless Buy Now is active)
 * 4. If auction date is in the FUTURE → UPCOMING
 * 5. If no date and active state (open/on/bidding) → OPEN
 * 6. Otherwise → NOT_READY
 */
export function normalizeLifecycleState(
  providerRawState: string | null | undefined,
  auctionDate: Date | null | undefined,
  now: Date = new Date(),
  isBuyNow: boolean = false,
  buyNowUsd: number | null = null,
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

  // Explicit live evidence → LIVE (regardless of date)
  if (s === 'live' || s.includes('live')) return AuctionLifecycleState.LIVE;

  // Active states (open/on/bidding)
  // Task 050: A past auctionAt must never remain publicly active.
  // Even with Buy Now, past auction = ENDED. Only provider-confirmed
  // terminal fields may produce SOLD / final price.
  if (s === 'open' || s === 'on' || s.includes('open') || s.includes('bidding')) {
    if (auctionDate && auctionDate <= now) {
      return AuctionLifecycleState.ENDED;
    }
    return AuctionLifecycleState.OPEN;
  }

  // Upcoming — has future auction date
  if (auctionDate && auctionDate > now) return AuctionLifecycleState.UPCOMING;

  // If we have a past date but no terminal state, treat as ended
  // Task 050: No Buy Now rescue — past auction = ENDED
  if (auctionDate && auctionDate <= now) {
    return AuctionLifecycleState.ENDED;
  }

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

  // Task 050: A stale time alone must make the lot stale.
  // Do NOT require consecutive misses before STALE.

  // Past nextRefreshAt → stale
  if (nextRefreshAt && nextRefreshAt < now) {
    return AuctionFreshnessState.STALE;
  }

  // Exceeded stale window — stale by time alone, no miss count needed
  const ageMs = now.getTime() - lastSeenAt.getTime();
  if (ageMs > staleAfterMs) {
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
 * - Non-terminal lifecycle (NOT_READY excluded — needs truthful time or Buy Now)
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
    lifecycleState === AuctionLifecycleState.REMOVED ||
    lifecycleState === AuctionLifecycleState.NOT_READY
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
