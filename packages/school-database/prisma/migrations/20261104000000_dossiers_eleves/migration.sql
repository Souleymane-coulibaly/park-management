-- CreateEnum
CREATE TYPE "SchoolStudentStatus" AS ENUM ('REGISTERED', 'ENROLLED', 'TRANSFERRED', 'LEFT', 'DROPPED_OUT');

-- CreateEnum
CREATE TYPE "SchoolSex" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "SchoolEnrollmentStatus" AS ENUM ('DRAFT', 'PENDING', 'VALIDATED', 'CANCELLED', 'ENDED');

-- CreateEnum
CREATE TYPE "SchoolEnrollmentKind" AS ENUM ('NEW', 'RENEWAL', 'TRANSFER_IN');

-- CreateEnum
CREATE TYPE "SchoolExitReason" AS ENUM ('TRANSFERRED', 'LEFT', 'DROPPED_OUT');

-- CreateEnum
CREATE TYPE "SchoolGuardianRelation" AS ENUM ('MOTHER', 'FATHER', 'LEGAL_GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "SchoolMatriculeScope" AS ENUM ('SCHOOL', 'GROUP');

-- CreateEnum
CREATE TYPE "SchoolDocumentCategory" AS ENUM ('PHOTO', 'BIRTH_CERTIFICATE', 'SCHOOL_CERTIFICATE', 'PREVIOUS_REPORT', 'TRANSFER_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "SchoolImportFormat" AS ENUM ('CSV', 'XLSX');

-- CreateTable
CREATE TABLE "SchoolStudentSettings" (
    "schoolId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "matriculeScope" "SchoolMatriculeScope" NOT NULL DEFAULT 'SCHOOL',
    "matriculePrefix" TEXT NOT NULL DEFAULT '',
    "matriculeYear" BOOLEAN NOT NULL DEFAULT true,
    "matriculePadding" INTEGER NOT NULL DEFAULT 6,
    "requiredDocuments" "SchoolDocumentCategory"[],
    "customFields" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolStudentSettings_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolNumberCounter" (
    "organizationId" UUID NOT NULL,
    "counterKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "SchoolNumberCounter_pkey" PRIMARY KEY ("organizationId","counterKey")
);

-- CreateTable
CREATE TABLE "SchoolStudent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "matricule" TEXT NOT NULL,
    "matriculeScope" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastNameAr" TEXT,
    "firstNameAr" TEXT,
    "birthDate" DATE NOT NULL,
    "birthPlace" TEXT,
    "sex" "SchoolSex",
    "nationality" TEXT,
    "address" TEXT,
    "adminNotes" TEXT,
    "specialNeedsEnc" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "status" "SchoolStudentStatus" NOT NULL DEFAULT 'REGISTERED',
    "searchText" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolGuardian" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "portalUserId" UUID,
    "searchText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolGuardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolStudentGuardian" (
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "relation" "SchoolGuardianRelation" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveSms" BOOLEAN NOT NULL DEFAULT false,
    "canViewSchoolInfo" BOOLEAN NOT NULL DEFAULT false,
    "canPickUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolStudentGuardian_pkey" PRIMARY KEY ("studentId","guardianId")
);

-- CreateTable
CREATE TABLE "SchoolEnrollment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "trackId" UUID,
    "classId" UUID,
    "kind" "SchoolEnrollmentKind" NOT NULL DEFAULT 'NEW',
    "status" "SchoolEnrollmentStatus" NOT NULL DEFAULT 'DRAFT',
    "enrolledOn" DATE,
    "exitReason" "SchoolExitReason",
    "exitedOn" DATE,
    "statusNote" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClassAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdByUserId" UUID NOT NULL,

    CONSTRAINT "SchoolClassAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClassTeacher" (
    "organizationId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "memberId" UUID NOT NULL,

    CONSTRAINT "SchoolClassTeacher_pkey" PRIMARY KEY ("classId","memberId")
);

-- CreateTable
CREATE TABLE "SchoolStudentDocument" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "category" "SchoolDocumentCategory" NOT NULL,
    "displayName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" UUID,

    CONSTRAINT "SchoolStudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolStudentEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolStudentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolImportJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID,
    "format" "SchoolImportFormat" NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "createdRows" INTEGER NOT NULL,
    "duplicateRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolStudentSettings_organizationId_schoolId_key" ON "SchoolStudentSettings"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolStudent_organizationId_schoolId_status_idx" ON "SchoolStudent"("organizationId", "schoolId", "status");

-- CreateIndex
CREATE INDEX "SchoolStudent_organizationId_schoolId_lastName_idx" ON "SchoolStudent"("organizationId", "schoolId", "lastName");

-- CreateIndex
CREATE INDEX "SchoolStudent_organizationId_identityKey_idx" ON "SchoolStudent"("organizationId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolStudent_organizationId_id_key" ON "SchoolStudent"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolStudent_organizationId_matriculeScope_matricule_key" ON "SchoolStudent"("organizationId", "matriculeScope", "matricule");

-- CreateIndex
CREATE INDEX "SchoolGuardian_organizationId_schoolId_idx" ON "SchoolGuardian"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolGuardian_organizationId_phone_idx" ON "SchoolGuardian"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolGuardian_organizationId_id_key" ON "SchoolGuardian"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolStudentGuardian_organizationId_guardianId_idx" ON "SchoolStudentGuardian"("organizationId", "guardianId");

-- CreateIndex
CREATE INDEX "SchoolEnrollment_organizationId_schoolId_status_idx" ON "SchoolEnrollment"("organizationId", "schoolId", "status");

-- CreateIndex
CREATE INDEX "SchoolEnrollment_organizationId_classId_status_idx" ON "SchoolEnrollment"("organizationId", "classId", "status");

-- CreateIndex
CREATE INDEX "SchoolEnrollment_organizationId_studentId_idx" ON "SchoolEnrollment"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolEnrollment_organizationId_schoolYearId_status_idx" ON "SchoolEnrollment"("organizationId", "schoolYearId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolEnrollment_organizationId_id_key" ON "SchoolEnrollment"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolClassAssignment_organizationId_studentId_idx" ON "SchoolClassAssignment"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolClassAssignment_organizationId_classId_idx" ON "SchoolClassAssignment"("organizationId", "classId");

-- CreateIndex
CREATE INDEX "SchoolClassTeacher_organizationId_memberId_idx" ON "SchoolClassTeacher"("organizationId", "memberId");

-- CreateIndex
CREATE INDEX "SchoolStudentDocument_organizationId_studentId_deletedAt_idx" ON "SchoolStudentDocument"("organizationId", "studentId", "deletedAt");

-- CreateIndex
CREATE INDEX "SchoolStudentEvent_organizationId_studentId_createdAt_idx" ON "SchoolStudentEvent"("organizationId", "studentId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolImportJob_organizationId_schoolId_createdAt_idx" ON "SchoolImportJob"("organizationId", "schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolYear_organizationId_schoolId_id_key" ON "SchoolYear"("organizationId", "schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_organizationId_id_key" ON "SchoolClass"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_organizationId_schoolYearId_id_key" ON "SchoolClass"("organizationId", "schoolYearId", "id");

-- AddForeignKey
ALTER TABLE "SchoolStudentSettings" ADD CONSTRAINT "SchoolStudentSettings_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStudent" ADD CONSTRAINT "SchoolStudent_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolGuardian" ADD CONSTRAINT "SchoolGuardian_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStudentGuardian" ADD CONSTRAINT "SchoolStudentGuardian_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStudentGuardian" ADD CONSTRAINT "SchoolStudentGuardian_organizationId_guardianId_fkey" FOREIGN KEY ("organizationId", "guardianId") REFERENCES "SchoolGuardian"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEnrollment" ADD CONSTRAINT "SchoolEnrollment_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEnrollment" ADD CONSTRAINT "SchoolEnrollment_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEnrollment" ADD CONSTRAINT "SchoolEnrollment_organizationId_schoolId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEnrollment" ADD CONSTRAINT "SchoolEnrollment_organizationId_levelId_fkey" FOREIGN KEY ("organizationId", "levelId") REFERENCES "Level"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEnrollment" ADD CONSTRAINT "SchoolEnrollment_organizationId_trackId_fkey" FOREIGN KEY ("organizationId", "trackId") REFERENCES "PedagogicalTrack"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEnrollment" ADD CONSTRAINT "SchoolEnrollment_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassAssignment" ADD CONSTRAINT "SchoolClassAssignment_organizationId_enrollmentId_fkey" FOREIGN KEY ("organizationId", "enrollmentId") REFERENCES "SchoolEnrollment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassAssignment" ADD CONSTRAINT "SchoolClassAssignment_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassAssignment" ADD CONSTRAINT "SchoolClassAssignment_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassTeacher" ADD CONSTRAINT "SchoolClassTeacher_organizationId_classId_fkey" FOREIGN KEY ("organizationId", "classId") REFERENCES "SchoolClass"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassTeacher" ADD CONSTRAINT "SchoolClassTeacher_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStudentDocument" ADD CONSTRAINT "SchoolStudentDocument_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStudentEvent" ADD CONSTRAINT "SchoolStudentEvent_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolImportJob" ADD CONSTRAINT "SchoolImportJob_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Index partiels, hors du schéma Prisma : aucune double inscription active sur une même année, aucune
-- double affectation ouverte, un seul responsable principal par élève.
CREATE UNIQUE INDEX "SchoolEnrollment_active_student_year_key"
  ON "SchoolEnrollment"("organizationId", "studentId", "schoolYearId")
  WHERE "status" IN ('DRAFT', 'PENDING', 'VALIDATED');
CREATE UNIQUE INDEX "SchoolClassAssignment_open_student_year_key"
  ON "SchoolClassAssignment"("organizationId", "studentId", "schoolYearId")
  WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "SchoolStudentGuardian_primary_key"
  ON "SchoolStudentGuardian"("studentId")
  WHERE "isPrimary";
