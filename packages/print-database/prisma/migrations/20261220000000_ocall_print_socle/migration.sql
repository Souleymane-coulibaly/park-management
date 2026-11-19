-- Ocall Print — socle (lots PR-1 et PR-2) : modèles de carte recto verso et leurs versions, fiches de
-- l'accès autonome, cartes et QR, commandes, lignes figées, journal, compteur des numéros.
-- Base distincte des bases Ocall Suite, School, Facture et Stock. Migration additive (base neuve).


-- CreateEnum
CREATE TYPE "PrintCardKind" AS ENUM ('STUDENT', 'STAFF');

-- CreateEnum
CREATE TYPE "PrintCardStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "PrintOrderStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PrintItemStatus" AS ENUM ('PENDING', 'PRINTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrintPaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- CreateTable
CREATE TABLE "PrintTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceApp" TEXT NOT NULL,
    "scopeId" UUID,
    "name" TEXT NOT NULL,
    "kind" "PrintCardKind" NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintTemplateVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "logoKey" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintPerson" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "PrintCardKind" NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastNameAr" TEXT,
    "firstNameAr" TEXT,
    "reference" TEXT,
    "groupLabel" TEXT,
    "jobTitle" TEXT,
    "birthDate" DATE,
    "photoKey" TEXT,
    "photoSha" CHAR(64),
    "archivedAt" TIMESTAMP(3),
    "transferredApp" TEXT,
    "transferredId" UUID,
    "transferredAt" TIMESTAMP(3),
    "searchText" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintCard" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceApp" TEXT NOT NULL,
    "scopeId" UUID,
    "holderKind" "PrintCardKind" NOT NULL,
    "holderId" UUID NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "status" "PrintCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "validUntil" DATE,
    "replacesCardId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "sourceApp" TEXT NOT NULL,
    "scopeId" UUID,
    "establishmentId" UUID,
    "kind" "PrintCardKind" NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "status" "PrintOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "unitPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "quantity" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "submittedByUserId" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "productionAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "paymentStatus" "PrintPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paidAmount" INTEGER,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "paymentRecordedByUserId" UUID,
    "filesPurgedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintOrderItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "holderKind" "PrintCardKind" NOT NULL,
    "holderLabel" TEXT,
    "data" JSONB NOT NULL,
    "photoKey" TEXT,
    "status" "PrintItemStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintOrderEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintCounter" (
    "organizationId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrintCounter_pkey" PRIMARY KEY ("organizationId","year")
);

