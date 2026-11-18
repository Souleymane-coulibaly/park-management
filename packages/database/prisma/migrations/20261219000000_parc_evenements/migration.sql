-- Événements du parc (lots E1 à E4) : migration additive. Nouvelles tables ParkEvent et
-- ParkEventSession, colonnes facultatives ou avec valeur par défaut sur TicketCategory, SaleLine et
-- Ticket. Les tarifs, billets et ventes existants ne changent pas (eventId et eventSessionId nuls,
-- eventScope vide, prénom obligatoire).

-- CreateEnum
CREATE TYPE "ParkEventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ParkEventSessionStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "eventSessionId" UUID;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "eventSessionId" UUID;

-- AlterTable
ALTER TABLE "TicketCategory" ADD COLUMN     "eventId" UUID,
ADD COLUMN     "eventScope" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requiresVisitorName" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sessionQuota" INTEGER;

-- CreateTable
CREATE TABLE "ParkEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "conditions" TEXT NOT NULL DEFAULT '',
    "status" "ParkEventStatus" NOT NULL DEFAULT 'DRAFT',
    "entryOpensBeforeMinutes" INTEGER NOT NULL DEFAULT 60,
    "entryClosesAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "showOnSite" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkEventSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "salesOpen" BOOLEAN NOT NULL DEFAULT true,
    "status" "ParkEventSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkEventSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParkEvent_organizationId_establishmentId_status_idx" ON "ParkEvent"("organizationId", "establishmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ParkEvent_establishmentId_name_key" ON "ParkEvent"("establishmentId", "name");

-- CreateIndex
CREATE INDEX "ParkEventSession_establishmentId_startsAt_idx" ON "ParkEventSession"("establishmentId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParkEventSession_eventId_date_startTime_key" ON "ParkEventSession"("eventId", "date", "startTime");

-- CreateIndex
CREATE INDEX "SaleLine_eventSessionId_idx" ON "SaleLine"("eventSessionId");

-- CreateIndex
CREATE INDEX "Ticket_eventSessionId_status_idx" ON "Ticket"("eventSessionId", "status");

-- CreateIndex
CREATE INDEX "TicketCategory_eventId_idx" ON "TicketCategory"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCategory_establishmentId_eventScope_name_key" ON "TicketCategory"("establishmentId", "eventScope", "name");

-- Unicité du nom par portée : le nouvel index (portée '' pour tous les tarifs existants) est créé
-- avant la suppression de l'ancien ; aucune donnée n'est modifiée.
DROP INDEX "TicketCategory_establishmentId_name_key";

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "ParkEventSession"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ParkEvent"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "ParkEventSession"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkEvent" ADD CONSTRAINT "ParkEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkEvent" ADD CONSTRAINT "ParkEvent_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkEventSession" ADD CONSTRAINT "ParkEventSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkEventSession" ADD CONSTRAINT "ParkEventSession_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkEventSession" ADD CONSTRAINT "ParkEventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ParkEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contrôles d'intégrité (hors modèle Prisma)
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_eventScope_check"
  CHECK (("eventId" IS NULL AND "eventScope" = '') OR ("eventId" IS NOT NULL AND "eventScope" = "eventId"::text));
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_sessionQuota_check"
  CHECK ("sessionQuota" IS NULL OR "sessionQuota" > 0);
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_requiresVisitorName_check"
  CHECK ("requiresVisitorName" OR "eventId" IS NOT NULL);
ALTER TABLE "ParkEventSession" ADD CONSTRAINT "ParkEventSession_capacity_check" CHECK ("capacity" > 0);
ALTER TABLE "ParkEventSession" ADD CONSTRAINT "ParkEventSession_window_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "ParkEvent" ADD CONSTRAINT "ParkEvent_tolerance_check"
  CHECK ("entryOpensBeforeMinutes" BETWEEN 0 AND 720 AND "entryClosesAfterMinutes" BETWEEN 0 AND 720);
