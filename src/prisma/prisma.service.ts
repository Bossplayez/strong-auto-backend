import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    const rawUrl = process.env.DATABASE_URL || 'NOT SET';
    const dbHost = rawUrl.split('@')[1]?.split('/')[0] || 'unknown';
    console.log(`[PrismaService] Raw DATABASE_URL: ${rawUrl.substring(0, 50)}...`);
    console.log(`[PrismaService] Resolved host: ${dbHost}`);
    const vehicleCount = await this.vehicle.count();
    const adminUser = await this.user.findFirst({ where: { email: 'admin@strongauto.com' }, select: { id: true, userType: true } });
    console.log(`[PrismaService] Vehicle count: ${vehicleCount}, admin: ${adminUser?.userType || 'NOT FOUND'} (${adminUser?.id?.substring(0,8) || '?'})`);
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
