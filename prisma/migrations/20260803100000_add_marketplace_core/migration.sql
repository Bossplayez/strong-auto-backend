-- CreateEnum
CREATE TYPE "MarketplaceSellerType" AS ENUM ('PRIVATE', 'DEALER');

-- CreateEnum
CREATE TYPE "MarketplaceListingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'HIDDEN', 'SOLD', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MarketplaceInquiryStatus" AS ENUM ('OPEN', 'CLOSED_INTERESTED', 'CLOSED_NOT_INTERESTED', 'CLOSED_SOLD');

-- CreateEnum
CREATE TYPE "MarketplaceReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "marketplace_seller_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "seller_type" "MarketplaceSellerType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "business_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_seller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "seller_profile_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "status" "MarketplaceListingStatus" NOT NULL DEFAULT 'DRAFT',
    "moderation_comment" TEXT,
    "published_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_inquiries" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "status" "MarketplaceInquiryStatus" NOT NULL DEFAULT 'OPEN',
    "contact_revealed" BOOLEAN NOT NULL DEFAULT true,
    "contact_revealed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_reviews" (
    "id" TEXT NOT NULL,
    "inquiry_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "seller_profile_id" TEXT NOT NULL,
    "seller_rating" INTEGER NOT NULL,
    "listing_rating" INTEGER NOT NULL,
    "comment" TEXT,
    "seller_reply" TEXT,
    "seller_replied_at" TIMESTAMP(3),
    "status" "MarketplaceReviewStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_seller_profiles_user_id_key" ON "marketplace_seller_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_vehicle_id_key" ON "marketplace_listings"("vehicle_id");

-- CreateIndex
CREATE INDEX "marketplace_listings_status_expires_at_idx" ON "marketplace_listings"("status", "expires_at");

-- CreateIndex
CREATE INDEX "marketplace_listings_seller_profile_id_idx" ON "marketplace_listings"("seller_profile_id");

-- CreateIndex
CREATE INDEX "marketplace_inquiries_listing_id_idx" ON "marketplace_inquiries"("listing_id");

-- CreateIndex
CREATE INDEX "marketplace_inquiries_buyer_user_id_idx" ON "marketplace_inquiries"("buyer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_inquiries_listing_id_buyer_user_id_key" ON "marketplace_inquiries"("listing_id", "buyer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_reviews_inquiry_id_key" ON "marketplace_reviews"("inquiry_id");

-- CreateIndex
CREATE INDEX "marketplace_reviews_listing_id_status_idx" ON "marketplace_reviews"("listing_id", "status");

-- CreateIndex
CREATE INDEX "marketplace_reviews_seller_profile_id_status_idx" ON "marketplace_reviews"("seller_profile_id", "status");

-- AddForeignKey
ALTER TABLE "marketplace_seller_profiles" ADD CONSTRAINT "marketplace_seller_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "marketplace_seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_inquiries" ADD CONSTRAINT "marketplace_inquiries_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_inquiries" ADD CONSTRAINT "marketplace_inquiries_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "marketplace_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "marketplace_seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
