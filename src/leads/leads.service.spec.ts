import { LeadsService } from './leads.service';
import { validate } from 'class-validator';
import { AdminLeadQueryDto } from '../admin/dto/admin-lead-query.dto';
import { UpdateLeadDto } from '../admin/dto/update-lead.dto';

describe('LeadsService assistance operations', () => {
  const prisma = {
    $transaction: jest.fn((operation: ((tx: any) => Promise<unknown>) | Promise<unknown>[]) =>
      typeof operation === 'function' ? operation(prisma) : Promise.all(operation)),
    lead: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    leadStatusHistory: { create: jest.fn() },
    leadComment: { create: jest.fn() },
  };
  const service = new LeadsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters auction assistance requests and searches lot data in the database query', async () => {
    prisma.lead.findMany.mockResolvedValue([]);
    prisma.lead.count.mockResolvedValue(0);

    await service.findAll({ auctionOnly: 'true', search: '45679910' });

    const where = prisma.lead.findMany.mock.calls[0][0].where;
    expect(where.leadType).toEqual({ in: ['BID_ASSISTANCE', 'BUY_NOW_ASSISTANCE'] });
    expect(where.OR).toEqual(expect.arrayContaining([
      { discoveredLot: { is: { externalLotId: { contains: '45679910', mode: 'insensitive' } } } },
    ]));
  });

  it('persists an explicit manager clear instead of ignoring null', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', status: 'NEW', assistanceStatus: 'NEW' });
    prisma.lead.update.mockResolvedValue({ id: 'lead-1' });
    jest.spyOn(service, 'findById').mockResolvedValue({ id: 'lead-1' } as never);

    await service.update('lead-1', { managerUserId: null }, 'admin-1');

    expect(prisma.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({ managerUserId: null }),
    }));
  });

  it('atomically synchronizes NEW assistance completion to QUALIFIED and records history', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', status: 'NEW', assistanceStatus: 'NEW' });
    prisma.lead.update.mockResolvedValue({ id: 'lead-1' });
    jest.spyOn(service, 'findById').mockResolvedValue({ id: 'lead-1' } as never);

    await service.update('lead-1', { assistanceStatus: 'COMPLETED' }, 'admin-1');

    expect(prisma.leadStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'NEW', toStatus: 'QUALIFIED', changedByUserId: 'admin-1' }),
    });
    expect(prisma.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assistanceStatus: 'COMPLETED', status: 'QUALIFIED' }),
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it('rejects a contradictory lead status when assistance is completed', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', status: 'NEW', assistanceStatus: 'NEW' });

    await expect(service.update('lead-1', {
      assistanceStatus: 'COMPLETED',
      status: 'WON',
    }, 'admin-1')).rejects.toThrow('Completing assistance requires the QUALIFIED lead status.');

    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(prisma.leadStatusHistory.create).not.toHaveBeenCalled();
  });

  it('rejects assignment to a user without an administrator or manager role', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', status: 'NEW', assistanceStatus: 'NEW' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'customer-1',
      userType: 'CUSTOMER',
      userRoles: [],
    });

    await expect(service.update('lead-1', {
      managerUserId: 'customer-1',
    }, 'admin-1')).rejects.toThrow('Assigned user must be an administrator or manager.');

    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('accepts canonical Prisma lead statuses and rejects legacy CLOSED', async () => {
    const qualified = new UpdateLeadDto();
    qualified.status = 'QUALIFIED' as any;
    const closed = new AdminLeadQueryDto();
    closed.status = 'CLOSED' as any;

    expect(await validate(qualified)).toHaveLength(0);
    expect(await validate(closed)).not.toHaveLength(0);
  });
});
