/**
 * Task 036 — Legacy USA Vehicle Reconciliation
 *
 * Archives parser-created USA Vehicle rows that duplicate the
 * DiscoveredLot auction catalog.
 *
 * Target: sourceType in (COPART, IAAI) AND sourceRegion = USA AND publicationStatus = PUBLISHED
 * Action: publicationStatus → ARCHIVED, availabilityStatus → NOT_AVAILABLE
 *
 * Idempotent: skips already-archived rows. Reversible: admin can manually re-publish.
 *
 * Run: npx ts-node src/legacy-usa-reconcile.ts
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  console.log('=== Task 036 Legacy USA Vehicle Reconciliation ===\n');

  // Pre-change report
  const legacyCount = await prisma.vehicle.count({
    where: {
      sourceRegion: 'USA',
      sourceType: { in: ['COPART', 'IAAI'] },
      publicationStatus: 'PUBLISHED',
    },
  });

  const alreadyArchived = await prisma.vehicle.count({
    where: {
      sourceRegion: 'USA',
      sourceType: { in: ['COPART', 'IAAI'] },
      publicationStatus: 'ARCHIVED',
    },
  });

  console.log(`Legacy USA vehicles (PUBLISHED): ${legacyCount}`);
  console.log(`Already archived: ${alreadyArchived}`);

  if (legacyCount === 0) {
    console.log('\nNo legacy vehicles to archive. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // Identify vehicles to archive
  const toArchive = await prisma.vehicle.findMany({
    where: {
      sourceRegion: 'USA',
      sourceType: { in: ['COPART', 'IAAI'] },
      publicationStatus: 'PUBLISHED',
    },
    select: {
      id: true,
      slug: true,
      title: true,
      make: true,
      model: true,
      year: true,
      sourceType: true,
      sourceBindings: {
        select: { provider: true, externalLotId: true },
      },
    },
  });

  console.log(`\nVehicles to archive (${toArchive.length}):`);
  for (const v of toArchive) {
    const binding = v.sourceBindings[0];
    const lotInfo = binding ? ` (${binding.provider}#${binding.externalLotId})` : '';
    console.log(`  ${v.id} — ${v.year} ${v.make} ${v.model}${lotInfo}`);
  }

  // Check which ones have matching DiscoveredLot records
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const v of toArchive) {
    const binding = v.sourceBindings[0];
    if (binding) {
      const lot = await prisma.discoveredLot.findUnique({
        where: {
          provider_externalLotId: {
            provider: binding.provider,
            externalLotId: binding.externalLotId,
          },
        },
      });
      if (lot) {
        matchedCount++;
      } else {
        unmatchedCount++;
      }
    } else {
      unmatchedCount++;
    }
  }

  console.log(`\nMatched to DiscoveredLot: ${matchedCount}`);
  console.log(`No matching DiscoveredLot: ${unmatchedCount}`);

  // Archive the vehicles
  console.log('\nArchiving...');
  const result = await prisma.vehicle.updateMany({
    where: {
      sourceRegion: 'USA',
      sourceType: { in: ['COPART', 'IAAI'] },
      publicationStatus: 'PUBLISHED',
    },
    data: {
      publicationStatus: 'ARCHIVED',
      availabilityStatus: 'NOT_AVAILABLE',
    },
  });

  console.log(`Archived: ${result.count} vehicles`);

  // Post-change verification
  const remainingPublished = await prisma.vehicle.count({
    where: {
      sourceRegion: 'USA',
      sourceType: { in: ['COPART', 'IAAI'] },
      publicationStatus: 'PUBLISHED',
    },
  });

  const totalArchived = await prisma.vehicle.count({
    where: {
      sourceRegion: 'USA',
      sourceType: { in: ['COPART', 'IAAI'] },
      publicationStatus: 'ARCHIVED',
    },
  });

  console.log(`\nPost-change verification:`);
  console.log(`  Remaining PUBLISHED USA vehicles: ${remainingPublished}`);
  console.log(`  Total archived USA vehicles: ${totalArchived}`);

  if (remainingPublished === 0) {
    console.log('\n✅ Reconciliation complete. No legacy USA vehicles remain published.');
  } else {
    console.log(`\n⚠️  ${remainingPublished} legacy USA vehicles still published — may need manual review.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Reconciliation failed:', err);
  process.exit(1);
});
