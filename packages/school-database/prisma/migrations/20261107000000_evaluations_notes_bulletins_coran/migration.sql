-- CreateEnum
CREATE TYPE "SchoolEvaluationKind" AS ENUM ('HOMEWORK', 'QUIZ', 'COMPOSITION', 'EXAM');

-- CreateEnum
CREATE TYPE "SchoolGradeStatus" AS ENUM ('SCORED', 'ABSENT', 'EXEMPT');

-- CreateEnum
CREATE TYPE "SchoolQuranStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'MEMORIZED', 'TO_REVIEW');

-- CreateTable
CREATE TABLE "SchoolEvaluation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "groupId" UUID,
    "subjectId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "kind" "SchoolEvaluationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "heldOn" DATE NOT NULL,
    "maxScore" DECIMAL(6,2) NOT NULL,
    "coefficient" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolGrade" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "SchoolGradeStatus" NOT NULL,
    "score" DECIMAL(6,2),
    "comment" TEXT,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolGradeEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolGradeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAppreciation" (
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "textAr" TEXT,
    "authorUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAppreciation_pkey" PRIMARY KEY ("periodId","classId","subjectId","studentId")
);

-- CreateTable
CREATE TABLE "SchoolReportComment" (
    "organizationId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "textAr" TEXT,
    "authorUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolReportComment_pkey" PRIMARY KEY ("periodId","classId","studentId")
);

