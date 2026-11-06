-- Sprint 10 : sites vitrines publics des établissements (migration additive : 4 tables, aucune
-- modification ni suppression de table existante).
-- CreateTable
CREATE TABLE "SchoolSite" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "languages" TEXT[] DEFAULT ARRAY['fr']::TEXT[],
    "defaultLanguage" TEXT NOT NULL DEFAULT 'fr',
    "theme" TEXT NOT NULL DEFAULT 'CLASSIC',
    "primaryColor" CHAR(7) NOT NULL DEFAULT '#176B53',
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSiteMedia" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "altAr" TEXT NOT NULL DEFAULT '',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "containsMinors" BOOLEAN NOT NULL DEFAULT false,
    "consentReference" TEXT,
    "consentAttestedByUserId" UUID,
    "consentAttestedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnByUserId" UUID,
    "withdrawalReason" TEXT,
    "uploadState" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolSiteMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSiteNews" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL DEFAULT '',
    "publishedOn" DATE NOT NULL,
    "mediaId" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSiteNews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSiteLink" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSiteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSite_schoolId_key" ON "SchoolSite"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSite_slug_key" ON "SchoolSite"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSite_organizationId_id_key" ON "SchoolSite"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSite_organizationId_schoolId_key" ON "SchoolSite"("organizationId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSiteMedia_storageKey_key" ON "SchoolSiteMedia"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSiteMedia_thumbKey_key" ON "SchoolSiteMedia"("thumbKey");

-- CreateIndex
CREATE INDEX "SchoolSiteMedia_organizationId_siteId_createdAt_idx" ON "SchoolSiteMedia"("organizationId", "siteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSiteMedia_organizationId_id_key" ON "SchoolSiteMedia"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolSiteNews_organizationId_siteId_status_publishedOn_idx" ON "SchoolSiteNews"("organizationId", "siteId", "status", "publishedOn");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSiteNews_siteId_slug_key" ON "SchoolSiteNews"("siteId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSiteNews_organizationId_id_key" ON "SchoolSiteNews"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolSiteLink_organizationId_siteId_position_idx" ON "SchoolSiteLink"("organizationId", "siteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSiteLink_organizationId_id_key" ON "SchoolSiteLink"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "SchoolSite" ADD CONSTRAINT "SchoolSite_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolSiteMedia" ADD CONSTRAINT "SchoolSiteMedia_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "SchoolSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolSiteNews" ADD CONSTRAINT "SchoolSiteNews_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "SchoolSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolSiteLink" ADD CONSTRAINT "SchoolSiteLink_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "SchoolSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

