import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BroadcastsService } from './broadcasts.service';

@ApiTags('Broadcasts')
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcastsService: BroadcastsService) {}

  // No public endpoints - broadcast management is handled via AdminController.
}
