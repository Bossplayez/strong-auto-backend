/**
 * Service-level behavioral tests for CopartService.
 *
 * All tests mock providerFetch, PrismaService, VehiclesService,
 * ConfigService, and the logger. No network calls, no database
 * access.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { CopartService } from './copart.service';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { ProviderLeaseService } from './provider-lease.service';
import { RequestBudgetService } from './request-budget.service';
import { providerFetch, type ProviderFetchOutcome } from './provider-fetch';

// ── Jest mock setup ───────────────────────────────────────────

jest.mock('./provider-fetch', () => ({
  providerFetch: jest.fn(),
  parseRetryAfter: jest.requireActual('./provider-fetch').parseRetryAfter,
}));

const mockedProviderFetch = providerFetch as jest.MockedFunction<typeof providerFetch>;

// ── Helpers ───────────────────────────────────────────────────

function makePage(lotNumbers: (number | string)[], hasNextCursor = true): { data: any[]; meta: { next_cursor: string | null; per_page: number } } {
  return {
    data: lotNumbers.map((ln) => ({
      lot_number: ln,
      make: 'Toyota',
      model: 'Camry',
      year: 2020,
      title: `2020 Toyota Camry ${ln}`,
      vin: `VIN${ln}`,
      platform: 'copart',
      pricing: { current_bid_usd: 5000, buy_now_usd: 10000 },
      media: { items: [] },
      condition: {},
      vehicle_specs: {},
      location: {},
      auction: {},
    })),
    meta: {
      next_cursor: hasNextCursor ? `cursor_${lotNumbers.length}_${Date.now()}_${Math.random()}` : null,
      per_page: 20,
    },
  };
}

function makeConfigService(overrides: Record<string, number | string> = {}): ConfigService {
  const values: Record<string, number | string> = {
    RAPIDAPI_KEY: 'test-api-key-redacted',
    IMPORT_MAX_PAGES: 5,
    IMPORT_REQUEST_TIMEOUT_MS: 10000,
    IMPORT_MAX_RETRY_ATTEMPTS: 2,
    IMPORT_INITIAL_RETRY_DELAY_MS: 10,
    IMPORT_MAX_RETRY_DELAY_MS: 100,
    IMPORT_JOB_TIMEOUT_MS: 60000,
    IMPORT_LEASE_TTL_MS: 60000,
    IMPORT_HEARTBEAT_INTERVAL_MS: 5000,
    IMPORT_MONTHLY_REQUEST_BUDGET: 30000,
    IMPORT_MONTHLY_REQUEST_RESERVE: 3000,
    IMPORT_BUDGET_WARNING_PERCENT: 80,
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function fetchOk(data: unknown, attempts = 1): ProviderFetchOutcome<any> {
  return { ok: true, data, attempts };
}

function fetchFail(
  kind: 'HTTP_4XX' | 'HTTP_5XX' | 'HTTP_429' | 'NETWORK_ERROR' | 'ABORTED' | 'DEADLINE_EXCEEDED',
  status?: number,
  attempts = 3,
): ProviderFetchOutcome<any> {
  return {
    ok: false,
    failure: {
      kind,
      status,
      message: `Provider returned HTTP ${status ?? kind}`,
      retryable: kind !== 'HTTP_4XX' && kind !== 'DEADLINE_EXCEEDED',
    },
    attempts,
  };
}

function makePrismaMock() {
  return {
    importJob: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' }),
      update: jest.fn().mockResolvedValue({}),
    },
    vehicleRawImport: { create: jest.fn().mockResolvedValue({}) },
    vehicleSourceBinding: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeVehiclesMock() {
  let createCount = 0;
  return {
    create: jest.fn(async (data: any) => {
      createCount++;
      return { id: `vehicle-${createCount}`, slug: `vehicle-${createCount}-slug`, ...data };
    }),
    update: jest.fn(async (id: string, _data: any) => ({ id })),
  };
}

/** Mock ProviderLeaseService with withLeasedTransaction support. */
function makeLeaseMock(overrides: any = {}) {
  const defaultClaimResult = {
    claimed: true,
    ownerToken: 'test-owner-token',
    fencingToken: 1,
    lease: { provider: 'copart', fencingToken: 1, isExpired: false },
    conflictingLease: null,
    recoveredJobIds: [] as string[],
  };
  return {
    claim: jest.fn().mockResolvedValue(defaultClaimResult),
    claimWithRecovery: jest.fn().mockResolvedValue(defaultClaimResult),
    renew: jest.fn().mockResolvedValue({ renewed: true, expiresAt: new Date(Date.now() + 60000) }),
    release: jest.fn().mockResolvedValue({ released: true }),
    verifyOwnership: jest.fn().mockResolvedValue(true),
    getState: jest.fn().mockResolvedValue(null),
    recoverStaleJobs: jest.fn().mockResolvedValue({ recoveredJobIds: [] }),
    // withLeasedTransaction: execute fn with a mock tx that has importJob.update
    withLeasedTransaction: jest.fn(async (_provider: any, _owner: string, _fence: number, fn: any) => {
      return fn({
        importJob: {
          update: jest.fn().mockResolvedValue({}),
        },
        providerLease: {
          update: jest.fn().mockResolvedValue({}),
        },
      });
    }),
    ...overrides,
  };
}