-- CreateIndex
CREATE INDEX "PrintTemplate_organizationId_sourceApp_scopeId_idx" ON "PrintTemplate"("organizationId", "sourceApp", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintTemplate_organizationId_id_key" ON "PrintTemplate"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrintTemplateVersion_organizationId_id_key" ON "PrintTemplateVersion"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrintTemplateVersion_templateId_version_key" ON "PrintTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "PrintPerson_organizationId_kind_archivedAt_idx" ON "PrintPerson"("organizationId", "kind", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintPerson_organizationId_id_key" ON "PrintPerson"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrintCard_cardNumber_key" ON "PrintCard"("cardNumber");

-- CreateIndex
CREATE INDEX "PrintCard_organizationId_sourceApp_holderKind_holderId_idx" ON "PrintCard"("organizationId", "sourceApp", "holderKind", "holderId");

-- CreateIndex
CREATE INDEX "PrintCard_organizationId_sourceApp_scopeId_status_idx" ON "PrintCard"("organizationId", "sourceApp", "scopeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PrintCard_organizationId_id_key" ON "PrintCard"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PrintOrder_status_submittedAt_idx" ON "PrintOrder"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "PrintOrder_organizationId_sourceApp_scopeId_submittedAt_idx" ON "PrintOrder"("organizationId", "sourceApp", "scopeId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintOrder_organizationId_id_key" ON "PrintOrder"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrintOrder_organizationId_number_key" ON "PrintOrder"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PrintOrder_organizationId_idempotencyKey_key" ON "PrintOrder"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PrintOrderItem_organizationId_orderId_idx" ON "PrintOrderItem"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "PrintOrderItem_organizationId_cardId_idx" ON "PrintOrderItem"("organizationId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintOrderItem_organizationId_id_key" ON "PrintOrderItem"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PrintOrderEvent_organizationId_orderId_createdAt_idx" ON "PrintOrderEvent"("organizationId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "PrintTemplateVersion" ADD CONSTRAINT "PrintTemplateVersion_organizationId_templateId_fkey" FOREIGN KEY ("organizationId", "templateId") REFERENCES "PrintTemplate"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintOrder" ADD CONSTRAINT "PrintOrder_organizationId_templateVersionId_fkey" FOREIGN KEY ("organizationId", "templateVersionId") REFERENCES "PrintTemplateVersion"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintOrderItem" ADD CONSTRAINT "PrintOrderItem_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "PrintOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintOrderItem" ADD CONSTRAINT "PrintOrderItem_organizationId_cardId_fkey" FOREIGN KEY ("organizationId", "cardId") REFERENCES "PrintCard"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintOrderEvent" ADD CONSTRAINT "PrintOrderEvent_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "PrintOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Contrôles écrits à la main ───

-- Une seule carte ACTIVE par titulaire d'une application : un remplacement révoque d'abord l'ancienne.
CREATE UNIQUE INDEX "PrintCard_one_active_per_holder"
  ON "PrintCard" ("organizationId", "sourceApp", "holderKind", "holderId")
  WHERE "status" = 'ACTIVE';

-- Une carte n'est imprimée qu'une fois : une ligne en attente ou imprimée la bloque ; une ligne refusée
-- ou annulée la libère (nouvelle commande possible). Une réimpression passe par un remplacement.
CREATE UNIQUE INDEX "PrintOrderItem_one_live_per_card"
  ON "PrintOrderItem" ("cardId")
  WHERE "status" IN ('PENDING', 'PRINTED');

-- Matricule ou numéro de personnel unique par organisation et par nature, quand il est saisi et que la
-- fiche n'est ni archivée ni reprise par une autre application.
CREATE UNIQUE INDEX "PrintPerson_reference_unique"
  ON "PrintPerson" ("organizationId", "kind", "reference")
  WHERE "reference" IS NOT NULL AND "archivedAt" IS NULL AND "transferredAt" IS NULL;

-- Une fiche autonome n'est reprise qu'une fois, vers une seule fiche de l'application cible.
CREATE UNIQUE INDEX "PrintPerson_transfer_unique"
  ON "PrintPerson" ("organizationId", "transferredApp", "transferredId")
  WHERE "transferredId" IS NOT NULL;

ALTER TABLE "PrintOrder"
  ADD CONSTRAINT "PrintOrder_amounts_check"
  CHECK ("unitPrice" >= 0 AND "quantity" >= 0 AND "totalAmount" = "unitPrice" * "quantity"
         AND ("paidAmount" IS NULL OR "paidAmount" >= 0));

ALTER TABLE "PrintOrder"
  ADD CONSTRAINT "PrintOrder_payment_check"
  CHECK (("paymentStatus" = 'UNPAID' AND "paidAt" IS NULL)
      OR ("paymentStatus" = 'PAID' AND "paidAt" IS NOT NULL AND "paidAmount" IS NOT NULL));

ALTER TABLE "PrintTemplate"
  ADD CONSTRAINT "PrintTemplate_version_check" CHECK ("currentVersion" >= 1);

-- ─── Journal en ajout seul (suppression admise seulement pendant une purge d'organisation) ───

CREATE FUNCTION "print_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ocall.print_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PRINT_HISTORY_APPEND_ONLY: % est un historique en ajout seul', TG_TABLE_NAME;
END $$;

CREATE TRIGGER "PrintOrderEvent_append_only"
  BEFORE UPDATE OR DELETE ON "PrintOrderEvent"
  FOR EACH ROW EXECUTE FUNCTION "print_append_only"();
