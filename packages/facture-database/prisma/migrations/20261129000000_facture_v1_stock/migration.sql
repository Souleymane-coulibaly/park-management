-- Ocall Facture V1 — S5 Stock : interconnexion avec Ocall Stock. Migration additive : colonnes
-- facultatives (articles miroirs, facture d'une vente en caisse, avoir avec retour de marchandise) et file de
-- sortie vers Stock. Aucune donnée existante n'est modifiée.

-- CreateEnum
CREATE TYPE "FactureStockSource" AS ENUM ('INVOICE', 'INTERVENTION', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "FactureStockSyncStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "FactureDocument" ADD COLUMN     "stockReturnGoods" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stockCovered" JSONB,
ADD COLUMN     "stockSaleId" UUID,
ADD COLUMN     "stockSaleNumber" TEXT;

-- AlterTable
ALTER TABLE "FactureItem" ADD COLUMN     "stockLinkedAt" TIMESTAMP(3),
ADD COLUMN     "stockProductId" UUID,
ADD COLUMN     "stockVariantId" UUID;

-- CreateTable
CREATE TABLE "FactureStockOutbox" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "source" "FactureStockSource" NOT NULL,
    "documentId" UUID,
    "interventionId" UUID,
    "reference" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "covered" JSONB NOT NULL DEFAULT '[]',
    "status" "FactureStockSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "doneAt" TIMESTAMP(3),
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureStockOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureStockOutbox_status_nextAttemptAt_idx" ON "FactureStockOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "FactureStockOutbox_organizationId_status_createdAt_idx" ON "FactureStockOutbox"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FactureStockOutbox_organizationId_documentId_idx" ON "FactureStockOutbox"("organizationId", "documentId");

-- CreateIndex
CREATE INDEX "FactureStockOutbox_organizationId_interventionId_idx" ON "FactureStockOutbox"("organizationId", "interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureStockOutbox_organizationId_id_key" ON "FactureStockOutbox"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureStockOutbox_organizationId_key_key" ON "FactureStockOutbox"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FactureDocument_organizationId_stockSaleId_key" ON "FactureDocument"("organizationId", "stockSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureItem_organizationId_stockVariantId_key" ON "FactureItem"("organizationId", "stockVariantId");

-- AddForeignKey
ALTER TABLE "FactureStockOutbox" ADD CONSTRAINT "FactureStockOutbox_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "FactureDocument"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureStockOutbox" ADD CONSTRAINT "FactureStockOutbox_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "FactureIntervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Garanties écrites à la main ───

-- Article miroir : les trois colonnes du lien vont ensemble.
ALTER TABLE "FactureItem"
  ADD CONSTRAINT "FactureItem_stock_link_check" CHECK (
    ("stockVariantId" IS NULL) = ("stockProductId" IS NULL)
    AND ("stockVariantId" IS NULL) = ("stockLinkedAt" IS NULL)
  );

-- Vente en caisse : facture seulement, numéro avec l'identifiant ; retour de marchandise : avoir seulement.
ALTER TABLE "FactureDocument"
  ADD CONSTRAINT "FactureDocument_stock_sale_check" CHECK (
    ("stockSaleId" IS NULL) = ("stockSaleNumber" IS NULL)
    AND ("stockSaleId" IS NULL) = ("stockCovered" IS NULL)
    AND ("stockSaleId" IS NULL OR "type" = 'INVOICE')
    AND ("stockCovered" IS NULL OR jsonb_typeof("stockCovered") = 'array')
  ),
  ADD CONSTRAINT "FactureDocument_stock_return_check" CHECK (
    NOT "stockReturnGoods" OR "type" = 'CREDIT_NOTE'
  );

-- Colonnes S5 d'un document : figées à l'émission ; la vente d'origine ne change jamais une fois posée.
-- (Fonction distincte : le contrôle des documents émis existant n'est pas modifié.)
CREATE FUNCTION "facture_document_stock_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."stockSaleId" IS NOT NULL
     AND (NEW."stockSaleId", NEW."stockSaleNumber", NEW."stockCovered")
         IS DISTINCT FROM (OLD."stockSaleId", OLD."stockSaleNumber", OLD."stockCovered") THEN
    RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: la vente en caisse d''une facture ne change pas'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'DRAFT'
     AND (NEW."stockSaleId", NEW."stockSaleNumber", NEW."stockCovered", NEW."stockReturnGoods")
         IS DISTINCT FROM
         (OLD."stockSaleId", OLD."stockSaleNumber", OLD."stockCovered", OLD."stockReturnGoods") THEN
    RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: un document émis est figé'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureDocument_stock_frozen"
  BEFORE UPDATE ON "FactureDocument"
  FOR EACH ROW EXECUTE FUNCTION "facture_document_stock_guard"();

-- File de sortie : source cohérente, lignes en tableau, état terminé daté.
ALTER TABLE "FactureStockOutbox"
  ADD CONSTRAINT "FactureStockOutbox_source_check" CHECK (
    ("source" = 'INTERVENTION') = ("interventionId" IS NOT NULL)
    AND ("source" = 'INTERVENTION') = ("documentId" IS NULL)
  ),
  ADD CONSTRAINT "FactureStockOutbox_json_check" CHECK (
    jsonb_typeof("lines") = 'array' AND jsonb_typeof("covered") = 'array'
  ),
  ADD CONSTRAINT "FactureStockOutbox_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "FactureStockOutbox_done_check" CHECK (("status" = 'DONE') = ("doneAt" IS NOT NULL));

-- Une demande n'est jamais supprimée (hors purge d'une organisation) ; seul son état de transmission
-- change, et « transmise » ou « non transmise (Stock indisponible) » sont définitifs.
CREATE FUNCTION "facture_stock_outbox_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.facture_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'FACTURE_STOCK_OUTBOX_FROZEN: une demande de mouvement ne se supprime pas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW."organizationId", NEW."key", NEW."source", NEW."documentId", NEW."interventionId",
      NEW."reference", NEW."lines", NEW."covered", NEW."actorUserId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."organizationId", OLD."key", OLD."source", OLD."documentId", OLD."interventionId",
      OLD."reference", OLD."lines", OLD."covered", OLD."actorUserId", OLD."createdAt")
     OR (OLD."status" IN ('DONE', 'SKIPPED') AND NEW."status" IS DISTINCT FROM OLD."status") THEN
    RAISE EXCEPTION 'FACTURE_STOCK_OUTBOX_FROZEN: une demande de mouvement ne change pas'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureStockOutbox_frozen"
  BEFORE UPDATE OR DELETE ON "FactureStockOutbox"
  FOR EACH ROW EXECUTE FUNCTION "facture_stock_outbox_guard"();
