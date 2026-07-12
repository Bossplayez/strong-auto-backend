import { providerFetch, parseRetryAfter, type ProviderFetchConfig } from './provider-fetch';
import { Logger } from '@nestjs/common';

// ── Test helpers ──────────────────────────────────────────────

const logger = new Logger('test');

function makeConfig(overrides: Partial<ProviderFetchConfig> = {}): ProviderFetchConfig {
  return {
    requestTimeoutMs: 5000,
    maxRetryAttempts: 2,
    initialRetryDelayMs: 10,
    maxRetryDelayMs: 100,
    jobDeadlineMs: Date.now() + 60000,
    ...overrides,
  };
}

interface MockResp {
  ok?: boolean;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throw?: Error;
}

function mockFetchSequence(responses: MockResp[]): { fetchFn: typeof fetch; getCalls: () => number } {
  let idx = 0;
  let callCount = 0;
  const fetchFn = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    callCount++;
    const r = responses[Math.min(idx, responses.length - 1)];
    idx++;
    if (r.throw) throw r.throw;
    const status = r.status ?? (r.ok ? 200 : 500);
    const ok = r.ok ?? (status >= 200 && status < 300);
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      headers: new Headers(r.headers),
      json: async () => r.body ?? {},
      text: async () => '',
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, getCalls: () => callCount };
}

const noJitter = () => 0;

// ── parseRetryAfter ───────────────────────────────────────────

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-07-12T12:00:00Z');

  it('parses delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120000);
  });

  it('parses single digit', () => {
    expect(parseRetryAfter('5', now)).toBe(5000);
  });

  it('parses HTTP-date in the future', () => {
    const futureDate = 'Wed, 21 Oct 2026 12:00:30 GMT';
    const result = parseRetryAfter(futureDate, now);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('returns null for missing header', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('   ', now)).toBeNull();
  });

  it('returns null for negative delta', () => {
    expect(parseRetryAfter('-5', now)).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseRetryAfter('abc', now)).toBeNull();
  });

  it('returns null for past HTTP-date', () => {
    const pastDate = 'Wed, 21 Oct 2025 12:00:00 GMT';
    expect(parseRetryAfter(pastDate, now)).toBeNull();
  });

  it('returns null for malformed value', () => {
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
  });
});

// ── providerFetch ─────────────────────────────────────────────

describe('providerFetch', () => {
  it('returns data on first success', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([
      { ok: true, body: { data: [1, 2, 3] } },
    ]);

    const result = await providerFetch('https://example.com/api', { 'x-key': 'redacted' }, makeConfig(), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ data: [1, 2, 3] });
      expect(result.attempts).toBe(1);
    }
    expect(getCalls()).toBe(1);
  });

  it('retries on HTTP 429 then succeeds', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { ok: true, body: { data: [] } },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
    expect(getCalls()).toBe(2);
  });

  it('retries on HTTP 503 then succeeds', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([
      { status: 503 },
      { ok: true, body: { ok: true } },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it('does NOT retry on HTTP 404', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ status: 404 }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig(), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('HTTP_4XX');
      expect(result.failure.status).toBe(404);
      expect(result.failure.retryable).toBe(false);
    }
    expect(getCalls()).toBe(1);
  });

  it('does NOT retry on HTTP 400', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ status: 400 }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig(), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('HTTP_4XX');
    expect(getCalls()).toBe(1);
  });

  it('retries on network error then succeeds', async () => {
    const { fetchFn } = mockFetchSequence([
      { throw: new TypeError('fetch failed') },
      { ok: true, body: { recovered: true } },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it('exhausts retries and returns failure', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ status: 500 }, { status: 500 }, { status: 500 }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('HTTP_5XX');
      expect(result.attempts).toBe(3);
    }
    expect(getCalls()).toBe(3);
  });

  it('respects job deadline — stops before request when deadline passed', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ ok: true, body: {} }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ jobDeadlineMs: Date.now() - 1 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('DEADLINE_EXCEEDED');
    expect(getCalls()).toBe(0);
  });

  it('clamps per-request timeout to remaining job time', async () => {
    const { fetchFn } = mockFetchSequence([{ ok: true, body: {} }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ requestTimeoutMs: 5000, jobDeadlineMs: Date.now() + 100 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
  });

  it('Retry-After delta-seconds is respected', async () => {
    const { fetchFn } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { ok: true, body: { ok: true } },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
  });

  it('maximum fetch calls = maxRetryAttempts + 1', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }]);

    await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(getCalls()).toBe(3);
  });

  it('redacts response body from failure message', async () => {
    const { fetchFn } = mockFetchSequence([{ status: 500, body: { secret: 'sensitive-data', apiKey: 'abc123' } }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig(), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).not.toContain('sensitive-data');
      expect(result.failure.message).not.toContain('abc123');
      expect(result.failure.message).toContain('500');
    }
  });

  it('headers are passed to fetch but never logged', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ ok: true, body: {} }]);

    await providerFetch('https://example.com/api', { 'x-rapidapi-key': 'SECRET-KEY-12345' }, makeConfig(), logger, noJitter, fetchFn);

    expect(getCalls()).toBe(1);
  });
});
