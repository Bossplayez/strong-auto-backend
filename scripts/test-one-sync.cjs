const { PrismaClient } = require('@prisma/client');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'baf5834d3bmsh206d7839b043d4bp1dcaecjsn28fd36bff0a2';
const RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:HOelOkvEMRECXEugwnzdjzcIovyQNPFf@trolley.proxy.rlwy.net:19999/railway' } }
});

async function test() {
  console.log('Fetching 1 vehicle from RapidAPI...');
  const res = await fetch(`https://${RAPIDAPI_HOST}/vehicles?platform=copart&page=1&limit=1`, {
    headers: {
      'X-RapidAPI-Key': RAPIDAPI_KEY,
      'X-RapidAPI-Host': RAPIDAPI_HOST,
    },
  });
  
  const body = await res.json();
  const v = body?.data?.[0];
  if (!v) { console.log('No vehicles found'); return; }
  
  console.log('Vehicle:', JSON.stringify(v, null, 2).substring(0, 500));
  
  const lotNumber = String(v.lot_number || '');
  const year = parseInt(v.year || '0');
  const make = (v.make || '').trim();
  const model = (v.model || '').trim();
  const platform = v.platform === 'iaai' ? 'IAAI' : 'COPART';
  const slug = `${year}-${make.toLowerCase()}-${model.toLowerCase().replace(/\s+/g, '-')}-${lotNumber}`;
  
  let price = 0;
  if (v.pricing) {
    price = parseFloat(v.pricing.estimate?.amount || v.pricing.sold_amount || v.pricing.current_bid || 0);
  }
  
  const spec = (v.vehicle_specs && v.vehicle_specs[0]) || {};
  const details = v.details || {};
  
  const data = {
    slug,
    title: v.title || `${year} ${make} ${model}`,
    make,
    model,
    year,
    priceAmount: price,
    currency: 'USD',
    odometerValue: parseFloat(v.odometer || 0) || null,
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
  };
  
  console.log('\nData to create:', JSON.stringify(data, null, 2));
  
  try {
    const vehicle = await prisma.vehicle.create({ data });
    console.log('\nCreated:', vehicle.id, vehicle.slug);
  } catch (e) {
    console.error('\nError:', e.message);
  }
  
  await prisma.$disconnect();
}

test();
