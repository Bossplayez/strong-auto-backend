import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleFilterDto } from './dto';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { auctionItem, eligibleLot, filterItems, page, parseInventoryQuery, sortItems, vehicleItem } from '../auction-lot/inventory-projection';

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
    const [lots, vehicles] = await Promise.all([
      this.prisma.discoveredLot.findMany(),
      this.prisma.vehicle.findMany({ where: { publicationStatus: 'PUBLISHED' }, include: { media: { orderBy: { sortOrder: 'asc' }, select: { sourceUrl: true } } } }),
    ]);
    const publishedVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const projectedLots = lots.filter(eligibleLot).filter((lot) =>
      parsed.view !== 'all' || !lot.vehicleId || !publishedVehicleIds.has(lot.vehicleId));
    const items = [...projectedLots.map(auctionItem), ...vehicles.map(vehicleItem)];
    const newestAt = new Map([...lots.map((lot) => [`auctionLot:${lot.provider}:${lot.externalLotId}`, lot.firstSeenAt] as const), ...vehicles.map((vehicle) => [`vehicle:${vehicle.id}`, vehicle.createdAt] as const)]);
    const filtered = sortItems(filterItems(items, parsed), parsed.sort, newestAt);
    const offset = (parsed.page - 1) * parsed.pageSize;
    return page(filtered.slice(offset, offset + parsed.pageSize), filtered.length, parsed.page, parsed.pageSize);
  }

  async inventoryFilterOptions(query: Record<string, unknown>) {
    const parsed = parseInventoryQuery(query, undefined, false);
    const [lots, vehicles] = await Promise.all([
      this.prisma.discoveredLot.findMany(),
      this.prisma.vehicle.findMany({ where: { publicationStatus: 'PUBLISHED' }, include: { media: { orderBy: { sortOrder: 'asc' }, select: { sourceUrl: true } } } }),
    ]);
    const publishedVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const projectedLots = lots.filter(eligibleLot).filter((lot) =>
      parsed.view !== 'all' || !lot.vehicleId || !publishedVehicleIds.has(lot.vehicleId));
    const items = [...projectedLots.map(auctionItem), ...vehicles.map(vehicleItem)];
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
