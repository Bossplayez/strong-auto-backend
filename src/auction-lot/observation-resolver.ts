// ─────────────────────────────────────────────────────────────
// Task 054: Shared Observation Resolver
//
// Canonical resolver for listing and price observation timestamps.
// Used by: computeProjectionV2, public detail, public list, admin, scheduler.
//
// Priority for listing observation:
//   1. listingObservedAt (V2 field)
//   2. lastProviderUpdateAt (providerObservedAt)
//   3. availabilityConfirmedAt (lastSeenAt when availabilityConfirmed = true)
//
// Priority for price observation:
//   1. priceObservedAt (V2 field)
//   2. lastProviderUpdateAt — ONLY when the lot has pricing evidence
//      (currentBidUsd > 0 || buyNowUsd > 0)
//
// NEVER falls back to firstSeenAt, guessed time, browser time, or now.
// If no reliable timestamp exists → null (caller treats as stale).
// ─────────────────────────────────────────────────────────────

import type { Prisma } from '@prisma/client';

export interface ObservationInput {
  listingObservedAt: Date | null;
  priceObservedAt: Date | null;
  lastProviderUpdateAt: Date | null;
  availabilityConfirmedAt: Date | null;
  currentBidUsd: Prisma.Decimal | number | null;
  buyNowUsd: Prisma.Decimal | number | null;
}

/**
 * Resolve the canonical listing observation timestamp.
 * Falls back through the priority chain. Returns null if no valid evidence.
 */
export function resolveListingObservedAt(input: ObservationInput): Date | null {
  if (input.listingObservedAt) return input.listingObservedAt;
  if (input.lastProviderUpdateAt) return input.lastProviderUpdateAt;
  if (input.availabilityConfirmedAt) return input.availabilityConfirmedAt;
  return null;
}

/**
 * Resolve the canonical price observation timestamp.
 * Falls back to lastProviderUpdateAt only when pricing evidence exists.
 * Returns null if no reliable price evidence.
 */
export function resolvePriceObservedAt(input: ObservationInput): Date | null {
  if (input.priceObservedAt) return input.priceObservedAt;

  // Only use providerObservedAt as fallback when there's actual pricing data
  const hasPricing =
    (input.currentBidUsd != null && Number(input.currentBidUsd) > 0) ||
    (input.buyNowUsd != null && Number(input.buyNowUsd) > 0);

  if (hasPricing && input.lastProviderUpdateAt) {
    return input.lastProviderUpdateAt;
  }

  return null;
}

/**
 * Combined resolver — returns both listing and price timestamps
 * computed from the same input for consistency.
 */
export function resolveObservations(input: ObservationInput): {
  listingObservedAt: Date | null;
  priceObservedAt: Date | null;
} {
  return {
    listingObservedAt: resolveListingObservedAt(input),
    priceObservedAt: resolvePriceObservedAt(input),
  };
}
