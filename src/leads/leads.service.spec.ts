import { LeadsService } from './leads.service';

describe('LeadsService assistance operations', () => {
  const prisma = {
    $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
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
    jest.spyOn(service, 'findById')
      .mockResolvedValueOnce({ id: 'lead-1', status: 'NEW', assistanceStatus: 'NEW' } as never)
      .mockResolvedValueOnce({ id: 'lead-1' } as never);
    prisma.lead.update.mockResolvedValue({ id: 'lead-1' });

    await service.update('lead-1', { managerUserId: null }, 'admin-1');

    expect(prisma.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({ managerUserId: null }),
    }));
  });
});
