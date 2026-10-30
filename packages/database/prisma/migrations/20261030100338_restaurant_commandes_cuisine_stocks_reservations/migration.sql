-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('DINE_IN', 'TAKEAWAY', 'COUNTER', 'QR');

-- CreateEnum
CREATE TYPE "DiningZoneKind" AS ENUM ('ROOM', 'TERRACE', 'POOLSIDE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QrOrderStatus" AS ENUM ('PENDING_VALIDATION', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StockUnit" AS ENUM ('UNIT', 'G', 'KG', 'ML', 'CL', 'L');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('IN', 'OUT', 'ADJUSTMENT', 'SALE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- AlterEnum
ALTER TYPE "PreparationStatus" ADD VALUE 'IN_PREPARATION';

-- AlterEnum
ALTER TYPE "PrintJobKind" ADD VALUE 'KITCHEN';

-- AlterTable
ALTER TABLE "PosTerminal" ADD COLUMN     "kitchenPrinter" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "channel" "OrderChannel",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "preparationStartedAt" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "sentToKitchenAt" TIMESTAMP(3),
ADD COLUMN     "servedAt" TIMESTAMP(3),
ADD COLUMN     "stockDeductedAt" TIMESTAMP(3),
ADD COLUMN     "tableId" UUID,
ADD COLUMN     "zoneId" UUID;

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "PreparationStatus",
    "toStatus" "PreparationStatus",
    "actorMembershipId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiningZone" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DiningZoneKind" NOT NULL DEFAULT 'ROOM',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "qrToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiningZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiningTable" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "zoneId" UUID,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "qrToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrOrderRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "tableId" UUID,
    "zoneId" UUID,
    "publicToken" TEXT NOT NULL,
    "status" "QrOrderStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "customerName" TEXT,
    "notes" TEXT,
    "lines" JSONB NOT NULL,
    "estimatedTotal" INTEGER NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "rejectedReason" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "saleId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrOrderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "StockUnit" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "alertThreshold" DECIMAL(14,3),
    "unitCost" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "quantityAfter" DECIMAL(14,3) NOT NULL,
    "unitCost" INTEGER,
    "reason" TEXT,
    "saleId" UUID,
    "actorMembershipId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeComponent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "tableId" UUID,
    "zoneId" UUID,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "partySize" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderEvent_saleId_createdAt_idx" ON "OrderEvent"("saleId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_organizationId_createdAt_idx" ON "OrderEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiningZone_qrToken_key" ON "DiningZone"("qrToken");

-- CreateIndex
CREATE INDEX "DiningZone_organizationId_idx" ON "DiningZone"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningZone_establishmentId_name_key" ON "DiningZone"("establishmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_qrToken_key" ON "DiningTable"("qrToken");

-- CreateIndex
CREATE INDEX "DiningTable_organizationId_idx" ON "DiningTable"("organizationId");

-- CreateIndex
CREATE INDEX "DiningTable_zoneId_idx" ON "DiningTable"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_establishmentId_name_key" ON "DiningTable"("establishmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "QrOrderRequest_publicToken_key" ON "QrOrderRequest"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "QrOrderRequest_saleId_key" ON "QrOrderRequest"("saleId");

-- CreateIndex
CREATE INDEX "QrOrderRequest_establishmentId_status_createdAt_idx" ON "QrOrderRequest"("establishmentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QrOrderRequest_tableId_status_idx" ON "QrOrderRequest"("tableId", "status");

-- CreateIndex
CREATE INDEX "QrOrderRequest_zoneId_status_idx" ON "QrOrderRequest"("zoneId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QrOrderRequest_establishmentId_clientRequestId_key" ON "QrOrderRequest"("establishmentId", "clientRequestId");

-- CreateIndex
CREATE INDEX "StockItem_organizationId_establishmentId_isActive_idx" ON "StockItem"("organizationId", "establishmentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_establishmentId_name_key" ON "StockItem"("establishmentId", "name");

-- CreateIndex
CREATE INDEX "StockMovement_stockItemId_createdAt_idx" ON "StockMovement"("stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_saleId_idx" ON "StockMovement"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_organizationId_idempotencyKey_key" ON "StockMovement"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RecipeComponent_organizationId_idx" ON "RecipeComponent"("organizationId");

-- CreateIndex
CREATE INDEX "RecipeComponent_stockItemId_idx" ON "RecipeComponent"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeComponent_variantId_stockItemId_key" ON "RecipeComponent"("variantId", "stockItemId");

-- CreateIndex
CREATE INDEX "Reservation_establishmentId_startsAt_idx" ON "Reservation"("establishmentId", "startsAt");

-- CreateIndex
CREATE INDEX "Reservation_tableId_startsAt_idx" ON "Reservation"("tableId", "startsAt");

-- CreateIndex
CREATE INDEX "Sale_establishmentId_preparationStatus_idx" ON "Sale"("establishmentId", "preparationStatus");

-- CreateIndex
CREATE INDEX "Sale_tableId_idx" ON "Sale"("tableId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DiningZone"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningZone" ADD CONSTRAINT "DiningZone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningZone" ADD CONSTRAINT "DiningZone_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DiningZone"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DiningZone"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrOrderRequest" ADD CONSTRAINT "QrOrderRequest_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeComponent" ADD CONSTRAINT "RecipeComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeComponent" ADD CONSTRAINT "RecipeComponent_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeComponent" ADD CONSTRAINT "RecipeComponent_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DiningZone"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

