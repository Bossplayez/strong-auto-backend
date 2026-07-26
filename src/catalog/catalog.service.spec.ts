import { CatalogService } from './catalog.service';

describe('CatalogService unified inventory identity projection', () => {
  const prisma = {
    discoveredLot: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    vehicle: { findMany: jest.fn(), findUnique: jest.fn() },
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

  it('keeps unfiltered USA pagination populated after the second page', async () => {
    prisma.discoveredLot.findMany.mockImplementation((args?: any) => {
      const provider = args?.where?.provider;
      const lots = Array.from({ length: 30 }, (_, index) => lot({
        provider: index % 2 === 0 ? 'copart' : 'iaai',
        externalLotId: `lot-${index}`,
      }));
      return Promise.resolve(lots.filter((entry) => !provider || entry.provider === provider));
    });
    prisma.discoveredLot.count.mockResolvedValue(60);

    const result = await service.inventory({ view: 'usa', page: 3, pageSize: 10 });

    expect(result.items).toHaveLength(10);
    expect(prisma.discoveredLot.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 30 }));
  });

  it('rejects an unbounded catalog page before loading provider prefixes', async () => {
    await expect(
      service.inventory({ view: 'usa', page: 101, pageSize: 50 }),
    ).rejects.toThrow();
    expect(prisma.discoveredLot.findMany).not.toHaveBeenCalled();
  });

  it('routes provider auction bids into assistance instead of creating a local bid', async () => {
    prisma.vehicle.findUnique.mockResolvedValue({
      id: 'vehicle-1',
      sourceType: 'COPART',
      priceAmount: 1000,
      availabilityStatus: 'AVAILABLE',
    });

    await expect(service.placeBid('vehicle-1', 'user-1', 1100)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACTION_REQUIRES_ASSISTANCE' }),
    });
  });

  it('derives a missing state facet from the provider location label', async () => {
    prisma.discoveredLot.findMany.mockResolvedValue([
      lot({
        locationState: null,
        locationDisplay: 'West Palm Beach (FL)',
      }),
    ]);

    const result = await service.inventoryFilterOptions({ view: 'usa' });

    expect(result.options.locationStates).toEqual([
      { value: 'FL', label: 'FL', count: 1 },
    ]);
  });

  it('collapses repeated whitespace in provider taxonomy facets', async () => {
    prisma.discoveredLot.findMany.mockResolvedValue([
      lot({ bodyStyle: 'Sport  Utility' }),
      lot({ externalLotId: 'lot-2', bodyStyle: 'Sport Utility' }),
    ]);

    const result = await service.inventoryFilterOptions({ view: 'usa' });

    expect(result.options.bodyTypes).toEqual([
      { value: 'Sport Utility', label: 'Sport Utility', count: 2 },
    ]);
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
