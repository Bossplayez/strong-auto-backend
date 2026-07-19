import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        specs: true,
        media: { orderBy: { sortOrder: 'asc' } },
        contentTranslations: true,
        sourceBindings: true,
      },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with id "${id}" not found`);
    }

    return vehicle;
  }

  async create(data: {
    title: string;
    make: string;
    model: string;
    year: number | null;
    priceAmount: number;
    currency?: string;
    sourceType?: 'INTERNAL' | 'COPART' | 'IAAI';
    sourceRegion?: string;
    vin?: string;
    odometerValue?: number;
    bodyType?: string;
    fuelType?: string;
    transmission?: string;
    driveType?: string;
    damagePrimary?: string;
    locationCountry?: string;
    locationCity?: string;
    locationState?: string;
    publicationStatus?: 'DRAFT' | 'READY' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
    specs?: Record<string, any>;
    mediaUrls?: string[];
  }) {
    const slug = await this.generateSlug(data.make, data.model, data.year);

    const vehicle = await this.prisma.vehicle.create({
      data: {
        slug,
        title: data.title,
        make: data.make,
        model: data.model,
        year: data.year,
        priceAmount: data.priceAmount,
        currency: data.currency ?? 'USD',
        sourceType: data.sourceType ?? 'INTERNAL',
        sourceRegion: (data.sourceRegion as any) ?? 'UKRAINE',
        publicationStatus: data.publicationStatus ?? 'DRAFT',
        publishedAt: data.publicationStatus === 'PUBLISHED' ? new Date() : null,
        availabilityStatus: 'AVAILABLE',
        vin: data.vin,
        odometerValue: data.odometerValue,
        bodyType: data.bodyType,
        fuelType: data.fuelType,
        transmission: data.transmission,
        driveType: data.driveType,
        damagePrimary: data.damagePrimary,
        locationCountry: data.locationCountry,
        locationCity: data.locationCity,
        locationState: data.locationState,
        ...(data.specs && {
          specs: {
            create: {
              engineVolume: data.specs.engineVolume,
              enginePower: data.specs.enginePower,
              cylinders: data.specs.cylinders,
              doors: data.specs.doors,
              color: data.specs.color,
              keysAvailable: data.specs.keysAvailable,
            },
          },
        }),
        ...(data.mediaUrls?.length && {
          media: {
            create: data.mediaUrls.map((url, i) => ({
              sourceUrl: url,
              sortOrder: i,
              isPrimary: i === 0,
            })),
          },
        }),
      },
      include: {
        specs: true,
        media: true,
      },
    });

    return vehicle;
  }

  async update(id: string, data: Record<string, any>) {
    await this.findById(id); // throws if not found

    const vehicle = await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.make !== undefined && { make: data.make }),
        ...(data.model !== undefined && { model: data.model }),
        ...(data.year !== undefined && { year: data.year }),
        ...(data.priceAmount !== undefined && { priceAmount: data.priceAmount }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.sourceRegion !== undefined && { sourceRegion: data.sourceRegion }),
        ...(data.vin !== undefined && { vin: data.vin }),
        ...(data.odometerValue !== undefined && { odometerValue: data.odometerValue }),
        ...(data.bodyType !== undefined && { bodyType: data.bodyType }),
        ...(data.fuelType !== undefined && { fuelType: data.fuelType }),
        ...(data.transmission !== undefined && { transmission: data.transmission }),
        ...(data.driveType !== undefined && { driveType: data.driveType }),
        ...(data.damagePrimary !== undefined && { damagePrimary: data.damagePrimary }),
        ...(data.locationCountry !== undefined && { locationCountry: data.locationCountry }),
        ...(data.locationCity !== undefined && { locationCity: data.locationCity }),
        ...(data.locationState !== undefined && { locationState: data.locationState }),
        ...(data.availabilityStatus && { availabilityStatus: data.availabilityStatus }),
        ...(data.isRecommended !== undefined && { isRecommended: data.isRecommended }),
        ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
        ...(data.seoDescription !== undefined && { seoDescription: data.seoDescription }),
      },
      include: { specs: true, media: true },
    });

    return vehicle;
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.vehicle.update({
      where: { id },
      data: {
        publicationStatus: 'ARCHIVED',
        availabilityStatus: 'NOT_AVAILABLE',
      },
    });
  }

  async publish(id: string) {
    const vehicle = await this.findById(id);

    if (vehicle.publicationStatus === 'PUBLISHED') {
      throw new ConflictException('Vehicle is already published');
    }

    // Validate required fields
    const missing: string[] = [];
    if (!vehicle.title) missing.push('назва');
    if (!vehicle.year) missing.push('рік');
    if (!vehicle.priceAmount || vehicle.priceAmount.toString() === '0') missing.push('ціна');
    if (!vehicle.locationCountry) missing.push('регіон');
    if (!vehicle.locationCity) missing.push('місто');
    if (vehicle.odometerValue === null || vehicle.odometerValue === undefined) missing.push('пробіг');
    if (!vehicle.bodyType) missing.push('стан');
    if (!vehicle.fuelType) missing.push('стан');
    if (!vehicle.media || vehicle.media.length === 0) missing.push('фото');

    if (missing.length > 0) {
      throw new ConflictException(
        `Не заповнені обов'язкові поля: ${missing.join(', ')}`,
      );
    }

    // VIN format + duplicate check
    if (vehicle.vin) {
      const vin = vehicle.vin.trim().toUpperCase();
      if (vin.length !== 17 || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
        throw new ConflictException('VIN має некоректний формат (має бути 17 символів A-Z, 0-9, без I/O/Q)');
      }
      const duplicate = await this.prisma.vehicle.findFirst({
        where: { vin: vin, id: { not: id }, sourceType: 'INTERNAL' },
      });
      if (duplicate) {
        throw new ConflictException('Авто з таким VIN вже існує');
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: {
        publicationStatus: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }

  async hide(id: string) {
    const vehicle = await this.findById(id);

    if (vehicle.publicationStatus !== 'PUBLISHED' && vehicle.publicationStatus !== 'READY') {
      throw new ConflictException('Only PUBLISHED or READY vehicles can be hidden');
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: { publicationStatus: 'HIDDEN' },
    });
  }

  async generateSlug(make: string, model: string, year: number | null): Promise<string> {
    const base = `${make}-${model}-${year ?? 'unknown'}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Ensure uniqueness
    const existing = await this.prisma.vehicle.count({
      where: { slug: { startsWith: base } },
    });

    return existing > 0 ? `${base}-${existing + 1}` : base;
  }
}
