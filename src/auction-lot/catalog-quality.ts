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
  { pattern: /\btractor\b(?!.*\btrailer\b)/i, label: 'Tractor' }, // "tractor" but not "tractor trailer"
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
  // 1. Year check
  if (lot.year === null || lot.year < MIN_CATALOG_YEAR) {
    return {
      include: false,
      reasonCode: 'YEAR_TOO_OLD',
      reason: `Рік випуску менший за ${MIN_CATALOG_YEAR} або невідомий`,
    };
  }

  // 2. Commercial vehicle check — body style + title + make + model
  const vehicleText = [lot.title, lot.bodyStyle, lot.make, lot.model]
    .filter(Boolean)
    .join(' ');

  for (const term of COMMERCIAL_TERMS) {
    if (term.pattern.test(vehicleText)) {
      return {
        include: false,
        reasonCode: 'COMMERCIAL_VEHICLE',
        reason: `Комерційний/спеціальний транспорт (${term.label})`,
      };
    }
  }

  // 3. Non-repairable document check — sale doc + title + body
  const docText = [lot.saleDocumentName, lot.saleDocumentType, lot.title, lot.bodyStyle]
    .filter(Boolean)
    .join(' ');

  for (const term of NON_REPAIRABLE_TERMS) {
    if (term.pattern.test(docText)) {
      return {
        include: false,
        reasonCode: 'NON_REPAIRABLE',
        reason: `Неремонтопридатний (${term.label})`,
      };
    }
  }

  // 4. Catastrophic damage — primary, secondary damage + loss
  const damageText = [lot.primaryDamage, lot.secondaryDamage, lot.loss]
    .filter(Boolean)
    .join(' ');

  for (const term of CATASTROPHIC_TERMS) {
    if (term.pattern.test(damageText)) {
      return {
        include: false,
        reasonCode: 'CATASTROPHIC_DAMAGE',
        reason: `Катострофічне пошкодження (${term.label})`,
      };
    }
  }

  return { include: true, reasonCode: null, reason: null };
}

// ── Prisma WHERE helper ─────────────────────────────────────────
//
// Returns a Prisma `where` fragment that pushes the same exclusion logic
// to the database so that `count()` and `findMany({ skip, take })` match
// the function exactly.  We use `contains` with `mode: 'insensitive'`
// for substring matching (PostgreSQL ILIKE under the hood).
//
// IMPORTANT: keep these patterns in sync with the regex lists above.

import type { Prisma } from '@prisma/client';

/** Terms that must NOT appear (case-insensitive substring) in vehicle text fields. */
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

/** Fields to check for commercial terms. */
const COMMERCIAL_FIELDS: Array<keyof Prisma.DiscoveredLotWhereInput> = [
  'bodyStyle', 'title',
];

/** Fields to check for non-repairable terms. */
const DOC_FIELDS: Array<keyof Prisma.DiscoveredLotWhereInput> = [
  'saleDocumentName', 'saleDocumentType', 'title',
];

/**
 * IMPORTANT: Only use fields that are guaranteed non-null for the majority of rows.
 * primaryDamage is always populated by the normalizer, while secondaryDamage
 * and loss are frequently NULL. SQL three-valued logic means
 * NOT(field ILIKE '%term%') evaluates to NULL (not TRUE) when field is NULL,
 * which would exclude valid rows from results.
 *
 * The function-form evaluateCatalogQuality still checks ALL fields including
 * secondaryDamage and loss. The DB WHERE is a conservative subset that only
 * uses reliably-populated fields.
 */
const DAMAGE_FIELDS_DB: Array<keyof Prisma.DiscoveredLotWhereInput> = [
  'primaryDamage',
];

/**
 * Build a Prisma `where` that excludes lots failing the quality check.
 * Combine with eligibility filters via `AND`.
 *
 * IMPORTANT: SQL three-valued logic — NOT(field ILIKE '%term%') on NULL
 * evaluates to NULL (falsy). We avoid this by only checking fields that
 * are guaranteed non-null per the normalizer: `title` and `primaryDamage`.
 * The function-form evaluateCatalogQuality still checks ALL fields including
 * nullable ones (bodyStyle, saleDocumentName, etc.) for in-memory filtering.
 */
export function qualityExclusionWhere(): Prisma.DiscoveredLotWhereInput {
  // Commercial: title is always non-null
  const commercialExclusions = DB_COMMERCIAL_TERMS.map((term) => ({
    title: { contains: term, mode: 'insensitive' as const },
  }));

  // Non-repairable: title is always non-null
  const nonRepairableExclusions = DB_NON_REPAIRABLE_TERMS.map((term) => ({
    title: { contains: term, mode: 'insensitive' as const },
  }));

  // Catastrophic: primaryDamage is always non-null
  const catastrophicExclusions = DB_CATASTROPHIC_TERMS.map((term) => ({
    primaryDamage: { contains: term, mode: 'insensitive' as const },
  }));

  return {
    NOT: {
      OR: [
        ...commercialExclusions,
        ...nonRepairableExclusions,
        ...catastrophicExclusions,
      ],
    },
  };
}

/**
 * Full public-catalog WHERE: eligibility + quality.
 * Use this for `findMany` and `count` in USA catalog queries.
 */
export function publicCatalogWhere(
  extra?: Prisma.DiscoveredLotWhereInput,
): Prisma.DiscoveredLotWhereInput {
  return {
    // Eligibility (same as `eligibleLot()` but in SQL)
    lifecycleState: { in: ['UPCOMING', 'OPEN', 'LIVE'] },
    freshnessState: 'FRESH',
    availabilityConfirmed: true,
    consecutiveMisses: { lt: 3 },

    // Task 050: A past auctionAt must never remain publicly active.
    // Even if lifecycleState hasn't been reconciled by the scheduler yet,
    // the catalog must not show lots whose auction time has passed.
    auctionTime: { gte: new Date() },

    // Quality: year
    year: { gte: MIN_CATALOG_YEAR },

    // Quality: text-based exclusions
    ...qualityExclusionWhere(),

    // Caller overrides/extensions
    ...(extra ?? {}),
  };
}
