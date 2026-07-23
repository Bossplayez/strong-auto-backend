import type { DiscoveredLot } from '@prisma/client';
import {
  buildLotCalculatorInput,
  toBodyCode,
  toEngineVolumeCc,
  toFuelCode,
} from './calculator-lot-input';

const now = new Date('2026-07-22T10:00:00.000Z');

function lot(overrides: Partial<DiscoveredLot> = {}): DiscoveredLot {
  return {
    provider: 'copart',
    externalLotId: '123',
    title: '2019 TEST SEDAN',
    make: 'TEST',
    model: 'SEDAN',
    year: 2019,
    facilityId: '142',
    fuelType: 'Gas',
    bodyStyle: 'Sedan',
    engine: '2.0L I-4',
    isBuyNow: false,
    currentBidUsd: 3100 as never,
    buyNowUsd: null,
    auctionTime: new Date('2026-07-22T16:00:00.000Z'),
    providerResultState: 'UNKNOWN' as never,
    listingObservedAt: now,
    priceObservedAt: now,
    lastProviderUpdateAt: now,
    availabilityConfirmed: true,
    lastSeenAt: now,
    state: 'DISCOVERED' as never,
    consecutiveMisses: 0,
    ...overrides,
  } as DiscoveredLot;
}

describe('auction lot calculator input', () => {
  it('uses an explicit Buy Now price ahead of the current bid', () => {
    const result = buildLotCalculatorInput(lot({
      isBuyNow: true,
      buyNowUsd: 4200 as never,
    }), now);

    expect(result).toEqual(expect.objectContaining({
      status: 'available',
      basis: 'buyNow',
      input: expect.objectContaining({ priceUsd: 4200, platformId: '142', engineVolumeCc: 2000 }),
    }));
  });

  it('uses the current bid when Buy Now is not active', () => {
    const result = buildLotCalculatorInput(lot(), now);

    expect(result).toEqual(expect.objectContaining({
      status: 'available',
      basis: 'currentBid',
      input: expect.objectContaining({ priceUsd: 3100 }),
    }));
  });

  it('does not invent a facility when it is not in the legacy calculator directory', () => {
    expect(buildLotCalculatorInput(lot({ facilityId: '999999' }), now)).toEqual({
      status: 'unavailable',
      reason: 'LOCATION_UNAVAILABLE',
    });
  });

  it('resolves an IAAI platform only from an exact calculator directory location', () => {
    const result = buildLotCalculatorInput(lot({
      provider: 'iaai',
      facilityId: null,
      locationDisplay: 'Seattle (WA)',
      locationState: null,
      facilityOfficeName: null,
      facilityState: null,
      engine: '{"raw":"2.5L I-4","size_l":"2.5"}',
      bodyStyle: 'SUV/Crossover',
      fuelType: 'Gasoline',
    }), now);

    expect(result).toEqual(expect.objectContaining({
      status: 'available',
      input: expect.objectContaining({ provider: 'iaai', platformId: '531', engineVolumeCc: 2500 }),
    }));
  });

  it('keeps the IAAI Wilmington and Winnipeg calculator locations distinct', () => {
    const wilmington = buildLotCalculatorInput(lot({
      provider: 'iaai', facilityId: null, locationDisplay: 'Wilmington (NC)',
      locationState: null, facilityOfficeName: null, facilityState: null,
      bodyStyle: 'SUV/Crossover',
    }), now);
    const winnipeg = buildLotCalculatorInput(lot({
      provider: 'iaai', facilityId: null, locationDisplay: 'Winnipeg (MB)',
      locationState: null, facilityOfficeName: null, facilityState: null,
      bodyStyle: 'SUV/Crossover',
    }), now);

    expect(wilmington).toEqual(expect.objectContaining({
      status: 'available',
      input: expect.objectContaining({ provider: 'iaai', platformId: '554' }),
    }));
    expect(winnipeg).toEqual(expect.objectContaining({
      status: 'available',
      input: expect.objectContaining({ provider: 'iaai', platformId: '603' }),
    }));
  });

  it('resolves Copart platforms from the complete existing calculator directory when facility id is absent', () => {
    const result = buildLotCalculatorInput(lot({
      provider: 'copart', facilityId: null, locationDisplay: 'Miami Central (FL)',
      locationState: null, facilityOfficeName: null, facilityState: null,
      bodyStyle: 'SUV/Crossover',
    }), now);

    expect(result).toEqual(expect.objectContaining({
      status: 'available',
      input: expect.objectContaining({ provider: 'copart', platformId: '101' }),
    }));

    const westPalmBeach = buildLotCalculatorInput(lot({
      provider: 'copart', facilityId: null, locationDisplay: 'West Palm Beach (FL)',
      locationState: null, facilityOfficeName: null, facilityState: null,
      bodyStyle: 'SUV/Crossover', fuelType: 'Electric and gas hybrid',
      engine: '2.5L 4', currentBidUsd: 13000 as never,
    }), now);

    expect(westPalmBeach).toEqual(expect.objectContaining({
      status: 'available',
      basis: 'currentBid',
      input: expect.objectContaining({ provider: 'copart', platformId: '68', engineVolumeCc: 2500 }),
    }));
  });

  it('uses an exact provider location when a provider facility id is unavailable to the calculator', () => {
    expect(buildLotCalculatorInput(lot({
      provider: 'copart', facilityId: '999999', locationDisplay: 'Miami Central (FL)',
      locationState: null, facilityOfficeName: null, facilityState: null,
    }), now)).toEqual(expect.objectContaining({
      status: 'available',
      input: expect.objectContaining({ platformId: '101' }),
    }));
  });

  it('does not resolve an IAAI platform from a city without an explicit state', () => {
    expect(buildLotCalculatorInput(lot({
      provider: 'iaai',
      facilityId: null,
      locationDisplay: 'Seattle',
      locationState: null,
      facilityOfficeName: null,
      facilityState: null,
    }), now)).toEqual({
      status: 'unavailable',
      reason: 'LOCATION_UNAVAILABLE',
    });
  });

  it('does not infer an engine volume from cylinder notation', () => {
    expect(toEngineVolumeCc('V6')).toBeNull();
    expect(toEngineVolumeCc('2.0L I-4')).toBe(2000);
    expect(toEngineVolumeCc('1998cc')).toBe(1998);
    expect(toEngineVolumeCc('1998 cm³')).toBe(1998);
    expect(toEngineVolumeCc('{"size_l":"1.8"}')).toBe(1800);
  });

  it('keeps unsupported body and fuel facts unavailable instead of guessing', () => {
    expect(toBodyCode('Pickup truck')).toBeNull();
    expect(toBodyCode('Sport utility vehicle')).toBe(3);
    expect(toFuelCode('Hydrogen')).toBeNull();
    expect(toFuelCode('Plug-in Hybrid')).toBe(3);
  });
});
