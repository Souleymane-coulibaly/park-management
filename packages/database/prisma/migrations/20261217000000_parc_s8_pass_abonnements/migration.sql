-- Ocall Parc sprint 8 : pass et abonnements des visiteurs (domaine distinct des abonnements SaaS).
-- Migration ADDITIVE : aucun billet, aucune vente, aucun passage, aucun client existant n'est modifié ;
-- colonnes facultatives ajoutées aux lignes de vente et au journal des passages.

-- CreateEnum
CREATE TYPE "PassKind" AS ENUM ('DAY', 'WEEK', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PassDurationUnit" AS ENUM ('DAYS', 'MONTHS');

-- CreateEnum
CREATE TYPE "PassQrMode" AS ENUM ('STATIC', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PassPeriodStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PassCardStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "PassEventType" AS ENUM ('SOLD', 'ACTIVATED', 'RENEWAL_ORDERED', 'RENEWED', 'SUSPENDED', 'REACTIVATED', 'CANCELLED', 'PHOTO_UPDATED', 'LINK_ISSUED', 'LINK_REVOKED', 'CARD_ISSUED', 'CARD_REVOKED', 'CARD_PRINT_REQUESTED');

-- AlterEnum
ALTER TYPE "StoredFileKind" ADD VALUE 'PASS_HOLDER_PHOTO';

-- AlterEnum


ALTER TYPE "TicketScanRefusal" ADD VALUE 'QUOTA_REACHED';
ALTER TYPE "TicketScanRefusal" ADD VALUE 'DAILY_QUOTA_REACHED';
ALTER TYPE "TicketScanRefusal" ADD VALUE 'DAY_NOT_ALLOWED';
ALTER TYPE "TicketScanRefusal" ADD VALUE 'SUSPENDED';
ALTER TYPE "TicketScanRefusal" ADD VALUE 'QR_EXPIRED';
ALTER TYPE "TicketScanRefusal" ADD VALUE 'QR_REUSED';
ALTER TYPE "TicketScanRefusal" ADD VALUE 'CARD_REVOKED';

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "passOfferId" UUID;

-- AlterTable
ALTER TABLE "TicketScan" ADD COLUMN     "cardId" UUID,
ADD COLUMN     "localDate" DATE,
ADD COLUMN     "passId" UUID,
ADD COLUMN     "passWindowKey" TEXT;

-- CreateTable
CREATE TABLE "PassOffer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "PassKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "durationUnit" "PassDurationUnit" NOT NULL DEFAULT 'DAYS',
    "durationValue" INTEGER NOT NULL DEFAULT 1,
    "totalEntries" INTEGER,
    "dailyEntries" INTEGER,
    "allowedWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "qrMode" "PassQrMode" NOT NULL DEFAULT 'STATIC',
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "renewable" BOOLEAN NOT NULL DEFAULT false,
    "maxSuspensionDays" INTEGER NOT NULL DEFAULT 0,
    "suspensionExtends" BOOLEAN NOT NULL DEFAULT true,
    "conditions" TEXT NOT NULL DEFAULT '',
    "saleFrom" DATE,
    "saleUntil" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassOfferSite" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "price" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PassOfferSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" "PassKind" NOT NULL,
    "holderName" TEXT NOT NULL,
    "photoFileId" UUID,
    "rules" JSONB NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "publicId" TEXT NOT NULL,
    "qrVersion" INTEGER NOT NULL DEFAULT 1,
    "linkTokenHash" TEXT,
    "linkIssuedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassPeriod" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "passId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "saleLineId" UUID NOT NULL,
    "status" "PassPeriodStatus" NOT NULL DEFAULT 'PENDING',
    "isRenewal" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE,
    "endDate" DATE,
    "price" INTEGER NOT NULL,
    "entriesUsed" INTEGER NOT NULL DEFAULT 0,
    "extendedDays" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "passId" UUID NOT NULL,
    "type" "PassEventType" NOT NULL,
    "actorMembershipId" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassCard" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "passId" UUID NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "status" "PassCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "replacesCardId" UUID,
    "issuedById" UUID NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "revokeReason" TEXT,
    "printRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PassOffer_organizationId_isActive_idx" ON "PassOffer"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PassOffer_organizationId_name_key" ON "PassOffer"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PassOfferSite_establishmentId_idx" ON "PassOfferSite"("establishmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PassOfferSite_offerId_establishmentId_key" ON "PassOfferSite"("offerId", "establishmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_publicId_key" ON "Pass"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_linkTokenHash_key" ON "Pass"("linkTokenHash");

-- CreateIndex
CREATE INDEX "Pass_organizationId_status_idx" ON "Pass"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Pass_customerId_idx" ON "Pass"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PassPeriod_saleLineId_key" ON "PassPeriod"("saleLineId");

-- CreateIndex
CREATE INDEX "PassPeriod_passId_idx" ON "PassPeriod"("passId");

-- CreateIndex
CREATE INDEX "PassEvent_passId_createdAt_idx" ON "PassEvent"("passId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PassCard_cardNumber_key" ON "PassCard"("cardNumber");

-- CreateIndex
CREATE INDEX "PassCard_passId_idx" ON "PassCard"("passId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketScan_passWindowKey_key" ON "TicketScan"("passWindowKey");

-- CreateIndex
CREATE INDEX "TicketScan_passId_localDate_idx" ON "TicketScan"("passId", "localDate");

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_passOfferId_fkey" FOREIGN KEY ("passOfferId") REFERENCES "PassOffer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassOffer" ADD CONSTRAINT "PassOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassOfferSite" ADD CONSTRAINT "PassOfferSite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassOfferSite" ADD CONSTRAINT "PassOfferSite_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PassOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassOfferSite" ADD CONSTRAINT "PassOfferSite_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PassOffer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassPeriod" ADD CONSTRAINT "PassPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassPeriod" ADD CONSTRAINT "PassPeriod_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassPeriod" ADD CONSTRAINT "PassPeriod_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassPeriod" ADD CONSTRAINT "PassPeriod_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassEvent" ADD CONSTRAINT "PassEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassEvent" ADD CONSTRAINT "PassEvent_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassCard" ADD CONSTRAINT "PassCard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassCard" ADD CONSTRAINT "PassCard_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Une seule carte active par pass : une carte de remplacement ne réactive jamais l'ancienne.
CREATE UNIQUE INDEX "PassCard_one_active" ON "PassCard"("passId") WHERE "status" = 'ACTIVE';

-- Cohérence des offres, des périodes et des quotas.
ALTER TABLE "PassOffer" ADD CONSTRAINT "PassOffer_values_check" CHECK (
  "price" >= 0 AND "durationValue" >= 1
  AND ("totalEntries" IS NULL OR "totalEntries" >= 1)
  AND ("dailyEntries" IS NULL OR "dailyEntries" >= 1)
  AND "maxSuspensionDays" >= 0
  AND "allowedWeekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
);
ALTER TABLE "PassOfferSite" ADD CONSTRAINT "PassOfferSite_price_check" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "PassPeriod" ADD CONSTRAINT "PassPeriod_values_check" CHECK (
  "price" >= 0 AND "entriesUsed" >= 0 AND "extendedDays" >= 0
  AND ("status" <> 'PAID' OR ("startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate" >= "startDate"))
);
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_dates_check" CHECK ("endDate" >= "startDate");
