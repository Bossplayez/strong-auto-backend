// ─────────────────────────────────────────────────────────────
// Strong Auto — RapidAPI Transport Tests (Task 036)
// Tests for the centralized transport layer using mocked fetch.
//
// VERIFIED CONTRACT:
//   auction_type=1 → Copart, auction_type=2 → IAAI
//   per_page=N (not limit)
//   cursor=<opaque> forwarded byte-for-byte
//   meta.next_cursor=null means exhausted
//   Provider mismatch is rejected
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RapidApiTransport, ProviderMismatchError, TransportMalformedError } from './rapidapi-transport';
import { Logger } from '@nestjs/common';

// ── Fixtures based on verified contract ──

const COPART_FIXTURE = {
  ok: true,
  data: [
    {
      lot_number: 'C001',
      platform: 'copart',
      make: 'Toyota',
      model: 'Camry',
      year: 2020,
      title: '2020 Toyota Camry',
      auction: { state: 'open', ad: '2026-07-20T10:00:00Z' },
      pricing: { current_bid_usd: 5000, buy_now_usd: 8000 },
    },
    {
      lot_number: 'C002',
      platform: 'copart',
      make: 'Honda',
      model: 'Civic',
      year: 2019,
      title: '2019 Honda Civic',
      auction: { state: 'upcoming' },
      pricing: { current_bid_usd: 3000 },
    },
  ],
  meta: {
    next_cursor: 'abc123',
    prev_cursor: null,
    per_page: 5,
  },
};

const IAAI_FIXTURE = {
  ok: true,
  data: [
    {
      lot_number: 'I001',
      platform: 'iaai',
      make: 'Ford',
      model: 'F-150',
      year: 2021,
      title: '2021 Ford F-150',
      auction: { state: 'live' },
      pricing: { current_bid_usd: 12000 },
    },
  ],
  meta: {
    next_cursor: 'def456',
    prev_cursor: 'xyz789',
    per_page: 5,
  },
};

const EXHAUSTED_FIXTURE = {
  ok: true,
  data: [],
  meta: {
    next_cursor: null,
    prev_cursor: 'abc123',
    per_page: 5,
  },
};

const CROSS_PROVIDER_FIXTURE = {
  ok: true,
  data: [
    {
      lot_number: 'X001',
      platform: 'copart',
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
      title: '2020 Toyota Corolla',
    },
  ],
  meta: {
    next_cursor: 'cross1',
    prev_cursor: null,
    per_page: 5,
  },
};

// ── Mock helpers ──

function createMockFetch(responseBody: any, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => responseBody,
  }) as any;
}

function createMockConfig(overrides: Record<string, any> = {}): any {
  return {
    get: vi.fn((key: string) => {
      const defaults: Record<string, any> = {
        RAPIDAPI_KEY: 'test-api-key',
        IMPORT_REQUEST_TIMEOUT_MS: 30000,
        IMPORT_MAX_RETRY_ATTEMPTS: 2,
        IMPORT_INITIAL_RETRY_DELAY_MS: 1000,
        IMPORT_MAX_RETRY_DELAY_MS: 10000,
        ...overrides,
      };
      return defaults[key];
    }),
  };
}

function createMockBudgetService(): any {
  return {
    reserve: vi.fn().mockResolvedValue({ allowed: true, attemptId: 'test-attempt' }),
    confirm: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    canMakeRoutineRequest: vi.fn().mockResolvedValue({ allowed: true, usage: {} }),
  };
}

// ── Tests ──

