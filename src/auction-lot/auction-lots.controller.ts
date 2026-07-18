// ─────────────────────────────────────────────────────────────
// Strong Auto — Public Auction Lots Controller (Task 036)
// Public read-only endpoints for auction lot browsing.
// No authentication required. Rate-limited via Throttler.
// ─────────────────────────────────────────────────────────────

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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

  @Get('search')
  @ApiOperation({ summary: 'Search auction lots by VIN or lot number' })
  @ApiResponse({ status: 200, description: 'Search results including terminal lots' })
  @ApiQuery({ name: 'q', required: false, description: 'VIN, lot number, or partial match' })
  async search(@Query('q') q: string) {
    return this.auctionLotsService.searchByVinOrLot(q || '');
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
    return {
      contractVersion: CONTRACT_VERSION,
      items: favorites.map(f => ({
        key: `auctionLot:${f.discoveredLot.provider}:${f.discoveredLot.externalLotId}`,
        provider: f.discoveredLot.provider,
        externalLotId: f.discoveredLot.externalLotId,
        title: f.discoveredLot.title,
        lifecycle: f.discoveredLot.lifecycleState,
        freshness: f.discoveredLot.freshnessState,
        price: priceFact(f.discoveredLot),
        thumbnailUrl: f.discoveredLot.mediaUrls[0] ?? null,
        auctionAt: f.discoveredLot.auctionTime?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
      })),
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
