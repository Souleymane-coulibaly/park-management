-- CreateEnum
CREATE TYPE "FactureSiteMediaKind" AS ENUM ('LOGO', 'COVER', 'GALLERY');

-- CreateEnum
CREATE TYPE "FactureSiteDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'ERROR', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "FactureRequestKind" AS ENUM ('CONTACT', 'QUOTE', 'INTERVENTION', 'APPOINTMENT');

-- CreateEnum
CREATE TYPE "FactureRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'SPAM');

-- CreateTable
CREATE TABLE "FactureSite" (
    "organizationId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureSite_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "FactureSiteMedia" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "FactureSiteMediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureSiteMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureSiteDomain" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "FactureSiteDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureSiteDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "FactureRequestKind" NOT NULL,
    "status" "FactureRequestStatus" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT NOT NULL,
    "serviceLabel" TEXT,
    "preferredDate" DATE,
    "handledByUserId" UUID,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FactureSite_slug_key" ON "FactureSite"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FactureSiteMedia_storageKey_key" ON "FactureSiteMedia"("storageKey");

-- CreateIndex
CREATE INDEX "FactureSiteMedia_organizationId_kind_position_idx" ON "FactureSiteMedia"("organizationId", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "FactureSiteMedia_organizationId_id_key" ON "FactureSiteMedia"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureSiteDomain_hostname_key" ON "FactureSiteDomain"("hostname");

-- CreateIndex
CREATE INDEX "FactureSiteDomain_organizationId_idx" ON "FactureSiteDomain"("organizationId");

-- CreateIndex
CREATE INDEX "FactureSiteDomain_status_idx" ON "FactureSiteDomain"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FactureSiteDomain_organizationId_id_key" ON "FactureSiteDomain"("organizationId", "id");

-- CreateIndex
CREATE INDEX "FactureRequest_organizationId_status_createdAt_idx" ON "FactureRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactureRequest_organizationId_id_key" ON "FactureRequest"("organizationId", "id");


-- ─── Contrôles métier (en plus de la validation de l'API) ───

ALTER TABLE "FactureSite"
  ADD CONSTRAINT "FactureSite_slug_check" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  ADD CONSTRAINT "FactureSite_online_check" CHECK (NOT "isOnline" OR ("published" IS NOT NULL AND "publishedAt" IS NOT NULL));

ALTER TABLE "FactureSiteDomain"
  ADD CONSTRAINT "FactureSiteDomain_hostname_check" CHECK ("hostname" = lower("hostname") AND length("hostname") <= 253),
  ADD CONSTRAINT "FactureSiteDomain_active_check" CHECK (("status" = 'ACTIVE') = ("activatedAt" IS NOT NULL));

ALTER TABLE "FactureRequest"
  ADD CONSTRAINT "FactureRequest_contact_check" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL),
  ADD CONSTRAINT "FactureRequest_lengths_check" CHECK (length("name") BETWEEN 2 AND 120 AND length("message") BETWEEN 5 AND 2000);
