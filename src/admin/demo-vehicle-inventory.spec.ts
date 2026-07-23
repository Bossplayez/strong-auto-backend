import { AdminService } from './admin.service';
import { demoVehicleInventory } from './demo-vehicle-inventory';

describe('demo vehicle inventory', () => {
  const seeds = demoVehicleInventory();

  function createService(existingSlugs: string[] = []) {
    const tx = {
      $executeRaw: jest.fn(),
      vehicle: {
        findMany: jest.fn().mockResolvedValue(existingSlugs.map((slug) => ({ slug }))),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (work: any) => work(tx)),
      vehicle: {
        groupBy: jest.fn().mockResolvedValue([
          { sourceRegion: 'UKRAINE', _count: { _all: 20 } },
          { sourceRegion: 'EUROPE', _count: { _all: 20 } },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 40 }),
      },
    };
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminService(prisma as any, {} as any, {} as any, {} as any, {} as any, auditService as any);
    return { service, prisma, tx, auditService };
  }

  it('defines exactly 20 uniquely-addressable demo vehicles per manual catalog', () => {
    expect(seeds).toHaveLength(40);
    expect(new Set(seeds.map((seed) => seed.slug)).size).toBe(40);
    expect(seeds.filter((seed) => seed.sourceRegion === 'UKRAINE')).toHaveLength(20);
    expect(seeds.filter((seed) => seed.sourceRegion === 'EUROPE')).toHaveLength(20);
  });

  it('creates only missing demo vehicles under one transaction lock', async () => {
    const { service, tx, auditService } = createService();

    await expect(service.createDemoVehicleInventory('admin-1')).resolves.toMatchObject({
      ukraine: 20,
      europe: 20,
      created: 40,
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.vehicle.create).toHaveBeenCalledTimes(40);
    expect(tx.vehicle.create.mock.calls[0][0].data).toMatchObject({
      isDemo: true,
      sourceType: 'INTERNAL',
      publicationStatus: 'PUBLISHED',
      availabilityStatus: 'AVAILABLE',
      media: { create: { sourceUrl: '/demo-vehicle-placeholder.svg', isPrimary: true } },
    });
    expect(auditService.log).toHaveBeenCalledWith('admin-1', 'DemoVehicleInventory', 'ukraine-europe', 'CREATE', undefined, {
      created: 40,
      existing: 0,
    });
  });

  it('does not duplicate an already complete demo inventory', async () => {
    const { service, tx } = createService(seeds.map((seed) => seed.slug));

    await expect(service.createDemoVehicleInventory('admin-1')).resolves.toMatchObject({ created: 0 });

    expect(tx.vehicle.create).not.toHaveBeenCalled();
  });

  it('deletes only explicitly marked internal Ukraine and Europe demo vehicles', async () => {
    const { service, prisma, auditService } = createService();

    await expect(service.deleteDemoVehicleInventory('admin-1')).resolves.toMatchObject({ deleted: 40 });

    expect(prisma.vehicle.deleteMany).toHaveBeenCalledWith({
      where: { isDemo: true, sourceType: 'INTERNAL', sourceRegion: { in: ['UKRAINE', 'EUROPE'] } },
    });
    expect(auditService.log).toHaveBeenCalledWith('admin-1', 'DemoVehicleInventory', 'ukraine-europe', 'DELETE', undefined, {
      deleted: 40,
    });
  });
});
