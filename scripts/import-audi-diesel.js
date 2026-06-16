/**
 * Script to fetch Audi A6/A8/Q7 diesel 2013-2015 from Copart via RapidAPI
 * and load them into the Strong Auto database.
 * 
 * Usage: node scripts/import-audi-diesel.js
 */

const RAPIDAPI_KEY = 'baf5834d3bmsh206d7839b043d4bp1dcaecjsn28fd36bff0a2';
const RAPIDAPI_HOST = 'vehicle-auction-data-api-copart-iaai.p.rapidapi.com';
const BASE_URL = `https://${RAPIDAPI_HOST}`;

const TARGETS = [
  { make: 'audi', model: 'q7', fuel_type: 'diesel' },
  { make: 'audi', model: 'a6', fuel_type: 'diesel' },
  { make: 'audi', model: 'a8', fuel_type: 'diesel' },
];

async function fetchVehicles(params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}/vehicles?${qs}`;
  
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': RAPIDAPI_KEY,
    },
  });
  
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const body = await res.json();
  return body?.data ?? [];
}

async function main() {
  console.log('🔍 Fetching Audi diesel vehicles from Copart...\n');
  
  const allVehicles = [];
  
  for (const target of TARGETS) {
    console.log(`  → ${target.make} ${target.model} ${target.fuel_type}...`);
    const vehicles = await fetchVehicles(target);
    
    // Filter by year 2013-2015
    const filtered = vehicles.filter(v => v.year >= 2013 && v.year <= 2015);
    console.log(`    Found ${filtered.length} matching vehicles (out of ${vehicles.length} total)\n`);
    
    allVehicles.push(...filtered);
  }
  
  console.log(`\n📦 Total vehicles to load: ${allVehicles.length}`);
  console.log('\n' + '='.repeat(80));
  
  for (const v of allVehicles) {
    const pricing = v.pricing || {};
    const condition = v.condition || {};
    const specs = v.vehicle_specs || {};
    const engine = specs.engine || {};
    const odometer = v.odometer || {};
    
    const bid = pricing.current_bid_usd ? `$${pricing.current_bid_usd}` : 'N/A';
    const buyNow = pricing.buy_now_usd ? `$${pricing.buy_now_usd}` : 'N/A';
    
    console.log(`
  ${v.year} ${v.make} ${v.model}
  ─────────────────────────────────────────
  Lot:        ${v.lot_number}
  Bid:        ${bid}
  Buy Now:    ${buyNow}
  Odometer:   ${odometer.km || 'N/A'} km
  Damage:     ${condition.primary_damage || 'N/A'}
  Location:   ${v.location?.display || 'N/A'}
  Color:      ${specs.exterior_color || 'N/A'}
  Engine:     ${engine.raw || 'N/A'}
  Trans:      ${specs.transmission || 'N/A'}
  Keys:       ${condition.has_key ? 'Yes' : 'No'}
  Auction:    ${v.auction?.formatted || 'N/A'}
  Images:     ${v.media?.thumbs_count || 0}
  URL:        https://www.copart.com/lot/${v.lot_number}
`);
  }
  
  // Save to JSON for later import
  const fs = await import('fs');
  const outputFile = 'scripts/audi-diesel-vehicles.json';
  fs.writeFileSync(outputFile, JSON.stringify(allVehicles, null, 2));
  console.log(`\n💾 Saved to ${outputFile}`);
  console.log('\n⚠️  To load into database, run:');
  console.log('   cd ~/clawd/strong-auto-backend');
  console.log('   railway login');
  console.log('   npx ts-node scripts/load-vehicles-to-db.ts');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
