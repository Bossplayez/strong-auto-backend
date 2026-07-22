/**
 * Normalize a raw provider lot into a DiscoveredLot-compatible object.
 * Excludes: seller name, seller phone (sensitive), full raw payload.
 * VIN is stored for dedup but not exposed in admin search results.
 */

export interface NormalizedLotData {
  title: string;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  slugVin: string | null;
  platformId: number | null;
  subLot: boolean;
  ad: Date | null;
  auctionState: string | null;
  auctionFormatted: string | null;
  auctionTimezoneOffset: number | null;
  auctionTime: Date | null;
  isBuyNow: boolean;
  buyNowUsd: number | null;
  currentBidUsd: number | null;
  estimatedCostUsd: number | null;
  lastSoldPriceUsd: number | null;
  odometerMi: number | null;
  odometerKm: number | null;
  primaryDamage: string | null;
  secondaryDamage: string | null;
  loss: string | null;
  runCondition: string | null;
  hasKey: boolean | null;
  bodyStyle: string | null;
  engine: string | null;
  driveType: string | null;
  exteriorColor: string | null;
  fuelType: string | null;
  transmission: string | null;
  airbags: string | null;
  restraintSystem: string | null;
  locationDisplay: string | null;
  locationState: string | null;
  facilityId: string | null;
  facilityOfficeName: string | null;
  facilityState: string | null;
  facilityZip: string | null;
  has360: boolean;
  hasVideo: boolean;
  thumbsCount: number;
  mediaUrls: string[];
  sellerClass: string | null;
  sellerType: string | null;
  saleDocumentName: string | null;
  saleDocumentType: string | null;
  sourcePayloadHash: string | null;
  /** True unless the provider explicitly says that the listing is unavailable. */
  availabilityConfirmed: boolean;
  // Task 053: Truth Contract V2 fields
  providerAuctionTimestampRaw: string | null;
  hasPricingData: boolean;
  buyNowExplicitlyAbsent: boolean;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return null;
}

function toDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Extract media URLs from provider response.
 * Prefers full URLs, falls back to thumb.
 * Only keeps HTTPS URLs — rejects anything with credentials or non-HTTPS.
 */
