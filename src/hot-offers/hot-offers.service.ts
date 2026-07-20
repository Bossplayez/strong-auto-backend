/**
 * Hot Offers Service (Task 048)
 *
 * Hybrid manual/automatic selection of quality-eligible auction lots
 * for the homepage "Hot Offers" section.
 *
 * Two tiers:
 *   - urgent: auction within next 48 hours
 *   - this-week: auction 48h–7d from now
 *
 * Persistence: SiteSetting table (no migration).
 * Reads only already-saved data — no parser/scheduler calls.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { publicCatalogWhere, evaluateCatalogQuality, MIN_CATALOG_YEAR } from '../auction-lot/catalog-quality';
import type { DiscoveredLot } from '@prisma/client';

/** Minimal lot shape for hot-offers scoring/ranking. */
interface HotOfferCandidateLot {
  provider: string;
  externalLotId: string;
  title: string;
  make: string;
  model: string;
  year: number | null;
  bodyStyle: string | null;
  fuelType: string | null;
  transmission: string | null;
  driveType: string | null;
  locationState: string | null;
  locationDisplay: string | null;
  odometerKm: number | null;
  odometerMi: number | null;
  currentBidUsd: any;
  buyNowUsd: any;
  isBuyNow: boolean;
  auctionTime: Date | null;
  auctionTimezoneOffset: number | null;
  mediaUrls: string[];
  lifecycleState: string;
  freshnessState: string;
  availabilityConfirmed: boolean;
  consecutiveMisses: number;
  primaryDamage: string | null;
  secondaryDamage: string | null;
  loss: string | null;
  saleDocumentName: string | null;
  saleDocumentType: string | null;
}

// ── Types ──────────────────────────────────────────────────────

export type HotOfferTier = 'urgent' | 'this-week';

export interface HotOfferPolicy {
  minYear: number;
  maxMileageKm: number | null;
  maxKnownPriceUsd: number | null;
  extraDamageExclusions: string[];
  weights: { year: number; mileage: number; price: number; time: number; buyNow: number };
}

export interface HotOfferOverride {
  provider: string;
  externalLotId: string;
  tier: HotOfferTier;
  action: 'pin' | 'exclude';
  position: number | null; // 1 or 2 for pin
}

export interface HotOfferSnapshot {
  generatedAt: string;
  validUntil: string;
  tiers: {
    urgent: SnapshotTier;
    'this-week': SnapshotTier;
  };
}

interface SnapshotTier {
  tier: HotOfferTier;
  labelUk: string;
  labelEn: string;
  windowStart: string;
  windowEnd: string;
  items: SnapshotItem[];
}

interface SnapshotItem {
  provider: string;
  externalLotId: string;
  manualPin: boolean;
  order: number;
}

export interface HotOfferCandidate {
  provider: string;
  externalLotId: string;
  title: string;
  make: string;
  model: string;
  year: number;
  bodyType: string | null;
  thumbnailUrl: string | null;
  mediaCount: number;
  odometerKm: number | null;
  locationCity: string | null;
  locationState: string | null;
  currentBidUsd: number | null;
  buyNowUsd: number | null;
  buyNowAvailable: boolean;
  auctionAt: string | null;
  lifecycle: string;
  score: number;
  reasonCodes: string[];
  manualPin: boolean;
  qualityInclude: boolean;
  qualityReason: string | null;
}

export interface AdminHotOffersResponse {
  policy: HotOfferPolicy;
  snapshot: { generatedAt: string; validUntil: string } | null;
  overrides: HotOfferOverride[];
  tiers: {
    urgent: { tier: HotOfferTier; labelUk: string; candidates: HotOfferCandidate[] };
    'this-week': { tier: HotOfferTier; labelUk: string; candidates: HotOfferCandidate[] };
  };
}

export interface PublicHotOffersResponse {
  generatedAt: string;
  validUntil: string;
  tiers: {
    urgent: PublicTier;
    'this-week': PublicTier;
  };
}

interface PublicTier {
  tier: HotOfferTier;
  label: string;
  labelEn: string;
  windowStart: string;
  windowEnd: string;
  items: PublicHotOfferItem[];
}

export interface PublicHotOfferItem {
  key: string;
  kind: 'auctionLot';
  source: string;
  title: string;
  make: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  fuelType: string | null;
  transmission: string | null;
  driveType: string | null;
  locationState: string | null;
  locationCity: string | null;
  odometerKm: number | null;
  thumbnailUrl: string | null;
  mediaCount: number;
  price: {
    currency: 'USD';
    primaryUsd: number | null;
    basis: string | null;
    currentBidUsd: number | null;
    buyNowUsd: number | null;
    buyNowAvailable: boolean | null;
  };
  provider: string;
  externalLotId: string;
  lifecycle: string | null;
  freshness: string | null;
  auctionAt: string | null;
  providerTimezoneOffset: string | null;
  reasonCodes: string[];
  manualPin: boolean;
}

// ── Constants ──────────────────────────────────────────────────

