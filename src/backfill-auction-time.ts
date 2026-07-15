/**
 * Task 036 — Backfill auctionTime from ad field for existing DiscoveredLots.
 *
 * All 1215 lots have ad field populated (Date object from auction.auction_at)
 * but auctionTime column is null because discovery ran before the mapping was added.
 *
 * This script copies ad → auctionTime for all lots where auctionTime is null.
 *
 * Run: cd ~/clawd/strong-auto-backend && DATABASE_URL=... npx ts-node src/backfill-auction-time.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Task 036 Backfill: auctionTime from ad ===\n');

  const lots = await prisma.discoveredLot.findMany({
    select: { id: true, ad: true, auctionTime: true },
    where: { auctionTime: null, ad: { not: null } },
  });

  console.log(`Lots needing auctionTime backfill: ${lots.length}\n`);

  // Batch update in chunks of 200
  const chunkSize = 200;
  let updated = 0;

  for (let i = 0; i < lots.length; i += chunkSize) {
    const chunk = lots.slice(i, i + chunkSize);
    const promises = chunk.map((lot) =>
      prisma.discoveredLot.update({
        where: { id: lot.id },
        data: { auctionTime: lot.ad as Date },
      }),
    );
    await Promise.all(promises);
    updated += chunk.length;
    console.log(`  Updated batch ${Math.floor(i / chunkSize) + 1}: ${chunk.length} rows`);
  }

  console.log(`\nTotal updated: ${updated}`);

  // Verify
  const withAuctionTime = await prisma.discoveredLot.count({
    where: { auctionTime: { not: null } },
  });
  console.log(`Lots with auctionTime: ${withAuctionTime} / ${lots.length + (await prisma.discoveredLot.count({ where: { auctionTime: { not: null } } }) - updated)}`);

  await prisma.$disconnect();
  console.log('\n=== auctionTime backfill complete ===');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
