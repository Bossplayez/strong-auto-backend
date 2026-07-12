/**
 * Tests for env validation configuration boundaries and cross-field invariants.
 * Tests that every config boundary rejects invalid values and that
 * cross-field invariants are enforced.
 */

// We test the Zod schema directly by importing and parsing.
// Since env.validation.ts exports validateEnv which wraps safeParse,
// we test both the schema (via safeParse) and the wrapper.

import { validateEnv } from './env.validation';

// Helper: build a minimal valid env base
function validEnv(): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_ACCESS_SECRET: 'supersecretkey123456',
    JWT_REFRESH_SECRET: 'supersecretkey123456',
    RAPIDAPI_KEY: 'test-key',
    // Import config with defaults — omitting to test defaults
  };
}

describe('env.validation import config defaults', () => {
  it('applies defaults when import vars are omitted', () => {
    const env = validateEnv(validEnv());
    expect(env.IMPORT_MAX_PAGES).toBe(5);
    expect(env.IMPORT_REQUEST_TIMEOUT_MS).toBe(10000);
    expect(env.IMPORT_MAX_RETRY_ATTEMPTS).toBe(2);
    expect(env.IMPORT_INITIAL_RETRY_DELAY_MS).toBe(500);
    expect(env.IMPORT_MAX_RETRY_DELAY_MS).toBe(10000);
    expect(env.IMPORT_JOB_TIMEOUT_MS).toBe(300000);
  });

  it('accepts overridden values within range', () => {
    const base = validEnv();
    base.IMPORT_MAX_PAGES = 50;
    base.IMPORT_REQUEST_TIMEOUT_MS = 15000;
    base.IMPORT_MAX_RETRY_ATTEMPTS = 3;
    base.IMPORT_INITIAL_RETRY_DELAY_MS = 1000;
    base.IMPORT_MAX_RETRY_DELAY_MS = 20000;
    base.IMPORT_JOB_TIMEOUT_MS = 600000;
    const env = validateEnv(base);
    expect(env.IMPORT_MAX_PAGES).toBe(50);
    expect(env.IMPORT_REQUEST_TIMEOUT_MS).toBe(15000);
    expect(env.IMPORT_MAX_RETRY_ATTEMPTS).toBe(3);
    expect(env.IMPORT_INITIAL_RETRY_DELAY_MS).toBe(1000);
    expect(env.IMPORT_MAX_RETRY_DELAY_MS).toBe(20000);
    expect(env.IMPORT_JOB_TIMEOUT_MS).toBe(600000);
  });
});

describe('env.validation boundary tests', () => {
  // IMPORT_MAX_PAGES: 1..100
  it('rejects IMPORT_MAX_PAGES = 0', () => {
    const base = validEnv();
    base.IMPORT_MAX_PAGES = 0;
    expect(() => validateEnv(base)).toThrow();
  });

  it('rejects IMPORT_MAX_PAGES = 101', () => {
    const base = validEnv();
    base.IMPORT_MAX_PAGES = 101;
    expect(() => validateEnv(base)).toThrow();
  });

  it('accepts IMPORT_MAX_PAGES = 1', () => {
    const base = validEnv();
    base.IMPORT_MAX_PAGES = 1;
    expect(validateEnv(base).IMPORT_MAX_PAGES).toBe(1);
  });

  it('accepts IMPORT_MAX_PAGES = 100', () => {
    const base = validEnv();
    base.IMPORT_MAX_PAGES = 100;
    expect(validateEnv(base).IMPORT_MAX_PAGES).toBe(100);
  });

  // IMPORT_REQUEST_TIMEOUT_MS: 1000..30000
  it('rejects IMPORT_REQUEST_TIMEOUT_MS = 999', () => {
    const base = validEnv();
    base.IMPORT_REQUEST_TIMEOUT_MS = 999;
    expect(() => validateEnv(base)).toThrow();
  });

  it('rejects IMPORT_REQUEST_TIMEOUT_MS = 30001', () => {
    const base = validEnv();
    base.IMPORT_REQUEST_TIMEOUT_MS = 30001;
    expect(() => validateEnv(base)).toThrow();
  });

  it('accepts IMPORT_REQUEST_TIMEOUT_MS = 1000', () => {
    const base = validEnv();
    base.IMPORT_REQUEST_TIMEOUT_MS = 1000;
    expect(validateEnv(base).IMPORT_REQUEST_TIMEOUT_MS).toBe(1000);
  });

  // IMPORT_MAX_RETRY_ATTEMPTS: 0..5
  it('rejects IMPORT_MAX_RETRY_ATTEMPTS = -1', () => {
    const base = validEnv();
    base.IMPORT_MAX_RETRY_ATTEMPTS = -1;
    expect(() => validateEnv(base)).toThrow();
  });

  it('rejects IMPORT_MAX_RETRY_ATTEMPTS = 6', () => {
    const base = validEnv();
    base.IMPORT_MAX_RETRY_ATTEMPTS = 6;
    expect(() => validateEnv(base)).toThrow();
  });

  it('accepts IMPORT_MAX_RETRY_ATTEMPTS = 0', () => {
    const base = validEnv();
    base.IMPORT_MAX_RETRY_ATTEMPTS = 0;
    expect(validateEnv(base).IMPORT_MAX_RETRY_ATTEMPTS).toBe(0);
  });

  // IMPORT_INITIAL_RETRY_DELAY_MS: 100..5000
  it('rejects IMPORT_INITIAL_RETRY_DELAY_MS = 99', () => {
    const base = validEnv();
    base.IMPORT_INITIAL_RETRY_DELAY_MS = 99;
    expect(() => validateEnv(base)).toThrow();
  });

  it('rejects IMPORT_INITIAL_RETRY_DELAY_MS = 5001', () => {
    const base = validEnv();
    base.IMPORT_INITIAL_RETRY_DELAY_MS = 5001;
    expect(() => validateEnv(base)).toThrow();
  });

  // IMPORT_MAX_RETRY_DELAY_MS: 500..30000
  it('rejects IMPORT_MAX_RETRY_DELAY_MS = 499', () => {
    const base = validEnv();
    base.IMPORT_MAX_RETRY_DELAY_MS = 499;
    expect(() => validateEnv(base)).toThrow();
  });

  it('rejects IMPORT_MAX_RETRY_DELAY_MS = 30001', () => {
    const base = validEnv();
    base.IMPORT_MAX_RETRY_DELAY_MS = 30001;
    expect(() => validateEnv(base)).toThrow();
  });

  // IMPORT_JOB_TIMEOUT_MS: 10000..900000
  it('rejects IMPORT_JOB_TIMEOUT_MS = 9999', () => {
    const base = validEnv();
    base.IMPORT_JOB_TIMEOUT_MS = 9999;
    expect(() => validateEnv(base)).toThrow();
  });

  it('rejects IMPORT_JOB_TIMEOUT_MS = 900001', () => {
    const base = validEnv();
    base.IMPORT_JOB_TIMEOUT_MS = 900001;
    expect(() => validateEnv(base)).toThrow();
  });
});

