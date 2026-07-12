/**
 * Provider fetch wrapper with timeout, retry, backoff and deadline awareness.
 *
 * - Per-request abort via AbortSignal.timeout()
 * - Retries network errors, HTTP 429 and retryable 5xx
 * - Does NOT retry ordinary 4xx responses
 * - Parses delta-seconds and HTTP-date Retry-After
 * - Clamps Retry-After and backoff to configured maximum delay
 * - Caps timeouts and delays by remaining job time
 * - Deadline-aware abortable sleep
 * - Redacts API keys and response bodies from logs
 */

import { Logger } from '@nestjs/common';

export interface ProviderFetchConfig {
  requestTimeoutMs: number;
  maxRetryAttempts: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  jobDeadlineMs: number;
}

export type FetchFailureKind =
  | 'NETWORK_ERROR'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'HTTP_4XX'
  | 'DEADLINE_EXCEEDED'
  | 'ABORTED';

export interface FetchFailure {
  kind: FetchFailureKind;
  status?: number;
  message: string;
  retryable: boolean;
}

export interface FetchResult<T> {
  ok: true;
  data: T;
  attempts: number;
}

export interface FetchError {
  ok: false;
  failure: FetchFailure;
  attempts: number;
}

export type ProviderFetchOutcome<T> = FetchResult<T> | FetchError;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type JitterFn = () => number;

const defaultJitter: JitterFn = () => Math.random();

export function parseRetryAfter(
  headerValue: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (headerValue === null || headerValue === undefined) return null;
  const trimmed = headerValue.trim();
  if (trimmed === '') return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds > 0 && trimmed.match(/^\d+$/)) {
    return Math.floor(seconds * 1000);
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const diff = dateMs - now;
    if (diff > 0) return Math.floor(diff);
  }

  return null;
}

export async function providerFetch<T = unknown>(
  url: string,
  headers: Record<string, string>,
  config: ProviderFetchConfig,
  logger: Logger,
  jitter: JitterFn = defaultJitter,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderFetchOutcome<T>> {
  const maxAttempts = config.maxRetryAttempts + 1;
  let lastFailure: FetchFailure | null = null;
  let consecutiveErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const now = Date.now();
    const remainingJob = config.jobDeadlineMs - now;

    if (remainingJob <= 0) {
      lastFailure = {
        kind: 'DEADLINE_EXCEEDED',
        message: 'Provider job deadline exceeded before request',
        retryable: false,
      };
      break;
    }

    const timeoutMs = Math.min(config.requestTimeoutMs, remainingJob);

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        const body = await response.json() as T;
        return { ok: true, data: body, attempts: attempt };
      }

      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return {
          ok: false,
          failure: {
            kind: 'HTTP_4XX',
            status: response.status,
            message: `Provider returned HTTP ${response.status}`,
            retryable: false,
          },
          attempts: attempt,
        };
      }

      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), Date.now());

      lastFailure = {
        kind: response.status === 429 ? 'HTTP_429' : 'HTTP_5XX',
        status: response.status,
        message: `Provider returned HTTP ${response.status}`,
        retryable: RETRYABLE_STATUSES.has(response.status),
      };

      consecutiveErrors++;

      logger.warn(
        `Provider request failed (attempt ${attempt}/${maxAttempts}): HTTP ${response.status}`,
      );

      if (!lastFailure.retryable || attempt >= maxAttempts) {
        break;
      }

      const backoffMs = computeBackoffDelay(consecutiveErrors, config, retryAfterMs, jitter);
      await deadlineAwareSleep(backoffMs, config.jobDeadlineMs);
      continue;

    } catch (error: any) {
      consecutiveErrors++;

      const isAbort = error?.name === 'TimeoutError' || error?.name === 'AbortError';

      if (isAbort) {
        const remainingAfterAbort = config.jobDeadlineMs - Date.now();
        if (remainingAfterAbort <= 0) {
          lastFailure = {
            kind: 'DEADLINE_EXCEEDED',
            message: 'Provider request aborted: job deadline exceeded',
            retryable: false,
          };
          break;
        }
        lastFailure = {
          kind: 'ABORTED',
          message: `Provider request timed out after ${timeoutMs}ms`,
          retryable: true,
        };
      } else {
        lastFailure = {
          kind: 'NETWORK_ERROR',
          message: 'Provider network error',
          retryable: true,
        };
      }

      logger.warn(
        `Provider request error (attempt ${attempt}/${maxAttempts}): ${lastFailure.message}`,
      );

      if (!lastFailure.retryable || attempt >= maxAttempts) {
        break;
      }

      const backoffMs = computeBackoffDelay(consecutiveErrors, config, null, jitter);
      await deadlineAwareSleep(backoffMs, config.jobDeadlineMs);
    }
  }

  return {
    ok: false,
    failure: lastFailure ?? {
      kind: 'NETWORK_ERROR',
      message: 'Unknown provider fetch failure',
      retryable: false,
    },
    attempts: maxAttempts,
  };
}

function computeBackoffDelay(
  consecutiveErrors: number,
  config: ProviderFetchConfig,
  retryAfterMs: number | null,
  jitter: JitterFn,
): number {
  const exponent = Math.min(consecutiveErrors - 1, 10);
  const exponentialMs = config.initialRetryDelayMs * Math.pow(2, exponent);
  const jitteredMs = exponentialMs * jitter();
  const clampedMs = Math.min(jitteredMs, config.maxRetryDelayMs);

  if (retryAfterMs !== null && retryAfterMs > clampedMs) {
    return Math.min(retryAfterMs, config.maxRetryDelayMs);
  }

  return Math.max(0, Math.floor(clampedMs));
}

function deadlineAwareSleep(delayMs: number, jobDeadlineMs: number): Promise<void> {
  const now = Date.now();
  const remaining = jobDeadlineMs - now;

  if (remaining <= 0) {
    return Promise.resolve();
  }

  const actualDelay = Math.min(delayMs, remaining);
  return new Promise<void>((resolve) => {
    setTimeout(resolve, actualDelay);
  });
}
