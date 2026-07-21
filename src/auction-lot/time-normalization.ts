// ─────────────────────────────────────────────────────────────
// Task 053: Strict Time Normalization
// Only accept auctionAtUtc when there is provenance evidence.
// ─────────────────────────────────────────────────────────────

export type TimestampEvidence = 'UTC_OFFSET' | 'PROVIDER_TIMEZONE' | 'NONE';

export interface TimeNormalizationResult {
  /** Confirmed UTC time, or null if unconfirmed */
  auctionAtUtc: Date | null;
  /** Evidence level for the timestamp */
  evidence: TimestampEvidence;
  /** Raw provider timestamp string preserved for diagnostics */
  raw: string | null;
}

// Known provider facility timezone mappings (authorized)
// These are the only timezones we accept alongside local datetime strings.
const PROVIDER_FACILITY_TIMEZONES: Record<string, string> = {
  // Copart facility codes → IANA timezone
  // Copart uses US facilities primarily
  'CA': 'America/Los_Angeles',
  'WA': 'America/Los_Angeles',
  'OR': 'America/Los_Angeles',
  'NV': 'America/Los_Angeles',
  'AZ': 'America/Phoenix',
  'UT': 'America/Denver',
  'CO': 'America/Denver',
  'NM': 'America/Denver',
  'MT': 'America/Denver',
  'WY': 'America/Denver',
  'ID': 'America/Denver',
  'TX': 'America/Chicago',
  'OK': 'America/Chicago',
  'KS': 'America/Chicago',
  'NE': 'America/Chicago',
  'SD': 'America/Chicago',
  'IA': 'America/Chicago',
  'MO': 'America/Chicago',
  'AR': 'America/Chicago',
  'LA': 'America/Chicago',
  'MN': 'America/Chicago',
  'WI': 'America/Chicago',
  'IL': 'America/Chicago',
  'IN': 'America/Indiana/Indianapolis',
  'MI': 'America/Detroit',
  'OH': 'America/New_York',
  'KY': 'America/New_York',
  'TN': 'America/Chicago',
  'MS': 'America/Chicago',
  'AL': 'America/Chicago',
  'GA': 'America/New_York',
  'FL': 'America/New_York',
  'SC': 'America/New_York',
  'NC': 'America/New_York',
  'VA': 'America/New_York',
  'WV': 'America/New_York',
  'DC': 'America/New_York',
  'MD': 'America/New_York',
  'DE': 'America/New_York',
  'NJ': 'America/New_York',
  'PA': 'America/New_York',
  'NY': 'America/New_York',
  'CT': 'America/New_York',
  'RI': 'America/New_York',
  'MA': 'America/New_York',
  'VT': 'America/New_York',
  'NH': 'America/New_York',
  'ME': 'America/New_York',
  'AK': 'America/Anchorage',
  'HI': 'Pacific/Honolulu',
};

/**
 * Check if a string is a valid RFC3339 with explicit UTC offset or Z.
 * Examples accepted: "2026-07-20T15:30:00Z", "2026-07-20T15:30:00.000Z",
 *                     "2026-07-20T15:30:00+00:00", "2026-07-20T15:30:00-05:00"
 */
function hasExplicitOffset(s: string): boolean {
  // Must end with Z or +HH:MM / -HH:MM
  return /Z$|[+-]\d{2}:\d{2}$/.test(s.trim());
}

/**
 * Parse a confirmed RFC3339 timestamp to UTC Date.
 * Returns null if parsing fails.
 */
