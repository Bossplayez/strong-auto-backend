import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateSellerProfileDto,
  UpdateSellerProfileDto,
} from './dto/create-seller-profile.dto';
import {
  CreateMarketplaceListingDto,
  UpdateMarketplaceListingDto,
} from './dto/create-marketplace-listing.dto';
import {
  CloseInquiryDto,
  CreateReviewDto,
  SellerReplyDto,
  ModerateReviewDto,
  MarketplaceInquiryStatusDto,
  MarketplaceReviewStatusDto,
} from './dto/marketplace-inquiry-review.dto';
import { MarketplaceQueryDto } from './dto/marketplace-query.dto';

const EXPIRY_DAYS = 30;

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private get db(): any {
    return this.prisma;
  }

  private async requireMarketplacePhone(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.phone || user.phone.trim() === '') {
      throw new BadRequestException(
        'Seller phone is required for marketplace activity',
      );
    }
    return user;
  }

  // ---------------------------------------------------------------------------
  // Seller Profile
  // ---------------------------------------------------------------------------

  async createSellerProfile(userId: string, dto: CreateSellerProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.phone || user.phone.trim() === '') {
      throw new BadRequestException(
        'Seller phone is required for marketplace activity',
      );
    }

    const existing = await this.db.marketplaceSellerProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new BadRequestException('User already has a seller profile');
    }

    const profile = await this.db.marketplaceSellerProfile.create({
      data: {
        userId,
        sellerType: dto.sellerType,
        displayName: dto.displayName,
        businessName: dto.businessName ?? null,
      },
    });

    await this.auditService.log(
      userId,
      'MarketplaceSellerProfile',
      profile.id,
      'MARKETPLACE_SELLER_PROFILE_CREATED',
      undefined,
      profile,
    );

    return profile;
  }

  async getSellerProfile(userId: string) {
    const profile = await this.db.marketplaceSellerProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }
    return profile;
  }

  async updateSellerProfile(userId: string, dto: UpdateSellerProfileDto) {
    const profile = await this.getSellerProfile(userId);
    const updated = await this.db.marketplaceSellerProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.sellerType && { sellerType: dto.sellerType }),
        ...(dto.displayName && { displayName: dto.displayName }),
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
      },
    });

    await this.auditService.log(
      userId,
      'MarketplaceSellerProfile',
      profile.id,
      'MARKETPLACE_SELLER_PROFILE_UPDATED',
      profile,
      updated,
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Seller Listings
  // ---------------------------------------------------------------------------

  async createListing(userId: string, dto: CreateMarketplaceListingDto) {
    const sellerProfile = await this.db.marketplaceSellerProfile.findUnique({
      where: { userId },
    });
    if (!sellerProfile) {
      throw new BadRequestException(
        'Seller profile required before creating a marketplace listing',
      );
    }

    await this.requireMarketplacePhone(userId);

    const slug = `${dto.make.toLowerCase()}-${dto.model.toLowerCase()}-${dto.year || ''}-${Date.now()}`.replace(
      /[^a-z0-9-]+/g,
      '-',
    );

    const vehicle = await this.prisma.vehicle.create({
      data: {
        slug,
        sourceType: 'INTERNAL',
        sourceRegion: 'UKRAINE',
        publicationStatus: 'DRAFT',
        availabilityStatus: 'AVAILABLE',
        title: dto.title,
        make: dto.make,
        model: dto.model,
        year: dto.year ?? null,
        priceAmount: dto.priceAmount,
        currency: dto.currency ?? 'USD',
        odometerValue: dto.odometerValue ?? null,
        bodyType: dto.bodyType ?? null,
        fuelType: dto.fuelType ?? null,
        transmission: dto.transmission ?? null,
        driveType: dto.driveType ?? null,
        damagePrimary: dto.damage ?? null,
        seoDescription: dto.description ?? null,
        locationCountry: dto.locationCountry ?? 'Ukraine',
        locationCity: dto.locationCity ?? null,
        locationState: dto.locationState ?? null,
        vin: dto.vin ?? null,
      },
    });

    if (dto.mediaUrls && dto.mediaUrls.length > 0) {
      await this.prisma.vehicleMedia.createMany({
        data: dto.mediaUrls.map((url, idx) => ({
          vehicleId: vehicle.id,
          sourceUrl: url,
          sortOrder: idx,
          isPrimary: idx === 0,
        })),
      });
    }

    const listing = await this.db.marketplaceListing.create({
      data: {
        sellerProfileId: sellerProfile.id,
        vehicleId: vehicle.id,
        status: 'DRAFT',
      },
      include: {
        vehicle: {
          include: { media: true },
        },
        sellerProfile: true,
      },
    });

    await this.auditService.log(
      userId,
      'MarketplaceListing',
      listing.id,
      'MARKETPLACE_LISTING_CREATED',
      undefined,
      listing,
    );

    return listing;
  }

  async getSellerListings(userId: string) {
    const sellerProfile = await this.getSellerProfile(userId);
    return this.db.marketplaceListing.findMany({
      where: { sellerProfileId: sellerProfile.id },
      include: {
        vehicle: {
          include: { media: true },
        },
        inquiries: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateListing(
    userId: string,
    listingId: string,
    dto: UpdateMarketplaceListingDto,
  ) {
    const listing = await this.db.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { sellerProfile: true, vehicle: true },
    });

    if (!listing) {
      throw new NotFoundException('Marketplace listing not found');
    }

    if (listing.sellerProfile.userId !== userId) {
      throw new ForbiddenException('Not authorized to edit this listing');
    }

    if (!['DRAFT', 'REJECTED', 'PUBLISHED'].includes(listing.status)) {
      throw new BadRequestException(`Listing in status ${listing.status} cannot be modified`);
    }

    const resubmitForModeration = listing.status === 'PUBLISHED';
    const updatedListing = await this.prisma.$transaction(async (tx: any) => {
      const changed = await tx.marketplaceListing.updateMany({
        where: { id: listingId, status: listing.status },
        data: resubmitForModeration
          ? { status: 'SUBMITTED', publishedAt: null, expiresAt: null, moderationComment: null }
          : {},
      });
      if (changed.count !== 1) {
        throw new ConflictException('Listing status changed. Reload and try again.');
      }

      await tx.vehicle.update({
        where: { id: listing.vehicleId },
        data: {
          ...(dto.title && { title: dto.title }),
          ...(dto.make && { make: dto.make }),
          ...(dto.model && { model: dto.model }),
          ...(dto.year !== undefined && { year: dto.year }),
          ...(dto.priceAmount !== undefined && { priceAmount: dto.priceAmount }),
          ...(dto.currency && { currency: dto.currency }),
          ...(dto.odometerValue !== undefined && { odometerValue: dto.odometerValue }),
          ...(dto.bodyType !== undefined && { bodyType: dto.bodyType }),
          ...(dto.fuelType !== undefined && { fuelType: dto.fuelType }),
          ...(dto.transmission !== undefined && { transmission: dto.transmission }),
          ...(dto.driveType !== undefined && { driveType: dto.driveType }),
          ...(dto.damage !== undefined && { damagePrimary: dto.damage }),
          ...(dto.description !== undefined && { seoDescription: dto.description }),
          ...(dto.locationCountry !== undefined && { locationCountry: dto.locationCountry }),
          ...(dto.locationCity !== undefined && { locationCity: dto.locationCity }),
          ...(dto.locationState !== undefined && { locationState: dto.locationState }),
          ...(dto.vin !== undefined && { vin: dto.vin }),
          ...(resubmitForModeration && { publicationStatus: 'DRAFT' }),
        },
      });

      if (dto.mediaUrls !== undefined) {
        await tx.vehicleMedia.deleteMany({ where: { vehicleId: listing.vehicleId } });
        if (dto.mediaUrls.length > 0) {
          await tx.vehicleMedia.createMany({
            data: dto.mediaUrls.map((url, idx) => ({
              vehicleId: listing.vehicleId,
              sourceUrl: url,
              sortOrder: idx,
              isPrimary: idx === 0,
            })),
          });
        }
      }

      return tx.marketplaceListing.findUnique({
        where: { id: listingId },
        include: { vehicle: { include: { media: true } }, sellerProfile: true },
      });
    });

    await this.auditService.log(
      userId,
      'MarketplaceListing',
      listingId,
      'MARKETPLACE_LISTING_UPDATED',
      listing,
      updatedListing,
    );

    return updatedListing;
  }

  async submitListing(userId: string, listingId: string) {
    const listing = await this.db.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { sellerProfile: true },
    });

    if (!listing) {
      throw new NotFoundException('Marketplace listing not found');
    }

    if (listing.sellerProfile.userId !== userId) {
      throw new ForbiddenException('Not authorized to submit this listing');
    }

    await this.requireMarketplacePhone(userId);

    if (listing.status !== 'DRAFT' && listing.status !== 'REJECTED') {
      throw new BadRequestException(
        `Listing in status ${listing.status} cannot be submitted for moderation`,
      );
    }

    const changed = await this.db.marketplaceListing.updateMany({
      where: { id: listingId, status: listing.status },
      data: { status: 'SUBMITTED', moderationComment: null },
    });
    if (changed.count !== 1) {
      throw new BadRequestException('Listing status changed. Reload and try again.');
    }
    const updated = await this.db.marketplaceListing.findUnique({
      where: { id: listingId }, include: { vehicle: true, sellerProfile: true },
    });

    await this.auditService.log(
      userId,
      'MarketplaceListing',
      listingId,
      'MARKETPLACE_LISTING_SUBMITTED',
      listing,
      updated,
    );

    return updated;
  }

  async renewListing(userId: string, listingId: string) {
    const listing = await this.db.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { sellerProfile: true },
    });

    if (!listing) {
      throw new NotFoundException('Marketplace listing not found');
    }

    if (listing.sellerProfile.userId !== userId) {
      throw new ForbiddenException('Not authorized to renew this listing');
    }

    await this.requireMarketplacePhone(userId);

    if (listing.status !== 'PUBLISHED' && listing.status !== 'EXPIRED') {
      throw new BadRequestException(`Cannot renew listing in status ${listing.status}`);
    }

    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const newStatus = listing.status === 'EXPIRED' ? 'PUBLISHED' : listing.status;

    const changed = await this.db.marketplaceListing.updateMany({
      where: { id: listingId, status: listing.status },
      data: { status: newStatus, expiresAt: newExpiresAt },
    });
    if (changed.count !== 1) {
      throw new BadRequestException('Listing status changed. Reload and try again.');
    }
    const updated = await this.db.marketplaceListing.findUnique({
      where: { id: listingId }, include: { vehicle: true, sellerProfile: true },
    });

    await this.auditService.log(
      userId,
      'MarketplaceListing',
      listingId,
      'MARKETPLACE_LISTING_RENEWED',
      listing,
      updated,
    );

    return updated;
  }

  async markSold(userId: string, listingId: string) {
    const listing = await this.db.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { sellerProfile: true },
    });

    if (!listing) {
      throw new NotFoundException('Marketplace listing not found');
    }

    if (listing.sellerProfile.userId !== userId) {
      throw new ForbiddenException('Not authorized to mark this listing as sold');
    }

    if (listing.status === 'SOLD') {
      return listing;
    }

    if (listing.status !== 'PUBLISHED') {
      throw new BadRequestException('Only published listings can be marked as sold');
    }

    const now = new Date();

    // Transaction to update listing status to SOLD and close open inquiries atomically
    const updatedListing = await this.prisma.$transaction(async (tx: any) => {
      const changed = await tx.marketplaceListing.updateMany({
        where: { id: listingId, status: 'PUBLISHED' },
        data: { status: 'SOLD' },
      });
      if (changed.count !== 1) {
        throw new ConflictException('Listing status changed. Reload and try again.');
      }
      await tx.vehicle.update({
        where: { id: listing.vehicleId },
        data: { publicationStatus: 'HIDDEN', availabilityStatus: 'SOLD' },
      });
      await tx.marketplaceInquiry.updateMany({
        where: { listingId, status: 'OPEN' },
        data: { status: 'CLOSED_SOLD', closedAt: now, closedReason: 'Listing marked as sold by seller' },
      });
      return tx.marketplaceListing.findUnique({
        where: { id: listingId }, include: { vehicle: true, sellerProfile: true },
      });
    });

    await this.auditService.log(
      userId,
      'MarketplaceListing',
      listingId,
      'MARKETPLACE_LISTING_SOLD',
      listing,
      updatedListing,
    );

    return updatedListing;
  }

  // ---------------------------------------------------------------------------
  // Admin Moderation
  // ---------------------------------------------------------------------------

  async approveListing(adminUserId: string, listingId: string) {
    const listing = await this.db.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { vehicle: true, sellerProfile: { include: { user: true } } },
    });

    if (!listing) {
      throw new NotFoundException('Marketplace listing not found');
    }

    if (listing.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot approve listing in status ${listing.status}. Only SUBMITTED listings can be approved.`,
      );
    }

    await this.requireMarketplacePhone(listing.sellerProfile.userId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const changed = await tx.marketplaceListing.updateMany({
        where: { id: listingId, status: 'SUBMITTED' },
        data: { status: 'PUBLISHED', publishedAt: now, expiresAt, moderationComment: null },
      });
      if (changed.count !== 1) {
        throw new BadRequestException('Listing status changed. Reload and try again.');
      }
      await tx.vehicle.update({
        where: { id: listing.vehicleId },
        // Marketplace has its own public projection. Keeping the backing Vehicle
        // as a draft prevents a single seller listing from leaking into the
        // legacy manual catalog through its unrelated publication predicate.
        data: { publicationStatus: 'DRAFT', availabilityStatus: 'AVAILABLE' },
      });
      return tx.marketplaceListing.findUnique({
        where: { id: listingId }, include: { vehicle: true, sellerProfile: true },
      });
    });

    await this.auditService.log(
      adminUserId,
      'MarketplaceListing',
      listingId,
      'MARKETPLACE_LISTING_APPROVED',
      listing,
      updated,
    );

    return updated;
  }

  async rejectListing(
    adminUserId: string,
    listingId: string,
    moderationComment: string,
  ) {
    const listing = await this.db.marketplaceListing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException('Marketplace listing not found');
    }

    if (listing.status !== 'SUBMITTED') {
      throw new BadRequestException('Only submitted listings can be rejected');
    }

    const changed = await this.db.marketplaceListing.updateMany({
      where: { id: listingId, status: 'SUBMITTED' },
      data: { status: 'REJECTED', moderationComment },
    });
    if (changed.count !== 1) {
      throw new BadRequestException('Listing status changed. Reload and try again.');
    }
    const updated = await this.db.marketplaceListing.findUnique({
      where: { id: listingId }, include: { vehicle: true, sellerProfile: true },
    });

    await this.prisma.vehicle.update({
      where: { id: listing.vehicleId },
      data: {
        publicationStatus: 'DRAFT',
      },
    });

    await this.auditService.log(
      adminUserId,
      'MarketplaceListing',
      listingId,
      'MARKETPLACE_LISTING_REJECTED',
      listing,
      updated,
    );

    return updated;
  }

  async getAdminListings(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    return this.db.marketplaceListing.findMany({
      where,
      include: {
        vehicle: { include: { media: true } },
        sellerProfile: {
          include: {
            user: { select: { id: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Public Marketplace Endpoints (Phone Masked)
  // ---------------------------------------------------------------------------

  async getPublicListings(query: MarketplaceQueryDto) {
    const now = new Date();

    // Canonical public predicate: status = PUBLISHED and expiresAt > now
    const where: any = {
      status: 'PUBLISHED',
      expiresAt: { gt: now },
      vehicle: {},
    };

    if (query.make) {
      where.vehicle.make = { equals: query.make, mode: 'insensitive' };
    }
    if (query.model) {
      where.vehicle.model = { equals: query.model, mode: 'insensitive' };
    }
    if (query.city) {
      where.vehicle.locationCity = { equals: query.city, mode: 'insensitive' };
    }
    if (query.bodyType) {
      where.vehicle.bodyType = { equals: query.bodyType, mode: 'insensitive' };
    }
    if (query.sellerType) {
      where.sellerProfile = { sellerType: query.sellerType };
    }
    if (query.yearFrom || query.yearTo) {
      where.vehicle.year = {
        ...(query.yearFrom && { gte: query.yearFrom }),
        ...(query.yearTo && { lte: query.yearTo }),
      };
    }
    if (query.priceFrom || query.priceTo) {
      where.vehicle.priceAmount = {
        ...(query.priceFrom && { gte: query.priceFrom }),
        ...(query.priceTo && { lte: query.priceTo }),
      };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.db.marketplaceListing.findMany({
        where,
        skip,
        take: limit,
        orderBy: { publishedAt: 'desc' },
        include: {
          vehicle: {
            include: { media: true },
          },
          sellerProfile: {
            select: {
              id: true,
              sellerType: true,
              displayName: true,
              businessName: true,
            },
          },
        },
      }),
      this.db.marketplaceListing.count({ where }),
    ]);

    // Ensure phone is never present in output
    const safeItems = items.map((item: any) => this.sanitizePublicListing(item));

    return {
      items: safeItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPublicListingById(listingId: string) {
    const now = new Date();
    const listing = await this.db.marketplaceListing.findUnique({
      where: { id: listingId },
      include: {
        vehicle: {
          include: { media: true },
        },
        sellerProfile: {
          select: {
            id: true,
            sellerType: true,
            displayName: true,
            businessName: true,
          },
        },
        reviews: {
          where: { status: 'APPROVED' },
          select: {
            id: true,
            sellerRating: true,
            listingRating: true,
            comment: true,
            sellerReply: true,
            sellerRepliedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (
      !listing ||
      listing.status !== 'PUBLISHED' ||
      !listing.expiresAt ||
      listing.expiresAt <= now
    ) {
      throw new NotFoundException('Marketplace listing not found or unavailable');
    }

    return this.sanitizePublicListing(listing);
  }

  private sanitizePublicListing(listing: any) {
    // Prisma returns a fresh object in production, but keep this boundary
    // immutable so a caller can never observe a side effect on a shared object.
    const publicUser = { ...(listing.sellerProfile?.user ?? {}) };
    delete publicUser.phone;
    delete publicUser.email;
    return {
      ...listing,
      sellerProfile: listing.sellerProfile
        ? {
            ...listing.sellerProfile,
            ...(listing.sellerProfile.user ? { user: publicUser } : {}),
          }
        : listing.sellerProfile,
    };
  }

  // ---------------------------------------------------------------------------
  // Authenticated Contact Endpoint (Reveals Seller Phone Idempotently)
  // ---------------------------------------------------------------------------

  async revealContact(buyerUserId: string, listingId: string) {
    const buyer = await this.prisma.user.findUnique({
      where: { id: buyerUserId },
    });
    if (!buyer) {
      throw new NotFoundException('Buyer user not found');
    }
    if (!buyer.phone || buyer.phone.trim() === '') {
      throw new BadRequestException(
        'Buyer phone is required to reveal seller contact',
      );
    }

    const now = new Date();
    const { listing, inquiry, sellerPhone } = await this.prisma.$transaction(async (tx: any) => {
      // A guarded write locks the listing row. A concurrent sale must finish before
      // this succeeds, so an inquiry cannot be reopened for an unavailable vehicle.
      const available = await tx.marketplaceListing.updateMany({
        where: { id: listingId, status: 'PUBLISHED', expiresAt: { gt: now } },
        data: { updatedAt: now },
      });
      if (available.count !== 1) {
        throw new BadRequestException('Listing is not currently available for contact');
      }
      const current = await tx.marketplaceListing.findUnique({
        where: { id: listingId },
        include: { sellerProfile: { include: { user: { select: { id: true, phone: true } } } }, vehicle: true },
      });
      if (!current) throw new NotFoundException('Marketplace listing not found');
      if (current.sellerProfile.userId === buyerUserId) {
        throw new BadRequestException('Sellers cannot contact their own listings');
      }
      const phone = current.sellerProfile.user?.phone;
      if (!phone) throw new BadRequestException('Seller phone number is unavailable');
      const opened = await tx.marketplaceInquiry.upsert({
        where: { listingId_buyerUserId: { listingId, buyerUserId } },
        create: { listingId, buyerUserId, status: 'OPEN', contactRevealed: true, contactRevealedAt: now },
        update: { status: 'OPEN', contactRevealed: true, contactRevealedAt: now, closedAt: null, closedReason: null },
        include: { listing: { include: { vehicle: true } } },
      });
      return { listing: current, inquiry: opened, sellerPhone: phone };
    });

    await this.auditService.log(
      buyerUserId,
      'MarketplaceInquiry',
      inquiry.id,
      'MARKETPLACE_CONTACT_REVEALED',
      undefined,
      { listingId, buyerUserId, inquiryId: inquiry.id },
    );

    return {
      sellerPhone,
      sellerProfile: {
        id: listing.sellerProfile.id,
        sellerType: listing.sellerProfile.sellerType,
        displayName: listing.sellerProfile.displayName,
        businessName: listing.sellerProfile.businessName,
      },
      inquiry,
    };
  }

  // ---------------------------------------------------------------------------
  // Inquiry Management
  // ---------------------------------------------------------------------------

  async getBuyerInquiries(buyerUserId: string) {
    const inquiries = await this.db.marketplaceInquiry.findMany({
      where: { buyerUserId },
      include: {
        listing: {
          include: {
            vehicle: { include: { media: true } },
            sellerProfile: {
              include: {
                user: { select: { phone: true } },
              },
            },
          },
        },
        review: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return inquiries.map((inquiry: any) => ({
      ...inquiry,
      sellerPhone: inquiry.listing?.sellerProfile?.user?.phone ?? null,
    }));
  }

  async getSellerInquiries(sellerUserId: string) {
    const sellerProfile = await this.getSellerProfile(sellerUserId);
    return this.db.marketplaceInquiry.findMany({
      where: {
        listing: { sellerProfileId: sellerProfile.id },
      },
      include: {
        buyer: {
          select: { id: true, phone: true, profile: true },
        },
        listing: {
          include: { vehicle: true },
        },
        review: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async closeInquiry(userId: string, inquiryId: string, dto: CloseInquiryDto) {
    const inquiry = await this.db.marketplaceInquiry.findUnique({
      where: { id: inquiryId },
      include: {
        listing: { include: { sellerProfile: true } },
      },
    });

    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }

    if (inquiry.status !== 'OPEN') {
      throw new BadRequestException('Only open inquiries can be closed');
    }

    const isBuyer = inquiry.buyerUserId === userId;
    const isSeller = inquiry.listing.sellerProfile.userId === userId;

    if (!isBuyer && !isSeller) {
      throw new ForbiddenException('Not authorized to close this inquiry');
    }

    if (dto.status) {
      if (dto.status === ('CLOSED_SOLD' as any) || dto.status === ('OPEN' as any)) {
        throw new BadRequestException(`Cannot assign status ${dto.status} via close endpoint`);
      }
      if (isBuyer && dto.status !== 'CLOSED_NOT_INTERESTED') {
        throw new BadRequestException('Buyers can only close inquiries with status CLOSED_NOT_INTERESTED');
      }
      if (isSeller && dto.status !== 'CLOSED_INTERESTED') {
        throw new BadRequestException('Sellers can only close inquiries with status CLOSED_INTERESTED');
      }
    }

    const targetStatus =
      dto.status ?? (isBuyer ? 'CLOSED_NOT_INTERESTED' : 'CLOSED_INTERESTED');

    const updated = await this.db.marketplaceInquiry.update({
      where: { id: inquiryId },
      data: {
        status: targetStatus,
        closedAt: new Date(),
        closedReason: dto.reason ?? null,
      },
    });

    await this.auditService.log(
      userId,
      'MarketplaceInquiry',
      inquiryId,
      'MARKETPLACE_INQUIRY_CLOSED',
      inquiry,
      updated,
    );

    return updated;
  }

  async getAdminInquiries() {
    return this.db.marketplaceInquiry.findMany({
      include: {
        buyer: { select: { id: true, email: true, phone: true } },
        listing: {
          include: {
            vehicle: true,
            sellerProfile: true,
          },
        },
        review: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Reviews & Seller Reply
  // ---------------------------------------------------------------------------

  async createReview(
    buyerUserId: string,
    inquiryId: string,
    dto: CreateReviewDto,
  ) {
    const inquiry = await this.db.marketplaceInquiry.findUnique({
      where: { id: inquiryId },
      include: {
        listing: { include: { sellerProfile: true } },
      },
    });

    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }

    if (inquiry.buyerUserId !== buyerUserId) {
      throw new ForbiddenException('Not authorized to review this inquiry');
    }

    if (!inquiry.contactRevealed) {
      throw new BadRequestException(
        'Buyer review requires a contact-revealed inquiry',
      );
    }

    if (inquiry.status === 'OPEN') {
      throw new BadRequestException(
        'Buyer review requires a closed inquiry with contact revealed',
      );
    }

    const existingReview = await this.db.marketplaceReview.findUnique({
      where: { inquiryId },
    });

    if (existingReview) {
      throw new BadRequestException('A review has already been submitted for this inquiry');
    }

    try {
      const review = await this.db.marketplaceReview.create({
        data: {
          inquiryId,
          listingId: inquiry.listingId,
          buyerUserId,
          sellerProfileId: inquiry.listing.sellerProfileId,
          sellerRating: dto.sellerRating,
          listingRating: dto.listingRating,
          comment: dto.comment ?? null,
          status: 'PENDING',
        },
      });

      await this.auditService.log(
        buyerUserId,
        'MarketplaceReview',
        review.id,
        'MARKETPLACE_REVIEW_SUBMITTED',
        undefined,
        review,
      );

      return review;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('A review has already been submitted for this inquiry');
      }
      throw err;
    }
  }

  async replyToReview(
    sellerUserId: string,
    reviewId: string,
    dto: SellerReplyDto,
  ) {
    const review = await this.db.marketplaceReview.findUnique({
      where: { id: reviewId },
      include: { sellerProfile: true },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.sellerProfile.userId !== sellerUserId) {
      throw new ForbiddenException('Not authorized to reply to this review');
    }

    if (review.sellerReply) {
      throw new BadRequestException('Seller has already replied to this review');
    }

    const updatedResult = await this.db.marketplaceReview.updateMany({
      where: {
        id: reviewId,
        sellerReply: null,
      },
      data: {
        sellerReply: dto.sellerReply,
        sellerRepliedAt: new Date(),
      },
    });

    if (updatedResult.count === 0) {
      throw new BadRequestException('Seller has already replied to this review');
    }

    const updated = await this.db.marketplaceReview.findUnique({
      where: { id: reviewId },
    });

    await this.auditService.log(
      sellerUserId,
      'MarketplaceReview',
      reviewId,
      'MARKETPLACE_REVIEW_REPLIED',
      review,
      updated,
    );

    return updated;
  }

  async getPublicReviews(filters?: { listingId?: string; sellerProfileId?: string }) {
    const where: any = {
      status: 'APPROVED',
    };
    if (filters?.listingId) {
      where.listingId = filters.listingId;
    }
    if (filters?.sellerProfileId) {
      where.sellerProfileId = filters.sellerProfileId;
    }

    return this.db.marketplaceReview.findMany({
      where,
      select: {
        id: true,
        sellerRating: true,
        listingRating: true,
        comment: true,
        sellerReply: true,
        sellerRepliedAt: true,
        createdAt: true,
        listingId: true,
        sellerProfileId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSellerReviews(userId: string) {
    const sellerProfile = await this.getSellerProfile(userId);
    return this.db.marketplaceReview.findMany({
      where: { sellerProfileId: sellerProfile.id },
      select: {
        id: true, sellerRating: true, listingRating: true, comment: true,
        sellerReply: true, sellerRepliedAt: true, status: true, createdAt: true,
        listingId: true, sellerProfileId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async moderateReview(
    adminUserId: string,
    reviewId: string,
    dto: ModerateReviewDto,
  ) {
    const review = await this.db.marketplaceReview.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    const updated = await this.db.marketplaceReview.update({
      where: { id: reviewId },
      data: {
        status: dto.status,
      },
    });

    await this.auditService.log(
      adminUserId,
      'MarketplaceReview',
      reviewId,
      'MARKETPLACE_REVIEW_MODERATED',
      review,
      updated,
    );

    return updated;
  }

  async getAdminReviews() {
    return this.db.marketplaceReview.findMany({
      include: {
        buyer: { select: { id: true, email: true } },
        sellerProfile: true,
        listing: { include: { vehicle: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Expiry Reconciliation
  // ---------------------------------------------------------------------------

  async reconcileExpiredListings() {
    const now = new Date();
    const expiredListings = await this.db.marketplaceListing.findMany({
      where: {
        status: 'PUBLISHED',
        expiresAt: { lte: now },
      },
    });

    const reconciledIds: string[] = [];

    for (const listing of expiredListings) {
      const updated = await this.db.marketplaceListing.updateMany({
        where: { id: listing.id, status: 'PUBLISHED', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      if (updated.count !== 1) continue;

      await this.auditService.log(
        null,
        'MarketplaceListing',
        listing.id,
        'MARKETPLACE_LISTING_EXPIRED',
        listing,
        { status: 'EXPIRED' },
      );

      reconciledIds.push(listing.id);
    }

    return { reconciledCount: reconciledIds.length, reconciledIds };
  }
}
