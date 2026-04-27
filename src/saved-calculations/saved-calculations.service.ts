import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class SavedCalculationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponseDto<any>> {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.savedCalculation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          calculatorEstimate: {
            select: {
              id: true,
              inputJsonb: true,
              totalAmount: true,
              totalCurrency: true,
              createdAt: true,
              vehicle: {
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  make: true,
                  model: true,
                  year: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.savedCalculation.count({ where: { userId } }),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async save(userId: string, estimateId: string): Promise<{ message: string }> {
    const estimate = await this.prisma.calculatorEstimate.findUnique({
      where: { id: estimateId },
    });

    if (!estimate) {
      throw new NotFoundException('Calculator estimate not found');
    }

    const existing = await this.prisma.savedCalculation.findUnique({
      where: {
        userId_calculatorEstimateId: { userId, calculatorEstimateId: estimateId },
      },
    });

    if (existing) {
      throw new ConflictException('Calculation already saved');
    }

    await this.prisma.savedCalculation.create({
      data: { userId, calculatorEstimateId: estimateId },
    });

    return { message: 'Calculation saved successfully' };
  }

  async remove(userId: string, estimateId: string): Promise<{ message: string }> {
    const existing = await this.prisma.savedCalculation.findUnique({
      where: {
        userId_calculatorEstimateId: { userId, calculatorEstimateId: estimateId },
      },
    });

    if (!existing) {
      throw new NotFoundException('Saved calculation not found');
    }

    await this.prisma.savedCalculation.delete({
      where: {
        userId_calculatorEstimateId: { userId, calculatorEstimateId: estimateId },
      },
    });

    return { message: 'Saved calculation removed' };
  }
}
