-- Ocall Suite — Sprint 2, étape B : rattachement facultatif d'une école à un établissement du référentiel
-- Suite (UUID, sans clé étrangère entre bases). Additive : les écoles existantes restent non rattachées
-- (NULL) ; aucun rattachement automatique. Une seule école par établissement.

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "establishmentId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "School_organizationId_establishmentId_key" ON "School"("organizationId", "establishmentId");

