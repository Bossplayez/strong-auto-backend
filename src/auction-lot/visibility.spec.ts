/**
 * Task 042 — Behavioral tests for admin/public visibility consistency.
 *
 * Tests eligibleLot classification: valid lots are eligible,
 * invalid/stale/ended/invisible lots are public-hidden.
 * Also tests eligibility boundary conditions.
 *
 * No source-string checks — all tests verify eligibleLot() behavior.
 */
import { eligibleLot } from './inventory-projection';

describe('Admin/Public visibility consistency (Task 042)', () => {
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
    expect(eligibleLot({ ...validLot, consecutiveMisses: 2 })).toBe(true);
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

  it('V6. UPCOMING and OPEN lifecycle states are also eligible', () => {
    expect(eligibleLot({ ...validLot, lifecycleState: 'UPCOMING' })).toBe(true);
    expect(eligibleLot({ ...validLot, lifecycleState: 'OPEN' })).toBe(true);
  });

  it('V7. combined ineligible fields are hidden regardless of other valid fields', () => {
    // Fresh lot, confirmed, but 5 misses
    expect(eligibleLot({ ...validLot, consecutiveMisses: 5 })).toBe(false);
    // Fresh lot, 0 misses, but not confirmed
    expect(eligibleLot({ ...validLot, availabilityConfirmed: false })).toBe(false);
    // Confirmed, 0 misses, but SOLD
    expect(eligibleLot({ ...validLot, lifecycleState: 'SOLD' })).toBe(false);
    // Confirmed, 0 misses, LIVE, but stale
    expect(eligibleLot({ ...validLot, freshnessState: 'STALE' })).toBe(false);
  });

  it('V8. NOT_READY lifecycle is public-hidden', () => {
    expect(eligibleLot({ ...validLot, lifecycleState: 'NOT_READY' })).toBe(false);
  });
});
