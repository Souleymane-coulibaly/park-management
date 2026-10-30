-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('CATALOG_IMPORT', 'TICKET_IMPORT', 'COPILOT', 'VOICE_ORDER');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiImportKind" AS ENUM ('CATALOG', 'TICKETS');

-- CreateEnum
CREATE TYPE "AiImportStatus" AS ENUM ('ANALYZED', 'FAILED', 'PUBLISHED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "VoiceOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DISCARDED');

-- CreateTable
CREATE TABLE "AiSettings" (
    "organizationId" UUID NOT NULL,
    "catalogImportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ticketImportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "copilotEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voiceOrderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyCallLimit" INTEGER NOT NULL DEFAULT 500,
    "alertPercent" INTEGER NOT NULL DEFAULT 80,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID,
    "membershipId" UUID,
    "feature" "AiFeature" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiCallStatus" NOT NULL DEFAULT 'PENDING',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "audioSeconds" INTEGER,
    "estimatedCostMicroUsd" INTEGER,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiImport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "kind" "AiImportKind" NOT NULL,
    "status" "AiImportStatus" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "result" JSONB,
    "publication" JSONB,
    "errorCode" TEXT,
    "createdById" UUID NOT NULL,
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "AiImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceOrderDraft" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "status" "VoiceOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "transcript" TEXT,
    "proposal" JSONB,
    "saleId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "VoiceOrderDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsage_organizationId_createdAt_idx" ON "AiUsage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_organizationId_feature_createdAt_idx" ON "AiUsage"("organizationId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiImport_organizationId_createdAt_idx" ON "AiImport"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiImport_expiresAt_idx" ON "AiImport"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceOrderDraft_saleId_key" ON "VoiceOrderDraft"("saleId");

-- CreateIndex
CREATE INDEX "VoiceOrderDraft_organizationId_createdAt_idx" ON "VoiceOrderDraft"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceOrderDraft_expiresAt_idx" ON "VoiceOrderDraft"("expiresAt");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiImport" ADD CONSTRAINT "AiImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiImport" ADD CONSTRAINT "AiImport_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiImport" ADD CONSTRAINT "AiImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiImport" ADD CONSTRAINT "AiImport_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceOrderDraft" ADD CONSTRAINT "VoiceOrderDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceOrderDraft" ADD CONSTRAINT "VoiceOrderDraft_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceOrderDraft" ADD CONSTRAINT "VoiceOrderDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Contraintes ajoutées à la main (non gérées par Prisma) : bornes des réglages IA.
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_monthlyCallLimit_check" CHECK ("monthlyCallLimit" >= 0 AND "monthlyCallLimit" <= 1000000);
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_alertPercent_check" CHECK ("alertPercent" BETWEEN 1 AND 100);
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_retentionDays_check" CHECK ("retentionDays" BETWEEN 1 AND 365);
