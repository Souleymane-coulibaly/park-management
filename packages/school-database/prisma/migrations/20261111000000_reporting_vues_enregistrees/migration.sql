-- Sprint 8 : vues de reporting enregistrées (strictement additive).
-- CreateTable
CREATE TABLE "SchoolReportView" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolReportView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolReportView_organizationId_ownerUserId_schoolId_idx" ON "SchoolReportView"("organizationId", "ownerUserId", "schoolId");

-- AddForeignKey
ALTER TABLE "SchoolReportView" ADD CONSTRAINT "SchoolReportView_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes écrites à la main : type de rapport connu, nom non vide et court, filtres en objet JSON.
ALTER TABLE "SchoolReportView" ADD CONSTRAINT "SchoolReportView_kind_check"
  CHECK ("kind" IN ('overview', 'pedagogy', 'attendance', 'finance'));
ALTER TABLE "SchoolReportView" ADD CONSTRAINT "SchoolReportView_name_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 80);
ALTER TABLE "SchoolReportView" ADD CONSTRAINT "SchoolReportView_filters_check"
  CHECK (jsonb_typeof("filters") = 'object');
