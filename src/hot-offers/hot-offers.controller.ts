import { Controller, Get, Put, Post, Delete, Body, Headers, Param, Query, UseGuards, UseFilters } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { HotOffersService, HotOfferPolicy } from './hot-offers.service';
import { AiLotReviewDecisionState } from '@prisma/client';
import { AiReviewDecisionDto, SubmitAiLotAnalysisDto } from './dto/ai-hot-offers.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ContractErrorFilter } from '../auction-lot/contract-error.filter';

// ── Public endpoint (no auth) ──

@ApiTags('Hot Offers')
@Controller('catalog')
export class HotOffersPublicController {
  constructor(private readonly hotOffersService: HotOffersService) {}

  @Get('hot-offers')
  @ApiOperation({ summary: 'Get public hot offers (two tiers)' })
  async getPublicHotOffers() {
    return this.hotOffersService.getPublicHotOffers();
  }
}

// ── Personal endpoint (auth required, no admin) ──

@ApiTags('Hot Offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class HotOffersPersonalController {
  constructor(private readonly hotOffersService: HotOffersService) {}

  @Get('hot-offers')
  @ApiOperation({ summary: 'Get personalized hot offers based on favorites' })
  async getPersonalHotOffers(@CurrentUser('id') userId: string) {
    return this.hotOffersService.getPersonalHotOffers(userId);
  }
}

@ApiTags('AI Hot Offers Worker')
@Controller('worker/ai-hot-offers')
export class HotOffersWorkerController {
  constructor(private readonly hotOffersService: HotOffersService) {}

  @Get('candidates')
  @ApiOperation({ summary: 'Worker: list current Buy Now lots with saved media for AI review' })
  async getCandidates(
    @Headers('x-ai-worker-token') token: string | undefined,
    @Query('limit') limit?: string,
  ) {
    this.hotOffersService.assertWorkerToken(token);
    const parsed = Number(limit);
    return this.hotOffersService.getAiReviewCandidates(Number.isFinite(parsed) ? Math.floor(parsed) : 20);
  }

  @Post('analyses')
  @ApiOperation({ summary: 'Worker: submit a bounded advisory analysis for one eligible lot' })
  async submitAnalysis(
    @Headers('x-ai-worker-token') token: string | undefined,
    @Body() dto: SubmitAiLotAnalysisDto,
  ) {
    this.hotOffersService.assertWorkerToken(token);
    return this.hotOffersService.submitAiAnalysis(dto);
  }
}

// ── Admin endpoints (ADMIN/MANAGER) ──

@ApiTags('Admin Hot Offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
@UseFilters(ContractErrorFilter)
@Controller('admin/hot-offers')
export class HotOffersAdminController {
  constructor(private readonly hotOffersService: HotOffersService) {}

  @Get()
  @ApiOperation({ summary: 'Admin: get hot offers policy, candidates, overrides' })
  async getAdmin() {
    return this.hotOffersService.getAdminHotOffers();
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Admin: list AI lot analyses and their latest review decision' })
  async listReviews(
    @Query('decision') decision?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const allowed = new Set(['PENDING', ...Object.values(AiLotReviewDecisionState)]);
    const normalized = decision && allowed.has(decision)
      ? decision as AiLotReviewDecisionState | 'PENDING'
      : undefined;
    const parsedPage = Number(page);
    const parsedPageSize = Number(pageSize);
    return this.hotOffersService.listAiReviews(
      normalized,
      Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1,
      Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? Math.min(Math.floor(parsedPageSize), 100) : 20,
    );
  }

  @Get('reviews/:analysisId')
  @ApiOperation({ summary: 'Admin: get one AI lot analysis with decision history' })
  async getReview(@Param('analysisId') analysisId: string) {
    return this.hotOffersService.getAiReviewDetail(analysisId);
  }

  @Post('reviews/:analysisId/decisions')
  @ApiOperation({ summary: 'Admin: append a review decision and update the current decision' })
  async decideReview(
    @Param('analysisId') analysisId: string,
    @Body() dto: AiReviewDecisionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.hotOffersService.decideAiReview(analysisId, dto, userId);
  }

  @Put('policy')
  @ApiOperation({ summary: 'Admin: update hot offers policy' })
  async updatePolicy(@Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    const w = (body.weights ?? {}) as Record<string, number>;
    const policy: HotOfferPolicy = {
      minYear: Number(body.minYear ?? 2010),
      maxMileageKm: body.maxMileageKm !== null && body.maxMileageKm !== undefined ? Number(body.maxMileageKm) : null,
      maxKnownPriceUsd: body.maxKnownPriceUsd !== null && body.maxKnownPriceUsd !== undefined ? Number(body.maxKnownPriceUsd) : null,
      extraDamageExclusions: Array.isArray(body.extraDamageExclusions) ? body.extraDamageExclusions : [],
      weights: {
        year: Number(w.year ?? 25),
        mileage: Number(w.mileage ?? 20),
        price: Number(w.price ?? 25),
        time: Number(w.time ?? 20),
        buyNow: Number(w.buyNow ?? 10),
      },
    };
    await this.hotOffersService.savePolicy(policy, userId);
    return { message: 'Policy updated' };
  }

  @Post('overrides')
  @ApiOperation({ summary: 'Admin: pin or exclude a lot' })
  async addOverride(
    @Body() body: { provider: string; externalLotId: string; tier: 'urgent' | 'this-week'; action: 'pin' | 'exclude'; position?: number },
    @CurrentUser('id') userId: string,
  ) {
    await this.hotOffersService.addOverride({
      provider: body.provider,
      externalLotId: body.externalLotId,
      tier: body.tier,
      action: body.action,
      position: body.action === 'pin' ? (body.position ?? 1) : null,
    }, userId);
    return { message: 'Override added' };
  }

  @Delete('overrides/:provider/:externalLotId')
  @ApiOperation({ summary: 'Admin: remove override (restore automatic)' })
  async removeOverride(
    @Param('provider') provider: string,
    @Param('externalLotId') externalLotId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.hotOffersService.removeOverride(provider, externalLotId, userId);
    return { message: 'Override removed' };
  }
}
