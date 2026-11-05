-- Ocall School, Sprint 6 : portail parents, présences, annonces, notifications et SMS. Strictement additive.

-- CreateEnum
CREATE TYPE "SchoolPortalAccountStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "SchoolAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "SchoolJustificationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SchoolAnnouncementAudience" AS ENUM ('SCHOOL', 'CLASS', 'STUDENTS', 'GUARDIANS');

-- CreateEnum
CREATE TYPE "SchoolAnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SchoolNotificationKind" AS ENUM ('ANNOUNCEMENT', 'ABSENCE', 'LATE', 'REPORT_CARD', 'CHARGE_DUE', 'CHARGE_OVERDUE');

-- CreateEnum
CREATE TYPE "SchoolSmsStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SchoolPortalAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "SchoolPortalAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,

    CONSTRAINT "SchoolPortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolGuardianInvitation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolGuardianInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAttendanceSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" TEXT NOT NULL,
    "takenByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAttendanceRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "SchoolAttendanceStatus" NOT NULL,
    "minutesLate" INTEGER,
    "note" TEXT,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAttendanceEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "fromStatus" "SchoolAttendanceStatus",
    "toStatus" "SchoolAttendanceStatus" NOT NULL,
    "fromMinutesLate" INTEGER,
    "toMinutesLate" INTEGER,
    "fromNote" TEXT,
    "toNote" TEXT,
    "reason" TEXT,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolAttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAbsenceJustification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "byGuardian" BOOLEAN NOT NULL,
    "submittedByUserId" UUID NOT NULL,
    "status" "SchoolJustificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolAbsenceJustification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolResultPublication" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "validationId" UUID NOT NULL,
    "publishedByUserId" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnByUserId" UUID,

    CONSTRAINT "SchoolResultPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAnnouncement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "titleAr" TEXT,
    "bodyAr" TEXT,
    "audience" "SchoolAnnouncementAudience" NOT NULL,
    "status" "SchoolAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "expiresOn" DATE,
    "createdByUserId" UUID NOT NULL,
    "publishedByUserId" UUID,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAnnouncementTarget" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "announcementId" UUID NOT NULL,
    "classId" UUID,
    "studentId" UUID,
    "guardianId" UUID,

    CONSTRAINT "SchoolAnnouncementTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAnnouncementEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "announcementId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolAnnouncementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolNotification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "studentId" UUID,
    "kind" "SchoolNotificationKind" NOT NULL,
    "resourceId" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSmsSettings" (
    "schoolId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSmsSettings_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolSmsMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "guardianId" UUID,
    "studentId" UUID,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "SchoolSmsStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SchoolSmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolPortalAccount_userId_status_idx" ON "SchoolPortalAccount"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPortalAccount_organizationId_userId_key" ON "SchoolPortalAccount"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolGuardianInvitation_tokenHash_key" ON "SchoolGuardianInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "SchoolGuardianInvitation_organizationId_guardianId_idx" ON "SchoolGuardianInvitation"("organizationId", "guardianId");

