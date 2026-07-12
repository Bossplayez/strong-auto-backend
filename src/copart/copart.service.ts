import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { normalizeFuelType, normalizeDriveType, normalizeBodyType } from '../common/normalization';
import {
  providerFetch,
  type ProviderFetchConfig,
  type FetchFailureKind,
} from './provider-fetch';
import { validateProviderResponse, type MalformedReason } from './response-validator';

interface PageFailure {
  page: number;
  kind: FetchFailureKind | 'malformed_response';
  status?: number;
  reason?: MalformedReason;
}

/** Terminal reason codes for the pagination loop. */
type TerminalReason =
  | 'completed'
  | 'max_pages_reached'
  | 'empty_page'
  | 'repeated_page'
  | 'malformed_response'
  | 'deadline_exceeded'
  | 'non_retryable_http_error'
  | 'all_pages_failed'
  | 'configuration_error';

/** Stable machine-readable failure codes for non-success job outcomes. */
type FailureCode =
  | 'provider_credentials_missing'
  | 'budget_exhausted'
  | 'lease_lost'
  | 'provider_http_error'
  | 'provider_malformed_response'
  | 'internal_error';

/**
 * Order-independent page identity: a sorted set of normalized provider
 * lot IDs extracted from the page's `data` array.
 *
 * Only provider lot IDs are used — mutable fields like bid, price,
 * title, or item order are excluded.  Multiplicity is preserved via
 * repetition in the sorted array (duplicate lot IDs within a single
 * page are retained so that a page with [A, A, B] is distinct from
 * a page with [A, B]).
 */
type PageIdentity = string[];

/** Counts of failures by kind, for the extended summary. */
interface FailureCounts {
  timeout: number;
  rateLimit: number;
  server: number;
  network: number;
}

