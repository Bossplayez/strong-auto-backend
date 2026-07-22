import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CalculatorPreviewBreakdown,
  CalculatorPreviewInput,
  CalculatorPreviewResult,
} from './calculator-preview.types';

const LEGACY_BROKER_USD = 200;
const LEGACY_FORWARDING_USD = 450;
const LEGACY_DEALER_PRICE_USD = 500;
const ENGINE_TIMEOUT_MS = 8_000;

type EngineResult = Record<string, unknown>;

/**
 * Adapter for the calculation engine already used by the legacy Strong Auto
 * calculator. It deliberately has no Prisma dependency: previews are not
 * saved, do not consume RapidAPI quota, and never expose engine credentials.
 */
@Injectable()
export class CalculatorEngineService {
  private readonly logger = new Logger(CalculatorEngineService.name);

  constructor(private readonly config: ConfigService) {}

  async preview(
    input: CalculatorPreviewInput,
    basis: 'buyNow' | 'currentBid',
  ): Promise<CalculatorPreviewResult> {
    const endpoint = this.config.get<string>('CALCULATOR_ENGINE_URL');
    const uid = this.config.get<string>('CALCULATOR_ENGINE_UID');
    if (!endpoint || !uid) {
      return { status: 'unavailable', reason: 'ENGINE_NOT_CONFIGURED' };
    }

    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:') {
        this.logger.warn('Calculator engine endpoint is not HTTPS.');
        return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
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
            forwarding: String(LEGACY_FORWARDING_USD),
            dealer_price: String(LEGACY_DEALER_PRICE_USD),
            repair_price: '0',
          }).toString(),
          signal: controller.signal,
        });
        if (!response.ok) {
          this.logger.warn('Calculator engine request failed with HTTP ' + response.status + '.');
          return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };
        }

        const payload: unknown = await response.json();
        const result = extractResult(payload);
        const breakdown = result ? toBreakdown(result) : null;
        if (!breakdown) {
          this.logger.warn('Calculator engine returned an unusable calculation.');
          return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };
        }

        return {
          status: 'available',
          basis,
          priceUsd: input.priceUsd,
          breakdown,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      this.logger.warn('Calculator engine request was unavailable.');
      return { status: 'unavailable', reason: 'ENGINE_UNAVAILABLE' };
    }
  }
}

function extractResult(payload: unknown): EngineResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { success?: unknown; result?: unknown };
  if (!record.success || !record.result || typeof record.result !== 'object') return null;
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
    portName: typeof result.port_name === 'string' && result.port_name.trim()
      ? result.port_name.trim()
      : null,
  };
}