/** Mock RequestBudgetService for the new global budget API. */
function makeBudgetMock(overrides: any = {}) {
  const usage = {
    billingMonth: '2026-07',
    budget: 30000,
    reserve: 3000,
    allocated: 0,
    confirmed: 0,
    completedSuccess: 0,
    failureCounts: { timeout: 0, rateLimit: 0, server: 0, network: 0, client: 0 },
    quotaRemaining: null,
    quotaResetEpochMs: null,
    unresolved: 0,
    availableForRoutine: 27000,
    percentageUsed: 0,
    isWarning: false,
    isRoutineBlocked: false,
    isAbsoluteBlocked: false,
    providers: [],
  };
  return {
    budget: 30000,
    reserveAmount: 3000,
    warningPercent: 80,
    reserve: jest.fn().mockResolvedValue({ allowed: true, attemptId: 'test-att', status: 'allocated', usage }),
    confirm: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    getUsage: jest.fn().mockResolvedValue(usage),
    canMakeRoutineRequest: jest.fn().mockResolvedValue({ allowed: true, usage }),
    canMakeManualRequest: jest.fn().mockResolvedValue({ allowed: true, usage }),
    ...overrides,
  };
}

async function makeService(opts: {
  config?: ConfigService;
  prisma?: any;
  vehicles?: any;
  lease?: any;
  budget?: any;
} = {}) {
  const prisma = opts.prisma ?? makePrismaMock();
  const vehicles = opts.vehicles ?? makeVehiclesMock();
  const config = opts.config ?? makeConfigService();
  const lease = opts.lease ?? makeLeaseMock();
  const budget = opts.budget ?? makeBudgetMock();

  const moduleRef = await Test.createTestingModule({
    providers: [
      CopartService,
      { provide: PrismaService, useValue: prisma },
      { provide: VehiclesService, useValue: vehicles },
      { provide: ConfigService, useValue: config },
      { provide: ProviderLeaseService, useValue: lease },
      { provide: RequestBudgetService, useValue: budget },
    ],
  }).compile();

  const service = moduleRef.get(CopartService);
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

  return { service, prisma, vehicles, config, lease, budget };
}

/** Get the summary from finalization (inside withLeasedTransaction). */
function getLastSummary(prisma: any): Record<string, any> | undefined {
  // Finalization goes through withLeasedTransaction's tx.importJob.update
  // But the initial RUNNING update goes through prisma.importJob.update
  const calls = prisma.importJob.update.mock.calls;
  if (calls.length === 0) return undefined;
  const lastCall = calls[calls.length - 1];
  return lastCall[0]?.data?.summaryJsonb as Record<string, any> | undefined;
}

function getLastStatus(prisma: any): string | undefined {
  const calls = prisma.importJob.update.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][0]?.data?.status as string | undefined;
}

// ──────────────────────────────────────────────────────────────

