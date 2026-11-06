-- Sprint 8 : Ocall School AI (réglages, consommation, conversations, contenus pédagogiques). Strictement additive.
-- CreateTable
CREATE TABLE "SchoolAiSettings" (
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "copilotEnabled" BOOLEAN NOT NULL DEFAULT true,
    "teachingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "analysisEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyCallLimit" INTEGER NOT NULL DEFAULT 300,
    "alertPercent" INTEGER NOT NULL DEFAULT 80,
    "conversationRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAiSettings_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolAiUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
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

    CONSTRAINT "SchoolAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAiConversation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAiMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "grounded" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolAiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAiDocument" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "authorMemberId" UUID,
    "classId" UUID,
    "levelId" UUID,
    "subjectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "promptVersion" INTEGER NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "validatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAiDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAiSettings_organizationId_schoolId_key" ON "SchoolAiSettings"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolAiUsage_organizationId_schoolId_createdAt_idx" ON "SchoolAiUsage"("organizationId", "schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolAiUsage_status_createdAt_idx" ON "SchoolAiUsage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolAiConversation_organizationId_ownerUserId_schoolId_up_idx" ON "SchoolAiConversation"("organizationId", "ownerUserId", "schoolId", "updatedAt");

-- CreateIndex
CREATE INDEX "SchoolAiConversation_expiresAt_idx" ON "SchoolAiConversation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAiConversation_organizationId_id_key" ON "SchoolAiConversation"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolAiMessage_organizationId_conversationId_createdAt_idx" ON "SchoolAiMessage"("organizationId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolAiDocument_organizationId_schoolId_authorUserId_updat_idx" ON "SchoolAiDocument"("organizationId", "schoolId", "authorUserId", "updatedAt");

-- AddForeignKey
ALTER TABLE "SchoolAiSettings" ADD CONSTRAINT "SchoolAiSettings_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAiMessage" ADD CONSTRAINT "SchoolAiMessage_organizationId_conversationId_fkey" FOREIGN KEY ("organizationId", "conversationId") REFERENCES "SchoolAiConversation"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes écrites à la main.
ALTER TABLE "SchoolAiSettings" ADD CONSTRAINT "SchoolAiSettings_limits_check"
  CHECK ("monthlyCallLimit" BETWEEN 0 AND 100000 AND "alertPercent" BETWEEN 1 AND 100
    AND "conversationRetentionDays" BETWEEN 1 AND 365);
ALTER TABLE "SchoolAiUsage" ADD CONSTRAINT "SchoolAiUsage_status_check"
  CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED'));
ALTER TABLE "SchoolAiUsage" ADD CONSTRAINT "SchoolAiUsage_feature_check"
  CHECK ("feature" IN ('SCHOOL_COPILOT', 'SCHOOL_TEACHING', 'SCHOOL_ANALYSIS'));
ALTER TABLE "SchoolAiMessage" ADD CONSTRAINT "SchoolAiMessage_role_check"
  CHECK ("role" IN ('USER', 'ASSISTANT'));
ALTER TABLE "SchoolAiDocument" ADD CONSTRAINT "SchoolAiDocument_kind_check"
  CHECK ("kind" IN ('LESSON_SHEET', 'LESSON_PLAN', 'EXERCISES', 'QCM', 'HOMEWORK', 'ANSWER_KEY', 'ACTIVITY'));
ALTER TABLE "SchoolAiDocument" ADD CONSTRAINT "SchoolAiDocument_language_check"
  CHECK ("language" IN ('FR', 'AR'));
ALTER TABLE "SchoolAiDocument" ADD CONSTRAINT "SchoolAiDocument_difficulty_check"
  CHECK ("difficulty" IN ('EASY', 'MEDIUM', 'HARD'));
ALTER TABLE "SchoolAiDocument" ADD CONSTRAINT "SchoolAiDocument_status_check"
  CHECK ("status" IN ('DRAFT', 'VALIDATED', 'ARCHIVED'));
-- Un contenu validé porte son auteur de validation et sa date ; un brouillon n'en a pas.
ALTER TABLE "SchoolAiDocument" ADD CONSTRAINT "SchoolAiDocument_validation_check"
  CHECK (("status" = 'DRAFT') = ("validatedAt" IS NULL) OR "status" = 'ARCHIVED');
ALTER TABLE "SchoolAiDocument" ADD CONSTRAINT "SchoolAiDocument_target_check"
  CHECK ("classId" IS NOT NULL OR "levelId" IS NOT NULL);
ALTER TABLE "SchoolAiDocument" ADD CONSTRAINT "SchoolAiDocument_sections_check"
  CHECK (jsonb_typeof("sections") = 'array');
