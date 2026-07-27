import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiLotReviewDecisionState } from '@prisma/client';
import { HotOffersService } from './hot-offers.service';
import { SubmitAiLotAnalysisDto } from './dto/ai-hot-offers.dto';

const now = new Date();
const lot = {
  id: 'lot-1', provider: 'copart', externalLotId: '123', title: '2020 TOYOTA CAMRY',
  make: 'TOYOTA', model: 'CAMRY', year: 2020, bodyStyle: 'Sedan', fuelType: null,
  transmission: null, driveType: null, locationState: 'FL', locationDisplay: 'Tampa (FL)',
  odometerKm: 30000, odometerMi: null, currentBidUsd: 1000, buyNowUsd: 5000,
  isBuyNow: true, auctionTime: new Date(now.getTime() + 24 * 60 * 60 * 1000), auctionState: 'UPCOMING',
  auctionTimezoneOffset: null, mediaUrls: ['https://example.test/1.jpg'], lifecycleState: 'OPEN',
  freshnessState: 'FRESH', availabilityConfirmed: true, consecutiveMisses: 0,
  providerResultState: 'UNKNOWN', listingObservedAt: now, lastProviderUpdateAt: now,
  priceObservedAt: now, lastSeenAt: now, state: 'DISCOVERED', primaryDamage: null,
  secondaryDamage: null, loss: null, saleDocumentName: null, saleDocumentType: null,
  sourcePayloadHash: 'source-v1',
};
const dto = {
  lotId: lot.id,
  modelIdentifier: 'local-ai',
  policyVersion: 'v1',
  verdict: 'RECOMMEND' as const,
  confidence: 0.9,
  reasons: ['Visible exterior condition is acceptable'],
  visibleRisks: [{ code: 'COSMETIC', description: 'Small cosmetic risk', imageIndexes: [0] }],
  referencedImageIndexes: [0],
};

function createService(publicGateEnabled = true) {
  const prisma: any = {
    discoveredLot: { findUnique: jest.fn().mockResolvedValue(lot) },
    aiLotAnalysis: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    aiLotReviewDecision: { create: jest.fn(), findUnique: jest.fn() },
    auctionLotFavorite: { findMany: jest.fn() },
    siteSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (value: any) => Array.isArray(value) ? Promise.all(value) : value(prisma));
  return {
    service: new HotOffersService(prisma, {
      get: jest.fn((key: string) => key === 'AI_HOT_OFFERS_PUBLIC_GATE_ENABLED'
        ? publicGateEnabled
        : '1234567890123456'),
    } as any),
    prisma,
  };
}

function payloadDigest() {
  return createHash('sha256').update(JSON.stringify({
    verdict: dto.verdict,
    confidence: dto.confidence,
    reasons: dto.reasons,
    visibleRisks: dto.visibleRisks,
    referencedImageIndexes: dto.referencedImageIndexes,
  })).digest('hex');
}

