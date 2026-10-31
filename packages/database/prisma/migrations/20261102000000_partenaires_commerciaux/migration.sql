-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_REQUESTED', 'QUALIFIED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "AttributionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttributionSource" AS ENUM ('PROSPECT', 'REFERRAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('SETUP', 'MONTHLY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'VALIDATED', 'REVERSED', 'PAID');

-- CreateEnum
CREATE TYPE "CommissionPayoutStatus" AS ENUM ('RECORDED', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "SubscriptionPayment" ADD COLUMN     "collectedByPartnerId" UUID;

-- AlterTable
ALTER TABLE "DemoRequest" ADD COLUMN     "partnerId" UUID,
ADD COLUMN     "prospectId" UUID;

-- CreateTable
CREATE TABLE "Partner" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "territories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "cashCollectionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cashCollectionLimit" INTEGER NOT NULL DEFAULT 0,
    "commissionRuleId" UUID,
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "setupRateBps" INTEGER NOT NULL,
    "monthlyRateBps" INTEGER NOT NULL,
    "monthlyWindowMonths" INTEGER NOT NULL,
    "productId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "validatedById" UUID,
    "validatedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "email" TEXT,
    "emailNormalized" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "productId" UUID,
    "status" "ProspectStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "protectedUntil" TIMESTAMP(3) NOT NULL,
    "organizationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attribution" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "prospectId" UUID,
    "source" "AttributionSource" NOT NULL,
    "status" "AttributionStatus" NOT NULL DEFAULT 'PENDING',
    "ruleId" UUID,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "attributionId" UUID NOT NULL,
    "subscriptionPaymentId" UUID,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "kind" "CommissionKind" NOT NULL,
    "baseAmount" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "validatedById" UUID,
    "validatedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "payoutId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPayout" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" UUID NOT NULL,
    "total" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "status" "CommissionPayoutStatus" NOT NULL DEFAULT 'RECORDED',
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_userId_key" ON "Partner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

-- CreateIndex
CREATE INDEX "Partner_status_idx" ON "Partner"("status");

-- CreateIndex
CREATE INDEX "CommissionRule_isActive_productId_idx" ON "CommissionRule"("isActive", "productId");

-- CreateIndex
CREATE INDEX "Prospect_partnerId_createdAt_idx" ON "Prospect"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "Prospect_phoneNormalized_idx" ON "Prospect"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Prospect_emailNormalized_idx" ON "Prospect"("emailNormalized");

-- CreateIndex
CREATE INDEX "Prospect_normalizedName_idx" ON "Prospect"("normalizedName");

-- CreateIndex
CREATE INDEX "Attribution_organizationId_status_idx" ON "Attribution"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Attribution_partnerId_status_idx" ON "Attribution"("partnerId", "status");

-- CreateIndex
CREATE INDEX "Commission_partnerId_status_idx" ON "Commission"("partnerId", "status");

-- CreateIndex
CREATE INDEX "Commission_payoutId_idx" ON "Commission"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_subscriptionPaymentId_kind_key" ON "Commission"("subscriptionPaymentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPayout_number_key" ON "CommissionPayout"("number");

-- CreateIndex
CREATE INDEX "CommissionPayout_partnerId_paidAt_idx" ON "CommissionPayout"("partnerId", "paidAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_collectedByPartnerId_status_idx" ON "SubscriptionPayment"("collectedByPartnerId", "status");

-- CreateIndex
CREATE INDEX "DemoRequest_partnerId_createdAt_idx" ON "DemoRequest"("partnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_collectedByPartnerId_fkey" FOREIGN KEY ("collectedByPartnerId") REFERENCES "Partner"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "Attribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_subscriptionPaymentId_fkey" FOREIGN KEY ("subscriptionPaymentId") REFERENCES "SubscriptionPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "CommissionPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayout" ADD CONSTRAINT "CommissionPayout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Contraintes de cohérence (Sprint 12B) ───
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_rates_check"
  CHECK ("setupRateBps" BETWEEN 0 AND 10000 AND "monthlyRateBps" BETWEEN 0 AND 10000
         AND "monthlyWindowMonths" BETWEEN 0 AND 120);
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_cash_limit_check" CHECK ("cashCollectionLimit" >= 0);
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_code_check" CHECK ("code" ~ '^[A-Z0-9]{4,16}$');
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_amount_check"
  CHECK ("rateBps" BETWEEN 0 AND 10000 AND ("kind" = 'ADJUSTMENT' OR ("amount" >= 0 AND "baseAmount" >= 0)));
ALTER TABLE "CommissionPayout" ADD CONSTRAINT "CommissionPayout_total_check" CHECK ("total" >= 0);
