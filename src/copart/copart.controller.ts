import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CopartService } from './copart.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Auction Import')
@Controller('auction')
@Throttle({ auction: { ttl: 60_000, limit: 30 } })
export class CopartController {
  constructor(private readonly copartService: CopartService) {}

  // =====================
  // Search (admin)
  // =====================

  @Get('search')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Search vehicles on Copart/IAAI via RapidAPI' })
  @ApiResponse({ status: 200, description: 'Search results' })
  async search(@Query() query: Record<string, string>) {
    return this.copartService.search({
      platform: (query.platform as 'copart' | 'iaai') ?? 'copart',
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      make: query.make,
      model: query.model,
      year_from: query.year_from ? Number(query.year_from) : undefined,
      year_to: query.year_to ? Number(query.year_to) : undefined,
      search: query.search,
    });
  }

  // =====================
  // Import single lot (admin)
  // =====================

  @Post('import')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Import a single vehicle by lot number' })
  @ApiResponse({ status: 200, description: 'Import result' })
  async importSingle(@Body() body: { lotNumber: string; platform?: 'copart' | 'iaai' }) {
    return this.copartService.importSingle(
      body.lotNumber,
      body.platform ?? 'copart',
    );
  }

  // =====================
  // Bulk sync (existing)
  // =====================

  @Post('sync/copart')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Trigger Copart import sync (admin)' })
  @ApiResponse({ status: 200, description: 'Import job started' })
  async syncCopart() {
    return this.copartService.syncByPlatform('copart');
  }

  @Post('sync/iaai')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Trigger IAAI import sync (admin)' })
  @ApiResponse({ status: 200, description: 'Import job started' })
  async syncIaai() {
    return this.copartService.syncByPlatform('iaai');
  }

  @Post('sync')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Trigger both Copart and IAAI sync (admin)' })
  @ApiResponse({ status: 200, description: 'Import jobs started' })
  async syncAll() {
    const [copart, iaai] = await Promise.all([
      this.copartService.syncByPlatform('copart'),
      this.copartService.syncByPlatform('iaai'),
    ]);
    return { copart, iaai };
  }
}
