import {
  acceptsNewPassengerLot,
  isExplicitNonPassenger,
  isPassengerMarketScope,
  PASSENGER_DISCOVERY_PARTITIONS,
} from './market-scope';

describe('passenger market scope', () => {
  it('contains deterministic make/model discovery partitions', () => {
    expect(PASSENGER_DISCOVERY_PARTITIONS).toContainEqual({ make: 'TESLA', model: 'MODEL 3' });
    expect(PASSENGER_DISCOVERY_PARTITIONS).toContainEqual({ make: 'VOLKSWAGEN', model: 'GOLF' });
    expect([...PASSENGER_DISCOVERY_PARTITIONS]).toEqual([...PASSENGER_DISCOVERY_PARTITIONS].sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model)));
  });

  it('accepts a whitelisted passenger lot and rejects only explicit non-passenger or off-scope new supply', () => {
    expect(acceptsNewPassengerLot({ make: 'VW', model: 'Golf', bodyStyle: null })).toBe(true);
    expect(acceptsNewPassengerLot({ make: 'Volkswagen', model: 'Passat SE', bodyStyle: 'Sedan' })).toBe(true);
    expect(acceptsNewPassengerLot({ make: 'Tesla', model: 'Model 3 Long Range', bodyStyle: 'Sedan' })).toBe(true);
    expect(acceptsNewPassengerLot({ make: 'Chevrolet', model: 'Bolt EUV', bodyStyle: null })).toBe(true);
    expect(acceptsNewPassengerLot({ make: 'BMW', model: '330i xDrive', bodyStyle: 'Sedan' })).toBe(true);
    expect(acceptsNewPassengerLot({ make: 'BMW', model: '330', bodyStyle: 'Sedan' })).toBe(true);
    expect(acceptsNewPassengerLot({ make: 'BMW', model: '530', bodyStyle: 'Sedan' })).toBe(true);
    expect(acceptsNewPassengerLot({ make: 'Ford', model: 'F-150', title: 'Ford F-150 Pickup' })).toBe(false);
    expect(acceptsNewPassengerLot({ make: 'Honda', model: 'Civic', bodyStyle: null })).toBe(false);
    expect(isExplicitNonPassenger({ title: 'Tool equipment', bodyStyle: null })).toBe(true);
    expect(isPassengerMarketScope({ make: 'Tesla', model: 'Model Y' })).toBe(true);
  });
});
