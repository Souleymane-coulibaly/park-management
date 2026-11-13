-- Ocall Stock V1 — achats (S3) : commandes fournisseurs, réceptions (entrées en stock, annulation par
-- mouvements compensatoires), retours fournisseurs, historique des prix d'achat, documents joints.
-- Migration additive : aucune donnée existante n'est modifiée.

-- CreateEnum
CREATE TYPE "StockPurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockReceiptStatus" AS ENUM ('VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockDocumentOwner" AS ENUM ('PURCHASE_ORDER', 'RECEIPT', 'SUPPLIER_RETURN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockCounterKind" ADD VALUE 'PURCHASE';
ALTER TYPE "StockCounterKind" ADD VALUE 'RECEIPT';
ALTER TYPE "StockCounterKind" ADD VALUE 'SUPPLIER_RETURN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementKind" ADD VALUE 'RECEIPT';
ALTER TYPE "StockMovementKind" ADD VALUE 'RECEIPT_CANCEL';
ALTER TYPE "StockMovementKind" ADD VALUE 'SUPPLIER_RETURN';

-- CreateTable
CREATE TABLE "StockPurchaseOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "supplierId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "status" "StockPurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAt" DATE,
    "note" TEXT,
    "createdByUserId" UUID NOT NULL,
    "orderedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPurchaseLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "receivedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "StockPurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "orderId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "status" "StockReceiptStatus" NOT NULL DEFAULT 'VALIDATED',
    "deliveryRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "receivedByUserId" UUID NOT NULL,
    "cancelReason" TEXT,
    "cancelledByUserId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceiptLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" INTEGER NOT NULL,

    CONSTRAINT "StockReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSupplierReturn" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "supplierId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "orderId" UUID,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSupplierReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSupplierReturnLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "StockSupplierReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSupplierPrice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "receiptId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSupplierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocument" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ownerType" "StockDocumentOwner" NOT NULL,
    "ownerId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockPurchaseOrder_organizationId_status_idx" ON "StockPurchaseOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StockPurchaseOrder_organizationId_supplierId_idx" ON "StockPurchaseOrder"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "StockPurchaseOrder_organizationId_id_key" ON "StockPurchaseOrder"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockPurchaseOrder_organizationId_number_key" ON "StockPurchaseOrder"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StockPurchaseLine_organizationId_variantId_idx" ON "StockPurchaseLine"("organizationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockPurchaseLine_organizationId_id_key" ON "StockPurchaseLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockPurchaseLine_orderId_variantId_key" ON "StockPurchaseLine"("orderId", "variantId");

-- CreateIndex
CREATE INDEX "StockReceipt_organizationId_orderId_idx" ON "StockReceipt"("organizationId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_organizationId_id_key" ON "StockReceipt"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_organizationId_number_key" ON "StockReceipt"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_organizationId_idempotencyKey_key" ON "StockReceipt"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceiptLine_organizationId_id_key" ON "StockReceiptLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceiptLine_receiptId_orderLineId_key" ON "StockReceiptLine"("receiptId", "orderLineId");

-- CreateIndex
CREATE INDEX "StockSupplierReturn_organizationId_supplierId_idx" ON "StockSupplierReturn"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "StockSupplierReturn_organizationId_id_key" ON "StockSupplierReturn"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockSupplierReturn_organizationId_number_key" ON "StockSupplierReturn"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockSupplierReturn_organizationId_idempotencyKey_key" ON "StockSupplierReturn"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockSupplierReturnLine_organizationId_id_key" ON "StockSupplierReturnLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockSupplierReturnLine_returnId_variantId_locationId_key" ON "StockSupplierReturnLine"("returnId", "variantId", "locationId");

-- CreateIndex
CREATE INDEX "StockSupplierPrice_organizationId_variantId_createdAt_idx" ON "StockSupplierPrice"("organizationId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockSupplierPrice_organizationId_supplierId_createdAt_idx" ON "StockSupplierPrice"("organizationId", "supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "StockDocument_organizationId_ownerType_ownerId_idx" ON "StockDocument"("organizationId", "ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_organizationId_id_key" ON "StockDocument"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "StockPurchaseOrder" ADD CONSTRAINT "StockPurchaseOrder_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "StockSupplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPurchaseOrder" ADD CONSTRAINT "StockPurchaseOrder_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPurchaseLine" ADD CONSTRAINT "StockPurchaseLine_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "StockPurchaseOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "StockPurchaseOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_organizationId_receiptId_fkey" FOREIGN KEY ("organizationId", "receiptId") REFERENCES "StockReceipt"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_organizationId_orderLineId_fkey" FOREIGN KEY ("organizationId", "orderLineId") REFERENCES "StockPurchaseLine"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSupplierReturn" ADD CONSTRAINT "StockSupplierReturn_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "StockSupplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSupplierReturnLine" ADD CONSTRAINT "StockSupplierReturnLine_organizationId_returnId_fkey" FOREIGN KEY ("organizationId", "returnId") REFERENCES "StockSupplierReturn"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSupplierPrice" ADD CONSTRAINT "StockSupplierPrice_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "StockSupplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Contrôles (écrits à la main) ───

ALTER TABLE "StockPurchaseLine"
  ADD CONSTRAINT "StockPurchaseLine_quantities_check" CHECK (
    "quantity" > 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity"
  ),
  ADD CONSTRAINT "StockPurchaseLine_cost_check" CHECK ("unitCost" >= 0 AND "vatRate" BETWEEN 0 AND 30);

ALTER TABLE "StockReceiptLine"
  ADD CONSTRAINT "StockReceiptLine_check" CHECK ("quantity" > 0 AND "unitCost" >= 0);

ALTER TABLE "StockReceipt"
  ADD CONSTRAINT "StockReceipt_cancel_check" CHECK (
    ("status" = 'VALIDATED' AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND length(btrim("cancelReason")) >= 3)
  );

ALTER TABLE "StockSupplierReturn"
  ADD CONSTRAINT "StockSupplierReturn_reason_check" CHECK (length(btrim("reason")) >= 3);

ALTER TABLE "StockSupplierReturnLine"
  ADD CONSTRAINT "StockSupplierReturnLine_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "StockSupplierPrice"
  ADD CONSTRAINT "StockSupplierPrice_cost_check" CHECK ("unitCost" >= 0);

ALTER TABLE "StockDocument"
  ADD CONSTRAINT "StockDocument_file_check" CHECK (
    "bytes" > 0 AND "mimeType" IN ('application/pdf', 'image/jpeg', 'image/png')
    AND length(btrim("fileName")) BETWEEN 1 AND 160
  );

-- ─── Réceptions : une réception validée ne change plus, sauf pour être annulée (une seule fois) ───

CREATE FUNCTION "stock_receipt_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.stock_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'STOCK_RECEIPT_FROZEN: une réception ne se supprime pas';
  END IF;
  IF OLD."status" <> 'VALIDATED' OR NEW."status" <> 'CANCELLED'
     OR (NEW."orderId", NEW."siteId", NEW."number", NEW."idempotencyKey", NEW."receivedByUserId", NEW."createdAt")
        IS DISTINCT FROM (OLD."orderId", OLD."siteId", OLD."number", OLD."idempotencyKey", OLD."receivedByUserId", OLD."createdAt") THEN
    RAISE EXCEPTION 'STOCK_RECEIPT_FROZEN: une réception validée ne peut qu''être annulée';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StockReceipt_frozen"
  BEFORE UPDATE OR DELETE ON "StockReceipt"
  FOR EACH ROW EXECUTE FUNCTION "stock_receipt_guard"();

-- ─── Lignes reçues, retours fournisseurs et prix d'achat : ajout seul ───

CREATE TRIGGER "StockReceiptLine_append_only"
  BEFORE UPDATE OR DELETE ON "StockReceiptLine"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

CREATE TRIGGER "StockSupplierReturn_append_only"
  BEFORE UPDATE OR DELETE ON "StockSupplierReturn"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

CREATE TRIGGER "StockSupplierReturnLine_append_only"
  BEFORE UPDATE OR DELETE ON "StockSupplierReturnLine"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

CREATE TRIGGER "StockSupplierPrice_append_only"
  BEFORE UPDATE OR DELETE ON "StockSupplierPrice"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

-- ─── Commandes : lignes figées dès la commande (seule la quantité reçue évolue) ───

CREATE FUNCTION "stock_purchase_line_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status TEXT;
BEGIN
  IF current_setting('ocall.stock_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT "status"::TEXT INTO order_status FROM "StockPurchaseOrder"
  WHERE "id" = COALESCE(NEW."orderId", OLD."orderId");
  IF order_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW."orderId", NEW."variantId", NEW."quantity", NEW."unitCost", NEW."vatRate")
         IS NOT DISTINCT FROM (OLD."orderId", OLD."variantId", OLD."quantity", OLD."unitCost", OLD."vatRate") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'STOCK_PURCHASE_FROZEN: commande passée, ses lignes ne changent plus';
END $$;

CREATE TRIGGER "StockPurchaseLine_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "StockPurchaseLine"
  FOR EACH ROW EXECUTE FUNCTION "stock_purchase_line_guard"();
