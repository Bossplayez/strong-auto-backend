import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Diagnostic
    const adminUser = await this.user.findFirst({ where: { email: 'admin@strongauto.com' }, select: { userType: true } });
    const vehicleCount = await this.vehicle.count();
    console.log(`[PrismaService] DB connected, admin: ${adminUser?.userType}, vehicles: ${vehicleCount}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
