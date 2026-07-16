// ─────────────────────────────────────────────────────────────
// Strong Auto — Provider Adapter Tests (Task 036)
// Tests for PageLimitProviderAdapter (stub), CursorProviderAdapter,
// LoopDetector, and unsupported filter rejection.
// ─────────────────────────────────────────────────────────────

import { PageLimitProviderAdapter, LoopDetector } from './page-limit-adapter';
import { CursorProviderAdapter } from './cursor-adapter';
import { UnsupportedFilterError } from './provider-adapter.interface';
import type { DiscoveryPartition } from './types';

describe('PageLimitProviderAdapter (stub)', () => {
  const adapter = new PageLimitProviderAdapter('copart');

  it('has correct providerId', () => {
    expect(adapter.providerId).toBe('copart');
  });

  it('supportsFilter returns false for all filters (deprecated)', () => {
    expect(adapter.supportsFilter('make')).toBe(false);
    expect(adapter.supportsFilter('vin')).toBe(false);
  });

  it('isValidContinuation returns false for all tokens (deprecated)', () => {
    const token = Buffer.from(JSON.stringify({ page: 2, exhausted: false })).toString('base64');
    expect(adapter.isValidContinuation(token)).toBe(false);
  });

  it('listPartition throws error (deprecated)', async () => {
    const partition: DiscoveryPartition = {
      provider: 'copart',
      priority: 1,
    };
    await expect(adapter.listPartition(partition)).rejects.toThrow(
      'Page-limit adapter is not used for RapidAPI cursor contract',
    );
  });

  it('getDetail throws error (deprecated)', async () => {
    await expect(adapter.getDetail('copart', '123')).rejects.toThrow(
      'Page-limit adapter is not used for RapidAPI cursor contract',
    );
  });
});

describe('CursorProviderAdapter', () => {
  const adapter = new CursorProviderAdapter('iaai');

  it('has correct providerId', () => {
    expect(adapter.providerId).toBe('iaai');
  });

  it('supportsFilter returns true for cursor-specific filters', () => {
    expect(adapter.supportsFilter('dateFrom')).toBe(true);
    expect(adapter.supportsFilter('dateTo')).toBe(true);
    expect(adapter.supportsFilter('make')).toBe(true);
  });

  it('supportsFilter returns false for unknown filters', () => {
    expect(adapter.supportsFilter('vin')).toBe(false);
    expect(adapter.supportsFilter('seller')).toBe(false);
  });

  it('isValidContinuation accepts valid cursor tokens', () => {
    const token = Buffer.from(JSON.stringify({ cursor: 'abc', exhausted: false })).toString('base64');
    expect(adapter.isValidContinuation(token)).toBe(true);
  });

  it('isValidContinuation rejects malformed tokens', () => {
    expect(adapter.isValidContinuation('not-a-token')).toBe(false);
    expect(adapter.isValidContinuation('')).toBe(false);
  });

  it('listPartition throws when transport is not configured', async () => {
    const partition: DiscoveryPartition = {
      provider: 'iaai',
      priority: 1,
    };
    // Without a configured transport, this will throw
    await expect(adapter.listPartition(partition)).rejects.toThrow();
  });

  it('getDetail returns null lot (not yet implemented)', async () => {
    const result = await adapter.getDetail('iaai', '456');
    expect(result.lot).toBeNull();
    expect(result.metadata.requestCount).toBe(0);
  });
});

describe('LoopDetector', () => {
  it('detects duplicate tokens', () => {
    const detector = new LoopDetector();
    expect(detector.isDuplicate('token1')).toBe(false);
    expect(detector.isDuplicate('token1')).toBe(true); // second time = duplicate
  });

  it('detects duplicate page numbers', () => {
    const detector = new LoopDetector();
    expect(detector.isPageDuplicate(1)).toBe(false);
    expect(detector.isPageDuplicate(1)).toBe(true);
    expect(detector.isPageDuplicate(2)).toBe(false);
  });

  it('reset clears seen set', () => {
    const detector = new LoopDetector();
    detector.isDuplicate('token1');
    detector.isPageDuplicate(1);
    detector.reset();
    expect(detector.isDuplicate('token1')).toBe(false);
    expect(detector.isPageDuplicate(1)).toBe(false);
  });

  it('handles many unique tokens without false positives', () => {
    const detector = new LoopDetector();
    for (let i = 0; i < 100; i++) {
      expect(detector.isDuplicate(`token-${i}`)).toBe(false);
    }
    // All 100 are unique, none should be duplicate
    expect(detector.isDuplicate('token-50')).toBe(true); // already seen
  });
});

describe('UnsupportedFilterError', () => {
  it('includes provider and filter key in message', () => {
    const error = new UnsupportedFilterError('copart', 'vin');
    expect(error.message).toContain('copart');
    expect(error.message).toContain('vin');
    expect(error.providerId).toBe('copart');
    expect(error.filterKey).toBe('vin');
  });

  it('has correct error name', () => {
    const error = new UnsupportedFilterError('iaai', 'seller');
    expect(error.name).toBe('UnsupportedFilterError');
  });
});
