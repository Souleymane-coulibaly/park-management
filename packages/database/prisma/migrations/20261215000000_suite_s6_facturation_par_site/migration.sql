-- Ocall Suite étape 6 : facturation par site activé. Migration ADDITIVE : aucune offre, aucun abonnement,
-- aucune facture, aucun paiement, aucun prix convenu existant n'est modifié. Les offres historiques restent
-- FLAT (valeur par défaut) ; les offres « par site » sont créées INACTIVES (activation par Ocall).

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('FLAT', 'PER_SITE');

-- AlterEnum


ALTER TYPE "InvoiceLineKind" ADD VALUE 'EXTRA_SITES';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'SHOWCASE';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'SITE_PRORATA';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sitesSnapshot" JSONB;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "agreedExtraSitePrice" INTEGER,
ADD COLUMN     "agreedShowcasePrice" INTEGER,
ADD COLUMN     "billedSiteCount" INTEGER;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "extraAppSetupFee" INTEGER,
ADD COLUMN     "extraSiteMonthlyPrice" INTEGER,
ADD COLUMN     "pricingMode" "PricingMode" NOT NULL DEFAULT 'FLAT',
ADD COLUMN     "showcaseMonthlyPrice" INTEGER;

-- AlterTable
ALTER TABLE "SubscriptionPriceHistory" ADD COLUMN     "extraSitePrice" INTEGER,
ADD COLUMN     "showcasePrice" INTEGER;

-- CreateTable
CREATE TABLE "SiteActivation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productCode" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "establishmentId" UUID,
    "label" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteActivation_organizationId_productCode_endedAt_idx" ON "SiteActivation"("organizationId", "productCode", "endedAt");

-- AddForeignKey
ALTER TABLE "SiteActivation" ADD CONSTRAINT "SiteActivation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Au plus une activation ouverte par (organisation, application, unité) : un site n'est jamais compté deux
-- fois pour la même application ; un rattachement à un autre établissement garde la même activation.
CREATE UNIQUE INDEX "SiteActivation_open_unit" ON "SiteActivation"("organizationId", "productCode", "unitKey") WHERE "endedAt" IS NULL;

-- Cohérence des tarifs : montants positifs ; une offre PER_SITE a toujours un prix de site supplémentaire.
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_per_site_prices_check" CHECK (
  ("extraSiteMonthlyPrice" IS NULL OR "extraSiteMonthlyPrice" >= 0)
  AND ("showcaseMonthlyPrice" IS NULL OR "showcaseMonthlyPrice" >= 0)
  AND ("extraAppSetupFee" IS NULL OR "extraAppSetupFee" >= 0)
  AND ("pricingMode" = 'FLAT' OR "extraSiteMonthlyPrice" IS NOT NULL)
);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_per_site_prices_check" CHECK (
  ("agreedExtraSitePrice" IS NULL OR "agreedExtraSitePrice" >= 0)
  AND ("agreedShowcasePrice" IS NULL OR "agreedShowcasePrice" >= 0)
  AND ("billedSiteCount" IS NULL OR "billedSiteCount" >= 1)
);
ALTER TABLE "SiteActivation" ADD CONSTRAINT "SiteActivation_period_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");

-- Grille par site (décisions de l'étape 6) : premier site 17 500 FCFA/mois, site supplémentaire 7 500,
-- vitrine +5 000 par application, mise en service 150 000 (première application) puis 112 500.
-- Parc et Restaurant ont chacun leur offre (séparation préparée, non activée) ; Facture compte toujours
-- un site. Aucune offre pour le produit combiné historique « Parc + Restaurant ».
INSERT INTO "SubscriptionPlan"
  ("id", "businessType", "productId", "name", "monthlyPrice", "setupFee", "currency",
   "aiMonthlyCallQuota", "storageQuotaMb", "activationMode", "includesShowcase", "trialDays",
   "pricingMode", "extraSiteMonthlyPrice", "showcaseMonthlyPrice", "extraAppSetupFee",
   "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), NULL, p."id", p."name" || ' — ' || o."label", 17500, 150000, 'XOF',
       150, 1024, 'ADMIN_APPROVAL', o."showcase", 14,
       'PER_SITE', 7500, o."showcasePrice", 112500,
       false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SaasProduct" p
CROSS JOIN (VALUES ('Par site', false, NULL::INTEGER), ('Par site avec vitrine', true, 5000))
  AS o("label", "showcase", "showcasePrice")
WHERE p."code" IN ('OCALL_PARK', 'OCALL_RESTAURANT', 'OCALL_SCHOOL', 'OCALL_FACTURE', 'OCALL_STOCK')
ON CONFLICT ("productId", "name") DO NOTHING;
