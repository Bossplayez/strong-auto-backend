import { Module } from '@nestjs/common';
import { CopartController } from './copart.controller';
import { CopartService } from './copart.service';
import { ProviderLeaseService } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [VehiclesModule, PrismaModule],
  controllers: [CopartController],
  providers: [CopartService, ProviderLeaseService, RequestBudgetService],
  exports: [CopartService, ProviderLeaseService, RequestBudgetService],
})
export class CopartModule {}
