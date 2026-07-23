import { CalculatorEngineService } from './calculator-engine.service';

const input = {
  provider: 'iaai' as const,
  fuelType: 1 as const,
  bodyType: 1 as const,
  platformId: '531',
  year: 2020,
  priceUsd: 3150,
  engineVolumeCc: 2000,
};

const dealerResult = {
  success: true,
  result: {
    lot_price: '3150',
    auction_fee: '805',
    usa_delivery: '970',
    sea_delivery: '1000',
    customs_clearance_total: '4250',
    total_price: '11875',
  },
};

describe('CalculatorEngineService', () => {
  const originalFetch = global.fetch;
  const originalProfileId = process.env.DEALER_CALCULATOR_PROFILE_ID;

  beforeEach(() => {
    process.env.DEALER_CALCULATOR_PROFILE_ID = 'test-profile';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalProfileId === undefined)
      delete process.env.DEALER_CALCULATOR_PROFILE_ID;
    else process.env.DEALER_CALCULATOR_PROFILE_ID = originalProfileId;
  });

  it('uses the dealer profile session and returns its real calculation fields', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<input value="session-uid" name="uid" type="hidden">',
      })
      .mockResolvedValueOnce({ ok: true, json: async () => dealerResult });
    global.fetch = fetchMock as typeof fetch;

    const result = await new CalculatorEngineService().preview(input, 'buyNow');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'available',
        basis: 'buyNow',
        breakdown: expect.objectContaining({
          totalUsd: 11875,
          auctionFeeUsd: 805,
        }),
      }),
    );
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    const body = new URLSearchParams(request.body as string);
    expect(body.get('uid')).toBe('session-uid');
    expect(body.get('auction')).toBe('2');
    expect(body.get('platform')).toBe('531');
    expect(body.get('insunance')).toBe('1');
  });

  it('caches an identical calculation without another dealer request', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<input name="uid" value="cached-session">',
      })
      .mockResolvedValueOnce({ ok: true, json: async () => dealerResult });
    global.fetch = fetchMock as typeof fetch;
    const service = new CalculatorEngineService();

    await service.preview(input, 'currentBid');
    await service.preview(input, 'currentBid');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('combines simultaneous identical calculations into one dealer request', async () => {
    let resolveCalculation: ((value: unknown) => void) | undefined;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<input name="uid" value="cached-session">',
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCalculation = resolve;
        }),
      );
    global.fetch = fetchMock as typeof fetch;
    const service = new CalculatorEngineService();

    const first = service.preview(input, 'currentBid');
    const second = service.preview(input, 'currentBid');
    await Promise.resolve();
    await Promise.resolve();
    resolveCalculation?.({ ok: true, json: async () => dealerResult });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not call the dealer when its server-only profile is missing', async () => {
    delete process.env.DEALER_CALCULATOR_PROFILE_ID;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      new CalculatorEngineService().preview(input, 'currentBid'),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'ENGINE_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
