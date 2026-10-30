-- CreateEnum
CREATE TYPE "SaleActivity" AS ENUM ('RESTAURANT', 'PARK');

-- CreateEnum
CREATE TYPE "TicketKind" AS ENUM ('ADULT', 'CHILD', 'FAMILY', 'GROUP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketScanResult" AS ENUM ('ACCEPTED', 'REFUSED');

-- CreateEnum
CREATE TYPE "TicketScanRefusal" AS ENUM ('ALREADY_USED', 'EXPIRED', 'CANCELLED', 'UNKNOWN', 'OTHER_ESTABLISHMENT', 'PARK_CLOSED', 'NOT_YET_VALID');

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "ticketId" UUID;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "activity" "SaleActivity" NOT NULL DEFAULT 'RESTAURANT';

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "peoplePerUnit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ticketCategoryId" UUID,
ADD COLUMN     "visitorNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "variantId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TicketCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "kind" "TicketKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "peopleIncluded" INTEGER NOT NULL DEFAULT 1,
    "conditions" TEXT,
    "availableFrom" DATE,
    "availableUntil" DATE,
    "validityDays" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "saleLineId" UUID NOT NULL,
    "ticketCategoryId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "visitorName" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "pricePaid" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketScan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "ticketId" UUID,
    "acceptedForTicketId" UUID,
    "result" "TicketScanResult" NOT NULL,
    "refusalReason" "TicketScanRefusal",
    "entryPoint" TEXT NOT NULL,
    "scannedById" UUID NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkOpeningSchedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TEXT,
    "closesAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkOpeningSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkCalendarException" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TEXT,
    "closesAt" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkCalendarException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketCategory_organizationId_establishmentId_isActive_idx" ON "TicketCategory"("organizationId", "establishmentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCategory_establishmentId_name_key" ON "TicketCategory"("establishmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_token_key" ON "Ticket"("token");

-- CreateIndex
CREATE INDEX "Ticket_organizationId_establishmentId_createdAt_idx" ON "Ticket"("organizationId", "establishmentId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_saleId_idx" ON "Ticket"("saleId");

-- CreateIndex
CREATE INDEX "Ticket_establishmentId_status_validUntil_idx" ON "Ticket"("establishmentId", "status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_saleLineId_position_key" ON "Ticket"("saleLineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TicketScan_acceptedForTicketId_key" ON "TicketScan"("acceptedForTicketId");

-- CreateIndex
CREATE INDEX "TicketScan_establishmentId_createdAt_idx" ON "TicketScan"("establishmentId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketScan_ticketId_idx" ON "TicketScan"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketScan_organizationId_clientRequestId_key" ON "TicketScan"("organizationId", "clientRequestId");

-- CreateIndex
CREATE INDEX "ParkOpeningSchedule_organizationId_idx" ON "ParkOpeningSchedule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkOpeningSchedule_establishmentId_weekday_key" ON "ParkOpeningSchedule"("establishmentId", "weekday");

-- CreateIndex
CREATE INDEX "ParkCalendarException_organizationId_idx" ON "ParkCalendarException"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkCalendarException_establishmentId_date_key" ON "ParkCalendarException"("establishmentId", "date");

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_ticketCategoryId_fkey" FOREIGN KEY ("ticketCategoryId") REFERENCES "TicketCategory"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ticketCategoryId_fkey" FOREIGN KEY ("ticketCategoryId") REFERENCES "TicketCategory"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_acceptedForTicketId_fkey" FOREIGN KEY ("acceptedForTicketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkOpeningSchedule" ADD CONSTRAINT "ParkOpeningSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkOpeningSchedule" ADD CONSTRAINT "ParkOpeningSchedule_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkCalendarException" ADD CONSTRAINT "ParkCalendarException_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkCalendarException" ADD CONSTRAINT "ParkCalendarException_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

