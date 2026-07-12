/**
 * Bounded read-only provider contract probe harness.
 *
 * This module provides a SAFE, BOUNDED inspection tool for RapidAPI
 * auction endpoints. It is completely separate from the import
 * persistence pipeline and performs NO writes to the application
 * database.
 *
 * Safety controls:
 * - Hard maximum 20 HTTP attempts (configurable via --max-attempts)
 * - GET requests only
 * - Host allowlist restricted to configured auction RapidAPI host
 * - Configurable per-request timeout and total probe deadline
 * - No cookies, no admin credentials, no production DB
 * - API key read from environment, NEVER printed
 * - Output is sanitized: no keys, no VINs, no full payloads, no raw bodies
 * - Every attempt is numbered for quota auditability
 * - Default retries = 0 (every HTTP call counts against the cap)
 */

import { Logger } from '@nestjs/common';

/** Allowed HTTP methods for probing. */
type ProbeMethod = 'GET';

/** Sanitized response shape — no sensitive data. */
export interface SanitizedResponse {
  attemptNumber: number;
  method: ProbeMethod;
  url: string; // sanitized — query param NAMES only, values redacted for sensitive fields
  httpStatus: number | null;
  /** Response header names only (no values) relevant to quota/pagination */
  relevantHeaderNames: string[];
  /** Top-level envelope shape (field names and types, NOT values) */
  envelopeShape: Record<string, string>;
  /** Item count in response */
  itemCount: number;
  /** Field names present in items (union across all items) */
  itemFieldNames: string[];
  /** Stable hash of the response structure (NOT content) */
  structureHash: string;
  /** Error if request failed */
  error: string | null;
  /** Duration in ms */
  durationMs: number;
}

/** Probe configuration. */
export interface ProbeConfig {
  /** Hard maximum HTTP attempts (default 20, hard cap 20) */
  maxAttempts: number;
  /** Per-request timeout in ms (default 15000) */
  requestTimeoutMs: number;
  /** Total probe deadline in ms (default 120000) */
  totalDeadlineMs: number;
  /** Retry attempts (default 0 — every call counts against cap) */
  retries: number;
  /** Allowed host (must match exactly) */
  allowedHost: string;
  /** API key (read from environment, never printed) */
  apiKey: string;
  /** Base URL for the API */
  baseUrl: string;
}

/** Probe result artifact. */
export interface ProbeArtifact {
  startedAt: string;
  finishedAt: string;
  config: {
    maxAttempts: number;
    requestTimeoutMs: number;
    totalDeadlineMs: number;
    retries: number;
    allowedHost: string;
    baseUrl: string;
  };
  totalAttempts: number;
  totalSucceeded: number;
  totalFailed: number;
  responses: SanitizedResponse[];
  /** Sensitive parameter values that were redacted in URLs */
  redactedKeys: string[];
}

/** Headers considered relevant for quota/pagination analysis. */
const RELEVANT_HEADER_NAMES = new Set([
  'x-ratelimit-requests-limit',
  'x-ratelimit-requests-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-quota-limit',
  'x-quota-remaining',
  'x-quota-reset',
  'link',
  'x-total-count',
  'x-total-pages',
  'x-page',
  'x-per-page',
  'content-range',
  'pagination-count',
  'pagination-page',
  'pagination-per-page',
]);

/** Keys whose values must be redacted in sanitized output. */
const SENSITIVE_QUERY_PARAMS = new Set([
  'key', 'apikey', 'api_key', 'token', 'auth', 'password',
]);

/** Fields that must NOT appear in sanitized item field lists (PII/sensitive). */
const SENSITIVE_ITEM_FIELDS = new Set([
  'vin', 'seller_name', 'seller_email', 'seller_phone',
  'owner_name', 'contact_name', 'contact_email', 'contact_phone',
]);

/**
 * Create a probe configuration from environment variables with
 * safe defaults. Throws if required variables are missing.
 */
