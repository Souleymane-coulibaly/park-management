-- Ocall Suite — Sprint 2, étape B : rattachement facultatif d'un site Stock à un établissement du
-- référentiel Suite (UUID, sans clé étrangère entre bases). Additive : les sites existants restent non
-- rattachés (NULL) ; aucun rattachement automatique. Un seul site Stock par établissement.

-- AlterTable
ALTER TABLE "StockSite" ADD COLUMN     "establishmentId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "StockSite_organizationId_establishmentId_key" ON "StockSite"("organizationId", "establishmentId");

