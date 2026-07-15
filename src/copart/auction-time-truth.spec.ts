/**
 * Task 036 — Auction-time truth tests
 * Verifies exact provider field path for auction timestamp and timezone.
 */

import { normalizeDiscoveredLot } from './lot-normalizer';

describe('Blocker 5: Auction-time truth', () => {
  describe('Provider field mapping', () => {
    it('extracts auction_at as primary source', () => {
      const raw = {
        lot_number: '12345',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        auction: {
          auction_at: '2026-07-15T13:30:00+00:00',
          state: 'open',
        },
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTime).toEqual(new Date('2026-07-15T13:30:00+00:00'));
    });

    it('falls back to full_date when auction_at missing', () => {
      const raw = {
        lot_number: '12346',
        make: 'Honda',
        model: 'Civic',
        year: 2019,
        auction: {
          full_date: '2026-07-15T13:30:00-05:00',
          state: 'upcoming',
        },
      };
      const result = normalizeDiscoveredLot(raw, 'iaai');
      expect(result.auctionTime).toEqual(new Date('2026-07-15T13:30:00-05:00'));
    });

    it('falls back to ad when both auction_at and full_date missing', () => {
      const raw = {
        lot_number: '12347',
        make: 'Ford',
        model: 'F-150',
        year: 2021,
        auction: {
          ad: '2026-07-10T01:00:00+00:00',
        },
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTime).toEqual(new Date('2026-07-10T01:00:00+00:00'));
    });

    it('returns null auctionTime when no auction date fields present', () => {
      const raw = {
        lot_number: '12348',
        make: 'BMW',
        model: 'X5',
        year: 2022,
        auction: { state: 'open' },
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTime).toBeNull();
    });
  });

  describe('Discovery timestamp is NOT auction time', () => {
    it('discovery time (firstSeenAt) differs from auctionTime', () => {
      const raw = {
        lot_number: '12349',
        make: 'Audi',
        model: 'A4',
        year: 2020,
        auction: { auction_at: '2026-07-20T13:30:00+00:00' },
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      // auctionTime comes from provider, not from Date.now()
      expect(result.auctionTime).toEqual(new Date('2026-07-20T13:30:00+00:00'));
      expect(result.auctionTime?.getTime()).not.toBeCloseTo(Date.now(), -5);
    });
  });

  describe('Timezone offset extraction', () => {
    it('extracts +00:00 offset → 0 minutes', () => {
      const raw = {
        lot_number: '1',
        make: 'A',
        model: 'B',
        year: 2020,
        auction: { auction_at: '2026-07-15T13:30:00+00:00' },
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTimezoneOffset).toBe(0);
    });

    it('extracts -05:00 offset → -300 minutes', () => {
      const raw = {
        lot_number: '2',
        make: 'A',
        model: 'B',
        year: 2020,
        auction: { auction_at: '2026-07-15T13:30:00-05:00' },
      };
      const result = normalizeDiscoveredLot(raw, 'iaai');
      expect(result.auctionTimezoneOffset).toBe(-300);
    });

    it('extracts +03:00 offset → 180 minutes', () => {
      const raw = {
        lot_number: '3',
        make: 'A',
        model: 'B',
        year: 2020,
        auction: { full_date: '2026-07-15T13:30:00+03:00' },
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTimezoneOffset).toBe(180);
    });

    it('returns null offset when no timezone in date string', () => {
      const raw = {
        lot_number: '4',
        make: 'A',
        model: 'B',
        year: 2020,
        auction: { ad: '2026-07-15' }, // date only, no timezone
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTimezoneOffset).toBeNull();
    });

    it('returns null offset when no auction date', () => {
      const raw = {
        lot_number: '5',
        make: 'A',
        model: 'B',
        year: 2020,
        auction: {},
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTimezoneOffset).toBeNull();
    });
  });

  describe('Unknown timestamp does not create countdown', () => {
    it('null auctionTime → lifecycle NOT_READY (no countdown)', () => {
      // This is tested in lifecycle-mapping.spec.ts but verify the data
      const raw = {
        lot_number: '6',
        make: 'A',
        model: 'B',
        year: 2020,
        auction: { state: null },
      };
      const result = normalizeDiscoveredLot(raw, 'copart');
      expect(result.auctionTime).toBeNull();
      // Normalizer must not fabricate a date
    });
  });
});