export function createProbeConfigFromEnv(env: NodeJS.ProcessEnv): ProbeConfig {
  const apiKey = env.RAPIDAPI_KEY;
  if (!apiKey) {
    throw new Error('RAPIDAPI_KEY environment variable is required for probing');
  }

  const maxAttempts = Math.min(
    parseInt(env.PROBE_MAX_ATTEMPTS ?? '20', 10) || 20,
    20, // hard cap
  );

  return {
    maxAttempts,
    requestTimeoutMs: parseInt(env.PROBE_REQUEST_TIMEOUT_MS ?? '15000', 10) || 15000,
    totalDeadlineMs: parseInt(env.PROBE_TOTAL_DEADLINE_MS ?? '120000', 10) || 120000,
    retries: parseInt(env.PROBE_RETRIES ?? '0', 10) || 0,
    allowedHost: 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com',
    baseUrl: 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com',
    apiKey,
  };
}

/**
 * Sanitize a URL for safe output: keep path and parameter NAMES,
 * redact sensitive parameter VALUES.
 */
export function sanitizeUrl(url: string): { sanitized: string; redactedKeys: string[] } {
  const redactedKeys: string[] = [];
  try {
    const parsed = new URL(url);
    const params: string[] = [];
    parsed.searchParams.forEach((value, key) => {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        params.push(`${key}=[REDACTED]`);
        redactedKeys.push(key);
      } else {
        // Keep non-sensitive values for reproducibility
        params.push(`${key}=${value}`);
      }
    });
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return {
      sanitized: `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`,
      redactedKeys,
    };
  } catch {
    return { sanitized: '[invalid-url]', redactedKeys };
  }
}

/**
 * Compute a structural hash of the response shape (not content).
 * Uses field names and their JSON types.
 */
export function computeStructureHash(data: unknown): string {
  const crypto = require('crypto');
  const shape = describeShape(data);
  const json = JSON.stringify(shape);
  return crypto.createHash('sha256').update(json).digest('hex').substring(0, 16);
}

/** Recursively describe the shape of a value as field→type. */
function describeShape(value: unknown, depth = 0): any {
  if (depth > 3) return '...';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return [describeShape(value[0], depth + 1)];
  }
  const t = typeof value;
  if (t === 'object') {
    const result: Record<string, any> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) {
      result[key] = describeShape(obj[key], depth + 1);
    }
    return result;
  }
  return t;
}

/**
 * Extract item field names from a response, filtering out sensitive fields.
 */
function extractItemFieldNames(items: any[]): string[] {
  const fieldSet = new Set<string>();
  for (const item of items.slice(0, 5)) { // sample first 5
    if (item && typeof item === 'object') {
      for (const key of Object.keys(item)) {
        if (!SENSITIVE_ITEM_FIELDS.has(key.toLowerCase())) {
          fieldSet.add(key);
        }
      }
    }
  }
  return Array.from(fieldSet).sort();
}

/**
 * Validate that a URL is safe for probing:
 * - Must be HTTPS
 * - Host must match the allowlist
 * - Must be a GET request
 */
