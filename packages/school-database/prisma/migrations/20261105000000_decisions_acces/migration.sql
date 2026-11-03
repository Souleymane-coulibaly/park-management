-- CreateTable
CREATE TABLE "SchoolAccessDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "SchoolAccessDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolAccessDecision_organizationId_publishedAt_createdAt_idx" ON "SchoolAccessDecision"("organizationId", "publishedAt", "createdAt");
