import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    actorUserId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    before?: Record<string, any>,
    after?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId,
          entityType,
          entityId,
          action,
          beforeJsonb: before ? (before as any) : Prisma.DbNull,
          afterJsonb: after ? (after as any) : Prisma.DbNull,
        },
      });

      this.logger.debug(
        `Audit: ${action} ${entityType}#${entityId} by ${actorUserId ?? 'system'}`,
      );
    } catch (error) {
      // Audit logging should never break the main flow
      this.logger.error(`Failed to create audit log: ${error}`);
    }
  }

  async logAction(params: {
    userId: string;
    userType: string;
    action: string;
    method: string;
    url: string;
    body?: Record<string, any>;
    timestamp: Date;
    success?: boolean;
  }): Promise<void> {
    await this.log(
      params.userId,
      'HTTP_REQUEST',
      params.url,
      `${params.method} ${params.action}`,
      undefined,
      {
        method: params.method,
        url: params.url,
        body: params.body,
        success: params.success ?? true,
        timestamp: params.timestamp.toISOString(),
      },
    );
  }

  async findAll(
    page: number,
    pageSize: number,
    filters?: {
      entityType?: string;
      action?: string;
      actorUserId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<PaginatedResponseDto<any>> {
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {};
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.action) where.action = { contains: filters.action };
    if (filters?.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
        ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          actor: {
            select: { id: true, email: true, profile: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }
}
