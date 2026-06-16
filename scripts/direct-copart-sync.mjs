// Direct Copart sync - runs on Railway server
import { PrismaClient } from '@prisma/client';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'baf5834d3bmsh206d7839b043d4bp1dcaecjsn28fd36bff0a2';
const RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';

const prisma = new PrismaClient();

async function syncVehicles() {
  console.log('[sync] Starting direct Copart sync...');

  // Check DB
  const dbHost = process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown';
  console.log(`[sync] DB: ${dbHost}`);

  const beforeCount = await prisma.vehicle.count();
  console.log(`[sync] Vehicles before: ${beforeCount}`);

  // Fetch from RapidAPI
  const allVehicles = [];
  let page = 1;

  for (let page = 1; page <= 10; page++) {
    const url = `https://${RAPIDAPI_HOST}/getLots?page=${page}&limit=20`;
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
      },
    });

    if (!res.ok) {
      console.error(`[sync] Page ${page} failed: ${res.status}`);
      break;
    }

    const data = await res.json();
    const vehicles = data.data?.data || data.data || [];
    if (!vehicles.length) break;

    allVehicles.push(...vehicles);
    console.log(`[sync] Page ${page}: ${vehicles.length} vehicles`);

    const total = data.data?.total || data.total || 0;
    if (allVehicles.length >= total) break;
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log(`[sync] Total fetched: ${allVehicles.length}`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const v of allVehicles) {
    try {
      const lotNumber = String(v.lotNumber || v.LotNumber || '');
      if (!lotNumber) { skipped++; continue; }

      const existing = await prisma.vehicle.findFirst({ where: { sourceId: lotNumber } });
      if (existing) { skipped++; continue; }

      const year = parseInt(v.year || v.Year || '0');
      const make = (v.make || v.Make || '').trim();
      const model = (v.model || v.Model || '').trim();
      if (!make || !model || !year) { skipped++; continue; }

      await prisma.vehicle.create({
        data: {
          title: `${year} ${make} ${model}`,
          slug: `${year}-${make.toLowerCase()}-${model.toLowerCase()}-${lotNumber}`,
          make, model, year,
          priceAmount: parseFloat(v.estimatePrice || v.Estimate || '0') || 0,
          currency: 'USD',
          odometerValue: parseFloat(v.odometer || v.Odometer || '0'),
          bodyType: v.bodyType || v.BodyStyle || 'Unknown',
          fuelType: v.fuelType || v.Fuel || 'Unknown',
          transmission: v.transmission || v.Transmission || 'Unknown',
          driveType: v.driveType || v.DriveLine || 'Unknown',
          sourceType: 'COPART',
          sourceRegion: 'USA',
          sourceId: lotNumber,
          vin: (v.vin || v.VIN || '').trim(),
          engineType: (v.engineType || v.Engine || '').trim(),
          damageType: (v.damageType || v.PrimaryDamage || '').trim(),
          locationCity: (v.city || v.City || '').trim(),
          locationState: (v.state || v.State || '').trim(),
          locationCountry: 'US',
          availabilityStatus: 'AVAILABLE',
          isRecommended: false,
          publicationStatus: 'PUBLISHED',
          publishedAt: new Date(),
          media: (v.imageUrl || v.ImageUrl) ? {
            create: { sourceUrl: v.imageUrl || v.ImageUrl, sortOrder: 0 },
          } : undefined,
        },
      });
      created++;
    } catch (e) {
      errors++;
      if (errors <= 3) console.error(`[sync] Error: ${e.message.substring(0, 100)}`);
    }
  }

  const afterCount = await prisma.vehicle.count();
  console.log(`[sync] Complete: ${created} created, ${skipped} skipped, ${errors} errors`);
  console.log(`[sync] Total vehicles: ${afterCount}`);

  await prisma.$disconnect();
}

syncVehicles().catch(e => {
  console.error('[sync] Fatal:', e.message);
  process.exit(1);
});
