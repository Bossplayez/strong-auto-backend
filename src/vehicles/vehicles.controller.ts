import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';

@ApiTags('Vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  // No public endpoints - vehicle management is handled through:
  // - CatalogController (public read access)
  // - AdminController (admin CRUD operations)
}
