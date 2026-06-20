import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { R2Service } from './r2.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, R2Service],
  exports: [FilesService, R2Service],
})
export class FilesModule {}
