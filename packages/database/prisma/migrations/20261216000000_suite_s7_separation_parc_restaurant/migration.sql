-- Ocall Suite sprint 7 : séparation commerciale Ocall Parc / Ocall Restaurant. Migration ADDITIVE : aucun
-- abonnement, aucune offre existante, aucune facture, aucun paiement, aucune commission n'est modifié.

-- CreateEnum
CREATE TYPE "ParkCombinedContractStatus" AS ENUM ('ACTIVE', 'SWITCHED');

-- AlterTable
ALTER TABLE "Attribution" ADD COLUMN     "derivedFromId" UUID;

-- CreateTable
CREATE TABLE "ParkCombinedContract" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "status" "ParkCombinedContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "switchedAt" TIMESTAMP(3),
    "switchedById" UUID,
    "switchReason" TEXT,
    "parkSubscriptionId" UUID,
    "restaurantSubscriptionId" UUID,
    "split" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkCombinedContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParkCombinedContract_subscriptionId_key" ON "ParkCombinedContract"("subscriptionId");

-- CreateIndex
CREATE INDEX "ParkCombinedContract_organizationId_status_idx" ON "ParkCombinedContract"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "ParkCombinedContract" ADD CONSTRAINT "ParkCombinedContract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkCombinedContract" ADD CONSTRAINT "ParkCombinedContract_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "ParkCombinedContract" ADD CONSTRAINT "ParkCombinedContract_switch_check" CHECK (
  ("status" = 'ACTIVE' AND "switchedAt" IS NULL) OR ("status" = 'SWITCHED' AND "switchedAt" IS NOT NULL)
);

-- Contrats historiques (décision D1) : chaque abonnement existant de la famille Ocall Park (Parc,
-- Restaurant, Parc + Restaurant) garde ses droits sur les activités parc ET restaurant, comme avant la
-- séparation, jusqu'à une bascule explicite. Simple inscription : l'abonnement n'est pas modifié.
INSERT INTO "ParkCombinedContract" ("id", "organizationId", "subscriptionId", "origin", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."organizationId", s."id", 'MIGRATION', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Subscription" s
JOIN "SaasProduct" p ON p."id" = s."productId"
WHERE p."code" IN ('OCALL_PARK', 'OCALL_RESTAURANT', 'OCALL_PARK_RESTAURANT')
ON CONFLICT ("subscriptionId") DO NOTHING;

-- Offres forfaitaires Ocall Restaurant (décision D8), INACTIVES comme les offres par site de l'étape 6 :
-- même grille que les offres forfaitaires Ocall Park ; Ocall les active au lancement.
INSERT INTO "SubscriptionPlan"
  ("id", "businessType", "productId", "name", "monthlyPrice", "setupFee", "currency",
   "aiMonthlyCallQuota", "storageQuotaMb", "activationMode", "includesShowcase", "trialDays",
   "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), NULL, p."id", p."name" || ' — ' || o."label", o."price", 200000, 'XOF',
       150, 1024, 'ADMIN_APPROVAL', o."showcase", 14, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SaasProduct" p
CROSS JOIN (VALUES ('Sans vitrine', 50000, false), ('Avec vitrine', 65000, true))
  AS o("label", "price", "showcase")
WHERE p."code" = 'OCALL_RESTAURANT'
ON CONFLICT ("productId", "name") DO NOTHING;
