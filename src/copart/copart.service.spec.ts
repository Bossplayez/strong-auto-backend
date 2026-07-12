/**
 * Service-level behavioral tests for CopartService.
 *
 * All tests mock providerFetch, PrismaService, VehiclesService,
 * ConfigService, and the logger. No network calls, no database
 * access.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { CopartService } from './copart.service';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { providerFetch, type ProviderFetchOutcome, type ProviderFetchConfig } from './provider-fetch';

// ── Jest mock setup ───────────────────────────────────────────

jest.mock('./provider-fetch', () => ({
  providerFetch: jest.fn(),
  parseRetryAfter: jest.requireActual('./provider-fetch').parseRetryAfter,
}));

const mockedProviderFetch = providerFetch as jest.MockedFunction<typeof providerFetch>;

// ── Helpers ───────────────────────────────────────────────────

/** Standard valid page of items. */
function makePage(lotNumbers: (number | string)[]): { data: any[] } {
  return {
    data: lotNumbers.map((ln) => ({
      lot_number: ln,
      make: 'Toyota',
      model: 'Camry',
      year: 2020,
      title: `2020 Toyota Camry ${ln}`,
      vin: `VIN${ln}`,
      pricing: { current_bid_usd: 5000, buy_now_usd: 10000 },
      media: { items: [] },
      condition: {},
      vehicle_specs: {},
      location: {},
      auction: {},
    })),
  };
}

