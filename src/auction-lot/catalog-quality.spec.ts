/**
 * Task 046 — Tests for evaluateCatalogQuality
 */
import { evaluateCatalogQuality, isPassengerAutomobile, MIN_CATALOG_YEAR, qualityExclusionWhere } from './catalog-quality';

const baseLot = {
  year: 2020,
  bodyStyle: 'SUV',
  title: '2020 TOYOTA RAV4',
  make: 'TOYOTA',
  model: 'RAV4',
  primaryDamage: 'FRONT END',
  secondaryDamage: null,
  loss: null,
  saleDocumentName: null,
  saleDocumentType: null,
};

describe('evaluateCatalogQuality (Task 046)', () => {
  it('includes a normal repairable car', () => {
    const result = evaluateCatalogQuality(baseLot);
    expect(result.include).toBe(true);
    expect(result.reasonCode).toBeNull();
  });

  it('includes car with hail damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'HAIL' });
    expect(result.include).toBe(true);
  });

  it('includes car with vandalism damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'VANDALISM' });
    expect(result.include).toBe(true);
  });

  it('includes car with minor dents', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'MINOR DENT/SCRATCHES' });
    expect(result.include).toBe(true);
  });

  it('includes car with rear end damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'REAR END' });
    expect(result.include).toBe(true);
  });

  it('includes car with side damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'SIDE' });
    expect(result.include).toBe(true);
  });

  // ── Exclusions ──

  it('excludes year < 2010', () => {
    const result = evaluateCatalogQuality({ ...baseLot, year: 2008 });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('YEAR_TOO_OLD');
    expect(result.reason).toContain('2010');
  });

  it('excludes null year', () => {
    const result = evaluateCatalogQuality({ ...baseLot, year: null });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('YEAR_TOO_OLD');
  });

  it('excludes box truck', () => {
    const result = evaluateCatalogQuality({ ...baseLot, title: '2015 FORD BOX TRUCK', bodyStyle: 'BOX TRUCK' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('COMMERCIAL_VEHICLE');
  });

  it('excludes tractor trailer', () => {
    const result = evaluateCatalogQuality({ ...baseLot, title: '2018 FREIGHTLINER TRACTOR TRAILER' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('COMMERCIAL_VEHICLE');
  });

  it('excludes school bus', () => {
    const result = evaluateCatalogQuality({ ...baseLot, title: '2015 BLUE BIRD SCHOOL BUS' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('COMMERCIAL_VEHICLE');
  });

  it('excludes motorcycle', () => {
    const result = evaluateCatalogQuality({ ...baseLot, title: '2018 HONDA MOTORCYCLE CBR600' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('COMMERCIAL_VEHICLE');
  });

  it('excludes motorhome', () => {
    const result = evaluateCatalogQuality({ ...baseLot, title: '2016 THOR MOTORHOME' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('COMMERCIAL_VEHICLE');
  });

  it('excludes excavator', () => {
    const result = evaluateCatalogQuality({ ...baseLot, title: '2019 CAT EXCAVATOR 320' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('COMMERCIAL_VEHICLE');
  });

  it.each([
    '2020 GENERATOR - GENERATOR',
    '2021 DEWALT TOOL SET',
    '2019 INDUSTRIAL AIR COMPRESSOR',
    '2022 MILLER WELDER',
  ])('excludes a non-automobile asset: %s', (title) => {
    const result = evaluateCatalogQuality({ ...baseLot, title });

    expect(result).toEqual(expect.objectContaining({
      include: false,
      reasonCode: 'COMMERCIAL_VEHICLE',
    }));
    expect(isPassengerAutomobile({ ...baseLot, title })).toBe(false);
  });

  it('accepts a passenger car for ingestion', () => {
    expect(isPassengerAutomobile(baseLot)).toBe(true);
  });

  it('hides historical non-passenger records when the provider stored the signal outside the title', () => {
    const where = qualityExclusionWhere();
    const exclusions = ((where.NOT as { OR: unknown[] }).OR);

    expect(exclusions).toEqual(expect.arrayContaining([
      { bodyStyle: { contains: 'tractor', mode: 'insensitive' } },
      { make: { contains: 'tractor', mode: 'insensitive' } },
      { model: { contains: 'tractor', mode: 'insensitive' } },
    ]));
  });

  it('excludes non-repairable document', () => {
    const result = evaluateCatalogQuality({ ...baseLot, saleDocumentName: 'NON-REPAIRABLE TITLE' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('NON_REPAIRABLE');
  });

  it('excludes certificate of destruction', () => {
    const result = evaluateCatalogQuality({ ...baseLot, saleDocumentName: 'CERTIFICATE OF DESTRUCTION' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('NON_REPAIRABLE');
  });

  it('excludes parts only', () => {
    const result = evaluateCatalogQuality({ ...baseLot, saleDocumentType: 'PARTS ONLY' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('NON_REPAIRABLE');
  });

  it('excludes fire damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'FIRE' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('CATASTROPHIC_DAMAGE');
  });

  it('excludes flood damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'FLOOD' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('CATASTROPHIC_DAMAGE');
  });

  it('excludes rollover damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'ROLLOVER' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('CATASTROPHIC_DAMAGE');
  });

  it('excludes biohazard damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'BIOHAZARD' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('CATASTROPHIC_DAMAGE');
  });

  it('excludes burn in secondary damage', () => {
    const result = evaluateCatalogQuality({ ...baseLot, secondaryDamage: 'BURN' });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('CATASTROPHIC_DAMAGE');
  });

  it('does NOT exclude normal salvage title', () => {
    const result = evaluateCatalogQuality({ ...baseLot, saleDocumentName: 'SALVAGE TITLE' });
    expect(result.include).toBe(true);
  });

  it('does NOT exclude "all over" damage (not catastrophic)', () => {
    const result = evaluateCatalogQuality({ ...baseLot, primaryDamage: 'ALL OVER' });
    expect(result.include).toBe(true);
  });

  it('boundary: year exactly 2010 is included', () => {
    const result = evaluateCatalogQuality({ ...baseLot, year: MIN_CATALOG_YEAR });
    expect(result.include).toBe(true);
  });

  it('boundary: year 2009 is excluded', () => {
    const result = evaluateCatalogQuality({ ...baseLot, year: 2009 });
    expect(result.include).toBe(false);
    expect(result.reasonCode).toBe('YEAR_TOO_OLD');
  });
});
