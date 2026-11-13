-- Ocall Stock V1 — sites et entreposage (S2) : magasins, dépôts, entrepôts, emplacements, niveaux de
-- stock, registre des mouvements (ajout seul, idempotent), transferts entre sites, inventaires.
-- Migration additive : aucune donnée existante n'est modifiée.

-- CreateEnum
CREATE TYPE "StockSiteKind" AS ENUM ('STORE', 'DEPOT', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "StockLocationKind" AS ENUM ('DEFAULT', 'ZONE', 'AISLE', 'SHELF', 'BIN');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('IN', 'OUT', 'ADJUSTMENT', 'MOVE_OUT', 'MOVE_IN', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT');

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('REQUESTED', 'PREPARED', 'SHIPPED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountScope" AS ENUM ('FULL', 'PARTIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockCounterKind" ADD VALUE 'TRANSFER';
ALTER TYPE "StockCounterKind" ADD VALUE 'COUNT';

-- AlterTable
ALTER TABLE "StockSettings" ADD COLUMN     "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "StockSite" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StockSiteKind" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMemberSite" (
    "organizationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMemberSite_pkey" PRIMARY KEY ("memberId","siteId")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "parentId" UUID,
    "kind" "StockLocationKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "organizationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "onHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("locationId","variantId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "quantityAfter" DECIMAL(14,3) NOT NULL,
    "unitCost" INTEGER,
    "reason" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "fromSiteId" UUID NOT NULL,
    "toSiteId" UUID NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "createdByUserId" UUID NOT NULL,
    "preparedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "fromLocationId" UUID,
    "shippedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "receivedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "lostQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "lossReason" TEXT,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "siteId" UUID NOT NULL,
    "scope" "StockCountScope" NOT NULL,
    "name" TEXT NOT NULL,
    "locationIds" UUID[],
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" UUID NOT NULL,
    "validatedByUserId" UUID,
    "validatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "countedQuantity" DECIMAL(14,3) NOT NULL,
    "expectedQuantity" DECIMAL(14,3),
    "differenceQuantity" DECIMAL(14,3),
    "countedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockSite_organizationId_id_key" ON "StockSite"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockSite_organizationId_code_key" ON "StockSite"("organizationId", "code");

-- CreateIndex
CREATE INDEX "StockMemberSite_organizationId_siteId_idx" ON "StockMemberSite"("organizationId", "siteId");

-- CreateIndex
CREATE INDEX "StockLocation_organizationId_siteId_parentId_idx" ON "StockLocation"("organizationId", "siteId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_organizationId_id_key" ON "StockLocation"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_organizationId_siteId_code_key" ON "StockLocation"("organizationId", "siteId", "code");

-- CreateIndex
CREATE INDEX "StockLevel_organizationId_siteId_variantId_idx" ON "StockLevel"("organizationId", "siteId", "variantId");

-- CreateIndex
CREATE INDEX "StockLevel_organizationId_variantId_idx" ON "StockLevel"("organizationId", "variantId");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_variantId_createdAt_idx" ON "StockMovement"("organizationId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_siteId_createdAt_idx" ON "StockMovement"("organizationId", "siteId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_sourceType_sourceId_idx" ON "StockMovement"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_organizationId_idempotencyKey_key" ON "StockMovement"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StockTransfer_organizationId_status_idx" ON "StockTransfer"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_organizationId_id_key" ON "StockTransfer"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_organizationId_number_key" ON "StockTransfer"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StockTransferLine_organizationId_variantId_idx" ON "StockTransferLine"("organizationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferLine_organizationId_id_key" ON "StockTransferLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferLine_transferId_variantId_key" ON "StockTransferLine"("transferId", "variantId");

-- CreateIndex
CREATE INDEX "StockCount_organizationId_status_idx" ON "StockCount"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_organizationId_id_key" ON "StockCount"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_organizationId_number_key" ON "StockCount"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_organizationId_id_key" ON "StockCountLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_locationId_variantId_key" ON "StockCountLine"("countId", "locationId", "variantId");

-- AddForeignKey
ALTER TABLE "StockMemberSite" ADD CONSTRAINT "StockMemberSite_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "StockMember"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMemberSite" ADD CONSTRAINT "StockMemberSite_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_organizationId_parentId_fkey" FOREIGN KEY ("organizationId", "parentId") REFERENCES "StockLocation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_organizationId_variantId_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "StockVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_organizationId_locationId_fkey" FOREIGN KEY ("organizationId", "locationId") REFERENCES "StockLocation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_variantId_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "StockVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_locationId_fkey" FOREIGN KEY ("organizationId", "locationId") REFERENCES "StockLocation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_organizationId_fromSiteId_fkey" FOREIGN KEY ("organizationId", "fromSiteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_organizationId_toSiteId_fkey" FOREIGN KEY ("organizationId", "toSiteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_organizationId_transferId_fkey" FOREIGN KEY ("organizationId", "transferId") REFERENCES "StockTransfer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_organizationId_countId_fkey" FOREIGN KEY ("organizationId", "countId") REFERENCES "StockCount"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Contrôles (écrits à la main) ───

ALTER TABLE "StockSite"
  ADD CONSTRAINT "StockSite_code_check" CHECK ("code" ~ '^[A-Z0-9]{2,8}$'),
  ADD CONSTRAINT "StockSite_name_check" CHECK (length(btrim("name")) BETWEEN 2 AND 120);

ALTER TABLE "StockLocation"
  ADD CONSTRAINT "StockLocation_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'),
  ADD CONSTRAINT "StockLocation_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  ADD CONSTRAINT "StockLocation_default_check" CHECK ("kind" <> 'DEFAULT' OR "parentId" IS NULL);

ALTER TABLE "StockLevel"
  ADD CONSTRAINT "StockLevel_reserved_check" CHECK ("reserved" >= 0);

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_quantity_check" CHECK ("quantity" <> 0),
  ADD CONSTRAINT "StockMovement_unitCost_check" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);

ALTER TABLE "StockTransfer"
  ADD CONSTRAINT "StockTransfer_sites_check" CHECK ("fromSiteId" <> "toSiteId");

ALTER TABLE "StockTransferLine"
  ADD CONSTRAINT "StockTransferLine_quantities_check" CHECK (
    "quantity" > 0
    AND "shippedQuantity" >= 0 AND "shippedQuantity" <= "quantity"
    AND "receivedQuantity" >= 0 AND "lostQuantity" >= 0
    AND "receivedQuantity" + "lostQuantity" <= "shippedQuantity"
  );

ALTER TABLE "StockCountLine"
  ADD CONSTRAINT "StockCountLine_counted_check" CHECK ("countedQuantity" >= 0);

-- Un seul emplacement par défaut (« Général ») par site.
CREATE UNIQUE INDEX "StockLocation_default_unique" ON "StockLocation" ("organizationId", "siteId") WHERE "kind" = 'DEFAULT';

-- ─── Emplacements : même site que le parent, niveaux dans l'ordre zone → allée → rayon → emplacement ───

CREATE FUNCTION "stock_location_tree"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rank_of CONSTANT TEXT[] := ARRAY['ZONE', 'AISLE', 'SHELF', 'BIN'];
  parent_site UUID;
  parent_kind TEXT;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "siteId", "kind"::TEXT INTO parent_site, parent_kind FROM "StockLocation" WHERE "id" = NEW."parentId";
  IF parent_site IS DISTINCT FROM NEW."siteId" THEN
    RAISE EXCEPTION 'STOCK_LOCATION_TREE: le parent est dans un autre site';
  END IF;
  IF parent_kind = 'DEFAULT' OR array_position(rank_of, parent_kind) >= array_position(rank_of, NEW."kind"::TEXT) THEN
    RAISE EXCEPTION 'STOCK_LOCATION_TREE: ordre zone, allée, rayonnage, emplacement';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StockLocation_tree"
  BEFORE INSERT OR UPDATE OF "parentId", "kind", "siteId" ON "StockLocation"
  FOR EACH ROW EXECUTE FUNCTION "stock_location_tree"();

-- ─── Niveaux et mouvements : l'emplacement appartient au site indiqué ───

CREATE FUNCTION "stock_location_in_site"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "StockLocation" l
    WHERE l."id" = NEW."locationId" AND l."siteId" = NEW."siteId" AND l."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'STOCK_LOCATION_SITE: emplacement hors du site';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StockLevel_location_site"
  BEFORE INSERT OR UPDATE OF "locationId", "siteId" ON "StockLevel"
  FOR EACH ROW EXECUTE FUNCTION "stock_location_in_site"();

CREATE TRIGGER "StockMovement_location_site"
  BEFORE INSERT ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "stock_location_in_site"();

-- ─── Registre des mouvements en ajout seul (suppression admise seulement pendant une purge) ───

CREATE TRIGGER "StockMovement_append_only"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();
