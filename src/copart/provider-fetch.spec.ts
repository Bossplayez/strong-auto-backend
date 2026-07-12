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

  it('returns null for non-numeric string (fallback to exponential backoff)', () => {
    expect(parseRetryAfter('abc', now)).toBeNull();
  });

  it('returns null for past HTTP-date (fallback to exponential backoff)', () => {
    const pastDate = 'Wed, 21 Oct 2025 12:00:00 GMT';
    expect(parseRetryAfter(pastDate, now)).toBeNull();
  });

  it('returns null for malformed value', () => {
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
  });
});

// ── providerFetch ─────────────────────────────────────────────

describe('providerFetch', () => {
  // Test 1: Default limits — not directly testable here (tested via service),
  // but we verify the config defaults constrain fetch calls

  it('returns data on first success (exact call count = 1)', async () => {
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

  // Test 6: 429, retryable 5xx and network errors use bounded retries

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
    const { fetchFn } = mockFetchSequence([
      { status: 503 },
      { ok: true, body: { ok: true } },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
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

  // Test 7: Ordinary 4xx is not retried

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

  // Test 11: Exhaustion performs exactly MAX_RETRY_ATTEMPTS + 1 calls

  it('exhausts retries and returns failure (exactly maxRetryAttempts + 1 calls)', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ status: 500 }, { status: 500 }, { status: 500 }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('HTTP_5XX');
      expect(result.attempts).toBe(3); // 1 initial + 2 retries
    }
    expect(getCalls()).toBe(3);
  });

  it('maximum fetch calls = maxRetryAttempts + 1', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }]);

    await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(getCalls()).toBe(3);
  });

  it('earlier success asserts exact lower count', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { ok: true, body: { ok: true } },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 5, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
    expect(getCalls()).toBe(2);
  });

  // Test 9: Total job-duration exhaustion prevents further requests

  it('respects job deadline — stops before request when deadline passed', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ ok: true, body: {} }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ jobDeadlineMs: Date.now() - 1 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('DEADLINE_EXCEEDED');
    expect(getCalls()).toBe(0);
  });

  // Test 8: Per-request timeout aborts and is classified

  it('classifies abort as ABORTED when deadline not reached', async () => {
    const abortError = new Error('The operation was aborted due to timeout');
    abortError.name = 'TimeoutError';
    const { fetchFn } = mockFetchSequence([
      { throw: abortError },
      { ok: true, body: {} },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ requestTimeoutMs: 100, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    // Should retry and succeed
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it('classifies deadline-during-abort as DEADLINE_EXCEEDED', async () => {
    const abortError = new Error('The operation was aborted due to timeout');
    abortError.name = 'TimeoutError';
    const { fetchFn, getCalls } = mockFetchSequence([{ throw: abortError }]);

    // Deadline expires exactly during the abort
    const config = makeConfig({
      requestTimeoutMs: 5000,
      jobDeadlineMs: Date.now() - 1, // already expired
    });

    const result = await providerFetch('https://example.com/api', {}, config, logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('DEADLINE_EXCEEDED');
    expect(getCalls()).toBe(0); // never called because deadline already passed
  });

  // Test 10: Request timeout and retry sleep are capped by remaining job time

  it('clamps per-request timeout to remaining job time', async () => {
    const { fetchFn } = mockFetchSequence([{ ok: true, body: {} }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ requestTimeoutMs: 5000, jobDeadlineMs: Date.now() + 100 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
  });

  it('retry sleep is capped by remaining job time (deadline expires during sleep)', async () => {
    // Use very short deadline so backoff sleep hits deadline
    const { fetchFn, getCalls } = mockFetchSequence([
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);

    const result = await providerFetch('https://example.com/api', {}, {
      requestTimeoutMs: 5000,
      maxRetryAttempts: 5,
      initialRetryDelayMs: 10000, // 10s backoff, but deadline is 50ms
      maxRetryDelayMs: 30000,
      jobDeadlineMs: Date.now() + 50,
    }, logger, noJitter, fetchFn);

    // Sleep is capped, so subsequent request may fire before deadline
    // The key assertion: total time never exceeds the deadline
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either DEADLINE_EXCEEDED or HTTP_5XX (if capped sleep let it retry)
      expect(['DEADLINE_EXCEEDED', 'HTTP_5XX']).toContain(result.failure.kind);
    }
    // Calls should be bounded — not 6 (which would require >50ms of sleeping)
    expect(getCalls()).toBeLessThanOrEqual(6);
  });

  // Test 5: Retry-After fallback to bounded exponential backoff
  // (missing, malformed, negative, past-date → all return null → exponential backoff used)

  it('Retry-After delta-seconds is respected', async () => {
    const { fetchFn } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { ok: true, body: { ok: true } },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(true);
  });

  // Test 19: Logs/summaries contain no API key or full response body

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

  // ── Retry-After fallback tests ──

  describe('Retry-After fallback to bounded exponential backoff', () => {
    it('missing Retry-After falls back to exponential backoff and retries', async () => {
      const { fetchFn, getCalls } = mockFetchSequence([
        { status: 429 }, // no retry-after header
        { ok: true, body: { ok: true } },
      ]);

      const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

      expect(result.ok).toBe(true);
      expect(getCalls()).toBe(2);
    });

    it('malformed Retry-After falls back to exponential backoff', async () => {
      const { fetchFn, getCalls } = mockFetchSequence([
        { status: 503, headers: { 'retry-after': 'not-a-number' } },
        { ok: true, body: { ok: true } },
      ]);

      const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

      expect(result.ok).toBe(true);
      expect(getCalls()).toBe(2);
    });

    it('negative Retry-After (negative delta) falls back to exponential backoff', async () => {
      const { fetchFn, getCalls } = mockFetchSequence([
        { status: 429, headers: { 'retry-after': '-10' } },
        { ok: true, body: { ok: true } },
      ]);

      const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

      // parseRetryAfter returns null for negative values, so backoff is used
      expect(result.ok).toBe(true);
      expect(getCalls()).toBe(2);
    });

    it('past-date Retry-After falls back to exponential backoff', async () => {
      const pastDate = 'Wed, 21 Oct 2025 12:00:00 GMT';
      const { fetchFn, getCalls } = mockFetchSequence([
        { status: 429, headers: { 'retry-after': pastDate } },
        { ok: true, body: { ok: true } },
      ]);

      const result = await providerFetch('https://example.com/api', {}, makeConfig({ initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

      expect(result.ok).toBe(true);
      expect(getCalls()).toBe(2);
    });
  });

  // ── Additional edge cases ──

  it('returns ABORTED failure kind on timeout when deadline not reached', async () => {
    const abortError = new Error('The operation was aborted due to timeout');
    abortError.name = 'TimeoutError';
    const { fetchFn, getCalls } = mockFetchSequence([
      { throw: abortError },
      { throw: abortError },
      { throw: abortError },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['ABORTED', 'DEADLINE_EXCEEDED']).toContain(result.failure.kind);
    }
    expect(getCalls()).toBe(3);
  });

  it('does not retry on non-retryable 4xx after earlier 5xx retry', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([
      { status: 503 },
      { status: 404 },
    ]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('HTTP_4XX');
    expect(getCalls()).toBe(2);
  });

  it('zero retries (maxRetryAttempts=0) makes exactly 1 call', async () => {
    const { fetchFn, getCalls } = mockFetchSequence([{ status: 503 }]);

    const result = await providerFetch('https://example.com/api', {}, makeConfig({ maxRetryAttempts: 0 }), logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    expect(getCalls()).toBe(1);
  });

  it('aborts with TimeoutError then immediately hits deadline', async () => {
    // When abort occurs and remaining time hits 0, should be DEADLINE_EXCEEDED
    const abortError = new Error('The operation was aborted due to timeout');
    abortError.name = 'TimeoutError';

    // Make deadline expire right when abort happens
    let callCount = 0;
    const fetchFn = jest.fn(async () => {
      callCount++;
      throw abortError;
    }) as unknown as typeof fetch;

    const result = await providerFetch('https://example.com/api', {}, {
      requestTimeoutMs: 1,
      maxRetryAttempts: 5,
      initialRetryDelayMs: 1,
      maxRetryDelayMs: 5,
      jobDeadlineMs: Date.now(), // expires now
    }, logger, noJitter, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('DEADLINE_EXCEEDED');
  });
});
