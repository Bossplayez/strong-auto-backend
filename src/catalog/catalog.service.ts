import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleFilterDto } from './dto';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: VehicleFilterDto): Promise<PaginatedResponseDto<any>> {
    const where: Prisma.VehicleWhereInput = {
      publicationStatus: 'PUBLISHED',
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
    if (filters.sourceType) where.sourceType = filters.sourceType as any;
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
    const [makes, bodyTypes, fuelTypes] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where: { publicationStatus: 'PUBLISHED' },
        select: { make: true },
        distinct: ['make'],
        orderBy: { make: 'asc' },
      }),
      this.prisma.vehicle.findMany({
        where: { publicationStatus: 'PUBLISHED', bodyType: { not: null } },
        select: { bodyType: true },
        distinct: ['bodyType'],
      }),
      this.prisma.vehicle.findMany({
        where: { publicationStatus: 'PUBLISHED', fuelType: { not: null } },
        select: { fuelType: true },
        distinct: ['fuelType'],
      }),
    ]);

    return {
      makes: makes.map((m) => m.make),
      bodyTypes: bodyTypes.map((b) => b.bodyType).filter(Boolean),
      fuelTypes: fuelTypes.map((f) => f.fuelType).filter(Boolean),
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

    if (vehicle.sourceType !== 'COPART') {
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
