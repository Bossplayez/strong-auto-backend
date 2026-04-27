import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CopartService } from './copart.service';

@ApiTags('Copart')
@Controller('copart')
export class CopartController {
  constructor(private readonly copartService: CopartService) {}

  // No public endpoints - Copart operations are triggered via:
  // - Cron scheduler (automatic sync)
  // - AdminController POST /admin/copart/import/run (manual trigger)
}
