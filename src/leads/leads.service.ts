import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadDto } from './dto';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateLeadDto) {
    // Map the DTO enum to Prisma enum
    const leadTypeMap: Record<string, string> = {
      VEHICLE_INQUIRY: 'CATALOG_REQUEST',
      GENERAL_INQUIRY: 'CONTACT_FORM',
      CALLBACK_REQUEST: 'CALLBACK',
    };

    const lead = await this.prisma.lead.create({
      data: {
        leadType: (leadTypeMap[dto.leadType] ?? 'CONTACT_FORM') as any,
        status: 'NEW',
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        comment: dto.comment,
        vehicleId: dto.vehicleId ?? null,
        calculatorEstimateId: dto.calculatorEstimateId ?? null,
        utmJsonb: dto.utmJsonb ?? Prisma.DbNull,
      },
      select: {
        id: true,
        leadType: true,
        status: true,
        name: true,
        phone: true,
        email: true,
        comment: true,
        createdAt: true,
      },
    });

    this.logger.log(`New lead created: ${lead.id} (${lead.leadType})`);

    // TODO: Send notification to managers (Telegram + Email)

    return lead;
  }

  async findAll(filters: {
    page?: number;
    pageSize?: number;
    status?: string;
    leadType?: string;
    search?: string;
    managerUserId?: string;
  }): Promise<PaginatedResponseDto<any>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const where: Prisma.LeadWhereInput = {};

    if (filters.status) where.status = filters.status as any;
    if (filters.leadType) {
      const leadTypes = filters.leadType.split(',').map((value) => value.trim()).filter(Boolean);
      if (leadTypes.length === 1) where.leadType = leadTypes[0] as any;
      if (leadTypes.length > 1) where.leadType = { in: leadTypes as any };
    }
    if (filters.managerUserId) where.managerUserId = filters.managerUserId;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          discoveredLot: {
            select: { provider: true, externalLotId: true, title: true },
          },
          vehicle: {
            select: { id: true, title: true, slug: true, make: true, model: true, year: true },
          },
          manager: {
            select: { id: true, email: true, profile: true },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        vehicle: true,
        discoveredLot: true,
        calculatorEstimate: true,
        customer: {
          select: { id: true, email: true, phone: true, profile: true },
        },
        manager: {
          select: { id: true, email: true, profile: true },
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          include: {
            author: { select: { id: true, email: true, profile: true } },
          },
        },
        statusHistory: {
          orderBy: { changedAt: 'desc' },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with id "${id}" not found`);
    }

    return lead;
  }

  async update(
    id: string,
    data: {
      status?: string;
      assistanceStatus?: string;
      managerUserId?: string;
      comment?: string;
    },
    changedByUserId?: string,
  ) {
    const lead = await this.findById(id);

    if (data.assistanceStatus && !lead.assistanceStatus) {
      throw new BadRequestException('This lead does not have an auction assistance status.');
    }

    // If status changed, track history
    if (data.status && data.status !== lead.status) {
      await this.prisma.leadStatusHistory.create({
        data: {
          leadId: id,
          fromStatus: lead.status,
          toStatus: data.status as any,
          changedByUserId,
        },
      });
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status as any }),
        ...(data.assistanceStatus && { assistanceStatus: data.assistanceStatus as any }),
        ...(data.managerUserId && { managerUserId: data.managerUserId }),
      },
    });

    // Add comment if provided
    if (data.comment && changedByUserId) {
      await this.prisma.leadComment.create({
        data: {
          leadId: id,
          authorUserId: changedByUserId,
          body: data.comment,
        },
      });
    }

    return updated;
  }
}
