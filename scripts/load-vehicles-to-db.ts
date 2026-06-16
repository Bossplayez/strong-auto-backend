/**
 * Load vehicles from audi-diesel-vehicles.json into the database.
 * Uses Prisma directly.
 * 
 * Usage: cd ~/clawd/strong-auto-backend && npx ts-node scripts/load-vehicles-to-db.ts
 */

import { PrismaClient, VehicleSourceType, VehicleRegion, VehiclePublicationStatus, VehicleAvailabilityStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const vehicles = JSON.parse(
    readFileSync(path.join(__dirname, 'audi-diesel-vehicles.json'), 'utf-8')
  );

  console.log(`📦 Loading ${vehicles.length} vehicles into database...\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const raw of vehicles) {
    try {
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
        .map((img: any) => img.full || img.thumb || '')
        .filter(Boolean) as string[];

      // Check if vehicle already exists by lot number (via source binding)
      const existing = await prisma.vehicleSourceBinding.findUnique({
        where: {
          provider_externalLotId: {
            provider: 'copart',
            externalLotId: lotNumber,
          },
        },
      });

      if (existing) {
        console.log(`  ⏭  Skip (exists): ${title} (lot ${lotNumber})`);
        skipped++;
        continue;
      }

      // Check by VIN
      if (vin) {
        const byVin = await prisma.vehicle.findFirst({ where: { vin } });
        if (byVin) {
          console.log(`  ⏭  Skip (VIN exists): ${title} (lot ${lotNumber})`);
          skipped++;
          continue;
        }
      }

      // Create vehicle
      const vehicle = await prisma.vehicle.create({
        data: {
          slug,
          sourceType: VehicleSourceType.COPART,
          sourceRegion: VehicleRegion.USA,
          publicationStatus: VehiclePublicationStatus.PUBLISHED,
          availabilityStatus: VehicleAvailabilityStatus.AVAILABLE,
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
            create: mediaUrls.slice(0, 20).map((src: string, i: number) => ({
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

      console.log(`  ✅ Created: ${title} — ${vehicle.id}`);
      created++;

      // Rate limit: small delay
      await new Promise(r => setTimeout(r, 200));
    } catch (error: any) {
      errors++;
      console.error(`  ❌ Error: ${raw.title || 'unknown'} — ${error.message?.substring(0, 150)}`);
    }
  }

  console.log(`\n📊 Results: ${created} created, ${skipped} skipped, ${errors} errors`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
