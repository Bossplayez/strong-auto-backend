import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaClient } from '@prisma/client';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('debug/db')
  async debugDb() {
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.findFirst({
        where: { email: 'admin@strongauto.com' },
        select: { id: true, email: true, userType: true, status: true },
      });
      const vehicleCount = await prisma.vehicle.count();
      return {
        databaseUrl: process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown',
        vehicleCount,
        adminUser: user,
      };
    } finally {
      await prisma.$disconnect();
    }
  }
}
