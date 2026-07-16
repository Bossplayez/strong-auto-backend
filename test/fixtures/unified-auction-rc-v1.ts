/** Backend-owned executable conformance fixture for unified-auction-rc-v1. */
export const UNIFIED_AUCTION_RC_V1 = 'unified-auction-rc-v1' as const;

export const unifiedAuctionRcFixture = {
  contractVersion: UNIFIED_AUCTION_RC_V1,
  catalog: {
    key: 'auctionLot:copart:lot-9', kind: 'auctionLot', source: 'copart',
    title: '2020 Ford Escape', make: 'Ford', model: 'Escape', year: 2020,
    bodyType: 'SUV', fuelType: null, transmission: 'Automatic', driveType: null,
    locationState: 'TX', odometerKm: 160934, thumbnailUrl: '/fixture/lot-9-1.jpg', mediaCount: 7,
    price: { currency: 'USD', primaryUsd: 8100, basis: 'buyNow', currentBidUsd: 5400, buyNowUsd: 8100, buyNowAvailable: true },
    provider: 'copart', externalLotId: 'lot-9', importedVehicleId: null,
    lifecycle: 'UPCOMING', freshness: 'FRESH', auctionAt: '2026-07-20T15:00:00.000Z', providerTimezoneOffset: '-05:00',
  },
  error: { contractVersion: UNIFIED_AUCTION_RC_V1, error: { code: 'AUCTION_LOT_NOT_FOUND', message: 'Auction lot was not found.', fieldErrors: null, requestId: 'req-fixture-404' } },
} as const;