describe('RapidApiTransport', () => {
  let transport: RapidApiTransport;
  let mockConfig: any;
  let mockBudget: any;

  beforeEach(() => {
    mockConfig = createMockConfig();
    mockBudget = createMockBudgetService();
    transport = new RapidApiTransport(mockConfig, mockBudget, new Logger('test'));
  });

  describe('auction_type mapping', () => {
    it('Copart sends auction_type=1', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      await transport.listVehicles({
        provider: 'copart',
        perPage: 5,
      });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).toContain('auction_type=1');
      vi.unstubAllGlobals();
    });

    it('IAAI sends auction_type=2', async () => {
      vi.stubGlobal('fetch', createMockFetch(IAAI_FIXTURE));

      await transport.listVehicles({
        provider: 'iaai',
        perPage: 5,
      });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).toContain('auction_type=2');
      vi.unstubAllGlobals();
    });
  });

  describe('per_page parameter', () => {
    it('per_page reaches transport unchanged', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      await transport.listVehicles({
        provider: 'copart',
        perPage: 5,
      });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).toContain('per_page=5');
      expect(calledUrl).not.toContain('limit=');
      vi.unstubAllGlobals();
    });

    it('uses default per_page=20 when not specified', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      await transport.listVehicles({
        provider: 'copart',
      });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).toContain('per_page=20');
      vi.unstubAllGlobals();
    });
  });

  describe('cursor handling', () => {
    it('cursor is forwarded unchanged', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      await transport.listVehicles({
        provider: 'copart',
        perPage: 5,
        cursor: 'opaque-token-xyz!@#$%',
      });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).toContain('cursor=opaque-token-xyz');
      vi.unstubAllGlobals();
    });

    it('does not send cursor when absent', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      await transport.listVehicles({
        provider: 'copart',
        perPage: 5,
      });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).not.toContain('cursor=');
      vi.unstubAllGlobals();
    });
  });

  describe('provider mismatch detection', () => {
    it('IAAI request returning Copart items throws ProviderMismatchError', async () => {
      vi.stubGlobal('fetch', createMockFetch(CROSS_PROVIDER_FIXTURE));

      await expect(
        transport.listVehicles({ provider: 'iaai', perPage: 5 }),
      ).rejects.toThrow(ProviderMismatchError);

      vi.unstubAllGlobals();
    });

    it('Copart request returning Copart items succeeds', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      const result = await transport.listVehicles({ provider: 'copart', perPage: 5 });
      expect(result.items).toHaveLength(2);
      expect(result.items[0].platform).toBe('copart');

      vi.unstubAllGlobals();
    });
  });

  describe('meta.next_cursor handling', () => {
    it('meta.next_cursor=null means exhausted', async () => {
      vi.stubGlobal('fetch', createMockFetch(EXHAUSTED_FIXTURE));

      const result = await transport.listVehicles({ provider: 'copart', perPage: 5 });

      expect(result.meta.next_cursor).toBeNull();
      expect(result.items).toHaveLength(0);

      vi.unstubAllGlobals();
    });

    it('meta.next_cursor present means continuation token returned', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      const result = await transport.listVehicles({ provider: 'copart', perPage: 5 });

      expect(result.meta.next_cursor).toBe('abc123');

      vi.unstubAllGlobals();
    });

    it('IAAI fixture returns correct next_cursor', async () => {
      vi.stubGlobal('fetch', createMockFetch(IAAI_FIXTURE));

      const result = await transport.listVehicles({ provider: 'iaai', perPage: 5 });

      expect(result.meta.next_cursor).toBe('def456');
      expect(result.meta.prev_cursor).toBe('xyz789');

      vi.unstubAllGlobals();
    });
  });

  describe('request/retry counting', () => {
    it('reports requestCount and retryCount from transport', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      const result = await transport.listVehicles({ provider: 'copart', perPage: 5 });

      expect(result.requestCount).toBe(1);
      expect(result.retryCount).toBe(0);

      vi.unstubAllGlobals();
    });
  });

  describe('error handling', () => {
    it('throws TransportMalformedError when RAPIDAPI_KEY is missing', async () => {
      const noKeyConfig = createMockConfig({ RAPIDAPI_KEY: undefined });
      const t = new RapidApiTransport(noKeyConfig, mockBudget, new Logger('test'));

      await expect(t.listVehicles({ provider: 'copart' })).rejects.toThrow(TransportMalformedError);
    });
  });

  describe('static helpers', () => {
    it('getAuctionType maps copart→1', () => {
      expect(RapidApiTransport.getAuctionType('copart')).toBe(1);
    });

    it('getAuctionType maps iaai→2', () => {
      expect(RapidApiTransport.getAuctionType('iaai')).toBe(2);
    });

    it('getProvider maps 1→copart', () => {
      expect(RapidApiTransport.getProvider(1)).toBe('copart');
    });

    it('getProvider maps 2→iaai', () => {
      expect(RapidApiTransport.getProvider(2)).toBe('iaai');
    });
  });

  describe('URL construction', () => {
    it('does NOT use platform= or page= or limit=', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      await transport.listVehicles({ provider: 'copart', perPage: 5 });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).not.toContain('platform=');
      expect(calledUrl).not.toMatch(/[?&]page=/);
      expect(calledUrl).not.toContain('limit=');

      vi.unstubAllGlobals();
    });

    it('includes additional filters in URL', async () => {
      vi.stubGlobal('fetch', createMockFetch(COPART_FIXTURE));

      await transport.listVehicles({
        provider: 'copart',
        perPage: 5,
        filters: { make: 'Toyota', year: 2020 },
      });

      const calledUrl = (global.fetch as any).mock.calls[0][0];
      expect(calledUrl).toContain('make=Toyota');
      expect(calledUrl).toContain('year=2020');

      vi.unstubAllGlobals();
    });
  });
});
