import { Module } from '@nestjs/common';
import { SavedCalculationsController } from './saved-calculations.controller';
import { SavedCalculationsService } from './saved-calculations.service';

@Module({
  controllers: [SavedCalculationsController],
  providers: [SavedCalculationsService],
  exports: [SavedCalculationsService],
})
export class SavedCalculationsModule {}
