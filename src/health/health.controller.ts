import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe - check if the service is running' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  async live(): Promise<{ status: string; timestamp: string }> {
    return this.healthService.checkLiveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - check if the service is ready to accept traffic' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  async ready(): Promise<{
    status: string;
    timestamp: string;
    checks: { database: string };
  }> {
    return this.healthService.checkReadiness();
  }
}
