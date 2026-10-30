-- Sprint 10 — sites vitrines publics (brouillon / publié, médias, domaines personnalisés) et frais
-- de mise en service des offres SaaS. Additive : nouvelles tables et colonne avec valeur par défaut.

-- CreateEnum
CREATE TYPE "SiteTheme" AS ENUM ('CLASSIC', 'MODERN', 'WARM');

-- CreateEnum
CREATE TYPE "SiteMediaKind" AS ENUM ('LOGO', 'COVER', 'GALLERY');

-- CreateEnum
CREATE TYPE "SiteDomainStatus" AS ENUM ('PENDING', 'VERIFYING', 'VERIFIED', 'ACTIVE', 'ERROR');

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "setupFee" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PublicSite" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "theme" "SiteTheme" NOT NULL DEFAULT 'CLASSIC',
    "primaryColor" CHAR(7) NOT NULL DEFAULT '#176B53',
    "draft" JSONB NOT NULL,
    "draftUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSiteMedia" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "kind" "SiteMediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicSiteMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSiteDomain" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "SiteDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicSiteDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicSite_establishmentId_key" ON "PublicSite"("establishmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSite_slug_key" ON "PublicSite"("slug");

-- CreateIndex
CREATE INDEX "PublicSite_organizationId_idx" ON "PublicSite"("organizationId");

-- CreateIndex
CREATE INDEX "PublicSite_isOnline_idx" ON "PublicSite"("isOnline");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSiteMedia_storageKey_key" ON "PublicSiteMedia"("storageKey");

-- CreateIndex
CREATE INDEX "PublicSiteMedia_siteId_idx" ON "PublicSiteMedia"("siteId");

-- CreateIndex
CREATE INDEX "PublicSiteMedia_organizationId_idx" ON "PublicSiteMedia"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSiteDomain_hostname_key" ON "PublicSiteDomain"("hostname");

-- CreateIndex
CREATE INDEX "PublicSiteDomain_siteId_idx" ON "PublicSiteDomain"("siteId");

-- CreateIndex
CREATE INDEX "PublicSiteDomain_status_idx" ON "PublicSiteDomain"("status");

-- AddForeignKey
ALTER TABLE "PublicSite" ADD CONSTRAINT "PublicSite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSite" ADD CONSTRAINT "PublicSite_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSiteMedia" ADD CONSTRAINT "PublicSiteMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSiteMedia" ADD CONSTRAINT "PublicSiteMedia_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PublicSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSiteDomain" ADD CONSTRAINT "PublicSiteDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSiteDomain" ADD CONSTRAINT "PublicSiteDomain_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PublicSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contrôles d'intégrité (ajoutés à la main).
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_setupFee_check" CHECK ("setupFee" >= 0);
ALTER TABLE "PublicSite" ADD CONSTRAINT "PublicSite_primaryColor_check" CHECK ("primaryColor" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "PublicSiteMedia" ADD CONSTRAINT "PublicSiteMedia_size_check" CHECK ("bytes" > 0 AND "width" > 0 AND "height" > 0);

-- Tarifs SaaS décidés par le commanditaire le 30/10/2026 (seule modification de lignes existantes :
-- les 3 offres). Paiements entièrement manuels, hors plateforme.
UPDATE "SubscriptionPlan" SET "monthlyPrice" = 15000, "setupFee" = 250000, "updatedAt" = CURRENT_TIMESTAMP WHERE "businessType" = 'RESTAURANT';
UPDATE "SubscriptionPlan" SET "monthlyPrice" = 15000, "setupFee" = 250000, "updatedAt" = CURRENT_TIMESTAMP WHERE "businessType" = 'PARK';
UPDATE "SubscriptionPlan" SET "monthlyPrice" = 25000, "setupFee" = 350000, "updatedAt" = CURRENT_TIMESTAMP WHERE "businessType" = 'PARK_RESTAURANT';
