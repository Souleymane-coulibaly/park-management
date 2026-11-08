-- CreateEnum
CREATE TYPE "SchoolTimetableStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SchoolSlotKind" AS ENUM ('LESSON', 'BREAK');

-- CreateEnum
CREATE TYPE "SchoolEventCategory" AS ENUM ('HOLIDAY', 'PUBLIC_HOLIDAY', 'PEDAGOGICAL_DAY', 'EXAM_SESSION', 'PARENT_MEETING', 'FIELD_TRIP', 'SCHOOL_EVENT');

-- CreateEnum
CREATE TYPE "SchoolEventAudience" AS ENUM ('SCHOOL', 'CLASSES', 'GROUPS');

-- CreateEnum
CREATE TYPE "SchoolEventVisibility" AS ENUM ('STAFF', 'FAMILIES');

-- CreateEnum
CREATE TYPE "SchoolPlanningStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SchoolNotificationKind" ADD VALUE 'TIMETABLE';
ALTER TYPE "SchoolNotificationKind" ADD VALUE 'LESSON_CANCELLED';
ALTER TYPE "SchoolNotificationKind" ADD VALUE 'EXAM';
ALTER TYPE "SchoolNotificationKind" ADD VALUE 'EVENT';

-- CreateTable
CREATE TABLE "SchoolRoom" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolTimetable" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "label" TEXT,
    "status" "SchoolTimetableStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "sourceId" UUID,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" UUID,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolTimetable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolTimetableSlot" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "timetableId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "kind" "SchoolSlotKind" NOT NULL,
    "subjectId" UUID,
    "memberId" UUID,
    "groupId" UUID,
    "roomId" UUID,
    "label" TEXT,
    "labelAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolTimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolTimetableEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "timetableId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolTimetableEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolLessonException" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolLessonException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolTeacherUnavailability" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "reason" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolTeacherUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolCalendarEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "category" "SchoolEventCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "description" TEXT,
    "descriptionAr" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "audience" "SchoolEventAudience" NOT NULL DEFAULT 'SCHOOL',
    "visibility" "SchoolEventVisibility" NOT NULL DEFAULT 'FAMILIES',
    "status" "SchoolPlanningStatus" NOT NULL DEFAULT 'DRAFT',
    "important" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolCalendarEventTarget" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "classId" UUID,
    "groupId" UUID,

    CONSTRAINT "SchoolCalendarEventTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolExamSchedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "roomId" UUID,
    "supervisorMemberId" UUID,
    "status" "SchoolPlanningStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolExamSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolRoom_organizationId_id_key" ON "SchoolRoom"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolRoom_schoolId_name_key" ON "SchoolRoom"("schoolId", "name");

-- CreateIndex
CREATE INDEX "SchoolTimetable_organizationId_classId_status_idx" ON "SchoolTimetable"("organizationId", "classId", "status");

