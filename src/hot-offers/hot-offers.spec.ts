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

  describe('Snapshot TTL contract (Task 048A)', () => {
    it('validUntil - generatedAt === exactly 30 minutes', async () => {
      // Mock: no existing snapshot, no candidates → empty tiers
      prismaMock.siteSetting.findUnique.mockResolvedValue(null);
      prismaMock.discoveredLot.findMany.mockResolvedValue([]);

      const result = await service.getPublicHotOffers();

      const gen = new Date(result.generatedAt).getTime();
      const valid = new Date(result.validUntil).getTime();
      const diffMin = (valid - gen) / (60 * 1000);

      expect(diffMin).toBeCloseTo(30, 1);
    });

    it('does NOT extend validUntil on read when snapshot is fresh', async () => {
      const t0 = '2026-07-20T10:00:00.000Z';
      const t0Plus30 = '2026-07-20T10:30:00.000Z';

      // Simulate a snapshot that was generated at 10:00 and expires at 10:30
      const mockSnapshot = {
        generatedAt: t0,
        validUntil: t0Plus30,
        tiers: {
          urgent: { tier: 'urgent', labelUk: 'Термінові', labelEn: 'Urgent', windowStart: t0, windowEnd: t0Plus30, items: [] },
          'this-week': { tier: 'this-week', labelUk: 'Тиждень', labelEn: 'Week', windowStart: t0, windowEnd: t0Plus30, items: [] },
        },
      };

      // First call returns existing snapshot (fresh)
      prismaMock.siteSetting.findUnique.mockResolvedValue({ valueJson: mockSnapshot });
      prismaMock.discoveredLot.findMany.mockResolvedValue([]);

      // Mock Date.now to be t0 + 5 minutes (snapshot still fresh)
      const realDate = Date;
      const fakeNow = new Date('2026-07-20T10:05:00.000Z');
      const originalNow = realDate.now;
      realDate.now = () => fakeNow.getTime();
      jest.useFakeTimers({ now: fakeNow });

      try {
        const result = await service.getPublicHotOffers();

        // Should return the SAME generatedAt and validUntil from snapshot
        expect(result.generatedAt).toBe(t0);
        expect(result.validUntil).toBe(t0Plus30);

        // Should NOT have written a new snapshot (no upsert needed)
        expect(prismaMock.siteSetting.upsert).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
        realDate.now = originalNow;
      }
    });

    it('creates new snapshot after TTL expiry', async () => {
      const t0 = '2026-07-20T10:00:00.000Z';
      const t0Plus30 = '2026-07-20T10:30:00.000Z';

      const mockSnapshot = {
        generatedAt: t0,
        validUntil: t0Plus30,
        tiers: {
          urgent: { tier: 'urgent', labelUk: 'Термінові', labelEn: 'Urgent', windowStart: t0, windowEnd: t0Plus30, items: [] },
          'this-week': { tier: 'this-week', labelUk: 'Тиждень', labelEn: 'Week', windowStart: t0, windowEnd: t0Plus30, items: [] },
        },
      };

      prismaMock.siteSetting.findUnique.mockResolvedValue({ valueJson: mockSnapshot });
      prismaMock.discoveredLot.findMany.mockResolvedValue([]);

      // Mock Date to be t0 + 31 minutes (snapshot expired)
      const realDate = Date;
      const fakeNow = new Date('2026-07-20T10:31:00.000Z');
      const originalNow = realDate.now;
      realDate.now = () => fakeNow.getTime();
      jest.useFakeTimers({ now: fakeNow });

      try {
        const result = await service.getPublicHotOffers();

        // Should have NEW timestamps (not the old ones)
        expect(result.generatedAt).not.toBe(t0);
        expect(result.validUntil).not.toBe(t0Plus30);

        // New diff should be 30 min
        const gen = new Date(result.generatedAt).getTime();
        const valid = new Date(result.validUntil).getTime();
        const diffMin = (valid - gen) / (60 * 1000);
        expect(diffMin).toBeCloseTo(30, 1);

        // Should have saved a new snapshot
        expect(prismaMock.siteSetting.upsert).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
        realDate.now = originalNow;
      }
    });

    it('policy invalidation creates new timestamps on next read', async () => {
      // After savePolicy deletes snapshot, next read should create fresh one
      prismaMock.siteSetting.findUnique
        .mockResolvedValueOnce({ valueJson: { minYear: 2010, weights: { year: 25, mileage: 20, price: 25, time: 20, buyNow: 10 } } }) // getPolicy in savePolicy
        .mockResolvedValue(null); // snapshot gone after invalidation
      prismaMock.discoveredLot.findMany.mockResolvedValue([]);

      await service.savePolicy({
        minYear: 2012,
        maxMileageKm: null,
        maxKnownPriceUsd: null,
        extraDamageExclusions: [],
        weights: { year: 30, mileage: 20, price: 20, time: 20, buyNow: 10 },
      }, 'user1');

      // Verify snapshot was deleted
      expect(prismaMock.siteSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'hot_offers_snapshot_v1' } });

      // Next public read should create new snapshot
      const result = await service.getPublicHotOffers();
      const gen = new Date(result.generatedAt).getTime();
      const valid = new Date(result.validUntil).getTime();
      const diffMin = (valid - gen) / (60 * 1000);
      expect(diffMin).toBeCloseTo(30, 1);
    });
  });
});
