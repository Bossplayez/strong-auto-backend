import { Controller, Get, Post, Param, Query, Body, UseFilters, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { VehicleFilterDto } from './dto';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ContractErrorFilter } from '../auction-lot/contract-error.filter';

@ApiTags('Catalog')
@UseFilters(ContractErrorFilter)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('inventory')
  async inventory(@Query() query: Record<string, unknown>): Promise<any> {
    return this.catalogService.inventory(query);
  }

  @Get('filter-options')
  async inventoryFilterOptions(@Query() query: Record<string, unknown>): Promise<any> {
    if (query.view === undefined) {
      return this.catalogService.getFilterOptions();
    }
    return this.catalogService.inventoryFilterOptions(query);
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'List vehicles with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated list of vehicles' })
  async findAll(
    @Query() filters: VehicleFilterDto,
  ): Promise<PaginatedResponseDto<any>> {
    return this.catalogService.findAll(filters);
  }

  @Get('vehicles/:slug')
  @ApiOperation({ summary: 'Get a single vehicle by its URL slug' })
  @ApiResponse({ status: 200, description: 'Vehicle details' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async findBySlug(@Param('slug') slug: string): Promise<any> {
    return this.catalogService.findBySlug(slug);
  }

  @Get('vehicle-filter-options')
  @ApiOperation({ summary: 'Get available filter values (makes, body types, fuel types)' })
  @ApiResponse({ status: 200, description: 'Filter options returned' })
  async getFilterOptions() {
    return this.catalogService.getFilterOptions();
  }

  // ── Auction Bids ──────────────────────────────────────────────

  @Get('vehicles/:id/bids')
  @ApiOperation({ summary: 'Get bid history for a vehicle' })
  async getVehicleBids(@Param('id') vehicleId: string) {
    return this.catalogService.getVehicleBids(vehicleId);
  }

  @Post('vehicles/:id/bid')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Place a bid on an auction vehicle' })
  @ApiResponse({ status: 201, description: 'Bid placed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid bid amount' })
  async placeBid(
    @Param('id') vehicleId: string,
    @Body() body: { amount: number; maxAmount?: number },
    @Req() req: any,
  ) {
    return this.catalogService.placeBid(vehicleId, req.user.id, body.amount, body.maxAmount);
  }
}