function parseRfc3339(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Attempt to parse a local datetime string using a known provider timezone.
 * Returns null if timezone cannot be determined.
 */
function parseWithProviderTimezone(
  localDt: string,
  facilityState?: string | null,
): { date: Date | null; timezone: string | null } {
  if (!facilityState) return { date: null, timezone: null };
  const tz = PROVIDER_FACILITY_TIMEZONES[facilityState.toUpperCase()];
  if (!tz) return { date: null, timezone: null };

  try {
    // Normalize: strip any trailing offset/Z, pad date-only
    const isoLocal = localDt.includes('T')
      ? localDt.replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '')
      : localDt.length === 10
        ? `${localDt}T00:00:00`
        : localDt;

    // Parse as if it were UTC to get a reference instant
    const asUtc = new Date(isoLocal + 'Z');
    if (Number.isNaN(asUtc.getTime())) return { date: null, timezone: null };

    // Get the timezone offset at this instant using Intl
    // The offset = UTC - local, so local = UTC - offset
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });

    // What does the clock show in `tz` at the `asUtc` instant?
    const parts = dtf.formatToParts(asUtc);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0';
    // Reconstruct as UTC to compare
    const wallInTz = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);

    // offset = asUtc - wallInTz (positive if tz is behind UTC)
    // For PDT (America/Los_Angeles in July): offset = -7h = -420 min
    // wallInTz would be 7h behind asUtc
    // So offset = asUtc - wallInTz = +7h ... wait
    // Actually: if localDt = "10:00" in PDT (UTC-7),
    // asUtc treats "10:00" as UTC = 10:00Z
    // wallInTz = what clock shows in PDT at 10:00Z = 03:00 PDT
    // offset = asUtc - wallInTz = 10:00 - 03:00 = 7h = 420 min
    // But PDT is UTC-7, meaning local = UTC - 7h
    // So UTC = local + 7h = 10:00 + 7h = 17:00Z ✓
    const offsetMs = asUtc.getTime() - wallInTz.getTime();
    // UTC = localTime + offset (where offset is positive for zones behind UTC)
    // Wait: offset = UTC - local → UTC = local + offset
    // But we want UTC from the input local time
    // Input: localDt represents wall clock in tz
    // asUtc = localDt treated as UTC (wrong, but a reference)
    // offset = how much the tz is behind UTC at this instant
    // realUtc = asUtc + offset
    const realUtc = new Date(asUtc.getTime() + offsetMs);
    return { date: realUtc, timezone: tz };
  } catch {
    return { date: null, timezone: null };
  }
}

/**
 * Strict time normalization.
 *
 * Accepts confirmed auctionAtUtc only when:
 * 1. Provider string is RFC3339 with Z or explicit numeric offset; or
 * 2. The same provider observation contains local datetime and explicit
 *    authorized facility/provider timezone.
 *
 * Rejects:
 * - date-only values (e.g. "2026-07-20")
 * - values accepted merely by JavaScript new Date(...)
 * - guessed browser/server timezone
 * - inferred timezone without provider evidence
 */
export function normalizeAuctionTimestamp(
  rawTimestamp: string | null | undefined,
  facilityState?: string | null | undefined,
): TimeNormalizationResult {
  if (!rawTimestamp || typeof rawTimestamp !== 'string') {
    return { auctionAtUtc: null, evidence: 'NONE', raw: rawTimestamp ?? null };
  }

  const trimmed = rawTimestamp.trim();

  // Reject date-only values (e.g. "2026-07-20")
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { auctionAtUtc: null, evidence: 'NONE', raw: rawTimestamp };
  }

  // Case 1: RFC3339 with explicit Z or numeric offset
  if (hasExplicitOffset(trimmed)) {
    const date = parseRfc3339(trimmed);
    if (date) {
      return { auctionAtUtc: date, evidence: 'UTC_OFFSET', raw: rawTimestamp };
    }
  }

  // Case 2: Local datetime with known facility timezone
  if (facilityState) {
    const { date, timezone } = parseWithProviderTimezone(trimmed, facilityState);
    if (date && timezone) {
      return { auctionAtUtc: date, evidence: 'PROVIDER_TIMEZONE', raw: rawTimestamp };
    }
  }

  // Reject — insufficient evidence
  return { auctionAtUtc: null, evidence: 'NONE', raw: rawTimestamp };
}
