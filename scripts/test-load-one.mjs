import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const vehicles = JSON.parse(
    readFileSync(join(__dirname, 'audi-diesel-vehicles.json'), 'utf-8')
  );

  // Just test the first one
  const raw = vehicles[0];
  const lotNumber = String(raw.lot_number);
  const vin = raw.vin || null;
  const year = Number(raw.year);
  const make = String(raw.make || 'AUDI').trim();
  const model = String(raw.model || 'UNKNOWN').trim();
  const title = raw.title || `${year} ${make} ${model}`;
  const slug = `${slugify(make)}-${slugify(model)}-${year}-${lotNumber}`.toLowerCase();
  
  const pricing = raw.pricing || {};
  const condition = raw.condition || {};
  const specs = raw.vehicle_specs || {};
  const engine = specs.engine || {};
  const odometer = raw.odometer || {};
  const auction = raw.auction || {};
  const media = raw.media || {};
  const location = raw.location || {};

  const priceAmount = Number(pricing.current_bid_usd || pricing.current_bid2_usd || 0);
  const mediaUrls = (media.items || [])
    .map((img) => img.full || img.thumb || '')
    .filter(Boolean);

  try {
    const vehicle = await prisma.vehicle.create({
      data: {
        slug,
        sourceType: 'COPART',
        sourceRegion: 'USA',
        publicationStatus: 'PUBLISHED',
        availabilityStatus: 'AVAILABLE',
        isRecommended: false,
        vin,
        title,
        make,
        model,
        year,
        priceAmount,
        currency: 'USD',
        odometerValue: odometer.km ? Number(odometer.km) : null,
        bodyType: specs.body_style || null,
        fuelType: specs.fuel_type || 'Diesel',
        transmission: specs.transmission || null,
        driveType: specs.drive_type || null,
        damagePrimary: condition.primary_damage || null,
        locationCountry: 'US',
        locationState: location.state || null,
        locationCity: location.display || null,
        publishedAt: new Date(),
        specs: {
          create: {
            engineVolume: engine.size_l ? String(engine.size_l) : null,
            enginePower: engine.hp ? String(engine.hp) : null,
            cylinders: engine.raw || null,
            color: specs.exterior_color || null,
            keysAvailable: condition.has_key || false,
            lotNumber,
          },
        },
        media: mediaUrls.length > 0 ? {
          create: mediaUrls.slice(0, 20).map((src, i) => ({
            sourceUrl: src,
            sortOrder: i,
            mediaType: 'image',
          })),
        } : undefined,
        sourceBindings: {
          create: {
            provider: 'copart',
            externalLotId: lotNumber,
            externalUrl: `https://www.copart.com/lot/${lotNumber}`,
            saleStatus: auction.state || null,
            currentBidAmount: priceAmount,
            buyNowAmount: pricing.buy_now_usd ? Number(pricing.buy_now_usd) : null,
            lastSyncedAt: new Date(),
          },
        },
      },
    });

    console.log(`✅ Created: ${title} — ${vehicle.id}`);
  } catch (error) {
    console.error(`Full error:`, error);
  }
}

main().finally(() => prisma.$disconnect());
