import type { DiscoveredLot } from '@prisma/client';
import { hasFreshAuctionPrice, evaluateAuctionTruth } from './public-eligibility';
import { isLegacyCalculatorPlatform } from '../calculator/legacy-calculator-platforms';
import type { CalculatorPreviewInput, CalculatorPreviewUnavailable } from '../calculator/calculator-preview.types';

export type LotCalculatorInputResult =
  | { status: 'available'; input: CalculatorPreviewInput; basis: 'buyNow' | 'currentBid' }
  | CalculatorPreviewUnavailable;

/**
 * Converts only explicit provider facts into the input vocabulary accepted by
 * the pre-existing Strong Auto calculator. Unknowns stay unavailable; they
 * are never guessed from a title, photo, or vehicle class.
 */
export function buildLotCalculatorInput(
  lot: DiscoveredLot,
  now: Date,
): LotCalculatorInputResult {
  if (!evaluateAuctionTruth(lot, now).publicVisible) {
    return { status: 'unavailable', reason: 'LOT_NOT_ELIGIBLE' };
  }
  if (!hasFreshAuctionPrice(lot, now)) {
    return { status: 'unavailable', reason: 'PRICE_NOT_FRESH' };
  }

  const facilityId = lot.facilityId?.trim();
  if (!facilityId || !isLegacyCalculatorPlatform(lot.provider as 'copart' | 'iaai', facilityId)) {
    return { status: 'unavailable', reason: 'LOCATION_UNAVAILABLE' };
  }

  const fuelType = toFuelCode(lot.fuelType);
  const bodyType = toBodyCode(lot.bodyStyle);
  const engineVolumeCc = toEngineVolumeCc(lot.engine);
  if (!lot.year || !fuelType || !bodyType || engineVolumeCc === null) {
    return { status: 'unavailable', reason: 'VEHICLE_DATA_UNAVAILABLE' };
  }
  if (fuelType !== 4 && engineVolumeCc <= 0) {
    return { status: 'unavailable', reason: 'VEHICLE_DATA_UNAVAILABLE' };
  }

  const buyNow = toPositiveNumber(lot.buyNowUsd);
  const currentBid = toPositiveNumber(lot.currentBidUsd);
  const basis = lot.isBuyNow && buyNow !== null
    ? { kind: 'buyNow' as const, amount: buyNow }
    : currentBid !== null
      ? { kind: 'currentBid' as const, amount: currentBid }
      : null;
  if (!basis) {
    return { status: 'unavailable', reason: 'PRICE_NOT_FRESH' };
  }

  return {
    status: 'available',
    basis: basis.kind,
    input: {
      provider: lot.provider as 'copart' | 'iaai',
      fuelType,
      bodyType,
      platformId: facilityId,
      year: lot.year,
      priceUsd: basis.amount,
      engineVolumeCc,
    },
  };
}

export function toFuelCode(value: string | null): 1 | 2 | 3 | 4 | null {
  const normalized = value?.toLowerCase() ?? '';
  if (/\belectric\b|\bev\b/.test(normalized)) return 4;
  if (normalized.includes('hybrid')) return 3;
  if (normalized.includes('diesel')) return 2;
  if (normalized.includes('gas') || normalized.includes('gasoline') || normalized.includes('petrol')) return 1;
  return null;
}

export function toBodyCode(value: string | null): 1 | 2 | 3 | 4 | null {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('motorcycle') || normalized.includes('motorbike')) return 4;
  if (normalized.includes('crossover')) return 2;
  if (normalized.includes('suv') || normalized.includes('sport utility') || normalized.includes('jeep')) return 3;
  if (/(sedan|coupe|hatchback|wagon|convertible)/.test(normalized)) return 1;
  return null;
}

export function toEngineVolumeCc(value: string | null): number | null {
  if (!value || value === '[object Object]') return null;
  const raw = parseEngineRaw(value);
  const cc = raw.match(/(\d{3,5})\s*(?:cc|cm3|cm³)(?![a-z])/i);
  if (cc) return Number(cc[1]);
  const liters = raw.match(/(\d(?:[.,]\d{1,2})?)\s*l\b/i);
  if (liters) return Math.round(Number(liters[1].replace(',', '.')) * 1000);
  return null;
}

function parseEngineRaw(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return [parsed.raw, parsed.engine, parsed.size_l ? String(parsed.size_l) + 'L' : null]
      .find((candidate): candidate is string => typeof candidate === 'string') ?? '';
  } catch {
    return trimmed;
  }
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
