import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SavedCalculationsService } from './saved-calculations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto, PaginatedResponseDto } from '../common/dto/pagination.dto';

@ApiTags('Saved Calculations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/calculations')
export class SavedCalculationsController {
  constructor(
    private readonly savedCalculationsService: SavedCalculationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get current user saved calculations' })
  @ApiResponse({ status: 200, description: 'Paginated list of saved calculations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<any>> {
    return this.savedCalculationsService.findAllByUser(
      userId,
      query.page,
      query.pageSize,
    );
  }

  @Post(':estimateId/save')
  @ApiOperation({ summary: 'Save a calculator estimate for later reference' })
  @ApiResponse({ status: 201, description: 'Calculation saved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Estimate not found' })
  @ApiResponse({ status: 409, description: 'Calculation already saved' })
  async save(
    @CurrentUser('id') userId: string,
    @Param('estimateId') estimateId: string,
  ): Promise<{ message: string }> {
    return this.savedCalculationsService.save(userId, estimateId);
  }
}