-- CreateIndex
CREATE INDEX "SchoolAttendanceSession_organizationId_schoolId_date_idx" ON "SchoolAttendanceSession"("organizationId", "schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAttendanceSession_organizationId_id_key" ON "SchoolAttendanceSession"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAttendanceSession_classId_date_slot_key" ON "SchoolAttendanceSession"("classId", "date", "slot");

-- CreateIndex
CREATE INDEX "SchoolAttendanceRecord_organizationId_studentId_idx" ON "SchoolAttendanceRecord"("organizationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAttendanceRecord_organizationId_id_key" ON "SchoolAttendanceRecord"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAttendanceRecord_sessionId_studentId_key" ON "SchoolAttendanceRecord"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolAttendanceEvent_organizationId_recordId_idx" ON "SchoolAttendanceEvent"("organizationId", "recordId");

-- CreateIndex
CREATE INDEX "SchoolAbsenceJustification_organizationId_schoolId_status_idx" ON "SchoolAbsenceJustification"("organizationId", "schoolId", "status");

-- CreateIndex
CREATE INDEX "SchoolAbsenceJustification_organizationId_studentId_idx" ON "SchoolAbsenceJustification"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolResultPublication_organizationId_classId_periodId_idx" ON "SchoolResultPublication"("organizationId", "classId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolResultPublication_organizationId_id_key" ON "SchoolResultPublication"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolAnnouncement_organizationId_schoolId_status_idx" ON "SchoolAnnouncement"("organizationId", "schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAnnouncement_organizationId_id_key" ON "SchoolAnnouncement"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolAnnouncementTarget_organizationId_announcementId_idx" ON "SchoolAnnouncementTarget"("organizationId", "announcementId");

-- CreateIndex
CREATE INDEX "SchoolAnnouncementTarget_organizationId_classId_idx" ON "SchoolAnnouncementTarget"("organizationId", "classId");

-- CreateIndex
CREATE INDEX "SchoolAnnouncementTarget_organizationId_studentId_idx" ON "SchoolAnnouncementTarget"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolAnnouncementTarget_organizationId_guardianId_idx" ON "SchoolAnnouncementTarget"("organizationId", "guardianId");

-- CreateIndex
CREATE INDEX "SchoolAnnouncementEvent_organizationId_announcementId_idx" ON "SchoolAnnouncementEvent"("organizationId", "announcementId");

-- CreateIndex
CREATE INDEX "SchoolNotification_userId_readAt_createdAt_idx" ON "SchoolNotification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolNotification_organizationId_schoolId_idx" ON "SchoolNotification"("organizationId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolNotification_userId_dedupeKey_key" ON "SchoolNotification"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSmsSettings_organizationId_schoolId_key" ON "SchoolSmsSettings"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolSmsMessage_status_nextAttemptAt_idx" ON "SchoolSmsMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SchoolSmsMessage_organizationId_schoolId_createdAt_idx" ON "SchoolSmsMessage"("organizationId", "schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSmsMessage_organizationId_dedupeKey_key" ON "SchoolSmsMessage"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SchoolGuardian_portalUserId_idx" ON "SchoolGuardian"("portalUserId");

-- AddForeignKey
ALTER TABLE "SchoolGuardianInvitation" ADD CONSTRAINT "SchoolGuardianInvitation_organizationId_guardianId_fkey" FOREIGN KEY ("organizationId", "guardianId") REFERENCES "SchoolGuardian"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAttendanceSession" ADD CONSTRAINT "SchoolAttendanceSession_organizationId_schoolYearId_classI_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAttendanceRecord" ADD CONSTRAINT "SchoolAttendanceRecord_organizationId_sessionId_fkey" FOREIGN KEY ("organizationId", "sessionId") REFERENCES "SchoolAttendanceSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAttendanceRecord" ADD CONSTRAINT "SchoolAttendanceRecord_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAttendanceEvent" ADD CONSTRAINT "SchoolAttendanceEvent_organizationId_recordId_fkey" FOREIGN KEY ("organizationId", "recordId") REFERENCES "SchoolAttendanceRecord"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAbsenceJustification" ADD CONSTRAINT "SchoolAbsenceJustification_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolResultPublication" ADD CONSTRAINT "SchoolResultPublication_organizationId_schoolYearId_classI_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolResultPublication" ADD CONSTRAINT "SchoolResultPublication_organizationId_schoolYearId_period_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "periodId") REFERENCES "AcademicPeriod"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAnnouncement" ADD CONSTRAINT "SchoolAnnouncement_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAnnouncementTarget" ADD CONSTRAINT "SchoolAnnouncementTarget_organizationId_announcementId_fkey" FOREIGN KEY ("organizationId", "announcementId") REFERENCES "SchoolAnnouncement"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAnnouncementEvent" ADD CONSTRAINT "SchoolAnnouncementEvent_organizationId_announcementId_fkey" FOREIGN KEY ("organizationId", "announcementId") REFERENCES "SchoolAnnouncement"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolSmsSettings" ADD CONSTRAINT "SchoolSmsSettings_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AlterTable : observation de mémorisation autorisée pour les familles.
ALTER TABLE "SchoolQuranEvaluation" ADD COLUMN     "remarkShared" BOOLEAN NOT NULL DEFAULT false;

-- Contraintes écrites à la main.

-- Appel : séance au format court, retard borné et réservé au statut « en retard ».
ALTER TABLE "SchoolAttendanceSession" ADD CONSTRAINT "SchoolAttendanceSession_slot_check"
  CHECK ("slot" ~ '^[A-Z0-9_-]{1,20}$');
ALTER TABLE "SchoolAttendanceRecord" ADD CONSTRAINT "SchoolAttendanceRecord_late_check"
  CHECK ("minutesLate" IS NULL OR ("status" = 'LATE' AND "minutesLate" BETWEEN 0 AND 600));

-- Justificatif : période cohérente, motif non vide.
ALTER TABLE "SchoolAbsenceJustification" ADD CONSTRAINT "SchoolAbsenceJustification_dates_check"
  CHECK ("fromDate" <= "toDate" AND length(btrim("reason")) > 0);

-- Une seule publication active des résultats d'une classe pour une période.
CREATE UNIQUE INDEX "SchoolResultPublication_active_key"
  ON "SchoolResultPublication" ("classId", "periodId") WHERE "withdrawnAt" IS NULL;

-- Annonce publiée : date de publication obligatoire (un brouillon archivé n'a jamais été publié).
ALTER TABLE "SchoolAnnouncement" ADD CONSTRAINT "SchoolAnnouncement_published_check"
  CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);

-- Destinataire : exactement une cible.
ALTER TABLE "SchoolAnnouncementTarget" ADD CONSTRAINT "SchoolAnnouncementTarget_one_check"
  CHECK (num_nonnulls("classId", "studentId", "guardianId") = 1);

-- SMS : tentatives bornées, alignées sur SCHOOL_SMS_MAX_ATTEMPTS (5) ; la réservation ne dépasse jamais.
ALTER TABLE "SchoolSmsMessage" ADD CONSTRAINT "SchoolSmsMessage_attempts_check"
  CHECK ("attempts" BETWEEN 0 AND 5);
