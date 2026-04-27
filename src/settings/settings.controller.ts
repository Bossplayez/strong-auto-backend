import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // No public endpoints - settings are managed internally and via admin panel.
  // The SettingsService is injected by other services that need configuration values.
}
