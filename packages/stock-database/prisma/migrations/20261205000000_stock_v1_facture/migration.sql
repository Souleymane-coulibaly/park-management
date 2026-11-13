-- Ocall Stock V1 — S5 : interconnexion Ocall Facture. Migration additive : trois natures de mouvement,
-- l'emplacement des ventes Facture (réglage facultatif) et le journal des demandes reçues.

-- AlterEnum (PostgreSQL 12+ : plusieurs valeurs dans une même migration, non utilisées ici)

ALTER TYPE "StockMovementKind" ADD VALUE 'FACTURE_INVOICE';
ALTER TYPE "StockMovementKind" ADD VALUE 'FACTURE_PART';
ALTER TYPE "StockMovementKind" ADD VALUE 'FACTURE_CREDIT';

-- AlterTable
ALTER TABLE "StockSettings" ADD COLUMN     "factureLocationId" UUID;

-- CreateTable
CREATE TABLE "StockInboundEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "lines" JSONB NOT NULL,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockInboundEvent_organizationId_createdAt_idx" ON "StockInboundEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockInboundEvent_organizationId_source_sourceId_idx" ON "StockInboundEvent"("organizationId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockInboundEvent_organizationId_id_key" ON "StockInboundEvent"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockInboundEvent_organizationId_key_key" ON "StockInboundEvent"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "StockSettings" ADD CONSTRAINT "StockSettings_organizationId_factureLocationId_fkey" FOREIGN KEY ("organizationId", "factureLocationId") REFERENCES "StockLocation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Garanties écrites à la main ───

ALTER TABLE "StockInboundEvent"
  ADD CONSTRAINT "StockInboundEvent_origin_check" CHECK ("origin" = 'FACTURE'),
  ADD CONSTRAINT "StockInboundEvent_source_check"
    CHECK ("source" IN ('INVOICE', 'INTERVENTION', 'CREDIT_NOTE')),
  ADD CONSTRAINT "StockInboundEvent_key_check" CHECK (char_length("key") BETWEEN 3 AND 120),
  ADD CONSTRAINT "StockInboundEvent_lines_check" CHECK (jsonb_typeof("lines") = 'array');

-- Journal des demandes appliquées : jamais modifié ni supprimé (hors purge d'une organisation).
CREATE TRIGGER "StockInboundEvent_append_only"
  BEFORE UPDATE OR DELETE ON "StockInboundEvent"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();
