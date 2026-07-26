import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
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
    auctionOnly?: string | boolean;
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
    if (filters.auctionOnly === true || filters.auctionOnly === 'true') {
      where.leadType = { in: ['BID_ASSISTANCE', 'BUY_NOW_ASSISTANCE'] };
    }
    if (filters.managerUserId) where.managerUserId = filters.managerUserId;
    if (filters.search) {
      const search = filters.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { discoveredLot: { is: { title: { contains: search, mode: 'insensitive' } } } },
        { discoveredLot: { is: { externalLotId: { contains: search, mode: 'insensitive' } } } },
        { vehicle: { is: { title: { contains: search, mode: 'insensitive' } } } },
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
          customer: {
            select: { id: true, email: true, phone: true, profile: true },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return new PaginatedResponseDto(items.map((lead) => this.adminLeadSummary(lead)), total, page, pageSize);
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

    return {
      ...this.adminLeadSummary(lead),
      comments: lead.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        author: this.personSummary(comment.author),
      })),
      statusHistory: lead.statusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        changedAt: entry.changedAt,
        changedByUserId: entry.changedByUserId,
        reason: entry.reason,
      })),
    };
  }

  async update(
    id: string,
    data: {
      status?: string;
      assistanceStatus?: string;
      managerUserId?: string | null;
      comment?: string;
    },
    changedByUserId?: string,
  ) {
    if (data.status && !Object.values(LeadStatus).includes(data.status as LeadStatus)) {
      throw new BadRequestException('Lead status is invalid.');
    }

    const updatedId = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id },
        select: { id: true, status: true, assistanceStatus: true },
      });
      if (!lead) throw new NotFoundException(`Lead with id "${id}" not found`);
      if (data.assistanceStatus && !lead.assistanceStatus) {
        throw new BadRequestException('This lead does not have an auction assistance status.');
      }

      const completesAssistance = lead.assistanceStatus === 'NEW' && data.assistanceStatus === 'COMPLETED';
      if (completesAssistance && data.status && data.status !== 'QUALIFIED') {
        throw new BadRequestException('Completing assistance requires the QUALIFIED lead status.');
      }
      const nextStatus = completesAssistance ? 'QUALIFIED' : data.status;

      if (data.managerUserId) {
        const manager = await tx.user.findUnique({
          where: { id: data.managerUserId },
          select: {
            id: true,
            userType: true,
            userRoles: { select: { role: { select: { code: true } } } },
          },
        });
        const roleCodes = manager?.userRoles.map((entry) => entry.role.code) ?? [];
        if (!manager || !(['ADMIN', 'MANAGER'].includes(manager.userType) || roleCodes.some((code) => code === 'ADMIN' || code === 'MANAGER'))) {
          throw new BadRequestException('Assigned user must be an administrator or manager.');
        }
      }

      if (nextStatus && nextStatus !== lead.status) {
        await tx.leadStatusHistory.create({
          data: {
            leadId: id,
            fromStatus: lead.status,
            toStatus: nextStatus as LeadStatus,
            changedByUserId,
          },
        });
      }

      const updated = await tx.lead.update({
        where: { id },
        data: {
          ...(nextStatus && { status: nextStatus as LeadStatus }),
          ...(data.assistanceStatus && { assistanceStatus: data.assistanceStatus as any }),
          ...(Object.prototype.hasOwnProperty.call(data, 'managerUserId') && { managerUserId: data.managerUserId }),
        },
        select: { id: true },
      });

      const comment = data.comment?.trim();
      if (comment && changedByUserId) {
        await tx.leadComment.create({
          data: { leadId: id, authorUserId: changedByUserId, body: comment },
        });
      }
      return updated.id;
    });

    return this.findById(updatedId);
  }

  private personSummary(person: { id: string; email: string | null; phone?: string | null; profile: unknown } | null) {
    if (!person) return null;
    const profile = person.profile as { firstName?: string | null; lastName?: string | null } | null;
    return {
      id: person.id,
      email: person.email ?? null,
      phone: person.phone ?? null,
      name: [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || null,
    };
  }

  private adminLeadSummary(lead: any) {
    return {
      id: lead.id,
      leadType: lead.leadType,
      status: lead.status,
      assistanceStatus: lead.assistanceStatus ?? null,
      customerStatus: lead.assistanceStatus === 'COMPLETED'
        ? { code: 'COMPLETED', label: 'Менеджер зв’язався' }
        : lead.assistanceStatus === 'NEW'
          ? { code: 'NEW', label: 'Нова' }
          : null,
      name: lead.name ?? null,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      comment: lead.comment ?? null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      customer: this.personSummary(lead.customer ?? null),
      manager: this.personSummary(lead.manager ?? null),
      auctionLot: lead.discoveredLot ? {
        provider: lead.discoveredLot.provider,
        externalLotId: lead.discoveredLot.externalLotId,
        title: lead.discoveredLot.title,
      } : null,
      vehicle: lead.vehicle ? {
        id: lead.vehicle.id,
        title: lead.vehicle.title,
        slug: lead.vehicle.slug,
        make: lead.vehicle.make,
        model: lead.vehicle.model,
        year: lead.vehicle.year,
      } : null,
      price: lead.auctionPriceUsd !== null && lead.auctionPriceUsd !== undefined ? {
        usd: Number(lead.auctionPriceUsd),
        basis: lead.auctionPriceBasis ?? null,
        observedAt: lead.auctionPriceObservedAt ?? null,
      } : null,
    };
  }
}
