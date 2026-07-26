import { Module } from '@nestjs/common';
import { HotOffersService } from './hot-offers.service';
import { HotOffersPublicController, HotOffersPersonalController, HotOffersAdminController, HotOffersWorkerController } from './hot-offers.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HotOffersPublicController, HotOffersPersonalController, HotOffersAdminController, HotOffersWorkerController],
  providers: [HotOffersService],
  exports: [HotOffersService],
})
export class HotOffersModule {}
