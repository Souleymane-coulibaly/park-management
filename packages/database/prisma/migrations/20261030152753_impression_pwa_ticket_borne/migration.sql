-- AlterEnum
ALTER TYPE "PrintJobKind" ADD VALUE 'KIOSK_TICKET';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PrinterConnection" ADD VALUE 'WEBUSB';
ALTER TYPE "PrinterConnection" ADD VALUE 'WEBBLUETOOTH';

-- AlterTable
ALTER TABLE "KioskDevice" ADD COLUMN     "printerTerminalId" UUID;

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "kioskDeviceId" UUID,
ALTER COLUMN "requestedById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_kioskDeviceId_fkey" FOREIGN KEY ("kioskDeviceId") REFERENCES "KioskDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_printerTerminalId_fkey" FOREIGN KEY ("printerTerminalId") REFERENCES "PosTerminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

