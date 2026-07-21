import { AuctionLifecycleState, ProviderResultState, type Prisma } from '@prisma/client';
import { qualityExclusionWhere } from './catalog-quality';
import { derivePriceFreshness } from './projection-v2';
import { resolvePriceObservedAt } from './observation-resolver';

export const LISTING_FRESH_WINDOW_MS = 48 * 60 * 60 * 1000;
export const AUCTION_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export type AuctionTruthReasonCode =
  | 'PUBLIC'
  | 'TERMINAL_RESULT'
  | 'RESULT_PENDING'
  | 'UNAVAILABLE'
  | 'LISTING_STALE'
  | 'AUCTION_OUT_OF_HORIZON';

export interface AuctionTruthSubject {
  auctionTime: Date | null;
  providerResultState: string;
  listingObservedAt: Date | null;
  lastProviderUpdateAt: Date | null;
  availabilityConfirmed: boolean;
  lastSeenAt: Date | null;
  state: string;
  consecutiveMisses: number;
}

export interface AuctionLifecycleSubject extends AuctionTruthSubject {
  auctionState?: string | null;
  lifecycleState?: string | null;
}

export interface AuctionPriceSubject {
  auctionTime: Date | null;
  priceObservedAt: Date | null;
  lastProviderUpdateAt: Date | null;
  currentBidUsd: Prisma.Decimal | number | null;
  buyNowUsd: Prisma.Decimal | number | null;
}

export interface AuctionTruthOutcome {
  publicVisible: boolean;
  reasonCode: AuctionTruthReasonCode;
}

const TERMINAL_RESULTS = [
  ProviderResultState.SOLD,
  ProviderResultState.UNSOLD,
  ProviderResultState.REMOVED,
] as const;

const LIVE_AUCTION_STATE_TOKENS = ['live', 'bidding'];

function isTerminalProviderResult(value: string): boolean {
  return value === ProviderResultState.SOLD || value === ProviderResultState.UNSOLD || value === ProviderResultState.REMOVED;
}

/**
 * The canonical public-auction decision. Scheduler lifecycle, freshness, and
 * tier fields are intentionally excluded: they are operational projections,
 * not provider evidence.
 */
export function evaluateAuctionTruth(lot: AuctionTruthSubject, now: Date): AuctionTruthOutcome {
  if (isTerminalProviderResult(lot.providerResultState)) return { publicVisible: false, reasonCode: 'TERMINAL_RESULT' };
  // A provider can report a delayed result while retaining a future-looking
  // schedule field. Result state is authoritative for visibility in that case.
  if (lot.providerResultState === ProviderResultState.RESULT_PENDING) {
    return { publicVisible: false, reasonCode: 'RESULT_PENDING' };
  }
  if (!lot.availabilityConfirmed || lot.state === 'UNAVAILABLE' || lot.consecutiveMisses >= 3) {
    return { publicVisible: false, reasonCode: 'UNAVAILABLE' };
  }
  const observedAt = lot.listingObservedAt ?? lot.lastProviderUpdateAt ?? (lot.availabilityConfirmed ? lot.lastSeenAt : null);
  if (!observedAt || observedAt.getTime() < now.getTime() - LISTING_FRESH_WINDOW_MS) {
    return { publicVisible: false, reasonCode: 'LISTING_STALE' };
  }
  if (!lot.auctionTime || lot.auctionTime.getTime() >= now.getTime() + AUCTION_HORIZON_MS) {
    return { publicVisible: false, reasonCode: 'AUCTION_OUT_OF_HORIZON' };
  }
  if (lot.auctionTime.getTime() < now.getTime()) return { publicVisible: false, reasonCode: 'RESULT_PENDING' };
  return { publicVisible: true, reasonCode: 'PUBLIC' };
}

/**
 * The display lifecycle is derived from provider evidence, not from the
 * legacy lifecycleState scheduler projection.  Exact lot lookups retain
 * terminal/result-pending states; public browse callers only receive the
 * active UPCOMING/LIVE subset.
 */
export function deriveAuctionLifecycle(lot: AuctionLifecycleSubject, now: Date): AuctionLifecycleState {
  const truth = evaluateAuctionTruth(lot, now);
  if (truth.reasonCode === 'TERMINAL_RESULT') {
    if (lot.providerResultState === ProviderResultState.SOLD) return 'SOLD';
    if (lot.providerResultState === ProviderResultState.REMOVED) return 'REMOVED';
    return 'ENDED';
  }
  if (truth.reasonCode === 'RESULT_PENDING') return 'ENDED';
  // A legacy lifecycleState must never turn a future/stale/unavailable lot
  // into a false terminal display. Only explicit provider result and elapsed
  // time above may produce terminal/pending presentation.
  if (!truth.publicVisible) {
    if (!lot.auctionTime) return AuctionLifecycleState.NOT_READY;
    if (lot.auctionTime.getTime() >= now.getTime()) {
      const providerState = (lot.auctionState ?? '').toLowerCase();
      return LIVE_AUCTION_STATE_TOKENS.some((token) => providerState.includes(token))
        ? AuctionLifecycleState.LIVE
        : AuctionLifecycleState.UPCOMING;
    }
    return AuctionLifecycleState.NOT_READY;
  }

  const providerState = (lot.auctionState ?? '').toLowerCase();
  return LIVE_AUCTION_STATE_TOKENS.some((token) => providerState.includes(token))
    ? AuctionLifecycleState.LIVE
    : AuctionLifecycleState.UPCOMING;
}

