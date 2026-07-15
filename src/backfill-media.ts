/**
 * Task 036 — Backfill mediaUrls from VehicleRawImport for matching DiscoveredLots.
 *
 * 280 raw imports exist, 28 match existing DiscoveredLot records.
 * Extracts media URLs from raw.payloadJsonb.media.items[].full/.large/.thumb
 * and media.thumbs array.
 *
 * Run: cd ~/clawd/strong-auto-backend && DATABASE_URL=... npx ts-node src/backfill-media.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractMediaUrls(media: unknown): string[] {
  if (!isRecord(media)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(media.items)) {
    for (const item of media.items) {
      if (typeof item === 'string') {
        if (item.startsWith('https://') && !seen.has(item)) {
          seen.add(item);
          urls.push(item);
        }
      } else if (item && typeof item === 'object') {
        const candidate = item.full ?? item.large ?? item.thumb ?? '';
        if (candidate && typeof candidate === 'string' && candidate.startsWith('https://') && !seen.has(candidate)) {
          seen.add(candidate);
          urls.push(candidate);
        }
      }
    }
  }

  if (urls.length === 0 && Array.isArray(media.thumbs)) {
    for (const url of media.thumbs) {
      if (typeof url === 'string' && url.startsWith('https://') && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }

  return urls;
}

async function main() {
  console.log('=== Task 036 Backfill: mediaUrls from raw imports ===\n');

  const rawImports = await prisma.vehicleRawImport.findMany({
    select: { provider: true, externalLotId: true, payloadJsonb: true },
  });
  console.log(`Raw imports: ${rawImports.length}`);

  const rawMap = new Map<string, Record<string, unknown>>();
  for (const raw of rawImports) {
    if (!isRecord(raw.payloadJsonb)) {
      console.warn(`Skipping raw import ${raw.provider}|${raw.externalLotId}: invalid payload`);
      continue;
    }
    rawMap.set(`${raw.provider}|${raw.externalLotId}`, raw.payloadJsonb);
  }

  const lots = await prisma.discoveredLot.findMany({
    select: { id: true, provider: true, externalLotId: true, mediaUrls: true },
    where: { mediaUrls: { isEmpty: true } },
  });
  console.log(`Lots with empty mediaUrls: ${lots.length}\n`);

  let matched = 0;
  let updated = 0;

  for (const lot of lots) {
    const key = `${lot.provider}|${lot.externalLotId}`;
    const payload = rawMap.get(key);
    if (!payload) continue;
    matched++;

    const newMediaUrls = extractMediaUrls(payload.media);
    if (newMediaUrls.length > 0) {
      await prisma.discoveredLot.update({
        where: { id: lot.id },
        data: { mediaUrls: newMediaUrls },
      });
      updated++;
    }
  }

  console.log(`Matched: ${matched}, Updated: ${updated}`);

  // Verify
  const withMedia = await prisma.discoveredLot.count({
    where: { mediaUrls: { isEmpty: false } },
  });
  const total = await prisma.discoveredLot.count();
  console.log(`\nLots with mediaUrls: ${withMedia}/${total}`);

  await prisma.$disconnect();
  console.log('\n=== mediaUrls backfill complete ===');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