const POLICY_KEY = 'hot_offers_policy_v1';
const SNAPSHOT_KEY = 'hot_offers_snapshot_v1';
const SNAPSHOT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const URGENT_WINDOW_HOURS = 48;
const WEEK_WINDOW_HOURS = 7 * 24;
const MAX_ITEMS = 6;
const MAX_PINS = 2;
const MAX_SAME_MAKE = 2;
const MAX_SAME_MAKE_MODEL = 1;

const DEFAULT_POLICY: HotOfferPolicy = {
  minYear: MIN_CATALOG_YEAR,
  maxMileageKm: null,
  maxKnownPriceUsd: null,
  extraDamageExclusions: [],
  weights: { year: 25, mileage: 20, price: 25, time: 20, buyNow: 10 },
};

const TIER_LABELS = {
  urgent: { uk: 'Термінові торги', en: 'Urgent auctions' },
  'this-week': { uk: 'Вигідні цього тижня', en: 'This week deals' },
} as const;

// Body types that are NOT passenger vehicles
const NON_PASSENGER_BODY = [
  /cargo/i, /commercial/i, /box truck/i, /cube/i, /cutaway/i,
  /chassis/i, /stake/i, /flatbed/i, /step van/i, /street sweeper/i,
  /ambulance/i, /hearse/i, /limousine/i,
];

// ── Helpers ────────────────────────────────────────────────────

function isPassengerVehicle(lot: { bodyStyle?: string | null; bodyType?: string | null; title: string; make: string; model: string }): boolean {
  const text = [lot.bodyType ?? lot.bodyStyle, lot.title, lot.make, lot.model].filter(Boolean).join(' ');
  return !NON_PASSENGER_BODY.some(re => re.test(text));
}