@Injectable()
export class CopartService {
  private readonly logger = new Logger(CopartService.name);
  private readonly RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
  private readonly RAPIDAPI_BASE = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
  private readonly BATCH_SIZE = 20; // API returns max 20 per request

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vehiclesService: VehiclesService,
  ) {}

  /** Build a ProviderFetchConfig from validated env vars. */
  private getFetchConfig(): ProviderFetchConfig {
    return {
      requestTimeoutMs: this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')!,
      maxRetryAttempts: this.config.get<number>('IMPORT_MAX_RETRY_ATTEMPTS')!,
      initialRetryDelayMs: this.config.get<number>('IMPORT_INITIAL_RETRY_DELAY_MS')!,
      maxRetryDelayMs: this.config.get<number>('IMPORT_MAX_RETRY_DELAY_MS')!,
      jobDeadlineMs: 0, // set per-job in processImportJobWithPlatform
    };
  }

  /** Configured max pages (replaces hardcoded MAX_PAGES). */
  private get maxPages(): number {
    return this.config.get<number>('IMPORT_MAX_PAGES')!;
  }

  async sync(): Promise<{ jobId: string; status: string }> {
    // Check for active jobs
    const activeJob = await this.prisma.importJob.findFirst({
      where: { provider: 'copart', status: { in: ['PENDING', 'RUNNING'] } },
    });

    if (activeJob) {
      this.logger.warn(`Import job ${activeJob.id} is still running`);
      return { jobId: activeJob.id, status: activeJob.status };
    }

    const job = await this.prisma.importJob.create({
      data: {
        provider: 'copart',
        mode: 'full_sync',
        status: 'PENDING',
      },
    });

    this.logger.log(`Created import job: ${job.id}`);

    // Process async
    setImmediate(() => this.processImportJob(job.id));

    return { jobId: job.id, status: 'PENDING' };
  }

  async syncByPlatform(platform: 'copart' | 'iaai'): Promise<{ jobId: string; status: string }> {
    const activeJob = await this.prisma.importJob.findFirst({
      where: { provider: platform, status: { in: ['PENDING', 'RUNNING'] } },
    });

    if (activeJob) {
      this.logger.warn(`Import job ${activeJob.id} is still running`);
      return { jobId: activeJob.id, status: activeJob.status };
    }

    const job = await this.prisma.importJob.create({
      data: {
        provider: platform,
        mode: 'full_sync',
        status: 'PENDING',
      },
    });

    this.logger.log(`Created ${platform} import job: ${job.id}`);

    setImmediate(() => this.processImportJobWithPlatform(job.id, platform));

    return { jobId: job.id, status: 'PENDING' };
  }

  async processImportJob(jobId: string): Promise<void> {
    await this.processImportJobWithPlatform(jobId, 'copart');
  }

  async processImportJobWithPlatform(jobId: string, platform: 'copart' | 'iaai'): Promise<void> {
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const pageFailures: PageFailure[] = [];

    const jobStartMs = Date.now();
    const jobTimeoutMs = this.config.get<number>('IMPORT_JOB_TIMEOUT_MS')!;
    const jobDeadlineMs = jobStartMs + jobTimeoutMs;
    const fetchConfig = this.getFetchConfig();
    fetchConfig.jobDeadlineMs = jobDeadlineMs;

    try {
      const apiKey = this.config.get('RAPIDAPI_KEY');

      if (!apiKey) {
        this.logger.warn('Provider credentials not configured — finalizing job as FAILED');
        await this.prisma.importJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            summaryJsonb: {
              provider: platform,
              created: 0,
              updated: 0,
              skipped: 0,
              errors: 0,
              pagesAttempted: 0,
              pagesCompleted: 0,
              itemsReceived: 0,
              retryCount: 0,
              failureCounts: { timeout: 0, rateLimit: 0, server: 0, network: 0 },
              pageFailures: [],
              deadlineReached: false,
              repeatedPage: null,
              terminalReason: 'configuration_error',
              failureCode: 'provider_credentials_missing',
              note: 'Provider credentials not configured',
              jobDurationMs: Date.now() - jobStartMs,
              maxPagesConfig: this.maxPages,
            } as any,
          },
        });
        return;
      }

      const headers = {
        'x-rapidapi-host': this.RAPIDAPI_HOST,
        'x-rapidapi-key': apiKey,
      };

      // ──────────────────────────────────────────────────────────────
      // Pagination loop — with response validation, duplicate-page
      // detection, and terminal-reason classification.
      //
      // RAW IMPORT BEHAVIOUR (append-only):
      //   Every lot that passes item-level validation is persisted to
      //   `VehicleRawImport` *before* upserting the vehicle record.
      //   This is intentionally append-only: re-runs of the same job
      //   (or overlapping jobs) will create duplicate raw-import rows
      //   rather than updating existing ones.  This preserves a full
      //   audit trail of provider payloads.  Deduplication happens at
      //   the `VehicleSourceBinding` level (unique on provider +
      //   externalLotId), not at the raw-import level.
      // ──────────────────────────────────────────────────────────────

      const lots: Record<string, any>[] = [];
      let page = 1;
      let deadlineReached = false;
      let terminalReason: TerminalReason | null = null;
      let repeatedPage: { laterPage: number; earlierPage: number } | null = null;
      const pageIdentities: Map<number, PageIdentity> = new Map();
      const failureCounts: FailureCounts = { timeout: 0, rateLimit: 0, server: 0, network: 0 };
      let pagesAttempted = 0;
      let pagesCompleted = 0;
      let retryCount = 0;
      let itemsReceived = 0;

      while (page <= this.maxPages) {
        const remaining = jobDeadlineMs - Date.now();
        if (remaining <= 0) {
          this.logger.warn(`Import job deadline (${jobTimeoutMs}ms) reached at page ${page}`);
          deadlineReached = true;
          terminalReason = 'deadline_exceeded';
          break;
        }

        pagesAttempted++;

        const url = `${this.RAPIDAPI_BASE}/vehicles?platform=${platform}&page=${page}&limit=${this.BATCH_SIZE}`;
        this.logger.log(`Fetching ${platform} page ${page}/${this.maxPages} (remaining: ${Math.floor(remaining / 1000)}s)`);

        const result = await providerFetch<any>(
          url,
          headers,
          { ...fetchConfig, jobDeadlineMs },
          this.logger,
        );

        if (!result.ok) {
          const f = result.failure;
          retryCount += result.attempts - 1;

          // Classify failure for counts
          if (f.kind === 'HTTP_429') failureCounts.rateLimit++;
          else if (f.kind === 'HTTP_5XX') failureCounts.server++;
          else if (f.kind === 'NETWORK_ERROR') failureCounts.network++;
          else if (f.kind === 'ABORTED' || f.kind === 'DEADLINE_EXCEEDED') failureCounts.timeout++;

          this.logger.error(
            `Provider fetch failed at page ${page}: ${f.kind}${f.status ? ` (${f.status})` : ''} — ${f.message} [attempts: ${result.attempts}]`,
          );
          pageFailures.push({ page, kind: f.kind, status: f.status });

          // Non-retryable 4xx: stop pagination entirely
          if (f.kind === 'HTTP_4XX') {
            this.logger.warn(`Stopping pagination: non-retryable HTTP ${f.status}`);
            terminalReason = 'non_retryable_http_error';
            break;
          }

          // Deadline exceeded: stop with what we have
          if (f.kind === 'DEADLINE_EXCEEDED') {
            deadlineReached = true;
            terminalReason = 'deadline_exceeded';
            break;
          }

          // Retryable failure that exhausted all retries: advance to next page
          page++;
          continue;
        }

        // ── Validate top-level response shape ──
        const validation = validateProviderResponse(result.data);

        if (!validation.ok) {
          this.logger.error(
            `Malformed provider response at page ${page}: ${validation.reason} — ${validation.detail}`,
          );
          pageFailures.push({ page, kind: 'malformed_response', reason: validation.reason });
          terminalReason = 'malformed_response';
          // Process zero items from this response, stop pagination
          break;
        }

        const data = validation.items as Record<string, any>[];

        // ── Empty page: terminal signal ──
        if (data.length === 0) {
          this.logger.log(`Empty page at ${page}, stopping pagination`);
          terminalReason = terminalReason ?? 'empty_page';
          break;
        }

        // ── Duplicate page detection (order-independent) ──
        // Build a sorted, normalized lot-ID set from the page.
        // The same lot IDs in a different order produce the same
        // identity, so a reordered repeat is caught.
        const currentPageId: PageIdentity = buildPageIdentity(data);

        // Check against all previously seen page identities
        let isDuplicatePage = false;
        let duplicateOfPage = 0;
        for (const [prevPage, prevId] of pageIdentities) {
          if (identitiesEqual(currentPageId, prevId)) {
            isDuplicatePage = true;
            duplicateOfPage = prevPage;
            break;
          }
        }

        if (isDuplicatePage) {
          this.logger.warn(
            `Page ${page} repeats lot identifiers from page ${duplicateOfPage}, stopping before duplicate processing`,
          );
          repeatedPage = { laterPage: page, earlierPage: duplicateOfPage };
          terminalReason = 'repeated_page';
          break;
        }

        pageIdentities.set(page, currentPageId);

        // ── Item-level validation: filter out items missing lot_number ──
        const validItems: Record<string, any>[] = [];
        for (const item of data) {
          if (item === null || typeof item !== 'object') {
            skipped++;
            continue;
          }
          if (item.lot_number === null || item.lot_number === undefined) {
            skipped++;
            // Do NOT create raw import, binding or vehicle records
            continue;
          }
          validItems.push(item);
        }

        const skippedThisPage = data.length - validItems.length;
        if (skippedThisPage > 0) {
          this.logger.warn(`Page ${page}: skipped ${skippedThisPage} items missing provider lot ID`);
        }

        lots.push(...validItems);
        itemsReceived += data.length;
        pagesCompleted++;

        this.logger.log(
          `Fetched ${data.length} vehicles from page ${page} (${validItems.length} valid, total: ${lots.length}) [attempts: ${result.attempts}]`,
        );

        // NOTE: Short-page termination has been intentionally removed.
        // The provider's pagination contract is unverified — a short
        // page may simply mean the API returned fewer items, not that
        // we've reached the end.  Continue until an explicit stop
        // signal (empty page, repeated page, configured max, deadline,
        // malformed response, or terminal provider failure).
        page++;
      }

      // Set terminal reason if loop completed without other signal
      if (terminalReason === null) {
        terminalReason = pagesCompleted > 0 ? 'max_pages_reached' : 'all_pages_failed';
      }

      this.logger.log(
        `Total vehicles to process: ${lots.length}${deadlineReached ? ' (deadline reached)' : ''} [terminal: ${terminalReason}]`,
      );

      // ── Process validated lots ──
      for (const raw of lots) {
        try {
          const mapped = this.mapRawToVehicle(raw, platform);

          // Store raw import (append-only — see note above)
          await this.prisma.vehicleRawImport.create({
            data: {
              provider: platform,
              externalLotId: String(raw.lot_number),
              importJobId: jobId,
              payloadJsonb: raw as any,
            },
          });

          // Check if vehicle already exists (deduplication via VehicleSourceBinding)
          const existing = await this.prisma.vehicleSourceBinding.findUnique({
            where: {
              provider_externalLotId: {
                provider: platform,
                externalLotId: String(raw.lot_number),
              },
            },
          });

          if (existing) {
            // Replay: update existing vehicle, no duplicate created
            await this.vehiclesService.update(existing.vehicleId, mapped);
            updated++;
          } else {
            const vehicle = await this.vehiclesService.create({
              ...mapped,
              sourceType: platform === 'iaai' ? 'IAAI' : 'COPART',
              sourceRegion: 'USA',
            });

            const pricing = raw.pricing ?? {};
            await this.prisma.vehicleSourceBinding.create({
              data: {
                vehicleId: vehicle.id,
                provider: platform,
                externalLotId: String(raw.lot_number),
                externalUrl: `https://www.${platform}.com/lot/${raw.lot_number}`,
                saleStatus: raw.auction?.state,
                currentBidAmount: pricing.current_bid_usd ?? 0,
                buyNowAmount: pricing.buy_now_usd ?? 0,
                lastSyncedAt: new Date(),
              },
            });

            created++;
          }
        } catch (error) {
          errors++;
          this.logger.error(`Failed to process lot ${raw.lot_number}: ${error}`);
        }
      }

      const jobDurationMs = Date.now() - jobStartMs;
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: errors > 0 && created + updated === 0 ? 'FAILED' : errors > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          finishedAt: new Date(),
          summaryJsonb: {
            provider: platform,
            created,
            updated,
            skipped,
            errors,
            pagesAttempted,
            pagesCompleted,
            itemsReceived,
            retryCount,
            failureCounts,
            pageFailures,
            deadlineReached,
            repeatedPage,
            terminalReason,
            jobDurationMs,
            maxPagesConfig: this.maxPages,
          } as any,
        },
      });

      this.logger.log(
        `Import job ${jobId} completed: ${created} created, ${updated} updated, ${skipped} skipped, ${errors} errors [${terminalReason}]`,
      );
    } catch (error) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      this.logger.error(`Import job ${jobId} failed: ${error}`);
    }
  }

  // ── Helper: compare two page signatures ──
  // Not claimed as a concurrency-safe ordering guarantee — only used
  // within a single job's sequential pagination to detect if the
  // provider returns the same ordered lot identifiers twice.

  mapRawToVehicle(raw: Record<string, any>, platform: 'copart' | 'iaai') {
    const year = Number(raw.year) || new Date().getFullYear();
    const make = String(raw.make ?? 'Unknown').trim();
    const model = String(raw.model ?? 'Unknown').trim();

    // Extract images from media.items
    const mediaUrls = (raw.media?.items ?? [])
      .map((img: any) => (typeof img === 'string' ? img : img.large ?? img.full ?? img.thumb ?? ''))
      .filter(Boolean);

    // Extract pricing
    const pricing = raw.pricing ?? {};
    const currentBid = pricing.current_bid_usd ?? pricing.current_bid2_usd ?? 0;
    const buyNow = pricing.buy_now_usd ?? 0;

    // Extract condition
    const condition = raw.condition ?? {};

    // Extract specs
    const specs = raw.vehicle_specs ?? {};
    const engine = specs.engine ?? {};

    // External URL
    const externalUrl = `https://www.${platform}.com/lot/${raw.lot_number}`;

    return {
      title: raw.title ?? `${year} ${make} ${model}`,
      make,
      model,
      year,
      priceAmount: Number(currentBid),
      buyNowAmount: Number(buyNow),
      vin: raw.vin,
      odometerValue: raw.odometer?.km ? Number(raw.odometer.km) : undefined,
      odometerUnit: 'km',
      bodyType: normalizeBodyType(specs.body_style) ?? undefined,
      fuelType: normalizeFuelType(specs.fuel_type) ?? undefined,
      transmission: specs.transmission,
      driveType: normalizeDriveType(specs.drive_type) ?? undefined,
      damagePrimary: condition.primary_damage,
      damageSecondary: condition.secondary_damage,
      hasKeys: condition.has_key,
      locationCountry: 'US',
      locationState: raw.location?.state,
      locationCity: raw.location?.display,
      mediaUrls,
      auctionDate: raw.auction?.auction_at ? new Date(raw.auction.auction_at) : undefined,
      auctionStatus: raw.auction?.state,
      sellerType: raw.seller?.type,
      externalUrl,
      specs: {
        engineVolume: engine.size_l,
        enginePower: engine.hp,
        cylinders: engine.raw,
        color: specs.exterior_color,
        keysAvailable: condition.has_key,
        lotNumber: String(raw.lot_number),
      },
    };
  }

  // =====================
  // Search & Single Import
  // =====================

  async search(params: {
    platform?: 'copart' | 'iaai';
    page?: number;
    limit?: number;
    make?: string;
    model?: string;
    year_from?: number;
    year_to?: number;
    search?: string;
  }): Promise<{ items: Record<string, any>[]; total: number; page: number; hasMore: boolean }> {
    const apiKey = this.config.get('RAPIDAPI_KEY');
    if (!apiKey) throw new Error('RAPIDAPI_KEY not configured');

    const platform = params.platform ?? 'copart';
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 50);

    const url = new URL(`${this.RAPIDAPI_BASE}/vehicles`);
    url.searchParams.set('platform', platform);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));
    if (params.make) url.searchParams.set('make', params.make);
    if (params.model) url.searchParams.set('model', params.model);
    if (params.year_from) url.searchParams.set('year_from', String(params.year_from));
    if (params.year_to) url.searchParams.set('year_to', String(params.year_to));
    if (params.search) url.searchParams.set('search', params.search);

    this.logger.log(`Searching ${platform}: page ${page}, limit ${limit}`);

    const result = await providerFetch<any>(
      url.toString(),
      {
        'x-rapidapi-host': this.RAPIDAPI_HOST,
        'x-rapidapi-key': apiKey,
      },
      { ...this.getFetchConfig(), jobDeadlineMs: Date.now() + this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')! * 2 },
      this.logger,
    );

    if (!result.ok) {
      throw new Error(`Provider search error: ${result.failure.kind}${result.failure.status ? ` (${result.failure.status})` : ''}`);
    }

    const body = result.data;
    const items = body?.data ?? [];

    // Mark items that are already imported
    const lotNumbers = items.map((v: any) => String(v.lot_number)).filter(Boolean);
    const existingBindings = lotNumbers.length > 0
      ? await this.prisma.vehicleSourceBinding.findMany({
          where: { provider: platform, externalLotId: { in: lotNumbers } },
          select: { externalLotId: true },
        })
      : [];
    const existingSet = new Set(existingBindings.map((b) => b.externalLotId));
    items.forEach((v: any) => {
      v._alreadyImported = existingSet.has(String(v.lot_number));
    });

    return {
      items,
      total: items.length,
      page,
      hasMore: items.length === limit,
    };
  }

  async importSingle(lotNumber: string, platform: 'copart' | 'iaai' = 'copart'): Promise<{
    imported: boolean;
    vehicleId?: string;
    alreadyExists?: boolean;
    slug?: string;
  }> {
    const apiKey = this.config.get('RAPIDAPI_KEY');
    if (!apiKey) throw new Error('RAPIDAPI_KEY not configured');

    // Check if already imported
    const existing = await this.prisma.vehicleSourceBinding.findUnique({
      where: {
        provider_externalLotId: {
          provider: platform,
          externalLotId: lotNumber,
        },
      },
      include: { vehicle: true },
    });

    if (existing) {
      return {
        imported: false,
        alreadyExists: true,
        vehicleId: existing.vehicleId,
        slug: existing.vehicle.slug,
      };
    }

    // Fetch single vehicle details
    const url = `${this.RAPIDAPI_BASE}/vehicles/${lotNumber}?platform=${platform}`;
    this.logger.log(`Fetching single vehicle: lot ${lotNumber}, platform ${platform}`);

    const result = await providerFetch<any>(
      url,
      {
        'x-rapidapi-host': this.RAPIDAPI_HOST,
        'x-rapidapi-key': apiKey,
      },
      { ...this.getFetchConfig(), jobDeadlineMs: Date.now() + this.config.get<number>('IMPORT_REQUEST_TIMEOUT_MS')! * 2 },
      this.logger,
    );

    if (!result.ok) {
      throw new Error(`Provider fetch error: ${result.failure.kind}${result.failure.status ? ` (${result.failure.status})` : ''}`);
    }

    const body = result.data;
    const raw = body?.data ?? body;

    if (!raw || !raw.lot_number) {
      throw new Error('Vehicle not found');
    }

    const mapped = this.mapRawToVehicle(raw, platform);

    const vehicle = await this.vehiclesService.create({
      ...mapped,
      sourceType: platform === 'iaai' ? 'IAAI' : 'COPART',
      sourceRegion: 'USA',
    });

    const pricing = raw.pricing ?? {};
    await this.prisma.vehicleSourceBinding.create({
      data: {
        vehicleId: vehicle.id,
        provider: platform,
        externalLotId: lotNumber,
        externalUrl: `https://www.${platform}.com/lot/${lotNumber}`,
        saleStatus: raw.auction?.state,
        currentBidAmount: pricing.current_bid_usd ?? 0,
        buyNowAmount: pricing.buy_now_usd ?? 0,
        lastSyncedAt: new Date(),
      },
    });

    this.logger.log(`Imported lot ${lotNumber} → vehicle ${vehicle.id} (${vehicle.slug})`);

    return {
      imported: true,
      vehicleId: vehicle.id,
      slug: vehicle.slug,
    };
  }

  async handleCronSync(): Promise<void> {
    this.logger.log('Cron-triggered Copart sync');
    await this.sync();
  }
}

// ── Module-level helpers: order-independent page identity ──

/**
 * Build a deterministic, order-independent page identity from a page
 * of provider items.
 *
 * - Extracts `lot_number` from each object item and normalizes to string.
 * - Non-object items and missing lot IDs are included as sentinel
 *   values to preserve multiplicity (the count matters).
 * - The resulting array is sorted lexicographically so that two pages
 *   with the same lot IDs in different orders produce the same identity.
 * - Duplicate lot IDs within a single page are preserved (multiplicity
 *   is meaningful): [A, A, B] ≠ [A, B].
 */
function buildPageIdentity(items: unknown[]): PageIdentity {
  const ids: string[] = items.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return '__non_object__';
    }
    const ln = (item as Record<string, unknown>).lot_number;
    return ln !== null && ln !== undefined ? String(ln) : '__missing_lot_id__';
  });
  return ids.sort();
}

/**
 * Compare two page identities for equality.
 * Both must be sorted arrays of the same length with identical elements.
 */
function identitiesEqual(a: PageIdentity, b: PageIdentity): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