describe('env.validation cross-field invariants', () => {
  it('rejects IMPORT_MAX_RETRY_DELAY_MS < IMPORT_INITIAL_RETRY_DELAY_MS', () => {
    const base = validEnv();
    base.IMPORT_INITIAL_RETRY_DELAY_MS = 3000;
    base.IMPORT_MAX_RETRY_DELAY_MS = 500; // Less than initial (499 < min 500 so use 500)
    // initial=3000 > max=500 → violates invariant
    expect(() => validateEnv(base)).toThrow();
  });

  it('accepts IMPORT_MAX_RETRY_DELAY_MS = IMPORT_INITIAL_RETRY_DELAY_MS (boundary)', () => {
    const base = validEnv();
    base.IMPORT_INITIAL_RETRY_DELAY_MS = 500;
    base.IMPORT_MAX_RETRY_DELAY_MS = 500;
    expect(validateEnv(base).IMPORT_MAX_RETRY_DELAY_MS).toBe(500);
  });

  it('rejects IMPORT_JOB_TIMEOUT_MS < IMPORT_REQUEST_TIMEOUT_MS', () => {
    const base = validEnv();
    base.IMPORT_REQUEST_TIMEOUT_MS = 30000;
    base.IMPORT_JOB_TIMEOUT_MS = 10000; // < request timeout
    expect(() => validateEnv(base)).toThrow();
  });

  it('accepts IMPORT_JOB_TIMEOUT_MS = IMPORT_REQUEST_TIMEOUT_MS (boundary)', () => {
    const base = validEnv();
    base.IMPORT_REQUEST_TIMEOUT_MS = 10000;
    base.IMPORT_JOB_TIMEOUT_MS = 10000;
    expect(validateEnv(base).IMPORT_JOB_TIMEOUT_MS).toBe(10000);
  });
});

describe('env.validation coercion', () => {
  it('coerces string numbers to integers', () => {
    const base = validEnv();
    base.IMPORT_MAX_PAGES = '7';
    base.IMPORT_REQUEST_TIMEOUT_MS = '12000';
    base.IMPORT_MAX_RETRY_ATTEMPTS = '3';
    const env = validateEnv(base);
    expect(env.IMPORT_MAX_PAGES).toBe(7);
    expect(env.IMPORT_REQUEST_TIMEOUT_MS).toBe(12000);
    expect(env.IMPORT_MAX_RETRY_ATTEMPTS).toBe(3);
  });

  it('rejects finite-integer check (NaN)', () => {
    // Zod coerce.number() will reject NaN via min/max constraints,
    // but we also test the runtime check in validateEnv
    const base = validEnv();
    base.IMPORT_MAX_PAGES = 'not-a-number';
    expect(() => validateEnv(base)).toThrow();
  });
});