export function validateProbeUrl(url: string, allowedHost: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Probe URL must be HTTPS: ${url}`);
  }
  if (parsed.host !== allowedHost) {
    throw new Error(`Probe URL host "${parsed.host}" not in allowlist (expected "${allowedHost}")`);
  }
}

/**
 * Execute a single probe request and return a sanitized result.
 * Performs NO writes. Uses AbortController for timeout.
 */
export async function executeProbe(
  attemptNumber: number,
  url: string,
  config: ProbeConfig,
  logger?: Logger,
): Promise<SanitizedResponse> {
  const start = Date.now();
  const method: ProbeMethod = 'GET';

  // Validate URL safety
  try {
    validateProbeUrl(url, config.allowedHost);
  } catch (err) {
    return {
      attemptNumber,
      method,
      url: sanitizeUrl(url).sanitized,
      httpStatus: null,
      relevantHeaderNames: [],
      envelopeShape: {},
      itemCount: 0,
      itemFieldNames: [],
      structureHash: '',
      error: `URL validation: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    config.requestTimeoutMs,
  );

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'x-rapidapi-host': config.allowedHost,
        'x-rapidapi-key': config.apiKey,
      },
      signal: controller.signal,
    });

    // Extract relevant header NAMES only (no values)
    const relevantHeaderNames: string[] = [];
    response.headers.forEach((_value, name) => {
      if (RELEVANT_HEADER_NAMES.has(name.toLowerCase())) {
        relevantHeaderNames.push(name);
      }
    });

    // Parse response body
    const body = await response.json().catch(() => null);

    // Determine envelope shape and items
    let items: any[] = [];
    let envelopeShape: Record<string, string> = {};

    if (body && typeof body === 'object') {
      envelopeShape = describeShape(body) as Record<string, string>;
      // Try to find the items array
      if (Array.isArray((body as any).data)) {
        items = (body as any).data;
      } else if (Array.isArray(body)) {
        items = body;
      }
    }

    const { sanitized } = sanitizeUrl(url);

    return {
      attemptNumber,
      method,
      url: sanitized,
      httpStatus: response.status,
      relevantHeaderNames: relevantHeaderNames.sort(),
      envelopeShape,
      itemCount: items.length,
      itemFieldNames: extractItemFieldNames(items),
      structureHash: computeStructureHash(body),
      error: null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const { sanitized } = sanitizeUrl(url);
    return {
      attemptNumber,
      method,
      url: sanitized,
      httpStatus: null,
      relevantHeaderNames: [],
      envelopeShape: {},
      itemCount: 0,
      itemFieldNames: [],
      structureHash: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Run a sequence of probe requests within configured bounds.
 * Hard-stops at maxAttempts. Every attempt is numbered.
 */
export async function runProbe(
  config: ProbeConfig,
  urls: string[],
  logger?: Logger,
): Promise<ProbeArtifact> {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + config.totalDeadlineMs;
  const responses: SanitizedResponse[] = [];
  const allRedactedKeys: string[] = [];
  let attemptCount = 0;

  for (const url of urls) {
    // Check hard caps BEFORE each attempt
    if (attemptCount >= config.maxAttempts) {
      logger?.warn(`Probe hard-stop: max attempts (${config.maxAttempts}) reached`);
      break;
    }
    if (Date.now() >= deadline) {
      logger?.warn(`Probe hard-stop: total deadline (${config.totalDeadlineMs}ms) reached`);
      break;
    }

    attemptCount++;
    const result = await executeProbe(attemptCount, url, config, logger);
    responses.push(result);

    // Retry handling (each retry counts against cap)
    if (!result.error && result.httpStatus && result.httpStatus >= 500) {
      for (let r = 0; r < config.retries; r++) {
        if (attemptCount >= config.maxAttempts) break;
        if (Date.now() >= deadline) break;
        attemptCount++;
        const retryResult = await executeProbe(attemptCount, url, config, logger);
        responses.push(retryResult);
        if (!retryResult.error && retryResult.httpStatus && retryResult.httpStatus < 500) break;
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const totalSucceeded = responses.filter((r) => r.httpStatus !== null && r.httpStatus >= 200 && r.httpStatus < 300).length;
  const totalFailed = responses.length - totalSucceeded;

  return {
    startedAt,
    finishedAt,
    config: {
      maxAttempts: config.maxAttempts,
      requestTimeoutMs: config.requestTimeoutMs,
      totalDeadlineMs: config.totalDeadlineMs,
      retries: config.retries,
      allowedHost: config.allowedHost,
      baseUrl: config.baseUrl,
    },
    totalAttempts: responses.length,
    totalSucceeded,
    totalFailed,
    responses,
    redactedKeys: allRedactedKeys,
  };
}
