import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CopartService } from './copart.service';

@ApiTags('Auction Import')
@Controller('auction')
export class CopartController {
  constructor(private readonly copartService: CopartService) {}

  @Post('sync/copart')
  @ApiOperation({ summary: 'Trigger Copart import sync' })
  @ApiResponse({ status: 200, description: 'Import job started' })
  async syncCopart() {
    return this.copartService.syncByPlatform('copart');
  }

  @Post('sync/iaai')
  @ApiOperation({ summary: 'Trigger IAAI import sync' })
  @ApiResponse({ status: 200, description: 'Import job started' })
  async syncIaai() {
    return this.copartService.syncByPlatform('iaai');
  }

  @Post('sync')
  @ApiOperation({ summary: 'Trigger both Copart and IAAI sync' })
  @ApiResponse({ status: 200, description: 'Import jobs started' })
  async syncAll() {
    const [copart, iaai] = await Promise.all([
      this.copartService.syncByPlatform('copart'),
      this.copartService.syncByPlatform('iaai'),
    ]);
    return { copart, iaai };
  }
}
