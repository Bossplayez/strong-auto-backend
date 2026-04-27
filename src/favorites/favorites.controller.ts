import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto, PaginatedResponseDto } from '../common/dto/pagination.dto';

@ApiTags('Favorites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user favorite vehicles' })
  @ApiResponse({ status: 200, description: 'Paginated list of favorite vehicles' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<any>> {
    return this.favoritesService.findAllByUser(userId, query.page, query.pageSize);
  }

  @Post(':vehicleId')
  @ApiOperation({ summary: 'Add a vehicle to favorites' })
  @ApiResponse({ status: 201, description: 'Vehicle added to favorites' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  @ApiResponse({ status: 409, description: 'Vehicle already in favorites' })
  async add(
    @CurrentUser('id') userId: string,
    @Param('vehicleId') vehicleId: string,
  ): Promise<{ message: string }> {
    return this.favoritesService.add(userId, vehicleId);
  }

  @Delete(':vehicleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a vehicle from favorites' })
  @ApiResponse({ status: 200, description: 'Vehicle removed from favorites' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Favorite not found' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('vehicleId') vehicleId: string,
  ): Promise<{ message: string }> {
    return this.favoritesService.remove(userId, vehicleId);
  }
}
