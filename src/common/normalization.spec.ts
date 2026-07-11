import {
  normalizeFuelType,
  normalizeDriveType,
  normalizeBodyType,
  normalizeVehicleFields,
} from './normalization';

describe('normalizeFuelType', () => {
  it('maps DIESEL → DIESEL', () => {
    expect(normalizeFuelType('DIESEL')).toBe('DIESEL');
  });

  it('maps Diesel → DIESEL (case-insensitive)', () => {
    expect(normalizeFuelType('Diesel')).toBe('DIESEL');
  });

  it('maps GAS → GASOLINE', () => {
    expect(normalizeFuelType('GAS')).toBe('GASOLINE');
  });

  it('maps Gas → GASOLINE (case-insensitive)', () => {
    expect(normalizeFuelType('Gas')).toBe('GASOLINE');
  });

  it('maps GASOLINE → GASOLINE', () => {
    expect(normalizeFuelType('GASOLINE')).toBe('GASOLINE');
  });

  it('returns null for null input', () => {
    expect(normalizeFuelType(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeFuelType(undefined)).toBeNull();
  });

  it('returns null for blank string', () => {
    expect(normalizeFuelType('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(normalizeFuelType('   ')).toBeNull();
  });

  it('preserves already-canonical DIESEL', () => {
    expect(normalizeFuelType('DIESEL')).toBe('DIESEL');
  });

  it('preserves already-canonical GASOLINE', () => {
    expect(normalizeFuelType('GASOLINE')).toBe('GASOLINE');
  });

  it('preserves unknown value (trimmed)', () => {
    expect(normalizeFuelType('  Hybrid  ')).toBe('Hybrid');
  });

  it('preserves Electric (unknown, trimmed)', () => {
    expect(normalizeFuelType('Electric')).toBe('Electric');
  });
});

describe('normalizeDriveType', () => {
  it('maps ALL WHEEL DRIVE → AWD', () => {
    expect(normalizeDriveType('ALL WHEEL DRIVE')).toBe('AWD');
  });

  it('maps All Wheel Drive → AWD (case-insensitive)', () => {
    expect(normalizeDriveType('All Wheel Drive')).toBe('AWD');
  });

  it('maps FRONT WHEEL DRIVE → FWD', () => {
    expect(normalizeDriveType('FRONT WHEEL DRIVE')).toBe('FWD');
  });

  it('maps Front Wheel Drive → FWD (case-insensitive)', () => {
    expect(normalizeDriveType('Front Wheel Drive')).toBe('FWD');
  });

  it('maps REAR WHEEL DRIVE → RWD', () => {
    expect(normalizeDriveType('REAR WHEEL DRIVE')).toBe('RWD');
  });

  it('maps Rear Wheel Drive → RWD (case-insensitive)', () => {
    expect(normalizeDriveType('Rear Wheel Drive')).toBe('RWD');
  });

  it('preserves already-canonical AWD', () => {
    expect(normalizeDriveType('AWD')).toBe('AWD');
  });

  it('preserves already-canonical FWD', () => {
    expect(normalizeDriveType('FWD')).toBe('FWD');
  });

  it('preserves already-canonical RWD', () => {
    expect(normalizeDriveType('RWD')).toBe('RWD');
  });

  it('returns null for null input', () => {
    expect(normalizeDriveType(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeDriveType(undefined)).toBeNull();
  });

  it('returns null for blank string', () => {
    expect(normalizeDriveType('')).toBeNull();
  });

  // Ambiguous values — must NOT be mapped
  it('preserves "4X4 W/REAR WHEEL DRV" unchanged (ambiguous)', () => {
    expect(normalizeDriveType('4X4 W/REAR WHEEL DRV')).toBe('4X4 W/REAR WHEEL DRV');
  });

  it('preserves "4X4 W/REAR WHEEL DRIVE" unchanged (ambiguous)', () => {
    expect(normalizeDriveType('4X4 W/REAR WHEEL DRIVE')).toBe('4X4 W/REAR WHEEL DRIVE');
  });

  it('preserves unknown value (trimmed)', () => {
    expect(normalizeDriveType('  Some Unknown Drive  ')).toBe('Some Unknown Drive');
  });

  it('does NOT map anything to 4WD in this task', () => {
    expect(normalizeDriveType('4WD')).toBe('4WD'); // preserved, not mapped from ambiguous
  });
});

describe('normalizeBodyType', () => {
  it('maps 4DR SPORT UTILITY → SUV', () => {
    expect(normalizeBodyType('4DR SPORT UTILITY')).toBe('SUV');
  });

  it('maps SEDAN 4DR → SEDAN', () => {
    expect(normalizeBodyType('SEDAN 4DR')).toBe('SEDAN');
  });

  it('maps Sedan → SEDAN (case-insensitive)', () => {
    expect(normalizeBodyType('Sedan')).toBe('SEDAN');
  });

  it('maps HATCHBACK 4DR → HATCHBACK', () => {
    expect(normalizeBodyType('HATCHBACK 4DR')).toBe('HATCHBACK');
  });

  it('maps HATCHBACK → HATCHBACK', () => {
    expect(normalizeBodyType('HATCHBACK')).toBe('HATCHBACK');
  });

  it('preserves already-canonical SUV', () => {
    expect(normalizeBodyType('SUV')).toBe('SUV');
  });

  it('preserves already-canonical SEDAN', () => {
    expect(normalizeBodyType('SEDAN')).toBe('SEDAN');
  });

  it('preserves already-canonical HATCHBACK', () => {
    expect(normalizeBodyType('HATCHBACK')).toBe('HATCHBACK');
  });

  it('returns null for null input', () => {
    expect(normalizeBodyType(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeBodyType(undefined)).toBeNull();
  });

  it('returns null for blank string', () => {
    expect(normalizeBodyType('')).toBeNull();
  });

  it('preserves unknown value (trimmed)', () => {
    expect(normalizeBodyType('  COUPE  ')).toBe('COUPE');
  });

  it('preserves malformed "4DR SPOR" unchanged', () => {
    expect(normalizeBodyType('4DR SPOR')).toBe('4DR SPOR');
  });

  it('preserves malformed "4DR SPOR" with whitespace trimmed', () => {
    expect(normalizeBodyType('  4DR SPOR  ')).toBe('4DR SPOR');
  });
});

describe('normalizeVehicleFields', () => {
  it('normalises all three fields together', () => {
    const result = normalizeVehicleFields({
      fuelType: 'Diesel',
      driveType: 'All Wheel Drive',
      bodyType: 'SEDAN 4DR',
    });
    expect(result).toEqual({
      fuelType: 'DIESEL',
      driveType: 'AWD',
      bodyType: 'SEDAN',
    });
  });

  it('handles all-null input', () => {
    const result = normalizeVehicleFields({
      fuelType: null,
      driveType: null,
      bodyType: null,
    });
    expect(result).toEqual({
      fuelType: null,
      driveType: null,
      bodyType: null,
    });
  });

  it('handles undefined fields', () => {
    const result = normalizeVehicleFields({});
    expect(result).toEqual({
      fuelType: null,
      driveType: null,
      bodyType: null,
    });
  });

  it('preserves ambiguous and unknown values', () => {
    const result = normalizeVehicleFields({
      fuelType: '  Hybrid  ',
      driveType: '4X4 W/REAR WHEEL DRV',
      bodyType: '4DR SPOR',
    });
    expect(result).toEqual({
      fuelType: 'Hybrid',
      driveType: '4X4 W/REAR WHEEL DRV',
      bodyType: '4DR SPOR',
    });
  });

  it('does not mutate the input object', () => {
    const input = { fuelType: 'Gas', driveType: 'AWD', bodyType: 'SUV' };
    const copy = { ...input };
    normalizeVehicleFields(input);
    expect(input).toEqual(copy);
  });
});
