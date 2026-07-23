import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscoveredLot, Vehicle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  auctionItem, CONTRACT_VERSION, filterItems, page,
  parseInventoryQuery, PROVIDERS, sortItems, validationError,
} from './inventory-projection';
import { evaluateCatalogQuality } from './catalog-quality';
import {
  deriveAuctionLifecycle,
  evaluateAuctionTruth,
  freshAuctionPriceWhere,
  hasFreshAuctionPrice,
  publicCatalogWhere,
  publicLifecycleWhere,
} from './public-eligibility';
import {
  computeProjectionV2, deriveCatalogScheduleState,
  type CatalogScheduleState, type ListingFreshnessV2, type PriceFreshnessV2,
} from './projection-v2';
import { resolveListingObservedAt } from './observation-resolver';
import { buildLotCalculatorInput } from './calculator-lot-input';
import { CalculatorService } from '../calculator/calculator.service';
import { AuctionAssistanceIntent, CreateAuctionAssistanceRequestDto } from './dto/create-auction-assistance-request.dto';

/** Task 054: Parse runCondition from stored JSON/string into clean label */
function normalizeRunCondition(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Try parsing JSON (legacy stored values)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.label) return String(parsed.label);
      if (parsed.value) return String(parsed.value);
      return null;
    } catch {
      // Not valid JSON — fall through to return as-is
    }
  }
  return trimmed;
}