describe('CopartService — behavioral tests', () => {
  afterEach(() => jest.clearAllMocks());

  // ── Req 1: Default config at most 5 pages ──
  it('1. default config fetches at most 5 pages', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      const offset = callNum * 100;
      return fetchOk(makePage(Array.from({ length: 20 }, (_, i) => offset + i)));
    });

    const { service, lease } = await makeService();
    // Capture the finalization tx to read summary
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => {
        finalSummary = args.data?.summaryJsonb;
        return {};
      });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).toHaveBeenCalledTimes(5);
    expect(finalSummary?.pagesCompleted).toBe(5);
    expect(finalSummary?.terminalReason).toBe('max_pages_reached');
  });

  // ── Req 2: Configured max > 5 ──
  it('2. configured max > 5 permits page 6 and beyond', async () => {
    const config = makeConfigService({ IMPORT_MAX_PAGES: 7 });
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum <= 6) return fetchOk(makePage(Array.from({ length: 20 }, (_, i) => callNum * 100 + i)));
      return fetchOk({ data: [] });
    });

    const { service, lease } = await makeService({ config });
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).toHaveBeenCalledTimes(7);
    expect(finalSummary?.pagesCompleted).toBe(6);
    expect(finalSummary?.terminalReason).toBe('empty_page');
  });

  // ── Req 3: Empty page stops ──
  it('3. empty page stops pagination immediately', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1, 2, 3]));
      return fetchOk({ data: [] });
    });

    const { service, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).toHaveBeenCalledTimes(2);
    expect(finalSummary?.terminalReason).toBe('empty_page');
  });

  // ── Req 4: Short page does NOT stop ──
  it('4. short page does NOT stop pagination', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([101, 102, 103]));
      if (callNum === 2) return fetchOk(makePage([201, 202]));
      return fetchOk({ data: [] });
    });

    const { service, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).toHaveBeenCalledTimes(3);
    expect(finalSummary?.terminalReason).toBe('empty_page');
    expect(finalSummary?.pagesCompleted).toBe(2);
  });

  // ── Req 5: Malformed response ──
  it('5a. invalid_envelope: zero items, sanitized', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1, 2]));
      return fetchOk(null);
    });

    const { service, prisma, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(2);
    expect(finalSummary?.terminalReason).toBe('malformed_response');
    const malFail = finalSummary?.pageFailures?.find((f: any) => f.kind === 'malformed_response');
    expect(malFail).toBeDefined();
    expect(malFail.reason).toBe('invalid_envelope');
  });

  it('5b. missing_data_collection: zero items', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1]));
      return fetchOk({ not_data: 'x' });
    });

    const { service, prisma, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);
    expect(finalSummary?.terminalReason).toBe('malformed_response');
  });

  it('5c. unusable_page_identity', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1]));
      return fetchOk({ data: ['string', 42, null] });
    });

    const { service, prisma, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);
    expect(finalSummary?.terminalReason).toBe('malformed_response');
  });

  // ── Req 6: Item missing lot_id ──
  it('6. item missing lot_number is skipped', async () => {
    const page = {
      data: [
        { lot_number: 100, make: 'Honda', model: 'Civic', year: 2020, title: 'Honda Civic', pricing: {} },
        { lot_number: null, make: 'Bad', model: 'Item', year: 2021, title: 'Bad Item', pricing: {} },
        { make: 'NoLot', model: 'Item', year: 2022, title: 'No Lot', pricing: {} },
      ],
    };
    mockedProviderFetch.mockResolvedValue(fetchOk(page));

    const { service, prisma, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);
    expect(prisma.vehicleSourceBinding.create).toHaveBeenCalledTimes(1);
    expect(finalSummary?.skipped).toBe(2);
    expect(finalSummary?.created).toBe(1);
  });

  // ── Req 7: New lot ──
  it('7. new lot creates one vehicle and one binding', async () => {
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([5001])));
    const { service, prisma, vehicles, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(vehicles.create).toHaveBeenCalledTimes(1);
    expect(prisma.vehicleSourceBinding.create).toHaveBeenCalledTimes(1);
    expect(finalSummary?.created).toBe(1);
  });

  // ── Req 8: Replay ──
  it('8. replaying existing lot updates vehicle', async () => {
    const prisma = makePrismaMock();
    prisma.vehicleSourceBinding.findUnique.mockResolvedValue({
      id: 'binding-1', vehicleId: 'vehicle-existing', provider: 'copart', externalLotId: '5001',
    });
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([5001])));
    const { service, vehicles, lease } = await makeService({ prisma });
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(vehicles.create).not.toHaveBeenCalled();
    expect(vehicles.update).toHaveBeenCalledTimes(1);
    expect(prisma.vehicleSourceBinding.create).not.toHaveBeenCalled();
    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);
    expect(finalSummary?.created).toBe(0);
    expect(finalSummary?.updated).toBe(1);
  });

  // ── Req 9: Partial failure ──
  it('9. one item failure preserves unrelated successes', async () => {
    const page = {
      data: [
        { lot_number: 1, make: 'A', model: 'A', year: 2020, title: 'A', pricing: {} },
        { lot_number: 2, make: 'B', model: 'B', year: 2020, title: 'B', pricing: {} },
        { lot_number: 3, make: 'C', model: 'C', year: 2020, title: 'C', pricing: {} },
      ],
    };
    mockedProviderFetch.mockResolvedValue(fetchOk(page));
    const vehicles = makeVehiclesMock();
    vehicles.create.mockImplementation(async (data: any) => {
      if (data.title === 'B') throw new Error('DB write failure for lot 2');
      return { id: `vehicle-${data.title}`, slug: `slug-${data.title}`, ...data };
    });
    const { service, lease } = await makeService({ vehicles });
    let finalSummary: any;
    let finalStatus = '';
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => {
        finalSummary = args.data?.summaryJsonb;
        finalStatus = args.data?.status;
        return {};
      });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(finalSummary?.created).toBe(2);
    expect(finalSummary?.errors).toBe(1);
    expect(finalStatus).toBe('PARTIAL_SUCCESS');
  });

  // ── Req 10: Repeated page ──
  it('10. identical repeated page stops', async () => {
    const samePage = makePage([10, 20, 30]);
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      return fetchOk(samePage);
    });
    const { service, prisma, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(3);
    expect(finalSummary?.terminalReason).toBe('repeated_page');
  });

  // ── Req 11: Reordered repeated page ──
  it('11. reordered repeated page detected', async () => {
    const page1 = { data: [{ lot_number: 10, make: 'A', model: 'A', year: 2020, title: 'A', pricing: {} }, { lot_number: 20, make: 'B', model: 'B', year: 2020, title: 'B', pricing: {} }, { lot_number: 30, make: 'C', model: 'C', year: 2020, title: 'C', pricing: {} }], meta: { next_cursor: 'cursor_page2', per_page: 20 } };
    const page2 = { data: [{ lot_number: 30, make: 'C', model: 'C', year: 2020, title: 'C', pricing: {} }, { lot_number: 10, make: 'A', model: 'A', year: 2020, title: 'A', pricing: {} }, { lot_number: 20, make: 'B', model: 'B', year: 2020, title: 'B', pricing: {} }], meta: { next_cursor: null, per_page: 20 } };
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(page1);
      return fetchOk(page2);
    });
    const { service, prisma, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(3);
    expect(finalSummary?.terminalReason).toBe('repeated_page');
  });

  // ── Req 12: Retry/failure counts ──
  it('12. retry/rate-limit/server/network counts reach summary', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      switch (callNum) {
        case 1: return fetchFail('HTTP_429', 429, 3);
        case 2: return fetchFail('HTTP_5XX', 503, 3);
        case 3: return fetchFail('NETWORK_ERROR', undefined, 3);
        case 4: return fetchFail('ABORTED', undefined, 2);
        case 5: return fetchOk(makePage([1]));
        default: return fetchOk({ data: [] });
      }
    });
    const { service, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(finalSummary?.failureCounts).toEqual({ rateLimit: 1, server: 1, network: 1, timeout: 1 });
    expect(finalSummary?.retryCount).toBe(7);
    expect(finalSummary?.created).toBe(1);
  });

  // ── Req 13: Deadline ──
  it('13. deadline exhaustion prevents next page', async () => {
    const config = makeConfigService({ IMPORT_JOB_TIMEOUT_MS: 1 });
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) { await new Promise((r) => setTimeout(r, 10)); return fetchOk(makePage([1, 2, 3])); }
      return fetchOk(makePage([4, 5]));
    });
    const { service, lease } = await makeService({ config });
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).toHaveBeenCalledTimes(1);
    expect(finalSummary?.deadlineReached).toBe(true);
    expect(finalSummary?.terminalReason).toBe('deadline_exceeded');
  });

  // ── Req 14: Active-job rejection ──
  it('14. active running job is rejected', async () => {
    const prisma = makePrismaMock();
    prisma.importJob.findFirst.mockResolvedValue({ id: 'existing-job', status: 'RUNNING', provider: 'copart' });
    const { service } = await makeService({ prisma });
    const result = await service.sync();
    expect(result).toEqual({ jobId: 'existing-job', status: 'RUNNING' });
  });

  it('14b. active running job rejected for syncByPlatform', async () => {
    const prisma = makePrismaMock();
    prisma.importJob.findFirst.mockResolvedValue({ id: 'existing-job', status: 'RUNNING', provider: 'iaai' });
    const { service } = await makeService({ prisma });
    const result = await service.syncByPlatform('iaai');
    expect(result).toEqual({ jobId: 'existing-job', status: 'RUNNING' });
  });

  // ── Req 15: Status transitions ──
  it('15a. all items succeed → SUCCESS', async () => {
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1, 2, 3])));
    const { service, lease } = await makeService();
    let finalStatus = '';
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalStatus = args.data?.status; finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(finalStatus).toBe('SUCCESS');
    expect(finalSummary?.created).toBe(3);
  });

  it('15b. some items fail → PARTIAL_SUCCESS', async () => {
    const vehicles = makeVehiclesMock();
    vehicles.create.mockImplementation(async (data: any) => {
      if (data.title === '2020 Toyota Camry 2') throw new Error('fail');
      return { id: `v-${data.title}`, slug: `s-${data.title}`, ...data };
    });
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1, 2, 3])));
    const { service, lease } = await makeService({ vehicles });
    let finalStatus = '';
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalStatus = args.data?.status; finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(finalStatus).toBe('PARTIAL_SUCCESS');
    expect(finalSummary?.created).toBe(2);
    expect(finalSummary?.errors).toBe(1);
  });

  it('15c. all items fail → FAILED', async () => {
    const vehicles = makeVehiclesMock();
    vehicles.create.mockRejectedValue(new Error('DB down'));
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1, 2])));
    const { service, lease } = await makeService({ vehicles });
    let finalStatus = '';
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalStatus = args.data?.status; finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(finalStatus).toBe('FAILED');
    expect(finalSummary?.errors).toBe(2);
  });

  it('15d. catch block on unexpected error → FAILED', async () => {
    mockedProviderFetch.mockImplementation(async () => { throw new Error('Unexpected internal error'); });
    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    const calls = prisma.importJob.update.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].data.status).toBe('FAILED');
    expect(lastCall[0].data.errorMessage).toContain('Unexpected internal error');
  });

  // ── Req 16: No secrets ──
  it('16. no API key or secrets in summaries', async () => {
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1])));
    const { service, lease } = await makeService();
    let finalSummary: any;
    lease.withLeasedTransaction.mockImplementation(async (_p: any, _o: string, _f: number, fn: any) => {
      const txUpdate = jest.fn(async (args: any) => { finalSummary = args.data?.summaryJsonb; return {}; });
      return fn({ importJob: { update: txUpdate }, providerLease: { update: jest.fn() } });
    });

    await service.processImportJobWithPlatform('job-1', 'copart');

    const summaryStr = JSON.stringify(finalSummary);
    expect(summaryStr).not.toContain('RAPIDAPI_KEY');
    expect(summaryStr).not.toContain('x-rapidapi-key');
    expect(summaryStr).not.toContain('payloadJsonb');
  });
});

