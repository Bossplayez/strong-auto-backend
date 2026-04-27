import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { VehicleFilterDto } from './dto';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

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

  @Get('filter-options')
  @ApiOperation({ summary: 'Get available filter values (makes, body types, fuel types)' })
  @ApiResponse({ status: 200, description: 'Filter options returned' })
  async getFilterOptions() {
    return this.catalogService.getFilterOptions();
  }
}