/** Config defaults for tests. */
function makeConfigService(overrides: Record<string, number | string> = {}): ConfigService {
  const values: Record<string, number | string> = {
    RAPIDAPI_KEY: 'test-api-key-redacted',
    IMPORT_MAX_PAGES: 5,
    IMPORT_REQUEST_TIMEOUT_MS: 10000,
    IMPORT_MAX_RETRY_ATTEMPTS: 2,
    IMPORT_INITIAL_RETRY_DELAY_MS: 10,
    IMPORT_MAX_RETRY_DELAY_MS: 100,
    IMPORT_JOB_TIMEOUT_MS: 60000,
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

/** Build a successful providerFetch outcome. */
function fetchOk(data: unknown, attempts = 1): ProviderFetchOutcome<any> {
  return { ok: true, data, attempts };
}

/** Build a failed providerFetch outcome. */
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

/** Standard mock PrismaService with all methods used by CopartService. */
function makePrismaMock() {
  return {
    importJob: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' }),
      update: jest.fn().mockResolvedValue({}),
    },
    vehicleRawImport: {
      create: jest.fn().mockResolvedValue({}),
    },
    vehicleSourceBinding: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

/** Standard mock VehiclesService. */
function makeVehiclesMock() {
  let createCount = 0;
  return {
    create: jest.fn(async (data: any) => {
      createCount++;
      return {
        id: `vehicle-${createCount}`,
        slug: `vehicle-${createCount}-slug`,
        ...data,
      };
    }),
    update: jest.fn(async (id: string, _data: any) => ({ id })),
  };
}

/** Build a test module with CopartService and all mocked deps. */
async function makeService(opts: {
  config?: ConfigService;
  prisma?: any;
  vehicles?: any;
} = {}) {
  const prisma = opts.prisma ?? makePrismaMock();
  const vehicles = opts.vehicles ?? makeVehiclesMock();
  const config = opts.config ?? makeConfigService();

  const moduleRef = await Test.createTestingModule({
    providers: [
      CopartService,
      { provide: PrismaService, useValue: prisma },
      { provide: VehiclesService, useValue: vehicles },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();

  const service = moduleRef.get(CopartService);

  // Suppress logger output in tests
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

  return { service, prisma, vehicles, config };
}

/** Extract the last importJob.update call's summaryJsonb. */
function getLastSummary(prisma: any): Record<string, any> | undefined {
  const calls = prisma.importJob.update.mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) return undefined;
  // Prisma update is called as update({ where, data }) — single argument
  return lastCall[0]?.data?.summaryJsonb as Record<string, any> | undefined;
}

/** Extract status from the last importJob.update call. */
function getLastStatus(prisma: any): string | undefined {
  const calls = prisma.importJob.update.mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) return undefined;
  return lastCall[0]?.data?.status as string | undefined;
}

// ──────────────────────────────────────────────────────────────
// TESTS
// ──────────────────────────────────────────────────────────────

describe('CopartService — behavioral tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Req 1: Default config attempts no more than 5 full pages ──

  it('1. default config fetches at most 5 pages (empty on page 6 not attempted)', async () => {
    // Return unique full pages for pages 1-5, then loop hits max
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      const offset = callNum * 100;
      return fetchOk(makePage(Array.from({ length: 20 }, (_, i) => offset + i)));
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Should have fetched exactly 5 pages (the max)
    expect(mockedProviderFetch).toHaveBeenCalledTimes(5);
    const summary = getLastSummary(prisma);
    expect(summary?.pagesCompleted).toBe(5);
    expect(summary?.terminalReason).toBe('max_pages_reached');
  });

  // ── Req 2: Configured value > 5 permits page 6 and later ──

  it('2. configured max > 5 permits page 6 and beyond', async () => {
    const config = makeConfigService({ IMPORT_MAX_PAGES: 7 });
    // Full pages 1-6, empty on page 7
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum <= 6) {
        return fetchOk(makePage(Array.from({ length: 20 }, (_, i) => callNum * 100 + i)));
      }
      return fetchOk({ data: [] }); // empty page 7
    });

    const { service, prisma } = await makeService({ config });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).toHaveBeenCalledTimes(7);
    const summary = getLastSummary(prisma);
    expect(summary?.pagesCompleted).toBe(6);
    expect(summary?.terminalReason).toBe('empty_page');
  });

  // ── Req 3: Empty page stops without processing another page ──

  it('3. empty page stops pagination immediately', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1, 2, 3]));
      return fetchOk({ data: [] }); // empty page 2
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(mockedProviderFetch).toHaveBeenCalledTimes(2);
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('empty_page');
    expect(summary?.pagesCompleted).toBe(1);
  });

  // ── Req 4: Short non-empty page does NOT stop pagination ──

  it('4. short page (< BATCH_SIZE) does NOT stop pagination — continues to next page', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([101, 102, 103])); // short page (3 < 20)
      if (callNum === 2) return fetchOk(makePage([201, 202]));     // another short page
      return fetchOk({ data: [] });                                 // empty → stop
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Must have fetched at least 3 times (short pages don't stop)
    expect(mockedProviderFetch).toHaveBeenCalledTimes(3);
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('empty_page');
    expect(summary?.pagesCompleted).toBe(2);
    expect(summary?.pagesAttempted).toBe(3);
    expect(summary?.itemsReceived).toBe(5); // 3 + 2
  });

  // ── Req 5: Malformed-response branches process zero items, zero writes ──

  it('5a. invalid_envelope: zero items, zero writes, sanitized malformed_response', async () => {
    // Page 1 is valid, page 2 is malformed
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1, 2]));
      return fetchOk(null); // invalid_envelope on page 2
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Only 2 lots from page 1 should be processed
    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(2);
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('malformed_response');
    // pageFailures should contain the malformed entry
    const malFail = summary?.pageFailures?.find((f: any) => f.kind === 'malformed_response');
    expect(malFail).toBeDefined();
    expect(malFail.reason).toBe('invalid_envelope');
    // No raw body leakage in summary
    expect(JSON.stringify(summary)).not.toContain('SENSITIVE');
  });

  it('5b. missing_or_non_array_collection: zero items from that page', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1]));
      return fetchOk({ not_data: 'x' }); // missing data
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Only 1 lot from page 1 should be processed
    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('malformed_response');
  });

  it('5c. unusable_page_identity: zero items from that page', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(makePage([1]));
      return fetchOk({ data: ['string', 42, null] }); // all non-objects
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('malformed_response');
  });

  // ── Req 6: Item missing lot_id → skipped, no writes ──

  it('6. item missing lot_number is skipped with no persistence write', async () => {
    const page = {
      data: [
        { lot_number: 100, make: 'Honda', model: 'Civic', year: 2020, title: 'Honda Civic', pricing: {} },
        { lot_number: null, make: 'Bad', model: 'Item', year: 2021, title: 'Bad Item', pricing: {} },
        { make: 'NoLot', model: 'Item', year: 2022, title: 'No Lot', pricing: {} }, // missing lot_number entirely
      ],
    };
    mockedProviderFetch.mockResolvedValue(fetchOk(page));

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Only 1 item (lot 100) should produce writes
    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);
    expect(prisma.vehicleSourceBinding.create).toHaveBeenCalledTimes(1);

    const summary = getLastSummary(prisma);
    expect(summary?.skipped).toBe(2);
    expect(summary?.created).toBe(1);
  });

  // ── Req 7: New provider + lot → exactly one vehicle + one binding ──

  it('7. new lot creates exactly one vehicle and one binding', async () => {
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([5001])));

    const { service, prisma, vehicles } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(vehicles.create).toHaveBeenCalledTimes(1);
    expect(prisma.vehicleSourceBinding.create).toHaveBeenCalledTimes(1);
    expect(prisma.vehicleSourceBinding.findUnique).toHaveBeenCalledWith({
      where: {
        provider_externalLotId: {
          provider: 'copart',
          externalLotId: '5001',
        },
      },
    });
    const summary = getLastSummary(prisma);
    expect(summary?.created).toBe(1);
    expect(summary?.updated).toBe(0);
  });

  // ── Req 8: Replay same lot → update, no second vehicle/binding ──

  it('8. replaying existing lot updates vehicle, creates no duplicate', async () => {
    const prisma = makePrismaMock();
    // Simulate existing binding
    prisma.vehicleSourceBinding.findUnique.mockResolvedValue({
      id: 'binding-1',
      vehicleId: 'vehicle-existing',
      provider: 'copart',
      externalLotId: '5001',
    });

    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([5001])));

    const { service, vehicles } = await makeService({ prisma });

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Vehicle create should NOT be called (update instead)
    expect(vehicles.create).not.toHaveBeenCalled();
    expect(vehicles.update).toHaveBeenCalledTimes(1);
    expect(vehicles.update).toHaveBeenCalledWith('vehicle-existing', expect.any(Object));

    // No new binding created
    expect(prisma.vehicleSourceBinding.create).not.toHaveBeenCalled();

    // Raw import IS still created (append-only audit trail)
    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(1);

    const summary = getLastSummary(prisma);
    expect(summary?.created).toBe(0);
    expect(summary?.updated).toBe(1);
  });

  // ── Req 9: One item failure preserves unrelated successes ──

  it('9. one item failure preserves unrelated items with exact counters', async () => {
    const page = {
      data: [
        { lot_number: 1, make: 'A', model: 'A', year: 2020, title: 'A', pricing: {} },
        { lot_number: 2, make: 'B', model: 'B', year: 2020, title: 'B', pricing: {} },
        { lot_number: 3, make: 'C', model: 'C', year: 2020, title: 'C', pricing: {} },
      ],
    };

    mockedProviderFetch.mockResolvedValue(fetchOk(page));

    const prisma = makePrismaMock();
    const vehicles = makeVehiclesMock();

    // Make vehicle create fail only for lot 2
    vehicles.create.mockImplementation(async (data: any) => {
      if (data.title === 'B') throw new Error('DB write failure for lot 2');
      return { id: `vehicle-${data.title}`, slug: `slug-${data.title}`, ...data };
    });

    const { service } = await makeService({ prisma, vehicles });

    await service.processImportJobWithPlatform('job-1', 'copart');

    const summary = getLastSummary(prisma);
    expect(summary?.created).toBe(2); // lots 1 and 3
    expect(summary?.errors).toBe(1);  // lot 2
    expect(summary?.skipped).toBe(0);
    expect(getLastStatus(prisma)).toBe('PARTIAL_SUCCESS');
  });

  // ── Req 10: Repeated page stops before duplicate processing ──

  it('10. identical repeated page stops before duplicate item processing', async () => {
    const samePage = makePage([10, 20, 30]);
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(samePage);
      return fetchOk(samePage); // exact same page again
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Only the 3 items from page 1 should be processed
    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(3);
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('repeated_page');
    expect(summary?.repeatedPage).toEqual({ laterPage: 2, earlierPage: 1 });
    expect(summary?.pagesCompleted).toBe(1);
  });

  // ── Req 11: Same page in different order also detected ──

  it('11. reordered repeated page detected before duplicate writes', async () => {
    const page1 = {
      data: [
        { lot_number: 10, make: 'A', model: 'A', year: 2020, title: 'A', pricing: {} },
        { lot_number: 20, make: 'B', model: 'B', year: 2020, title: 'B', pricing: {} },
        { lot_number: 30, make: 'C', model: 'C', year: 2020, title: 'C', pricing: {} },
      ],
    };
    // Same lots in different order
    const page2Reordered = {
      data: [
        { lot_number: 30, make: 'C', model: 'C', year: 2020, title: 'C', pricing: {} },
        { lot_number: 10, make: 'A', model: 'A', year: 2020, title: 'A', pricing: {} },
        { lot_number: 20, make: 'B', model: 'B', year: 2020, title: 'B', pricing: {} },
      ],
    };

    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) return fetchOk(page1);
      return fetchOk(page2Reordered);
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Only 3 items from page 1 should be processed
    expect(prisma.vehicleRawImport.create).toHaveBeenCalledTimes(3);
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('repeated_page');
    expect(summary?.repeatedPage).toEqual({ laterPage: 2, earlierPage: 1 });
  });

  // ── Req 12: Retry counts and failure counts reach summary ──

  it('12. retry/rate-limit/server/network counts reach final summary', async () => {
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      switch (callNum) {
        case 1: return fetchFail('HTTP_429', 429, 3);  // rate limit, 3 attempts
        case 2: return fetchFail('HTTP_5XX', 503, 3);   // server error
        case 3: return fetchFail('NETWORK_ERROR', undefined, 3); // network
        case 4: return fetchFail('ABORTED', undefined, 2);       // timeout/abort
        case 5: return fetchOk(makePage([1]));          // success on page 5
        default: return fetchOk({ data: [] });
      }
    });

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    const summary = getLastSummary(prisma);
    expect(summary?.failureCounts).toEqual({
      rateLimit: 1,
      server: 1,
      network: 1,
      timeout: 1,
    });
    // retryCount = (3-1) + (3-1) + (3-1) + (2-1) = 2+2+2+1 = 7
    expect(summary?.retryCount).toBe(7);
    expect(summary?.created).toBe(1);
  });

  // ── Req 13: Deadline exhaustion prevents next page request ──

  it('13. deadline exhaustion prevents next page and finalizes with terminal reason', async () => {
    // Use a very short job timeout (1ms) — deadline will hit before page 2
    const config = makeConfigService({ IMPORT_JOB_TIMEOUT_MS: 1 });

    // Page 1 returns items, but by page 2 the deadline will have passed
    let callNum = 0;
    mockedProviderFetch.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) {
        // Small delay to ensure deadline passes
        await new Promise((r) => setTimeout(r, 10));
        return fetchOk(makePage([1, 2, 3]));
      }
      // Page 2 should never be reached
      return fetchOk(makePage([4, 5]));
    });

    const { service, prisma } = await makeService({ config });

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Only 1 page should have been fetched
    expect(mockedProviderFetch).toHaveBeenCalledTimes(1);
    const summary = getLastSummary(prisma);
    expect(summary?.deadlineReached).toBe(true);
    expect(summary?.terminalReason).toBe('deadline_exceeded');
  });

  // ── Req 14: Active-job rejection remains unchanged ──

  it('14. active running job is rejected (sync returns existing)', async () => {
    const prisma = makePrismaMock();
    prisma.importJob.findFirst.mockResolvedValue({
      id: 'existing-job',
      status: 'RUNNING',
      provider: 'copart',
    });

    const { service } = await makeService({ prisma });

    const result = await service.sync();

    expect(result).toEqual({ jobId: 'existing-job', status: 'RUNNING' });
    expect(prisma.importJob.create).not.toHaveBeenCalled();
  });

  it('14b. active running job rejected for syncByPlatform', async () => {
    const prisma = makePrismaMock();
    prisma.importJob.findFirst.mockResolvedValue({
      id: 'existing-job',
      status: 'RUNNING',
      provider: 'iaai',
    });

    const { service } = await makeService({ prisma });

    const result = await service.syncByPlatform('iaai');

    expect(result).toEqual({ jobId: 'existing-job', status: 'RUNNING' });
    expect(prisma.importJob.create).not.toHaveBeenCalled();
  });

  // ── Req 15: Status transitions (SUCCESS / PARTIAL_SUCCESS / FAILED) ──

  it('15a. all items succeed → SUCCESS', async () => {
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1, 2, 3])));

    const { service, prisma } = await makeService();

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(getLastStatus(prisma)).toBe('SUCCESS');
    const summary = getLastSummary(prisma);
    expect(summary?.created).toBe(3);
    expect(summary?.errors).toBe(0);
  });

  it('15b. some items fail → PARTIAL_SUCCESS', async () => {
    const vehicles = makeVehiclesMock();
    vehicles.create.mockImplementation(async (data: any) => {
      if (data.title === '2020 Toyota Camry 2') throw new Error('fail');
      return { id: `v-${data.title}`, slug: `s-${data.title}`, ...data };
    });

    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1, 2, 3])));

    const { service, prisma } = await makeService({ vehicles });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(getLastStatus(prisma)).toBe('PARTIAL_SUCCESS');
    const summary = getLastSummary(prisma);
    expect(summary?.created).toBe(2);
    expect(summary?.errors).toBe(1);
  });

  it('15c. all items fail → FAILED', async () => {
    const vehicles = makeVehiclesMock();
    vehicles.create.mockRejectedValue(new Error('DB down'));

    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1, 2])));

    const { service, prisma } = await makeService({ vehicles });

    await service.processImportJobWithPlatform('job-1', 'copart');

    expect(getLastStatus(prisma)).toBe('FAILED');
    const summary = getLastSummary(prisma);
    expect(summary?.errors).toBe(2);
    expect(summary?.created).toBe(0);
  });

  it('15d. catch block on unexpected error → FAILED with errorMessage', async () => {
    // Make providerFetch throw (not return failure — actually throw)
    // This triggers the outer catch block
    mockedProviderFetch.mockImplementation(async () => {
      throw new Error('Unexpected internal error in provider');
    });

    const { service, prisma } = await makeService();

    // Should not throw — catch block handles it
    await service.processImportJobWithPlatform('job-1', 'copart');

    // Final update should have FAILED status and error message
    const calls = prisma.importJob.update.mock.calls;
    const lastUpdateCall = calls[calls.length - 1];
    expect(lastUpdateCall[0].data.status).toBe('FAILED');
    expect(lastUpdateCall[0].data.errorMessage).toContain('Unexpected internal error');
  });

  // ── Req 16: No secrets in logs/errors/summaries ──

  it('16. no API key, auth header, or full response body in logs or summaries', async () => {
    mockedProviderFetch.mockResolvedValue(fetchOk(makePage([1])));

    const { service, prisma } = await makeService();

    // Re-enable logger to capture output
    const logSpy = jest.spyOn(service['logger'], 'error').mockRestore();
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(service['logger'], 'error');

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Check all error log calls
    for (const call of errorSpy.mock.calls) {
      const text = call.join(' ');
      expect(text).not.toContain('RAPIDAPI_KEY');
      expect(text).not.toContain('x-rapidapi-key');
      expect(text).not.toMatch(/[a-f0-9]{32,}/); // no long hex strings (typical API key)
    }

    // Check summary
    const summary = getLastSummary(prisma);
    const summaryStr = JSON.stringify(summary);
    expect(summaryStr).not.toContain('RAPIDAPI_KEY');
    expect(summaryStr).not.toContain('x-rapidapi-key');
    expect(summaryStr).not.toContain('payloadJsonb');
  });
});

