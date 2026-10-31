-- CreateEnum
CREATE TYPE "ActivationMode" AS ENUM ('AUTO', 'ADMIN_APPROVAL');

-- CreateEnum
CREATE TYPE "PaymentActivationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REFUSED');

-- CreateEnum
CREATE TYPE "CashRemittanceStatus" AS ENUM ('DECLARED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OnlinePaymentProvider" AS ENUM ('SIMULATED', 'CINETPAY');

-- CreateEnum
CREATE TYPE "OnlinePaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REVIEW_REQUIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DemoRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'WON', 'LOST', 'SPAM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING_ACTIVATION';

-- AlterEnum : moyens de règlement (BANK_TRANSFER renommé, sans perte).
ALTER TYPE "SubscriptionPaymentMethod" RENAME VALUE 'BANK_TRANSFER' TO 'MANUAL_TRANSFER';
ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE 'CINETPAY_CARD';
ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE 'CINETPAY_MOBILE_MONEY';

-- AlterEnum : cycle des règlements (PENDING et VALIDATED renommés, sans perte).
ALTER TYPE "SubscriptionPaymentStatus" RENAME VALUE 'PENDING' TO 'PENDING_VERIFICATION';
ALTER TYPE "SubscriptionPaymentStatus" RENAME VALUE 'VALIDATED' TO 'CONFIRMED';
ALTER TYPE "SubscriptionPaymentStatus" ADD VALUE 'DECLARED' BEFORE 'PENDING_VERIFICATION';
ALTER TYPE "SubscriptionPaymentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "SubscriptionPaymentStatus" ADD VALUE 'REFUNDED';
ALTER TABLE "SubscriptionPayment" ALTER COLUMN "status" SET DEFAULT 'PENDING_VERIFICATION';

-- AlterEnum : statuts commerciaux du catalogue (renommage sans perte, aucune suppression de type).
-- Les nouvelles valeurs ne sont pas utilisées dans cette migration (ADD VALUE en transaction).
ALTER TYPE "SaasProductStatus" RENAME VALUE 'AVAILABLE' TO 'ACTIVE';
ALTER TYPE "SaasProductStatus" RENAME VALUE 'UPCOMING' TO 'COMING_SOON';
ALTER TYPE "SaasProductStatus" ADD VALUE 'PLANNED' BEFORE 'COMING_SOON';
ALTER TYPE "SaasProductStatus" ADD VALUE 'PILOT' BEFORE 'ACTIVE';
ALTER TYPE "SaasProductStatus" ADD VALUE 'SUSPENDED' BEFORE 'RETIRED';
ALTER TABLE "SaasProduct" ALTER COLUMN "status" SET DEFAULT 'COMING_SOON';

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "activationMode" "ActivationMode" NOT NULL DEFAULT 'ADMIN_APPROVAL';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "activationMode" "ActivationMode" NOT NULL DEFAULT 'ADMIN_APPROVAL';

-- AlterTable
ALTER TABLE "SubscriptionPayment" ADD COLUMN     "activationDecidedAt" TIMESTAMP(3),
ADD COLUMN     "activationDecidedById" UUID,
ADD COLUMN     "activationDecisionReason" TEXT,
ADD COLUMN     "activationStatus" "PaymentActivationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" UUID,
ADD COLUMN     "collectedById" UUID,
ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "receiptReference" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedById" UUID,
ADD COLUMN     "remittanceId" UUID,
ALTER COLUMN "status" SET DEFAULT 'PENDING_VERIFICATION';

-- AlterTable
ALTER TABLE "SaasProduct" ADD COLUMN     "appUrl" TEXT,
ADD COLUMN     "availableAt" DATE,
ADD COLUMN     "listed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "tagline" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "status" SET DEFAULT 'COMING_SOON';

-- CreateTable
CREATE TABLE "SubscriptionPriceHistory" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "setupFee" INTEGER NOT NULL,
    "monthlyPrice" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRemittance" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "collectorId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "remittedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "status" "CashRemittanceStatus" NOT NULL DEFAULT 'DECLARED',
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlinePayment" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" "OnlinePaymentProvider" NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "channels" TEXT NOT NULL,
    "status" "OnlinePaymentStatus" NOT NULL DEFAULT 'CREATED',
    "providerTransactionId" TEXT,
    "paymentMethod" TEXT,
    "paymentUrl" TEXT,
    "initiatedById" UUID NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "subscriptionPaymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlinePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlinePaymentEvent" (
    "id" UUID NOT NULL,
    "onlinePaymentId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "OnlinePaymentStatus",
    "toStatus" "OnlinePaymentStatus",
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnlinePaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoRequest" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productId" UUID,
    "message" TEXT NOT NULL,
    "status" "DemoRequestStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" UUID,
    "notes" TEXT,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionPriceHistory_subscriptionId_effectiveFrom_idx" ON "SubscriptionPriceHistory"("subscriptionId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CashRemittance_number_key" ON "CashRemittance"("number");

-- CreateIndex
CREATE INDEX "CashRemittance_collectorId_remittedAt_idx" ON "CashRemittance"("collectorId", "remittedAt");

-- CreateIndex
CREATE INDEX "CashRemittance_status_idx" ON "CashRemittance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePayment_reference_key" ON "OnlinePayment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePayment_subscriptionPaymentId_key" ON "OnlinePayment"("subscriptionPaymentId");

-- CreateIndex
CREATE INDEX "OnlinePayment_invoiceId_status_idx" ON "OnlinePayment"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "OnlinePayment_organizationId_createdAt_idx" ON "OnlinePayment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OnlinePayment_status_createdAt_idx" ON "OnlinePayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OnlinePaymentEvent_onlinePaymentId_createdAt_idx" ON "OnlinePaymentEvent"("onlinePaymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DemoRequest_number_key" ON "DemoRequest"("number");

-- CreateIndex
CREATE INDEX "DemoRequest_status_createdAt_idx" ON "DemoRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DemoRequest_retentionUntil_idx" ON "DemoRequest"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_receiptNumber_key" ON "SubscriptionPayment"("receiptNumber");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_activationStatus_idx" ON "SubscriptionPayment"("activationStatus");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_collectedById_paidAt_idx" ON "SubscriptionPayment"("collectedById", "paidAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_remittanceId_idx" ON "SubscriptionPayment"("remittanceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_organizationId_receiptReference_key" ON "SubscriptionPayment"("organizationId", "receiptReference");

-- Identifiants publics des produits existants, puis obligatoires.
UPDATE "SaasProduct" SET "slug" = lower(replace("code", '_', '-')) WHERE "slug" IS NULL;
UPDATE "SaasProduct" SET "listed" = false WHERE "code" = 'OCALL_PARK_RESTAURANT';
ALTER TABLE "SaasProduct" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SaasProduct_slug_key" ON "SaasProduct"("slug");

-- AddForeignKey
ALTER TABLE "SubscriptionPriceHistory" ADD CONSTRAINT "SubscriptionPriceHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPriceHistory" ADD CONSTRAINT "SubscriptionPriceHistory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRemittance" ADD CONSTRAINT "CashRemittance_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRemittance" ADD CONSTRAINT "CashRemittance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRemittance" ADD CONSTRAINT "CashRemittance_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_refundedById_fkey" FOREIGN KEY ("refundedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_activationDecidedById_fkey" FOREIGN KEY ("activationDecidedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_remittanceId_fkey" FOREIGN KEY ("remittanceId") REFERENCES "CashRemittance"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_subscriptionPaymentId_fkey" FOREIGN KEY ("subscriptionPaymentId") REFERENCES "SubscriptionPayment"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePaymentEvent" ADD CONSTRAINT "OnlinePaymentEvent_onlinePaymentId_fkey" FOREIGN KEY ("onlinePaymentId") REFERENCES "OnlinePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Contraintes de cohérence ───
ALTER TABLE "SaasProduct" ADD CONSTRAINT "SaasProduct_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "SubscriptionPriceHistory" ADD CONSTRAINT "SubscriptionPriceHistory_amounts_check"
  CHECK ("setupFee" >= 0 AND "monthlyPrice" >= 0 AND ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"));
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "CashRemittance" ADD CONSTRAINT "CashRemittance_amount_check" CHECK ("amount" > 0);

-- ─── Accroches des produits existants et produits futurs (aucun tarif, non souscriptibles) ───
UPDATE "SaasProduct" SET "tagline" = 'Billetterie, contrôle d''accès et gestion des parcs aquatiques' WHERE "code" = 'OCALL_PARK' AND "tagline" = '';
UPDATE "SaasProduct" SET "tagline" = 'Caisse, commandes, cuisine et stocks des restaurants' WHERE "code" = 'OCALL_RESTAURANT' AND "tagline" = '';
UPDATE "SaasProduct" SET "tagline" = 'Parc aquatique et restauration réunis' WHERE "code" = 'OCALL_PARK_RESTAURANT' AND "tagline" = '';
UPDATE "SaasProduct" SET "tagline" = 'Gestion des écoles primaires et secondaires' WHERE "code" = 'OCALL_SCHOOL' AND "tagline" = '';

INSERT INTO "SaasProduct" ("id", "code", "slug", "name", "tagline", "description", "status", "features", "billing", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'OCALL_CLINIC', 'ocall-clinic', 'Ocall Clinic', 'Gestion des cliniques et cabinets médicaux', 'Cliniques et cabinets médicaux — projet futur, non commercialisable.', 'COMING_SOON', ARRAY[]::TEXT[], '{}', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OCALL_RH', 'ocall-rh', 'Ocall RH', 'Gestion des ressources humaines', 'Ressources humaines — projet futur, non commercialisable.', 'COMING_SOON', ARRAY[]::TEXT[], '{}', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OCALL_SOLAR', 'ocall-solar', 'Ocall Solar', 'Gestion des entreprises solaires', 'Entreprises solaires — projet futur, non commercialisable.', 'COMING_SOON', ARRAY[]::TEXT[], '{}', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OCALL_DOCS', 'ocall-docs', 'Ocall Docs', 'Gestion électronique des documents', 'Gestion électronique des documents — projet futur, non commercialisable.', 'COMING_SOON', ARRAY[]::TEXT[], '{}', 8, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ─── Mode d'activation figé des abonnements existants : celui de leur offre ───
UPDATE "Subscription" s SET "activationMode" = p."activationMode"
FROM "SubscriptionPlan" p
WHERE p."id" = s."planId";

-- ─── Historique des tarifs : tarif accepté courant de chaque abonnement existant ───
INSERT INTO "SubscriptionPriceHistory" ("id", "subscriptionId", "planId", "setupFee", "monthlyPrice", "currency", "effectiveFrom", "reason")
SELECT gen_random_uuid(), s."id", s."planId", COALESCE(s."agreedSetupFee", 0), s."agreedMonthlyPrice", p."currency",
       COALESCE(s."agreedAt", s."createdAt"), 'Reprise du tarif accepté (Sprint 12A)'
FROM "Subscription" s
JOIN "SubscriptionPlan" p ON p."id" = s."planId"
WHERE s."agreedMonthlyPrice" IS NOT NULL;
