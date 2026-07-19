import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { LeadsService } from '../leads/leads.service';
import { CopartService } from '../copart/copart.service';
import { BroadcastsService } from '../broadcasts/broadcasts.service';
import { AuditService } from '../audit/audit.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehiclesService: VehiclesService,
    private readonly leadsService: LeadsService,
    private readonly copartService: CopartService,
    private readonly broadcastsService: BroadcastsService,
    private readonly auditService: AuditService,
  ) {}

  // ═══════════════ Users ═══════════════

  async listUsers(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          email: true,
          phone: true,
          status: true,
          userType: true,
          lastLoginAt: true,
          createdAt: true,
          profile: true,
        },
      }),
      this.prisma.user.count(),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async updateUser(id: string, data: any, actorUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    const before = { status: user.status, userType: user.userType };

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.userType && { userType: data.userType }),
      },
      select: {
        id: true,
        email: true,
        status: true,
        userType: true,
      },
    });

    await this.auditService.log(actorUserId, 'User', id, 'UPDATE', before, {
      status: updated.status,
      userType: updated.userType,
    });

    return updated;
  }

  // ═══════════════ Leads ═══════════════

  async listLeads(filters: any) {
    return this.leadsService.findAll(filters);
  }

  async getLead(id: string) {
    return this.leadsService.findById(id);
  }

  async updateLead(id: string, data: any, actorUserId: string) {
    const result = await this.leadsService.update(id, data, actorUserId);
    await this.auditService.log(actorUserId, 'Lead', id, 'UPDATE', undefined, data);
    return result;
  }

  // ═══════════════ News ═══════════════

  async listNews(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.news.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          translations: true,
          author: { select: { id: true, email: true, profile: true } },
        },
      }),
      this.prisma.news.count(),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async createNews(data: any, actorUserId: string) {
    const news = await this.prisma.news.create({
      data: {
        slug: data.slug,
        status: data.status ?? 'DRAFT',
        authorUserId: actorUserId,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        coverFileId: data.coverFileId,
        ...(data.translations?.length && {
          translations: { create: data.translations },
        }),
      },
      include: { translations: true },
    });

    await this.auditService.log(actorUserId, 'News', String(news.id), 'CREATE');
    return news;
  }

  async updateNews(id: string, data: any, actorUserId: string) {
    const news = await this.prisma.news.findUnique({ where: { id: Number(id) } });
    if (!news) throw new NotFoundException(`News #${id} not found`);

    const updated = await this.prisma.news.update({
      where: { id: Number(id) },
      data: {
        ...(data.slug && { slug: data.slug }),
        ...(data.status && { status: data.status }),
        ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
        ...(data.seoDescription !== undefined && { seoDescription: data.seoDescription }),
        ...(data.status === 'PUBLISHED' && !news.publishedAt && {
          publishedAt: new Date(),
        }),
      },
      include: { translations: true },
    });

    await this.auditService.log(actorUserId, 'News', id, 'UPDATE');
    return updated;
  }

  async deleteNews(id: string, actorUserId: string): Promise<void> {
    const news = await this.prisma.news.findUnique({ where: { id: Number(id) } });
    if (!news) throw new NotFoundException(`News #${id} not found`);

    await this.prisma.news.delete({ where: { id: Number(id) } });
    await this.auditService.log(actorUserId, 'News', id, 'DELETE');
  }

  // ═══════════════ Pages ═══════════════

  async listPages(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.cmsPage.findMany({
        orderBy: { sortOrder: 'asc' },
        skip,
        take: pageSize,
        include: { translations: true },
      }),
      this.prisma.cmsPage.count(),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async createPage(data: any, actorUserId: string) {
    const page = await this.prisma.cmsPage.create({
      data: {
        code: data.code,
        slug: data.slug,
        status: data.status ?? 'DRAFT',
        sortOrder: data.sortOrder ?? 0,
        coverFileId: data.coverFileId,
        ...(data.translations?.length && {
          translations: { create: data.translations },
        }),
      },
      include: { translations: true },
    });

    await this.auditService.log(actorUserId, 'CmsPage', String(page.id), 'CREATE');
    return page;
  }

  async updatePage(id: string, data: any, actorUserId: string) {
    const page = await this.prisma.cmsPage.findUnique({ where: { id: Number(id) } });
    if (!page) throw new NotFoundException(`Page #${id} not found`);

    const updated = await this.prisma.cmsPage.update({
      where: { id: Number(id) },
      data: {
        ...(data.slug && { slug: data.slug }),
        ...(data.status && { status: data.status }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
      include: { translations: true },
    });

    await this.auditService.log(actorUserId, 'CmsPage', id, 'UPDATE');
    return updated;
  }

  async deletePage(id: string, actorUserId: string): Promise<void> {
    const page = await this.prisma.cmsPage.findUnique({ where: { id: Number(id) } });
    if (!page) throw new NotFoundException(`Page #${id} not found`);

    await this.prisma.cmsPage.delete({ where: { id: Number(id) } });
    await this.auditService.log(actorUserId, 'CmsPage', id, 'DELETE');
  }

  // ═══════════════ Vehicles ═══════════════

  async listVehicles(
    page: number,
    pageSize: number,
    filters?: { sourceRegion?: string; sourceType?: string; publicationStatus?: string },
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (filters?.sourceRegion) where.sourceRegion = filters.sourceRegion;
    if (filters?.sourceType) where.sourceType = filters.sourceType;
    if (filters?.publicationStatus) where.publicationStatus = filters.publicationStatus;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          slug: true,
          title: true,
          make: true,
          model: true,
          year: true,
          priceAmount: true,
          currency: true,
          sourceType: true,
          sourceRegion: true,
          publicationStatus: true,
          availabilityStatus: true,
          vin: true,
          odometerValue: true,
          bodyType: true,
          fuelType: true,
          transmission: true,
          locationCountry: true,
          locationCity: true,
          createdAt: true,
          updatedAt: true,
          media: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, fileId: true, sourceUrl: true, isPrimary: true, sortOrder: true },
          },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async createVehicle(data: any, actorUserId: string) {
    const vehicle = await this.vehiclesService.create(data);
    await this.auditService.log(actorUserId, 'Vehicle', vehicle.id, 'CREATE');
    return vehicle;
  }

  async archiveVehicle(id: string, actorUserId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException(`Vehicle ${id} not found`);
    const archived = await this.prisma.vehicle.update({
      where: { id },
      data: { publicationStatus: 'ARCHIVED', availabilityStatus: 'NOT_AVAILABLE' },
    });
    await this.auditService.log(actorUserId, 'Vehicle', id, 'ARCHIVE');
    return archived;
  }

  async addVehicleMedia(vehicleId: string, fileId: string, isPrimary?: boolean) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException(`Vehicle ${vehicleId} not found`);

    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);

    const maxSort = await this.prisma.vehicleMedia.aggregate({
      where: { vehicleId },
      _max: { sortOrder: true },
    });

    const media = await this.prisma.vehicleMedia.create({
      data: {
        vehicleId,
        fileId,
        sourceUrl: null,
        isPrimary: isPrimary ?? false,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    // If primary, unset others
    if (isPrimary) {
      await this.prisma.vehicleMedia.updateMany({
        where: { vehicleId, id: { not: media.id } },
        data: { isPrimary: false },
      });
    }

    return media;
  }

  async removeVehicleMedia(vehicleId: string, mediaId: string) {
    await this.prisma.vehicleMedia.deleteMany({ where: { id: mediaId, vehicleId } });
  }

  async reorderVehicleMedia(vehicleId: string, mediaIds: string[]) {
    await Promise.all(
      mediaIds.map((mediaId, index) =>
        this.prisma.vehicleMedia.updateMany({
          where: { id: mediaId, vehicleId },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.prisma.vehicleMedia.findMany({
      where: { vehicleId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async updateVehicle(id: string, data: any, actorUserId: string) {
    const vehicle = await this.vehiclesService.update(id, data);
    await this.auditService.log(actorUserId, 'Vehicle', id, 'UPDATE');
    return vehicle;
  }

  async deleteVehicle(id: string, actorUserId: string): Promise<void> {
    await this.vehiclesService.delete(id);
    await this.auditService.log(actorUserId, 'Vehicle', id, 'DELETE');
  }

  async publishVehicle(id: string, actorUserId: string) {
    const vehicle = await this.vehiclesService.publish(id);
    await this.auditService.log(actorUserId, 'Vehicle', id, 'PUBLISH');
    return vehicle;
  }

  async hideVehicle(id: string, actorUserId: string) {
    const vehicle = await this.vehiclesService.hide(id);
    await this.auditService.log(actorUserId, 'Vehicle', id, 'HIDE');
    return vehicle;
  }

  // ═══════════════ Copart Import ═══════════════

  async triggerCopartImport(actorUserId: string) {
    const result = await this.copartService.sync();
    await this.auditService.log(actorUserId, 'ImportJob', 'manual', 'TRIGGER_IMPORT');
    return result;
  }

  async listImportJobs(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.importJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          createdBy: { select: { id: true, email: true } },
        },
      }),
      this.prisma.importJob.count(),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  // ═══════════════ Calculator Rules ═══════════════

  async listCalculatorRules(ruleType: string): Promise<any[]> {
    const modelMap: Record<string, any> = {
      'auction-fees': this.prisma.auctionFeeRule,
      'logistics': this.prisma.logisticsRoute,
      'customs': this.prisma.customsRule,
      'insurance': this.prisma.insuranceRule,
      'service-fees': this.prisma.serviceFeeRule,
      'exchange-rates': this.prisma.exchangeRate,
    };

    const model = modelMap[ruleType];
    if (!model) return [];

    return model.findMany({ orderBy: { id: 'asc' } });
  }

  async createCalculatorRule(ruleType: string, data: any, actorUserId: string) {
    const modelMap: Record<string, any> = {
      'auction-fees': this.prisma.auctionFeeRule,
      'logistics': this.prisma.logisticsRoute,
      'customs': this.prisma.customsRule,
      'insurance': this.prisma.insuranceRule,
      'service-fees': this.prisma.serviceFeeRule,
    };

    const model = modelMap[ruleType];
    if (!model) throw new NotFoundException(`Unknown rule type: ${ruleType}`);

    const rule = await model.create({ data });
    await this.auditService.log(actorUserId, `CalcRule_${ruleType}`, String(rule.id), 'CREATE');
    return rule;
  }

  async updateCalculatorRule(ruleType: string, id: string, data: any, actorUserId: string) {
    const modelMap: Record<string, any> = {
      'auction-fees': this.prisma.auctionFeeRule,
      'logistics': this.prisma.logisticsRoute,
      'customs': this.prisma.customsRule,
      'insurance': this.prisma.insuranceRule,
      'service-fees': this.prisma.serviceFeeRule,
    };

    const model = modelMap[ruleType];
    if (!model) throw new NotFoundException(`Unknown rule type: ${ruleType}`);

    const rule = await model.update({ where: { id: Number(id) }, data });
    await this.auditService.log(actorUserId, `CalcRule_${ruleType}`, id, 'UPDATE');
    return rule;
  }

  async deleteCalculatorRule(ruleType: string, id: string, actorUserId: string): Promise<void> {
    const modelMap: Record<string, any> = {
      'auction-fees': this.prisma.auctionFeeRule,
      'logistics': this.prisma.logisticsRoute,
      'customs': this.prisma.customsRule,
      'insurance': this.prisma.insuranceRule,
      'service-fees': this.prisma.serviceFeeRule,
    };

    const model = modelMap[ruleType];
    if (!model) throw new NotFoundException(`Unknown rule type: ${ruleType}`);

    await model.delete({ where: { id: Number(id) } });
    await this.auditService.log(actorUserId, `CalcRule_${ruleType}`, id, 'DELETE');
  }

  // ═══════════════ Broadcasts ═══════════════

  async listBroadcasts(page: number, pageSize: number) {
    return this.broadcastsService.findAll(page, pageSize);
  }

  async createBroadcast(data: any, actorUserId: string) {
    return this.broadcastsService.create(data, actorUserId);
  }

  async updateBroadcast(id: string, data: any) {
    return this.broadcastsService.update(id, data);
  }

  async deleteBroadcast(id: string): Promise<void> {
    return this.broadcastsService.delete(id);
  }

  async sendBroadcast(id: string, actorUserId: string) {
    const result = await this.broadcastsService.send(id);
    await this.auditService.log(actorUserId, 'Broadcast', id, 'SEND');
    return result;
  }

  // ═══════════════ Audit Logs ═══════════════

  async listAuditLogs(page: number, pageSize: number) {
    return this.auditService.findAll(page, pageSize);
  }
}
