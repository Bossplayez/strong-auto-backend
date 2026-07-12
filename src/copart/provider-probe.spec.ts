/**
 * Mock tests for the provider contract probe harness.
 *
 * Verifies all safety controls without making real HTTP requests:
 * - Attempt cap enforcement
 * - Redaction of sensitive values
 * - Host allowlist enforcement
 * - GET-only behavior
 * - Timeout handling
 * - Zero-retry default
 * - No body persistence in output
 */
import { ProviderLeaseService } from './provider-lease.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import {
  createProbeConfigFromEnv,
  sanitizeUrl,
  validateProbeUrl,
  computeStructureHash,
  executeProbe,
  runProbe,
  type ProbeConfig,
} from './provider-probe';

const BASE_CONFIG: ProbeConfig = {
  maxAttempts: 20,
  requestTimeoutMs: 5000,
  totalDeadlineMs: 30000,
  retries: 0,
  allowedHost: 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com',
  baseUrl: 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com',
  apiKey: 'test-key-secret-never-printed',
};

function makeOkResponse(body: any, headers: Record<string, string> = {}): Response {
  return {
    status: 200,
    headers: new Headers(headers),
    json: async () => body,
  } as any;
}

describe('Provider Probe Harness — Safety Controls', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── Attempt cap ──

  it('attempt cap: hard-stops at maxAttempts', async () => {
    const urls = Array(30).fill('https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1');
    const config = { ...BASE_CONFIG, maxAttempts: 5 };

    mockFetch.mockResolvedValue(makeOkResponse({ data: [] }));

    const artifact = await runProbe(config, urls);

    expect(artifact.totalAttempts).toBe(5);
    expect(artifact.responses.length).toBe(5);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('attempt cap: 20 is the absolute hard cap', () => {
    const env = { RAPIDAPI_KEY: 'test', PROBE_MAX_ATTEMPTS: '999' };
    const config = createProbeConfigFromEnv(env);
    expect(config.maxAttempts).toBe(20);
  });

  // ── Redaction ──

  it('redaction: API key never appears in any output', async () => {
    const url = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1';
    mockFetch.mockResolvedValue(makeOkResponse({ data: [{ lot_number: 123, make: 'Ford' }] }));

    const result = await executeProbe(1, url, BASE_CONFIG);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('test-key-secret');
    expect(serialized).not.toContain(BASE_CONFIG.apiKey);
  });

  it('redaction: sensitive query params are redacted in sanitized URLs', () => {
    const { sanitized, redactedKeys } = sanitizeUrl(
      'https://host.example/path?key=secret123&platform=copart&page=1',
    );
    expect(sanitized).toContain('key=[REDACTED]');
    expect(sanitized).not.toContain('secret123');
    expect(sanitized).toContain('platform=copart');
    expect(redactedKeys).toContain('key');
  });

  it('redaction: VIN and seller fields excluded from item field names', async () => {
    const url = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1';
    const body = {
      data: [{
        lot_number: 123,
        make: 'Ford',
        vin: '1HGBH41JXMN109186',
        seller_name: 'John Doe',
        model: 'Fusion',
      }],
    };
    mockFetch.mockResolvedValue(makeOkResponse(body));

    const result = await executeProbe(1, url, BASE_CONFIG);

    expect(result.itemFieldNames).toContain('lot_number');
    expect(result.itemFieldNames).toContain('make');
    expect(result.itemFieldNames).not.toContain('vin');
    expect(result.itemFieldNames).not.toContain('seller_name');
  });

  // ── Host allowlist ──

  it('host allowlist: rejects non-allowlisted host', async () => {
    const url = 'https://evil.example.com/vehicles?page=1';
    const result = await executeProbe(1, url, BASE_CONFIG);

    expect(result.error).toContain('URL validation');
    expect(result.httpStatus).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('host allowlist: rejects non-HTTPS', () => {
    expect(() => validateProbeUrl('http://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/test', BASE_CONFIG.allowedHost))
      .toThrow('HTTPS');
  });

  // ── GET-only ──

  it('GET-only: harness never uses POST/PUT/DELETE', async () => {
    const url = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1';
    mockFetch.mockResolvedValue(makeOkResponse({ data: [] }));

    await runProbe(BASE_CONFIG, [url]);

    const call = mockFetch.mock.calls[0];
    expect(call[1].method).toBe('GET');
  });

  // ── Timeout ──

  it('timeout: request timeout produces error result', async () => {
    const url = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1';
    const config = { ...BASE_CONFIG, requestTimeoutMs: 50 };

    mockFetch.mockImplementation((_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        const signal = opts.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }
      });
    });

    const result = await executeProbe(1, url, config);

    expect(result.error).toBeTruthy();
    expect(result.httpStatus).toBeNull();
  });

  // ── Zero-retry default ──

  it('zero-retry default: retries = 0 by default', () => {
    const env = { RAPIDAPI_KEY: 'test' };
    const config = createProbeConfigFromEnv(env);
    expect(config.retries).toBe(0);
  });

  it('zero-retry default: single 500 response = single attempt', async () => {
    const url = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1';
    mockFetch.mockResolvedValue({ status: 500, headers: new Headers(), json: async () => null } as any);

    const artifact = await runProbe(BASE_CONFIG, [url]);

    expect(artifact.totalAttempts).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── No body persistence ──

  it('no body persistence: response body never appears in artifact', async () => {
    const url = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1';
    const body = {
      data: [{
        lot_number: 12345,
        make: 'Toyota',
        model: 'Camry',
        vin: 'JT2BG22K1W0123456',
        description: 'Rare 1996 Toyota Camry XLE in excellent condition',
      }],
    };
    mockFetch.mockResolvedValue(makeOkResponse(body));

    const result = await executeProbe(1, url, BASE_CONFIG);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('12345');
    expect(serialized).not.toContain('Toyota');
    expect(serialized).not.toContain('Camry');
    expect(serialized).not.toContain('JT2BG22K1W0123456');
    expect(serialized).not.toContain('Rare 1996');
  });

  // ── Attempt numbering ──

  it('attempt numbering: every response is sequentially numbered', async () => {
    const urls = [
      'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1',
      'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=2',
      'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=iaai&page=1',
    ];
    mockFetch.mockResolvedValue(makeOkResponse({ data: [] }));

    const artifact = await runProbe(BASE_CONFIG, urls);

    expect(artifact.responses[0].attemptNumber).toBe(1);
    expect(artifact.responses[1].attemptNumber).toBe(2);
    expect(artifact.responses[2].attemptNumber).toBe(3);
  });

  // ── Sanitized output only contains shapes, not values ──

  it('sanitized output: contains field names and types, not values', async () => {
    const url = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com/vehicles?platform=copart&page=1';
    const body = {
      data: [{
        lot_number: 999,
        make: 'Honda',
        pricing: { current_bid_usd: 5000 },
      }],
    };
    mockFetch.mockResolvedValue(makeOkResponse(body));

    const result = await executeProbe(1, url, BASE_CONFIG);

    expect(result.envelopeShape).toHaveProperty('data');
    expect(result.itemFieldNames).toContain('lot_number');
    expect(result.itemFieldNames).toContain('make');
    expect(result.itemFieldNames).toContain('pricing');
    expect(result.itemCount).toBe(1);
    // No actual values
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('999');
    expect(serialized).not.toContain('Honda');
    expect(serialized).not.toContain('5000');
  });
});
