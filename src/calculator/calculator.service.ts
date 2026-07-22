import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CalculateEstimateDto,
  CalculatorBreakdownDto,
  BreakdownLineDto,
  CalculatorPreviewDto,
} from './dto';
import { CalculatorEngineService } from './calculator-engine.service';
import type { CalculatorPreviewResult } from './calculator-preview.types';

@Injectable()
export class CalculatorService {
  private readonly logger = new Logger(CalculatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculatorEngine: CalculatorEngineService,
  ) {}

  /**
   * Non-persistent preview used by the legacy-calculator-compatible page and
   * auction lot cards. The existing saved estimate flow is intentionally
   * unchanged.
   */
  async preview(
    dto: CalculatorPreviewDto,
    basis: 'buyNow' | 'currentBid' = 'currentBid',
  ): Promise<CalculatorPreviewResult> {
    if (dto.fuelType !== 4 && dto.engineVolumeCc <= 0) {
      return { status: 'unavailable', reason: 'VEHICLE_DATA_UNAVAILABLE' };
    }
    return this.calculatorEngine.preview(dto, basis);
  }

  async calculateEstimate(
    dto: CalculateEstimateDto,
    userId?: string,
  ): Promise<CalculatorBreakdownDto> {
    const currentYear = new Date().getFullYear();
    const vehicleAge = currentYear - dto.year;

    // ── 1. Auction fee ──
    const auctionFee = await this.calculateAuctionFee(
      dto.priceAmount,
      'copart',
    );

    // ── 2. Logistics ──
    const logistics = await this.calculateLogistics(
      dto.sourceCountry ?? 'US',
      dto.sourceState,
      dto.destinationCity,
    );

    // ── 3. Customs duty + excise + VAT ──
    const customs = this.calculateCustoms(
      dto.priceAmount,
      dto.engineVolume,
      dto.fuelType,
      vehicleAge,
    );

    // ── 4. Insurance ──
    const insurance = await this.calculateInsurance(dto.priceAmount);

    // ── 5. Service fees ──
    const serviceFees = await this.calculateServiceFees();

    // ── 6. Exchange rate ──
    const exchangeRate = await this.getExchangeRate('USD', 'UAH');

    // ── Build total ──
    const totalUsd =
      dto.priceAmount +
      auctionFee +
      logistics +
      insurance +
      serviceFees;
    const customsUah = customs.duty + customs.excise + customs.vat;
    const totalAmount = Math.round(totalUsd * exchangeRate + customsUah);

    // ── Build breakdown lines ──
    const breakdown: BreakdownLineDto[] = [
      { label: 'Vehicle Price', amount: dto.priceAmount, currency: 'USD' },
      { label: 'Auction Fee', amount: auctionFee, currency: 'USD' },
      { label: 'Logistics (inland + ocean)', amount: logistics, currency: 'USD' },
      { label: 'Customs Duty', amount: customs.duty, currency: 'UAH' },
      { label: 'Excise Tax', amount: customs.excise, currency: 'UAH' },
      { label: 'VAT (20%)', amount: customs.vat, currency: 'UAH' },
      { label: 'Insurance', amount: insurance, currency: 'USD' },
      { label: 'Service Fee', amount: serviceFees, currency: 'USD' },
    ];

    // ── Persist estimate ──
    const estimate = await this.prisma.calculatorEstimate.create({
      data: {
        userId: userId ?? null,
        vehicleId: dto.vehicleId ?? null,
        inputJsonb: dto as any,
        outputJsonb: { breakdown, exchangeRate } as any,
        totalAmount,
        totalCurrency: 'UAH',
      },
    });

    return {
      estimateId: estimate.id,
      auctionFee,
      logistics,
      customs: customs.duty + customs.excise + customs.vat,
      insurance,
      serviceFees,
      exchangeRate,
      totalAmount,
      totalCurrency: 'UAH',
      breakdown,
    };
  }

