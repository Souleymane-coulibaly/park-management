-- CreateEnum
CREATE TYPE "FactureAiProposalStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "FactureAiSettings" (
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quoteEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reportMonthlyLimit" INTEGER NOT NULL DEFAULT 100,
    "quoteMonthlyLimit" INTEGER NOT NULL DEFAULT 100,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureAiSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "FactureAiUsage" (
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

    CONSTRAINT "FactureAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureAiProposal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "status" "FactureAiProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "resultId" UUID,

    CONSTRAINT "FactureAiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureAiUsage_organizationId_feature_createdAt_idx" ON "FactureAiUsage"("organizationId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "FactureAiUsage_status_createdAt_idx" ON "FactureAiUsage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FactureAiProposal_organizationId_targetType_targetId_idx" ON "FactureAiProposal"("organizationId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "FactureAiProposal_organizationId_feature_createdAt_idx" ON "FactureAiProposal"("organizationId", "feature", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactureAiProposal_organizationId_id_key" ON "FactureAiProposal"("organizationId", "id");


-- ─── Contrôles métier (en plus de la validation de l'API) ───

ALTER TABLE "FactureAiSettings"
  ADD CONSTRAINT "FactureAiSettings_limits_check" CHECK (
    "reportMonthlyLimit" BETWEEN 0 AND 100000 AND "quoteMonthlyLimit" BETWEEN 0 AND 100000
  );

ALTER TABLE "FactureAiUsage"
  ADD CONSTRAINT "FactureAiUsage_status_check" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED'));

ALTER TABLE "FactureAiProposal"
  ADD CONSTRAINT "FactureAiProposal_decision_check" CHECK (
    ("status" = 'PROPOSED') = ("decidedAt" IS NULL)
    AND ("decidedAt" IS NULL) = ("decidedByUserId" IS NULL)
    AND ("status" = 'APPLIED' OR ("edited" = false AND "resultId" IS NULL))
  );

-- ─── Proposition IA : contenu figé, décision unique et définitive ───
-- La proposition (entrées, sortie, prompt, modèle, auteur) ne change jamais ; elle est décidée une seule
-- fois (appliquée ou rejetée). Suppression : purge d'une organisation entière seulement.

CREATE FUNCTION "facture_ai_proposal_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.facture_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'FACTURE_AI_PROPOSAL_FROZEN: une proposition IA ne se supprime pas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'PROPOSED'
     OR (NEW."organizationId", NEW."feature", NEW."targetType", NEW."targetId", NEW."input",
         NEW."output", NEW."promptId", NEW."promptVersion", NEW."model", NEW."createdByUserId",
         NEW."createdAt")
        IS DISTINCT FROM
        (OLD."organizationId", OLD."feature", OLD."targetType", OLD."targetId", OLD."input",
         OLD."output", OLD."promptId", OLD."promptVersion", OLD."model", OLD."createdByUserId",
         OLD."createdAt") THEN
    RAISE EXCEPTION 'FACTURE_AI_PROPOSAL_FROZEN: proposition IA figée'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureAiProposal_frozen"
  BEFORE UPDATE OR DELETE ON "FactureAiProposal"
  FOR EACH ROW EXECUTE FUNCTION "facture_ai_proposal_guard"();