@Injectable()
export class AuctionLotsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly calculatorService?: CalculatorService,
  ) {}

  async createAssistanceRequest(
    provider: string,
    externalLotId: string,
    userId: string,
    dto: CreateAuctionAssistanceRequestDto,
  ) {
    const { provider: validProvider, externalLotId: validLotId } = validIdentity(provider, externalLotId);
    const now = new Date();
    const lockKey = `auction-assistance:${userId}:${validProvider}:${validLotId}:${dto.intent}`;

    return this.prisma.$transaction(async (tx) => {
      // The lock scopes duplicate prevention to one customer, lot and action.
      // Re-checking after the lock keeps the price and visibility decision truthful.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const lot = await tx.discoveredLot.findUnique({
        where: { provider_externalLotId: { provider: validProvider, externalLotId: validLotId } },
      });
      if (!lot) throw new NotFoundException({ code: 'AUCTION_LOT_NOT_FOUND', message: 'Auction lot was not found.' });

      const truth = evaluateAuctionTruth(lot, now);
      if (!truth.publicVisible) {
        throw new ConflictException({ code: 'LOT_NOT_AVAILABLE', message: 'Auction lot is not available for a request.' });
      }
      if (!hasFreshAuctionPrice(lot, now)) {
        throw new ConflictException({ code: 'PRICE_NOT_FRESH', message: 'Auction price needs updating.' });
      }

      const isBuyNow = dto.intent === AuctionAssistanceIntent.BUY_NOW_ASSISTANCE;
      if (!isBuyNow && lot.isBuyNow) {
        throw new ConflictException({ code: 'ACTION_NOT_AVAILABLE', message: 'Use the Buy Now action for this auction lot.' });
      }
      const price = isBuyNow ? Number(lot.buyNowUsd) : Number(lot.currentBidUsd);
      if (!Number.isFinite(price) || price <= 0 || (isBuyNow && !lot.isBuyNow)) {
        throw new ConflictException({ code: 'PRICE_NOT_AVAILABLE', message: 'Requested auction action is not available.' });
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) throw new ForbiddenException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' });

      const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
      const existing = await tx.lead.findFirst({
        where: {
          customerUserId: userId,
          discoveredLotId: lot.id,
          leadType: dto.intent,
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { outcome: 'existing' as const, lead: assistanceLeadSummary(existing, lot) };

      const created = await tx.lead.create({
        data: {
          leadType: dto.intent,
          status: 'NEW',
          assistanceStatus: 'NEW',
          customerUserId: userId,
          discoveredLotId: lot.id,
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          email: user.email,
          comment: dto.comment?.trim() || null,
          auctionPriceUsd: price,
          auctionPriceBasis: isBuyNow ? 'BUY_NOW' : 'CURRENT_BID',
          auctionPriceObservedAt: lot.priceObservedAt ?? lot.lastProviderUpdateAt ?? now,
          sourceChannel: 'auction_lot_detail',
        },
      });
      return { outcome: 'created' as const, lead: assistanceLeadSummary(created, lot) };
    });
  }

  async listMyAssistanceRequests(userId: string, page = 1, pageSize = 20) {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safePageSize = Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 50 ? pageSize : 20;
    const where: Prisma.LeadWhereInput = {
      customerUserId: userId,
      assistanceStatus: { not: null },
      leadType: { in: ['BID_ASSISTANCE', 'BUY_NOW_ASSISTANCE'] as any },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        include: { discoveredLot: true },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return {
      items: items.map((lead) => assistanceLeadSummary(lead, lead.discoveredLot!)),
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safePageSize),
    };
  }

  async findAll(raw: Record<string, unknown>) {
    const query = parseInventoryQuery(raw, 'usa');
    const now = new Date();

    // Use Prisma-side filtering for performance (no unbounded findMany)
    const where = publicCatalogWhere(undefined, now);
    if (query.provider) where.provider = query.provider;
    if (query.make) where.make = { equals: query.make, mode: 'insensitive' };
    if (query.model) where.model = { contains: query.model, mode: 'insensitive' };
    if (query.bodyType) where.bodyStyle = { equals: query.bodyType, mode: 'insensitive' };
    if (query.fuelType) where.fuelType = { equals: query.fuelType, mode: 'insensitive' };
    if (query.transmission) where.transmission = { equals: query.transmission, mode: 'insensitive' };
    if (query.driveType) where.driveType = { equals: query.driveType, mode: 'insensitive' };
    if (query.locationState) where.locationState = { equals: query.locationState, mode: 'insensitive' };
    const lifecycleWhere = publicLifecycleWhere(query.lifecycle);
    if (lifecycleWhere) (where.AND as Prisma.DiscoveredLotWhereInput[]).push(lifecycleWhere);
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { make: { contains: query.q, mode: 'insensitive' } },
        { model: { contains: query.q, mode: 'insensitive' } },
        { externalLotId: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.yearFrom ?? query.yearTo) {
      where.year = { ...(where.year as object), ...(query.yearFrom && { gte: query.yearFrom }), ...(query.yearTo && { lte: query.yearTo }) };
    }
    if (query.priceFrom ?? query.priceTo) {
      (where.AND as Prisma.DiscoveredLotWhereInput[]).push(freshAuctionPriceWhere(now), {
        OR: [
          { buyNowUsd: { ...(query.priceFrom !== undefined ? { gte: query.priceFrom } : {}), ...(query.priceTo !== undefined ? { lte: query.priceTo } : {}) } },
          { currentBidUsd: { ...(query.priceFrom !== undefined ? { gte: query.priceFrom } : {}), ...(query.priceTo !== undefined ? { lte: query.priceTo } : {}) } },
        ],
      });
    }
    if (query.buyNow !== undefined) {
      where.isBuyNow = query.buyNow;
      (where.AND as Prisma.DiscoveredLotWhereInput[]).push(freshAuctionPriceWhere(now));
    }

    const orderBy: Prisma.DiscoveredLotOrderByWithRelationInput =
      query.sort.startsWith('year') ? { year: query.sort.endsWith('_desc') ? 'desc' : 'asc' } :
      query.sort.startsWith('price') ? { currentBidUsd: query.sort.endsWith('_desc') ? 'desc' : 'asc' } :
      query.sort.startsWith('mileage') ? { odometerKm: query.sort.endsWith('_desc') ? 'desc' : 'asc' } :
      query.sort.startsWith('auction') ? { auctionTime: query.sort.endsWith('_desc') ? 'desc' : 'asc' } :
      { firstSeenAt: 'desc' };

    const skip = (query.page - 1) * query.pageSize;

    const [lots, total] = await this.prisma.$transaction([
      this.prisma.discoveredLot.findMany({
        where, orderBy, skip, take: query.pageSize,
        select: {
          id: true, provider: true, externalLotId: true, title: true, make: true, model: true, year: true,
          bodyStyle: true, fuelType: true, transmission: true, driveType: true,
          locationState: true, locationDisplay: true,
          odometerKm: true, odometerMi: true,
          buyNowUsd: true, currentBidUsd: true, isBuyNow: true,
          providerResultState: true, listingObservedAt: true, priceObservedAt: true, lastProviderUpdateAt: true,
          availabilityConfirmed: true, consecutiveMisses: true, state: true, lastSeenAt: true, auctionState: true,
          mediaUrls: true, auctionTime: true, auctionTimezoneOffset: true,
          lifecycleState: true, freshnessState: true, vehicleId: true, firstSeenAt: true,
        },
      }),
      this.prisma.discoveredLot.count({ where }),
    ]);

    const items = lots.map((lot) => this.publicAuctionItem(lot, now));
    return page(items, total, query.page, query.pageSize);
  }

  async findOne(provider: string, externalLotId: string) {
    const identity = externalLotId.trim();
    if (!PROVIDERS.includes(provider as 'copart' | 'iaai') || identity.length < 1 || identity.length > 128) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Auction lot identity is invalid.' });
    }
    const lot = await this.prisma.discoveredLot.findUnique({
      where: { provider_externalLotId: { provider, externalLotId: identity } },
    });
    if (!lot) {
      throw new NotFoundException({ code: 'AUCTION_LOT_NOT_FOUND', message: 'Auction lot was not found.' });
    }

    const now = new Date();
    const truth = evaluateAuctionTruth(lot, now);

    // Quality evaluation for public visibility
    const quality = evaluateCatalogQuality(lot);
    const historicalExactLookup = truth.reasonCode === 'TERMINAL_RESULT' || truth.reasonCode === 'RESULT_PENDING';
    if (!quality.include && !historicalExactLookup) {
      throw new NotFoundException({
        code: 'AUCTION_LOT_NOT_AVAILABLE',
        message: 'Цей лот недоступний у публічному каталозі.',
      });
    }

    // Task 054: Use shared observation resolver for canonical timestamp.
    // Fallback: listingObservedAt → lastProviderUpdateAt → availabilityConfirmedAt.
    const resolvedObs = resolveListingObservedAt({
      listingObservedAt: (lot as any).listingObservedAt ?? null,
      priceObservedAt: (lot as any).priceObservedAt ?? null,
      lastProviderUpdateAt: lot.lastProviderUpdateAt,
      availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt : null,
      currentBidUsd: lot.currentBidUsd,
      buyNowUsd: lot.buyNowUsd,
    });
    const observationTime = resolvedObs;
    const hoursUntilAuction = lot.auctionTime
      ? (lot.auctionTime.getTime() - now.getTime()) / (60 * 60 * 1000)
      : Infinity;
    const tier = hoursUntilAuction <= 12 ? 'HOT' : hoursUntilAuction <= 48 ? 'WARM' : 'COLD';
    const projection = computeProjectionV2({
      auctionTime: lot.auctionTime,
      providerResultState: lot.providerResultState,
      listingObservedAt: lot.listingObservedAt,
      priceObservedAt: lot.priceObservedAt,
      lastProviderUpdateAt: lot.lastProviderUpdateAt,
      availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt : null,
      currentBidUsd: lot.currentBidUsd,
      buyNowUsd: lot.buyNowUsd,
    }, now);
    const isPriceStale = projection.priceFreshness === 'MISSING_OR_STALE';
    const showPriceAndCta = truth.publicVisible && !isPriceStale;

    // For past-auction lots: show "Аукціон завершився, результат уточнюється"
    // Do not show active prices, countdown, or Buy Now for ended lots
    // Task 050B: Also hide active data when provider observation is stale
    const isActive = truth.publicVisible;
    const item = auctionItem(lot);

    return {
      ...item,
      lifecycle: deriveAuctionLifecycle(lot, now),
      freshness: truth.publicVisible ? 'FRESH' : item.freshness,
      price: showPriceAndCta ? item.price : {
        currency: 'USD' as const,
        primaryUsd: null,
        basis: null,
        currentBidUsd: null,
        buyNowUsd: null,
        buyNowAvailable: false,
      },
      mediaUrls: lot.mediaUrls,
      odometerMi: lot.odometerMi,
      // Vehicle characteristics
      engine: lot.engine ?? null,
      exteriorColor: lot.exteriorColor ?? null,
      airbags: lot.airbags ?? null,
      restraintSystem: lot.restraintSystem ?? null,
      // Condition
      primaryDamage: lot.primaryDamage ?? null,
      secondaryDamage: lot.secondaryDamage ?? null,
      loss: lot.loss ?? null,
      runCondition: normalizeRunCondition(lot.runCondition ?? null),
      hasKey: lot.hasKey,
      // Sale document
      saleDocumentName: lot.saleDocumentName ?? null,
      saleDocumentType: lot.saleDocumentType ?? null,
      // Media capabilities
      has360: lot.has360,
      hasVideo: lot.hasVideo,
      // Location detail (no seller PII, no facility internal IDs)
      locationCity: lot.locationDisplay ?? null,
      // Auction formatting
      auctionFormatted: lot.auctionFormatted ?? null,
      // Provider raw state (for debugging, not seller data)
      rawProviderState: lot.auctionState,
      rawProviderStatus: lot.state,
      availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt.toISOString() : null,
      // Task 050: Expose the meaningful provider-observed timestamp.
      providerObservedAt: observationTime?.toISOString() ?? null,
      // Task 050B: Expose computed staleness flag for UI
      isStale: truth.reasonCode === 'LISTING_STALE',
      isPriceStale,
      // Task 050B: Tier used for staleness computation
      freshnessTier: tier,
      lastSoldPriceUsd: lot.lastSoldPriceUsd ? Number(lot.lastSoldPriceUsd) : null,
      terminalAt: lot.terminalAt ? lot.terminalAt.toISOString() : null,
      vin: lot.vin ?? null,
      // Quality outcome
      qualityInclude: quality.include,
      qualityReasonCode: quality.reasonCode,
      contractVersion: CONTRACT_VERSION, asOf: new Date().toISOString(),
      // Task 050: result-pending state for past auction without confirmed provider result
      resultPending: truth.reasonCode === 'RESULT_PENDING',
      terminal: truth.reasonCode === 'TERMINAL_RESULT',
      // Task 050: whether this lot is still actively auctioning
      isActive,
      // Task 050: external auction URL for the lot
      externalAuctionUrl: buildExternalAuctionUrl(lot.provider, lot.externalLotId),
    };
  }

  async getCalculatorPreview(provider: string, externalLotId: string) {
    const { provider: validProvider, externalLotId: validLotId } = validIdentity(provider, externalLotId);
    const lot = await this.prisma.discoveredLot.findUnique({
      where: { provider_externalLotId: { provider: validProvider, externalLotId: validLotId } },
    });
    if (!lot) {
      throw new NotFoundException({ code: 'AUCTION_LOT_NOT_FOUND', message: 'Auction lot was not found.' });
    }

    const input = buildLotCalculatorInput(lot, new Date());
    if (input.status === 'unavailable') return input;
    if (!this.calculatorService) {
      return { status: 'unavailable' as const, reason: 'ENGINE_UNAVAILABLE' as const };
    }
    return this.calculatorService.preview(input.input, input.basis);
  }

  async searchByVinOrLot(query: string) {
    const q = query.trim();
    if (!q || q.length > 128) return { contractVersion: CONTRACT_VERSION, items: [] as any[], total: 0, asOf: new Date().toISOString() };

    const now = new Date();
    const lots = await this.prisma.discoveredLot.findMany({
      where: {
        OR: [
          { externalLotId: { equals: q, mode: 'insensitive' } },
          { vin: { equals: q, mode: 'insensitive' } },
          { slugVin: { equals: q, mode: 'insensitive' } },
          { externalLotId: { contains: q, mode: 'insensitive' } },
          { vin: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 20,
    });

    // Task 050: Mark whether each lot is still active or has ended.
    // Do NOT hide ended lots from search (users may search for historical data),
    // but include the lifecycle so the UI can render appropriately.
    const items = lots.flatMap(lot => {
      const projected = this.publicAuctionItem(lot, now);
      const truth = evaluateAuctionTruth(lot, now);
      const historicalExactLookup = truth.reasonCode === 'TERMINAL_RESULT' || truth.reasonCode === 'RESULT_PENDING';
      if (!historicalExactLookup && (!truth.publicVisible || !evaluateCatalogQuality(lot).include)) return [];
      return [{
        ...projected,
        lifecycle: deriveAuctionLifecycle(lot, now),
        resultPending: truth.reasonCode === 'RESULT_PENDING',
        terminal: truth.reasonCode === 'TERMINAL_RESULT',
        isActive: truth.publicVisible,
      }];
    });
    return { contractVersion: CONTRACT_VERSION, items, total: items.length, asOf: new Date().toISOString() };
  }

  async getStats() {
    const now = new Date();
    const lots = await this.prisma.discoveredLot.findMany({ where: publicCatalogWhere(undefined, now) });
    const partition = (provider?: string) => {
      const selected = provider ? lots.filter((lot) => lot.provider === provider) : lots;
      return {
        current: selected.length,
        live: selected.filter((lot) => deriveAuctionLifecycle(lot, now) === 'LIVE').length,
        buyNow: selected.filter((lot) => lot.isBuyNow && Number(lot.buyNowUsd) > 0 && hasFreshAuctionPrice(lot, now)).length,
        upcoming: selected.filter((lot) => deriveAuctionLifecycle(lot, now) === 'UPCOMING').length,
      };
    };
    return {
      contractVersion: CONTRACT_VERSION, ...partition(),
      byProvider: { copart: partition('copart'), iaai: partition('iaai') },
      asOf: new Date().toISOString(),
    };
  }

  /**
   * Public list projection: listing visibility and price truth are separate.
   * A listing can remain browseable while its auction price is safely redacted.
   */
  private publicAuctionItem(lot: {
    auctionTime: Date | null;
    providerResultState: string;
    listingObservedAt?: Date | null;
    priceObservedAt?: Date | null;
    lastProviderUpdateAt?: Date | null;
    lastSeenAt?: Date | null;
    availabilityConfirmed?: boolean;
    consecutiveMisses?: number;
    state?: string;
    auctionState?: string | null;
    currentBidUsd: Prisma.Decimal | null;
    buyNowUsd: Prisma.Decimal | null;
    [key: string]: unknown;
  }, now: Date) {
    const item = auctionItem(lot as any);
    const truth = evaluateAuctionTruth({
      auctionTime: lot.auctionTime,
      providerResultState: lot.providerResultState,
      listingObservedAt: lot.listingObservedAt ?? null,
      lastProviderUpdateAt: lot.lastProviderUpdateAt ?? null,
      availabilityConfirmed: lot.availabilityConfirmed ?? true,
      lastSeenAt: lot.lastSeenAt ?? null,
      state: lot.state ?? 'DISCOVERED',
      consecutiveMisses: lot.consecutiveMisses ?? 0,
    }, now);
    const projection = computeProjectionV2({
      auctionTime: lot.auctionTime,
      providerResultState: lot.providerResultState,
      listingObservedAt: lot.listingObservedAt ?? null,
      priceObservedAt: lot.priceObservedAt ?? null,
      lastProviderUpdateAt: lot.lastProviderUpdateAt ?? null,
      availabilityConfirmedAt: lot.availabilityConfirmed && lot.lastSeenAt ? lot.lastSeenAt : null,
      currentBidUsd: lot.currentBidUsd,
      buyNowUsd: lot.buyNowUsd,
    }, now);
    const lifecycle = deriveAuctionLifecycle({
      auctionTime: lot.auctionTime,
      providerResultState: lot.providerResultState,
      listingObservedAt: lot.listingObservedAt ?? null,
      lastProviderUpdateAt: lot.lastProviderUpdateAt ?? null,
      availabilityConfirmed: lot.availabilityConfirmed ?? true,
      lastSeenAt: lot.lastSeenAt ?? null,
      state: lot.state ?? 'DISCOVERED',
      consecutiveMisses: lot.consecutiveMisses ?? 0,
      auctionState: lot.auctionState ?? null,
      lifecycleState: item.lifecycle,
    }, now);
    if (truth.publicVisible && projection.priceFreshness === 'FRESH') return { ...item, lifecycle, freshness: 'FRESH' as const };
    return {
      ...item,
      lifecycle,
      freshness: 'FRESH' as const,
      price: {
        currency: 'USD' as const,
        primaryUsd: null,
        basis: null,
        currentBidUsd: null,
        buyNowUsd: null,
        buyNowAvailable: false,
      },
    };
  }

  async listAdminLots(raw: Record<string, unknown>) {
    const query = parseAdminLotQuery(raw);
    const lots = await this.prisma.discoveredLot.findMany();
    const linked = await this.linkedVehicles(lots.map((lot) => lot.vehicleId).filter((id): id is string => Boolean(id)));
    const asOf = new Date();
    const items = lots.map((lot) => this.adminItem(lot, linked.get(lot.vehicleId ?? ''), asOf)).filter((item) => matchesAdminItem(item, query));
    const sorted = sortAdminItems(items, query.sort);
    const offset = (query.page - 1) * query.pageSize;
    return page(sorted.slice(offset, offset + query.pageSize), sorted.length, query.page, query.pageSize);
  }

  async adminLotDetail(provider: string, externalLotId: string) {
    const identity = validIdentity(provider, externalLotId);
    const lot = await this.prisma.discoveredLot.findUnique({ where: { provider_externalLotId: identity } });
    if (!lot) throw new NotFoundException({ code: 'ADMIN_AUCTION_LOT_NOT_FOUND', message: 'Auction lot was not found.' });
    const linked = await this.linkedVehicles(lot.vehicleId ? [lot.vehicleId] : []);
    const quality = evaluateCatalogQuality(lot);
    const asOf = new Date();
    return {
      contractVersion: CONTRACT_VERSION,
      item: {
        ...this.adminItem(lot, linked.get(lot.vehicleId ?? ''), asOf),
        vin: lot.vin ?? null, bodyType: lot.bodyStyle ?? null, fuelType: lot.fuelType ?? null,
        transmission: lot.transmission ?? null, driveType: lot.driveType ?? null,
        damagePrimary: lot.primaryDamage ?? null, damageSecondary: lot.secondaryDamage ?? null,
        loss: lot.loss ?? null, runCondition: lot.runCondition ?? null, hasKey: lot.hasKey,
        engine: lot.engine ?? null, exteriorColor: lot.exteriorColor ?? null,
        airbags: lot.airbags ?? null, restraintSystem: lot.restraintSystem ?? null,
        saleDocumentName: lot.saleDocumentName ?? null, saleDocumentType: lot.saleDocumentType ?? null,
        has360: lot.has360, hasVideo: lot.hasVideo,
        locationCountry: null,
        locationCity: lot.locationDisplay ?? null,
        facilityName: lot.facilityOfficeName ?? null,
        facilityZip: lot.facilityZip ?? null,
        odometerMi: lot.odometerMi ?? null, mediaUrls: lot.mediaUrls,
        rawProviderState: lot.auctionState ?? null, rawProviderStatus: lot.state,
        lastObservedCycleId: null,
        qualityInclude: quality.include,
        qualityReasonCode: quality.reasonCode,
        qualityReason: quality.reason,
      },
      asOf: asOf.toISOString(),
    };
  }

  async adminMetrics() {
    const asOf = new Date();
    const { lots, vehicles } = await this.prisma.$transaction(async (tx) => {
      const [lots, vehicles] = await Promise.all([
        tx.discoveredLot.findMany({
          select: {
            provider: true, vehicleId: true, providerResultState: true, auctionTime: true,
            listingObservedAt: true, lastProviderUpdateAt: true, availabilityConfirmed: true,
            lastSeenAt: true, state: true, consecutiveMisses: true, year: true, bodyStyle: true,
            locationState: true, locationDisplay: true,
            title: true, primaryDamage: true, secondaryDamage: true, loss: true,
            saleDocumentName: true, saleDocumentType: true, make: true, model: true,
            priceObservedAt: true, currentBidUsd: true, buyNowUsd: true,
            auctionTimestampEvidence: true,
          },
        }),
        tx.vehicle.findMany({ select: { id: true, publicationStatus: true } }),
      ]);
      return { lots, vehicles };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      const classify = (lot: (typeof lots)[number]) => {
        const truth = evaluateAuctionTruth(lot, asOf);
        const ended = ['SOLD', 'UNSOLD', 'REMOVED'].includes(lot.providerResultState);
        if (ended) return 'ended' as const;
        if (truth.publicVisible && evaluateCatalogQuality(lot).include) return 'current' as const;
        if (truth.reasonCode === 'LISTING_STALE' || truth.reasonCode === 'UNAVAILABLE') {
          return 'stale' as const;
        }
        return 'unclassified' as const;
      };
      const partition = (provider?: string) => {
        const selected = provider ? lots.filter((lot) => lot.provider === provider) : lots;
        const classes = selected.map(classify);
        return {
          totalExternal: selected.length,
          currentExternal: classes.filter((value) => value === 'current').length,
          staleExternal: classes.filter((value) => value === 'stale').length,
          endedExternal: classes.filter((value) => value === 'ended').length,
          unclassifiedExternal: classes.filter((value) => value === 'unclassified').length,
        };
      };
      const importedIds = new Set(lots.map((lot) => lot.vehicleId).filter((id): id is string => Boolean(id)));
      const imported = vehicles.filter((vehicle) => importedIds.has(vehicle.id));

      // Coverage diagnostics: how many active lots have state/city
      const activeLots = lots.filter((lot) => evaluateAuctionTruth(lot, asOf).publicVisible && evaluateCatalogQuality(lot).include);
      const coverage = (provider?: string) => {
        const selected = provider ? activeLots.filter((lot) => lot.provider === provider) : activeLots;
        return {
          withState: selected.filter((lot) => lot.locationState).length,
          withCity: selected.filter((lot) => lot.locationDisplay).length,
          total: selected.length,
        };
      };

    return {
      contractVersion: CONTRACT_VERSION,
      ...partition(),
      importedVehicles: imported.length,
      draftVehicles: imported.filter((vehicle) => vehicle.publicationStatus === 'DRAFT').length,
      publishedVehicles: imported.filter((vehicle) => vehicle.publicationStatus === 'PUBLISHED').length,
      otherImportedVehicles: imported.filter((vehicle) => !['DRAFT', 'PUBLISHED'].includes(vehicle.publicationStatus)).length,
      byProvider: { copart: partition('copart'), iaai: partition('iaai') },
      coverage: { copart: coverage('copart'), iaai: coverage('iaai'), all: coverage() },
      // Task 053: V2 data health metrics
      dataHealth: this.computeDataHealth(lots, asOf),
      asOf: asOf.toISOString(),
    };
  }

  /** Task 053: V2 data health metrics for admin diagnostics */
  private computeDataHealth(lots: Array<Pick<DiscoveredLot,
    'provider' | 'auctionTime' | 'providerResultState' | 'listingObservedAt' |
    'priceObservedAt' | 'lastProviderUpdateAt' | 'availabilityConfirmed' |
    'lastSeenAt' | 'buyNowUsd' | 'currentBidUsd' | 'auctionTimestampEvidence'
  >>, now: Date) {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const fortyEightHours = 48 * 60 * 60 * 1000;
    const byProvider = (provider?: string) => {
      const selected = provider ? lots.filter(l => l.provider === provider) : lots;
      const { schedule, isResultPending } = deriveCatalogScheduleState(
        selected[0]?.auctionTime ?? null, 'UNKNOWN' as any, now,
      );
      // Per-lot computation
      let confirmedHorizon = 0, unscheduled = 0, outOfHorizon = 0;
      let resultPending = 0, staleListing = 0, stalePrice = 0;
      let timestampEvidenceOffset = 0, timestampEvidenceTz = 0, timestampEvidenceNone = 0;
      for (const lot of selected) {
        const v2 = computeProjectionV2({
          auctionTime: lot.auctionTime,
          providerResultState: lot.providerResultState,
          listingObservedAt: lot.listingObservedAt,
          priceObservedAt: lot.priceObservedAt,
          lastProviderUpdateAt: lot.lastProviderUpdateAt,
          availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt : null,
          buyNowUsd: lot.buyNowUsd,
          currentBidUsd: lot.currentBidUsd,
        }, now);
        if (v2.catalogScheduleState === 'SCHEDULED_ACTIVE') confirmedHorizon++;
        else if (v2.catalogScheduleState === 'UNSCHEDULED') unscheduled++;
        else if (v2.catalogScheduleState === 'SCHEDULED_OUT_OF_HORIZON') outOfHorizon++;
        if (v2.isResultPending) resultPending++;
        if (v2.listingFreshness === 'STALE') staleListing++;
        if (v2.priceFreshness === 'MISSING_OR_STALE') stalePrice++;
        if (lot.auctionTimestampEvidence === 'UTC_OFFSET') timestampEvidenceOffset++;
        else if (lot.auctionTimestampEvidence === 'PROVIDER_TIMEZONE') timestampEvidenceTz++;
        else timestampEvidenceNone++;
      }
      return {
        total: selected.length,
        confirmedHorizon, unscheduled, outOfHorizon,
        resultPending, staleListing, stalePrice,
        timestampEvidence: { utcOffset: timestampEvidenceOffset, providerTz: timestampEvidenceTz, none: timestampEvidenceNone },
      };
    };
    return { copart: byProvider('copart'), iaai: byProvider('iaai'), all: byProvider() };
  }

  async importPersistedLot(raw: Record<string, unknown>) {
    const keys = Object.keys(raw);
    if (keys.some((key) => !['lotNumber', 'platform', 'confirm'].includes(key))) validationError();
    const lotNumber = typeof raw.lotNumber === 'string' ? raw.lotNumber.trim() : '';
    const platform = raw.platform;
    if (raw.confirm !== true) throw new BadRequestException({ code: 'IMPORT_CONFIRMATION_REQUIRED', message: 'confirm must be true.' });
    if (!lotNumber || lotNumber.length > 128 || !PROVIDERS.includes(platform as 'copart' | 'iaai')) validationError();
    const provider = platform as 'copart' | 'iaai';
    return this.prisma.$transaction(async (tx) => {
      const lot = await tx.discoveredLot.findUnique({ where: { provider_externalLotId: { provider, externalLotId: lotNumber } } });
      if (!lot) throw new NotFoundException({ code: 'ADMIN_AUCTION_LOT_NOT_FOUND', message: 'Auction lot was not found.' });

      const existingBinding = await tx.vehicleSourceBinding.findUnique({
        where: { provider_externalLotId: { provider, externalLotId: lotNumber } },
        include: { vehicle: true },
      });
      if (lot.vehicleId && existingBinding && existingBinding.vehicleId !== lot.vehicleId) {
        throw new ConflictException({ code: 'IMPORT_LINK_CONFLICT', message: 'Auction lot has a competing vehicle link.' });
      }
      if (existingBinding) {
        await tx.discoveredLot.update({ where: { id: lot.id }, data: { state: 'IMPORTED', vehicleId: existingBinding.vehicleId } });
        return this.importResponse('alreadyLinked', provider, lotNumber, existingBinding.vehicle);
      }
      if (lot.vehicleId) {
        const vehicle = await tx.vehicle.findUnique({ where: { id: lot.vehicleId } });
        if (!vehicle) throw new ConflictException({ code: 'IMPORT_LINK_CONFLICT', message: 'Auction lot link is inconsistent.' });
        await tx.vehicleSourceBinding.create({ data: {
          vehicleId: vehicle.id,
          provider,
          externalLotId: lotNumber,
          externalUrl: null,
          saleStatus: lot.auctionState ?? undefined,
          currentBidAmount: lot.currentBidUsd,
          buyNowAmount: lot.buyNowUsd,
          lastSyncedAt: new Date(),
        } });
        await tx.discoveredLot.update({ where: { id: lot.id }, data: { state: 'IMPORTED' } });
        return this.importResponse('alreadyLinked', provider, lotNumber, vehicle);
      }

      const slugBase = lot.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'auction-lot';
      const vehicle = await tx.vehicle.create({ data: {
        slug: `${slugBase}-${provider}-${lotNumber}`.slice(0, 120),
        sourceType: provider === 'copart' ? 'COPART' : 'IAAI',
        sourceRegion: 'USA',
        publicationStatus: 'DRAFT',
        availabilityStatus: 'AVAILABLE',
        title: lot.title,
        make: lot.make,
        model: lot.model,
        year: lot.year,
        priceAmount: lot.buyNowUsd ?? lot.currentBidUsd ?? 0,
        vin: lot.vin,
        odometerValue: lot.odometerKm,
        bodyType: lot.bodyStyle,
        fuelType: lot.fuelType,
        transmission: lot.transmission,
        driveType: lot.driveType,
        damagePrimary: lot.primaryDamage,
        locationCountry: null,
        locationState: lot.locationState,
        locationCity: lot.locationDisplay,
        specs: { create: {
          lotNumber,
          auctionDate: lot.auctionTime,
          currentBid: lot.currentBidUsd === null ? null : Math.round(Number(lot.currentBidUsd)),
          saleStatus: lot.auctionState,
        } },
        media: { create: lot.mediaUrls.map((sourceUrl, index) => ({
          sourceUrl,
          sortOrder: index,
          isPrimary: index === 0,
        })) },
        sourceBindings: { create: {
          provider,
          externalLotId: lotNumber,
          externalUrl: null,
          saleStatus: lot.auctionState ?? undefined,
          currentBidAmount: lot.currentBidUsd,
          buyNowAmount: lot.buyNowUsd,
          lastSyncedAt: new Date(),
        } },
      } });
      await tx.discoveredLot.update({ where: { id: lot.id }, data: { state: 'IMPORTED', vehicleId: vehicle.id } });
      return this.importResponse('created', provider, lotNumber, vehicle);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async linkedVehicles(ids: string[]) {
    if (!ids.length) return new Map<string, LinkedVehicle>();
    const vehicles = await this.prisma.vehicle.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, publicationStatus: true } });
    return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  }

  private adminItem(lot: DiscoveredLot, vehicle?: LinkedVehicle, now = new Date()) {
    const projected = auctionItem(lot);
    const truth = evaluateAuctionTruth(lot, now);
    // Task 053: Compute V2 projection for admin diagnostics
    const v2 = computeProjectionV2({
      auctionTime: lot.auctionTime,
      providerResultState: lot.providerResultState,
      listingObservedAt: lot.listingObservedAt,
      priceObservedAt: lot.priceObservedAt,
      lastProviderUpdateAt: lot.lastProviderUpdateAt,
      availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt : null,
      buyNowUsd: lot.buyNowUsd,
      currentBidUsd: lot.currentBidUsd,
    }, now);
    return {
      key: projected.key,
      provider: lot.provider,
      externalLotId: lot.externalLotId,
      state: lot.state,
      tier: lot.freshnessTier,
      lifecycle: deriveAuctionLifecycle(lot, now),
      freshness: truth.publicVisible ? 'FRESH' : projected.freshness,
      title: projected.title,
      make: projected.make,
      model: projected.model,
      year: projected.year,
      locationState: projected.locationState,
      auctionAt: projected.auctionAt,
      providerTimezoneOffset: projected.providerTimezoneOffset,
      odometerKm: projected.odometerKm,
      thumbnailUrl: projected.thumbnailUrl,
      mediaCount: projected.mediaCount,
      price: projected.price,
      // Task 053: Rename ambiguous import semantics
      importState: !vehicle ? 'unlinked' : vehicle.publicationStatus === 'DRAFT' ? 'linked_draft' : vehicle.publicationStatus === 'PUBLISHED' ? 'linked_published' : 'linked_other',
      linkedVehicle: vehicle ? { vehicleId: vehicle.id, slug: vehicle.slug, publicationStatus: vehicle.publicationStatus } : null,
      consecutiveMisses: lot.consecutiveMisses, firstDiscoveredAt: lot.firstSeenAt.toISOString(), lastObservedAt: lot.lastSeenAt?.toISOString() ?? null,
      availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt.toISOString() : null, updatedAt: lot.updatedAt.toISOString(),
      // Task 053: V2 diagnostics
      providerResultState: lot.providerResultState,
      catalogScheduleState: v2.catalogScheduleState,
      isResultPending: v2.isResultPending,
      isTerminal: v2.isTerminal,
      listingFreshnessV2: v2.listingFreshness,
      priceFreshnessV2: v2.priceFreshness,
      v2ReasonCode: v2.reasonCode.code,
      v2ReasonMessage: v2.reasonCode.message,
      auctionTimestampEvidence: lot.auctionTimestampEvidence,
      providerAuctionTimestampRaw: lot.providerAuctionTimestampRaw,
      listingObservedAt: lot.listingObservedAt?.toISOString() ?? null,
      priceObservedAt: lot.priceObservedAt?.toISOString() ?? null,
      publicVisible: truth.publicVisible,
      truthReasonCode: truth.reasonCode,
    };
  }

  private importResponse(result: 'created' | 'alreadyLinked', provider: 'copart' | 'iaai', externalLotId: string, vehicle: Pick<Vehicle, 'id' | 'slug' | 'publicationStatus'>) {
    return { contractVersion: CONTRACT_VERSION, result, provider, externalLotId,
      vehicle: { vehicleId: vehicle.id, slug: vehicle.slug, publicationStatus: vehicle.publicationStatus }, asOf: new Date().toISOString() };
  }
}

type LinkedVehicle = Pick<Vehicle, 'id' | 'slug' | 'publicationStatus'>;

function validIdentity(provider: string, externalLotId: string) {
  const identity = externalLotId.trim();
  if (!PROVIDERS.includes(provider as 'copart' | 'iaai') || !identity || identity.length > 128) validationError('Auction lot identity is invalid.');
  return { provider: provider as 'copart' | 'iaai', externalLotId: identity };
}

function assistanceLeadSummary(
  lead: {
    id: string;
    leadType: string;
    assistanceStatus: string | null;
    createdAt: Date;
    auctionPriceUsd: unknown;
    auctionPriceBasis: string | null;
  },
  lot: { provider: string; externalLotId: string; title: string },
) {
  return {
    id: lead.id,
    intent: lead.leadType,
    status: lead.assistanceStatus,
    createdAt: lead.createdAt.toISOString(),
    lot: {
      provider: lot.provider,
      externalLotId: lot.externalLotId,
      title: lot.title,
    },
    price: {
      usd: lead.auctionPriceUsd === null ? null : Number(lead.auctionPriceUsd),
      basis: lead.auctionPriceBasis,
    },
  };
}

function parseAdminLotQuery(raw: Record<string, unknown>) {
  const allowed = new Set(['page', 'pageSize', 'q', 'provider', 'state', 'tier', 'lifecycle', 'freshness', 'importState', 'buyNow', 'sort']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) validationError();
  const pageNumber = raw.page === undefined ? 1 : Number(raw.page);
  const pageSize = raw.pageSize === undefined ? 20 : Number(raw.pageSize);
  const q = raw.q === undefined ? undefined : String(raw.q).trim();
  const provider = raw.provider === undefined ? undefined : String(raw.provider);
  const state = raw.state === undefined ? undefined : String(raw.state);
  const tier = raw.tier === undefined ? undefined : String(raw.tier);
  const lifecycle = raw.lifecycle === undefined ? undefined : String(raw.lifecycle);
  const freshness = raw.freshness === undefined ? undefined : String(raw.freshness);
  const importState = raw.importState === undefined ? undefined : String(raw.importState);
  const sort = raw.sort === undefined ? 'lastObserved_desc' : String(raw.sort);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || (q !== undefined && (!q || q.length > 100)) ||
    (provider && !PROVIDERS.includes(provider as 'copart' | 'iaai')) || (state && !['DISCOVERED', 'IMPORTING', 'IMPORTED', 'SOLD', 'REMOVED', 'UNAVAILABLE'].includes(state)) ||
    (tier && !['HOT', 'WARM', 'COLD'].includes(tier)) || (lifecycle && !['UPCOMING', 'OPEN', 'LIVE', 'ENDED', 'SOLD', 'REMOVED', 'NOT_READY'].includes(lifecycle)) ||
    (freshness && !['FRESH', 'STALE', 'DEFERRED'].includes(freshness)) || (importState && !['notImported', 'unlinked', 'draft', 'linked_draft', 'published', 'linked_published', 'other', 'linked_other'].includes(importState)) ||
    !['lastObserved_desc', 'auction_asc', 'auction_desc', 'year_asc', 'year_desc', 'price_asc', 'price_desc', 'mileage_asc', 'mileage_desc'].includes(sort)) validationError();
  const buyNow = raw.buyNow === undefined ? undefined : raw.buyNow === 'true' ? true : raw.buyNow === 'false' ? false : undefined;
  if (raw.buyNow !== undefined && buyNow === undefined) validationError();
  return { page: pageNumber, pageSize, q, provider, state, tier, lifecycle, freshness, importState, buyNow, sort };
}

function matchesAdminItem(item: any, query: ReturnType<typeof parseAdminLotQuery>) {
  const q = query.q?.toLowerCase();
  return (!q || [item.title, item.make, item.model, item.externalLotId].some((value) => String(value ?? '').toLowerCase().includes(q))) &&
    (!query.provider || item.provider === query.provider) && (!query.state || item.state === query.state) && (!query.tier || item.tier === query.tier) &&
    (!query.lifecycle || item.lifecycle === query.lifecycle) && (!query.freshness || item.freshness === query.freshness) && (!query.importState || item.importState === query.importState) &&
    (query.buyNow === undefined || item.price.buyNowAvailable === query.buyNow);
}

function sortAdminItems(items: any[], sort: string) {
  const direction = sort.endsWith('_desc') ? -1 : 1;
  const value = (item: any) => sort.startsWith('auction') ? item.auctionAt : sort.startsWith('year') ? item.year : sort.startsWith('price') ? item.price.primaryUsd : sort.startsWith('mileage') ? item.odometerKm : item.lastObservedAt;
  return [...items].sort((left, right) => {
    const a = value(left); const b = value(right);
    if (a === null) return b === null ? left.key.localeCompare(right.key) : 1;
    if (b === null) return -1;
    if (a < b) return -1 * direction;
    if (a > b) return direction;
    return left.key.localeCompare(right.key);
  });
}

// ── Task 050: External auction URL builder ────────────────────
/**
 * Build a deterministic external auction URL from provider + externalLotId.
 * Does NOT use invented title slugs.
 */
function buildExternalAuctionUrl(provider: string, externalLotId: string): string | null {
  if (provider === 'copart') {
    return `https://www.copart.com/lot/${externalLotId}`;
  }
  if (provider === 'iaai') {
    return `https://www.iaai.com/VehicleDetail/${externalLotId}`;
  }
  return null;
}
