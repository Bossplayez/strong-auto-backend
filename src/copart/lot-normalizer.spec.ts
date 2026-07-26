import { normalizeDiscoveredLot } from './lot-normalizer';

describe('normalizeDiscoveredLot', () => {
  it('normalizes provider body_style object variants before persistence', () => {
    const lot = normalizeDiscoveredLot({
      make: 'Tesla', model: 'Model Y', vehicle_specs: { body_style: { label: '4DR SPORT UTILITY' } },
    }, 'copart');

    expect(lot.bodyStyle).toBe('SUV');
  });

  it('reads an IAAI-style root body type without inventing a value', () => {
    const lot = normalizeDiscoveredLot({
      make: 'Audi', model: 'A4 Premium', body_type: { value: 'SEDAN 4DR' },
    }, 'iaai');

    expect(lot.bodyStyle).toBe('SEDAN');
  });

  it('preserves a missing optional body style as unknown', () => {
    expect(normalizeDiscoveredLot({ make: 'Tesla', model: 'Model 3' }, 'iaai').bodyStyle).toBeNull();
  });
});