  // ── Auction fee lookup ──
  private async calculateAuctionFee(
    price: number,
    provider: string,
  ): Promise<number> {
    const rule = await this.prisma.auctionFeeRule.findFirst({
      where: {
        provider,
        isActive: true,
        priceFrom: { lte: price },
        priceTo: { gte: price },
      },
    });

    if (rule) {
      if (rule.fixedFee) return Number(rule.fixedFee);
      if (rule.percentFee) return Math.round(price * Number(rule.percentFee) / 100);
    }

    // Fallback: typical Copart buyer fee schedule
    if (price <= 99) return 25;
    if (price <= 499) return 70;
    if (price <= 999) return 135;
    if (price <= 1499) return 200;
    if (price <= 1999) return 260;
    if (price <= 3999) return 375;
    if (price <= 5999) return 475;
    if (price <= 7999) return 600;
    return Math.round(price * 0.08); // ~8% for higher values
  }

  // ── Logistics cost ──
  private async calculateLogistics(
    sourceCountry: string,
    sourceState?: string,
    destinationCity?: string,
  ): Promise<number> {
    const route = await this.prisma.logisticsRoute.findFirst({
      where: {
        sourceCountry,
        isActive: true,
        ...(sourceState && { sourceState }),
        ...(destinationCity && { destinationCity }),
      },
    });

    if (route) {
      return Number(route.inlandFee ?? 0) + Number(route.oceanFee ?? 0);
    }

    // Fallback: average US→Ukraine
    return 1200; // $400 inland + $800 ocean approx
  }

  // ── Customs calculation (Ukraine rules) ──
  private calculateCustoms(
    priceUsd: number,
    engineVolume: number,
    fuelType: string,
    vehicleAge: number,
  ): { duty: number; excise: number; vat: number } {
    // Import duty: 10% of customs value in UAH
    const exchangeRateEstimate = 41.5; // fallback
    const customsValueUah = priceUsd * exchangeRateEstimate;
    const duty = Math.round(customsValueUah * 0.1);

    // Excise tax: based on engine volume and fuel type
    // For gasoline: €50 per 1000 cm³ × coefficient for age
    // For diesel: €75 per 1000 cm³ × coefficient for age
    const eurToUah = 45; // approximate
    const volumeCc = engineVolume * 1000;
    const isElectric = fuelType.toLowerCase().includes('electric');
    const isDiesel = fuelType.toLowerCase().includes('diesel');

    let excise = 0;
    if (isElectric) {
      excise = 100; // minimal excise for EVs in Ukraine
    } else {
      const ratePerCc = isDiesel ? 0.075 : 0.05; // EUR per cm³
      const ageCoeff = vehicleAge <= 1 ? 1 : Math.min(vehicleAge, 15);
      excise = Math.round(volumeCc * ratePerCc * ageCoeff * eurToUah);
    }

    // VAT: 20% of (customs value + duty + excise)
    const vat = Math.round((customsValueUah + duty + excise) * 0.2);

    return { duty, excise, vat };
  }

  // ── Insurance ──
  private async calculateInsurance(priceAmount: number): Promise<number> {
    const rule = await this.prisma.insuranceRule.findFirst({
      where: {
        isActive: true,
        amountFrom: { lte: priceAmount },
        amountTo: { gte: priceAmount },
      },
    });

    if (rule) {
      if (rule.fixedFee) return Number(rule.fixedFee);
      if (rule.percentFee) {
        const fee = priceAmount * Number(rule.percentFee) / 100;
        const min = rule.minFee ? Number(rule.minFee) : 0;
        const max = rule.maxFee ? Number(rule.maxFee) : Infinity;
        return Math.round(Math.min(Math.max(fee, min), max));
      }
    }

    // Fallback: ~2% of price, min $150
    return Math.max(Math.round(priceAmount * 0.02), 150);
  }

  // ── Service fees ──
  private async calculateServiceFees(): Promise<number> {
    const rules = await this.prisma.serviceFeeRule.findMany({
      where: { isActive: true },
    });

    if (rules.length > 0) {
      return rules.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    }

    // Fallback: flat company fee
    return 500;
  }

  // ── Exchange rate ──
  private async getExchangeRate(
    base: string,
    quote: string,
  ): Promise<number> {
    const rate = await this.prisma.exchangeRate.findFirst({
      where: { baseCurrency: base, quoteCurrency: quote },
      orderBy: { validAt: 'desc' },
    });

    if (rate) return Number(rate.rate);

    // Fallback
    return 41.5;
  }
}
