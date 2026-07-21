// ─────────────────────────────────────────────────────────────
// Task 053: Projection V2 — Derived Axes & Freshness
// Read-time computation of catalogScheduleState, listing freshness,
// and price freshness. Does NOT mutate rows.
// ─────────────────────────────────────────────────────────────

import type { Prisma } from '@prisma/client';

export type CatalogScheduleState =
  | 'SCHEDULED_ACTIVE'       // N <= auctionAtUtc < N + 7 days
  | 'SCHEDULED_OUT_OF_HORIZON' // auctionAtUtc >= N + 7 days
  | 'UNSCHEDULED';            // no confirmed time

export type ListingFreshnessV2 = 'FRESH' | 'STALE';
export type PriceFreshnessV2 = 'FRESH' | 'MISSING_OR_STALE';

export type ProviderResultStateV2 = 'UNKNOWN' | 'RESULT_PENDING' | 'SOLD' | 'UNSOLD' | 'REMOVED';

/**
 * Derived schedule state — computed at read time using server UTC.
 *
 * Rules (priority order):
 * 1. Explicit terminal provider result has priority;
 * 2. Valid auctionAtUtc < N with no explicit result → RESULT_PENDING;
 * 3. N <= auctionAtUtc < N + 7 days → SCHEDULED_ACTIVE;
 * 4. auctionAtUtc >= N + 7 days → SCHEDULED_OUT_OF_HORIZON;
 * 5. No confirmed time → UNSCHEDULED.
 *
 * Past time alone must never produce SOLD.
 * Buy Now never overrides elapsed auction time.
 */
export function deriveCatalogScheduleState(
  auctionAtUtc: Date | null,
  providerResultState: ProviderResultStateV2,
  now: Date = new Date(),
): { schedule: CatalogScheduleState; isResultPending: boolean; isTerminal: boolean } {
  const isTerminal = providerResultState === 'SOLD' || providerResultState === 'UNSOLD' || providerResultState === 'REMOVED';

  if (isTerminal) {
    return { schedule: 'UNSCHEDULED', isResultPending: false, isTerminal: true };
  }

  // Past auction time without terminal result → RESULT_PENDING
  if (auctionAtUtc && auctionAtUtc < now) {
    return { schedule: 'UNSCHEDULED', isResultPending: true, isTerminal: false };
  }

  if (!auctionAtUtc) {
    return { schedule: 'UNSCHEDULED', isResultPending: false, isTerminal: false };
  }

  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (auctionAtUtc >= now && auctionAtUtc < new Date(now.getTime() + sevenDays)) {
    return { schedule: 'SCHEDULED_ACTIVE', isResultPending: false, isTerminal: false };
  }

  if (auctionAtUtc >= new Date(now.getTime() + sevenDays)) {
    return { schedule: 'SCHEDULED_OUT_OF_HORIZON', isResultPending: false, isTerminal: false };
  }

  // Fallback (shouldn't reach here logically)
  return { schedule: 'UNSCHEDULED', isResultPending: false, isTerminal: false };
}

/**
 * Listing freshness:
 * - FRESH only when listingObservedAt exists and is no older than 48 hours.
 * - Otherwise STALE.
 */
export function deriveListingFreshness(
  listingObservedAt: Date | null,
  now: Date = new Date(),
): ListingFreshnessV2 {
  if (!listingObservedAt) return 'STALE';
  const ageMs = now.getTime() - listingObservedAt.getTime();
  const maxAge = 48 * 60 * 60 * 1000; // 48 hours
  return ageMs <= maxAge ? 'FRESH' : 'STALE';
}

/**
 * Price freshness:
 * Fresh positive bid/Buy Now only if priceObservedAt exists and age is:
 * - Auction within 24h: maximum 6h
 * - Auction in 1–3 days: maximum 12h
 * - Auction in 4–7 days: maximum 24h
 *
 * Otherwise MISSING_OR_STALE.
 */
export function derivePriceFreshness(
  priceObservedAt: Date | null,
  auctionAtUtc: Date | null,
  now: Date = new Date(),
): PriceFreshnessV2 {
  if (!priceObservedAt) return 'MISSING_OR_STALE';

  const ageMs = now.getTime() - priceObservedAt.getTime();
  if (ageMs < 0) return 'FRESH'; // future timestamp — treat as fresh (clock skew)

  if (!auctionAtUtc) {
    // No auction time — use 24h max as conservative
    return ageMs <= 24 * 60 * 60 * 1000 ? 'FRESH' : 'MISSING_OR_STALE';
  }

  const timeToAuctionMs = auctionAtUtc.getTime() - now.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (timeToAuctionMs <= oneDay) {
    // Auction within 24h: max 6h
    return ageMs <= 6 * 60 * 60 * 1000 ? 'FRESH' : 'MISSING_OR_STALE';
  }

  if (timeToAuctionMs <= 3 * oneDay) {
    // Auction in 1–3 days: max 12h
    return ageMs <= 12 * 60 * 60 * 1000 ? 'FRESH' : 'MISSING_OR_STALE';
  }

  if (timeToAuctionMs <= 7 * oneDay) {
    // Auction in 4–7 days: max 24h
    return ageMs <= 24 * 60 * 60 * 1000 ? 'FRESH' : 'MISSING_OR_STALE';
  }

  // Auction beyond 7 days — use 24h
  return ageMs <= 24 * 60 * 60 * 1000 ? 'FRESH' : 'MISSING_OR_STALE';
}

