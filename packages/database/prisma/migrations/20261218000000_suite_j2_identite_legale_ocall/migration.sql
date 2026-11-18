-- Commercialisation J2 : identité légale de l'éditeur Ocall et identité figée des factures d'abonnement.
-- Migration ADDITIVE : une table nouvelle (vide) et une colonne facultative. Aucune facture, aucun
-- abonnement, aucun règlement existant n'est modifié ; les factures déjà émises restent provisoires.

-- CreateTable
CREATE TABLE "PlatformLegalIdentity" (
    "id" TEXT NOT NULL,
    "legalName" TEXT,
    "tradeName" TEXT,
    "legalForm" TEXT,
    "shareCapital" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "rccm" TEXT,
    "nif" TEXT,
    "taxRegime" TEXT,
    "publicationDirector" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "privacyEmail" TEXT,
    "hostingProvider" TEXT,
    "bankDetails" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformLegalIdentity_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "issuerSnapshot" JSONB;
