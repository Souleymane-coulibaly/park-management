-- Socle commercial Ocall Suite (Sprint S1) : essai gratuit, frais de mise en service uniques, option vitrine.
-- Migration ADDITIVE uniquement (aucune suppression, aucune modification de données existantes).
-- Les nouvelles valeurs d'énumération sont utilisées par la migration suivante (transaction distincte).
-- CreateEnum
CREATE TYPE "SetupFeeStatus" AS ENUM ('DUE', 'INVOICED', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "ActivationRequestStatus" AS ENUM ('PENDING', 'HANDLED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "SaasProductStatus" ADD VALUE 'PREPRODUCTION';

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'TRIALING';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "showcaseGrandfathered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "includesShowcase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trialDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "ProductTrial" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "startedByUserId" UUID,
    "startedByOcall" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTrial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSetupFee" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "SetupFeeStatus" NOT NULL DEFAULT 'DUE',
    "invoiceId" UUID,
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSetupFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "quotedSetupFee" INTEGER NOT NULL,
    "quotedMonthly" INTEGER NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "status" "ActivationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "handledByUserId" UUID,
    "handledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductTrial_endsAt_idx" ON "ProductTrial"("endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTrial_organizationId_productId_key" ON "ProductTrial"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "ProductSetupFee_status_idx" ON "ProductSetupFee"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSetupFee_organizationId_productId_key" ON "ProductSetupFee"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "ActivationRequest_status_createdAt_idx" ON "ActivationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ActivationRequest_organizationId_productId_idx" ON "ActivationRequest"("organizationId", "productId");

-- AddForeignKey
ALTER TABLE "ProductTrial" ADD CONSTRAINT "ProductTrial_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTrial" ADD CONSTRAINT "ProductTrial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSetupFee" ADD CONSTRAINT "ProductSetupFee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSetupFee" ADD CONSTRAINT "ProductSetupFee_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Au plus une demande d'activation en attente par organisation et application.
CREATE UNIQUE INDEX "ActivationRequest_pending_unique" ON "ActivationRequest"("organizationId", "productId") WHERE "status" = 'PENDING';
