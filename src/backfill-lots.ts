/**
 * Task 036 — Backfill lifecycleState for existing DiscoveredLots.
 *
 * All 1215 lots have auctionTime=null but ad field populated.
 * The public API already computes lifecycle correctly at query time
 * using `lot.auctionTime ?? lot.ad` fallback.
 *
 * This script computes and persists the correct lifecycleState in DB.
 *
 * Run: cd ~/clawd/strong-auto-backend && DATABASE_URL=... npx ts-node src/backfill-lots.ts
 */

import { PrismaClient } from '@prisma/client';
import { normalizeLifecycleState } from './auction-lot/lifecycle-mapping';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Task 036 Backfill: Persist lifecycleState ===\n');

  const lots = await prisma.discoveredLot.findMany({
    select: {
      id: true,
      auctionState: true,
      ad: true,
      auctionTime: true,
      isBuyNow: true,
      buyNowUsd: true,
      lifecycleState: true,
    },
  });

  console.log(`Total lots: ${lots.length}`);
  console.log(`Lots with auctionTime=null: ${lots.filter((l) => !l.auctionTime).length}`);
  console.log(`Lots with ad field: ${lots.filter((l) => l.ad).length}\n`);

  const now = new Date();
  const updates: { id: string; lifecycleState: string }[] = [];
  const lifecycleCounts: Record<string, number> = {
    NOT_READY: 0, OPEN: 0, ENDED: 0, UPCOMING: 0, LIVE: 0, SOLD: 0, REMOVED: 0,
  };

  for (const lot of lots) {
    // Use auctionTime if set, fall back to ad (matches public API behavior)
    const auctionDate = lot.auctionTime ?? lot.ad;
    const buyNowUsd = lot.buyNowUsd ? Number(lot.buyNowUsd) : null;

    const newLifecycle = normalizeLifecycleState(
      lot.auctionState,
      auctionDate as Date | null | undefined,
      now,
      lot.isBuyNow ?? false,
      buyNowUsd,
    );

    lifecycleCounts[newLifecycle] = (lifecycleCounts[newLifecycle] || 0) + 1;

    if (lot.lifecycleState !== newLifecycle) {
      updates.push({ id: lot.id, lifecycleState: newLifecycle });
    }
  }

  console.log(`Updates needed: ${updates.length} / ${lots.length}`);
  console.log('Lifecycle distribution after backfill:');
  for (const [state, count] of Object.entries(lifecycleCounts).filter(([, c]) => c > 0)) {
    console.log(`  ${state}: ${count}`);
  }

  // Batch update in chunks of 100
  if (updates.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const tx = chunk.map((u) =>
        prisma.discoveredLot.update({
          where: { id: u.id },
          data: { lifecycleState: u.lifecycleState as any },
        }),
      );
      await Promise.all(tx);
      console.log(`  Updated chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(updates.length / chunkSize)} (${chunk.length} rows)`);
    }
  }

  // Verify
  const byLifecycle = await prisma.discoveredLot.groupBy({
    by: ['lifecycleState'],
    _count: true,
  });
  console.log('\nVerified lifecycle distribution:');
  for (const r of byLifecycle) {
    console.log(`  ${r.lifecycleState}: ${r._count}`);
  }

  const notReadyCount = await prisma.discoveredLot.count({
    where: { lifecycleState: 'NOT_READY' },
  });
  console.log(`\nRemaining NOT_READY lots: ${notReadyCount}`);

  await prisma.$disconnect();
  console.log('\n=== Backfill complete ===');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
