import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponseDto<any>> {
    const skip = (page - 1) * pageSize;

    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          vehicle: {
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
              sourceRegion: true,
              sourceType: true,
              fuelType: true,
              transmission: true,
              driveType: true,
              bodyType: true,
              availabilityStatus: true,
              media: {
                orderBy: { sortOrder: 'asc' },
                take: 2,
                select: { id: true, sourceUrl: true, isPrimary: true, sortOrder: true },
              },
            },
          },
        },
      }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);

    // Flatten: return vehicle objects directly (not wrapped in favorite)
    const items = favorites.map((fav: any) => ({
      ...fav.vehicle,
      priceAmount: Number(fav.vehicle.priceAmount),
    }));

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async add(userId: string, vehicleId: string): Promise<{ message: string }> {
    // Verify vehicle exists
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, publicationStatus: true },
    });

    if (!vehicle || vehicle.publicationStatus !== 'PUBLISHED') {
      throw new NotFoundException('Vehicle not found');
    }

    // Check duplicate
    const existing = await this.prisma.favorite.findUnique({
      where: { userId_vehicleId: { userId, vehicleId } },
    });

    if (existing) {
      throw new ConflictException('Vehicle already in favorites');
    }

    await this.prisma.favorite.create({
      data: { userId, vehicleId },
    });

    return { message: 'Vehicle added to favorites' };
  }

  async remove(userId: string, vehicleId: string): Promise<{ message: string }> {
    const existing = await this.prisma.favorite.findUnique({
      where: { userId_vehicleId: { userId, vehicleId } },
    });

    if (!existing) {
      throw new NotFoundException('Favorite not found');
    }

    await this.prisma.favorite.delete({
      where: { userId_vehicleId: { userId, vehicleId } },
    });

    return { message: 'Vehicle removed from favorites' };
  }
}
