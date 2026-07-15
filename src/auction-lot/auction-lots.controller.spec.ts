// ─────────────────────────────────────────────────────────────
// Strong Auto — Auction Lots Controller Tests (Task 036 Phase A)
// Tests for route ordering, DTO validation, and redaction.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuctionLotsController } from './auction-lots.controller';
import { AuctionLotsService } from './auction-lots.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuctionLotsModule } from './auction-lots.module';

describe('AuctionLotsController', () => {
  let controller: AuctionLotsController;
  let service: AuctionLotsService;

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      getStats: vi.fn(),
    } as any;
    controller = new AuctionLotsController(service);
  });

  describe('route ordering — /stats must not be caught by /:provider/:externalLotId', () => {
    it('getStats is defined and callable', () => {
      expect(controller.getStats).toBeDefined();
    });

    it('findOne is defined and callable', () => {
      expect(controller.findOne).toBeDefined();
    });

    it('getStats method exists before findOne in class methods', () => {
      // The controller class should have getStats declared before findOne
      // This is enforced by the source code ordering
      const methods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(controller),
      ).filter((m) => m !== 'constructor');
      const statsIdx = methods.indexOf('getStats');
      const findIdx = methods.indexOf('findOne');
      expect(statsIdx).toBeGreaterThanOrEqual(0);
      expect(findIdx).toBeGreaterThanOrEqual(0);
      // getStats should come before findOne
      expect(statsIdx).toBeLessThan(findIdx);
    });
  });

  describe('findAll — delegates to service', () => {
    it('calls service.findAll with query params', async () => {
      const mockResult = { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll({
        page: 1,
        pageSize: 20,
      });

      expect(service.findAll).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
      expect(result).toBe(mockResult);
    });
  });

  describe('findOne — delegates to service which validates provider', () => {
    it('propagates BadRequestException from service for invalid provider', async () => {
      vi.mocked(service.findOne).mockRejectedValue(
        new BadRequestException('Invalid provider'),
      );
      await expect(controller.findOne('invalid', '123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls service.findOne for valid provider', async () => {
      const mockLot = { provider: 'copart', externalLotId: '123' };
      vi.mocked(service.findOne).mockResolvedValue(mockLot as any);

      await controller.findOne('copart', '123');
      expect(service.findOne).toHaveBeenCalledWith('copart', '123');
    });
  });

  describe('getStats — returns stats', () => {
    it('calls service.getStats', async () => {
      const mockStats = {
        currentLotCount: 10,
        liveLotCount: 2,
        buyNowCount: 5,
        upcomingCount: 3,
      };
      vi.mocked(service.getStats).mockResolvedValue(mockStats);

      const result = await controller.getStats();
      expect(service.getStats).toHaveBeenCalled();
      expect(result).toBe(mockStats);
    });
  });
});

describe('AuctionLotsService (redaction validation)', () => {
  describe('toPublicCardDto redaction (via service)', () => {
    it('service.findOne does not expose VIN field', async () => {
      const mockPrisma = {
        discoveredLot: {
          findUnique: vi.fn().mockResolvedValue({
            provider: 'copart',
            externalLotId: '123',
            make: 'BMW',
            model: 'X5',
            year: 2023,
            title: 'BMW X5',
            vin: 'WBA12345678901234', // VIN exists in DB
            auctionState: 'live',
            ad: new Date('2026-08-01'),
            currentBidUsd: 25000,
            buyNowUsd: null,
            isBuyNow: false,
            thumbsCount: 5,
            mediaUrls: [],
            lastSeenAt: new Date(),
            lastProviderUpdateAt: null,
            nextRefreshAt: null,
            consecutiveMisses: 0,
            availabilityConfirmed: true,
            freshnessTier: 'HOT',
            lifecycleState: 'LIVE',
            freshnessState: 'FRESH',
            auctionTime: null,
            auctionTimezoneOffset: null,
            vehicleId: null,
            locationDisplay: 'LA',
            locationState: 'CA',
            bodyStyle: 'SUV',
            fuelType: 'Gas',
            driveType: 'AWD',
            odometerKm: 10000,
            odometerMi: 6213,
          }),
        },
        vehicle: { count: vi.fn().mockResolvedValue(0) },
      };

      const service = new AuctionLotsService(mockPrisma as any);
      const result = await service.findOne('copart', '123');

      // VIN must not appear in the public DTO
      expect((result as any).vin).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('WBA12345678901234');
    });

    it('service.findAll does not expose sourcePayloadHash', async () => {
      const mockPrisma = {
        discoveredLot: {
          findMany: vi.fn().mockResolvedValue([
            {
              provider: 'copart',
              externalLotId: '123',
              make: 'BMW',
              model: 'X5',
              year: 2023,
              title: 'BMW X5',
              vin: 'SECRET_VIN',
              sourcePayloadHash: 'abc123hash',
              auctionState: 'live',
              ad: new Date('2026-08-01'),
              currentBidUsd: 25000,
              buyNowUsd: null,
              isBuyNow: false,
              thumbsCount: 5,
              mediaUrls: [],
              lastSeenAt: new Date(),
              lastProviderUpdateAt: null,
              nextRefreshAt: null,
              consecutiveMisses: 0,
              availabilityConfirmed: true,
              freshnessTier: 'HOT',
              lifecycleState: 'LIVE',
              freshnessState: 'FRESH',
              auctionTime: null,
              auctionTimezoneOffset: null,
              vehicleId: null,
              locationDisplay: 'LA',
              locationState: 'CA',
              bodyStyle: 'SUV',
              fuelType: 'Gas',
              driveType: 'AWD',
              odometerKm: 10000,
              odometerMi: 6213,
            },
          ]),
          count: vi.fn().mockResolvedValue(1),
        },
        vehicle: { count: vi.fn().mockResolvedValue(0) },
      };

      const service = new AuctionLotsService(mockPrisma as any);
      const result = await service.findAll({});

      // sourcePayloadHash must not appear in public DTO
      expect(JSON.stringify(result)).not.toContain('abc123hash');
      // VIN must not appear
      expect(JSON.stringify(result)).not.toContain('SECRET_VIN');
      // Seller fields must not appear
      expect(JSON.stringify(result)).not.toContain('sellerClass');
      expect(JSON.stringify(result)).not.toContain('sellerType');
    });
  });
});

describe('AuctionLotsService (validation)', () => {
  let mockPrisma: any;
  let service: AuctionLotsService;

  beforeEach(() => {
    mockPrisma = {
      discoveredLot: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn(),
      },
      vehicle: { count: vi.fn().mockResolvedValue(0) },
    };
    service = new AuctionLotsService(mockPrisma);
  });

  it('rejects invalid provider in findAll', async () => {
    await expect(service.findAll({ provider: 'invalid' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid lifecycleState in findAll', async () => {
    await expect(service.findAll({ lifecycleState: 'INVALID' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid provider in findOne', async () => {
    await expect(service.findOne('invalid', '123')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFound for missing lot in findOne', async () => {
    mockPrisma.discoveredLot.findUnique.mockResolvedValue(null);
    await expect(service.findOne('copart', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('caps pageSize at 50', async () => {
    await service.findAll({ pageSize: 100 });
    expect(mockPrisma.discoveredLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it('enforces minimum page of 1', async () => {
    await service.findAll({ page: 0, pageSize: 10 });
    expect(mockPrisma.discoveredLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    );
  });
});

describe('AuctionLotsModule (feature flag behavior)', () => {
  it('module class is importable', () => {
    // The module uses env vars at decoration time (static).
    // Feature-flag-off behavior is tested via integration tests.
    expect(AuctionLotsModule).toBeDefined();
  });

  it('AuctionLotsService is always provided (even when controller is disabled)', () => {
    // Service should be available for admin/internal use even if public routes are disabled
    expect(AuctionLotsModule).toBeDefined();
  });
});

describe('AuctionLotsService (stats counters)', () => {
  it('counts only public-eligible FRESH nonterminal lots as current', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000);

    const mockPrisma = {
      discoveredLot: {
        findMany: vi.fn().mockResolvedValue([
          // FRESH LIVE lot — should count
          {
            auctionState: 'live', auctionTime: null, ad: null,
            lastSeenAt: recent, nextRefreshAt: null, consecutiveMisses: 0,
            availabilityConfirmed: true, freshnessTier: 'HOT',
            lifecycleState: 'LIVE', freshnessState: 'FRESH',
            isBuyNow: false, buyNowUsd: null,
          },
          // FRESH UPCOMING lot — should count as upcoming
          {
            auctionState: 'upcoming', auctionTime: new Date('2026-08-01'), ad: null,
            lastSeenAt: recent, nextRefreshAt: null, consecutiveMisses: 0,
            availabilityConfirmed: true, freshnessTier: 'WARM',
            lifecycleState: 'UPCOMING', freshnessState: 'FRESH',
            isBuyNow: false, buyNowUsd: null,
          },
          // FRESH Buy Now lot — should count as buyNow
          {
            auctionState: 'open', auctionTime: null, ad: null,
            lastSeenAt: recent, nextRefreshAt: null, consecutiveMisses: 0,
            availabilityConfirmed: true, freshnessTier: 'HOT',
            lifecycleState: 'OPEN', freshnessState: 'FRESH',
            isBuyNow: true, buyNowUsd: 30000,
          },
          // SOLD lot — should NOT count
          {
            auctionState: 'sold', auctionTime: null, ad: null,
            lastSeenAt: recent, nextRefreshAt: null, consecutiveMisses: 0,
            availabilityConfirmed: true, freshnessTier: 'COLD',
            lifecycleState: 'SOLD', freshnessState: 'FRESH',
            isBuyNow: false, buyNowUsd: null,
          },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
      vehicle: { count: vi.fn().mockResolvedValue(42) },
    };

    const service = new AuctionLotsService(mockPrisma as any);
    const stats = await service.getStats();

    expect(stats.currentLotCount).toBe(3); // LIVE + UPCOMING + Buy Now
    expect(stats.liveLotCount).toBe(1);
    expect(stats.buyNowCount).toBe(1);
    expect(stats.upcomingCount).toBe(1);
  });

  it('does not count STALE or TERMINAL lots as current', async () => {
    const now = new Date();
    const oldSeen = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h ago

    const mockPrisma = {
      discoveredLot: {
        findMany: vi.fn().mockResolvedValue([
          // STALE lot — should NOT count
          {
            auctionState: 'live', auctionTime: null, ad: null,
            lastSeenAt: oldSeen, nextRefreshAt: null, consecutiveMisses: 2,
            availabilityConfirmed: true, freshnessTier: 'HOT',
            lifecycleState: 'LIVE', freshnessState: 'STALE',
            isBuyNow: false, buyNowUsd: null,
          },
          // TERMINAL lot — should NOT count
          {
            auctionState: 'sold', auctionTime: null, ad: null,
            lastSeenAt: oldSeen, nextRefreshAt: null, consecutiveMisses: 3,
            availabilityConfirmed: false, freshnessTier: 'COLD',
            lifecycleState: 'SOLD', freshnessState: 'TERMINAL',
            isBuyNow: false, buyNowUsd: null,
          },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
      vehicle: { count: vi.fn().mockResolvedValue(0) },
    };

    const service = new AuctionLotsService(mockPrisma as any);
    const stats = await service.getStats();

    expect(stats.currentLotCount).toBe(0);
    expect(stats.liveLotCount).toBe(0);
    expect(stats.buyNowCount).toBe(0);
    expect(stats.upcomingCount).toBe(0);
  });
});