-- CreateIndex
CREATE INDEX "SchoolTimetable_organizationId_schoolId_status_validFrom_idx" ON "SchoolTimetable"("organizationId", "schoolId", "status", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolTimetable_organizationId_id_key" ON "SchoolTimetable"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolTimetableSlot_organizationId_timetableId_idx" ON "SchoolTimetableSlot"("organizationId", "timetableId");

-- CreateIndex
CREATE INDEX "SchoolTimetableSlot_organizationId_memberId_weekday_idx" ON "SchoolTimetableSlot"("organizationId", "memberId", "weekday");

-- CreateIndex
CREATE INDEX "SchoolTimetableSlot_organizationId_roomId_weekday_idx" ON "SchoolTimetableSlot"("organizationId", "roomId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolTimetableSlot_organizationId_id_key" ON "SchoolTimetableSlot"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolTimetableEvent_organizationId_timetableId_createdAt_idx" ON "SchoolTimetableEvent"("organizationId", "timetableId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolLessonException_organizationId_date_idx" ON "SchoolLessonException"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolLessonException_slotId_date_key" ON "SchoolLessonException"("slotId", "date");

-- CreateIndex
CREATE INDEX "SchoolTeacherUnavailability_organizationId_schoolId_memberI_idx" ON "SchoolTeacherUnavailability"("organizationId", "schoolId", "memberId");

-- CreateIndex
CREATE INDEX "SchoolCalendarEvent_organizationId_schoolId_startsOn_idx" ON "SchoolCalendarEvent"("organizationId", "schoolId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolCalendarEvent_organizationId_id_key" ON "SchoolCalendarEvent"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolCalendarEventTarget_organizationId_eventId_idx" ON "SchoolCalendarEventTarget"("organizationId", "eventId");

-- CreateIndex
CREATE INDEX "SchoolCalendarEventTarget_organizationId_classId_idx" ON "SchoolCalendarEventTarget"("organizationId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolExamSchedule_evaluationId_key" ON "SchoolExamSchedule"("evaluationId");

-- CreateIndex
CREATE INDEX "SchoolExamSchedule_organizationId_schoolId_date_idx" ON "SchoolExamSchedule"("organizationId", "schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolExamSchedule_organizationId_evaluationId_key" ON "SchoolExamSchedule"("organizationId", "evaluationId");

-- AddForeignKey
ALTER TABLE "SchoolRoom" ADD CONSTRAINT "SchoolRoom_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTimetable" ADD CONSTRAINT "SchoolTimetable_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTimetableSlot" ADD CONSTRAINT "SchoolTimetableSlot_organizationId_timetableId_fkey" FOREIGN KEY ("organizationId", "timetableId") REFERENCES "SchoolTimetable"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTimetableSlot" ADD CONSTRAINT "SchoolTimetableSlot_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "Subject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTimetableSlot" ADD CONSTRAINT "SchoolTimetableSlot_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTimetableSlot" ADD CONSTRAINT "SchoolTimetableSlot_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "SchoolRoom"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTimetableEvent" ADD CONSTRAINT "SchoolTimetableEvent_organizationId_timetableId_fkey" FOREIGN KEY ("organizationId", "timetableId") REFERENCES "SchoolTimetable"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolLessonException" ADD CONSTRAINT "SchoolLessonException_organizationId_slotId_fkey" FOREIGN KEY ("organizationId", "slotId") REFERENCES "SchoolTimetableSlot"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTeacherUnavailability" ADD CONSTRAINT "SchoolTeacherUnavailability_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolCalendarEvent" ADD CONSTRAINT "SchoolCalendarEvent_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolCalendarEventTarget" ADD CONSTRAINT "SchoolCalendarEventTarget_organizationId_eventId_fkey" FOREIGN KEY ("organizationId", "eventId") REFERENCES "SchoolCalendarEvent"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolExamSchedule" ADD CONSTRAINT "SchoolExamSchedule_organizationId_evaluationId_fkey" FOREIGN KEY ("organizationId", "evaluationId") REFERENCES "SchoolEvaluation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolExamSchedule" ADD CONSTRAINT "SchoolExamSchedule_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "SchoolRoom"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolExamSchedule" ADD CONSTRAINT "SchoolExamSchedule_organizationId_supervisorMemberId_fkey" FOREIGN KEY ("organizationId", "supervisorMemberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Contraintes écrites à la main (Sprint 7) ───

-- Version : validité ordonnée ; un seul brouillon par classe.
ALTER TABLE "SchoolTimetable" ADD CONSTRAINT "SchoolTimetable_validity_check"
  CHECK ("validTo" >= "validFrom");
CREATE UNIQUE INDEX "SchoolTimetable_draft_key" ON "SchoolTimetable"("classId") WHERE "status" = 'DRAFT';

-- Créneau : jour ISO, fin après le début, cours avec matière et enseignant, pause sans ressource.
ALTER TABLE "SchoolTimetableSlot" ADD CONSTRAINT "SchoolTimetableSlot_time_check"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
ALTER TABLE "SchoolTimetableSlot" ADD CONSTRAINT "SchoolTimetableSlot_kind_check"
  CHECK (("kind" = 'LESSON' AND "subjectId" IS NOT NULL AND "memberId" IS NOT NULL)
    OR ("kind" = 'BREAK' AND "subjectId" IS NULL AND "memberId" IS NULL AND "groupId" IS NULL AND "roomId" IS NULL));

-- Indisponibilité : jour ISO, fin après le début.
ALTER TABLE "SchoolTeacherUnavailability" ADD CONSTRAINT "SchoolTeacherUnavailability_time_check"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

-- Salle : capacité positive si renseignée.
ALTER TABLE "SchoolRoom" ADD CONSTRAINT "SchoolRoom_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);

-- Événement : période ordonnée, horaires tous deux absents ou ordonnés ; publié daté.
ALTER TABLE "SchoolCalendarEvent" ADD CONSTRAINT "SchoolCalendarEvent_period_check"
  CHECK ("endsOn" >= "startsOn");
ALTER TABLE "SchoolCalendarEvent" ADD CONSTRAINT "SchoolCalendarEvent_time_check"
  CHECK (("startMinute" IS NULL AND "endMinute" IS NULL)
    OR ("startMinute" IS NOT NULL AND "endMinute" IS NOT NULL
      AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute"));
ALTER TABLE "SchoolCalendarEvent" ADD CONSTRAINT "SchoolCalendarEvent_published_check"
  CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);
ALTER TABLE "SchoolCalendarEventTarget" ADD CONSTRAINT "SchoolCalendarEventTarget_one_check"
  CHECK (num_nonnulls("classId", "groupId") = 1);

-- Examen : début dans la journée, durée de 5 minutes à 8 heures, fin au plus tard à minuit.
ALTER TABLE "SchoolExamSchedule" ADD CONSTRAINT "SchoolExamSchedule_time_check"
  CHECK ("startMinute" >= 0 AND "durationMinutes" BETWEEN 5 AND 480 AND "startMinute" + "durationMinutes" <= 1440);
ALTER TABLE "SchoolExamSchedule" ADD CONSTRAINT "SchoolExamSchedule_published_check"
  CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);
