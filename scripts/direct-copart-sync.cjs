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
      console.error(`[sync] Page ${page} failed: ${res.status} ${res.statusText}`);
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
      const lotNumber = String(v.lot_number || v.lotNumber || '');
      if (!lotNumber) { skipped++; continue; }

      const existingBinding = await prisma.vehicleSourceBinding.findUnique({
        where: { provider_externalLotId: { provider: v.platform === 'iaai' ? 'IAAI' : 'COPART', externalLotId: lotNumber } },
        include: { vehicle: true },
      });
      if (existingBinding) { skipped++; continue; }

      const year = parseInt(v.year || '0');
      const make = (v.make || '').trim();
      const model = (v.model || '').trim();
      if (!make || !model || !year) { skipped++; continue; }

      const platform = v.platform === 'iaai' ? 'IAAI' : 'COPART';
      const price = v.pricing?.estimate?.amount || v.pricing?.sold_amount || 0;
      const odometer = v.odometer || 0;
      const specs = v.vehicle_specs || [];
      const spec = specs[0] || {};
      const mediaArr = v.media || [];
      const firstImage = mediaArr[0]?.url || mediaArr[0]?.image_url || '';
      const details = v.details || {};

      const slug = `${year}-${make.toLowerCase()}-${model.toLowerCase().replace(/\s+/g, '-')}-${lotNumber}`;

      await prisma.vehicle.create({
        data: {
          slug,
          title: v.title || `${year} ${make} ${model}`,
          make, model, year,
          priceAmount: parseFloat(price) || 0,
          currency: 'USD',
          odometerValue: parseFloat(odometer) || 0,
          bodyType: spec.body_type || details.body_type || null,
          fuelType: spec.fuel_type || details.fuel_type || null,
          transmission: spec.transmission || details.transmission || null,
          driveType: spec.drive_type || details.drive_type || null,
          sourceType: platform,
          sourceRegion: 'USA',
          vin: (v.vin || '').trim() || null,
          damagePrimary: (details.primary_damage || '').trim() || null,
          locationCity: (v.location?.city || '').trim() || null,
          locationState: (v.location?.state || '').trim() || null,
          locationCountry: 'US',
          availabilityStatus: 'AVAILABLE',
          isRecommended: false,
          publicationStatus: 'PUBLISHED',
          publishedAt: new Date(),
          sourceBindings: {
            create: {
              provider: platform,
              externalLotId: lotNumber,
              payloadJsonb: v,
            },
          },
          media: firstImage ? {
            create: { sourceUrl: firstImage, sortOrder: 0 },
          } : undefined,
        },
      });
      created++;
    } catch (e) {
      errors++;
      if (errors <= 3) console.error(`[sync] Error: ${e.message.substring(0, 150)}`);
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
