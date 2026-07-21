import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleFilterDto } from './dto';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { auctionItem, filterItems, page, parseInventoryQuery, sortItems, vehicleItem } from '../auction-lot/inventory-projection';
import { evaluateCatalogQuality, MIN_CATALOG_YEAR } from '../auction-lot/catalog-quality';
import {
  deriveAuctionLifecycle,
  evaluateAuctionTruth,
  freshAuctionPriceWhere,
  hasFreshAuctionPrice,
  publicCatalogWhere,
  publicLifecycleWhere,
} from '../auction-lot/public-eligibility';
import { computeProjectionV2 } from '../auction-lot/projection-v2';

function publicAuctionItem(lot: any, now: Date) {
  const item = auctionItem(lot);
  const projection = computeProjectionV2({
    auctionTime: lot.auctionTime,
    providerResultState: lot.providerResultState ?? 'UNKNOWN',
    listingObservedAt: lot.listingObservedAt ?? null,
    priceObservedAt: lot.priceObservedAt ?? null,
    lastProviderUpdateAt: lot.lastProviderUpdateAt ?? null,
    availabilityConfirmedAt: lot.availabilityConfirmed ? lot.lastSeenAt : null,
    currentBidUsd: lot.currentBidUsd,
    buyNowUsd: lot.buyNowUsd,
  }, now);
  const lifecycle = deriveAuctionLifecycle({
    auctionTime: lot.auctionTime,
    providerResultState: lot.providerResultState ?? 'UNKNOWN',
    listingObservedAt: lot.listingObservedAt ?? null,
    lastProviderUpdateAt: lot.lastProviderUpdateAt ?? null,
    availabilityConfirmed: lot.availabilityConfirmed ?? true,
    lastSeenAt: lot.lastSeenAt ?? null,
    state: lot.state ?? 'DISCOVERED',
    consecutiveMisses: lot.consecutiveMisses ?? 0,
    auctionState: lot.auctionState ?? null,
    lifecycleState: item.lifecycle,
  }, now);
  if (projection.priceFreshness === 'FRESH') return { ...item, lifecycle, freshness: 'FRESH' as const };
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

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: VehicleFilterDto): Promise<PaginatedResponseDto<any>> {
    const where: Prisma.VehicleWhereInput = {
      publicationStatus: 'PUBLISHED',
      // Task 036: Exclude USA region — auction lots are served via the DiscoveredLot feed.
      // Legacy USA vehicles are parser-created rows, not the canonical auction catalog.
      sourceRegion: { not: 'USA' },
    };

    // ── Dynamic filters ──
    if (filters.make) where.make = { equals: filters.make, mode: 'insensitive' };
    if (filters.model) where.model = { contains: filters.model, mode: 'insensitive' };
    if (filters.yearFrom || filters.yearTo) {
      where.year = {
        ...(filters.yearFrom && { gte: filters.yearFrom }),
        ...(filters.yearTo && { lte: filters.yearTo }),
      };
    }
    if (filters.priceFrom || filters.priceTo) {
      where.priceAmount = {
        ...(filters.priceFrom && { gte: filters.priceFrom }),
        ...(filters.priceTo && { lte: filters.priceTo }),
      };
    }
    if (filters.mileageFrom || filters.mileageTo) {
      where.odometerValue = {
        ...(filters.mileageFrom && { gte: filters.mileageFrom }),
        ...(filters.mileageTo && { lte: filters.mileageTo }),
      };
    }
    if (filters.bodyType) where.bodyType = filters.bodyType;
    if (filters.fuelType) where.fuelType = filters.fuelType;
    if (filters.transmission) where.transmission = filters.transmission;
    if (filters.driveType) where.driveType = filters.driveType;
    if (filters.sourceType) where.sourceType = filters.sourceType as 'INTERNAL' | 'COPART' | 'IAAI';
    if (filters.sourceRegion) where.sourceRegion = filters.sourceRegion as any;
    if (filters.availabilityStatus) {
      where.availabilityStatus = filters.availabilityStatus as any;
    } else {
      where.availabilityStatus = { in: ['AVAILABLE', 'RESERVED'] };
    }

    // ── Sort ──
    const orderBy = this.parseSort(filters.sort);

    // ── Pagination ──
    const skip = (filters.page - 1) * filters.pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        orderBy,
        skip,
        take: filters.pageSize,
        select: {
          id: true,
          slug: true,
          title: true,
          make: true,
          model: true,
          year: true,
          priceAmount: true,
          currency: true,
          odometerValue: true,
          bodyType: true,
          fuelType: true,
          transmission: true,
          driveType: true,
          sourceType: true,
          sourceRegion: true,
          availabilityStatus: true,
          isRecommended: true,
          publishedAt: true,
          media: {
            where: { isPrimary: true },
            take: 1,
            select: {
              id: true,
              sourceUrl: true,
              fileId: true,
            },
          },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return new PaginatedResponseDto(items, total, filters.page, filters.pageSize);
  }

  async inventory(query: Record<string, unknown>) {
    const parsed = parseInventoryQuery(query);

    // ── USA view: Prisma-side filtering + pagination ──
    if (parsed.view === 'usa') {
      return this.usaInventory(parsed);
    }

    // ── Mixed / curated view: legacy in-memory projection ──
    const [lots, vehicles] = await Promise.all([
      this.prisma.discoveredLot.findMany(),
      this.prisma.vehicle.findMany({ where: { publicationStatus: 'PUBLISHED' }, include: { media: { orderBy: { sortOrder: 'asc' }, select: { sourceUrl: true } } } }),
    ]);
    const publishedVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const truthNow = new Date();
    const projectedLots = lots.filter((lot) => evaluateAuctionTruth(lot, truthNow).publicVisible && evaluateCatalogQuality(lot).include).filter((lot) =>
      parsed.view !== 'all' || !lot.vehicleId || !publishedVehicleIds.has(lot.vehicleId));
    const items = [...projectedLots.map((lot) => publicAuctionItem(lot, truthNow)), ...vehicles.map(vehicleItem)];
    const newestAt = new Map([...lots.map((lot) => [`auctionLot:${lot.provider}:${lot.externalLotId}`, lot.firstSeenAt] as const), ...vehicles.map((vehicle) => [`vehicle:${vehicle.id}`, vehicle.createdAt] as const)]);
    const filtered = sortItems(filterItems(items, parsed), parsed.sort, newestAt);
    const offset = (parsed.page - 1) * parsed.pageSize;
    return page(filtered.slice(offset, offset + parsed.pageSize), filtered.length, parsed.page, parsed.pageSize);
  }

  async inventoryFilterOptions(query: Record<string, unknown>) {
    const parsed = parseInventoryQuery(query, undefined, false);

    // ── USA view: Prisma-side filtering ──
    if (parsed.view === 'usa') {
      return this.usaFilterOptions(parsed);
    }

    // ── Mixed / curated view ──
    const [lots, vehicles] = await Promise.all([
      this.prisma.discoveredLot.findMany(),
      this.prisma.vehicle.findMany({ where: { publicationStatus: 'PUBLISHED' }, include: { media: { orderBy: { sortOrder: 'asc' }, select: { sourceUrl: true } } } }),
    ]);
    const publishedVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const truthNow = new Date();
    const projectedLots = lots.filter((lot) => evaluateAuctionTruth(lot, truthNow).publicVisible && evaluateCatalogQuality(lot).include).filter((lot) =>
      parsed.view !== 'all' || !lot.vehicleId || !publishedVehicleIds.has(lot.vehicleId));
    const items = [...projectedLots.map((lot) => publicAuctionItem(lot, truthNow)), ...vehicles.map(vehicleItem)];
    const fields: Record<string, string> = { makes: 'make', models: 'model', bodyTypes: 'bodyType', fuelTypes: 'fuelType', transmissions: 'transmission', driveTypes: 'driveType', sources: 'source', providers: 'provider', locationStates: 'locationState', lifecycles: 'lifecycle' };
    const options = Object.fromEntries(Object.entries(fields).map(([name, field]) => {
      const eligible = filterItems(items, parsed, field as any);
      const counts = new Map<string, number>();
      eligible.forEach((item: any) => { const value = item[field]; if (value) counts.set(value, (counts.get(value) ?? 0) + 1); });
      return [name, [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, label: value, count }))];
    }));
    const eligible = filterItems(items, parsed);
    const range = (selector: (item: any) => number | null) => { const values = eligible.map(selector).filter((value): value is number => typeof value === 'number' && value > 0); return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null; };
    return { contractVersion: 'unified-auction-rc-v1', view: parsed.view, options, ranges: { year: range((item) => item.year), priceUsd: range((item) => item.price.primaryUsd), mileageKm: range((item) => item.odometerKm) }, applicability: { provider: { enabled: parsed.view !== 'curated', reason: parsed.view === 'curated' ? 'Auction-only filter.' : null }, lifecycle: { enabled: parsed.view !== 'curated', reason: parsed.view === 'curated' ? 'Auction-only filter.' : null }, buyNow: { enabled: parsed.view !== 'curated', reason: parsed.view === 'curated' ? 'Auction-only filter.' : null } }, asOf: new Date().toISOString() };
  }

  async findBySlug(slug: string): Promise<any> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { slug },
      include: {
        specs: true,
        media: { orderBy: { sortOrder: 'asc' } },
        contentTranslations: true,
      },
    });

    if (!vehicle || vehicle.publicationStatus !== 'PUBLISHED') {
      throw new NotFoundException(`Vehicle with slug "${slug}" not found`);
    }

    return vehicle;
  }

  async getFilterOptions() {
    const where: Prisma.VehicleWhereInput = {
      publicationStatus: 'PUBLISHED',
      availabilityStatus: { in: ['AVAILABLE', 'RESERVED'] },
      // Task 036: Exclude USA region — auction lots are served via the DiscoveredLot feed.
      sourceRegion: { not: 'USA' },
    };

    // Price range excludes zero (unknown price) vehicles
    const priceWhere = { ...where, priceAmount: { gt: 0 } };

    const [
      makes,
      models,
      bodyTypes,
      fuelTypes,
      transmissions,
      driveTypes,
      aggregates,
      priceAggregates,
    ] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        select: { make: true },
        distinct: ['make'],
        orderBy: { make: 'asc' },
      }),
      this.prisma.vehicle.findMany({
        where,
        select: { model: true },
        distinct: ['model'],
        orderBy: { model: 'asc' },
      }),
      this.prisma.vehicle.findMany({
        where: { ...where, bodyType: { not: null } },
        select: { bodyType: true },
        distinct: ['bodyType'],
      }),
      this.prisma.vehicle.findMany({
        where: { ...where, fuelType: { not: null } },
        select: { fuelType: true },
        distinct: ['fuelType'],
      }),
      this.prisma.vehicle.findMany({
        where: { ...where, transmission: { not: null } },
        select: { transmission: true },
        distinct: ['transmission'],
      }),
      this.prisma.vehicle.findMany({
        where: { ...where, driveType: { not: null } },
        select: { driveType: true },
        distinct: ['driveType'],
      }),
      this.prisma.vehicle.aggregate({
        where,
        _min: { year: true, odometerValue: true },
        _max: { year: true, odometerValue: true },
      }),
      this.prisma.vehicle.aggregate({
        where: priceWhere,
        _min: { priceAmount: true },
        _max: { priceAmount: true },
      }),
    ]);

    return {
      makes: makes.map((m) => m.make),
      models: models.map((m) => m.model),
      bodyTypes: bodyTypes.map((b) => b.bodyType).filter(Boolean),
      fuelTypes: fuelTypes.map((f) => f.fuelType).filter(Boolean),
      transmissions: transmissions.map((t) => t.transmission).filter(Boolean),
      driveTypes: driveTypes.map((d) => d.driveType).filter(Boolean),
      yearRange: {
        min: aggregates._min.year ?? 0,
        max: aggregates._max.year ?? 0,
      },
      priceRange: {
        min: priceAggregates._min.priceAmount
          ? Number(priceAggregates._min.priceAmount)
          : 0,
        max: priceAggregates._max.priceAmount
          ? Number(priceAggregates._max.priceAmount)
          : 0,
      },
      mileageRange: {
        min: aggregates._min.odometerValue ?? 0,
        max: aggregates._max.odometerValue ?? 0,
      },
    };
  }

  // ── USA Auction Inventory (Prisma-side, no unbounded findMany) ──

  /**
   * Build a Prisma WHERE from parsed inventory filters for USA view.
   */
  private usaWhere(parsed: ReturnType<typeof parseInventoryQuery>, now: Date): Prisma.DiscoveredLotWhereInput {
    const where = publicCatalogWhere(undefined, now);
    if (parsed.provider) where.provider = parsed.provider;
    if (parsed.make) where.make = { equals: parsed.make, mode: 'insensitive' };
    if (parsed.model) where.model = { contains: parsed.model, mode: 'insensitive' };
    if (parsed.bodyType) where.bodyStyle = { equals: parsed.bodyType, mode: 'insensitive' };
    if (parsed.fuelType) where.fuelType = { equals: parsed.fuelType, mode: 'insensitive' };
    if (parsed.transmission) where.transmission = { equals: parsed.transmission, mode: 'insensitive' };
    if (parsed.driveType) where.driveType = { equals: parsed.driveType, mode: 'insensitive' };
    if (parsed.locationState) where.locationState = { equals: parsed.locationState, mode: 'insensitive' };
    const lifecycleWhere = publicLifecycleWhere(parsed.lifecycle);
    if (lifecycleWhere) (where.AND as Prisma.DiscoveredLotWhereInput[]).push(lifecycleWhere);
    if (parsed.q) {
      where.OR = [
        { title: { contains: parsed.q, mode: 'insensitive' } },
        { make: { contains: parsed.q, mode: 'insensitive' } },
        { model: { contains: parsed.q, mode: 'insensitive' } },
        { externalLotId: { contains: parsed.q, mode: 'insensitive' } },
      ];
    }
    if (parsed.yearFrom ?? parsed.yearTo) {
      where.year = { gte: parsed.yearFrom ?? MIN_CATALOG_YEAR, ...(parsed.yearTo && { lte: parsed.yearTo }) };
    }
    if (parsed.priceFrom ?? parsed.priceTo) {
      (where.AND as Prisma.DiscoveredLotWhereInput[]).push(freshAuctionPriceWhere(now), {
        OR: [
          { buyNowUsd: { ...(parsed.priceFrom !== undefined ? { gte: parsed.priceFrom } : {}), ...(parsed.priceTo !== undefined ? { lte: parsed.priceTo } : {}) } },
          { currentBidUsd: { ...(parsed.priceFrom !== undefined ? { gte: parsed.priceFrom } : {}), ...(parsed.priceTo !== undefined ? { lte: parsed.priceTo } : {}) } },
        ],
      });
    }
    if (parsed.buyNow !== undefined) {
      where.isBuyNow = parsed.buyNow;
      (where.AND as Prisma.DiscoveredLotWhereInput[]).push(freshAuctionPriceWhere(now));
    }
    return where;
  }

  /** Prisma orderBy from sort param. */
  private usaOrderBy(sort: string): Prisma.DiscoveredLotOrderByWithRelationInput {
    if (sort.startsWith('year')) return { year: sort.endsWith('_desc') ? 'desc' : 'asc' };
    if (sort.startsWith('price')) return { currentBidUsd: sort.endsWith('_desc') ? 'desc' : 'asc' };
    if (sort.startsWith('mileage')) return { odometerKm: sort.endsWith('_desc') ? 'desc' : 'asc' };
    if (sort.startsWith('auction')) return { auctionTime: sort.endsWith('_desc') ? 'desc' : 'asc' };
    return { firstSeenAt: 'desc' };
  }

  /** Narrow select for catalog list items. */
  private usaSelect(): Prisma.DiscoveredLotSelect {
    return {
      id: true, provider: true, externalLotId: true, title: true, make: true, model: true, year: true,
      bodyStyle: true, fuelType: true, transmission: true, driveType: true,
      locationState: true, locationDisplay: true,
      odometerKm: true, odometerMi: true,
      buyNowUsd: true, currentBidUsd: true, isBuyNow: true,
      providerResultState: true, listingObservedAt: true, priceObservedAt: true, lastProviderUpdateAt: true,
      availabilityConfirmed: true, consecutiveMisses: true, state: true, lastSeenAt: true, auctionState: true,
      mediaUrls: true, auctionTime: true, auctionTimezoneOffset: true,
      lifecycleState: true, freshnessState: true,
      vehicleId: true, firstSeenAt: true,
    };
  }

  async usaInventory(parsed: ReturnType<typeof parseInventoryQuery>) {
    const now = new Date();
    const where = this.usaWhere(parsed, now);
    const orderBy = this.usaOrderBy(parsed.sort);
    const skip = (parsed.page - 1) * parsed.pageSize;
    const take = parsed.pageSize;

    // Task 050: When no provider filter is active, interleave providers.
    // Fetch separately from each provider to guarantee both are represented.
    const interleaving = !parsed.provider;

    if (interleaving) {
      // Fetch from each provider independently
      const providers: ('copart' | 'iaai')[] = ['copart', 'iaai'];
      const perProviderTake = Math.min(take * 2, 40); // enough for interleaving
      const providerResults = await Promise.all(
        providers.map(p => {
          const pw: Prisma.DiscoveredLotWhereInput = { ...where, provider: p };
          return this.prisma.discoveredLot.findMany({
            where: pw, orderBy, take: perProviderTake, select: this.usaSelect(),
          });
        })
      );
      const total = await this.prisma.discoveredLot.count({ where });

      // Map to items and interleave
      const copartItems = providerResults[0].map((lot) => publicAuctionItem(lot, now));
      const iaaiItems = providerResults[1].map((lot) => publicAuctionItem(lot, now));
      const items = interleaveProviders(copartItems, iaaiItems, skip, take);

      // Task 051: Detect inventory recovery for unfiltered USA catalog
      const result = page(items, total, parsed.page, parsed.pageSize);
      if (total === 0 && !parsed.make && !parsed.model && !parsed.bodyType) {
        const catalogState = await this.detectCatalogState();
        return { ...result, catalogState };
      }
      return { ...result, catalogState: 'NORMAL' };
    }

    const [lots, total] = await this.prisma.$transaction([
      this.prisma.discoveredLot.findMany({ where, orderBy, skip, take, select: this.usaSelect() }),
      this.prisma.discoveredLot.count({ where }),
    ]);

    const items = lots.map((lot) => publicAuctionItem(lot, now));
    const result = page(items, total, parsed.page, parsed.pageSize);
    return { ...result, catalogState: 'NORMAL' };
  }

  /** Task 051: Detect whether catalog is in inventory recovery mode. */
  private async detectCatalogState(): Promise<'NORMAL' | 'INVENTORY_RECOVERY'> {
    const [activeCount, historicalCount] = await Promise.all([
      this.prisma.discoveredLot.count({ where: publicCatalogWhere(undefined, new Date()) }),
      this.prisma.discoveredLot.count({
        where: { state: { in: ['DISCOVERED', 'IMPORTED'] } },
      }),
    ]);
    if (activeCount === 0 && historicalCount > 0) return 'INVENTORY_RECOVERY';
    return 'NORMAL';
  }

  async usaFilterOptions(parsed: ReturnType<typeof parseInventoryQuery>) {
    const now = new Date();
    const where = publicCatalogWhere(undefined, now);
    if (parsed.provider) where.provider = parsed.provider;
    // Task 050: Apply make/model/bodyType etc. to filter-options query
    // so that filter-options?view=usa&make=AUDI returns only AUDI models.
    if (parsed.make) where.make = { equals: parsed.make, mode: 'insensitive' };
    if (parsed.model) where.model = { contains: parsed.model, mode: 'insensitive' };
    if (parsed.bodyType) where.bodyStyle = { equals: parsed.bodyType, mode: 'insensitive' };
    if (parsed.fuelType) where.fuelType = { equals: parsed.fuelType, mode: 'insensitive' };
    if (parsed.transmission) where.transmission = { equals: parsed.transmission, mode: 'insensitive' };
    if (parsed.driveType) where.driveType = { equals: parsed.driveType, mode: 'insensitive' };
    if (parsed.locationState) where.locationState = { equals: parsed.locationState, mode: 'insensitive' };
    const lifecycleWhere = publicLifecycleWhere(parsed.lifecycle);
    if (lifecycleWhere) (where.AND as Prisma.DiscoveredLotWhereInput[]).push(lifecycleWhere);
    if (parsed.buyNow !== undefined) {
      where.isBuyNow = parsed.buyNow;
      (where.AND as Prisma.DiscoveredLotWhereInput[]).push(freshAuctionPriceWhere(now));
    }

    // Fetch only the fields we need for filter options — no auctionItem projection needed
    const lots = await this.prisma.discoveredLot.findMany({
      where,
      select: {
        make: true, model: true, bodyStyle: true, fuelType: true,
        transmission: true, driveType: true, provider: true,
        locationState: true, auctionState: true, lifecycleState: true,
        year: true, buyNowUsd: true, currentBidUsd: true, odometerKm: true,
        isBuyNow: true, auctionTime: true, priceObservedAt: true,
        providerResultState: true, listingObservedAt: true, lastProviderUpdateAt: true,
        availabilityConfirmed: true, consecutiveMisses: true, state: true, lastSeenAt: true,
      },
    });

    // Compute filter option counts directly from raw lots
    const countField = (field: keyof typeof lots[0]) => {
      const counts = new Map<string, number>();
      for (const lot of lots) {
        const value = lot[field];
        if (value !== null && value !== undefined && String(value)) {
          counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
        }
      }
      return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, label: value, count }));
    };

    const options = {
      makes: countField('make'),
      models: countField('model'),
      bodyTypes: countField('bodyStyle'),
      fuelTypes: countField('fuelType'),
      transmissions: countField('transmission'),
      driveTypes: countField('driveType'),
      sources: [...new Set(lots.map(l => l.provider))].sort().map(v => ({ value: v, label: v, count: lots.filter(l => l.provider === v).length })),
      providers: countField('provider'),
      locationStates: countField('locationState'),
      lifecycles: (() => {
        const counts = new Map<string, number>();
        for (const lot of lots) {
          const value = deriveAuctionLifecycle(lot, now);
          if (value === 'UPCOMING' || value === 'LIVE') counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, label: value, count }));
      })(),
    };

    // Compute ranges
    const years = lots.map(l => l.year).filter((y): y is number => y !== null && y > 0);
    const priceFreshLots = lots.filter((lot) => hasFreshAuctionPrice(lot, now));
    const bids = priceFreshLots.map(l => l.currentBidUsd ? Number(l.currentBidUsd) : null).filter((p): p is number => p !== null && p > 0);
    const buyNows = priceFreshLots.map(l => l.buyNowUsd ? Number(l.buyNowUsd) : null).filter((p): p is number => p !== null && p > 0);
    const allPrices = [...bids, ...buyNows];
    const mileages = lots.map(l => l.odometerKm).filter((m): m is number => m !== null && m > 0);

    return {
      contractVersion: 'unified-auction-rc-v1',
      view: parsed.view as 'usa',
      options,
      ranges: {
        year: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
        priceUsd: allPrices.length ? { min: Math.min(...allPrices), max: Math.max(...allPrices) } : null,
        mileageKm: mileages.length ? { min: Math.min(...mileages), max: Math.max(...mileages) } : null,
      },
      applicability: {
        provider: { enabled: true, reason: null },
        lifecycle: { enabled: true, reason: null },
        buyNow: { enabled: true, reason: null },
      },
      asOf: new Date().toISOString(),
    };
  }

  // ── Auction Bids ──────────────────────────────────────────────

  async getVehicleBids(vehicleId: string) {
    const bids = await this.prisma.bid.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    const currentBid = bids.length > 0 ? bids[0] : null;
    const totalBids = await this.prisma.bid.count({ where: { vehicleId } });

    return {
      bids: bids.map((b) => ({
        id: b.id,
        amount: Number(b.amount),
        status: b.status,
        createdAt: b.createdAt,
        bidder: b.user.profile
          ? `${b.user.profile.firstName} ${b.user.profile.lastName?.[0] || ''}.`
          : 'Анонім',
      })),
      currentBidAmount: currentBid ? Number(currentBid.amount) : null,
      totalBids,
    };
  }

  async placeBid(vehicleId: string, userId: string, amount: number, maxAmount?: number) {
    // Validate vehicle exists and is auction type
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, sourceType: true, priceAmount: true, availabilityStatus: true },
    });

    if (!vehicle) {
      throw new NotFoundException('Автомобіль не знайдено');
    }

    if (vehicle.sourceType !== 'COPART' && vehicle.sourceType !== 'IAAI') {
      throw new BadRequestException('Ставки доступні лише для аукціонних авто');
    }

    if (vehicle.availabilityStatus !== 'AVAILABLE') {
      throw new BadRequestException('Цей автомобіль вже не доступний для ставок');
    }

    // Get current highest bid
    const highestBid = await this.prisma.bid.findFirst({
      where: { vehicleId, status: 'ACTIVE' },
      orderBy: { amount: 'desc' },
    });

    const currentPrice = highestBid ? Number(highestBid.amount) : Number(vehicle.priceAmount);
    const minBid = currentPrice + 100; // Minimum step $100

    if (amount < minBid) {
      throw new BadRequestException(
        `Мінімальна ставка — $${minBid.toLocaleString()}. Поточна ціна — $${currentPrice.toLocaleString()}, крок — $100.`,
      );
    }

    // Mark previous active bids as OUTBID
    if (highestBid) {
      await this.prisma.bid.updateMany({
        where: { vehicleId, status: 'ACTIVE' },
        data: { status: 'OUTBID' },
      });
    }

    // Create new bid
    const bid = await this.prisma.bid.create({
      data: {
        vehicleId,
        userId,
        amount,
        maxAmount: maxAmount || null,
        status: 'ACTIVE',
      },
    });

    // Update vehicle price to match highest bid
    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { priceAmount: amount },
    });

    return {
      id: bid.id,
      amount: Number(bid.amount),
      status: bid.status,
      createdAt: bid.createdAt,
      message: `Вашу ставку $${amount.toLocaleString()} прийнято!`,
    };
  }

  private parseSort(sort?: string): Prisma.VehicleOrderByWithRelationInput {
    if (!sort) return { publishedAt: 'desc' };

    const sortMap: Record<string, Prisma.VehicleOrderByWithRelationInput> = {
      price_asc: { priceAmount: 'asc' },
      price_desc: { priceAmount: 'desc' },
      year_asc: { year: 'asc' },
      year_desc: { year: 'desc' },
      mileage_asc: { odometerValue: 'asc' },
      mileage_desc: { odometerValue: 'desc' },
      created_desc: { createdAt: 'desc' },
    };

    return sortMap[sort] ?? { publishedAt: 'desc' };
  }
}

