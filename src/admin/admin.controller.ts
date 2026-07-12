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
import { PrismaService } from '../prisma/prisma.service';
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
@Roles('ADMIN', 'MANAGER')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly copartService: CopartService,
    private readonly leaseService: ProviderLeaseService,
    private readonly budgetService: RequestBudgetService,
    private readonly prisma: PrismaService,
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
  @ApiOperation({ summary: 'List all vehicles (admin, all statuses)' })
  @ApiResponse({ status: 200, description: 'Paginated list of vehicles' })
  async listVehicles(@Query() query: PaginationQueryDto): Promise<any> {
    return this.adminService.listVehicles(query.page, query.pageSize);
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

    return {
      providers: results,
      globalBudget: {
        billingMonth: globalBudget.billingMonth,
        allocated: globalBudget.allocated,
        confirmed: globalBudget.confirmed,
        completedSuccess: globalBudget.completedSuccess,
        unresolved: globalBudget.unresolved,
        budget: globalBudget.budget,
        reserve: globalBudget.reserve,
        availableForRoutine: globalBudget.availableForRoutine,
        percentageUsed: globalBudget.percentageUsed,
        isWarning: globalBudget.isWarning,
        isRoutineBlocked: globalBudget.isRoutineBlocked,
        isAbsoluteBlocked: globalBudget.isAbsoluteBlocked,
        providerBreakdowns: globalBudget.providers,
      },
    };
  }

  @Get('import/status/:provider')
  @ApiOperation({ summary: 'Get operational import status for a single provider (admin)' })
  @ApiResponse({ status: 200, description: 'Operational status for the provider' })
  async getImportStatusByProvider(@Param('provider') provider: string): Promise<any> {
    if (provider !== 'copart' && provider !== 'iaai') {
      return { error: 'Invalid provider. Must be copart or iaai.' };
    }

    const p = provider as 'copart' | 'iaai';
    const [leaseState, lastJob] = await Promise.all([
      this.leaseService.getState(p),
      this.prisma.importJob.findFirst({
        where: { provider: p },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      provider: p,
      lease: leaseState ? {
        fencingToken: leaseState.fencingToken,
        acquiredAt: leaseState.acquiredAt,
        heartbeatAt: leaseState.heartbeatAt,
        expiresAt: leaseState.expiresAt,
        isExpired: leaseState.isExpired,
        importJobId: leaseState.importJobId,
      } : null,
      isStale: leaseState ? leaseState.isExpired : false,
      lastJob,
    };
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
}