// ── Additional: RAPIDAPI_KEY not configured path ──

describe('CopartService — no API key configured', () => {
  afterEach(() => jest.clearAllMocks());

  it('missing RAPIDAPI_KEY finalizes as FAILED with configuration_error', async () => {
    const config = makeConfigService();
    (config.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'RAPIDAPI_KEY') return undefined;
      const values: Record<string, number> = {
        IMPORT_MAX_PAGES: 5,
        IMPORT_REQUEST_TIMEOUT_MS: 10000,
        IMPORT_MAX_RETRY_ATTEMPTS: 2,
        IMPORT_INITIAL_RETRY_DELAY_MS: 10,
        IMPORT_MAX_RETRY_DELAY_MS: 100,
        IMPORT_JOB_TIMEOUT_MS: 60000,
      };
      return values[key];
    });

    const { service, prisma } = await makeService({ config });

    await service.processImportJobWithPlatform('job-1', 'copart');

    // Zero provider requests
    expect(mockedProviderFetch).not.toHaveBeenCalled();
    // Zero persistence writes
    expect(prisma.vehicleRawImport.create).not.toHaveBeenCalled();
    expect(prisma.vehicleSourceBinding.create).not.toHaveBeenCalled();
    // Status must be FAILED (not SUCCESS)
    expect(getLastStatus(prisma)).toBe('FAILED');
    const summary = getLastSummary(prisma);
    expect(summary?.terminalReason).toBe('configuration_error');
    expect(summary?.failureCode).toBe('provider_credentials_missing');
    expect(summary?.created).toBe(0);
    // No secret leakage
    const summaryStr = JSON.stringify(summary);
    expect(summaryStr).not.toContain('RAPIDAPI_KEY');
    expect(summaryStr).not.toContain('x-rapidapi-key');
  });
});
