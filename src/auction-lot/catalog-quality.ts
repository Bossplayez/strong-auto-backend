/**
 * Catalog Quality Evaluator (Task 046)
 *
 * Deterministic function that decides whether a lot should appear in the
 * public catalog. Used by:
 *  - public list / detail / count / filter-options projections
 *  - admin detail (shows the outcome + reason code)
 *
 * Rules are intentionally conservative:
 *  - exclude obvious scrap / commercial / catastrophic
 *  - keep normal repairable salvage (front end, rear end, hail, etc.)
 *
 * No DB writes, no migrations — computed from provider fields at read time.
 */

// ── Reason codes ──────────────────────────────────────────────
export type QualityReasonCode =
  | 'YEAR_TOO_OLD'
  | 'COMMERCIAL_VEHICLE'
  | 'NON_REPAIRABLE'
  | 'CATASTROPHIC_DAMAGE';

export interface QualitySubject {
  year: number | null;
  bodyStyle: string | null;
  title: string;
  primaryDamage: string | null;
  secondaryDamage: string | null;
  loss: string | null;
  saleDocumentName: string | null;
  saleDocumentType: string | null;
  make: string;
  model: string;
}

export interface QualityOutcome {
  include: boolean;
  reasonCode: QualityReasonCode | null;
  reason: string | null; // Ukrainian explanation for admin
}

export const MIN_CATALOG_YEAR = 2010;

// ── Pattern lists ──────────────────────────────────────────────

/** Multi-word phrases that unambiguously identify commercial vehicles. */
const COMMERCIAL_TERMS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bbox\s*truck\b/i, label: 'Box truck' },
  { pattern: /\bcargo\s*truck\b/i, label: 'Cargo truck' },
  { pattern: /\bcargo\s*van\b/i, label: 'Cargo van' },
  { pattern: /\btractor\s*trailer\b/i, label: 'Tractor trailer' },
  { pattern: /\bsemi\b/i, label: 'Semi' },
  { pattern: /\b(?:school|city|transit|coach|shuttle)\s+bus\b/i, label: 'Bus' },
  { pattern: /\bmotor\s*home\b/i, label: 'Motor home' },
  { pattern: /\bmotorhome\b/i, label: 'Motorhome' },
  { pattern: /\brv\s+class\s+[a-c]\b/i, label: 'RV' },
  { pattern: /\bexcavator\b/i, label: 'Excavator' },
  { pattern: /\bbulldozer\b/i, label: 'Bulldozer' },
  { pattern: /\bforklift\b/i, label: 'Forklift' },
  { pattern: /\bdump\s*truck\b/i, label: 'Dump truck' },
  { pattern: /\bcement\s*mixer\b/i, label: 'Cement mixer' },
  { pattern: /\bbackhoe\b/i, label: 'Backhoe' },
  { pattern: /\bharvester\b/i, label: 'Harvester' },
  { pattern: /\btractor\b(?!.*\btrailer\b)/i, label: 'Tractor' },
  { pattern: /\btrailer\b/i, label: 'Trailer' },
  { pattern: /\bmotorcycle\b/i, label: 'Motorcycle' },
  { pattern: /\batv\b/i, label: 'ATV' },
  { pattern: /\butv\b/i, label: 'UTV' },
  { pattern: /\bquad\b/i, label: 'Quad' },
  { pattern: /\bdirt\s*bike\b/i, label: 'Dirt bike' },
  { pattern: /\bscooter\b/i, label: 'Scooter' },
  { pattern: /\bmoped\b/i, label: 'Moped' },
  { pattern: /\bsnowmobile\b/i, label: 'Snowmobile' },
  { pattern: /\bgolf\s*cart\b/i, label: 'Golf cart' },
];

/** Non-repairable / junk title keywords. */
const NON_REPAIRABLE_TERMS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bnon[\s-]*repairable\b/i, label: 'Non-repairable' },
  { pattern: /\bjunk\b/i, label: 'Junk' },
  { pattern: /\bcertificate\s*of\s*destruction\b/i, label: 'Certificate of destruction' },
  { pattern: /\bparts\s*only\b/i, label: 'Parts only' },
  { pattern: /\bdismantled\b/i, label: 'Dismantled' },
  { pattern: /\bstripped\b/i, label: 'Stripped' },
  { pattern: /\bexport\s*only\b/i, label: 'Export only' },
  { pattern: /\bsalvage\s*only\b/i, label: 'Salvage only' },
];

/** Catastrophic damage keywords — exclude from public catalog. */
const CATASTROPHIC_TERMS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfire\b/i, label: 'Fire' },
  { pattern: /\bburn(?:ed|t)?\b/i, label: 'Burn' },
  { pattern: /\bbiohazard\b/i, label: 'Biohazard' },
  { pattern: /\bbio\s*hazard\b/i, label: 'Bio hazard' },
  { pattern: /\bflood\b/i, label: 'Flood' },
  { pattern: /\bwater\s*damage\b/i, label: 'Water damage' },
  { pattern: /\bsubmerged\b/i, label: 'Submerged' },
  { pattern: /\brollover\b/i, label: 'Rollover' },
  { pattern: /\brolled\s*over\b/i, label: 'Rolled over' },
];

