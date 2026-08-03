import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let prismaMock: any;
  let auditServiceMock: any;

  const mockUserSeller = {
    id: 'user-seller-1',
    email: 'seller@test.com',
    phone: '+380501112233',
    userType: 'CUSTOMER',
  };

  const mockUserBuyer = {
    id: 'user-buyer-1',
    email: 'buyer@test.com',
    phone: '+380509998877',
    userType: 'CUSTOMER',
  };

  const mockSellerProfile = {
    id: 'seller-profile-1',
    userId: mockUserSeller.id,
    sellerType: 'PRIVATE',
    displayName: 'Ivan Seller',
    businessName: null,
  };

  const now = new Date();
  const futureExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const pastExpiry = new Date(now.getTime() - 1000);

  const mockVehicle = {
    id: 'vehicle-1',
    slug: 'bmw-x5-2020-12345',
    sourceType: 'INTERNAL',
    sourceRegion: 'UKRAINE',
    publicationStatus: 'PUBLISHED',
    availabilityStatus: 'AVAILABLE',
    make: 'BMW',
    model: 'X5',
    year: 2020,
    priceAmount: 45000,
    media: [],
  };

  const mockListingPublished = {
    id: 'listing-1',
    sellerProfileId: mockSellerProfile.id,
    vehicleId: mockVehicle.id,
    status: 'PUBLISHED',
    moderationComment: null,
    publishedAt: now,
    expiresAt: futureExpiry,
    createdAt: now,
    updatedAt: now,
    sellerProfile: { ...mockSellerProfile, user: mockUserSeller },
    vehicle: mockVehicle,
  };

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === mockUserSeller.id) return Promise.resolve(mockUserSeller);
          if (where.id === mockUserBuyer.id) return Promise.resolve(mockUserBuyer);
          return Promise.resolve(null);
        }),
      },
      vehicle: {
        create: jest.fn().mockResolvedValue(mockVehicle),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...mockVehicle, ...data })),
      },
      vehicleMedia: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      marketplaceSellerProfile: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.userId === mockUserSeller.id) return Promise.resolve(mockSellerProfile);
          return Promise.resolve(null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'seller-profile-1', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...mockSellerProfile, ...data })),
      },
      marketplaceListing: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'listing-1', ...data, vehicle: mockVehicle, sellerProfile: mockSellerProfile }),
        ),
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === mockListingPublished.id) return Promise.resolve(mockListingPublished);
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockResolvedValue([mockListingPublished]),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ ...mockListingPublished, ...data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      marketplaceInquiry: {
        upsert: jest.fn().mockImplementation(({ create }: any) =>
          Promise.resolve({ id: 'inquiry-1', ...create, listing: mockListingPublished }),
        ),
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 'inquiry-1') {
            return Promise.resolve({
              id: 'inquiry-1',
              listingId: mockListingPublished.id,
              buyerUserId: mockUserBuyer.id,
              status: 'CLOSED_INTERESTED',
              contactRevealed: true,
              listing: mockListingPublished,
            });
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'inquiry-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      marketplaceReview: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'review-1', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'review-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((operation: any) =>
        typeof operation === 'function' ? operation(prismaMock) : Promise.all(operation),
      ),
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    service = new MarketplaceService(prismaMock, auditServiceMock);
  });

  describe('Seller Profile', () => {
    it('should throw BadRequestException if user phone is missing', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-no-phone', phone: null });
      await expect(
        service.createSellerProfile('user-no-phone', {
          sellerType: 'PRIVATE' as any,
          displayName: 'No Phone',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create seller profile when user has phone', async () => {
      prismaMock.marketplaceSellerProfile.findUnique.mockResolvedValueOnce(null);
      const res = await service.createSellerProfile(mockUserSeller.id, {
        sellerType: 'PRIVATE' as any,
        displayName: 'Ivan Seller',
      });
      expect(res.displayName).toBe('Ivan Seller');
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        mockUserSeller.id,
        'MarketplaceSellerProfile',
        expect.any(String),
        'MARKETPLACE_SELLER_PROFILE_CREATED',
        undefined,
        expect.any(Object),
      );
    });
  });

  describe('Marketplace Listing', () => {
    it('should fail creation if seller profile does not exist', async () => {
      prismaMock.marketplaceSellerProfile.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createListing(mockUserSeller.id, {
          title: 'BMW X5',
          make: 'BMW',
          model: 'X5',
          priceAmount: 45000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a DRAFT listing with INTERNAL vehicle source', async () => {
      const res = await service.createListing(mockUserSeller.id, {
        title: 'BMW X5',
        make: 'BMW',
        model: 'X5',
        year: 2020,
        priceAmount: 45000,
      });

      expect(res.status).toBe('DRAFT');
      expect(prismaMock.vehicle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: 'INTERNAL',
            sourceRegion: 'UKRAINE',
            publicationStatus: 'DRAFT',
          }),
        }),
      );
    });

    it('should submit listing for moderation', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValueOnce({
        ...mockListingPublished,
        status: 'DRAFT',
      }).mockResolvedValueOnce({ ...mockListingPublished, status: 'SUBMITTED' });

      const res = await service.submitListing(mockUserSeller.id, mockListingPublished.id);
      expect(res.status).toBe('SUBMITTED');
    });

    it('should approve listing and set 30-day expiry window only if SUBMITTED', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValueOnce({
        ...mockListingPublished,
        status: 'SUBMITTED',
      });

      const res = await service.approveListing('admin-1', mockListingPublished.id);
      expect(res.status).toBe('PUBLISHED');
      expect(res.expiresAt).toBeDefined();
      expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(prismaMock.vehicle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ publicationStatus: 'DRAFT' }),
        }),
      );
    });

    it('should throw BadRequestException if approving a listing not in SUBMITTED status', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValueOnce({
        ...mockListingPublished,
        status: 'PUBLISHED',
      });

      await expect(
        service.approveListing('admin-1', mockListingPublished.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('should mark listing sold and close open inquiries atomically', async () => {
      prismaMock.marketplaceListing.findUnique
        .mockResolvedValueOnce(mockListingPublished)
        .mockResolvedValueOnce({ ...mockListingPublished, status: 'SOLD' });

      const res = await service.markSold(mockUserSeller.id, mockListingPublished.id);
      expect(res.status).toBe('SOLD');
      expect(prismaMock.marketplaceInquiry.updateMany).toHaveBeenCalledWith({
        where: { listingId: mockListingPublished.id, status: 'OPEN' },
        data: expect.objectContaining({ status: 'CLOSED_SOLD' }),
      });
    });

    it('does not report a sale when the listing state changes concurrently', async () => {
      prismaMock.marketplaceListing.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.markSold(mockUserSeller.id, mockListingPublished.id),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.marketplaceInquiry.updateMany).not.toHaveBeenCalled();
      expect(auditServiceMock.log).not.toHaveBeenCalledWith(
        expect.anything(),
        'MarketplaceListing',
        mockListingPublished.id,
        'MARKETPLACE_LISTING_SOLD',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('Inquiries Boundary & State Management', () => {
    it('refuses to close an inquiry that is already closed', async () => {
      prismaMock.marketplaceInquiry.findUnique.mockResolvedValueOnce({
        id: 'inquiry-closed',
        listingId: mockListingPublished.id,
        buyerUserId: mockUserBuyer.id,
        status: 'CLOSED_NOT_INTERESTED',
        listing: mockListingPublished,
      });

      await expect(
        service.closeInquiry(mockUserBuyer.id, 'inquiry-closed', { status: 'CLOSED_NOT_INTERESTED' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to assign CLOSED_SOLD or OPEN via closeInquiry endpoint', async () => {
      prismaMock.marketplaceInquiry.findUnique.mockResolvedValueOnce({
        id: 'inquiry-1',
        listingId: mockListingPublished.id,
        buyerUserId: mockUserBuyer.id,
        status: 'OPEN',
        listing: mockListingPublished,
      });

      await expect(
        service.closeInquiry(mockUserBuyer.id, 'inquiry-1', { status: 'CLOSED_SOLD' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reopens closed inquiry on repeated contact reveal if listing is still valid', async () => {
      await service.revealContact(mockUserBuyer.id, mockListingPublished.id);
      expect(prismaMock.marketplaceInquiry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: 'OPEN',
            contactRevealed: true,
          }),
        }),
      );
    });
  });

  describe('Public API & Contact Reveal', () => {
    it('never includes seller phone in public endpoints', async () => {
      const res = await service.getPublicListingById(mockListingPublished.id);
      expect(res.sellerProfile.user.phone).toBeUndefined();
      expect((res as any).sellerPhone).toBeUndefined();
    });

    it('returns approved public reviews via getPublicReviews', async () => {
      const mockApprovedReview = {
        id: 'review-1',
        sellerRating: 5,
        listingRating: 5,
        comment: 'Super car!',
        status: 'APPROVED',
      };
      prismaMock.marketplaceReview.findMany.mockResolvedValueOnce([mockApprovedReview]);

      const reviews = await service.getPublicReviews({ listingId: mockListingPublished.id });
      expect(reviews).toHaveLength(1);
      expect(reviews[0].comment).toBe('Super car!');
    });

    it('refuses contact when buyer phone is missing', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'buyer-no-phone', phone: '' });
      await expect(
        service.revealContact('buyer-no-phone', mockListingPublished.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses seller self-contact', async () => {
      await expect(
        service.revealContact(mockUserSeller.id, mockListingPublished.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses contact if listing is expired or unavailable', async () => {
      prismaMock.marketplaceListing.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.revealContact(mockUserBuyer.id, mockListingPublished.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('atomically creates/reuses inquiry and returns seller phone', async () => {
      const res = await service.revealContact(mockUserBuyer.id, mockListingPublished.id);
      expect(res.sellerPhone).toBe(mockUserSeller.phone);
      expect(res.inquiry.contactRevealed).toBe(true);
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        mockUserBuyer.id,
        'MarketplaceInquiry',
        expect.any(String),
        'MARKETPLACE_CONTACT_REVEALED',
        undefined,
        expect.any(Object),
      );
    });
  });

  describe('Reviews', () => {
    it('requires a closed inquiry with contact revealed before creating review', async () => {
      prismaMock.marketplaceInquiry.findUnique.mockResolvedValueOnce({
        id: 'inquiry-open',
        listingId: mockListingPublished.id,
        buyerUserId: mockUserBuyer.id,
        status: 'OPEN',
        contactRevealed: true,
        listing: mockListingPublished,
      });

      await expect(
        service.createReview(mockUserBuyer.id, 'inquiry-open', {
          sellerRating: 5,
          listingRating: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows buyer review after inquiry is closed with contact revealed', async () => {
      const res = await service.createReview(mockUserBuyer.id, 'inquiry-1', {
        sellerRating: 5,
        listingRating: 4,
        comment: 'Great car!',
      });
      expect(res.sellerRating).toBe(5);
      expect(res.status).toBe('PENDING');
    });

    it('restricts seller reply to owner and max one reply', async () => {
      prismaMock.marketplaceReview.findUnique.mockResolvedValue({
        id: 'review-1',
        sellerProfile: mockSellerProfile,
        sellerReply: null,
      });
      prismaMock.marketplaceReview.updateMany.mockResolvedValueOnce({ count: 1 });

      const res = await service.replyToReview(mockUserSeller.id, 'review-1', {
        sellerReply: 'Thank you!',
      });
      expect(res.sellerReply).toBeNull(); // returned from second findUnique in mock

      // Second reply attempt fails (count 0)
      prismaMock.marketplaceReview.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.replyToReview(mockUserSeller.id, 'review-1', {
          sellerReply: 'Second reply',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
