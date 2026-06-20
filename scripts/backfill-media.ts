import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const RAPIDAPI_BASE = 'https://vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
const RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY!;

async function main() {
  // Find vehicles without media that have source bindings
  const vehicles = await prisma.vehicle.findMany({
    where: { media: { none: {} } },
    include: { sourceBindings: true },
  });

  console.log(`Found ${vehicles.length} vehicles without media`);

  let updated = 0;
  let failed = 0;

  for (const v of vehicles) {
    const binding = v.sourceBindings[0];
    if (!binding) {
      console.log(`SKIP ${v.slug} — no source binding`);
      continue;
    }

    const lotNumber = binding.externalLotId;
    const platform = binding.provider;

    try {
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));

      const url = `${RAPIDAPI_BASE}/vehicles/${lotNumber}?platform=${platform}`;
      console.log(`Fetching ${platform} lot ${lotNumber}...`);

      const response = await fetch(url, {
        headers: {
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': RAPIDAPI_KEY,
        },
      });

      if (!response.ok) {
        console.error(`  ERROR ${response.status} for lot ${lotNumber}`);
        failed++;
        continue;
      }

      const body = await response.json();
      const raw = body?.data ?? body;

      const mediaItems = raw?.media?.items ?? [];
      const mediaUrls = mediaItems
        .map((img: any) => (typeof img === 'string' ? img : img.large ?? img.full ?? img.thumb ?? ''))
        .filter(Boolean);

      if (mediaUrls.length === 0) {
        console.log(`  No media URLs found for lot ${lotNumber}`);
        failed++;
        continue;
      }

      // Create media records
      await prisma.vehicleMedia.createMany({
        data: mediaUrls.map((url: string, i: number) => ({
          vehicleId: v.id,
          sourceUrl: url,
          sortOrder: i,
          isPrimary: i === 0,
        })),
      });

      updated++;
      console.log(`  ✅ ${v.slug}: ${mediaUrls.length} images added`);
    } catch (e: any) {
      console.error(`  FAILED ${v.slug}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Failed: ${failed}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); process.exit(1); });
