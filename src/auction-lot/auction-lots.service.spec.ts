import { AuctionLotsService } from './auction-lots.service';

describe('AuctionLotsService unified catalog invariants', () => {
  const transaction = {
    discoveredLot: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    vehicle: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    vehicleSourceBinding: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) => operation(transaction)),
    discoveredLot: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    vehicle: {
      findMany: jest.fn(),
    },
  };
  const service = new AuctionLotsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns disjoint exhaustive admin metric partitions', async () => {
    transaction.discoveredLot.findMany.mockResolvedValue([
      lot({ provider: 'copart', lifecycleState: 'OPEN', freshnessState: 'FRESH', availabilityConfirmed: true }),
      lot({ provider: 'copart', lifecycleState: 'OPEN', freshnessState: 'STALE', availabilityConfirmed: true }),
      lot({ provider: 'iaai', lifecycleState: 'ENDED', freshnessState: 'STALE', availabilityConfirmed: false, state: 'UNAVAILABLE' }),
      lot({ provider: 'iaai', lifecycleState: 'NOT_READY', freshnessState: 'FRESH', availabilityConfirmed: true }),
    ]);
    transaction.vehicle.findMany.mockResolvedValue([]);

    const result = await service.adminMetrics();

    expect(result).toMatchObject({
      totalExternal: 4,
      currentExternal: 1,
      staleExternal: 1,
      endedExternal: 1,
      unclassifiedExternal: 1,
      byProvider: {
        copart: { totalExternal: 2, currentExternal: 1, staleExternal: 1, endedExternal: 0, unclassifiedExternal: 0 },
        iaai: { totalExternal: 2, currentExternal: 0, staleExternal: 0, endedExternal: 1, unclassifiedExternal: 1 },
      },
    });
    expect(result.currentExternal + result.staleExternal + result.endedExternal + result.unclassifiedExternal).toBe(result.totalExternal);
  });

  it('imports one persisted lot atomically as a media-rich DRAFT vehicle', async () => {
    const persisted = lot({
      externalLotId: 'lot-9',
      title: '2020 Ford Escape',
      make: 'Ford',
      model: 'Escape',
      mediaUrls: ['https://images.example/1.jpg', 'https://images.example/2.jpg'],
      auctionTime: new Date('2026-07-20T15:00:00.000Z'),
      currentBidUsd: 5400,
      buyNowUsd: 8100,
      isBuyNow: true,
    });
    transaction.discoveredLot.findUnique.mockResolvedValue(persisted);
    transaction.vehicleSourceBinding.findUnique.mockResolvedValue(null);
    transaction.vehicle.create.mockResolvedValue({ id: 'veh-9', slug: '2020-ford-escape-copart-lot-9', publicationStatus: 'DRAFT' });
    transaction.discoveredLot.update.mockResolvedValue({});

    const result = await service.importPersistedLot({ lotNumber: 'lot-9', platform: 'copart', confirm: true });

    expect(result).toMatchObject({ result: 'created', vehicle: { vehicleId: 'veh-9', publicationStatus: 'DRAFT' } });
    expect(transaction.vehicle.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      publicationStatus: 'DRAFT',
      priceAmount: 8100,
      specs: { create: expect.objectContaining({ lotNumber: 'lot-9', currentBid: 5400 }) },
      media: { create: [
        { sourceUrl: 'https://images.example/1.jpg', sortOrder: 0, isPrimary: true },
        { sourceUrl: 'https://images.example/2.jpg', sortOrder: 1, isPrimary: false },
      ] },
      sourceBindings: { create: expect.objectContaining({
        provider: 'copart',
        externalLotId: 'lot-9',
        externalUrl: null,
        currentBidAmount: 5400,
        buyNowAmount: 8100,
      }) },
    }) }));
    expect(transaction.discoveredLot.update).toHaveBeenCalledWith({ where: { id: persisted.id }, data: { state: 'IMPORTED', vehicleId: 'veh-9' } });
  });

  it('returns the exact admin list contract without public-only or detail-only fields', async () => {
    prisma.discoveredLot.findMany.mockResolvedValue([lot()]);
    prisma.vehicle.findMany.mockResolvedValue([]);

    const result = await service.listAdminLots({});

    expect(result.items).toHaveLength(1);
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'auctionAt', 'availabilityConfirmedAt', 'consecutiveMisses', 'externalLotId',
      'firstDiscoveredAt', 'freshness', 'importState', 'key', 'lastObservedAt',
      'lifecycle', 'linkedVehicle', 'locationState', 'make', 'mediaCount', 'model',
      'odometerKm', 'price', 'provider', 'providerTimezoneOffset', 'state',
      'thumbnailUrl', 'tier', 'title', 'updatedAt', 'year',
    ].sort());
    expect(result.items[0]).not.toHaveProperty('kind');
    expect(result.items[0]).not.toHaveProperty('source');
    expect(result.items[0]).not.toHaveProperty('importedVehicleId');
    expect(result.items[0]).not.toHaveProperty('vin');
  });

  it('keeps unknown provider facts null in admin detail and source binding data', async () => {
    const persisted = lot({ externalLotId: 'lot-null-facts', currentBidUsd: null, buyNowUsd: null });
    prisma.discoveredLot.findUnique.mockResolvedValue(persisted);
    prisma.vehicle.findMany.mockResolvedValue([]);

    const detail = await service.adminLotDetail('copart', 'lot-null-facts');
    expect(detail.item.locationCountry).toBeNull();

    transaction.discoveredLot.findUnique.mockResolvedValue(persisted);
    transaction.vehicleSourceBinding.findUnique.mockResolvedValue(null);
    transaction.vehicle.create.mockResolvedValue({ id: 'veh-null', slug: 'auction-vehicle-copart-lot-null-facts', publicationStatus: 'DRAFT' });
    transaction.discoveredLot.update.mockResolvedValue({});

    await service.importPersistedLot({ lotNumber: 'lot-null-facts', platform: 'copart', confirm: true });

    expect(transaction.vehicle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        locationCountry: null,
        sourceBindings: { create: expect.objectContaining({
          externalUrl: null,
          currentBidAmount: null,
          buyNowAmount: null,
        }) },
      }),
    }));
  });
});

function lot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lot-row', provider: 'copart', externalLotId: 'lot-1', state: 'DISCOVERED', title: 'Auction vehicle', make: 'Make', model: 'Model', year: 2020,
    lifecycleState: 'OPEN', freshnessState: 'FRESH', availabilityConfirmed: true, consecutiveMisses: 0, freshnessTier: 'COLD', vehicleId: null,
    vin: null, odometerKm: null, odometerMi: null, bodyStyle: null, fuelType: null, transmission: null, driveType: null, primaryDamage: null,
    locationState: null, locationDisplay: null, auctionState: 'open', auctionTime: null, auctionTimezoneOffset: null, mediaUrls: [], isBuyNow: false,
    currentBidUsd: null, buyNowUsd: null, firstSeenAt: new Date('2026-07-16T00:00:00.000Z'), lastSeenAt: new Date('2026-07-16T00:00:00.000Z'),
    updatedAt: new Date('2026-07-16T00:00:00.000Z'),
    ...overrides,
  };
}
