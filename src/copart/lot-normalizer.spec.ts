import { normalizeDiscoveredLot } from './lot-normalizer';

describe('lot normalizer provider facts', () => {
  it('uses the provider body style when vehicle_specs.body_style is null', () => {
    const lot = normalizeDiscoveredLot({
      lot_number: '45552475',
      title: '2013 AUDI A6 2.0T PREMIUM',
      make: 'AUDI',
      model: 'A6',
      year: 2013,
      vehicle_specs: { body_style: null },
      attributes: { BodyStyleName: 'SEDAN' },
      vehicle_description: { BodyStyle: 'SEDAN' },
    }, 'iaai');

    expect(lot.bodyStyle).toBe('SEDAN');
  });

  it('keeps the canonical vehicle_specs body style when it is present', () => {
    const lot = normalizeDiscoveredLot({
      lot_number: '61083736',
      vehicle_specs: { body_style: '4dr Sport Utility' },
      attributes: { BodyStyleName: 'SEDAN' },
    }, 'copart');

    expect(lot.bodyStyle).toBe('4dr Sport Utility');
  });

  it('does not invent a body style when the provider omitted every supported field', () => {
    const lot = normalizeDiscoveredLot({ lot_number: '1', vehicle_specs: {} }, 'iaai');

    expect(lot.bodyStyle).toBeNull();
  });

  it('marks an explicit provider-unavailable listing as unconfirmed', () => {
    const lot = normalizeDiscoveredLot({
      lot_number: '2',
      auction: { state: 'unavailable' },
    }, 'iaai');

    expect(lot.availabilityConfirmed).toBe(false);
  });
});
