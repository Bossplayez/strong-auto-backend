import { Test } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CopartService } from '../copart/copart.service';
import { ProviderLeaseService } from '../copart/provider-lease.service';
import { RequestBudgetService } from '../copart/request-budget.service';
import { DiscoveryService } from '../copart/discovery.service';
import { AuctionSearchService } from '../copart/auction-search.service';
import { FreshnessSchedulerService } from '../copart/freshness-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionLotsService } from '../auction-lot/auction-lots.service';

describe('AdminController traversal diagnostics', () => {
  let controller: AdminController;
  let discoveryService: { buildQueryFingerprint: jest.Mock; getCheckpointState: jest.Mock };
  let schedulerService: { getStatus: jest.Mock; getState: jest.Mock };
  let prisma: { schedulerState: { create: jest.Mock }; discoveryCheckpoint: { create: jest.Mock; update: jest.Mock; delete: jest.Mock } };

  beforeEach(async () => {
    discoveryService = {
      buildQueryFingerprint: jest.fn(({ platform }) => `fp-${platform}`),
      getCheckpointState: jest.fn().mockResolvedValue([]),
    };
    schedulerService = { getStatus: jest.fn(), getState: jest.fn() };
    prisma = {
      schedulerState: { create: jest.fn() },
      discoveryCheckpoint: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: {} },
        { provide: CopartService, useValue: {} },
        { provide: ProviderLeaseService, useValue: {} },
        { provide: RequestBudgetService, useValue: {} },
        { provide: DiscoveryService, useValue: discoveryService },
        { provide: AuctionSearchService, useValue: {} },
        { provide: FreshnessSchedulerService, useValue: schedulerService },
        { provide: PrismaService, useValue: prisma },
        { provide: AuctionLotsService, useValue: {} },
      ],
    }).compile();
    controller = moduleRef.get(AdminController);
  });

  it('returns only the canonical checkpoint projection for Copart and IAAI', async () => {
    discoveryService.getCheckpointState.mockImplementation(async (provider: string) => [
      {
        queryFingerprint: `discovery:fp-${provider}`,
        lastCursor: `${provider}-resume`,
        cycleStartedAt: '2026-07-21T08:00:00.000Z',
        lastCompletedAt: '2026-07-21T08:05:00.000Z',
        exhaustedAt: null,
        nextDueAt: '2026-07-21T09:00:00.000Z',
      },
      {
        queryFingerprint: `refresh:fp-${provider}`,
        lastCursor: 'refresh-resume',
        exhaustedAt: '2026-07-21T10:00:00.000Z',
      },
      {
        queryFingerprint: `discovery:fp-${provider}|make=TESLA`,
        lastCursor: 'manual-resume',
        exhaustedAt: '2026-07-21T11:00:00.000Z',
      },
    ]);

    const result = await controller.getTraversals();

    expect(result.items).toEqual([
      {
        provider: 'copart', status: 'continuation_available',
        cycleStartedAt: '2026-07-21T08:00:00.000Z',
        lastSuccessfulPageAt: '2026-07-21T08:05:00.000Z',
        completedAt: null, nextSweepAt: '2026-07-21T09:00:00.000Z',
      },
      {
        provider: 'iaai', status: 'continuation_available',
        cycleStartedAt: '2026-07-21T08:00:00.000Z',
        lastSuccessfulPageAt: '2026-07-21T08:05:00.000Z',
        completedAt: null, nextSweepAt: '2026-07-21T09:00:00.000Z',
      },
    ]);
    expect(result.items.every((item: any) => Object.keys(item).sort().join(',') === 'completedAt,cycleStartedAt,lastSuccessfulPageAt,nextSweepAt,provider,status')).toBe(true);
  });

  it('returns completed only for complete exhausted canonical checkpoints', async () => {
    discoveryService.getCheckpointState.mockImplementation(async (provider: string) => provider === 'copart' ? [{
      queryFingerprint: 'discovery:fp-copart', cycleStartedAt: '2026-07-21T08:00:00.000Z', exhaustedAt: '2026-07-21T10:00:00.000Z',
    }] : [{
      queryFingerprint: 'discovery:fp-iaai', lastCursor: null, exhaustedAt: null,
    }]);

    const result = await controller.getTraversals();

    expect(result.items.map((item: any) => item.status)).toEqual(['completed', 'unknown']);
  });

  it('returns unknown for a canonical continuation missing cycle data', async () => {
    discoveryService.getCheckpointState.mockImplementation(async (provider: string) => [{
      queryFingerprint: `discovery:fp-${provider}`,
      lastCursor: `${provider}-resume`,
      cycleStartedAt: null,
      lastCompletedAt: '2026-07-21T08:05:00.000Z',
    }]);

    const result = await controller.getTraversals();

    expect(result.items.map((item: any) => item.status)).toEqual(['unknown', 'unknown']);
  });

  it('returns unknown for an exhausted canonical checkpoint missing cycle data', async () => {
    discoveryService.getCheckpointState.mockImplementation(async (provider: string) => [{
      queryFingerprint: `discovery:fp-${provider}`,
      cycleStartedAt: null,
      exhaustedAt: '2026-07-21T10:00:00.000Z',
    }]);

    const result = await controller.getTraversals();

    expect(result.items.map((item: any) => item.status)).toEqual(['unknown', 'unknown']);
  });

  it('returns two unknown records without initializing scheduler or persistence state', async () => {
    const result = await controller.getTraversals();

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item: any) => item.status)).toEqual(['unknown', 'unknown']);
    expect(discoveryService.getCheckpointState).toHaveBeenCalledTimes(2);
    expect(schedulerService.getStatus).not.toHaveBeenCalled();
    expect(schedulerService.getState).not.toHaveBeenCalled();
    expect(prisma.schedulerState.create).not.toHaveBeenCalled();
    expect(prisma.discoveryCheckpoint.create).not.toHaveBeenCalled();
    expect(prisma.discoveryCheckpoint.update).not.toHaveBeenCalled();
    expect(prisma.discoveryCheckpoint.delete).not.toHaveBeenCalled();
  });
});
