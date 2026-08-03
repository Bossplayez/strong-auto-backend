import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CookieOriginGuard } from '../common/guards/cookie-origin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MarketplaceService } from './marketplace.service';
import { RejectListingDto } from './dto/create-marketplace-listing.dto';
import { ModerateReviewDto } from './dto/marketplace-inquiry-review.dto';

@ApiTags('Admin Marketplace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('admin/marketplace')
export class AdminMarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('listings')
  @ApiOperation({ summary: 'Admin list marketplace listings with status filter' })
  async getListings(@Query('status') status?: string) {
    return this.marketplaceService.getAdminListings(status);
  }

  @Post('listings/:id/approve')
  @UseGuards(CookieOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin approve submitted listing' })
  async approveListing(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.marketplaceService.approveListing(adminUserId, id);
  }

  @Post('listings/:id/reject')
  @UseGuards(CookieOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin reject submitted listing with moderation comment' })
  async rejectListing(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: RejectListingDto,
  ) {
    return this.marketplaceService.rejectListing(
      adminUserId,
      id,
      dto.moderationComment,
    );
  }

  @Get('inquiries')
  @ApiOperation({ summary: 'Admin read view for all inquiries' })
  async getInquiries() {
    return this.marketplaceService.getAdminInquiries();
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Admin read view for all reviews' })
  async getReviews() {
    return this.marketplaceService.getAdminReviews();
  }

  @Post('reviews/:id/moderate')
  @UseGuards(CookieOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin moderate review (approve or reject)' })
  async moderateReview(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.marketplaceService.moderateReview(adminUserId, id, dto);
  }

  @Post('reconcile-expiry')
  @UseGuards(CookieOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger 30-day listing expiry reconciliation' })
  async reconcileExpiry() {
    return this.marketplaceService.reconcileExpiredListings();
  }
}
