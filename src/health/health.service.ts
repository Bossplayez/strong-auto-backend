import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkLiveness(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async checkReadiness(): Promise<{
    status: string;
    timestamp: string;
    checks: { database: string };
  }> {
    // TODO: Check database connectivity
    // TODO: Check Redis connectivity if applicable
    // TODO: Check external service availability (Copart API, email service)
    let databaseStatus = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseStatus = 'unavailable';
    }

    const overallStatus = databaseStatus === 'ok' ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseStatus,
      },
    };
  }
}