function extractMediaUrls(media: unknown): string[] {
  if (!isRecord(media)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();

  const itemsRaw = Array.isArray(media.items) ? media.items : [];
  for (const item of itemsRaw) {
    if (typeof item === 'string') {
      if (item.startsWith('https://') && !seen.has(item)) {
        seen.add(item);
        urls.push(item);
      }
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      // Prefer full, then large, then thumb
      const candidate = obj.full ?? obj.large ?? obj.thumb ?? '';
      if (candidate && typeof candidate === 'string' && candidate.startsWith('https://') && !seen.has(candidate)) {
        seen.add(candidate);
        urls.push(candidate);
      }
    }
  }

  return urls;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function firstProviderText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}

/**
 * Provider body-style fields are not uniform between Copart and IAAI payloads.
 * These are direct provider fields only; never infer a body style from title,
 * photos, make, model, or segment.
 */
export function readProviderBodyStyle(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const specs = isRecord(raw.vehicle_specs) ? raw.vehicle_specs : {};
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  const description = isRecord(raw.vehicle_description) ? raw.vehicle_description : {};

  return firstProviderText(
    specs.body_style,
    raw.BodyStyleName,
    raw.BodyStyle,
    attributes.BodyStyleName,
    attributes.BodyStyle,
    description.BodyStyle,
  );
}

/**
 * An explicit provider inventory type is authoritative. Missing type remains
 * eligible for the text-based admission gate because providers do not expose
 * this field uniformly across every response shape.
 */
export function isProviderAutomobile(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  const inventoryType = firstProviderText(
    attributes.InventoryType,
    raw.inventory_type,
    raw.vehicle_type,
    raw.vehicleType,
  );
  return inventoryType === null || inventoryType.toUpperCase() === 'AUTOMOBILE';
}

function isExplicitlyUnavailable(
  raw: Record<string, unknown>,
  auction: Record<string, unknown>,
  attributes: Record<string, unknown>,
): boolean {
  const explicitAvailability = [
    raw.available,
    raw.is_available,
    raw.isAvailable,
    auction.available,
    auction.is_available,
    auction.isAvailable,
  ];
  if (explicitAvailability.some((value) => toBool(value) === false)) return true;

  const unavailableStatuses = new Set([
    'unavailable',
    'not available',
    'not_available',
    'no longer listed',
    'removed',
  ]);
  const statuses = [
    auction.state,
    auction.status,
    raw.status,
    raw.availability_status,
    attributes.InventoryStatus,
  ];

  return statuses.some((value) => {
    const status = typeof value === 'string' ? value.trim().toLowerCase() : null;
    return status !== null && unavailableStatuses.has(status);
  });
}

export function normalizeDiscoveredLot(
  raw: unknown,
  _provider: string,
): NormalizedLotData {
  if (!isRecord(raw)) {
    throw new Error('normalizeDiscoveredLot: expected object, got ' + typeof raw);
  }

  const auction = isRecord(raw.auction) ? raw.auction : {};
  const pricing = isRecord(raw.pricing) ? raw.pricing : {};
  const condition = isRecord(raw.condition) ? raw.condition : {};
  const specs = isRecord(raw.vehicle_specs) ? raw.vehicle_specs : {};
  const media = isRecord(raw.media) ? raw.media : {};
  const location = isRecord(raw.location) ? raw.location : {};
  const facility = isRecord(raw.facility) ? raw.facility : {};
  const seller = isRecord(raw.seller) ? raw.seller : {};
  const saleDoc = isRecord(raw.sale_document) ? raw.sale_document : {};
  const odometer = isRecord(raw.odometer) ? raw.odometer : {};
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};

  // IAAI alternative paths — some providers nest location under different keys
  const yard = isRecord(raw.yard) ? raw.yard : {};
  const branch = isRecord(raw.branch) ? raw.branch : {};

  // Map real auction timestamp from provider (not discovery time)
  // Provider field: auction.auction_at (ISO 8601 with timezone offset)
  // Also extract timezone offset from the same ISO string
  const auctionTimeRaw =
    (typeof auction.auction_at === 'string' ? auction.auction_at : null) ??
    (typeof auction.full_date === 'string' ? auction.full_date : null) ??
    (typeof auction.ad === 'string' ? auction.ad : null);
  const auctionTime = toDate(auctionTimeRaw);
  // Extract timezone offset in minutes from ISO string (e.g. "+00:00" → 0, "-05:00" → -300)
  let auctionTimezoneOffset: number | null = null;
  if (auctionTimeRaw) {
    const tzMatch = auctionTimeRaw.match(/[+-](\d{2}):(\d{2})$/);
    if (tzMatch) {
      auctionTimezoneOffset = (parseInt(tzMatch[1], 10) * 60 + parseInt(tzMatch[2], 10)) * (tzMatch[0].startsWith('-') ? -1 : 1);
    }
  }

  return {
    title: String(raw.title ?? `${raw.year ?? ''} ${raw.make ?? ''} ${raw.model ?? ''}`).trim(),
    make: String(raw.make ?? 'Unknown').trim(),
    model: String(raw.model ?? 'Unknown').trim(),
    year: toNumber(raw.year),
    vin: raw.vin ? String(raw.vin) : null,
    slugVin: raw.slug_vin ? String(raw.slug_vin) : null,
    platformId: toNumber(raw.platform_id),
    subLot: toBool(raw.subLot) ?? false,
    ad: toDate(auction.ad),
    auctionState: auction.state ? String(auction.state) : null,
    auctionFormatted: auction.formatted ? String(auction.formatted) : null,
    auctionTimezoneOffset,
    auctionTime,
    isBuyNow: toBool(auction.is_buy_now) ?? false,
    buyNowUsd: toNumber(pricing.buy_now_usd),
    currentBidUsd: toNumber(pricing.current_bid_usd),
    estimatedCostUsd: toNumber(pricing.estimated_cost),
    lastSoldPriceUsd: toNumber(pricing.last_sold_price_usd),
    odometerMi: toNumber(odometer.mi),
    odometerKm: toNumber(odometer.km),
    primaryDamage: condition.primary_damage ? String(condition.primary_damage) : null,
    secondaryDamage: condition.secondary_damage ? String(condition.secondary_damage) : null,
    loss: condition.loss ? String(condition.loss) : null,
      runCondition: condition.run_condition
      ? typeof condition.run_condition === 'object'
        ? (String((condition.run_condition as Record<string, unknown>).label ?? (condition.run_condition as Record<string, unknown>).value ?? '') || null)
        : (() => {
            const s = String(condition.run_condition);
            try { const p = JSON.parse(s); return String(p.label ?? p.value ?? s); } catch { return s; }
          })()
      : null,
    hasKey: toBool(condition.has_key),
    bodyStyle: readProviderBodyStyle(raw),
    engine: specs.engine ? (typeof specs.engine === 'object' ? JSON.stringify(specs.engine) : String(specs.engine)) : null,
    driveType: specs.drive_type ? String(specs.drive_type) : null,
    exteriorColor: specs.exterior_color ? String(specs.exterior_color) : null,
    fuelType: specs.fuel_type ? String(specs.fuel_type) : null,
    transmission: specs.transmission ? String(specs.transmission) : null,
    airbags: specs.airbags ? String(specs.airbags) : null,
    restraintSystem: specs.restraint_system ? String(specs.restraint_system) : null,
    locationDisplay: location.display ? String(location.display) :
      (location.city ? String(location.city) : null) ??
      (yard.name ? String(yard.name) : null) ??
      (branch.name ? String(branch.name) : null),
    locationState: location.state ? String(location.state) :
      (location.state_abbreviation ? String(location.state_abbreviation) : null) ??
      (facility.state ? String(facility.state) : null) ??
      (yard.state ? String(yard.state) : null) ??
      (branch.state ? String(branch.state) : null),
    facilityId: facility.id ? String(facility.id) : null,
    facilityOfficeName: facility.office_name ? String(facility.office_name) :
      (yard.name ? String(yard.name) : null) ??
      (branch.name ? String(branch.name) : null),
    facilityState: facility.state ? String(facility.state) :
      (yard.state ? String(yard.state) : null) ??
      (branch.state ? String(branch.state) : null),
    facilityZip: facility.zip ? String(facility.zip) :
      (yard.zip ? String(yard.zip) : null) ??
      (branch.zip ? String(branch.zip) : null),
    has360: toBool(media.has_360) ?? false,
    hasVideo: toBool(media.has_video) ?? false,
    thumbsCount: toNumber(media.thumbs_count) ?? 0,
    mediaUrls: extractMediaUrls(media),
    sellerClass: seller.class ? String(seller.class) : null,
    sellerType: seller.type ? String(seller.type) : null,
    saleDocumentName: saleDoc.name ? String(saleDoc.name) : null,
    saleDocumentType: saleDoc.type ? String(saleDoc.type) : null,
    sourcePayloadHash: null, // computed separately if needed
    availabilityConfirmed: !isExplicitlyUnavailable(raw, auction, attributes),

    // Task 053: Truth Contract V2
    providerAuctionTimestampRaw: auctionTimeRaw, // preserve raw for diagnostics
    hasPricingData: isRecord(raw.pricing) && Object.keys(raw.pricing).length > 0,
    buyNowExplicitlyAbsent: isRecord(raw.auction) && auction.is_buy_now === false,
  };
}

/**
 * Sanitize a DiscoveredLot for API response.
 * Removes: vin, seller name/phone (not stored), raw payload hash.
 */
export function sanitizeLotForResponse(lot: any): any {
  const { vin, sellerClass, sellerType, sourcePayloadHash, ...rest } = lot;
  return {
    ...rest,
    vin: vin ? '***' : null, // redact VIN in responses
  };
}
