import { Module } from '@nestjs/common';
import { CopartController } from './copart.controller';
import { CopartService } from './copart.service';
import { VehiclesModule } from '../vehicles/vehicles.module';

@Module({
  imports: [VehiclesModule],
  controllers: [CopartController],
  providers: [CopartService],
  exports: [CopartService],
})
export class CopartModule {}
