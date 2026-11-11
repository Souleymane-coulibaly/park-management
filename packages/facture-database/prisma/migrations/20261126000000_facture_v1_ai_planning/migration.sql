-- CreateEnum
CREATE TYPE "FactureInterventionPriority" AS ENUM ('NORMAL', 'URGENT');

-- AlterTable
ALTER TABLE "FactureEquipment" ADD COLUMN     "maintenanceIntervalMonths" INTEGER;

-- AlterTable
ALTER TABLE "FactureIntervention" ADD COLUMN     "priority" "FactureInterventionPriority" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "FactureAiSettings" ADD COLUMN     "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maintenanceMonthlyLimit" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "planningEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "planningMonthlyLimit" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "FactureSkill" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureMemberSkill" (
    "organizationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "skillId" UUID NOT NULL,

    CONSTRAINT "FactureMemberSkill_pkey" PRIMARY KEY ("memberId","skillId")
);

-- CreateTable
CREATE TABLE "FactureInterventionSkill" (
    "organizationId" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "skillId" UUID NOT NULL,

    CONSTRAINT "FactureInterventionSkill_pkey" PRIMARY KEY ("interventionId","skillId")
);

-- CreateTable
CREATE TABLE "FactureUnavailability" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FactureSkill_organizationId_id_key" ON "FactureSkill"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureSkill_organizationId_name_key" ON "FactureSkill"("organizationId", "name");

-- CreateIndex
CREATE INDEX "FactureMemberSkill_organizationId_skillId_idx" ON "FactureMemberSkill"("organizationId", "skillId");

-- CreateIndex
CREATE INDEX "FactureInterventionSkill_organizationId_skillId_idx" ON "FactureInterventionSkill"("organizationId", "skillId");

-- CreateIndex
CREATE INDEX "FactureUnavailability_organizationId_memberId_startsAt_idx" ON "FactureUnavailability"("organizationId", "memberId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactureUnavailability_organizationId_id_key" ON "FactureUnavailability"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "FactureMemberSkill" ADD CONSTRAINT "FactureMemberSkill_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "FactureMember"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureMemberSkill" ADD CONSTRAINT "FactureMemberSkill_organizationId_skillId_fkey" FOREIGN KEY ("organizationId", "skillId") REFERENCES "FactureSkill"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureInterventionSkill" ADD CONSTRAINT "FactureInterventionSkill_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "FactureIntervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureInterventionSkill" ADD CONSTRAINT "FactureInterventionSkill_organizationId_skillId_fkey" FOREIGN KEY ("organizationId", "skillId") REFERENCES "FactureSkill"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureUnavailability" ADD CONSTRAINT "FactureUnavailability_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "FactureMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Contrôles métier (en plus de la validation de l'API) ───

ALTER TABLE "FactureEquipment"
  ADD CONSTRAINT "FactureEquipment_maintenanceInterval_check" CHECK (
    "maintenanceIntervalMonths" IS NULL OR "maintenanceIntervalMonths" BETWEEN 1 AND 60
  );

ALTER TABLE "FactureAiSettings"
  ADD CONSTRAINT "FactureAiSettings_f6b_limits_check" CHECK (
    "planningMonthlyLimit" BETWEEN 0 AND 100000 AND "maintenanceMonthlyLimit" BETWEEN 0 AND 100000
  );

ALTER TABLE "FactureSkill"
  ADD CONSTRAINT "FactureSkill_name_check" CHECK (length(btrim("name")) BETWEEN 2 AND 60);

ALTER TABLE "FactureUnavailability"
  ADD CONSTRAINT "FactureUnavailability_period_check" CHECK (
    "endsAt" > "startsAt" AND "endsAt" <= "startsAt" + interval '366 days'
  );
