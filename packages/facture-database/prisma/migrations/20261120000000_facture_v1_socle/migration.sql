-- Ocall Facture V1 — socle (F0) : paramètres légaux, membres et rôles, numérotation continue.

-- CreateEnum
CREATE TYPE "FactureRole" AS ENUM ('MANAGER', 'SALES', 'ACCOUNTANT', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "FactureDocumentType" AS ENUM ('QUOTE', 'PRO_FORMA', 'ORDER', 'INVOICE', 'CREDIT_NOTE');

-- CreateTable
CREATE TABLE "FactureSettings" (
    "organizationId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'ML',
    "phone" TEXT,
    "email" TEXT,
    "nif" TEXT,
    "rccm" TEXT,
    "taxRegime" TEXT,
    "bankDetails" TEXT,
    "legalFooter" TEXT,
    "defaultVatRate" INTEGER NOT NULL DEFAULT 18,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "logoKey" TEXT,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "FactureMember" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "role" "FactureRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureNumberCounter" (
    "organizationId" UUID NOT NULL,
    "type" "FactureDocumentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureNumberCounter_pkey" PRIMARY KEY ("organizationId","type","year")
);

-- CreateIndex
CREATE INDEX "FactureMember_organizationId_isActive_idx" ON "FactureMember"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FactureMember_organizationId_id_key" ON "FactureMember"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureMember_organizationId_userId_key" ON "FactureMember"("organizationId", "userId");

-- Contrôles en base : TVA par défaut de 0 à 20 %, délai de paiement et compteur positifs.
ALTER TABLE "FactureSettings" ADD CONSTRAINT "FactureSettings_defaultVatRate_check" CHECK ("defaultVatRate" BETWEEN 0 AND 20);
ALTER TABLE "FactureSettings" ADD CONSTRAINT "FactureSettings_paymentTermsDays_check" CHECK ("paymentTermsDays" BETWEEN 0 AND 365);
ALTER TABLE "FactureNumberCounter" ADD CONSTRAINT "FactureNumberCounter_value_check" CHECK ("value" >= 0);