// ── Projection V2 type ────────────────────────────────────────

export interface ProjectionV2ReasonCode {
  code: string;
  message: string; // Ukrainian explanation
}

export interface PublicProjectionV2 {
  providerResultState: ProviderResultStateV2;
  catalogScheduleState: CatalogScheduleState;
  isResultPending: boolean;
  isTerminal: boolean;
  listingFreshness: ListingFreshnessV2;
  priceFreshness: PriceFreshnessV2;
  reasonCode: ProjectionV2ReasonCode;
  /** Whether lot should be visible in public browsing */
  publicVisible: boolean;
  /** Whether to show price/countdown/CTA */
  showPriceAndCta: boolean;
}

/** Feature flag — off by default for public browsing in this task */
const PUBLIC_V2_FLAG = false;

export function isPublicV2Enabled(): boolean {
  return PUBLIC_V2_FLAG;
}

/**
 * Compute Projection V2 for a lot.
 * This is a pure read-time computation — does not mutate the row.
 */
export function computeProjectionV2(lot: {
  auctionTime: Date | null;
  providerResultState: string;
  listingObservedAt: Date | null;
  priceObservedAt: Date | null;
  buyNowUsd: Prisma.Decimal | null;
  currentBidUsd: Prisma.Decimal | null;
}, now: Date = new Date()): PublicProjectionV2 {
  const auctionAtUtc = lot.auctionTime;
  const providerResultState = lot.providerResultState as ProviderResultStateV2;

  const { schedule, isResultPending, isTerminal } = deriveCatalogScheduleState(auctionAtUtc, providerResultState, now);
  const listingFreshness = deriveListingFreshness(lot.listingObservedAt, now);
  const priceFreshness = derivePriceFreshness(lot.priceObservedAt, auctionAtUtc, now);

  // Determine visibility and showPrice based on state
  let publicVisible = false;
  let showPriceAndCta = false;
  let reasonCode: ProjectionV2ReasonCode;

  if (isTerminal) {
    publicVisible = false;
    showPriceAndCta = false;
    reasonCode = {
      code: 'TERMINAL_RESULT',
      message: 'Лот завершено — результат підтверджено постачальником',
    };
  } else if (isResultPending) {
    publicVisible = false;
    showPriceAndCta = false;
    reasonCode = {
      code: 'RESULT_PENDING',
      message: 'Очікується результат від постачальника',
    };
  } else if (schedule === 'UNSCHEDULED') {
    publicVisible = false;
    showPriceAndCta = false;
    reasonCode = {
      code: 'UNSCHEDULED',
      message: 'Час аукціону не підтверджено',
    };
  } else if (schedule === 'SCHEDULED_OUT_OF_HORIZON') {
    publicVisible = false;
    showPriceAndCta = false;
    reasonCode = {
      code: 'OUT_OF_HORIZON',
      message: 'Аукціон поза 7-денним горизонтом',
    };
  } else if (schedule === 'SCHEDULED_ACTIVE') {
    if (listingFreshness === 'STALE') {
      publicVisible = false; // hidden from browsing, direct detail only
      showPriceAndCta = false;
      reasonCode = {
        code: 'STALE_LISTING',
        message: 'Дані лістингу потребують оновлення',
      };
    } else if (priceFreshness === 'MISSING_OR_STALE') {
      publicVisible = true; // visible but hide price/CTA
      showPriceAndCta = false;
      reasonCode = {
        code: 'STALE_PRICE',
        message: 'Ціна аукціону потребує оновлення',
      };
    } else {
      publicVisible = true;
      showPriceAndCta = true;
      reasonCode = {
        code: 'OK',
        message: 'Усі дані актуальні',
      };
    }
  } else {
    publicVisible = false;
    showPriceAndCta = false;
    reasonCode = { code: 'UNKNOWN', message: 'Невідомий стан' };
  }

  return {
    providerResultState,
    catalogScheduleState: schedule,
    isResultPending,
    isTerminal,
    listingFreshness,
    priceFreshness,
    reasonCode,
    publicVisible,
    showPriceAndCta,
  };
}
