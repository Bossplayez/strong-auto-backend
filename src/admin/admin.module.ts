import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { LeadsModule } from '../leads/leads.module';
import { CopartModule } from '../copart/copart.module';
import { BroadcastsModule } from '../broadcasts/broadcasts.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuctionLotsModule } from '../auction-lot/auction-lots.module';

@Module({
  imports: [
    VehiclesModule,
    LeadsModule,
    CopartModule,
    BroadcastsModule,
    AuditModule,
    PrismaModule,
    AuctionLotsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