describe('Task 0033 — AI Hot Offers evidence contract', () => {
  it('is idempotent only for the same payload and source revision', async () => {
    const { service, prisma } = createService();
    const s: any = service;
    const digest = s.digest(s.providerFactsSnapshot(lot));
    prisma.aiLotAnalysis.findUnique.mockResolvedValue({
      id: 'analysis-1', discoveredLotId: lot.id, modelIdentifier: dto.modelIdentifier,
      policyVersion: dto.policyVersion, contractVersion: 'ai-hot-offer-review-v1',
      verdict: dto.verdict, confidence: dto.confidence, reasonsJson: dto.reasons,
      visibleRisksJson: dto.visibleRisks, imageIndexesJson: dto.referencedImageIndexes,
      mediaCount: 1, sourcePayloadHash: lot.sourcePayloadHash, sourceFactsDigest: digest,
      payloadDigest: payloadDigest(), createdAt: now,
    });

    await service.submitAiAnalysis(dto as any);

    expect(prisma.aiLotAnalysis.create).not.toHaveBeenCalled();
  });

  it('creates a new immutable analysis run when provider facts change', async () => {
    const { service, prisma } = createService();
    prisma.discoveredLot.findUnique.mockResolvedValue({ ...lot, sourcePayloadHash: 'source-v2' });
    prisma.aiLotAnalysis.findUnique.mockResolvedValue(null);
    prisma.aiLotAnalysis.create.mockImplementation(async ({ data }: any) => ({ id: 'analysis-2', ...data, createdAt: now }));

    await service.submitAiAnalysis(dto as any);

    expect(prisma.aiLotAnalysis.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ discoveredLotId_modelIdentifier_policyVersion_sourceFactsDigest: expect.any(Object) }),
    }));
    expect(prisma.aiLotAnalysis.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourcePayloadHash: 'source-v2', mediaCount: 1 }),
    }));
  });

  it('writes an immutable decision then advances only that analysis current pointer', async () => {
    const { service, prisma } = createService();
    const s: any = service;
    const sourceFactsDigest = s.digest(s.providerFactsSnapshot(lot));
    prisma.aiLotAnalysis.findUnique
      .mockResolvedValueOnce({ id: 'analysis-1', discoveredLotId: lot.id, sourcePayloadHash: lot.sourcePayloadHash, sourceFactsDigest, mediaCount: 1, discoveredLot: lot })
      .mockResolvedValueOnce({
        id: 'analysis-1', discoveredLotId: lot.id, modelIdentifier: 'local-ai', policyVersion: 'v1',
        contractVersion: 'ai-hot-offer-review-v1', verdict: 'RECOMMEND', confidence: 0.9,
        reasonsJson: [], visibleRisksJson: [], imageIndexesJson: [], mediaCount: 1,
        sourcePayloadHash: lot.sourcePayloadHash, sourceFactsDigest, createdAt: now,
        discoveredLot: lot, currentDecision: null, decisions: [],
      });
    prisma.aiLotReviewDecision.create.mockResolvedValue({ id: 'decision-1' });
    prisma.aiLotReviewDecision.findUnique.mockResolvedValue({ analysisId: 'analysis-1' });
    prisma.aiLotAnalysis.update = jest.fn().mockResolvedValue({});

    await service.decideAiReview('analysis-1', { decision: AiLotReviewDecisionState.CONFIRMED }, 'admin-1');

    expect(prisma.aiLotReviewDecision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ analysisId: 'analysis-1', decidedByUserId: 'admin-1' }),
    }));
    expect(prisma.aiLotAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-1' }, data: { currentDecisionId: 'decision-1' },
    });
  });

  it('publishes only a confirmed analysis whose saved evidence still matches', async () => {
    const { service, prisma } = createService();
    const s: any = service;
    const sourceFactsDigest = s.digest(s.providerFactsSnapshot(lot));
    prisma.aiLotAnalysis.findMany.mockResolvedValue([
      { sourcePayloadHash: lot.sourcePayloadHash, sourceFactsDigest, mediaCount: 1, discoveredLot: lot },
      { sourcePayloadHash: lot.sourcePayloadHash, sourceFactsDigest, mediaCount: 1, discoveredLot: lot },
    ]);

    const current = await service.getPublicHotOffers();
    expect(current.tiers.urgent.items).toHaveLength(1);

    prisma.aiLotAnalysis.findMany.mockResolvedValue([{ sourcePayloadHash: 'old-source', sourceFactsDigest, mediaCount: 1, discoveredLot: lot }]);
    const changed = await service.getPublicHotOffers();
    expect(changed.tiers.urgent.items).toHaveLength(0);
  });

  it('keeps the existing public ranking active until the AI publication gate is enabled', async () => {
    const { service } = createService(false);
    const subject = service as any;
    subject.buildTiers = jest.fn().mockResolvedValue({
      urgent: { items: [], allCandidates: [] },
      'this-week': { items: [], allCandidates: [] },
    });
    subject.buildConfirmedPublicTiers = jest.fn();

    await service.getPublicHotOffers();

    expect(subject.buildTiers).toHaveBeenCalled();
    expect(subject.buildConfirmedPublicTiers).not.toHaveBeenCalled();
  });

  it('uses the same confirmed evidence gate for personalized recommendations', async () => {
    const { service, prisma } = createService();
    const s: any = service;
    const sourceFactsDigest = s.digest(s.providerFactsSnapshot(lot));
    prisma.auctionLotFavorite.findMany.mockResolvedValue([{ discoveredLot: lot, createdAt: now }]);
    prisma.aiLotAnalysis.findMany.mockResolvedValue([{ sourcePayloadHash: lot.sourcePayloadHash, sourceFactsDigest, mediaCount: 1, discoveredLot: lot }]);

    const current = await service.getPersonalHotOffers('user-1');
    expect(current.items).toHaveLength(1);

    prisma.aiLotAnalysis.findMany.mockResolvedValue([{ sourcePayloadHash: 'old-source', sourceFactsDigest, mediaCount: 1, discoveredLot: lot }]);
    const changed = await service.getPersonalHotOffers('user-1');
    expect(changed.items).toHaveLength(0);
  });

  it('requires non-empty AI evidence fields in the worker DTO', async () => {
    const invalid = plainToInstance(SubmitAiLotAnalysisDto, {
      ...dto,
      modelIdentifier: '',
      policyVersion: '',
      reasons: [''],
      visibleRisks: [{ code: '', description: '', imageIndexes: [] }],
      referencedImageIndexes: [],
    });

    const errors = await validate(invalid);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      'modelIdentifier', 'policyVersion', 'reasons', 'referencedImageIndexes',
    ]));
    expect(errors.find((error) => error.property === 'visibleRisks')?.children?.[0].children?.map((error) => error.property))
      .toEqual(expect.arrayContaining(['code', 'description', 'imageIndexes']));
  });
});
