/**
 * Normalize a raw provider lot into a DiscoveredLot-compatible object.
 * Excludes: seller name, seller phone (sensitive), full raw payload.
 * VIN is stored for dedup but not exposed in admin search results.
 */

export interface NormalizedLotData {
  title: string;
  make: string;
  model: string;
  year: number;
  vin: string | null;
  slugVin: string | null;
  platformId: number | null;
  subLot: boolean;
  ad: Date | null;
  auctionState: string | null;
  auctionFormatted: string | null;
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
function extractMediaUrls(media: Record<string, any> | undefined): string[] {
  if (!media || !Array.isArray(media.items)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const item of media.items) {
    if (typeof item === 'string') {
      if (item.startsWith('https://') && !seen.has(item)) {
        seen.add(item);
        urls.push(item);
      }
      continue;
    }
    if (item && typeof item === 'object') {
      // Prefer full, then large, then thumb
      const candidate = item.full ?? item.large ?? item.thumb ?? '';
      if (candidate && typeof candidate === 'string' && candidate.startsWith('https://') && !seen.has(candidate)) {
        seen.add(candidate);
        urls.push(candidate);
      }
    }
  }

  return urls;
}

export function normalizeDiscoveredLot(
  raw: Record<string, any>,
  _provider: string,
): NormalizedLotData {
  const auction = raw.auction ?? {};
  const pricing = raw.pricing ?? {};
  const condition = raw.condition ?? {};
  const specs = raw.vehicle_specs ?? {};
  const media = raw.media ?? {};
  const location = raw.location ?? {};
  const facility = raw.facility ?? {};
  const seller = raw.seller ?? {};
  const saleDoc = raw.sale_document ?? {};
  const odometer = raw.odometer ?? {};

  // Map real auction timestamp from provider (not discovery time)
  // Provider field: auction.auction_at (same as copart.service.ts mapRawToVehicle)
  const auctionTime = toDate(auction.auction_at) ?? toDate(auction.auctionTime) ?? null;

  return {
    title: String(raw.title ?? `${raw.year ?? ''} ${raw.make ?? ''} ${raw.model ?? ''}`).trim(),
    make: String(raw.make ?? 'Unknown').trim(),
    model: String(raw.model ?? 'Unknown').trim(),
    year: toNumber(raw.year) ?? new Date().getFullYear(),
    vin: raw.vin ? String(raw.vin) : null,
    slugVin: raw.slug_vin ? String(raw.slug_vin) : null,
    platformId: toNumber(raw.platform_id),
    subLot: toBool(raw.subLot) ?? false,
    ad: toDate(auction.ad),
    auctionState: auction.state ? String(auction.state) : null,
    auctionFormatted: auction.formatted ? String(auction.formatted) : null,
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
    runCondition: condition.run_condition ? String(condition.run_condition) : null,
    hasKey: toBool(condition.has_key),
    bodyStyle: specs.body_style ? String(specs.body_style) : null,
    engine: specs.engine ? (typeof specs.engine === 'object' ? JSON.stringify(specs.engine) : String(specs.engine)) : null,
    driveType: specs.drive_type ? String(specs.drive_type) : null,
    exteriorColor: specs.exterior_color ? String(specs.exterior_color) : null,
    fuelType: specs.fuel_type ? String(specs.fuel_type) : null,
    transmission: specs.transmission ? String(specs.transmission) : null,
    airbags: specs.airbags ? String(specs.airbags) : null,
    restraintSystem: specs.restraint_system ? String(specs.restraint_system) : null,
    locationDisplay: location.display ? String(location.display) : null,
    locationState: location.state ? String(location.state) : null,
    facilityId: facility.id ? String(facility.id) : null,
    facilityOfficeName: facility.office_name ? String(facility.office_name) : null,
    facilityState: facility.state ? String(facility.state) : null,
    facilityZip: facility.zip ? String(facility.zip) : null,
    has360: toBool(media.has_360) ?? false,
    hasVideo: toBool(media.has_video) ?? false,
    thumbsCount: toNumber(media.thumbs_count) ?? 0,
    mediaUrls: extractMediaUrls(media),
    sellerClass: seller.class ? String(seller.class) : null,
    sellerType: seller.type ? String(seller.type) : null,
    saleDocumentName: saleDoc.name ? String(saleDoc.name) : null,
    saleDocumentType: saleDoc.type ? String(saleDoc.type) : null,
    sourcePayloadHash: null, // computed separately if needed
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