// ── Evaluator ──────────────────────────────────────────────────

export function evaluateCatalogQuality(lot: QualitySubject): QualityOutcome {
  if (lot.year === null || lot.year < MIN_CATALOG_YEAR) {
    return { include: false, reasonCode: 'YEAR_TOO_OLD', reason: `Рік випуску менший за ${MIN_CATALOG_YEAR} або невідомий` };
  }
  const vehicleText = [lot.title, lot.bodyStyle, lot.make, lot.model].filter(Boolean).join(' ');
  for (const term of COMMERCIAL_TERMS) {
    if (term.pattern.test(vehicleText)) {
      return { include: false, reasonCode: 'COMMERCIAL_VEHICLE', reason: `Комерційний/спеціальний транспорт (${term.label})` };
    }
  }
  const docText = [lot.saleDocumentName, lot.saleDocumentType, lot.title, lot.bodyStyle].filter(Boolean).join(' ');
  for (const term of NON_REPAIRABLE_TERMS) {
    if (term.pattern.test(docText)) {
      return { include: false, reasonCode: 'NON_REPAIRABLE', reason: `Неремонтопридатний (${term.label})` };
    }
  }
  const damageText = [lot.primaryDamage, lot.secondaryDamage, lot.loss].filter(Boolean).join(' ');
  for (const term of CATASTROPHIC_TERMS) {
    if (term.pattern.test(damageText)) {
      return { include: false, reasonCode: 'CATASTROPHIC_DAMAGE', reason: `Катострофічне пошкодження (${term.label})` };
    }
  }
  return { include: true, reasonCode: null, reason: null };
}

// ── Prisma WHERE helper ─────────────────────────────────────────

import type { Prisma } from '@prisma/client';

const DB_COMMERCIAL_TERMS = [
  'box truck', 'cargo truck', 'cargo van', 'tractor trailer', 'semi',
  'school bus', 'city bus', 'transit bus', 'coach bus', 'shuttle bus',
  'motor home', 'motorhome', 'rv class a', 'rv class b', 'rv class c',
  'excavator', 'bulldozer', 'forklift', 'dump truck', 'cement mixer',
  'backhoe', 'harvester', 'tractor', 'trailer',
  'motorcycle', 'atv', 'utv', 'quad', 'dirt bike', 'scooter', 'moped',
  'snowmobile', 'golf cart',
];
const DB_NON_REPAIRABLE_TERMS = [
  'non-repairable', 'non repairable', 'nonrepairable',
  'junk', 'certificate of destruction', 'parts only',
  'dismantled', 'stripped', 'export only', 'salvage only',
];
const DB_CATASTROPHIC_TERMS = [
  'fire', 'burn', 'burned', 'burnt',
  'biohazard', 'bio hazard',
  'flood', 'water damage', 'submerged',
  'rollover', 'rolled over',
];

export function qualityExclusionWhere(): Prisma.DiscoveredLotWhereInput {
  const commercialExclusions = DB_COMMERCIAL_TERMS.map((term) => ({ title: { contains: term, mode: 'insensitive' as const } }));
  const nonRepairableExclusions = DB_NON_REPAIRABLE_TERMS.map((term) => ({ title: { contains: term, mode: 'insensitive' as const } }));
  const catastrophicExclusions = DB_CATASTROPHIC_TERMS.map((term) => ({ primaryDamage: { contains: term, mode: 'insensitive' as const } }));
  return { NOT: { OR: [...commercialExclusions, ...nonRepairableExclusions, ...catastrophicExclusions] } };
}

// ── Task 056: Canonical public visibility predicate ─────────────
//
// Public visibility no longer depends on the scheduler's freshnessState.
// Instead we use canonical observation timestamps with a 48h window.
//
// The scheduler's HOT/WARM/COLD tiers control REFRESH PRIORITY only.
// A missed 15-minute refresh must NEVER hide a valid future lot.
//

/**
 * Canonical public-auction decision. This deliberately ignores persisted
 * lifecycle/freshness/tier fields: they are scheduler projections, not
 * provider truth.
 */

/**
 * Full public-catalog WHERE: canonical visibility + quality.
 *
 * Visibility rules:
 * - lifecycle active (UPCOMING/OPEN/LIVE)
 * - availability confirmed
 * - not UNAVAILABLE
 * - consecutiveMisses < 3
 * - canonical observation within 48h (listingObservedAt → lastProviderUpdateAt → availabilityConfirmedAt→lastSeenAt)
 * - auction time from now through +7 days
 * - no explicit terminal provider result
 * - quality exclusions
 *
 * NOTE: freshnessState is NOT used. The scheduler may mark STALE for
 * refresh-priority purposes — this does NOT affect public visibility.
 */
