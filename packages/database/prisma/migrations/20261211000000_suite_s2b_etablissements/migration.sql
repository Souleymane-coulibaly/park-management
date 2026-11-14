-- Ocall Suite — Sprint 2, étape B : référentiel commun des établissements. Migration additive : nature
-- facultative du lieu, enseignes (table nouvelle) et enseigne facultative d'un établissement. Aucune donnée
-- existante ne change : les établissements existants gardent kind = NULL et brandId = NULL.

-- CreateEnum
CREATE TYPE "EstablishmentKind" AS ENUM ('PARK', 'RESTAURANT', 'SHOP', 'WAREHOUSE', 'SCHOOL', 'AGENCY', 'OFFICE', 'OTHER');

-- AlterTable
ALTER TABLE "Establishment" ADD COLUMN     "brandId" UUID,
ADD COLUMN     "kind" "EstablishmentKind";

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_organizationId_id_key" ON "Brand"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_organizationId_name_key" ON "Brand"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Establishment_organizationId_brandId_idx" ON "Establishment"("organizationId", "brandId");

-- AddForeignKey
ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_organizationId_brandId_fkey" FOREIGN KEY ("organizationId", "brandId") REFERENCES "Brand"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

