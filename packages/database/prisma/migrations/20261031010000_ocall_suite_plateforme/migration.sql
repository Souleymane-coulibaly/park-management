-- Sprint 11A — Ocall Suite : catalogue de produits SaaS, abonnements multi-produits avec tarif figé,
-- facturation manuelle, rôles internes, authentification à deux facteurs.
--
-- Changements NON purement additifs, validés par le commanditaire : aucune donnée n'est supprimée,
-- seules deux contraintes d'unicité sont assouplies.
--   * Abonnements : « un par organisation » devient « un par organisation ET par produit ». Les
--     abonnements existants sont rattachés à leur produit avant que la colonne devienne obligatoire.
--   * Offres : « une par métier » devient « une par produit et par nom » (le métier devient
--     facultatif), pour que de nouveaux produits (ex. Ocall School) puissent avoir leurs offres.

-- CreateEnum
CREATE TYPE "SaasProductStatus" AS ENUM ('AVAILABLE', 'UPCOMING', 'RETIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('SETUP', 'MONTHLY', 'ADJUSTMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlatformRole" ADD VALUE 'PLATFORM_OWNER';
ALTER TYPE "PlatformRole" ADD VALUE 'PLATFORM_ADMIN';
ALTER TYPE "PlatformRole" ADD VALUE 'BILLING_MANAGER';
ALTER TYPE "PlatformRole" ADD VALUE 'SUPPORT_AGENT';
ALTER TYPE "PlatformRole" ADD VALUE 'READ_ONLY_AUDITOR';

-- DropIndex
DROP INDEX "SubscriptionPlan_businessType_key";

-- DropIndex
DROP INDEX "Subscription_organizationId_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastStep" INTEGER,
ADD COLUMN     "mfaPendingSecret" TEXT,
ADD COLUMN     "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfaSecret" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "mfaVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "productId" UUID,
ALTER COLUMN "businessType" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "agreedAt" TIMESTAMP(3),
ADD COLUMN     "agreedMonthlyPrice" INTEGER,
ADD COLUMN     "agreedSetupFee" INTEGER,
ADD COLUMN     "productId" UUID;

-- AlterTable
ALTER TABLE "SubscriptionPayment" ADD COLUMN     "invoiceId" UUID;

-- CreateTable
CREATE TABLE "SaasProduct" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "SaasProductStatus" NOT NULL DEFAULT 'UPCOMING',
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "billing" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "total" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaasProduct_code_key" ON "SaasProduct"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_idempotencyKey_key" ON "Invoice"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_issuedAt_idx" ON "Invoice"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_status_dueAt_idx" ON "Invoice"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Invoice_productId_issuedAt_idx" ON "Invoice"("productId", "issuedAt");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_businessType_idx" ON "SubscriptionPlan"("businessType");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_productId_name_key" ON "SubscriptionPlan"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_productId_key" ON "Subscription"("organizationId", "productId");

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Catalogue initial (aucun tarif figé pour Ocall School, non commercialisable) ───
INSERT INTO "SaasProduct" ("id", "code", "name", "description", "status", "features", "billing", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'OCALL_PARK', 'Ocall Park', 'Parcs aquatiques et espaces de loisirs : billetterie, contrôle d''accès, clients, planning.', 'AVAILABLE', ARRAY['ticketing','gate-control','crm','hr-planning','site','analytics','copilot'], '{"currency":"XOF","period":"MONTHLY","manualPaymentsOnly":true}', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OCALL_RESTAURANT', 'Ocall Restaurant', 'Restaurants : caisse, commandes, cuisine, stocks, réservations, bornes.', 'AVAILABLE', ARRAY['pos','catalog','orders','kitchen','reservations','tables','stock','kiosks','crm','hr-planning','site','analytics','copilot'], '{"currency":"XOF","period":"MONTHLY","manualPaymentsOnly":true}', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OCALL_PARK_RESTAURANT', 'Ocall Park + Restaurant', 'Parc aquatique avec restauration : l''ensemble des modules Parc et Restaurant.', 'AVAILABLE', ARRAY['ticketing','gate-control','pos','catalog','orders','kitchen','reservations','tables','stock','kiosks','crm','hr-planning','site','analytics','copilot'], '{"currency":"XOF","period":"MONTHLY","manualPaymentsOnly":true}', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OCALL_SCHOOL', 'Ocall School', 'Écoles primaires et secondaires — produit à venir, non commercialisable.', 'UPCOMING', ARRAY[]::TEXT[], '{}', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ─── Rattachement des offres et abonnements existants à leur produit ───
UPDATE "SubscriptionPlan" p SET "productId" = s."id"
FROM "SaasProduct" s
WHERE p."productId" IS NULL
  AND s."code" = CASE p."businessType"
    WHEN 'PARK' THEN 'OCALL_PARK'
    WHEN 'RESTAURANT' THEN 'OCALL_RESTAURANT'
    WHEN 'PARK_RESTAURANT' THEN 'OCALL_PARK_RESTAURANT'
  END;

UPDATE "Subscription" sub SET "productId" = p."productId"
FROM "SubscriptionPlan" p
WHERE sub."planId" = p."id" AND sub."productId" IS NULL;

ALTER TABLE "Subscription" ALTER COLUMN "productId" SET NOT NULL;

-- ─── Contrôles d'intégrité (ajoutés à la main) ───
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_total_check" CHECK ("total" > 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_agreed_check" CHECK (("agreedSetupFee" IS NULL OR "agreedSetupFee" >= 0) AND ("agreedMonthlyPrice" IS NULL OR "agreedMonthlyPrice" >= 0));
