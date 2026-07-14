// ─────────────────────────────────────────────────────────────
// Strong Auto — Public Auction Lots Controller (Task 036)
// Public read-only endpoints for auction lot browsing.
// No authentication required. Rate-limited via Throttler.
// ─────────────────────────────────────────────────────────────

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuctionLotsService } from './auction-lots.service';
import type {
  PublicAuctionLotListResponse,
  PublicAuctionLotDetailDto,
  PublicAuctionLotStatsDto,
  PublicAuctionLotQueryDto,
} from './dto/public-auction-lot.dto';

@ApiTags('auction-lots')
@Controller('auction-lots')
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class AuctionLotsController {
  constructor(private readonly auctionLotsService: AuctionLotsService) {}

  @Get()
  @ApiOperation({ summary: 'List public auction lots' })
  @ApiResponse({ status: 200, description: 'Paginated auction lot list' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'make', required: false })
  @ApiQuery({ name: 'model', required: false })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'lifecycleState', required: false })
  @ApiQuery({ name: 'buyNow', required: false, type: Boolean })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  async findAll(
    @Query() query: PublicAuctionLotQueryDto,
  ): Promise<PublicAuctionLotListResponse> {
    return this.auctionLotsService.findAll(query);
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
  ): Promise<PublicAuctionLotDetailDto> {
    return this.auctionLotsService.findOne(provider, externalLotId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get public auction lot stats' })
  @ApiResponse({ status: 200, description: 'Auction lot statistics' })
  async getStats(): Promise<PublicAuctionLotStatsDto> {
    return this.auctionLotsService.getStats();
  }
}
