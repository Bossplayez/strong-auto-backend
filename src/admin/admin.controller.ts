import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseFilters,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CopartService } from '../copart/copart.service';
import { ProviderLeaseService } from '../copart/provider-lease.service';
import { RequestBudgetService } from '../copart/request-budget.service';
import { DiscoveryService } from '../copart/discovery.service';
import { AuctionSearchService } from '../copart/auction-search.service';
import { FreshnessSchedulerService } from '../copart/freshness-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionLotsService } from '../auction-lot/auction-lots.service';
import { CONTRACT_VERSION, PROVIDERS, validationError } from '../auction-lot/inventory-projection';
import { ContractErrorFilter } from '../auction-lot/contract-error.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  AdminLeadQueryDto,
  UpdateLeadDto,
  CreateNewsDto,
  UpdateNewsDto,
  CreatePageDto,
  UpdatePageDto,
  CreateBroadcastDto,
} from './dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(ContractErrorFilter)
@Roles('ADMIN', 'MANAGER')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly copartService: CopartService,
    private readonly leaseService: ProviderLeaseService,
    private readonly budgetService: RequestBudgetService,
    private readonly discoveryService: DiscoveryService,
    private readonly searchService: AuctionSearchService,
    private readonly schedulerService: FreshnessSchedulerService,
    private readonly prisma: PrismaService,
    private readonly auctionLotsService: AuctionLotsService,
  ) {}

  // =====================
  // Users
  // =====================

  @Get('users')
  @ApiOperation({ summary: 'List all users (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  async listUsers(@Query() query: PaginationQueryDto): Promise<any> {
    return this.adminService.listUsers(query.page, query.pageSize);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update a user (admin)' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateUser(
    @Param('id') id: string,
    @Body() data: any,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.updateUser(id, data, actorUserId);
  }

  // =====================
  // Leads
  // =====================

  @Get('leads')
  @ApiOperation({ summary: 'List all leads with filters (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of leads' })
  async listLeads(@Query() query: AdminLeadQueryDto): Promise<any> {
    return this.adminService.listLeads(query);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'Get lead details (admin)' })
  @ApiResponse({ status: 200, description: 'Lead details' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async getLead(@Param('id') id: string): Promise<any> {
    return this.adminService.getLead(id);
  }

  @Patch('leads/:id')
  @ApiOperation({ summary: 'Update lead status or assignment (admin)' })
  @ApiResponse({ status: 200, description: 'Lead updated' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async updateLead(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.updateLead(id, dto, actorUserId);
  }

  // =====================
  // News
  // =====================

  @Get('news')
  @ApiOperation({ summary: 'List all news articles (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of news articles' })
  async listNews(@Query() query: PaginationQueryDto): Promise<any> {
    return this.adminService.listNews(query.page, query.pageSize);
  }

  @Post('news')
  @ApiOperation({ summary: 'Create a news article (admin)' })
  @ApiResponse({ status: 201, description: 'News article created' })
  async createNews(
    @Body() dto: CreateNewsDto,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.createNews(dto, actorUserId);
  }

  @Patch('news/:id')
  @ApiOperation({ summary: 'Update a news article (admin)' })
  @ApiResponse({ status: 200, description: 'News article updated' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  async updateNews(
    @Param('id') id: string,
    @Body() dto: UpdateNewsDto,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.updateNews(id, dto, actorUserId);
  }

  @Delete('news/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a news article (admin)' })
  @ApiResponse({ status: 204, description: 'News article deleted' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  async deleteNews(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<void> {
    return this.adminService.deleteNews(id, actorUserId);
  }

  // =====================
  // Pages
  // =====================

  @Get('pages')
  @ApiOperation({ summary: 'List all static pages (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of pages' })
  async listPages(@Query() query: PaginationQueryDto): Promise<any> {
    return this.adminService.listPages(query.page, query.pageSize);
  }

  @Post('pages')
  @ApiOperation({ summary: 'Create a static page (admin)' })
  @ApiResponse({ status: 201, description: 'Page created' })
  async createPage(
    @Body() dto: CreatePageDto,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.createPage(dto, actorUserId);
  }

  @Patch('pages/:id')
  @ApiOperation({ summary: 'Update a static page (admin)' })
  @ApiResponse({ status: 200, description: 'Page updated' })
  @ApiResponse({ status: 404, description: 'Page not found' })
  async updatePage(
    @Param('id') id: string,
    @Body() dto: UpdatePageDto,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.updatePage(id, dto, actorUserId);
  }

  @Delete('pages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a static page (admin)' })
  @ApiResponse({ status: 204, description: 'Page deleted' })
  @ApiResponse({ status: 404, description: 'Page not found' })
  async deletePage(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<void> {
    return this.adminService.deletePage(id, actorUserId);
  }

  // =====================
  // Vehicles
  // =====================

  @Get('vehicles')
  @ApiOperation({ summary: 'List all vehicles (admin, all statuses, optional region filter)' })
  @ApiResponse({ status: 200, description: 'Paginated list of vehicles' })
  async listVehicles(
    @Query() query: PaginationQueryDto,
    @Query('sourceRegion') sourceRegion?: string,
    @Query('sourceType') sourceType?: string,
    @Query('publicationStatus') publicationStatus?: string,
  ): Promise<any> {
    return this.adminService.listVehicles(query.page, query.pageSize, { sourceRegion, sourceType, publicationStatus });
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Create a new vehicle (admin)' })
  @ApiResponse({ status: 201, description: 'Vehicle created' })
  async createVehicle(
    @Body() data: any,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.createVehicle(data, actorUserId);
  }

  @Patch('vehicles/:id')
  @ApiOperation({ summary: 'Update a vehicle (admin)' })
  @ApiResponse({ status: 200, description: 'Vehicle updated' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async updateVehicle(
    @Param('id') id: string,
    @Body() data: any,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.updateVehicle(id, data, actorUserId);
  }

  @Delete('vehicles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a vehicle (admin)' })
  @ApiResponse({ status: 204, description: 'Vehicle deleted' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async deleteVehicle(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<void> {
    return this.adminService.deleteVehicle(id, actorUserId);
  }

  @Post('vehicles/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a vehicle to the catalog (admin)' })
  @ApiResponse({ status: 200, description: 'Vehicle published' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async publishVehicle(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.publishVehicle(id, actorUserId);
  }

  @Post('vehicles/:id/hide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide a vehicle from the catalog (admin)' })
  @ApiResponse({ status: 200, description: 'Vehicle hidden' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async hideVehicle(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.hideVehicle(id, actorUserId);
  }

  @Post('vehicles/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a vehicle (admin)' })
  @ApiResponse({ status: 200, description: 'Vehicle archived' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async archiveVehicle(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.archiveVehicle(id, actorUserId);
  }

  @Post('vehicles/:id/media')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add media to a vehicle (admin)' })
  @ApiResponse({ status: 200, description: 'Media added' })
  async addVehicleMedia(
    @Param('id') id: string,
    @Body() body: { fileId: string; isPrimary?: boolean },
  ): Promise<any> {
    return this.adminService.addVehicleMedia(id, body.fileId, body.isPrimary);
  }

  @Delete('vehicles/:id/media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove media from a vehicle (admin)' })
  async removeVehicleMedia(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
  ): Promise<void> {
    return this.adminService.removeVehicleMedia(id, mediaId);
  }

  @Patch('vehicles/:id/media/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder vehicle media (admin)' })
  async reorderVehicleMedia(
    @Param('id') id: string,
    @Body() body: { mediaIds: string[] },
  ): Promise<any> {
    return this.adminService.reorderVehicleMedia(id, body.mediaIds);
  }

  // =====================
  // Dashboard Summary (Task 045)
  // =====================

  @Get('dashboard-summary')
  @ApiOperation({ summary: 'Operational dashboard counts (admin)' })
  @ApiResponse({ status: 200, description: 'Aggregate counts for dashboard' })
  async getDashboardSummary(): Promise<any> {
    const [
      discoveredTotal,
      discoveredCopart,
      discoveredIaai,
      activePublicLots,
      activeCopart,
      activeIaai,
      vehiclesUkraine,
      vehiclesEurope,
      vehiclesTotal,
      vehiclesDraft,
      vehiclesHidden,
      vehiclesArchived,
      vehiclesNoMedia,
      vehiclesIncomplete,
      schedulerRaw,
    ] = await Promise.all([
      this.prisma.discoveredLot.count(),
      this.prisma.discoveredLot.count({ where: { provider: 'copart' } }),
      this.prisma.discoveredLot.count({ where: { provider: 'iaai' } }),
      // active public-eligible = lifecycle in UPCOMING/OPEN/LIVE + availabilityConfirmed + consecutiveMisses < 3 + freshnessState FRESH
      this.prisma.discoveredLot.count({
        where: {
          lifecycleState: { in: ['UPCOMING', 'OPEN', 'LIVE'] },
          availabilityConfirmed: true,
          consecutiveMisses: { lt: 3 },
          freshnessState: 'FRESH',
        },
      }),
      this.prisma.discoveredLot.count({
        where: {
          provider: 'copart',
          lifecycleState: { in: ['UPCOMING', 'OPEN', 'LIVE'] },
          availabilityConfirmed: true,
          consecutiveMisses: { lt: 3 },
          freshnessState: 'FRESH',
        },
      }),
      this.prisma.discoveredLot.count({
        where: {
          provider: 'iaai',
          lifecycleState: { in: ['UPCOMING', 'OPEN', 'LIVE'] },
          availabilityConfirmed: true,
          consecutiveMisses: { lt: 3 },
          freshnessState: 'FRESH',
        },
      }),
      // Manual vehicles by region (INTERNAL source only)
      this.prisma.vehicle.count({ where: { sourceType: 'INTERNAL', sourceRegion: 'UKRAINE' } }),
      this.prisma.vehicle.count({ where: { sourceType: 'INTERNAL', sourceRegion: 'EUROPE' } }),
      this.prisma.vehicle.count({ where: { sourceType: 'INTERNAL' } }),
      this.prisma.vehicle.count({ where: { sourceType: 'INTERNAL', publicationStatus: 'DRAFT' } }),
      this.prisma.vehicle.count({ where: { sourceType: 'INTERNAL', publicationStatus: 'HIDDEN' } }),
      this.prisma.vehicle.count({ where: { sourceType: 'INTERNAL', publicationStatus: 'ARCHIVED' } }),
      // Manual vehicles with no media
      this.prisma.vehicle.count({
        where: {
          sourceType: 'INTERNAL',
          media: { none: {} },
        },
      }),
      // Manual PUBLISHED vehicles missing required fields for publication completeness
      this.prisma.vehicle.count({
        where: {
          sourceType: 'INTERNAL',
          publicationStatus: 'PUBLISHED',
          OR: [
            { title: { equals: '' } },
            { year: { equals: null } },
            { priceAmount: { equals: 0 } },
            { odometerValue: { equals: null } },
            { locationCountry: { equals: null } },
            { locationCity: { equals: null } },
            { fuelType: { equals: null } },
            { bodyType: { equals: null } },
          ],
        },
      }),
      this.schedulerService.getStatus(),
    ]);

    // Build problem queue
    const problems: Array<{ severity: 'critical' | 'warning' | 'info'; label: string; count: number; href: string }> = [];

    // Scheduler health
    if (schedulerRaw?.isPaused) {
      problems.push({ severity: 'critical', label: 'Планувальник призупинено', count: 1, href: '/admin/auction' });
    }

    // Stale discovered lots (state DISCOVERED but no lifecycle progression)
    const staleLots = await this.prisma.discoveredLot.count({
      where: {
        state: 'DISCOVERED',
        lifecycleState: { in: ['NOT_READY'] },
        lastSeenAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (staleLots > 0) {
      problems.push({ severity: 'warning', label: 'Застарілі лоти (без оновлення >24год)', count: staleLots, href: '/admin/auction' });
    }

    // Manual drafts
    if (vehiclesDraft > 0) {
      problems.push({ severity: 'info', label: 'Чернетки ручних авто', count: vehiclesDraft, href: '/admin/vehicles' });
    }

    // Vehicles without photos
    if (vehiclesNoMedia > 0) {
      problems.push({ severity: 'warning', label: 'Ручні авто без фото', count: vehiclesNoMedia, href: '/admin/vehicles' });
    }

    // Incomplete published vehicles
    if (vehiclesIncomplete > 0) {
      problems.push({ severity: 'warning', label: 'Опубліковані авто з неповними даними', count: vehiclesIncomplete, href: '/admin/vehicles' });
    }

    // Hidden vehicles
    if (vehiclesHidden > 0) {
      problems.push({ severity: 'info', label: 'Приховані авто', count: vehiclesHidden, href: '/admin/vehicles' });
    }

    return {
      auctions: {
        totalDiscovered: discoveredTotal,
        activePublic: activePublicLots,
        copart: { discovered: discoveredCopart, active: activeCopart },
        iaai: { discovered: discoveredIaai, active: activeIaai },
      },
      manualVehicles: {
        ukraine: vehiclesUkraine,
        europe: vehiclesEurope,
        total: vehiclesTotal,
        draft: vehiclesDraft,
        hidden: vehiclesHidden,
        archived: vehiclesArchived,
        withoutPhotos: vehiclesNoMedia,
        incomplete: vehiclesIncomplete,
      },
      scheduler: {
        paused: Boolean(schedulerRaw?.isPaused),
        nextRunAt: schedulerRaw?.nextRunAt ? new Date(schedulerRaw.nextRunAt).toISOString() : null,
      },
      problems: problems.sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      }),
      asOf: new Date().toISOString(),
    };
  }

  // =====================
  // Copart Import
  // =====================

  @Post('copart/import/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger a manual Copart import sync (admin)' })
  @ApiResponse({ status: 200, description: 'Import job started' })
  async triggerCopartImport(
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.triggerCopartImport(actorUserId);
  }

  @Get('import-jobs')
  @ApiOperation({ summary: 'List import job history (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of import jobs' })
  async listImportJobs(@Query() query: PaginationQueryDto): Promise<any> {
    return this.adminService.listImportJobs(query.page, query.pageSize);
  }

  // =====================
  // Operational Status (Task 033R Phase 4)
  // =====================

  @Get('import/status')
  @ApiOperation({ summary: 'Get operational import status for all providers (admin)' })
  @ApiResponse({ status: 200, description: 'Operational status per provider' })
  async getImportStatus(): Promise<any> {
    const providers: ('copart' | 'iaai')[] = ['copart', 'iaai'];
    const results: any[] = [];

    // Global budget is shared — fetch once
    const globalBudget = await this.budgetService.getUsage();

    for (const provider of providers) {
      const [leaseState, lastJob] = await Promise.all([
        this.leaseService.getState(provider),
        this.prisma.importJob.findFirst({
          where: { provider },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            summaryJsonb: true,
            errorMessage: true,
            createdAt: true,
          },
        }),
      ]);

      const summary = lastJob?.summaryJsonb as any;
      const lastTerminalReason = summary?.terminalReason ?? null;
      const sanitizedSummary = summary ? {
        terminalReason: summary.terminalReason ?? null,
        created: summary.created ?? null,
        updated: summary.updated ?? null,
        skipped: summary.skipped ?? null,
        errors: summary.errors ?? null,
        pagesCompleted: summary.pagesCompleted ?? null,
        pagesAttempted: summary.pagesAttempted ?? null,
        itemsReceived: summary.itemsReceived ?? null,
      } : null;

      results.push({
        provider,
        lease: leaseState ? {
          fencingToken: leaseState.fencingToken,
          acquiredAt: leaseState.acquiredAt,
          heartbeatAt: leaseState.heartbeatAt,
          expiresAt: leaseState.expiresAt,
          isExpired: leaseState.isExpired,
          importJobId: leaseState.importJobId,
        } : null,
        isStale: leaseState ? leaseState.isExpired : false,
        lastJob: lastJob ? {
          id: lastJob.id,
          status: lastJob.status,
          startedAt: lastJob.startedAt,
          finishedAt: lastJob.finishedAt,
          createdAt: lastJob.createdAt,
          errorMessage: lastJob.errorMessage,
          terminalReason: lastTerminalReason,
          sanitizedSummary,
        } : null,
      });
    }

    const counters = (provider: string) => {
      const breakdown = globalBudget.providers.find((item) => item.provider === provider);
      const failed = breakdown ? Object.values(breakdown.failureCounts).reduce((sum, count) => sum + count, 0) : 0;
      return { allocated: breakdown?.allocated ?? 0, confirmed: breakdown?.confirmed ?? 0, completed: (breakdown?.completedSuccess ?? 0) + failed, succeeded: breakdown?.completedSuccess ?? 0, failed };
    };
    return {
      contractVersion: CONTRACT_VERSION, month: globalBudget.billingMonth,
      budget: { allocated: globalBudget.allocated, confirmed: globalBudget.confirmed, completed: globalBudget.completedSuccess + Object.values(globalBudget.failureCounts).reduce((sum, count) => sum + count, 0), succeeded: globalBudget.completedSuccess, failed: Object.values(globalBudget.failureCounts).reduce((sum, count) => sum + count, 0), cap: globalBudget.budget, protectedReserve: globalBudget.reserve, routineRemaining: Math.max(0, globalBudget.budget - globalBudget.reserve - globalBudget.allocated),
        // Task 040: daily routine cap from shared ledger
        dailyCap: globalBudget.dailyCap,
        dailyUsed: globalBudget.dailyUsed,
        dailyRemaining: globalBudget.dailyRemaining,
        dailyUtcBoundary: globalBudget.dailyUtcBoundary,
        routineAllocatedToday: globalBudget.routineAllocatedToday,
        manualAllocatedToday: globalBudget.manualAllocatedToday,
        remainingUtcDays: globalBudget.remainingUtcDays,
        dailyBlockReason: globalBudget.dailyBlockReason,
      },
      providers: results.map((entry) => ({ provider: entry.provider, enabled: true, circuit: entry.lease?.isExpired ? 'open' : 'closed', counters: counters(entry.provider), lastSuccessfulAt: entry.lastJob?.status === 'SUCCESS' ? entry.lastJob.finishedAt?.toISOString() ?? null : null, lastFailureAt: entry.lastJob?.status === 'FAILED' ? entry.lastJob.finishedAt?.toISOString() ?? null : null, lastFailureKind: null })),
      asOf: new Date().toISOString(),
    };
  }

  @Get('import/status/:provider')
  @ApiOperation({ summary: 'Get operational import status for a single provider (admin)' })
  @ApiResponse({ status: 200, description: 'Operational status for the provider' })
  async getImportStatusByProvider(@Param('provider') provider: string): Promise<any> {
    if (!PROVIDERS.includes(provider as 'copart' | 'iaai')) validationError();
    const status = await this.getImportStatus();
    return { contractVersion: CONTRACT_VERSION, month: status.month, budget: status.budget, provider: status.providers.find((item) => item.provider === provider), asOf: new Date().toISOString() };
  }

  @Post('import/recover/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger stale job recovery for a provider (admin, explicit)' })
  @ApiResponse({ status: 200, description: 'Recovery result' })
  async triggerRecovery(@Param('provider') provider: string): Promise<any> {
    if (provider !== 'copart' && provider !== 'iaai') {
      return { error: 'Invalid provider. Must be copart or iaai.' };
    }

    const p = provider as 'copart' | 'iaai';
    // Recovery is lease-aware: only recovers jobs with no active lease owner
    const leaseState = await this.leaseService.getState(p);
    if (leaseState && !leaseState.isExpired) {
      return {
        recovered: false,
        reason: 'Lease is currently active — cannot recover while a valid owner exists',
        lease: {
          expiresAt: leaseState.expiresAt,
          isExpired: false,
        },
      };
    }

    const result = await this.leaseService.recoverStaleJobs(p);
    return {
      recovered: true,
      recoveredJobIds: result.recoveredJobIds,
      count: result.recoveredJobIds.length,
    };
  }

  // =====================
  // Calculator Rules
  // =====================

  @Get('calculator/:ruleType')
  @ApiOperation({ summary: 'List calculator rules by type (admin)' })
  @ApiResponse({ status: 200, description: 'List of calculator rules' })
  async listCalculatorRules(
    @Param('ruleType') ruleType: string,
  ): Promise<any[]> {
    return this.adminService.listCalculatorRules(ruleType);
  }

  @Post('calculator/:ruleType')
  @ApiOperation({ summary: 'Create a calculator rule (admin)' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  async createCalculatorRule(
    @Param('ruleType') ruleType: string,
    @Body() data: any,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.createCalculatorRule(ruleType, data, actorUserId);
  }

  @Patch('calculator/:ruleType/:id')
  @ApiOperation({ summary: 'Update a calculator rule (admin)' })
  @ApiResponse({ status: 200, description: 'Rule updated' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async updateCalculatorRule(
    @Param('ruleType') ruleType: string,
    @Param('id') id: string,
    @Body() data: any,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.updateCalculatorRule(ruleType, id, data, actorUserId);
  }

  @Delete('calculator/:ruleType/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a calculator rule (admin)' })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteCalculatorRule(
    @Param('ruleType') ruleType: string,
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<void> {
    return this.adminService.deleteCalculatorRule(ruleType, id, actorUserId);
  }

  // =====================
  // Broadcasts
  // =====================

  @Get('broadcasts')
  @ApiOperation({ summary: 'List all broadcasts (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of broadcasts' })
  async listBroadcasts(@Query() query: PaginationQueryDto): Promise<any> {
    return this.adminService.listBroadcasts(query.page, query.pageSize);
  }

  @Post('broadcasts')
  @ApiOperation({ summary: 'Create a broadcast (admin)' })
  @ApiResponse({ status: 201, description: 'Broadcast created' })
  async createBroadcast(
    @Body() dto: CreateBroadcastDto,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.createBroadcast(dto, actorUserId);
  }

  @Patch('broadcasts/:id')
  @ApiOperation({ summary: 'Update a broadcast (admin)' })
  @ApiResponse({ status: 200, description: 'Broadcast updated' })
  @ApiResponse({ status: 404, description: 'Broadcast not found' })
  async updateBroadcast(
    @Param('id') id: string,
    @Body() dto: CreateBroadcastDto,
    @CurrentUser('id') actorUserId: string,
  ): Promise<any> {
    return this.adminService.updateBroadcast(id, dto);
  }

  @Delete('broadcasts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a broadcast (admin)' })
  @ApiResponse({ status: 204, description: 'Broadcast deleted' })
  @ApiResponse({ status: 404, description: 'Broadcast not found' })
  async deleteBroadcast(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<void> {
    return this.adminService.deleteBroadcast(id);
  }

  @Post('broadcasts/:id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a broadcast to all recipients (admin)' })
  @ApiResponse({ status: 200, description: 'Broadcast sending initiated' })
  @ApiResponse({ status: 404, description: 'Broadcast not found' })
  async sendBroadcast(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ): Promise<{ message: string }> {
    return this.adminService.sendBroadcast(id, actorUserId);
  }

  // =====================
  // Audit Logs
  // =====================

  @Get('audit-logs')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'View audit logs (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of audit log entries' })
  async listAuditLogs(@Query() query: PaginationQueryDto): Promise<any> {
    return this.adminService.listAuditLogs(query.page, query.pageSize);
  }

  // =====================
  // Auction Discovery (Task 033S)
  // =====================

  @Get('auction/search')
  @ApiOperation({ summary: 'Search live auction lots (admin)' })
  @ApiResponse({ status: 200, description: 'Search results with cache + dedup' })
  async auctionSearch(@Query() query: Record<string, string>): Promise<any> {
    return this.searchService.search(query);
  }

  @Post('auction/import-lot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Import a discovered lot into catalog (admin)' })
  @ApiResponse({ status: 200, description: 'Import result' })
  async importDiscoveredLot(@Body() body: Record<string, unknown>): Promise<any> {
    return this.auctionLotsService.importPersistedLot(body);
  }

  @Post('auction/discovery/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger bounded discovery pass (admin)' })
  @ApiResponse({ status: 200, description: 'Discovery result' })
  async runDiscovery(@Body() body: {
    platform: 'copart' | 'iaai';
    make?: string;
    year?: number;
    search?: string;
    buyNow?: boolean;
    saleStatus?: string;
    sort?: string;
    maxPages?: number;
  }): Promise<any> {
    return this.discoveryService.runDiscovery(body, body.maxPages);
  }

  @Get('auction/checkpoints')
  @ApiOperation({ summary: 'Get cursor state per provider (admin)' })
  @ApiResponse({ status: 200, description: 'Cursor states' })
  async getCheckpointStates(@Query() query: Record<string, unknown>): Promise<any> {
    if (Object.keys(query).some((key) => key !== 'provider' && key !== 'mode')) validationError();
    const provider = query.provider === undefined ? undefined : String(query.provider);
    const mode = query.mode === undefined ? undefined : String(query.mode);
    if ((provider && !PROVIDERS.includes(provider as 'copart' | 'iaai')) || (mode && !['discovery', 'refresh'].includes(mode))) validationError();
    const providers = provider ? [provider] : [...PROVIDERS];
    const items = (await Promise.all(providers.map(async (entry) => {
      const checkpoints = await this.discoveryService.getCheckpointState(entry);
      return checkpoints.map((checkpoint: any) => ({
        provider: entry, mode: checkpoint.mode ?? (String(checkpoint.queryFingerprint ?? '').includes('refresh') ? 'refresh' : 'discovery'),
        cursor: checkpoint.lastCursor ?? checkpoint.cursor ?? null, cycleId: checkpoint.cycleId ?? null,
        cycleStartedAt: checkpoint.lastStartedAt ? new Date(checkpoint.lastStartedAt).toISOString() : null,
        lastSuccessfulPageAt: checkpoint.lastCompletedAt ? new Date(checkpoint.lastCompletedAt).toISOString() : null,
        exhaustedAt: checkpoint.exhaustedAt ? new Date(checkpoint.exhaustedAt).toISOString() : null,
        nextSweepAt: checkpoint.nextSweepAt ? new Date(checkpoint.nextSweepAt).toISOString() : null,
        leaseVersion: Number(checkpoint.leaseVersion ?? 0),
      }));
    }))).flat().filter((item) => !mode || item.mode === mode).sort((left, right) => `${left.provider}:${left.mode}`.localeCompare(`${right.provider}:${right.mode}`));
    return { contractVersion: CONTRACT_VERSION, items, asOf: new Date().toISOString() };
  }

  @Get('auction/discovered-lots')
  @ApiOperation({ summary: 'List discovered lots (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated discovered lots' })
  async listDiscoveredLots(@Query() query: Record<string, unknown>): Promise<any> {
    return this.auctionLotsService.listAdminLots(query);
  }

  @Get('auction/discovered-lots/:provider/:externalLotId')
  async discoveredLotDetail(@Param('provider') provider: string, @Param('externalLotId') externalLotId: string): Promise<any> {
    return this.auctionLotsService.adminLotDetail(provider, externalLotId);
  }

  @Get('auction/metrics')
  async auctionMetrics(): Promise<any> {
    return this.auctionLotsService.adminMetrics();
  }

  @Get('auction/scheduler')
  async auctionScheduler(): Promise<any> {
    const status = await this.schedulerService.getStatus();
    return {
      contractVersion: CONTRACT_VERSION, paused: Boolean(status.isPaused),
      cadenceMs: { discovery: Number(status.coldIntervalMs ?? 0), refresh: Number(status.hotIntervalMs ?? 0) },
      lastRunAt: status.lastRunAt ? new Date(status.lastRunAt).toISOString() : null,
      nextRunAt: status.nextRunAt ? new Date(status.nextRunAt).toISOString() : null,
      lastResult: status.lastResult ?? null,
      lastSuccessfulPageAt: status.lastSuccessfulPageAt,
      recoveryMode: status.recoveryMode,
      asOf: new Date().toISOString(),
      // Task 040: daily cap diagnostics from shared ledger
      dailyCap: status.dailyCap ?? null,
      dailyUsed: status.dailyUsed ?? null,
      dailyRemaining: status.dailyRemaining ?? null,
      dailyBlockReason: status.dailyBlockReason ?? null,
      // Task 050B: Tier diagnostics
      tiers: {
        HOT: { total: status.tierHot, stale: status.tierHotStale, pendingRefresh: status.pendingHot },
        WARM: { total: status.tierWarm, stale: status.tierWarmStale, pendingRefresh: status.pendingWarm },
        COLD: { total: status.tierCold, stale: status.tierColdStale, pendingRefresh: status.pendingCold },
      },
      oldestObservationAge: status.oldestObservationAge,
    };
  }

  // =====================
  // Scheduler Controls (Task 033S)
  // =====================

  @Post('auction/scheduler/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause scheduler (admin)' })
  @ApiResponse({ status: 200, description: 'Scheduler paused' })
  async pauseScheduler(): Promise<{ message: string }> {
    await this.schedulerService.pause();
    return { message: 'Scheduler paused' };
  }

  @Post('auction/scheduler/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume scheduler (admin)' })
  @ApiResponse({ status: 200, description: 'Scheduler resumed' })
  async resumeScheduler(): Promise<{ message: string }> {
    await this.schedulerService.resume();
    return { message: 'Scheduler resumed' };
  }

  @Patch('auction/scheduler/cadence')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update scheduler cadence (admin)' })
  @ApiResponse({ status: 200, description: 'Cadence updated' })
  async updateCadence(@Body() body: {
    hotIntervalMs?: number;
    warmIntervalMs?: number;
    coldIntervalMs?: number;
  }): Promise<{ message: string }> {
    await this.schedulerService.updateCadence(body);
    return { message: 'Cadence updated' };
  }

  @Post('auction/scheduler/tick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger manual scheduler tick (admin)' })
  @ApiResponse({ status: 200, description: 'Tick result' })
  async triggerTick(): Promise<any> {
    return this.schedulerService.tick();
  }
}
