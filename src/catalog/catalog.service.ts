import { Injectable, NotFoundException } from '@nestjs/common';
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
