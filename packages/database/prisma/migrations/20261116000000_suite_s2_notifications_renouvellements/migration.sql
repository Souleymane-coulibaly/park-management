-- Sprint S2 : notifications du portail Ocall Suite, demandes de renouvellement et de changement
-- d'offre (type de demande), historique des traitements planifiés. Migration additive : aucune
-- modification ni suppression de donnée existante (les demandes S1 deviennent des activations).
-- CreateEnum
CREATE TYPE "ActivationRequestKind" AS ENUM ('ACTIVATION', 'RENEWAL', 'PLAN_CHANGE');

-- CreateEnum
CREATE TYPE "SuiteNotificationKind" AS ENUM ('TRIAL_STARTED', 'TRIAL_ENDING', 'TRIAL_EXPIRED', 'SUBSCRIPTION_ENDING', 'SUBSCRIPTION_EXPIRED', 'REQUEST_RECEIVED', 'REQUEST_HANDLED', 'REQUEST_REFUSED', 'ACTIVATION_CONFIRMED', 'SUSPENDED', 'REACTIVATED', 'SMS_TOPUP_APPROVED', 'SMS_TOPUP_REJECTED');

-- CreateEnum
CREATE TYPE "SuiteJobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "ActivationRequest" ADD COLUMN     "kind" "ActivationRequestKind" NOT NULL DEFAULT 'ACTIVATION';

-- CreateTable
CREATE TABLE "SuiteNotification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "SuiteNotificationKind" NOT NULL,
    "productCode" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "href" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuiteNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuiteScheduledJob" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuiteScheduledJob_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "SuiteJobRun" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "status" "SuiteJobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "stats" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SuiteJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuiteNotification_userId_readAt_createdAt_idx" ON "SuiteNotification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "SuiteNotification_organizationId_createdAt_idx" ON "SuiteNotification"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuiteNotification_userId_dedupeKey_key" ON "SuiteNotification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SuiteJobRun_job_startedAt_idx" ON "SuiteJobRun"("job", "startedAt");

-- CreateIndex
CREATE INDEX "Subscription_expiresAt_idx" ON "Subscription"("expiresAt");

-- AddForeignKey
ALTER TABLE "SuiteNotification" ADD CONSTRAINT "SuiteNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteNotification" ADD CONSTRAINT "SuiteNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

