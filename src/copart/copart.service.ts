import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';

@Injectable()
export class CopartService {
  private readonly logger = new Logger(CopartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vehiclesService: VehiclesService,
  ) {}

  async sync(): Promise<{ jobId: string; status: string }> {
    // Check for active jobs
    const activeJob = await this.prisma.importJob.findFirst({
      where: { provider: 'copart', status: { in: ['PENDING', 'RUNNING'] } },
    });

    if (activeJob) {
      this.logger.warn(`Import job ${activeJob.id} is still running`);
      return { jobId: activeJob.id, status: activeJob.status };
    }

    const job = await this.prisma.importJob.create({
      data: {
        provider: 'copart',
        mode: 'full_sync',
        status: 'PENDING',
      },
    });

    this.logger.log(`Created import job: ${job.id}`);

    // Process async
    setImmediate(() => this.processImportJob(job.id));

    return { jobId: job.id, status: 'PENDING' };
  }

  async processImportJob(jobId: string): Promise<void> {
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    try {
      // TODO: Replace with actual Copart API call
      const apiKey = this.config.get('COPART_API_KEY');
      const apiUrl = this.config.get('COPART_API_URL', 'https://api.copart.com');

      if (!apiKey) {
        this.logger.warn('COPART_API_KEY not configured, skipping actual sync');
        await this.prisma.importJob.update({
          where: { id: jobId },
          data: {
            status: 'SUCCESS',
            finishedAt: new Date(),
            summaryJsonb: { created, updated, skipped, errors, note: 'No API key configured' } as any,
          },
        });
        return;
      }

      // Placeholder: fetch from API
      // const response = await fetch(`${apiUrl}/lots?apiKey=${apiKey}`);
      // const lots = await response.json();
      const lots: Record<string, any>[] = [];

      for (const raw of lots) {
        try {
          const mapped = this.mapRawToVehicle(raw);

          // Store raw import
          await this.prisma.vehicleRawImport.create({
            data: {
              provider: 'copart',
              externalLotId: String(raw.lotNumber),
              importJobId: jobId,
              payloadJsonb: raw as any,
            },
          });

          // Check if vehicle already exists
          const existing = await this.prisma.vehicleSourceBinding.findUnique({
            where: {
              provider_externalLotId: {
                provider: 'copart',
                externalLotId: String(raw.lotNumber),
              },
            },
          });

          if (existing) {
            await this.vehiclesService.update(existing.vehicleId, mapped);
            updated++;
          } else {
            const vehicle = await this.vehiclesService.create({
              ...mapped,
              sourceType: 'COPART',
              sourceRegion: 'USA',
            });

            await this.prisma.vehicleSourceBinding.create({
              data: {
                vehicleId: vehicle.id,
                provider: 'copart',
                externalLotId: String(raw.lotNumber),
                externalUrl: raw.url,
                saleStatus: raw.saleStatus,
                currentBidAmount: raw.currentBid,
                buyNowAmount: raw.buyNow,
                lastSyncedAt: new Date(),
              },
            });

            created++;
          }
        } catch (error) {
          errors++;
          this.logger.error(`Failed to process lot ${raw.lotNumber}: ${error}`);
        }
      }

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: errors > 0 && created + updated === 0 ? 'FAILED' : errors > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          finishedAt: new Date(),
          summaryJsonb: { created, updated, skipped, errors } as any,
        },
      });

      this.logger.log(
        `Import job ${jobId} completed: ${created} created, ${updated} updated, ${errors} errors`,
      );
    } catch (error) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      this.logger.error(`Import job ${jobId} failed: ${error}`);
    }
  }

  mapRawToVehicle(raw: Record<string, any>) {
    const year = Number(raw.year) || new Date().getFullYear();
    const make = String(raw.make ?? 'Unknown').trim();
    const model = String(raw.model ?? 'Unknown').trim();

    return {
      title: `${year} ${make} ${model}`,
      make,
      model,
      year,
      priceAmount: Number(raw.currentBid ?? raw.buyNow ?? 0),
      vin: raw.vin,
      odometerValue: raw.odometer ? Number(raw.odometer) : undefined,
      bodyType: raw.bodyStyle,
      fuelType: raw.fuelType,
      transmission: raw.transmission,
      driveType: raw.drive,
      damagePrimary: raw.primaryDamage,
      locationCountry: 'US',
      locationState: raw.location?.state,
      locationCity: raw.location?.city,
      mediaUrls: raw.images ?? [],
      specs: {
        engineVolume: raw.engineSize,
        enginePower: raw.engineType,
        cylinders: raw.cylinders,
        color: raw.color,
        keysAvailable: raw.hasKeys,
        lotNumber: String(raw.lotNumber),
      },
    };
  }

  async handleCronSync(): Promise<void> {
    this.logger.log('Cron-triggered Copart sync');
    await this.sync();
  }
}
