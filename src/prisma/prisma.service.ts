import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    const dbHost = process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown';
    console.log(`[PrismaService] DATABASE_URL host: ${dbHost}`);
    console.log(`[PrismaService] Full URL starts with: ${process.env.DATABASE_URL?.substring(0, 30)}...`);
    const vehicleCount = await this.vehicle.count();
    const adminUser = await this.user.findFirst({ where: { email: 'admin@strongauto.com' }, select: { id: true, userType: true } });
    console.log(`[PrismaService] Vehicle count: ${vehicleCount}, admin: ${adminUser?.userType || 'NOT FOUND'} (${adminUser?.id?.substring(0,8) || '?'})`);
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
