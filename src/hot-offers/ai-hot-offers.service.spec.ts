import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { HotOffersService } from './hot-offers.service';

describe('HotOffersService AI review boundary', () => {
  const lot: any = {
    id: 'lot-1', provider: 'copart', externalLotId: '123', title: '2020 HONDA CIVIC',
    make: 'HONDA', model: 'CIVIC', year: 2020, bodyStyle: 'Sedan', fuelType: null,
    transmission: null, driveType: null, locationState: 'FL', locationDisplay: 'Tampa (FL)',
    odometerKm: 30000, odometerMi: null, currentBidUsd: 1000, buyNowUsd: 5000,
    isBuyNow: true, auctionTime: new Date('2026-08-01T12:00:00.000Z'), auctionState: 'UPCOMING',
    auctionTimezoneOffset: null, mediaUrls: ['https://example.test/1.jpg'], lifecycleState: 'OPEN',
    freshnessState: 'FRESH', availabilityConfirmed: true, consecutiveMisses: 0,
    providerResultState: 'UNKNOWN', listingObservedAt: new Date('2026-07-26T10:00:00.000Z'),
    lastProviderUpdateAt: new Date('2026-07-26T10:00:00.000Z'), priceObservedAt: new Date('2026-07-26T10:00:00.000Z'),
    lastSeenAt: new Date('2026-07-26T10:00:00.000Z'), state: 'DISCOVERED', primaryDamage: null,
    secondaryDamage: null, loss: null, saleDocumentName: null, saleDocumentType: null,
    sourcePayloadHash: 'provider-hash-v1',
  };

  function createService(token?: string) {
    return new HotOffersService(
      { aiLotAnalysis: { findMany: jest.fn(), count: jest.fn() } } as any,
      { get: jest.fn().mockReturnValue(token) } as any,
    );
  }

  it('fails closed when the worker token is not configured or invalid', () => {
    expect(() => createService().assertWorkerToken('worker-token')).toThrow(ServiceUnavailableException);
    expect(() => createService('worker-token').assertWorkerToken('wrong-token')).toThrow(ForbiddenException);
    expect(() => createService('worker-token').assertWorkerToken('worker-token')).not.toThrow();
  });

  it('maps PENDING to analyses without a current decision', async () => {
    const service = createService('worker-token');
    const prisma = (service as any).prisma;
    prisma.$transaction = jest.fn().mockResolvedValue([[], 0]);

    await service.listAiReviews('PENDING');

    expect(prisma.aiLotAnalysis.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { currentDecisionId: null },
    }));
  });

  it('requires the stored analysis evidence to match the current lot facts and media', () => {
    const service = createService('worker-token') as any;
    const digest = service.digest(service.providerFactsSnapshot(lot));
    const analysis = { sourcePayloadHash: 'provider-hash-v1', sourceFactsDigest: digest, mediaCount: 1 };

    expect(service.matchesAnalysisSource(analysis, lot)).toBe(true);
    expect(service.matchesAnalysisSource(analysis, { ...lot, mediaUrls: ['https://example.test/2.jpg'] })).toBe(false);
    expect(service.matchesAnalysisSource(analysis, { ...lot, sourcePayloadHash: 'provider-hash-v2' })).toBe(false);
  });

  it('returns the review detail wrapper expected by the admin workbench', async () => {
    const service = createService('worker-token');
    const prisma = (service as any).prisma;
    prisma.aiLotAnalysis.findUnique = jest.fn().mockResolvedValue({
      id: 'analysis-1',
      discoveredLotId: lot.id,
      modelIdentifier: 'local-ai',
      policyVersion: 'v1',
      contractVersion: 'ai-hot-offer-review-v1',
      verdict: 'RECOMMEND',
      confidence: 0.9,
      reasonsJson: ['Good condition'],
      visibleRisksJson: [],
      imageIndexesJson: [0],
      mediaCount: 1,
      sourcePayloadHash: lot.sourcePayloadHash,
      sourceFactsDigest: 'digest',
      createdAt: new Date(),
      discoveredLot: lot,
      currentDecision: { id: 'decision-1', decision: 'CONFIRMED', note: null, createdAt: new Date(), decidedBy: { id: 'admin-1', email: 'admin@example.test' } },
      decisions: [],
    });

    const result = await service.getAiReviewDetail('analysis-1');

    expect(result).toEqual(expect.objectContaining({
      analysis: expect.objectContaining({ id: 'analysis-1' }),
      lot: expect.objectContaining({
        lotId: lot.id,
        currentBidUsd: 1000,
        odometerKm: 30000,
        locationState: 'FL',
        locationDisplay: 'Tampa (FL)',
        bodyStyle: 'Sedan',
        mediaUrls: ['https://example.test/1.jpg'],
        lifecycleState: 'OPEN',
      }),
      latestDecision: expect.objectContaining({ id: 'decision-1', decision: 'CONFIRMED' }),
      history: [],
    }));
  });
});
