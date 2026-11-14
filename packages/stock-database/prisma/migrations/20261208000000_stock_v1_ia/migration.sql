-- Ocall Stock V1 — S8 : intelligence artificielle (Ocall AI Core). Migration additive : réglages IA
-- (désactivée par défaut), consommation, propositions tracées, illustrations IA repérées sur les photos.

-- CreateEnum
CREATE TYPE "StockAiProposalStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED');

-- AlterTable
ALTER TABLE "StockProductImage" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showcaseApproved" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "StockAiSettings" (
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "restockEnabled" BOOLEAN NOT NULL DEFAULT true,
    "stockoutEnabled" BOOLEAN NOT NULL DEFAULT true,
    "analysisEnabled" BOOLEAN NOT NULL DEFAULT true,
    "photoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "illustrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "restockMonthlyLimit" INTEGER NOT NULL DEFAULT 50,
    "stockoutMonthlyLimit" INTEGER NOT NULL DEFAULT 50,
    "analysisMonthlyLimit" INTEGER NOT NULL DEFAULT 30,
    "photoMonthlyLimit" INTEGER NOT NULL DEFAULT 100,
    "illustrationMonthlyLimit" INTEGER NOT NULL DEFAULT 20,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAiSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "StockAiUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "memberId" UUID,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptId" TEXT,
    "promptVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMicroUsd" INTEGER,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAiProposal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "status" "StockAiProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "targetType" TEXT NOT NULL,
    "targetId" UUID,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "promptId" TEXT,
    "promptVersion" INTEGER,
    "model" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "resultId" UUID,

    CONSTRAINT "StockAiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAiUsage_organizationId_feature_createdAt_idx" ON "StockAiUsage"("organizationId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "StockAiUsage_status_createdAt_idx" ON "StockAiUsage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StockAiProposal_organizationId_feature_createdAt_idx" ON "StockAiProposal"("organizationId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "StockAiProposal_organizationId_targetType_targetId_idx" ON "StockAiProposal"("organizationId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAiProposal_organizationId_id_key" ON "StockAiProposal"("organizationId", "id");

-- ─── Garanties écrites à la main ───

ALTER TABLE "StockAiSettings"
  ADD CONSTRAINT "StockAiSettings_limits_check" CHECK (
    "restockMonthlyLimit" BETWEEN 0 AND 100000 AND "stockoutMonthlyLimit" BETWEEN 0 AND 100000
    AND "analysisMonthlyLimit" BETWEEN 0 AND 100000 AND "photoMonthlyLimit" BETWEEN 0 AND 100000
    AND "illustrationMonthlyLimit" BETWEEN 0 AND 100000
  );

ALTER TABLE "StockAiUsage"
  ADD CONSTRAINT "StockAiUsage_status_check" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED'));

ALTER TABLE "StockAiProposal"
  ADD CONSTRAINT "StockAiProposal_decided_check"
    CHECK (("status" = 'PROPOSED') = ("decidedAt" IS NULL));

-- Une photo réelle est toujours visible sur la vitrine ; seule une illustration IA peut ne pas l'être.
ALTER TABLE "StockProductImage"
  ADD CONSTRAINT "StockProductImage_showcase_check" CHECK ("aiGenerated" OR "showcaseApproved");
