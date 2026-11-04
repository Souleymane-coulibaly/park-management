-- AlterTable
ALTER TABLE "SchoolClass" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SchoolMember" ADD COLUMN     "firstNameAr" TEXT,
ADD COLUMN     "lastNameAr" TEXT;

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "catalogKey" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SubjectLevel" (
    "organizationId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "coefficient" DECIMAL(5,2),
    "weeklyHours" DECIMAL(4,1),

    CONSTRAINT "SubjectLevel_pkey" PRIMARY KEY ("subjectId","levelId")
);

-- CreateTable
CREATE TABLE "SchoolClassGroup" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClassGroupStudent" (
    "organizationId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClassGroupStudent_pkey" PRIMARY KEY ("groupId","studentId")
);

-- CreateTable
CREATE TABLE "SchoolTeacherSubject" (
    "organizationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,

    CONSTRAINT "SchoolTeacherSubject_pkey" PRIMARY KEY ("memberId","subjectId")
);

-- CreateTable
CREATE TABLE "SchoolTeachingAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "groupId" UUID,
    "memberId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "isHomeroom" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdByUserId" UUID NOT NULL,
    "endedByUserId" UUID,

    CONSTRAINT "SchoolTeachingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubjectLevel_organizationId_levelId_idx" ON "SubjectLevel"("organizationId", "levelId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClassGroup_organizationId_id_key" ON "SchoolClassGroup"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClassGroup_organizationId_classId_id_key" ON "SchoolClassGroup"("organizationId", "classId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClassGroup_classId_name_key" ON "SchoolClassGroup"("classId", "name");

-- CreateIndex
CREATE INDEX "SchoolClassGroupStudent_organizationId_studentId_idx" ON "SchoolClassGroupStudent"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "SchoolTeacherSubject_organizationId_subjectId_idx" ON "SchoolTeacherSubject"("organizationId", "subjectId");

-- CreateIndex
CREATE INDEX "SchoolTeachingAssignment_organizationId_classId_endedAt_idx" ON "SchoolTeachingAssignment"("organizationId", "classId", "endedAt");

-- CreateIndex
CREATE INDEX "SchoolTeachingAssignment_organizationId_memberId_endedAt_idx" ON "SchoolTeachingAssignment"("organizationId", "memberId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_organizationId_id_key" ON "Subject"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_schoolId_catalogKey_key" ON "Subject"("schoolId", "catalogKey");

-- AddForeignKey
ALTER TABLE "SubjectLevel" ADD CONSTRAINT "SubjectLevel_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "Subject"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectLevel" ADD CONSTRAINT "SubjectLevel_organizationId_levelId_fkey" FOREIGN KEY ("organizationId", "levelId") REFERENCES "Level"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassGroup" ADD CONSTRAINT "SchoolClassGroup_organizationId_classId_fkey" FOREIGN KEY ("organizationId", "classId") REFERENCES "SchoolClass"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassGroupStudent" ADD CONSTRAINT "SchoolClassGroupStudent_organizationId_groupId_fkey" FOREIGN KEY ("organizationId", "groupId") REFERENCES "SchoolClassGroup"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClassGroupStudent" ADD CONSTRAINT "SchoolClassGroupStudent_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTeacherSubject" ADD CONSTRAINT "SchoolTeacherSubject_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTeacherSubject" ADD CONSTRAINT "SchoolTeacherSubject_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "Subject"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTeachingAssignment" ADD CONSTRAINT "SchoolTeachingAssignment_organizationId_classId_fkey" FOREIGN KEY ("organizationId", "classId") REFERENCES "SchoolClass"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTeachingAssignment" ADD CONSTRAINT "SchoolTeachingAssignment_organizationId_classId_groupId_fkey" FOREIGN KEY ("organizationId", "classId", "groupId") REFERENCES "SchoolClassGroup"("organizationId", "classId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTeachingAssignment" ADD CONSTRAINT "SchoolTeachingAssignment_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTeachingAssignment" ADD CONSTRAINT "SchoolTeachingAssignment_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "Subject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Index partiels (Prisma ne sait pas les décrire) : règles métier garanties par la base, y compris
-- sous accès concurrent.
-- Un seul enseignant actif par classe, groupe (ou classe entière) et matière.
CREATE UNIQUE INDEX "SchoolTeachingAssignment_active_slot_key" ON "SchoolTeachingAssignment"(
  "classId",
  COALESCE("groupId", '00000000-0000-0000-0000-000000000000'::uuid),
  "subjectId"
) WHERE "endedAt" IS NULL;

-- Un seul professeur principal actif par classe.
CREATE UNIQUE INDEX "SchoolTeachingAssignment_active_homeroom_key" ON "SchoolTeachingAssignment"("classId")
  WHERE "isHomeroom" AND "endedAt" IS NULL;