-- CreateTable
CREATE TABLE "SchoolResultValidation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "policyVersion" INTEGER,
    "results" JSONB NOT NULL,
    "validatedByUserId" UUID NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" TIMESTAMP(3),
    "unlockedByUserId" UUID,
    "unlockReason" TEXT,

    CONSTRAINT "SchoolResultValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolQuranSettings" (
    "schoolId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "subjectId" UUID,
    "updatedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolQuranSettings_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolQuranProgress" (
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "surah" INTEGER NOT NULL,
    "status" "SchoolQuranStatus" NOT NULL,
    "memorizedOn" DATE,
    "lastReviewedOn" DATE,
    "updatedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolQuranProgress_pkey" PRIMARY KEY ("studentId","surah")
);

-- CreateTable
CREATE TABLE "SchoolQuranEvaluation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "surah" INTEGER NOT NULL,
    "status" "SchoolQuranStatus" NOT NULL,
    "evaluatedOn" DATE NOT NULL,
    "remark" TEXT,
    "sequence" INTEGER NOT NULL,
    "evaluatorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolQuranEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolEvaluation_organizationId_classId_periodId_idx" ON "SchoolEvaluation"("organizationId", "classId", "periodId");

-- CreateIndex
CREATE INDEX "SchoolEvaluation_organizationId_periodId_idx" ON "SchoolEvaluation"("organizationId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolEvaluation_organizationId_id_key" ON "SchoolEvaluation"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolGrade_organizationId_studentId_idx" ON "SchoolGrade"("organizationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolGrade_evaluationId_studentId_key" ON "SchoolGrade"("evaluationId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolGradeEvent_organizationId_evaluationId_studentId_crea_idx" ON "SchoolGradeEvent"("organizationId", "evaluationId", "studentId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolAppreciation_organizationId_classId_periodId_idx" ON "SchoolAppreciation"("organizationId", "classId", "periodId");

-- CreateIndex
CREATE INDEX "SchoolReportComment_organizationId_classId_periodId_idx" ON "SchoolReportComment"("organizationId", "classId", "periodId");

-- CreateIndex
CREATE INDEX "SchoolResultValidation_organizationId_classId_periodId_idx" ON "SchoolResultValidation"("organizationId", "classId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolQuranSettings_organizationId_schoolId_key" ON "SchoolQuranSettings"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolQuranProgress_organizationId_studentId_idx" ON "SchoolQuranProgress"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolQuranEvaluation_organizationId_studentId_surah_evalua_idx" ON "SchoolQuranEvaluation"("organizationId", "studentId", "surah", "evaluatedOn");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolQuranEvaluation_studentId_surah_sequence_key" ON "SchoolQuranEvaluation"("studentId", "surah", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicPeriod_organizationId_schoolYearId_id_key" ON "AcademicPeriod"("organizationId", "schoolYearId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_organizationId_schoolId_id_key" ON "Subject"("organizationId", "schoolId", "id");

-- AddForeignKey
ALTER TABLE "SchoolEvaluation" ADD CONSTRAINT "SchoolEvaluation_organizationId_schoolId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEvaluation" ADD CONSTRAINT "SchoolEvaluation_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEvaluation" ADD CONSTRAINT "SchoolEvaluation_organizationId_classId_groupId_fkey" FOREIGN KEY ("organizationId", "classId", "groupId") REFERENCES "SchoolClassGroup"("organizationId", "classId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEvaluation" ADD CONSTRAINT "SchoolEvaluation_organizationId_schoolId_subjectId_fkey" FOREIGN KEY ("organizationId", "schoolId", "subjectId") REFERENCES "Subject"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEvaluation" ADD CONSTRAINT "SchoolEvaluation_organizationId_schoolYearId_periodId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "periodId") REFERENCES "AcademicPeriod"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolGrade" ADD CONSTRAINT "SchoolGrade_organizationId_evaluationId_fkey" FOREIGN KEY ("organizationId", "evaluationId") REFERENCES "SchoolEvaluation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolGrade" ADD CONSTRAINT "SchoolGrade_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolGradeEvent" ADD CONSTRAINT "SchoolGradeEvent_organizationId_evaluationId_fkey" FOREIGN KEY ("organizationId", "evaluationId") REFERENCES "SchoolEvaluation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolGradeEvent" ADD CONSTRAINT "SchoolGradeEvent_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAppreciation" ADD CONSTRAINT "SchoolAppreciation_organizationId_schoolYearId_periodId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "periodId") REFERENCES "AcademicPeriod"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAppreciation" ADD CONSTRAINT "SchoolAppreciation_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAppreciation" ADD CONSTRAINT "SchoolAppreciation_organizationId_schoolId_subjectId_fkey" FOREIGN KEY ("organizationId", "schoolId", "subjectId") REFERENCES "Subject"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAppreciation" ADD CONSTRAINT "SchoolAppreciation_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolReportComment" ADD CONSTRAINT "SchoolReportComment_organizationId_schoolYearId_periodId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "periodId") REFERENCES "AcademicPeriod"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolReportComment" ADD CONSTRAINT "SchoolReportComment_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolReportComment" ADD CONSTRAINT "SchoolReportComment_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolResultValidation" ADD CONSTRAINT "SchoolResultValidation_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolResultValidation" ADD CONSTRAINT "SchoolResultValidation_organizationId_schoolYearId_periodI_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "periodId") REFERENCES "AcademicPeriod"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolQuranSettings" ADD CONSTRAINT "SchoolQuranSettings_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolQuranSettings" ADD CONSTRAINT "SchoolQuranSettings_organizationId_schoolId_subjectId_fkey" FOREIGN KEY ("organizationId", "schoolId", "subjectId") REFERENCES "Subject"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolQuranProgress" ADD CONSTRAINT "SchoolQuranProgress_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolQuranEvaluation" ADD CONSTRAINT "SchoolQuranEvaluation_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Contraintes métier (Prisma ne sait pas les décrire), garanties par la base même sous accès concurrent.
-- Une note porte une valeur si et seulement si elle est « notée » : absence et dispense ne sont jamais un zéro.
ALTER TABLE "SchoolGrade" ADD CONSTRAINT "SchoolGrade_score_check"
  CHECK ((("status" = 'SCORED') = ("score" IS NOT NULL)) AND ("score" IS NULL OR "score" >= 0));

-- Barème et coefficient strictement positifs.
ALTER TABLE "SchoolEvaluation" ADD CONSTRAINT "SchoolEvaluation_scale_check"
  CHECK ("maxScore" > 0 AND "coefficient" > 0);

-- Numéro de sourate de 1 à 114.
ALTER TABLE "SchoolQuranProgress" ADD CONSTRAINT "SchoolQuranProgress_surah_check"
  CHECK ("surah" BETWEEN 1 AND 114);
ALTER TABLE "SchoolQuranEvaluation" ADD CONSTRAINT "SchoolQuranEvaluation_surah_check"
  CHECK ("surah" BETWEEN 1 AND 114);

-- Une seule validation active par classe et période ; les réouvertures restent dans l'historique.
CREATE UNIQUE INDEX "SchoolResultValidation_active_key" ON "SchoolResultValidation"("classId", "periodId")
  WHERE "unlockedAt" IS NULL;
