// ─────────────────────────────────────────────────────────────
// Strong Auto — Public Auction Lots Controller (Task 036)
// Public read-only endpoints for auction lot browsing.
// No authentication required. Rate-limited via Throttler.
// ─────────────────────────────────────────────────────────────

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuctionLotsService } from './auction-lots.service';
import { ContractErrorFilter } from './contract-error.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CONTRACT_VERSION, auctionItem, priceFact } from './inventory-projection';
import { NotFoundException } from '@nestjs/common';
import { deriveAuctionLifecycle, evaluateAuctionTruth, hasFreshAuctionPrice } from './public-eligibility';
import { CreateAuctionAssistanceRequestDto } from './dto/create-auction-assistance-request.dto';

function assertCookieRequestOrigin(request: Request) {
  if (request.headers.authorization || !request.cookies?.access_token) return;

  const allowedOrigins = new Set([
    'https://strong-auto-frontend-zeta.vercel.app',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
  ].filter(Boolean));

  if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) {
    throw new ForbiddenException({ code: 'INVALID_REQUEST_ORIGIN', message: 'Request origin is not allowed.' });
  }
}

@ApiTags('auction-lots')
@UseFilters(ContractErrorFilter)
@Controller('auction-lots')
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class AuctionLotsController {
  constructor(
    private readonly auctionLotsService: AuctionLotsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List public auction lots' })
  @ApiResponse({ status: 200, description: 'Paginated auction lot list' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'make', required: false })
  @ApiQuery({ name: 'model', required: false })
  @ApiQuery({ name: 'yearFrom', required: false, type: Number })
  @ApiQuery({ name: 'yearTo', required: false, type: Number })
  @ApiQuery({ name: 'priceFrom', required: false, type: Number })
  @ApiQuery({ name: 'priceTo', required: false, type: Number })
  @ApiQuery({ name: 'mileageFrom', required: false, type: Number })
  @ApiQuery({ name: 'mileageTo', required: false, type: Number })
  @ApiQuery({ name: 'bodyType', required: false })
  @ApiQuery({ name: 'fuelType', required: false })
  @ApiQuery({ name: 'transmission', required: false })
  @ApiQuery({ name: 'driveType', required: false })
  @ApiQuery({ name: 'locationState', required: false })
  @ApiQuery({ name: 'lifecycle', required: false })
  @ApiQuery({ name: 'buyNow', required: false, type: Boolean })
  @ApiQuery({ name: 'sort', required: false })
  async findAll(@Query() query: Record<string, unknown>) {
    return this.auctionLotsService.findAll(query);
  }

  // IMPORTANT: /stats and /search must be declared BEFORE /:provider/:externalLotId
  // otherwise NestJS will match 'stats' or 'search' as the :provider param.
  @Get('stats')
  @ApiOperation({ summary: 'Get public auction lot stats' })
  @ApiResponse({ status: 200, description: 'Auction lot statistics' })
  async getStats() {
    return this.auctionLotsService.getStats();
  }

  @Get('admin/metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: auction lot metrics with coverage diagnostics' })
  @ApiResponse({ status: 200, description: 'Detailed metrics including quality coverage' })
  async adminMetrics() {
    return this.auctionLotsService.adminMetrics();
  }

  @Get('admin/lot/:provider/:externalLotId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: full lot detail with quality outcome' })
  @ApiParam({ name: 'provider', description: 'Provider (copart, iaai)' })
  @ApiParam({ name: 'externalLotId', description: 'External lot number' })
  @ApiResponse({ status: 200, description: 'Full lot detail with quality reason codes' })
  async adminLotDetail(
    @Param('provider') provider: string,
    @Param('externalLotId') externalLotId: string,
  ) {
    return this.auctionLotsService.adminLotDetail(provider, externalLotId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search auction lots by VIN or lot number' })
  @ApiResponse({ status: 200, description: 'Search results including terminal lots' })
  @ApiQuery({ name: 'q', required: false, description: 'VIN, lot number, or partial match' })
  async search(@Query('q') q: string) {
    return this.auctionLotsService.searchByVinOrLot(q || '');
  }

  @Get(':provider/:externalLotId/calculator-preview')
  @ApiOperation({ summary: 'Preview the existing Strong Auto calculator for a public auction lot' })
  @ApiParam({ name: 'provider', description: 'Provider (copart, iaai)' })
  @ApiParam({ name: 'externalLotId', description: 'External lot number' })
  @ApiResponse({ status: 200, description: 'Calculator preview or an unavailable state' })
  async calculatorPreview(
    @Param('provider') provider: string,
    @Param('externalLotId') externalLotId: string,
  ) {
    return this.auctionLotsService.getCalculatorPreview(provider, externalLotId);
  }

  @Post(':provider/:externalLotId/assistance-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ auction: { limit: 8, ttl: 60000 } })
  @ApiOperation({ summary: 'Create an authenticated request about an auction lot' })
  @ApiResponse({ status: 201, description: 'Request created' })
  @ApiResponse({ status: 200, description: 'Recent duplicate request reused' })
  async createAssistanceRequest(
    @Param('provider') provider: string,
    @Param('externalLotId') externalLotId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAuctionAssistanceRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCookieRequestOrigin(request);
    const result = await this.auctionLotsService.createAssistanceRequest(provider, externalLotId, userId, dto);
    response.status(result.outcome === 'created' ? 201 : 200);
    return result;
  }

  @Get(':provider/:externalLotId')
  @ApiOperation({ summary: 'Get public auction lot detail' })
  @ApiParam({ name: 'provider', description: 'Provider (copart, iaai)' })
  @ApiParam({ name: 'externalLotId', description: 'External lot number' })
  @ApiResponse({ status: 200, description: 'Auction lot detail' })
  @ApiResponse({ status: 404, description: 'Lot not found' })
  async findOne(
    @Param('provider') provider: string,
    @Param('externalLotId') externalLotId: string,
  ) {
    return this.auctionLotsService.findOne(provider, externalLotId);
  }
}

@ApiTags('auction-assistance-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/assistance-requests')
export class MyAuctionAssistanceRequestsController {
  constructor(private readonly auctionLotsService: AuctionLotsService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user\'s auction requests' })
  async list(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.auctionLotsService.listMyAssistanceRequests(userId, Number(page ?? 1), Number(pageSize ?? 20));
  }
}

// ── Auction Lot Favorites (Task 044) ──
// Authenticated user endpoints (no admin role required).

@ApiTags('auction-lot-favorites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/auction-lot-favorites')
export class AuctionLotFavoritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List current user auction lot favorites' })
  @ApiResponse({ status: 200, description: 'List of favorited auction lots' })
  async list(@CurrentUser('id') userId: string) {
    const favorites = await this.prisma.auctionLotFavorite.findMany({
      where: { userId },
      include: { discoveredLot: true },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return {
      contractVersion: CONTRACT_VERSION,
      items: favorites.map(f => {
        const lot = f.discoveredLot;
        const truth = evaluateAuctionTruth(lot, now);
        const priceFresh = truth.publicVisible && hasFreshAuctionPrice(lot, now);
        return {
          key: `auctionLot:${lot.provider}:${lot.externalLotId}`,
          provider: lot.provider,
          externalLotId: lot.externalLotId,
          title: lot.title,
          lifecycle: deriveAuctionLifecycle(lot, now),
          freshness: truth.publicVisible ? 'FRESH' : truth.reasonCode === 'LISTING_STALE' ? 'STALE' : 'DEFERRED',
          price: priceFresh ? priceFact(lot) : {
            currency: 'USD' as const,
            primaryUsd: null,
            basis: null,
            currentBidUsd: null,
            buyNowUsd: null,
            buyNowAvailable: false,
          },
          isActive: truth.publicVisible,
          isPriceStale: truth.publicVisible && !priceFresh,
          resultPending: truth.reasonCode === 'RESULT_PENDING',
          terminal: truth.reasonCode === 'TERMINAL_RESULT',
          thumbnailUrl: lot.mediaUrls[0] ?? null,
          auctionAt: lot.auctionTime?.toISOString() ?? null,
          createdAt: f.createdAt.toISOString(),
        };
      }),
      total: favorites.length,
      asOf: new Date().toISOString(),
    };
  }

  @Post(':provider/:externalLotId')
  @ApiOperation({ summary: 'Add an auction lot to favorites' })
  @ApiResponse({ status: 201, description: 'Added to favorites' })
  async add(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
    @Param('externalLotId') externalLotId: string,
  ) {
    const lot = await this.prisma.discoveredLot.findUnique({
      where: { provider_externalLotId: { provider, externalLotId } },
    });
    if (!lot) throw new NotFoundException({ code: 'AUCTION_LOT_NOT_FOUND', message: 'Lot not found' });
    await this.prisma.auctionLotFavorite.upsert({
      where: { userId_discoveredLotId: { userId, discoveredLotId: lot.id } },
      create: { userId, discoveredLotId: lot.id },
      update: {},
    });
    return { message: 'Added to favorites' };
  }

  @Delete(':provider/:externalLotId')
  @ApiOperation({ summary: 'Remove an auction lot from favorites' })
  @ApiResponse({ status: 200, description: 'Removed from favorites' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
    @Param('externalLotId') externalLotId: string,
  ) {
    const lot = await this.prisma.discoveredLot.findUnique({
      where: { provider_externalLotId: { provider, externalLotId } },
    });
    if (!lot) return { message: 'Removed' };
    await this.prisma.auctionLotFavorite.deleteMany({
      where: { userId, discoveredLotId: lot.id },
    });
    return { message: 'Removed from favorites' };
  }
}

@ApiTags('auction')
@UseFilters(ContractErrorFilter)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
@Controller('auction')
export class AuctionImportCompatibilityController {
  constructor(private readonly auctionLotsService: AuctionLotsService) {}

  @Post('import')
  async importPersistedLot(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Deprecation', 'true');
    response.setHeader('Link', '</admin/auction/import-lot>; rel="successor-version"');
    return this.auctionLotsService.importPersistedLot(body);
  }
}