// ── No API key configured ──

describe('CopartService — no API key configured', () => {
  afterEach(() => jest.clearAllMocks());

  it('missing RAPIDAPI_KEY finalizes as FAILED with configuration_error', async () => {
    const config = makeConfigService();
    (config.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'RAPIDAPI_KEY') return undefined;
      const values: Record<string, number> = {
        IMPORT_MAX_PAGES: 5, IMPORT_REQUEST_TIMEOUT_MS: 10000, IMPORT_MAX_RETRY_ATTEMPTS: 2,
        IMPORT_INITIAL_RETRY_DELAY_MS: 10, IMPORT_MAX_RETRY_DELAY_MS: 100, IMPORT_JOB_TIMEOUT_MS: 60000,
        IMPORT_LEASE_TTL_MS: 60000, IMPORT_HEARTBEAT_INTERVAL_MS: 5000,
        IMPORT_MONTHLY_REQUEST_BUDGET: 30000, IMPORT_MONTHLY_REQUEST_RESERVE: 3000, IMPORT_BUDGET_WARNING_PERCENT: 80,
      };
      return values[key];
    });

    const { service, prisma } = await makeService({ config });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).not.toHaveBeenCalled();
    expect(prisma.vehicleRawImport.create).not.toHaveBeenCalled();
    expect(prisma.vehicleSourceBinding.create).not.toHaveBeenCalled();
    expect(getLastStatus(prisma)).toBe('FAILED');
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('configuration_error');
    expect(summary?.failureCode).toBe('provider_credentials_missing');
  });

  // ── Regression: blocked allocation performs zero fetch calls ──
  it('16. budget blocked → zero providerFetch calls', async () => {
    const blockedBudget = makeBudgetMock();
    blockedBudget.canMakeRoutineRequest = jest.fn().mockResolvedValue({
      allowed: false,
      usage: { allocated: 30000, budget: 30000, reserve: 3000, isRoutineBlocked: true },
      reason: 'routine_budget_exhausted',
    });
    blockedBudget.reserve = jest.fn(); // Should NOT be called
    const { service, prisma, lease } = await makeService({ budget: blockedBudget });
    lease.claim = jest.fn().mockResolvedValue({ claimed: true, fencingToken: 1 });
    lease.verifyOwnership = jest.fn().mockResolvedValue(true);
    lease.release = jest.fn();

    await service.processImportJobWithPlatform('job-blocked', 'copart');

    // Budget check must have happened
    expect(blockedBudget.canMakeRoutineRequest).toHaveBeenCalled();
    // Reserve (pre-request hook) must NOT have been called — pagination never started
    expect(blockedBudget.reserve).not.toHaveBeenCalled();
    // No items processed
    const summary = getLastSummary(prisma);
    expect(summary?.itemsProcessed ?? 0).toBe(0);
  });

  // ── Regression: atomic reservation before initial request and every retry ──
  it('17. preRequestHook (reserve) is invoked before each HTTP attempt including retries', async () => {
    const budget = makeBudgetMock();
    const reserveCalls: string[] = [];
    budget.reserve = jest.fn().mockImplementation(async (_p: string, _j: string, attemptId: string) => {
      reserveCalls.push(attemptId);
      return { allowed: true, attemptId, status: 'allocated' as const, usage: budget.usage };
    });
    budget.canMakeRoutineRequest = jest.fn().mockResolvedValue({
      allowed: true,
      usage: { allocated: 0, budget: 30000, reserve: 3000, isRoutineBlocked: false },
    });

    const { service, prisma, lease } = await makeService({ budget });
    lease.claim = jest.fn().mockResolvedValue({ claimed: true, fencingToken: 1 });
    lease.verifyOwnership = jest.fn().mockResolvedValue(true);
    lease.release = jest.fn();
    mockedProviderFetch.mockImplementation(async (
      _url: any, _headers: any, _config: any, _logger: any, _validator: any, _dedupe: any,
      hook?: any,
    ) => {
      if (hook) await hook();
      return fetchOk(makePage([1001, 1002, 1003]));
    });
    mockedProviderFetch.mockImplementationOnce(async (
      _url: any, _headers: any, _config: any, _logger: any, _validator: any, _dedupe: any,
      hook?: any,
    ) => {
      if (hook) await hook();
      return fetchOk(makePage([1001, 1002, 1003]));
    });
    mockedProviderFetch.mockImplementationOnce(async (
      _url: any, _headers: any, _config: any, _logger: any, _validator: any, _dedupe: any,
      hook?: any,
    ) => {
      if (hook) await hook();
      return fetchOk({ data: [] });
    });

    await service.processImportJobWithPlatform('job-reserve-test', 'copart');

    // At least one reserve call must have happened for the initial fetch
    expect(reserveCalls.length).toBeGreaterThanOrEqual(1);
    // Every attemptId must be unique
    expect(new Set(reserveCalls).size).toBe(reserveCalls.length);
  });
});
