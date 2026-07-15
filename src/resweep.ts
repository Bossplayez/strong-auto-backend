/**
 * Task 036 — Bounded discovery resweep to populate mediaUrls and auctionTime.
 *
 * Runs 2 pages per provider (copart + iaai) = 4 API calls total.
 * Budget: 4 of ~121 remaining (9 used of 130 budget cap).
 *
 * Run: cd ~/clawd/strong-auto-backend && DATABASE_URL=... RAPIDAPI_KEY=... npx ts-node src/resweep.ts
 */

import { PrismaClient } from '@prisma/client';
import { DiscoveryService } from './copart/discovery.service';
import { ConfigService } from '@nestjs/config';
import { ProviderLeaseService } from './copart/provider-lease.service';
import { RequestBudgetService } from './copart/request-budget.service';

// Simple mock for running discovery outside NestJS
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY!;
const RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
const RAPIDAPI_BASE = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com';

const prisma = new PrismaClient();

async function fetchPage(platform: 'copart' | 'iaai', cursor: string | null, perPage = 20) {
  const url = new URL(`${RAPIDAPI_BASE}/vehicles`);
  url.searchParams.set('auction_type', platform === 'copart' ? '1' : '2');
  url.searchParams.set('per_page', String(perPage));
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url.toString(), {
    headers: {
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': RAPIDAPI_KEY,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return res.json() as Promise<any>;
}

function normalizeLot(raw: any, platform: string) {
  const auction = raw.auction || {};
  const pricing = raw.pricing || {};
  const media = raw.media || {};
  const details = raw.details || {};
  const location = raw.location || {};
  const facility = raw.facility || {};

  const mediaUrls: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(media.items)) {
    for (const item of media.items) {
      if (typeof item === 'string' && item.startsWith('https://') && !seen.has(item)) {
        seen.add(item);
        mediaUrls.push(item);
      } else if (item && typeof item === 'object') {
        const candidate = item.full ?? item.large ?? item.thumb ?? '';
        if (candidate && typeof candidate === 'string' && candidate.startsWith('https://') && !seen.has(candidate)) {
          seen.add(candidate);
          mediaUrls.push(candidate);
        }
      }
    }
  }

  if (mediaUrls.length === 0 && Array.isArray(media.thumbs)) {
    for (const url of media.thumbs) {
      if (typeof url === 'string' && url.startsWith('https://') && !seen.has(url)) {
        seen.add(url);
        mediaUrls.push(url);
      }
    }
  }

  const auctionDate = auction.auction_at ? new Date(auction.auction_at) : null;

  return {
    title: raw.title || '',
    make: raw.make || '',
    model: raw.model || '',
    year: raw.year ? Number(raw.year) : new Date().getFullYear(),
    vin: raw.vin || null,
    slugVin: raw.slug_vin || null,
    ad: auctionDate,
    auctionTime: auctionDate,
    auctionState: auction.state || null,
    auctionFormatted: auction.formatted || null,
    isBuyNow: auction.is_buy_now || false,
    buyNowUsd: pricing.buy_now_usd ? Number(pricing.buy_now_usd) : null,
    currentBidUsd: pricing.current_bid_usd ? Number(pricing.current_bid_usd) : null,
    estimatedCostUsd: pricing.estimated_cost?.to ? Number(pricing.estimated_cost.to) : null,
    lastSoldPriceUsd: pricing.last_sold_price_usd ? Number(pricing.last_sold_price_usd) : null,
    odometerMi: details.odometer?.value ? Number(details.odometer.value) : null,
    primaryDamage: details.primary_damage || null,
    secondaryDamage: details.secondary_damage || null,
    loss: details.loss_type || null,
    runCondition: details.condition?.run_condition || null,
    hasKey: details.condition?.has_key ?? null,
    bodyStyle: details.body_style || null,
    engine: details.engine || null,
    driveType: details.drive_type || null,
    exteriorColor: details.exterior_color || null,
    fuelType: details.fuel_type || null,
    transmission: details.transmission || null,
    locationDisplay: location.display || null,
    locationState: location.state || null,
    facilityId: facility.lot || null,
    facilityOfficeName: facility.office_name || null,
    facilityState: facility.state || null,
    facilityZip: facility.zip || null,
    has360: media.has_360 || false,
    hasVideo: media.has_video || false,
    thumbsCount: media.thumbs_count || 0,
    mediaUrls,
    sellerClass: raw.seller?.class || null,
    sellerType: raw.seller?.type || null,
    saleDocumentName: raw.sale_document?.name || null,
    saleDocumentType: raw.sale_document?.type || null,
  };
}

async function resweepProvider(platform: 'copart' | 'iaai', maxPages: number) {
  console.log(`\n=== Resweep ${platform} (max ${maxPages} pages) ===`);

  let pagesCompleted = 0;
  let lotsDiscovered = 0;
  let lotsUpdated = 0;
  let newLots = 0;
  let cursor: string | null = null;
  const errors: string[] = [];

  while (pagesCompleted < maxPages) {
    try {
      const data = await fetchPage(platform, cursor);
      const items = data?.data?.items || data?.items || [];
      const nextCursor = data?.meta?.next_cursor ?? null;

      console.log(`  Page ${pagesCompleted + 1}: ${items.length} lots, nextCursor=${nextCursor ? '[present]' : 'null'}`);

      if (items.length === 0) {
        console.log(`  Empty page — exhausted`);
        break;
      }

      for (const raw of items) {
        const lotId = String(raw.lot_number ?? '');
        if (!lotId) continue;

        const normalized = normalizeLot(raw, platform);

        const existing = await prisma.discoveredLot.findUnique({
          where: {
            provider_externalLotId: {
              provider: platform,
              externalLotId: lotId,
            },
          },
        });

        if (existing) {
          await prisma.discoveredLot.update({
            where: { id: existing.id },
            data: {
              ...normalized,
              lastSeenAt: new Date(),
              consecutiveMisses: 0,
              availabilityConfirmed: true,
            },
          });
          lotsUpdated++;
        } else {
          await prisma.discoveredLot.create({
            data: {
              provider: platform,
              externalLotId: lotId,
              ...normalized,
              lastSeenAt: new Date(),
            },
          });
          newLots++;
        }
        lotsDiscovered++;
      }

      pagesCompleted++;
      cursor = nextCursor;

      if (!nextCursor) {
        console.log(`  No next cursor — exhausted`);
        break;
      }
    } catch (err: any) {
      errors.push(err.message);
      console.log(`  Error: ${err.message}`);
      break;
    }
  }

  // Update checkpoint
  await prisma.discoveryCheckpoint.upsert({
    where: {
      provider_queryFingerprint: {
        provider: platform,
        queryFingerprint: `fp_${platform}`,
      },
    },
    create: {
      provider: platform,
      queryFingerprint: `fp_${platform}`,
      lastPage: cursor as any,
      lastCompletedAt: new Date(),
      exhaustedAt: !cursor ? new Date() : null,
    },
    update: {
      lastPage: cursor as any,
      lastCompletedAt: new Date(),
      exhaustedAt: !cursor ? new Date() : null,
    },
  });

  console.log(`  Result: ${pagesCompleted} pages, ${lotsDiscovered} lots (${newLots} new, ${lotsUpdated} updated)`);
  return { pagesCompleted, lotsDiscovered, lotsUpdated, newLots, errors };
}

async function main() {
  if (!RAPIDAPI_KEY) {
    console.error('RAPIDAPI_KEY not set');
    process.exit(1);
  }

  console.log('=== Task 036 Bounded Resweep ===\n');
  console.log(`RAPIDAPI_KEY: ${RAPIDAPI_KEY.substring(0, 8)}...`);

  const [copart, iaai] = await Promise.all([
    resweepProvider('copart', 2),
    resweepProvider('iaai', 2),
  ]);

  console.log('\n=== Resweep Summary ===');
  console.log(`Copart: ${copart.pagesCompleted} pages, ${copart.lotsDiscovered} lots (${copart.newLots} new, ${copart.lotsUpdated} updated)`);
  console.log(`IAAI: ${iaai.pagesCompleted} pages, ${iaai.lotsDiscovered} lots (${iaai.newLots} new, ${iaai.lotsUpdated} updated)`);
  console.log(`Total API calls: ${copart.pagesCompleted + iaai.pagesCompleted}`);
  if (copart.errors.length) console.log(`Copart errors: ${copart.errors.join(', ')}`);
  if (iaai.errors.length) console.log(`IAAI errors: ${iaai.errors.join(', ')}`);

  // Verify mediaUrls
  const withMedia = await prisma.discoveredLot.count({
    where: { mediaUrls: { isEmpty: false } },
  });
  const total = await prisma.discoveredLot.count();
  console.log(`\nLots with mediaUrls: ${withMedia}/${total}`);

  await prisma.$disconnect();
  console.log('\n=== Resweep complete ===');
}

main().catch((err) => {
  console.error('Resweep failed:', err);
  process.exit(1);
});