function hasRealPrice(lot: { currentBidUsd: any; buyNowUsd: any; isBuyNow: boolean }): boolean {
  const bid = Number(lot.currentBidUsd);
  const buyNow = Number(lot.buyNowUsd);
  return (Number.isFinite(bid) && bid > 0) || (lot.isBuyNow && Number.isFinite(buyNow) && buyNow > 0);
}
function classifyTier(auctionTime: Date | null, now: Date): HotOfferTier | null {
  if (!auctionTime) return null;
  const msUntil = auctionTime.getTime() - now.getTime();
  if (msUntil <= 0) return null; // already started/ended
  const hoursUntil = msUntil / (1000 * 60 * 60);
  if (hoursUntil <= URGENT_WINDOW_HOURS) return 'urgent';
  if (hoursUntil <= WEEK_WINDOW_HOURS) return 'this-week';
  return null;
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ── Select fields for candidate query ──────────────────────────

const CANDIDATE_SELECT = {
  provider: true,
  externalLotId: true,
  title: true,
  make: true,
  model: true,
  year: true,
  bodyStyle: true,
  fuelType: true,
  transmission: true,
  driveType: true,
  locationState: true,
  locationDisplay: true,
  odometerKm: true,
  odometerMi: true,
  currentBidUsd: true,
  buyNowUsd: true,
  isBuyNow: true,
  auctionTime: true,
  auctionTimezoneOffset: true,
  mediaUrls: true,
  lifecycleState: true,
  freshnessState: true,
  availabilityConfirmed: true,
  consecutiveMisses: true,
  primaryDamage: true,
  secondaryDamage: true,
  loss: true,
  saleDocumentName: true,
  saleDocumentType: true,
} as const;

// ── Service ────────────────────────────────────────────────────

@Injectable()
export class HotOffersService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Policy management ─────────────────────────────────────

  async getPolicy(): Promise<HotOfferPolicy> {
    const row = await this.prisma.siteSetting.findUnique({ where: { key: POLICY_KEY } });
    if (!row) return { ...DEFAULT_POLICY };
    const stored = row.valueJson as any;
    return {
      minYear: Math.max(stored.minYear ?? DEFAULT_POLICY.minYear, MIN_CATALOG_YEAR),
      maxMileageKm: stored.maxMileageKm ?? null,
      maxKnownPriceUsd: stored.maxKnownPriceUsd ?? null,
      extraDamageExclusions: Array.isArray(stored.extraDamageExclusions) ? stored.extraDamageExclusions : [],
      weights: validateWeights(stored.weights ?? DEFAULT_POLICY.weights),
    };
  }

  async savePolicy(policy: HotOfferPolicy, userId: string): Promise<void> {
    validatePolicy(policy);
    await this.prisma.siteSetting.upsert({
      where: { key: POLICY_KEY },
      create: { key: POLICY_KEY, valueJson: policy as any, updatedByUserId: userId },
      update: { valueJson: policy as any, updatedByUserId: userId },
    });
    // Invalidate snapshot
    await this.prisma.siteSetting.deleteMany({ where: { key: SNAPSHOT_KEY } });
  }

  // ── Overrides ─────────────────────────────────────────────

  async getOverrides(): Promise<HotOfferOverride[]> {
    const policy = await this.getPolicy();
    const overrides = (policy as any).overrides as HotOfferOverride[] | undefined;
    return Array.isArray(overrides) ? overrides : [];
  }

  async addOverride(override: HotOfferOverride, userId: string): Promise<void> {
    const policy = await this.getPolicyRaw();
    const overrides: HotOfferOverride[] = Array.isArray((policy as any).overrides) ? (policy as any).overrides : [];

    // Validate pin limits
    if (override.action === 'pin') {
      // Verify the lot is eligible
      await this.validateLotEligibleForPin(override);
      const tierPins = overrides.filter(o => o.tier === override.tier && o.action === 'pin');
      // Remove existing pin for same lot if any
      const existingIdx = overrides.findIndex(o => o.provider === override.provider && o.externalLotId === override.externalLotId && o.action === 'pin');
      if (existingIdx >= 0) {
        overrides.splice(existingIdx, 1);
      } else {
        // Check tier pin limit (excluding slots already taken by this lot)
        const pinsInTier = overrides.filter(o => o.tier === override.tier && o.action === 'pin');
        if (pinsInTier.length >= MAX_PINS) {
          throw new BadRequestException({ code: 'PIN_LIMIT_EXCEEDED', message: `Максимум ${MAX_PINS} закріплених лотів на один блок` });
        }
      }
      // Check position validity
      if (override.position !== 1 && override.position !== 2) {
        throw new BadRequestException({ code: 'INVALID_POSITION', message: 'Позиція може бути лише 1 або 2' });
      }
      // If position is taken by another lot, swap
      const posConflict = overrides.findIndex(o => o.tier === override.tier && o.action === 'pin' && o.position === override.position && !(o.provider === override.provider && o.externalLotId === override.externalLotId));
      if (posConflict >= 0) {
        overrides.splice(posConflict, 1);
      }
    }

    // Remove any existing entry for this lot
    const idx = overrides.findIndex(o => o.provider === override.provider && o.externalLotId === override.externalLotId);
    if (idx >= 0) overrides.splice(idx, 1);

    overrides.push(override);
    (policy as any).overrides = overrides;

    await this.prisma.siteSetting.upsert({
      where: { key: POLICY_KEY },
      create: { key: POLICY_KEY, valueJson: policy as any, updatedByUserId: userId },
      update: { valueJson: policy as any, updatedByUserId: userId },
    });
    // Invalidate snapshot
    await this.prisma.siteSetting.deleteMany({ where: { key: SNAPSHOT_KEY } });
  }

  async removeOverride(provider: string, externalLotId: string, userId: string): Promise<void> {
    const policy = await this.getPolicyRaw();
    const overrides: HotOfferOverride[] = Array.isArray((policy as any).overrides) ? (policy as any).overrides : [];
    const filtered = overrides.filter(o => !(o.provider === provider && o.externalLotId === externalLotId));
    (policy as any).overrides = filtered;
    await this.prisma.siteSetting.upsert({
      where: { key: POLICY_KEY },
      create: { key: POLICY_KEY, valueJson: policy as any, updatedByUserId: userId },
      update: { valueJson: policy as any, updatedByUserId: userId },
    });
    await this.prisma.siteSetting.deleteMany({ where: { key: SNAPSHOT_KEY } });
  }

  // ── Public read ───────────────────────────────────────────

  async getPublicHotOffers(): Promise<PublicHotOffersResponse> {
    const now = new Date();
    const policy = await this.getPolicy();
    const overrides = await this.getOverrides();

    // Check snapshot freshness
    const snapshotRow = await this.prisma.siteSetting.findUnique({ where: { key: SNAPSHOT_KEY } });
    let snapshot: HotOfferSnapshot | null = null;
    if (snapshotRow) {
      snapshot = snapshotRow.valueJson as any;
    }

    const snapshotFresh = snapshot && new Date(snapshot.validUntil).getTime() > now.getTime();

    // Build tiers (always needed for re-validation)
    const tiers = await this.buildTiers(policy, overrides, now);

    // Determine the authoritative timestamp pair for this response.
    // When snapshot is fresh, reuse its timestamps as-is (do NOT extend).
    // When stale/missing, generate a new pair: generatedAt=now, validUntil=now+30min.
    const generatedAt = snapshotFresh ? snapshot!.generatedAt : now.toISOString();
    const validUntil = snapshotFresh
      ? snapshot!.validUntil
      : new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString();

    const result: PublicHotOffersResponse = { generatedAt, validUntil, tiers: {} as any };

    let needsSave = !snapshotFresh; // only persist when creating a new snapshot

    for (const tierKey of ['urgent', 'this-week'] as HotOfferTier[]) {
      const built = tiers[tierKey];
      let items: PublicHotOfferItem[];

      if (snapshotFresh) {
        // Re-verify each item from snapshot, remove ineligible
        const snapshotOrder = snapshot!.tiers[tierKey].items;
        const verified: PublicHotOfferItem[] = [];
        const usedKeys = new Set<string>();

        // First: pinned items from snapshot in order
        for (const snapItem of snapshotOrder) {
          const candidate = built.allCandidates.find(c => c.provider === snapItem.provider && c.externalLotId === snapItem.externalLotId);
          const eligible = candidate ? this.stillEligible(candidate, tierKey, now) : false;
          if (candidate && eligible) {
            const publicItem = this.toPublicItem(candidate, snapItem.manualPin);
            verified.push(publicItem);
            usedKeys.add(`${candidate.provider}:${candidate.externalLotId}`);
          } else {
            needsSave = true; // a lot was removed → snapshot must be regenerated
          }
        }

        // Fill remaining slots from ranked candidates
        for (const candidate of built.allCandidates) {
          if (verified.length >= MAX_ITEMS) break;
          const key = `${candidate.provider}:${candidate.externalLotId}`;
          if (usedKeys.has(key)) continue;
          const publicItem = this.toPublicItem(candidate, false);
          verified.push(publicItem);
          usedKeys.add(key);
        }

        items = verified;
      } else {
        // Fresh build — use ranked items directly
        items = built.items as PublicHotOfferItem[];
      }

      result.tiers[tierKey] = {
        tier: tierKey,
        label: TIER_LABELS[tierKey].uk,
        labelEn: TIER_LABELS[tierKey].en,
        windowStart: this.windowStart(tierKey, now).toISOString(),
        windowEnd: this.windowEnd(tierKey, now).toISOString(),
        items: items.slice(0, MAX_ITEMS),
      };
    }

    // Only persist when creating a new snapshot or when lots were pruned.
    // Do NOT extend validUntil on every read.
    if (needsSave) {
      const newSnapshot: HotOfferSnapshot = {
        generatedAt: now.toISOString(),
        validUntil: new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString(),
        tiers: {
          urgent: { tier: 'urgent', labelUk: TIER_LABELS.urgent.uk, labelEn: TIER_LABELS.urgent.en, windowStart: this.windowStart('urgent', now).toISOString(), windowEnd: this.windowEnd('urgent', now).toISOString(), items: result.tiers.urgent.items.map((item, i) => ({ provider: item.provider, externalLotId: item.externalLotId, manualPin: item.manualPin, order: i + 1 })) },
          'this-week': { tier: 'this-week', labelUk: TIER_LABELS['this-week'].uk, labelEn: TIER_LABELS['this-week'].en, windowStart: this.windowStart('this-week', now).toISOString(), windowEnd: this.windowEnd('this-week', now).toISOString(), items: result.tiers['this-week'].items.map((item, i) => ({ provider: item.provider, externalLotId: item.externalLotId, manualPin: item.manualPin, order: i + 1 })) },
        },
      };
      result.generatedAt = newSnapshot.generatedAt;
      result.validUntil = newSnapshot.validUntil;
      try {
        await this.prisma.siteSetting.upsert({
          where: { key: SNAPSHOT_KEY },
          create: { key: SNAPSHOT_KEY, valueJson: newSnapshot as any },
          update: { key: SNAPSHOT_KEY, valueJson: newSnapshot as any },
        });
      } catch (e) {
        // best-effort — log but don't fail the request
        console.error('[HotOffers] Failed to save snapshot:', e);
      }
    }

    return result;
  }

  // ── Admin read ────────────────────────────────────────────

  async getAdminHotOffers(): Promise<AdminHotOffersResponse> {
    const now = new Date();
    const policy = await this.getPolicy();
    const overrides = await this.getOverrides();

    const snapshotRow = await this.prisma.siteSetting.findUnique({ where: { key: SNAPSHOT_KEY } });
    const snapshot = snapshotRow ? { generatedAt: (snapshotRow.valueJson as any).generatedAt, validUntil: (snapshotRow.valueJson as any).validUntil } : null;

    const tiers = await this.buildTiers(policy, overrides, now, true);

    return {
      policy,
      snapshot,
      overrides,
      tiers: {
        urgent: { tier: 'urgent', labelUk: TIER_LABELS.urgent.uk, candidates: tiers.urgent.allCandidates.slice(0, 20) },
        'this-week': { tier: 'this-week', labelUk: TIER_LABELS['this-week'].uk, candidates: tiers['this-week'].allCandidates.slice(0, 20) },
      },
    };
  }

  // ── Personal recommendations ──────────────────────────────

  async getPersonalHotOffers(userId: string): Promise<{ items: PublicHotOfferItem[]; emptyState: string | null }> {
    // Get user's auction favorites for signals
    const favorites = await this.prisma.auctionLotFavorite.findMany({
      where: { userId },
      include: { discoveredLot: true },
      orderBy: { createdAt: 'desc' },
    });

    if (favorites.length === 0) {
      return { items: [], emptyState: 'no_favorites' };
    }

    // Build signals from favorites
    const makes = new Set<string>();
    const models = new Set<string>();
    const bodyTypes = new Set<string>();
    let maxPrice = 0;

    for (const fav of favorites) {
      const lot = fav.discoveredLot;
      if (lot.make) makes.add(lot.make.toLowerCase());
      if (lot.model) models.add(lot.model.toLowerCase());
      if (lot.bodyStyle) bodyTypes.add(lot.bodyStyle.toLowerCase());
      const bid = Number(lot.currentBidUsd);
      const buy = Number(lot.buyNowUsd);
      const price = Math.max(Number.isFinite(bid) ? bid : 0, Number.isFinite(buy) ? buy : 0);
      if (price > maxPrice) maxPrice = price;
    }

    const policy = await this.getPolicy();
    const overrides = await this.getOverrides();
    const excluded = new Set(overrides.filter(o => o.action === 'exclude').map(o => `${o.provider}:${o.externalLotId}`));

    const now = new Date();
    const urgentEnd = new Date(now.getTime() + WEEK_WINDOW_HOURS * 60 * 60 * 1000);

    // Query candidates matching user signals
    const candidates = await this.prisma.discoveredLot.findMany({
      where: {
        ...publicCatalogWhere({
          auctionTime: { gte: now, lte: urgentEnd },
          OR: [
            ...(makes.size > 0 ? [{ make: { in: [...makes].map(m => m.charAt(0).toUpperCase() + m.slice(1)) } }] : []),
            ...(bodyTypes.size > 0 ? [{ bodyStyle: { in: [...bodyTypes].map(b => b.charAt(0).toUpperCase() + b.slice(1)) } }] : []),
          ],
        }),
      },
      select: CANDIDATE_SELECT,
      take: 100,
      orderBy: { auctionTime: 'asc' },
    });

    const scored = candidates
      .filter(lot => !excluded.has(`${lot.provider}:${lot.externalLotId}`))
      .filter(lot => isPassengerVehicle(lot))
      .filter(lot => hasRealPrice(lot))
      .filter(lot => {
        const q = evaluateCatalogQuality(lot);
        if (!q.include) return false;
        if (policy.extraDamageExclusions.length > 0) {
          const dmgText = [lot.primaryDamage, lot.secondaryDamage].filter(Boolean).join(' ');
          return !policy.extraDamageExclusions.some(term => dmgText.toLowerCase().includes(term.toLowerCase()));
        }
        return true;
      })
      .map(lot => this.scoreLot(lot, policy, now, 'urgent'))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return {
      items: scored.map(c => this.toPublicItem(c, false)),
      emptyState: scored.length === 0 ? 'no_matches' : null,
    };
  }

  // ── Private helpers ───────────────────────────────────────

  private async getPolicyRaw(): Promise<HotOfferPolicy & { overrides?: HotOfferOverride[] }> {
    const row = await this.prisma.siteSetting.findUnique({ where: { key: POLICY_KEY } });
    if (!row) return { ...DEFAULT_POLICY, overrides: [] };
    const stored = row.valueJson as any;
    return {
      minYear: Math.max(stored.minYear ?? DEFAULT_POLICY.minYear, MIN_CATALOG_YEAR),
      maxMileageKm: stored.maxMileageKm ?? null,
      maxKnownPriceUsd: stored.maxKnownPriceUsd ?? null,
      extraDamageExclusions: Array.isArray(stored.extraDamageExclusions) ? stored.extraDamageExclusions : [],
      weights: validateWeights(stored.weights ?? DEFAULT_POLICY.weights),
      overrides: Array.isArray(stored.overrides) ? stored.overrides : [],
    };
  }

  private async validateLotEligibleForPin(override: HotOfferOverride): Promise<void> {
    const lot = await this.prisma.discoveredLot.findUnique({
      where: { provider_externalLotId: { provider: override.provider, externalLotId: override.externalLotId } },
      select: CANDIDATE_SELECT,
    });
    if (!lot) throw new BadRequestException({ code: 'LOT_NOT_FOUND', message: 'Лот не знайдено' });

    const now = new Date();
    // Must pass public quality
    const q = evaluateCatalogQuality(lot);
    if (!q.include) {
      throw new BadRequestException({ code: 'QUALITY_FAILED', message: `Лот не проходить перевірку якості: ${q.reason}` });
    }
    // Must be active lifecycle
    if (!['UPCOMING', 'OPEN', 'LIVE'].includes(lot.lifecycleState)) {
      throw new BadRequestException({ code: 'TERMINAL_LOT', message: 'Лот завершено або видалено' });
    }
    // Must have price
    if (!hasRealPrice(lot)) {
      throw new BadRequestException({ code: 'NO_PRICE', message: 'У лота немає реальної ціни' });
    }
    // Must be passenger vehicle
    if (!isPassengerVehicle(lot)) {
      throw new BadRequestException({ code: 'NON_PASSENGER', message: 'Комерційний транспорт не дозволений' });
    }
    // Must have auction time in the right tier window
    const tier = classifyTier(lot.auctionTime, now);
    if (tier !== override.tier) {
      throw new BadRequestException({ code: 'TIER_MISMATCH', message: `Лот не належить до блоку ${override.tier}` });
    }
  }

  private async buildTiers(policy: HotOfferPolicy, overrides: HotOfferOverride[], now: Date, admin = false): Promise<{
    urgent: { items: PublicHotOfferItem[] | HotOfferCandidate[]; allCandidates: HotOfferCandidate[] };
    'this-week': { items: PublicHotOfferItem[] | HotOfferCandidate[]; allCandidates: HotOfferCandidate[] };
  }> {
    const urgentEnd = new Date(now.getTime() + URGENT_WINDOW_HOURS * 60 * 60 * 1000);
    const weekEnd = new Date(now.getTime() + WEEK_WINDOW_HOURS * 60 * 60 * 1000);

    // Query urgent tier candidates
    const urgentLots = await this.prisma.discoveredLot.findMany({
      where: publicCatalogWhere({
        auctionTime: { gte: now, lte: urgentEnd },
      }),
      select: CANDIDATE_SELECT,
      take: 200,
      orderBy: { auctionTime: 'asc' },
    });

    // Query this-week tier candidates
    const weekLots = await this.prisma.discoveredLot.findMany({
      where: publicCatalogWhere({
        auctionTime: { gt: urgentEnd, lte: weekEnd },
      }),
      select: CANDIDATE_SELECT,
      take: 200,
      orderBy: { auctionTime: 'asc' },
    });

    const excluded = new Set(overrides.filter(o => o.action === 'exclude').map(o => `${o.provider}:${o.externalLotId}`));
    const urgentPins = overrides.filter(o => o.tier === 'urgent' && o.action === 'pin').sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    const weekPins = overrides.filter(o => o.tier === 'this-week' && o.action === 'pin').sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

    const urgentResult = this.rankAndFilter(urgentLots, policy, now, 'urgent', urgentPins, excluded);
    const weekResult = this.rankAndFilter(weekLots, policy, now, 'this-week', weekPins, excluded);

    return {
      urgent: {
        items: admin ? urgentResult.candidates : urgentResult.candidates.map(c => this.toPublicItem(c, c.manualPin)),
        allCandidates: urgentResult.allCandidates,
      },
      'this-week': {
        items: admin ? weekResult.candidates : weekResult.candidates.map(c => this.toPublicItem(c, c.manualPin)),
        allCandidates: weekResult.allCandidates,
      },
    };
  }

  private rankAndFilter(
    lots: HotOfferCandidateLot[],
    policy: HotOfferPolicy,
    now: Date,
    tier: HotOfferTier,
    pins: HotOfferOverride[],
    excluded: Set<string>,
  ): { candidates: HotOfferCandidate[]; allCandidates: HotOfferCandidate[] } {
    // Filter and score
    const filtered = lots
      .filter(lot => !excluded.has(`${lot.provider}:${lot.externalLotId}`))
      .filter(isPassengerVehicle)
      .filter(hasRealPrice)
      .filter(lot => {
        // Policy extra damage exclusions (can only narrow, not loosen)
        if (policy.extraDamageExclusions.length === 0) return true;
        const dmgText = [lot.primaryDamage, lot.secondaryDamage].filter(Boolean).join(' ');
        return !policy.extraDamageExclusions.some(term => dmgText.toLowerCase().includes(term.toLowerCase()));
      })
      .filter(lot => {
        // Policy mileage cap
        if (policy.maxMileageKm !== null && lot.odometerKm !== null && lot.odometerKm > policy.maxMileageKm) return false;
        return true;
      })
      .filter(lot => {
        // Policy price cap
        if (policy.maxKnownPriceUsd !== null) {
          const bid = Number(lot.currentBidUsd);
          const buyNow = Number(lot.buyNowUsd);
          const effective = (Number.isFinite(buyNow) && buyNow > 0) ? buyNow : bid;
          if (Number.isFinite(effective) && effective > policy.maxKnownPriceUsd) return false;
        }
        return true;
      })
      .filter(lot => lot.make && lot.model) // Must have real make and model
      .map(lot => this.scoreLot(lot, policy, now, tier))
      .filter(c => c.qualityInclude); // Exclude lots that fail quality evaluation

    // Sort by score
    const sorted = [...filtered].sort((a, b) => b.score - a.score);
    const allCandidates = sorted;

    // Build result with pins + diversity
    const result: HotOfferCandidate[] = [];
    const usedKeys = new Set<string>();
    const makeCount = new Map<string, number>();
    const makeModelCount = new Map<string, number>();

    // First: add pins
    for (const pin of pins) {
      const candidate = sorted.find(c => c.provider === pin.provider && c.externalLotId === pin.externalLotId);
      if (candidate && this.stillEligible(candidate, tier, now)) {
        const key = `${candidate.provider}:${candidate.externalLotId}`;
        if (!usedKeys.has(key)) {
          candidate.manualPin = true;
          result.push(candidate);
          usedKeys.add(key);
          // Count make/model for diversity (pins are exempt but we track)
          const mk = candidate.make.toLowerCase();
          const mm = `${candidate.make.toLowerCase()}:${candidate.model.toLowerCase()}`;
          makeCount.set(mk, (makeCount.get(mk) ?? 0) + 1);
          makeModelCount.set(mm, (makeModelCount.get(mm) ?? 0) + 1);
        }
      }
    }

    // Then: fill with automatic selection respecting diversity
    for (const candidate of sorted) {
      if (result.length >= MAX_ITEMS) break;
      const key = `${candidate.provider}:${candidate.externalLotId}`;
      if (usedKeys.has(key)) continue;

      const mk = candidate.make.toLowerCase();
      const mm = `${candidate.make.toLowerCase()}:${candidate.model.toLowerCase()}`;

      // Diversity: max 2 same make, 1 same make+model (pins are exempt from counting)
      if ((makeCount.get(mk) ?? 0) >= MAX_SAME_MAKE) continue;
      if ((makeModelCount.get(mm) ?? 0) >= MAX_SAME_MAKE_MODEL) continue;

      result.push(candidate);
      usedKeys.add(key);
      makeCount.set(mk, (makeCount.get(mk) ?? 0) + 1);
      makeModelCount.set(mm, (makeModelCount.get(mm) ?? 0) + 1);
    }

    return { candidates: result, allCandidates };
  }

  private scoreLot(lot: HotOfferCandidateLot, policy: HotOfferPolicy, now: Date, tier: HotOfferTier): HotOfferCandidate {
    const w = policy.weights;
    const reasonCodes: string[] = [];

    // Score components (normalized 0-1, then weighted)
    const lots_auctionTime = lot.auctionTime ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Year score: newer = higher (normalized within 2010-current year)
    const currentYear = now.getFullYear();
    const yearScore = lot.year ? normalize(lot.year, policy.minYear, currentYear) : 0;

    // Mileage score: lower = higher
    const mileage = lot.odometerKm;
    const mileageScore = mileage !== null ? 1 - normalize(mileage, 0, 300000) : 0.5;

    // Price score: lower = higher
    const bid = Number(lot.currentBidUsd);
    const buyNow = Number(lot.buyNowUsd);
    const effectivePrice = (Number.isFinite(buyNow) && buyNow > 0) ? buyNow : (Number.isFinite(bid) ? bid : 0);
    const priceScore = effectivePrice > 0 ? 1 - normalize(effectivePrice, 0, 50000) : 0.5;

    // Time score: closer to now = higher (within tier)
    const msUntil = lots_auctionTime.getTime() - now.getTime();
    const hoursUntil = msUntil / (1000 * 60 * 60);
    const timeScore = tier === 'urgent'
      ? 1 - normalize(hoursUntil, 0, URGENT_WINDOW_HOURS)
      : 1 - normalize(hoursUntil, URGENT_WINDOW_HOURS, WEEK_WINDOW_HOURS);

    // Buy Now score: has buy now = 1, no = 0
    const hasBuyNow = lot.isBuyNow && Number.isFinite(buyNow) && buyNow > 0;
    const buyNowScore = hasBuyNow ? 1 : 0;

    const score = yearScore * w.year + mileageScore * w.mileage + priceScore * w.price + timeScore * w.time + buyNowScore * w.buyNow;

    // Reason codes
    if (tier === 'urgent') reasonCodes.push('Торги скоро');
    if (hasBuyNow) reasonCodes.push('Є Buy Now');
    reasonCodes.push('Дані свіжі');
    if (lot.primaryDamage) reasonCodes.push(lot.primaryDamage);

    return {
      provider: lot.provider,
      externalLotId: lot.externalLotId,
      title: lot.title,
      make: lot.make || 'Unknown',
      model: lot.model || 'Unknown',
      year: lot.year ?? 0,
      bodyType: lot.bodyStyle || null,
      thumbnailUrl: lot.mediaUrls[0] ?? null,
      mediaCount: lot.mediaUrls.length,
      odometerKm: lot.odometerKm ?? null,
      locationCity: lot.locationDisplay || null,
      locationState: lot.locationState || null,
      currentBidUsd: Number.isFinite(bid) && bid > 0 ? bid : null,
      buyNowUsd: Number.isFinite(buyNow) && buyNow > 0 ? buyNow : null,
      buyNowAvailable: lot.isBuyNow && hasBuyNow,
      auctionAt: lot.auctionTime?.toISOString() ?? null,
      lifecycle: lot.lifecycleState,
      score: Math.round(score * 1000) / 1000,
      reasonCodes,
      manualPin: false,
      qualityInclude: evaluateCatalogQuality(lot).include,
      qualityReason: evaluateCatalogQuality(lot).reason,
    };
  }

  private stillEligible(candidate: HotOfferCandidate, tier: HotOfferTier, now: Date): boolean {
    // Check lifecycle
    if (['ENDED', 'SOLD', 'REMOVED', 'NOT_READY'].includes(candidate.lifecycle)) return false;
    // Check auction time still in tier window
    if (!candidate.auctionAt) return false;
    const msUntil = new Date(candidate.auctionAt).getTime() - now.getTime();
    if (msUntil <= 0) return false;
    const hoursUntil = msUntil / (1000 * 60 * 60);
    if (tier === 'urgent' && hoursUntil > URGENT_WINDOW_HOURS) return false;
    if (tier === 'this-week' && (hoursUntil <= URGENT_WINDOW_HOURS || hoursUntil > WEEK_WINDOW_HOURS)) return false;
    // Check price
    if ((candidate.currentBidUsd ?? 0) <= 0 && (candidate.buyNowUsd ?? 0) <= 0) return false;
    // Check quality
    if (!candidate.qualityInclude) return false;
    return true;
  }

  private toPublicItem(candidate: HotOfferCandidate, manualPin: boolean): PublicHotOfferItem {
    const buyNowAvailable = candidate.buyNowAvailable;
    const primaryUsd = candidate.buyNowUsd ?? candidate.currentBidUsd;
    const basis = candidate.buyNowUsd ? 'buyNow' : candidate.currentBidUsd ? 'currentBid' : null;
    return {
      key: `auctionLot:${candidate.provider}:${candidate.externalLotId}`,
      kind: 'auctionLot',
      source: candidate.provider,
      title: candidate.title,
      make: candidate.make,
      model: candidate.model,
      year: candidate.year,
      bodyType: candidate.bodyType,
      fuelType: null,
      transmission: null,
      driveType: null,
      locationState: candidate.locationState,
      locationCity: candidate.locationCity,
      odometerKm: candidate.odometerKm,
      thumbnailUrl: candidate.thumbnailUrl,
      mediaCount: candidate.mediaCount,
      price: {
        currency: 'USD',
        primaryUsd,
        basis,
        currentBidUsd: candidate.currentBidUsd,
        buyNowUsd: candidate.buyNowUsd,
        buyNowAvailable: buyNowAvailable ? true : false,
      },
      provider: candidate.provider,
      externalLotId: candidate.externalLotId,
      lifecycle: candidate.lifecycle,
      freshness: 'FRESH',
      auctionAt: candidate.auctionAt,
      providerTimezoneOffset: null,
      reasonCodes: candidate.reasonCodes,
      manualPin,
    };
  }

  private windowStart(tier: HotOfferTier, now: Date): Date {
    return tier === 'urgent' ? now : new Date(now.getTime() + URGENT_WINDOW_HOURS * 60 * 60 * 1000);
  }

  private windowEnd(tier: HotOfferTier, now: Date): Date {
    return tier === 'urgent'
      ? new Date(now.getTime() + URGENT_WINDOW_HOURS * 60 * 60 * 1000)
      : new Date(now.getTime() + WEEK_WINDOW_HOURS * 60 * 60 * 1000);
  }
}