// ── Task 050: Provider-aware interleaving ──────────────────────
// When both providers have eligible lots, never show more than 3
// consecutive cards from one provider. Preserves sort quality
// within each provider. Does not fabricate cards or force 50/50.
function interleaveProviders<T>(
  copartItems: T[],
  iaaiItems: T[],
  skip: number,
  take: number,
): T[] {
  // Merge with max 3 consecutive from same provider
  const result: T[] = [];
  let ci = 0; // copart index
  let ii = 0; // iaai index
  let lastProvider: 'copart' | 'iaai' | '' = '';
  let consecutive = 0;
  const maxConsecutive = 3;

  while ((ci < copartItems.length || ii < iaaiItems.length)) {
    // Prefer the provider with more remaining items, but respect maxConsecutive
    const copartRemaining = copartItems.length - ci;
    const iaaiRemaining = iaaiItems.length - ii;

    let pickCopart: boolean;

    if (copartRemaining === 0) pickCopart = false;
    else if (iaaiRemaining === 0) pickCopart = true;
    else if (lastProvider === 'copart' && consecutive >= maxConsecutive) pickCopart = false;
    else if (lastProvider === 'iaai' && consecutive >= maxConsecutive) pickCopart = true;
    else pickCopart = copartRemaining >= iaaiRemaining; // prefer larger pool

    if (pickCopart) {
      result.push(copartItems[ci++]);
      if (lastProvider === 'copart') consecutive++;
      else { consecutive = 1; lastProvider = 'copart'; }
    } else {
      result.push(iaaiItems[ii++]);
      if (lastProvider === 'iaai') consecutive++;
      else { consecutive = 1; lastProvider = 'iaai'; }
    }
  }

  // Return the page slice from the interleaved result
  return result.slice(skip, skip + take);
}
