-- CreateEnum
CREATE TYPE "PrinterConnection" AS ENUM ('NONE', 'SIMULATED', 'NETWORK', 'BLUETOOTH', 'USB');

-- CreateEnum
CREATE TYPE "PrintJobKind" AS ENUM ('RECEIPT', 'REPRINT', 'TEST');

-- CreateEnum
CREATE TYPE "HardwareJobStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DrawerOpenReason" AS ENUM ('CASH_PAYMENT', 'MANUAL');

-- CreateTable
CREATE TABLE "PosTerminal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "printerConnection" "PrinterConnection" NOT NULL DEFAULT 'NONE',
    "printerAddress" TEXT,
    "paperWidth" INTEGER NOT NULL DEFAULT 80,
    "autoPrintReceipt" BOOLEAN NOT NULL DEFAULT true,
    "drawerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "drawerPin" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "terminalId" UUID NOT NULL,
    "saleId" UUID,
    "kind" "PrintJobKind" NOT NULL,
    "status" "HardwareJobStatus" NOT NULL DEFAULT 'PENDING',
    "paperWidth" INTEGER NOT NULL,
    "reason" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedById" UUID NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawerEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "terminalId" UUID NOT NULL,
    "reason" "DrawerOpenReason" NOT NULL,
    "paymentId" UUID,
    "justification" TEXT,
    "status" "HardwareJobStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedById" UUID NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DrawerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosTerminal_organizationId_establishmentId_idx" ON "PosTerminal"("organizationId", "establishmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PosTerminal_establishmentId_name_key" ON "PosTerminal"("establishmentId", "name");

-- CreateIndex
CREATE INDEX "PrintJob_saleId_idx" ON "PrintJob"("saleId");

-- CreateIndex
CREATE INDEX "PrintJob_terminalId_createdAt_idx" ON "PrintJob"("terminalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_organizationId_clientRequestId_key" ON "PrintJob"("organizationId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawerEvent_paymentId_key" ON "DrawerEvent"("paymentId");

-- CreateIndex
CREATE INDEX "DrawerEvent_terminalId_createdAt_idx" ON "DrawerEvent"("terminalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DrawerEvent_organizationId_clientRequestId_key" ON "DrawerEvent"("organizationId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "PosTerminal" ADD CONSTRAINT "PosTerminal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTerminal" ADD CONSTRAINT "PosTerminal_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PosTerminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawerEvent" ADD CONSTRAINT "DrawerEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawerEvent" ADD CONSTRAINT "DrawerEvent_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawerEvent" ADD CONSTRAINT "DrawerEvent_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PosTerminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawerEvent" ADD CONSTRAINT "DrawerEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawerEvent" ADD CONSTRAINT "DrawerEvent_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "OrganizationMembership"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