// ── Validation ─────────────────────────────────────────────────

function validateWeights(w: any): HotOfferPolicy['weights'] {
  const weights = {
    year: Number(w?.year ?? DEFAULT_POLICY.weights.year),
    mileage: Number(w?.mileage ?? DEFAULT_POLICY.weights.mileage),
    price: Number(w?.price ?? DEFAULT_POLICY.weights.price),
    time: Number(w?.time ?? DEFAULT_POLICY.weights.time),
    buyNow: Number(w?.buyNow ?? DEFAULT_POLICY.weights.buyNow),
  };
  // All must be non-negative
  for (const [k, v] of Object.entries(weights)) {
    if (!Number.isFinite(v) || v < 0) {
      throw new BadRequestException({ code: 'INVALID_WEIGHT', message: `Вага ${k} має бути невід'ємним числом` });
    }
  }
  const sum = weights.year + weights.mileage + weights.price + weights.time + weights.buyNow;
  if (Math.abs(sum - 100) > 0.01) {
    throw new BadRequestException({ code: 'WEIGHTS_MUST_SUM_100', message: `Сума ваг має дорівнювати 100, зараз ${sum}` });
  }
  return weights;
}

function validatePolicy(policy: HotOfferPolicy): void {
  if (policy.minYear < MIN_CATALOG_YEAR) {
    throw new BadRequestException({ code: 'MIN_YEAR_TOO_LOW', message: `Мінімальний рік не може бути меншим за ${MIN_CATALOG_YEAR}` });
  }
  validateWeights(policy.weights);
  if (policy.maxMileageKm !== null && (policy.maxMileageKm <= 0 || !Number.isFinite(policy.maxMileageKm))) {
    throw new BadRequestException({ code: 'INVALID_MILEAGE', message: 'Максимальний пробіг має бути додатним числом' });
  }
  if (policy.maxKnownPriceUsd !== null && (policy.maxKnownPriceUsd <= 0 || !Number.isFinite(policy.maxKnownPriceUsd))) {
    throw new BadRequestException({ code: 'INVALID_PRICE', message: 'Максимальна ціна має бути додатним числом' });
  }
  if (!Array.isArray(policy.extraDamageExclusions)) {
    throw new BadRequestException({ code: 'INVALID_EXCLUSIONS', message: 'Додаткові винятки мають бути масивом рядків' });
  }
}
