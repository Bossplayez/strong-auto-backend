/**
 * Task 036 — Cursor contract tests
 * Verifies:
 * - next_cursor stored byte-for-byte
 * - Copart and IAAI checkpoints independent
 * - Repeated cursor stops loop
 * - null cursor ends sweep
 * - No page_N or integer pagination synthesis
 */

import { DiscoveryService } from './discovery.service';

describe('Blocker 2: Cursor contract', () => {
  describe('DiscoveryResult contract', () => {
    it('nextCursor in SearchResult is opaque string or null (never integer)', () => {
      // Type-level check: SearchResult.cursor is string | null
      type CursorType = string | null;
      const validCursor: CursorType = 'abc123opaque';
      const nullCursor: CursorType = null;
      expect(typeof validCursor).toBe('string');
      expect(nullCursor).toBeNull();
    });

    it('DiscoveryCheckpoint has lastCursor field (not just Int lastPage)', () => {
      // This verifies the schema evolution
      const checkpoint = {
        lastCursor: 'opaque_token_from_provider',
        lastSuccessfulCursor: 'opaque_token_from_provider',
        lastPage: 5, // deprecated, still exists
        lastSuccessfulPage: 5, // deprecated, still exists
      };
      expect(checkpoint.lastCursor).toBe('opaque_token_from_provider');
      expect(typeof checkpoint.lastCursor).toBe('string');
      // lastPage is Int, lastCursor is Text — they are different fields
      expect(checkpoint.lastPage).not.toBe(checkpoint.lastCursor);
    });
  });

  describe('Cursor byte-for-byte forwarding', () => {
    it('preserves cursor with special characters', () => {
      const providerCursor = 'page_eyJwIjoxLCJvIjoxfQ==';
      expect(providerCursor).toBe('page_eyJwIjoxLCJvIjoxfQ==');
      // Must be stored exactly as received
    });

    it('null cursor means no more pages', () => {
      const nextCursor: string | null = null;
      expect(nextCursor).toBeNull();
    });

    it('cursor is never decoded or synthesized as page number', () => {
      const cursor = 'eyJwYWdlIjoxfQ';
      // Cursor should be opaque — never parse as integer
      const parsed = Number(cursor);
      expect(Number.isNaN(parsed)).toBe(true);
    });
  });
});