/** A stale or absent auction price can never drive a public price filter. */
export function hasFreshAuctionPrice(lot: AuctionPriceSubject, now: Date): boolean {
  const observedAt = resolvePriceObservedAt({
    listingObservedAt: null,
    priceObservedAt: lot.priceObservedAt,
    lastProviderUpdateAt: lot.lastProviderUpdateAt,
    availabilityConfirmedAt: null,
    currentBidUsd: lot.currentBidUsd,
    buyNowUsd: lot.buyNowUsd,
  });
  return derivePriceFreshness(observedAt, lot.auctionTime, now) === 'FRESH';
}

/**
 * Database form of the same price-freshness thresholds. Every branch is
 * bounded by the public 0–7 day auction horizon; it is used only when a
 * request filters on price or Buy Now, never to hide a still-fresh listing.
 */
export function freshAuctionPriceWhere(now: Date): Prisma.DiscoveredLotWhereInput {
  const hour = 60 * 60 * 1000;
  const oneDay = new Date(now.getTime() + 24 * hour);
  const threeDays = new Date(now.getTime() + 72 * hour);
  const observedPriceOnOrAfter = (cutoff: Date): Prisma.DiscoveredLotWhereInput => ({
    OR: [
      { priceObservedAt: { gte: cutoff } },
      {
        AND: [
          { priceObservedAt: null },
          { lastProviderUpdateAt: { gte: cutoff } },
          { OR: [{ currentBidUsd: { gt: 0 } }, { buyNowUsd: { gt: 0 } }] },
        ],
      },
    ],
  });
  return {
    OR: [
      { AND: [{ auctionTime: { gte: now, lte: oneDay } }, observedPriceOnOrAfter(new Date(now.getTime() - 6 * hour))] },
      { AND: [{ auctionTime: { gt: oneDay, lte: threeDays } }, observedPriceOnOrAfter(new Date(now.getTime() - 12 * hour))] },
      { AND: [{ auctionTime: { gt: threeDays } }, observedPriceOnOrAfter(new Date(now.getTime() - 24 * hour))] },
    ],
  };
}

/** SQL-safe lifecycle filter for the derived public lifecycle vocabulary. */
export function publicLifecycleWhere(lifecycle: string | undefined): Prisma.DiscoveredLotWhereInput | undefined {
  if (!lifecycle) return undefined;
  const liveState = {
    OR: LIVE_AUCTION_STATE_TOKENS.map((token) => ({ auctionState: { contains: token, mode: 'insensitive' as const } })),
  };
  if (lifecycle === 'LIVE') return liveState;
  if (lifecycle === 'UPCOMING') return { NOT: liveState };
  return { id: { in: [] } };
}

/**
 * Prisma representation of the database-representable parts of the same
 * decision. Callers pass their request clock so list and count share the
 * exact horizon boundary.
 */
export function publicCatalogWhere(
  extra: Prisma.DiscoveredLotWhereInput | undefined,
  now: Date,
): Prisma.DiscoveredLotWhereInput {
  const freshCutoff = new Date(now.getTime() - LISTING_FRESH_WINDOW_MS);
  const horizonEnd = new Date(now.getTime() + AUCTION_HORIZON_MS);

  return {
    AND: [
      { availabilityConfirmed: true },
      { state: { not: 'UNAVAILABLE' } },
      { consecutiveMisses: { lt: 3 } },
      { auctionTime: { gte: now, lt: horizonEnd } },
      { providerResultState: { notIn: [...TERMINAL_RESULTS] } },
      { providerResultState: { not: ProviderResultState.RESULT_PENDING } },
      {
        OR: [
          { listingObservedAt: { gte: freshCutoff } },
          { listingObservedAt: null, lastProviderUpdateAt: { gte: freshCutoff } },
          { listingObservedAt: null, lastProviderUpdateAt: null, availabilityConfirmed: true, lastSeenAt: { gte: freshCutoff } },
        ],
      },
      qualityExclusionWhere(),
      ...(extra ? [extra] : []),
    ],
  };
}
