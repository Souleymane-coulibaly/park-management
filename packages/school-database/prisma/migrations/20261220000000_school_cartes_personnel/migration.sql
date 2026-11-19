-- Ocall School × Ocall Print (lot SC-1) : fiches du personnel avec ou sans compte (gardiens, cuisine,
-- administration, enseignants), photo de carte désignée de l'élève, lien de reprise d'une fiche Ocall Print
-- autonome. Migration additive : nouvelles colonnes facultatives, nouvelle table ; aucune donnée modifiée.

-- CreateEnum
CREATE TYPE "SchoolStaffCategory" AS ENUM ('TEACHING', 'ADMINISTRATION', 'SECURITY', 'CATERING', 'MAINTENANCE', 'TRANSPORT', 'HEALTH', 'OTHER');

-- AlterTable
ALTER TABLE "SchoolStudent" ADD COLUMN     "cardPhotoDocumentId" UUID,
ADD COLUMN     "printPersonId" UUID;

-- CreateTable
CREATE TABLE "SchoolStaff" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "memberId" UUID,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastNameAr" TEXT,
    "firstNameAr" TEXT,
    "category" "SchoolStaffCategory" NOT NULL,
    "jobTitle" TEXT,
    "staffNumber" TEXT NOT NULL,
    "phone" TEXT,
    "photoKey" TEXT,
    "photoSha" CHAR(64),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "printPersonId" UUID,
    "searchText" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolStaff_organizationId_schoolId_isActive_idx" ON "SchoolStaff"("organizationId", "schoolId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolStaff_organizationId_id_key" ON "SchoolStaff"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolStaff_organizationId_staffNumber_key" ON "SchoolStaff"("organizationId", "staffNumber");

-- AddForeignKey
ALTER TABLE "SchoolStaff" ADD CONSTRAINT "SchoolStaff_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStaff" ADD CONSTRAINT "SchoolStaff_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "SchoolMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Contrôles écrits à la main ───

-- Un compte School n'est rattaché qu'à une seule fiche du personnel.
CREATE UNIQUE INDEX "SchoolStaff_member_unique"
  ON "SchoolStaff" ("organizationId", "memberId")
  WHERE "memberId" IS NOT NULL;

-- Une fiche Ocall Print autonome n'est reprise qu'une fois (élève ou personnel) : une reprise rejouée
-- retrouve la fiche déjà créée, jamais un doublon.
CREATE UNIQUE INDEX "SchoolStaff_print_person_unique"
  ON "SchoolStaff" ("organizationId", "printPersonId")
  WHERE "printPersonId" IS NOT NULL;

CREATE UNIQUE INDEX "SchoolStudent_print_person_unique"
  ON "SchoolStudent" ("organizationId", "printPersonId")
  WHERE "printPersonId" IS NOT NULL;
