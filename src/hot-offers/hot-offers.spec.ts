import { Test } from '@nestjs/testing';
import { HotOffersService } from './hot-offers.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

// We test policy validation, weight validation, and tier classification logic.
// These are pure functions that don't require DB interaction.

describe('HotOffersService — Policy Validation', () => {
  let service: HotOffersService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      siteSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue(null),
      },
      discoveredLot: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auctionLotFavorite: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        HotOffersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(HotOffersService);
  });

  describe('Weight validation', () => {
    it('rejects weights not summing to 100', async () => {
      prismaMock.siteSetting.findUnique.mockResolvedValue({
        valueJson: {
          minYear: 2010,
          weights: { year: 50, mileage: 50, price: 1, time: 0, buyNow: 0 }, // sum = 101
        },
      });

      await expect(service.getPolicy()).rejects.toThrow();
    });

    it('accepts weights summing to exactly 100', async () => {
      prismaMock.siteSetting.findUnique.mockResolvedValue({
        valueJson: {
          minYear: 2010,
          weights: { year: 25, mileage: 20, price: 25, time: 20, buyNow: 10 },
        },
      });

      const policy = await service.getPolicy();
      expect(policy.weights.year).toBe(25);
      expect(policy.weights.buyNow).toBe(10);
    });

    it('rejects negative weights', async () => {
      prismaMock.siteSetting.findUnique.mockResolvedValue({
        valueJson: {
          minYear: 2010,
          weights: { year: -10, mileage: 50, price: 30, time: 20, buyNow: 10 },
        },
      });

      await expect(service.getPolicy()).rejects.toThrow();
    });
  });

  describe('Policy enforcement', () => {
    it('enforces minYear >= 2010 (public quality minimum)', async () => {
      prismaMock.siteSetting.findUnique.mockResolvedValue({
        valueJson: {
          minYear: 2005, // below minimum
          weights: { year: 25, mileage: 20, price: 25, time: 20, buyNow: 10 },
        },
      });

      const policy = await service.getPolicy();
      // Should be clamped to MIN_CATALOG_YEAR
      expect(policy.minYear).toBe(2010);
    });
  });

  describe('Pin limit enforcement', () => {
    it('rejects more than 2 pins per tier', async () => {
      // First pin
      prismaMock.siteSetting.findUnique.mockResolvedValue({
        valueJson: {
          minYear: 2010,
          weights: { year: 25, mileage: 20, price: 25, time: 20, buyNow: 10 },
          overrides: [
            { provider: 'copart', externalLotId: '111', tier: 'urgent', action: 'pin', position: 1 },
            { provider: 'copart', externalLotId: '222', tier: 'urgent', action: 'pin', position: 2 },
          ],
        },
      });

      // Mock the lot validation - make it pass
      prismaMock.discoveredLot.findUnique.mockResolvedValue({
        provider: 'iaai',
        externalLotId: '333',
        title: '2020 HONDA CIVIC',
        make: 'HONDA',
        model: 'CIVIC',
        year: 2020,
        bodyStyle: 'SEDAN',
        lifecycleState: 'UPCOMING',
        freshnessState: 'FRESH',
        availabilityConfirmed: true,
        consecutiveMisses: 0,
        auctionTime: new Date(Date.now() + 5 * 60 * 60 * 1000),
        currentBidUsd: 5000,
        buyNowUsd: null,
        isBuyNow: false,
        primaryDamage: 'Front end',
        secondaryDamage: null,
        loss: null,
        saleDocumentName: 'CERT OF TITLE',
        saleDocumentType: null,
        mediaUrls: [],
      });

      await expect(
        service.addOverride({ provider: 'iaai', externalLotId: '333', tier: 'urgent', action: 'pin', position: 1 }, 'user1'),
      ).rejects.toThrow();
    });
  });

  describe('Immediate invalidation on terminal lot', () => {
    it('stillEligible returns false for terminal lifecycle', () => {
      // Access private method via any cast
      const s = service as any;
      expect(s.stillEligible({
        lifecycle: 'SOLD',
        auctionAt: new Date(Date.now() + 5000).toISOString(),
        currentBidUsd: 100,
        buyNowUsd: null,
        qualityInclude: true,
      }, 'urgent', new Date())).toBe(false);
    });

    it('stillEligible returns false for no price', () => {
      const s = service as any;
      expect(s.stillEligible({
        lifecycle: 'UPCOMING',
        auctionAt: new Date(Date.now() + 5000).toISOString(),
        currentBidUsd: 0,
        buyNowUsd: 0,
        qualityInclude: true,
      }, 'urgent', new Date())).toBe(false);
    });

    it('stillEligible returns false for quality-failed', () => {
      const s = service as any;
      expect(s.stillEligible({
        lifecycle: 'UPCOMING',
        auctionAt: new Date(Date.now() + 5000).toISOString(),
        currentBidUsd: 100,
        buyNowUsd: null,
        qualityInclude: false,
      }, 'urgent', new Date())).toBe(false);
    });

    it('stillEligible returns false when auction moved beyond tier window', () => {
      const s = service as any;
      // 3 days from now — should be in this-week, not urgent
      expect(s.stillEligible({
        lifecycle: 'UPCOMING',
        auctionAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        currentBidUsd: 100,
        buyNowUsd: null,
        qualityInclude: true,
      }, 'urgent', new Date())).toBe(false);
    });
  });
});
