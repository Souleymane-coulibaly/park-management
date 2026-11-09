-- Sprint S3 : Ocall Partner (candidatures publiques, invitations, apporteurs et revendeurs, CRM, attribution
-- par application, date de règlement des commissions, demandes de règlement). Migration additive : les
-- partenaires existants deviennent des apporteurs, les attributions existantes restent valables pour toutes
-- les applications (productId nul), aucune commission existante n'est modifiée hormis sa date de règlement.
-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('REFERRER', 'RESELLER');

-- CreateEnum
CREATE TYPE "PartnerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProspectEventType" AS ENUM ('CREATED', 'STAGE_CHANGED', 'UPDATED', 'DEMO_REQUESTED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "PartnerPayoutRequestStatus" AS ENUM ('PENDING', 'PROCESSED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PartnerStatus" ADD VALUE 'TERMINATED';

-- AlterEnum
ALTER TYPE "ProspectStatus" ADD VALUE 'PROPOSAL';

-- AlterTable
ALTER TABLE "ActivationRequest" ADD COLUMN     "partnerId" UUID;

-- AlterTable
ALTER TABLE "Attribution" ADD COLUMN     "productId" UUID;

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "payableFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CommissionRule" ADD COLUMN     "partnerType" "PartnerType",
ALTER COLUMN "monthlyWindowMonths" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "applicationId" UUID,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "terminatedAt" TIMESTAMP(3),
ADD COLUMN     "terminationReason" TEXT,
ADD COLUMN     "type" "PartnerType" NOT NULL DEFAULT 'REFERRER';

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "nextFollowUpAt" TIMESTAMP(3),
ADD COLUMN     "sector" TEXT;

-- CreateTable
CREATE TABLE "PartnerApplication" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "targetSectors" TEXT NOT NULL,
    "motivation" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "status" "PartnerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerInvitation" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectEvent" (
    "id" UUID NOT NULL,
    "prospectId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "type" "ProspectEventType" NOT NULL,
    "fromStatus" "ProspectStatus",
    "toStatus" "ProspectStatus",
    "note" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPayoutRequest" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "note" TEXT,
    "status" "PartnerPayoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "payoutId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_number_key" ON "PartnerApplication"("number");

-- CreateIndex
CREATE INDEX "PartnerApplication_status_createdAt_idx" ON "PartnerApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerApplication_emailNormalized_idx" ON "PartnerApplication"("emailNormalized");

-- CreateIndex
CREATE INDEX "PartnerApplication_retentionUntil_idx" ON "PartnerApplication"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerInvitation_tokenHash_key" ON "PartnerInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "PartnerInvitation_applicationId_createdAt_idx" ON "PartnerInvitation"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectEvent_prospectId_createdAt_idx" ON "ProspectEvent"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerPayoutRequest_status_createdAt_idx" ON "PartnerPayoutRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerPayoutRequest_partnerId_createdAt_idx" ON "PartnerPayoutRequest"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "Attribution_organizationId_productId_status_idx" ON "Attribution"("organizationId", "productId", "status");

-- CreateIndex
CREATE INDEX "Commission_partnerId_status_payableFrom_idx" ON "Commission"("partnerId", "status", "payableFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_applicationId_key" ON "Partner"("applicationId");

-- CreateIndex
CREATE INDEX "Prospect_partnerId_status_nextFollowUpAt_idx" ON "Prospect"("partnerId", "status", "nextFollowUpAt");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerInvitation" ADD CONSTRAINT "PartnerInvitation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPayoutRequest" ADD CONSTRAINT "PartnerPayoutRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPayoutRequest" ADD CONSTRAINT "PartnerPayoutRequest_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "CommissionPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Au plus une attribution confirmée par organisation et application (nul = toutes les applications,
-- attributions antérieures). Le croisement « toutes applications » / application précise est contrôlé
-- par le service sous verrou de l'organisation.
CREATE UNIQUE INDEX "Attribution_confirmed_org_product_unique" ON "Attribution"("organizationId", COALESCE("productId", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "status" = 'CONFIRMED';

-- Une seule candidature en attente par adresse e-mail (une nouvelle candidature est ignorée en silence).
CREATE UNIQUE INDEX "PartnerApplication_pending_email_unique" ON "PartnerApplication"("emailNormalized") WHERE "status" = 'PENDING';

-- Une seule demande de règlement en attente par partenaire ; montant strictement positif.
CREATE UNIQUE INDEX "PartnerPayoutRequest_pending_unique" ON "PartnerPayoutRequest"("partnerId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "PartnerPayoutRequest_payout_unique" ON "PartnerPayoutRequest"("payoutId") WHERE "payoutId" IS NOT NULL;
ALTER TABLE "PartnerPayoutRequest" ADD CONSTRAINT "PartnerPayoutRequest_amount_check" CHECK ("amount" > 0);

-- Date de règlement des commissions existantes : fin du mois suivant l'encaissement (sinon la création).
-- Régularisations (dettes du partenaire) et commissions déjà engagées dans un versement (règles du
-- Sprint 12B) : imputables dès leur création.
UPDATE "Commission"
SET "payableFrom" = "createdAt"
WHERE ("kind" = 'ADJUSTMENT' OR "payoutId" IS NOT NULL) AND "payableFrom" IS NULL;
UPDATE "Commission" c
SET "payableFrom" = date_trunc('month', p."paidAt") + interval '2 month' - interval '1 day'
FROM "SubscriptionPayment" p
WHERE c."subscriptionPaymentId" = p."id" AND c."payableFrom" IS NULL;
UPDATE "Commission"
SET "payableFrom" = date_trunc('month', "createdAt") + interval '2 month' - interval '1 day'
WHERE "payableFrom" IS NULL;

-- Fin d'attribution par Ocall (arbitrage), historique conservé.
-- AlterEnum
ALTER TYPE "AttributionStatus" ADD VALUE 'ENDED';

-- AlterTable
ALTER TABLE "Attribution" ADD COLUMN     "endReason" TEXT,
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endedById" UUID;

