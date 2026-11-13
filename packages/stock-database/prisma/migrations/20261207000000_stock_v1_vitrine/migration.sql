-- Ocall Stock V1 — S7 : site vitrine. Migration additive : choix « publier sur la vitrine » par article
-- (faux par défaut : rien n'est public sans décision), vitrine, images, domaines, demandes des visiteurs.

-- CreateEnum
CREATE TYPE "StockShowcaseMediaKind" AS ENUM ('LOGO', 'COVER', 'GALLERY');

-- CreateEnum
CREATE TYPE "StockShowcaseDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'ERROR', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StockShowcaseRequestKind" AS ENUM ('CONTACT', 'QUOTE');

-- CreateEnum
CREATE TYPE "StockShowcaseRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'SPAM');

-- AlterTable
ALTER TABLE "StockProduct" ADD COLUMN     "showcasePublished" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "StockShowcase" (
    "organizationId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockShowcase_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "StockShowcaseMedia" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "StockShowcaseMediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockShowcaseMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockShowcaseDomain" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "StockShowcaseDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockShowcaseDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockShowcaseRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "StockShowcaseRequestKind" NOT NULL,
    "status" "StockShowcaseRequestStatus" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "handledByUserId" UUID,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockShowcaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockShowcase_slug_key" ON "StockShowcase"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StockShowcaseMedia_storageKey_key" ON "StockShowcaseMedia"("storageKey");

-- CreateIndex
CREATE INDEX "StockShowcaseMedia_organizationId_kind_position_idx" ON "StockShowcaseMedia"("organizationId", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StockShowcaseMedia_organizationId_id_key" ON "StockShowcaseMedia"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockShowcaseDomain_hostname_key" ON "StockShowcaseDomain"("hostname");

-- CreateIndex
CREATE INDEX "StockShowcaseDomain_organizationId_idx" ON "StockShowcaseDomain"("organizationId");

-- CreateIndex
CREATE INDEX "StockShowcaseDomain_status_idx" ON "StockShowcaseDomain"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockShowcaseDomain_organizationId_id_key" ON "StockShowcaseDomain"("organizationId", "id");

-- CreateIndex
CREATE INDEX "StockShowcaseRequest_organizationId_status_createdAt_idx" ON "StockShowcaseRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockShowcaseRequest_organizationId_id_key" ON "StockShowcaseRequest"("organizationId", "id");

-- ─── Garanties et index écrits à la main ───

ALTER TABLE "StockShowcase"
  ADD CONSTRAINT "StockShowcase_slug_check" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  ADD CONSTRAINT "StockShowcase_online_check"
    CHECK (NOT "isOnline" OR ("published" IS NOT NULL AND "publishedAt" IS NOT NULL));

ALTER TABLE "StockShowcaseDomain"
  ADD CONSTRAINT "StockShowcaseDomain_hostname_check"
    CHECK ("hostname" = lower("hostname") AND length("hostname") <= 253),
  ADD CONSTRAINT "StockShowcaseDomain_active_check"
    CHECK (("status" = 'ACTIVE') = ("activatedAt" IS NOT NULL));

ALTER TABLE "StockShowcaseRequest"
  ADD CONSTRAINT "StockShowcaseRequest_contact_check" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL),
  ADD CONSTRAINT "StockShowcaseRequest_lengths_check"
    CHECK (length("name") BETWEEN 2 AND 120 AND length("message") BETWEEN 5 AND 2000),
  ADD CONSTRAINT "StockShowcaseRequest_items_check"
    CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") <= 20);

-- Catalogue public : seuls les articles publiés sont lus.
CREATE INDEX "StockProduct_showcase_idx" ON "StockProduct"("organizationId", "name")
  WHERE "showcasePublished" AND NOT "isArchived";
