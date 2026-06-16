const { PrismaClient } = require('@prisma/client');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'baf5834d3bmsh206d7839b043d4bp1dcaecjsn28fd36bff0a2';
const RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';

const prisma = new PrismaClient();

async function syncVehicles() {
  console.log('[sync] Starting direct Copart sync...');

  const dbHost = process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown';
  console.log(`[sync] DB: ${dbHost}`);

  const beforeCount = await prisma.vehicle.count();
  console.log(`[sync] Vehicles before: ${beforeCount}`);

  const allVehicles = [];

  for (let page = 1; page <= 10; page++) {
    const url = `https://${RAPIDAPI_HOST}/vehicles?platform=copart&page=${page}&limit=20`;
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

    const body = await res.json();
    const vehicles = body?.data || [];
    if (!vehicles.length) break;

    allVehicles.push(...vehicles);
    console.log(`[sync] Page ${page}: ${vehicles.length} vehicles`);

    if (vehicles.length < 20) break;
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log(`[sync] Total fetched: ${allVehicles.length}`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const v of allVehicles) {
    try {
      const lotNumber = String(v.lot_number || '');
      if (!lotNumber) { skipped++; continue; }

      // Check existing via binding
      const platform = 'COPART'; // enum only has COPART, not IAAI
      const existing = await prisma.vehicleSourceBinding.findUnique({
        where: { provider_externalLotId: { provider: 'COPART', externalLotId: lotNumber } },
      });
      if (existing) { skipped++; continue; }

      const year = parseInt(v.year || '0');
      const make = (v.make || '').trim();
      const model = (v.model || '').trim();
      if (!make || !model || !year) { skipped++; continue; }

      const slug = `${year}-${make.toLowerCase()}-${model.toLowerCase().replace(/\s+/g, '-')}-${lotNumber}`;

      // Check slug uniqueness
      const slugExists = await prisma.vehicle.findUnique({ where: { slug } });
      if (slugExists) { skipped++; continue; }

      // Get price as number
      let price = 0;
      if (v.pricing) {
        price = parseFloat(v.pricing.estimate?.amount || v.pricing.sold_amount || v.pricing.current_bid || 0);
      }
      if (isNaN(price)) price = 0;

      const odometer = parseFloat(v.odometer || 0);
      const spec = (v.vehicle_specs && v.vehicle_specs[0]) || {};
      const details = v.details || {};
      const mediaArr = v.media || [];
      const firstImage = (mediaArr[0] && (mediaArr[0].url || mediaArr[0].image_url)) || '';

      // Create vehicle WITHOUT nested creates
      const vehicle = await prisma.vehicle.create({
        data: {
          slug,
          title: v.title || `${year} ${make} ${model}`,
          make,
          model,
          year,
          priceAmount: price,
          currency: 'USD',
          odometerValue: isNaN(odometer) ? null : odometer,
          bodyType: spec.body_type || details.body_type || null,
          fuelType: spec.fuel_type || details.fuel_type || null,
          transmission: spec.transmission || details.transmission || null,
          driveType: spec.drive_type || details.drive_type || null,
          sourceType: platform,
          sourceRegion: 'USA',
          vin: v.vin || null,
          damagePrimary: details.primary_damage || null,
          locationCity: v.location?.city || null,
          locationState: v.location?.state || null,
          locationCountry: 'US',
          availabilityStatus: 'AVAILABLE',
          isRecommended: false,
          publicationStatus: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });

      // Create binding separately
      await prisma.vehicleSourceBinding.create({
        data: {
          vehicleId: vehicle.id,
          provider: 'COPART',
          externalLotId: lotNumber,
        },
      });

      // Create media separately
      if (firstImage) {
        await prisma.vehicleMedia.create({
          data: {
            vehicleId: vehicle.id,
            sourceUrl: firstImage,
            sortOrder: 0,
          },
        });
      }

      created++;
    } catch (e) {
      errors++;
      if (errors <= 5) console.error(`[sync] Error: ${e.message.substring(0, 200)}`);
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
