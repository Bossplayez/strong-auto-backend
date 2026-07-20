import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscoveredLot, Vehicle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  auctionItem, CONTRACT_VERSION, eligibleLot, filterItems, page,
  parseInventoryQuery, PROVIDERS, sortItems, validationError,
} from './inventory-projection';
import { evaluateCatalogQuality, publicCatalogWhere } from './catalog-quality';

@Injectable()
export class AuctionLotsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(raw: Record<string, unknown>) {
    const query = parseInventoryQuery(raw, 'usa');

    // Use Prisma-side filtering for performance (no unbounded findMany)
    const where = publicCatalogWhere();
    if (query.provider) where.provider = query.provider;
    if (query.make) where.make = { equals: query.make, mode: 'insensitive' };
    if (query.model) where.model = { contains: query.model, mode: 'insensitive' };
    if (query.bodyType) where.bodyStyle = { equals: query.bodyType, mode: 'insensitive' };
    if (query.fuelType) where.fuelType = { equals: query.fuelType, mode: 'insensitive' };
    if (query.transmission) where.transmission = { equals: query.transmission, mode: 'insensitive' };
    if (query.driveType) where.driveType = { equals: query.driveType, mode: 'insensitive' };
    if (query.locationState) where.locationState = { equals: query.locationState, mode: 'insensitive' };
    if (query.lifecycle) where.lifecycleState = query.lifecycle;
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
    if (query.buyNow !== undefined) where.isBuyNow = query.buyNow;

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
          mediaUrls: true, auctionTime: true, auctionTimezoneOffset: true,
          lifecycleState: true, freshnessState: true, vehicleId: true, firstSeenAt: true,
        },
      }),
      this.prisma.discoveredLot.count({ where }),
    ]);

    const items = lots.map((lot) => auctionItem(lot as any));
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

    // Quality evaluation for public visibility
    const quality = evaluateCatalogQuality(lot);
    if (!quality.include) {
      throw new NotFoundException({
        code: 'AUCTION_LOT_NOT_AVAILABLE',
        message: 'Цей лот недоступний у публічному каталозі.',
      });
    }

    // Task 050: Determine result-pending state
    const now = new Date();
    const isResultPending = !!(lot.auctionTime && lot.auctionTime <= now &&
      !['SOLD', 'REMOVED'].includes(lot.lifecycleState));

    // For past-auction lots: show "Аукціон завершився, результат уточнюється"
    // Do not show active prices, countdown, or Buy Now for ended lots
    const isActive = !isResultPending && ['UPCOMING', 'OPEN', 'LIVE'].includes(lot.lifecycleState);

    return {
      ...auctionItem(lot),
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
      runCondition: lot.runCondition ?? null,
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
      // This is when the provider actually confirmed the lot data,
      // NOT the server response generation time.
      providerObservedAt: lot.lastSeenAt ? lot.lastSeenAt.toISOString() : null,
      lastSoldPriceUsd: lot.lastSoldPriceUsd ? Number(lot.lastSoldPriceUsd) : null,
      terminalAt: lot.terminalAt ? lot.terminalAt.toISOString() : null,
      vin: lot.vin ?? null,
      // Quality outcome
      qualityInclude: quality.include,
      qualityReasonCode: quality.reasonCode,
      contractVersion: CONTRACT_VERSION, asOf: new Date().toISOString(),
      // Task 050: result-pending state for past auction without confirmed provider result
      resultPending: isResultPending,
      // Task 050: whether this lot is still actively auctioning
      isActive,
      // Task 050: external auction URL for the lot
      externalAuctionUrl: buildExternalAuctionUrl(lot.provider, lot.externalLotId),
    };
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
    const items = lots.map(lot => {
      const projected = auctionItem(lot);
      const isEnded = lot.auctionTime && lot.auctionTime <= now &&
        !['SOLD', 'REMOVED'].includes(lot.lifecycleState);
      return {
        ...projected,
        resultPending: isEnded ?? false,
      };
    });
    return { contractVersion: CONTRACT_VERSION, items, total: items.length, asOf: new Date().toISOString() };
  }

  async getStats() {
    const lots = (await this.prisma.discoveredLot.findMany()).filter(eligibleLot);
    const partition = (provider?: string) => {
      const selected = provider ? lots.filter((lot) => lot.provider === provider) : lots;
      return {
        current: selected.length,
        live: selected.filter((lot) => lot.lifecycleState === 'LIVE').length,
        buyNow: selected.filter((lot) => lot.isBuyNow && Number(lot.buyNowUsd) > 0).length,
        upcoming: selected.filter((lot) => lot.lifecycleState === 'UPCOMING').length,
      };
    };
    return {
      contractVersion: CONTRACT_VERSION, ...partition(),
      byProvider: { copart: partition('copart'), iaai: partition('iaai') },
      asOf: new Date().toISOString(),
    };
  }

  async listAdminLots(raw: Record<string, unknown>) {
    const query = parseAdminLotQuery(raw);
    const lots = await this.prisma.discoveredLot.findMany();
    const linked = await this.linkedVehicles(lots.map((lot) => lot.vehicleId).filter((id): id is string => Boolean(id)));
    const items = lots.map((lot) => this.adminItem(lot, linked.get(lot.vehicleId ?? ''))).filter((item) => matchesAdminItem(item, query));
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
    return {
      contractVersion: CONTRACT_VERSION,
      item: {
        ...this.adminItem(lot, linked.get(lot.vehicleId ?? '')),
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
      asOf: new Date().toISOString(),
    };
  }

  async adminMetrics() {
    return this.prisma.$transaction(async (tx) => {
      const asOf = new Date();
      const [lots, vehicles] = await Promise.all([
        tx.discoveredLot.findMany(),
        tx.vehicle.findMany({ select: { id: true, publicationStatus: true } }),
      ]);
      const classify = (lot: (typeof lots)[number]) => {
        const ended = ['ENDED', 'SOLD', 'REMOVED'].includes(lot.lifecycleState) ||
          ['SOLD', 'REMOVED', 'UNAVAILABLE'].includes(lot.state);
        if (ended) return 'ended' as const;
        if (eligibleLot(lot)) return 'current' as const;
        if (['STALE', 'DEFERRED'].includes(lot.freshnessState) || !lot.availabilityConfirmed || lot.consecutiveMisses > 0) {
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
      const activeLots = lots.filter((lot) => {
        const ended = ['ENDED', 'SOLD', 'REMOVED'].includes(lot.lifecycleState) ||
          ['SOLD', 'REMOVED', 'UNAVAILABLE'].includes(lot.state);
        return !ended;
      });
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
        asOf: asOf.toISOString(),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
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

  private adminItem(lot: DiscoveredLot, vehicle?: LinkedVehicle) {
    const projected = auctionItem(lot);
    return {
      key: projected.key,
      provider: lot.provider,
      externalLotId: lot.externalLotId,
      state: lot.state,
      tier: lot.freshnessTier,
      lifecycle: projected.lifecycle,
      freshness: projected.freshness,
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
      importState: !vehicle ? 'notImported' : vehicle.publicationStatus === 'DRAFT' ? 'draft' : vehicle.publicationStatus === 'PUBLISHED' ? 'published' : 'other',
      linkedVehicle: vehicle ? { vehicleId: vehicle.id, slug: vehicle.slug, publicationStatus: vehicle.publicationStatus } : null,
      consecutiveMisses: lot.consecutiveMisses, firstDiscoveredAt: lot.firstSeenAt.toISOString(), lastObservedAt: lot.lastSeenAt?.toISOString() ?? null,
      availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt.toISOString() : null, updatedAt: lot.updatedAt.toISOString(),
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
    (freshness && !['FRESH', 'STALE', 'DEFERRED'].includes(freshness)) || (importState && !['notImported', 'draft', 'published', 'other'].includes(importState)) ||
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
