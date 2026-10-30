-- CreateEnum
CREATE TYPE "QrOrderSource" AS ENUM ('QR', 'KIOSK');

-- CreateEnum
CREATE TYPE "LoyaltyTransactionKind" AS ENUM ('EARN', 'REDEEM', 'ADJUST', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StaffPositionKind" AS ENUM ('CASHIER', 'KITCHEN', 'ENTRANCE', 'SURVEILLANCE', 'CLEANING', 'OTHER');

-- AlterEnum
ALTER TYPE "OrderChannel" ADD VALUE 'KIOSK';

-- AlterTable
ALTER TABLE "Establishment" ADD COLUMN     "orderRequestSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "QrOrderRequest" ADD COLUMN     "displayNumber" INTEGER,
ADD COLUMN     "kioskDeviceId" UUID,
ADD COLUMN     "kioskSessionId" UUID,
ADD COLUMN     "source" "QrOrderSource" NOT NULL DEFAULT 'QR';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "customerId" UUID,
ADD COLUMN     "loyaltyDiscount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "pairingCodeHash" TEXT,
    "pairingCodeExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskSession" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "KioskSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "consentAt" TIMESTAMP(3),
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsentAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "activity" "SaleActivity" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "earnAmountStep" INTEGER NOT NULL DEFAULT 1000,
    "redeemValue" INTEGER NOT NULL DEFAULT 10,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyWallet" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "activity" "SaleActivity" NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "kind" "LoyaltyTransactionKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "saleId" UUID,
    "reason" TEXT,
    "actorMembershipId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPosition" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StaffPositionKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_tokenHash_key" ON "KioskDevice"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_pairingCodeHash_key" ON "KioskDevice"("pairingCodeHash");

-- CreateIndex
CREATE INDEX "KioskDevice_organizationId_idx" ON "KioskDevice"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_establishmentId_name_key" ON "KioskDevice"("establishmentId", "name");

-- CreateIndex
CREATE INDEX "KioskSession_deviceId_startedAt_idx" ON "KioskSession"("deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "Customer_organizationId_lastVisitAt_idx" ON "Customer"("organizationId", "lastVisitAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_phone_key" ON "Customer"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyRule_organizationId_activity_key" ON "LoyaltyRule"("organizationId", "activity");

-- CreateIndex
CREATE INDEX "LoyaltyWallet_organizationId_idx" ON "LoyaltyWallet"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyWallet_customerId_activity_key" ON "LoyaltyWallet"("customerId", "activity");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_walletId_createdAt_idx" ON "LoyaltyTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTransaction_organizationId_idempotencyKey_key" ON "LoyaltyTransaction"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPosition_organizationId_name_key" ON "StaffPosition"("organizationId", "name");

-- CreateIndex
CREATE INDEX "StaffAssignment_organizationId_establishmentId_startsAt_idx" ON "StaffAssignment"("organizationId", "establishmentId", "startsAt");

-- CreateIndex
CREATE INDEX "StaffAssignment_membershipId_startsAt_idx" ON "StaffAssignment"("membershipId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "QrOrderRequest_kioskSessionId_key" ON "QrOrderRequest"("kioskSessionId");

-- CreateIndex
CREATE INDEX "QrOrderRequest_kioskDeviceId_createdAt_idx" ON "QrOrderRequest"("kioskDeviceId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_kioskDeviceId_fkey" FOREIGN KEY ("kioskDeviceId") REFERENCES "KioskDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_kioskSessionId_fkey" FOREIGN KEY ("kioskSessionId") REFERENCES "KioskSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskSession" ADD CONSTRAINT "KioskSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRule" ADD CONSTRAINT "LoyaltyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyWallet" ADD CONSTRAINT "LoyaltyWallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyWallet" ADD CONSTRAINT "LoyaltyWallet_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "LoyaltyWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPosition" ADD CONSTRAINT "StaffPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "StaffPosition"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Garde-fous en base (ajoutés à la main, non gérés par Prisma) : un solde de points n'est jamais
-- négatif, un créneau de planning finit après son début.
ALTER TABLE "LoyaltyWallet" ADD CONSTRAINT "LoyaltyWallet_balance_non_negative" CHECK ("balance" >= 0);
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_ends_after_start" CHECK ("endsAt" > "startsAt");
