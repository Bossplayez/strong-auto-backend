import { normalizeDiscoveredLot } from './lot-normalizer';

describe('provider availability normalization', () => {
  it.each([
    [{ available: false }],
    [{ auction: { is_available: false } }],
    [{ status: 'not available' }],
    [{ auction: { status: 'no longer listed' } }],
    [{ auction: { state: 'upcoming' }, attributes: { InventoryStatus: 'Unavailable' } }],
  ])('marks an explicit provider-unavailable response as unavailable: %j', (raw) => {
    expect(normalizeDiscoveredLot({ lot_number: '456', ...raw }, 'iaai').availabilityConfirmed).toBe(false);
  });

  it('keeps a missing availability signal unknown instead of fabricating a removal', () => {
    expect(normalizeDiscoveredLot({ lot_number: '456', auction: { state: 'upcoming' } }, 'iaai').availabilityConfirmed).toBe(true);
  });
});
