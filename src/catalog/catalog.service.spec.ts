import { CatalogService } from './catalog.service';

describe('CatalogService unified inventory identity projection', () => {
  const prisma = {
    discoveredLot: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    vehicle: { findMany: jest.fn() },
  };
  const service = new CatalogService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('projects a published imported identity once in view=all', async () => {
    prisma.discoveredLot.findMany.mockResolvedValue([lot({ vehicleId: 'vehicle-1' })]);
    prisma.vehicle.findMany.mockResolvedValue([vehicle()]);

    const result = await service.inventory({ view: 'all' });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'vehicle', vehicleId: 'vehicle-1' });
  });

  it('keeps the current auction projection in view=usa', async () => {
    // Mock returns lots filtered by provider for interleave
    prisma.discoveredLot.findMany.mockImplementation((args?: any) => {
      const provider = args?.where?.provider;
      const allLots = [lot({ vehicleId: 'vehicle-1', provider: 'copart' })];
      return Promise.resolve(allLots.filter(l => !provider || l.provider === provider));
    });
    prisma.discoveredLot.count.mockResolvedValue(1);

    const result = await service.inventory({ view: 'usa' });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'auctionLot', importedVehicleId: 'vehicle-1' });
  });

  it('uses the same identity projection for faceted filter counts', async () => {
    prisma.discoveredLot.findMany.mockResolvedValue([lot({ vehicleId: 'vehicle-1' })]);
    prisma.vehicle.findMany.mockResolvedValue([vehicle()]);

    const result = await service.inventoryFilterOptions({ view: 'all' });

    expect(result.options.makes).toEqual([{ value: 'Ford', label: 'Ford', count: 1 }]);
    expect(result.options.sources).toEqual([{ value: 'internal', label: 'internal', count: 1 }]);
  });
});

function lot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lot-row',
    provider: 'copart',
    externalLotId: 'lot-1',
    state: 'DISCOVERED',
    title: '2020 Ford Escape',
    make: 'Ford',
    model: 'Escape',
    year: 2020,
    lifecycleState: 'OPEN',
    freshnessState: 'FRESH',
    availabilityConfirmed: true,
    consecutiveMisses: 0,
    freshnessTier: 'COLD',
    vehicleId: null,
    odometerKm: 100000,
    odometerMi: null,
    bodyStyle: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    locationState: 'CA',
    auctionTime: new Date('2026-07-20T15:00:00.000Z'),
    auctionTimezoneOffset: 0,
    mediaUrls: ['https://images.example/lot.jpg'],
    isBuyNow: false,
    currentBidUsd: 5000,
    buyNowUsd: null,
    firstSeenAt: new Date('2026-07-16T00:00:00.000Z'),
    ...overrides,
  };
}

function vehicle() {
  return {
    id: 'vehicle-1',
    slug: '2020-ford-escape',
    title: '2020 Ford Escape',
    make: 'Ford',
    model: 'Escape',
    year: 2020,
    priceAmount: 9000,
    currency: 'USD',
    odometerValue: 100000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    sourceType: 'INTERNAL',
    sourceRegion: 'USA',
    availabilityStatus: 'AVAILABLE',
    publicationStatus: 'PUBLISHED',
    isRecommended: true,
    publishedAt: new Date('2026-07-16T00:00:00.000Z'),
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    updatedAt: new Date('2026-07-16T00:00:00.000Z'),
    media: [{ sourceUrl: 'https://images.example/vehicle.jpg' }],
  };
}
