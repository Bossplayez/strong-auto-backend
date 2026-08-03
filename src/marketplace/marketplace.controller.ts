import {
  Controller,
  Get,
  Post,
  Patch,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MarketplaceService } from './marketplace.service';
import {
  CreateSellerProfileDto,
  UpdateSellerProfileDto,
} from './dto/create-seller-profile.dto';
import {
  CreateMarketplaceListingDto,
  UpdateMarketplaceListingDto,
} from './dto/create-marketplace-listing.dto';
import {
  CloseInquiryDto,
  CreateReviewDto,
  SellerReplyDto,
} from './dto/marketplace-inquiry-review.dto';
import { MarketplaceQueryDto } from './dto/marketplace-query.dto';

@ApiTags('Marketplace')
@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  // ---------------------------------------------------------------------------
  // Public Catalog Endpoints (Phone Masked)
  // ---------------------------------------------------------------------------

  @Get('public/listings')
  @ApiOperation({ summary: 'Get published marketplace listings (safe metadata, no phone)' })
  async getPublicListings(@Query() query: MarketplaceQueryDto) {
    return this.marketplaceService.getPublicListings(query);
  }

  @Get('public/listings/:id')
  @ApiOperation({ summary: 'Get published marketplace listing details (safe metadata, no phone)' })
  async getPublicListingById(@Param('id') id: string) {
    return this.marketplaceService.getPublicListingById(id);
  }

  @Get('public/reviews')
  @ApiOperation({ summary: 'Get approved public reviews' })
  async getPublicReviews(
    @Query('listingId') listingId?: string,
    @Query('sellerProfileId') sellerProfileId?: string,
  ) {
    return this.marketplaceService.getPublicReviews({ listingId, sellerProfileId });
  }

  // ---------------------------------------------------------------------------
  // Seller Profile
  // ---------------------------------------------------------------------------

  @Post('seller-profile')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Become a seller or register seller profile' })
  async createSellerProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSellerProfileDto,
  ) {
    return this.marketplaceService.createSellerProfile(userId, dto);
  }

  @Get('seller-profile/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user seller profile' })
  async getMySellerProfile(@CurrentUser('id') userId: string) {
    return this.marketplaceService.getSellerProfile(userId);
  }

  @Patch('seller-profile/me')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user seller profile' })
  async updateMySellerProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSellerProfileDto,
  ) {
    return this.marketplaceService.updateSellerProfile(userId, dto);
  }

  // ---------------------------------------------------------------------------
  // Seller Listing Management
  // ---------------------------------------------------------------------------

  @Post('listings')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an owned manual vehicle listing in DRAFT status' })
  async createListing(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateMarketplaceListingDto,
  ) {
    return this.marketplaceService.createListing(userId, dto);
  }

  @Get('seller/listings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get seller owned listings' })
  async getSellerListings(@CurrentUser('id') userId: string) {
    return this.marketplaceService.getSellerListings(userId);
  }

  @Patch('listings/:id')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update owned marketplace listing' })
  async updateListing(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMarketplaceListingDto,
  ) {
    return this.marketplaceService.updateListing(userId, id, dto);
  }

  @Post('listings/:id/submit')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit listing for admin moderation' })
  async submitListing(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.marketplaceService.submitListing(userId, id);
  }

  @Post('listings/:id/renew')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renew listing and reset 30-day expiry window' })
  async renewListing(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.marketplaceService.renewListing(userId, id);
  }

  @Post('listings/:id/mark-sold')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark listing as sold and close open inquiries' })
  async markSold(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.marketplaceService.markSold(userId, id);
  }

  // ---------------------------------------------------------------------------
  // Authenticated Contact / Inquiry Endpoint
  // ---------------------------------------------------------------------------

  @Post('listings/:id/contact')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reveal seller phone by creating or reopening an inquiry' })
  async revealContact(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.marketplaceService.revealContact(userId, id);
  }

  @Get('inquiries/buyer')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get buyer inquiries' })
  async getBuyerInquiries(@CurrentUser('id') userId: string) {
    return this.marketplaceService.getBuyerInquiries(userId);
  }

  @Get('inquiries/seller')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get seller received inquiries' })
  async getSellerInquiries(@CurrentUser('id') userId: string) {
    return this.marketplaceService.getSellerInquiries(userId);
  }

  @Get('seller/reviews')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reviews for the current seller only' })
  async getSellerReviews(@CurrentUser('id') userId: string) {
    return this.marketplaceService.getSellerReviews(userId);
  }

  @Patch('inquiries/:id/close')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Close inquiry as buyer or seller' })
  async closeInquiry(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CloseInquiryDto,
  ) {
    return this.marketplaceService.closeInquiry(userId, id, dto);
  }

  // ---------------------------------------------------------------------------
  // Reviews & Seller Reply
  // ---------------------------------------------------------------------------

  @Post('inquiries/:id/review')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit buyer review after a contact-revealed closed inquiry' })
  async createReview(
    @CurrentUser('id') userId: string,
    @Param('id') inquiryId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.marketplaceService.createReview(userId, inquiryId, dto);
  }

  @Post('reviews/:id/reply')
  @UseGuards(JwtAuthGuard, CookieOriginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seller one-time public reply to an approved review' })
  async replyToReview(
    @CurrentUser('id') userId: string,
    @Param('id') reviewId: string,
    @Body() dto: SellerReplyDto,
  ) {
    return this.marketplaceService.replyToReview(userId, reviewId, dto);
  }
}
