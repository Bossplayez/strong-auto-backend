/**
 * Vehicle value normalization helpers.
 *
 * Canonical machine values are stored in the DB and returned by the API.
 * Ukrainian UI labels live in the frontend (`vehicle-labels.ts`).
 *
 * During the transition period (before backfill), both old raw values
 * and future canonical values must coexist.  Helpers below are pure
 * and deterministic — safe to unit-test without a DB connection.
 */

// ── Canonical machine values ──────────────────────────────────

export const FUEL_DIESEL = 'DIESEL' as const;
export const FUEL_GASOLINE = 'GASOLINE' as const;

export const DRIVE_AWD = 'AWD' as const;
export const DRIVE_FWD = 'FWD' as const;
export const DRIVE_RWD = 'RWD' as const;
// 4WD is reserved — do not map any current ambiguous value to it in this task.
export const DRIVE_4WD = '4WD' as const;

export const BODY_SUV = 'SUV' as const;
export const BODY_SEDAN = 'SEDAN' as const;
export const BODY_HATCHBACK = 'HATCHBACK' as const;

// ── Mapping tables (uppercase key → canonical) ─────────────────

const FUEL_MAP: Record<string, string> = {
  DIESEL: FUEL_DIESEL,
  GAS: FUEL_GASOLINE,
  GASOLINE: FUEL_GASOLINE,
};

const DRIVE_MAP: Record<string, string> = {
  'ALL WHEEL DRIVE': DRIVE_AWD,
  'ALL-WHEEL DRIVE': DRIVE_AWD,
  AWD: DRIVE_AWD,
  'FRONT WHEEL DRIVE': DRIVE_FWD,
  'FRONT-WHEEL DRIVE': DRIVE_FWD,
  FWD: DRIVE_FWD,
  'REAR WHEEL DRIVE': DRIVE_RWD,
  'REAR-WHEEL DRIVE': DRIVE_RWD,
  RWD: DRIVE_RWD,
};

const BODY_MAP: Record<string, string> = {
  '4DR SPORT UTILITY': BODY_SUV,
  SUV: BODY_SUV,
  'SPORT UTILITY': BODY_SUV,
  'SEDAN 4DR': BODY_SEDAN,
  SEDAN: BODY_SEDAN,
  'HATCHBACK 4DR': BODY_HATCHBACK,
  HATCHBACK: BODY_HATCHBACK,
};

// ── Ambiguous values (do NOT auto-map) ─────────────────────────

const AMBIGUOUS_DRIVE = new Set([
  '4X4 W/REAR WHEEL DRV',
  '4X4 W/REAR WHEEL DRIVE',
]);

// ── Pure helpers ───────────────────────────────────────────────

/**
 * Normalise a raw fuel-type string to its canonical machine value.
 * Returns `null` for null/blank input.
 * Returns the trimmed original value if no mapping is found
 * (preserves unknown / malformed values during transition).
 */
export function normalizeFuelType(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const key = trimmed.toUpperCase();
  return FUEL_MAP[key] ?? trimmed;
}

/**
 * Normalise a raw drive-type string to its canonical machine value.
 * Returns `null` for null/blank input.
 * Ambiguous values are preserved as-is (trimmed).
 * Unknown values are preserved as-is (trimmed).
 */
export function normalizeDriveType(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const key = trimmed.toUpperCase();

  // Explicitly preserve ambiguous values
  if (AMBIGUOUS_DRIVE.has(key)) return trimmed;

  return DRIVE_MAP[key] ?? trimmed;
}

/**
 * Normalise a raw body-type string to its canonical machine value.
 * Returns `null` for null/blank input.
 * Returns the trimmed original value if no mapping is found.
 */
export function normalizeBodyType(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const key = trimmed.toUpperCase();
  return BODY_MAP[key] ?? trimmed;
}

/**
 * Convenience: normalise all three fields at once.
 * Returns a new object — does not mutate the input.
 */
export function normalizeVehicleFields(input: {
  fuelType?: string | null;
  driveType?: string | null;
  bodyType?: string | null;
}): {
  fuelType: string | null;
  driveType: string | null;
  bodyType: string | null;
} {
  return {
    fuelType: normalizeFuelType(input.fuelType),
    driveType: normalizeDriveType(input.driveType),
    bodyType: normalizeBodyType(input.bodyType),
  };
}
