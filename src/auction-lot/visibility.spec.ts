/**
 * Task 040 — Focused tests for admin/public visibility consistency.
 *
 * Verifies that invalid/stale/ended lots remain admin-visible
 * but are hidden from the public catalog.
 */
import { eligibleLot } from './inventory-projection';

describe('Admin/Public visibility consistency (Task 040)', () => {
  const validLot = {
    lifecycleState: 'LIVE' as const,
    freshnessState: 'FRESH' as const,
    availabilityConfirmed: true,
    consecutiveMisses: 0,
  };

  it('V1. valid lot is eligible', () => {
    expect(eligibleLot(validLot)).toBe(true);
  });

  it('V2. lot with availabilityConfirmed=false is public-hidden', () => {
    expect(eligibleLot({ ...validLot, availabilityConfirmed: false })).toBe(false);
  });

  it('V3. lot with 3+ consecutive misses is public-hidden', () => {
    expect(eligibleLot({ ...validLot, consecutiveMisses: 3 })).toBe(false);
    expect(eligibleLot({ ...validLot, consecutiveMisses: 5 })).toBe(false);
  });

  it('V4. ended lot (SOLD/ENDED/REMOVED) is public-hidden', () => {
    expect(eligibleLot({ ...validLot, lifecycleState: 'SOLD' })).toBe(false);
    expect(eligibleLot({ ...validLot, lifecycleState: 'ENDED' })).toBe(false);
    expect(eligibleLot({ ...validLot, lifecycleState: 'REMOVED' })).toBe(false);
  });

  it('V5. stale lot (STALE/DEFERRED) is public-hidden', () => {
    expect(eligibleLot({ ...validLot, freshnessState: 'STALE' })).toBe(false);
    expect(eligibleLot({ ...validLot, freshnessState: 'DEFERRED' })).toBe(false);
  });

  it('V6. admin listAdminLots does NOT filter by eligibleLot', () => {
    // Verify from source that listAdminLots fetches all lots
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/auction-lots.service.ts', 'utf-8');
    // listAdminLots should not call eligibleLot
    const adminListMatch = src.match(/async listAdminLots[\s\S]*?async adminLotDetail/);
    expect(adminListMatch).toBeTruthy();
    expect(adminListMatch![0]).not.toContain('eligibleLot');
  });

  it('V7. adminMetrics counts all lots as totalExternal', () => {
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/auction-lots.service.ts', 'utf-8');
    const metricsMatch = src.match(/async adminMetrics[\s\S]*?async importPersistedLot/);
    expect(metricsMatch).toBeTruthy();
    // totalExternal should be selected.length (all lots), not filtered
    expect(metricsMatch![0]).toContain('totalExternal: selected.length');
  });

  it('V8. public findAll filters by eligibleLot', () => {
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/auction-lots.service.ts', 'utf-8');
    const findAllMatch = src.match(/async findAll[\s\S]*?async findOne/);
    expect(findAllMatch).toBeTruthy();
    expect(findAllMatch![0]).toContain('eligibleLot');
  });
});
