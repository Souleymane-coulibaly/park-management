-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SchoolType" AS ENUM ('PRESCHOOL', 'PRIMARY', 'MIDDLE', 'HIGH', 'FRANCO_ARABIC', 'COMPLEX');

-- CreateEnum
CREATE TYPE "SchoolLocale" AS ENUM ('FR', 'AR', 'BILINGUAL');

-- CreateEnum
CREATE TYPE "SchoolRole" AS ENUM ('GROUP_DIRECTOR', 'SCHOOL_DIRECTOR', 'SECRETARY', 'TEACHER', 'SUPERVISOR', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "SchoolYearStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "SchoolPeriodKind" AS ENUM ('TRIMESTER', 'SEMESTER', 'CUSTOM');

-- CreateTable
CREATE TABLE "SchoolGroup" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "type" "SchoolType" NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "timezone" TEXT NOT NULL,
    "defaultLocale" "SchoolLocale" NOT NULL DEFAULT 'FR',
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolMember" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "role" "SchoolRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolMemberAssignment" (
    "organizationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,

    CONSTRAINT "SchoolMemberAssignment_pkey" PRIMARY KEY ("memberId","schoolId")
);

-- CreateTable
CREATE TABLE "SchoolYear" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "SchoolYearStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicPeriod" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "kind" "SchoolPeriodKind" NOT NULL,
    "label" TEXT NOT NULL,
    "labelAr" TEXT,
    "position" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedagogicalTrack" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "locale" "SchoolLocale" NOT NULL DEFAULT 'FR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedagogicalTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "trackId" UUID,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "trackId" UUID,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "isReligious" BOOLEAN NOT NULL DEFAULT false,
    "defaultCoefficient" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingPolicyVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolGroup_organizationId_key" ON "SchoolGroup"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolGroup_organizationId_id_key" ON "SchoolGroup"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "School_organizationId_id_key" ON "School"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "School_organizationId_name_key" ON "School"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolMember_organizationId_id_key" ON "SchoolMember"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolMember_organizationId_userId_key" ON "SchoolMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "SchoolMemberAssignment_organizationId_schoolId_idx" ON "SchoolMemberAssignment"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolYear_organizationId_schoolId_status_idx" ON "SchoolYear"("organizationId", "schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolYear_organizationId_id_key" ON "SchoolYear"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolYear_schoolId_label_key" ON "SchoolYear"("schoolId", "label");

-- CreateIndex
CREATE INDEX "AcademicPeriod_organizationId_schoolYearId_idx" ON "AcademicPeriod"("organizationId", "schoolYearId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicPeriod_schoolYearId_position_key" ON "AcademicPeriod"("schoolYearId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PedagogicalTrack_organizationId_id_key" ON "PedagogicalTrack"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PedagogicalTrack_schoolId_name_key" ON "PedagogicalTrack"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Cycle_organizationId_id_key" ON "Cycle"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Cycle_schoolId_name_key" ON "Cycle"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Level_organizationId_id_key" ON "Level"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Level_cycleId_name_key" ON "Level"("cycleId", "name");

-- CreateIndex
CREATE INDEX "SchoolClass_organizationId_levelId_idx" ON "SchoolClass"("organizationId", "levelId");

-- CreateIndex
CREATE INDEX "SchoolClass_organizationId_trackId_idx" ON "SchoolClass"("organizationId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_schoolYearId_name_key" ON "SchoolClass"("schoolYearId", "name");

-- CreateIndex
CREATE INDEX "Subject_organizationId_trackId_idx" ON "Subject"("organizationId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_schoolId_name_key" ON "Subject"("schoolId", "name");

-- CreateIndex
CREATE INDEX "GradingPolicyVersion_organizationId_schoolId_idx" ON "GradingPolicyVersion"("organizationId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "GradingPolicyVersion_schoolId_version_key" ON "GradingPolicyVersion"("schoolId", "version");

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_organizationId_groupId_fkey" FOREIGN KEY ("organizationId", "groupId") REFERENCES "SchoolGroup"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolMemberAssignment" ADD CONSTRAINT "SchoolMemberAssignment_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolMemberAssignment" ADD CONSTRAINT "SchoolMemberAssignment_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolYear" ADD CONSTRAINT "SchoolYear_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_organizationId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedagogicalTrack" ADD CONSTRAINT "PedagogicalTrack_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_organizationId_cycleId_fkey" FOREIGN KEY ("organizationId", "cycleId") REFERENCES "Cycle"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_organizationId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_organizationId_levelId_fkey" FOREIGN KEY ("organizationId", "levelId") REFERENCES "Level"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_organizationId_trackId_fkey" FOREIGN KEY ("organizationId", "trackId") REFERENCES "PedagogicalTrack"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_organizationId_trackId_fkey" FOREIGN KEY ("organizationId", "trackId") REFERENCES "PedagogicalTrack"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingPolicyVersion" ADD CONSTRAINT "GradingPolicyVersion_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

