import { Injectable, Logger } from '@nestjs/common';
import type {
  CalculatorPreviewBreakdown,
  CalculatorPreviewInput,
  CalculatorPreviewResult,
} from './calculator-preview.types';

const LEGACY_BROKER_USD = 200;
const LEGACY_FORWARDING_USD = 450;
const LEGACY_DEALER_PRICE_USD = 500;
const ENGINE_TIMEOUT_MS = 8_000;
const DEALER_CALCULATOR_ORIGIN = 'https://dealer.vin-check.com.ua';
const DEALER_UID_CACHE_MS = 15 * 60 * 1_000;

type EngineResult = Record<string, unknown>;

/**
 * Adapter for the calculation engine already used by the legacy Strong Auto
 * calculator. It deliberately has no Prisma dependency: previews are not
 * saved, do not consume RapidAPI quota, and never expose engine credentials.
 */
@Injectable()
export class CalculatorEngineService {
  private readonly logger = new Logger(CalculatorEngineService.name);
  private cachedDealerUid: { value: string; expiresAt: number } | null = null;

  async preview(
    input: CalculatorPreviewInput,
    basis: 'buyNow' | 'currentBid',
  ): Promise<CalculatorPreviewResult> {
    const profileId = process.env.DEALER_CALCULATOR_PROFILE_ID?.trim();
    if (!profileId) {
      return { status: 'unavailable', reason: 'ENGINE_NOT_CONFIGURED' };
    }

    try {
      const uid = await this.getDealerUid(profileId);
      if (!uid) return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };

      const response = await this.fetchWithTimeout(
        new URL('/ajax-public?action=calc_new', DEALER_CALCULATOR_ORIGIN),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: new URLSearchParams({
            uid,
            auction: input.provider === 'copart' ? '1' : '2',
            fuel_type: String(input.fuelType),
            car_type: String(input.bodyType),
            platform: input.platformId,
            car_year: String(input.year),
            lot_price: String(input.priceUsd),
            engine_volume: String(input.engineVolumeCc),
            broker: String(LEGACY_BROKER_USD),
            insunance: '1',
            forwarding: String(LEGACY_FORWARDING_USD),
            dealer_price: String(LEGACY_DEALER_PRICE_USD),
            repair_price: '0',
          }).toString(),
        },
      );
      if (!response.ok) {
        this.logger.warn(
          'Dealer calculator request failed with HTTP ' + response.status + '.',
        );
        return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };
      }

      const payload: unknown = await response.json();
      const result = extractResult(payload);
      const breakdown = result ? toBreakdown(result) : null;
      if (!breakdown) {
        this.logger.warn('Dealer calculator returned an unusable calculation.');
        return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };
      }

      return {
        status: 'available',
        basis,
        priceUsd: input.priceUsd,
        breakdown,
      };
    } catch {
      this.logger.warn('Dealer calculator request was unavailable.');
      return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };
    }
  }

  private async getDealerUid(profileId: string): Promise<string | null> {
    if (this.cachedDealerUid && this.cachedDealerUid.expiresAt > Date.now()) {
      return this.cachedDealerUid.value;
    }

    const url = new URL('/dealer-calc', DEALER_CALCULATOR_ORIGIN);
    url.searchParams.set('calc_id', profileId);
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      this.logger.warn(
        'Dealer calculator profile request failed with HTTP ' +
          response.status +
          '.',
      );
      return null;
    }

    const uid = extractDealerUid(await response.text());
    if (!uid) {
      this.logger.warn(
        'Dealer calculator profile did not contain a calculation session.',
      );
      return null;
    }

    this.cachedDealerUid = {
      value: uid,
      expiresAt: Date.now() + DEALER_UID_CACHE_MS,
    };
    return uid;
  }

  private async fetchWithTimeout(
    url: URL,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractDealerUid(html: string): string | null {
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
  for (const input of inputs) {
    const name = input.match(/\bname\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (name?.toLowerCase() !== 'uid') continue;
    const value =
      input.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1] ??
      input.match(/\bvalue\s*=\s*([^\s>]+)/i)?.[1];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function extractResult(payload: unknown): EngineResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { success?: unknown; result?: unknown };
  if (!record.success || !record.result || typeof record.result !== 'object')
    return null;
  return record.result as EngineResult;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[^0-9,.\-]/g, '').replace(/,/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableNumber(result: EngineResult, key: string): number | null {
  return toNumber(result[key]);
}

function toBreakdown(result: EngineResult): CalculatorPreviewBreakdown | null {
  const lotPriceUsd = nullableNumber(result, 'lot_price');
  const totalUsd = nullableNumber(result, 'total_price');
  if (lotPriceUsd === null || totalUsd === null || totalUsd <= 0) return null;

  return {
    lotPriceUsd,
    auctionFeeUsd: nullableNumber(result, 'auction_fee'),
    usaDeliveryUsd: nullableNumber(result, 'usa_delivery'),
    seaDeliveryUsd: nullableNumber(result, 'sea_delivery'),
    customsClearanceUsd: nullableNumber(result, 'customs_clearance_total'),
    insuranceUsd: nullableNumber(result, 'insurance'),
    bankCommissionUsd: nullableNumber(result, 'bank_commission'),
    dealerPriceUsd: nullableNumber(result, 'dealer_price'),
    forwardingUsd: nullableNumber(result, 'forwarding'),
    brokerUsd: nullableNumber(result, 'broker'),
    uaDeliveryUsd: nullableNumber(result, 'ua_delivery'),
    totalUsd,
    portName:
      typeof result.port_name === 'string' && result.port_name.trim()
        ? result.port_name.trim()
        : null,
  };
}
