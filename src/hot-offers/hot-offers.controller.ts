import { Controller, Get, Put, Post, Delete, Body, Param, UseGuards, UseFilters, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { HotOffersService, HotOfferPolicy } from './hot-offers.service';
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
