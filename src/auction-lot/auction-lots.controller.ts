// ─────────────────────────────────────────────────────────────
// Strong Auto — Public Auction Lots Controller (Task 036)
// Public read-only endpoints for auction lot browsing.
// No authentication required. Rate-limited via Throttler.
// ─────────────────────────────────────────────────────────────

import {
  Body,
  Controller,
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
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuctionLotsService } from './auction-lots.service';
import { ContractErrorFilter } from './contract-error.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('auction-lots')
@UseFilters(ContractErrorFilter)
@Controller('auction-lots')
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class AuctionLotsController {
  constructor(private readonly auctionLotsService: AuctionLotsService) {}

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

  // IMPORTANT: /stats must be declared BEFORE /:provider/:externalLotId
  // otherwise NestJS will match 'stats' as the :provider param.
  @Get('stats')
  @ApiOperation({ summary: 'Get public auction lot stats' })
  @ApiResponse({ status: 200, description: 'Auction lot statistics' })
  async getStats() {
    return this.auctionLotsService.getStats();
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
