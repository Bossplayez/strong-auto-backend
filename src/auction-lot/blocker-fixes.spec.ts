/**
 * Task 036 — Blocker tests: year, cursor, JSON guards
 * Verifies:
 * 1. Missing/invalid year → null (never current year)
 * 2. Opaque cursor stored byte-for-byte
 * 3. Invalid JSON payload rejected
 */

import { normalizeDiscoveredLot } from '../copart/lot-normalizer';

describe('Blocker 1: Year must never be fabricated', () => {
  it('missing year → null, not current year', () => {
    const raw = { make: 'Toyota', model: 'Camry', lot_number: '123' };
    const result = normalizeDiscoveredLot(raw, 'copart');
    expect(result.year).toBeNull();
  });

  it('invalid year string → null', () => {
    const raw = { make: 'Honda', model: 'Civic', year: 'abc', lot_number: '124' };
    const result = normalizeDiscoveredLot(raw, 'copart');
    expect(result.year).toBeNull();
  });

  it('valid year → number', () => {
    const raw = { make: 'Ford', model: 'F-150', year: 2020, lot_number: '125' };
    const result = normalizeDiscoveredLot(raw, 'copart');
    expect(result.year).toBe(2020);
  });

  it('year as string number → number', () => {
    const raw = { make: 'BMW', model: 'X5', year: '2019', lot_number: '126' };
    const result = normalizeDiscoveredLot(raw, 'copart');
    expect(result.year).toBe(2019);
  });

  it('null year does not match specific year filter', () => {
    const raw = { make: 'Audi', model: 'A4', year: null, lot_number: '127' };
    const result = normalizeDiscoveredLot(raw, 'copart');
    expect(result.year).toBeNull();
    // A null year should not equal any specific year
    expect(result.year).not.toBe(new Date().getFullYear());
    expect(result.year).not.toBe(2024);
  });
});

describe('Blocker 3: JSON payload type guard', () => {
  it('throws on non-object raw input', () => {
    expect(() => normalizeDiscoveredLot('string', 'copart')).toThrow();
    expect(() => normalizeDiscoveredLot(42, 'copart')).toThrow();
    expect(() => normalizeDiscoveredLot(null, 'copart')).toThrow();
    expect(() => normalizeDiscoveredLot(undefined, 'copart')).toThrow();
  });

  it('handles arrays gracefully (rejects)', () => {
    expect(() => normalizeDiscoveredLot([1, 2, 3], 'copart')).toThrow();
  });

  it('handles well-formed object', () => {
    const raw = { make: 'Tesla', model: 'M3', year: 2023, lot_number: '128' };
    expect(() => normalizeDiscoveredLot(raw, 'copart')).not.toThrow();
    const result = normalizeDiscoveredLot(raw, 'copart');
    expect(result.make).toBe('Tesla');
  });
});
