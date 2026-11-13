-- Ocall Stock V1 — caisse (S4) : caisses, sessions (fond, clôture, écarts motivés), clients, ventes
-- (prix lus dans le catalogue, remises tracées, sorties de stock par le moteur), paiements saisis à la main,
-- retours et remboursements, paniers en attente. Migration additive : aucune donnée existante n'est modifiée.

-- CreateEnum
CREATE TYPE "StockPaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "StockCashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StockPrinterConnection" AS ENUM ('NONE', 'SIMULATED', 'NETWORK', 'BLUETOOTH', 'USB', 'WEBUSB', 'WEBBLUETOOTH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockCounterKind" ADD VALUE 'SALE';
ALTER TYPE "StockCounterKind" ADD VALUE 'SALE_RETURN';
ALTER TYPE "StockCounterKind" ADD VALUE 'CASH_SESSION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementKind" ADD VALUE 'SALE';
ALTER TYPE "StockMovementKind" ADD VALUE 'SALE_RETURN';

-- AlterTable
ALTER TABLE "StockSettings" ADD COLUMN     "maxDiscountPercent" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "receiptAddress" TEXT,
ADD COLUMN     "receiptFooter" TEXT,
ADD COLUMN     "receiptPhone" TEXT;

-- CreateTable
CREATE TABLE "StockCustomer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "note" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRegister" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paperWidth" INTEGER NOT NULL DEFAULT 80,
    "printerConnection" "StockPrinterConnection" NOT NULL DEFAULT 'NONE',
    "printerAddress" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCashSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "registerId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "status" "StockCashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openingFloat" INTEGER NOT NULL,
    "openedByUserId" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedCash" INTEGER,
    "countedCash" INTEGER,
    "difference" INTEGER,
    "differenceReason" TEXT,
    "closedByUserId" UUID,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "StockCashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSale" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "registerId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "customerId" UUID,
    "cashierUserId" UUID NOT NULL,
    "cashierName" TEXT NOT NULL,
    "grossTotal" INTEGER NOT NULL,
    "discountTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "vatTotal" INTEGER NOT NULL,
    "changeGiven" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSaleLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isStockable" BOOLEAN NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "vatAmount" INTEGER NOT NULL,
    "returnedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "refundedAmount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "returnId" UUID,
    "method" "StockPaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "tendered" INTEGER,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSaleReturn" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "saleId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "restock" BOOLEAN NOT NULL,
    "refundMethod" "StockPaymentMethod" NOT NULL,
    "refundAmount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSaleReturnLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "saleLineId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "StockSaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockHeldCart" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "registerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockHeldCart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCustomer_organizationId_isArchived_name_idx" ON "StockCustomer"("organizationId", "isArchived", "name");

-- CreateIndex
CREATE INDEX "StockCustomer_organizationId_phone_idx" ON "StockCustomer"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "StockCustomer_organizationId_id_key" ON "StockCustomer"("organizationId", "id");

-- CreateIndex
CREATE INDEX "StockRegister_organizationId_siteId_idx" ON "StockRegister"("organizationId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "StockRegister_organizationId_id_key" ON "StockRegister"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockRegister_organizationId_code_key" ON "StockRegister"("organizationId", "code");

-- CreateIndex
CREATE INDEX "StockCashSession_organizationId_registerId_openedAt_idx" ON "StockCashSession"("organizationId", "registerId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockCashSession_organizationId_id_key" ON "StockCashSession"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockCashSession_organizationId_number_key" ON "StockCashSession"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StockSale_organizationId_createdAt_idx" ON "StockSale"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockSale_organizationId_sessionId_idx" ON "StockSale"("organizationId", "sessionId");

-- CreateIndex
CREATE INDEX "StockSale_organizationId_customerId_idx" ON "StockSale"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "StockSale_organizationId_id_key" ON "StockSale"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockSale_organizationId_number_key" ON "StockSale"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockSale_organizationId_idempotencyKey_key" ON "StockSale"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StockSaleLine_organizationId_saleId_idx" ON "StockSaleLine"("organizationId", "saleId");

-- CreateIndex
CREATE INDEX "StockSaleLine_organizationId_variantId_idx" ON "StockSaleLine"("organizationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockSaleLine_organizationId_id_key" ON "StockSaleLine"("organizationId", "id");

-- CreateIndex
CREATE INDEX "StockPayment_organizationId_saleId_idx" ON "StockPayment"("organizationId", "saleId");

-- CreateIndex
CREATE INDEX "StockPayment_organizationId_sessionId_idx" ON "StockPayment"("organizationId", "sessionId");

-- CreateIndex
CREATE INDEX "StockSaleReturn_organizationId_saleId_idx" ON "StockSaleReturn"("organizationId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "StockSaleReturn_organizationId_id_key" ON "StockSaleReturn"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockSaleReturn_organizationId_number_key" ON "StockSaleReturn"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockSaleReturn_organizationId_idempotencyKey_key" ON "StockSaleReturn"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StockSaleReturnLine_organizationId_returnId_idx" ON "StockSaleReturnLine"("organizationId", "returnId");

-- CreateIndex
CREATE INDEX "StockHeldCart_organizationId_registerId_createdAt_idx" ON "StockHeldCart"("organizationId", "registerId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockRegister" ADD CONSTRAINT "StockRegister_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRegister" ADD CONSTRAINT "StockRegister_organizationId_locationId_fkey" FOREIGN KEY ("organizationId", "locationId") REFERENCES "StockLocation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCashSession" ADD CONSTRAINT "StockCashSession_organizationId_registerId_fkey" FOREIGN KEY ("organizationId", "registerId") REFERENCES "StockRegister"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSale" ADD CONSTRAINT "StockSale_organizationId_registerId_fkey" FOREIGN KEY ("organizationId", "registerId") REFERENCES "StockRegister"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSale" ADD CONSTRAINT "StockSale_organizationId_sessionId_fkey" FOREIGN KEY ("organizationId", "sessionId") REFERENCES "StockCashSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSale" ADD CONSTRAINT "StockSale_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "StockCustomer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSaleLine" ADD CONSTRAINT "StockSaleLine_organizationId_saleId_fkey" FOREIGN KEY ("organizationId", "saleId") REFERENCES "StockSale"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPayment" ADD CONSTRAINT "StockPayment_organizationId_saleId_fkey" FOREIGN KEY ("organizationId", "saleId") REFERENCES "StockSale"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPayment" ADD CONSTRAINT "StockPayment_organizationId_sessionId_fkey" FOREIGN KEY ("organizationId", "sessionId") REFERENCES "StockCashSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSaleReturn" ADD CONSTRAINT "StockSaleReturn_organizationId_saleId_fkey" FOREIGN KEY ("organizationId", "saleId") REFERENCES "StockSale"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSaleReturn" ADD CONSTRAINT "StockSaleReturn_organizationId_sessionId_fkey" FOREIGN KEY ("organizationId", "sessionId") REFERENCES "StockCashSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSaleReturnLine" ADD CONSTRAINT "StockSaleReturnLine_organizationId_returnId_fkey" FOREIGN KEY ("organizationId", "returnId") REFERENCES "StockSaleReturn"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHeldCart" ADD CONSTRAINT "StockHeldCart_organizationId_registerId_fkey" FOREIGN KEY ("organizationId", "registerId") REFERENCES "StockRegister"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Contrôles (écrits à la main) ───

ALTER TABLE "StockSettings"
  ADD CONSTRAINT "StockSettings_discount_check" CHECK ("maxDiscountPercent" BETWEEN 0 AND 100);

ALTER TABLE "StockCustomer"
  ADD CONSTRAINT "StockCustomer_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120);

ALTER TABLE "StockRegister"
  ADD CONSTRAINT "StockRegister_paper_check" CHECK ("paperWidth" IN (58, 80)),
  ADD CONSTRAINT "StockRegister_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$');

ALTER TABLE "StockCashSession"
  ADD CONSTRAINT "StockCashSession_float_check" CHECK ("openingFloat" >= 0),
  ADD CONSTRAINT "StockCashSession_close_check" CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL AND "countedCash" IS NULL AND "expectedCash" IS NULL
      AND "difference" IS NULL)
    OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedByUserId" IS NOT NULL
      AND "countedCash" >= 0 AND "expectedCash" IS NOT NULL
      AND "difference" = "countedCash" - "expectedCash"
      AND ("difference" = 0 OR length(btrim("differenceReason")) >= 3))
  );

-- Une seule session ouverte par caisse.
CREATE UNIQUE INDEX "StockCashSession_one_open_per_register"
  ON "StockCashSession"("registerId") WHERE "status" = 'OPEN';

ALTER TABLE "StockSale"
  ADD CONSTRAINT "StockSale_totals_check" CHECK (
    "grossTotal" >= 0 AND "discountTotal" >= 0 AND "discountTotal" <= "grossTotal"
    AND "total" = "grossTotal" - "discountTotal" AND "vatTotal" BETWEEN 0 AND "total"
    AND "changeGiven" >= 0 AND "reprintCount" >= 0
  );

ALTER TABLE "StockSaleLine"
  ADD CONSTRAINT "StockSaleLine_check" CHECK (
    "quantity" > 0 AND "unitPrice" >= 0 AND "vatRate" BETWEEN 0 AND 30
    AND "discount" >= 0 AND "total" >= 0 AND "vatAmount" BETWEEN 0 AND "total"
    AND "returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity"
    AND "refundedAmount" >= 0 AND "refundedAmount" <= "total"
  );

ALTER TABLE "StockPayment"
  ADD CONSTRAINT "StockPayment_check" CHECK (
    "amount" <> 0
    AND ("tendered" IS NULL OR ("method" = 'CASH' AND "amount" > 0 AND "tendered" >= "amount"))
    AND (("amount" < 0) = ("returnId" IS NOT NULL))
  );

ALTER TABLE "StockSaleReturn"
  ADD CONSTRAINT "StockSaleReturn_check" CHECK (
    length(btrim("reason")) >= 3 AND "refundAmount" >= 0
  );

ALTER TABLE "StockSaleReturnLine"
  ADD CONSTRAINT "StockSaleReturnLine_check" CHECK ("quantity" > 0 AND "amount" >= 0);

-- ─── Sessions : une session close ne change plus ───

CREATE FUNCTION "stock_cash_session_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.stock_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'STOCK_CASH_SESSION_FROZEN: une session de caisse ne se supprime pas';
  END IF;
  IF OLD."status" <> 'OPEN'
     OR (NEW."registerId", NEW."siteId", NEW."number", NEW."openingFloat", NEW."openedByUserId", NEW."openedAt")
        IS DISTINCT FROM (OLD."registerId", OLD."siteId", OLD."number", OLD."openingFloat", OLD."openedByUserId", OLD."openedAt") THEN
    RAISE EXCEPTION 'STOCK_CASH_SESSION_FROZEN: une session close ne change plus';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StockCashSession_frozen"
  BEFORE UPDATE OR DELETE ON "StockCashSession"
  FOR EACH ROW EXECUTE FUNCTION "stock_cash_session_guard"();

-- ─── Ventes : figées à l'encaissement (seul le compteur de réimpressions augmente) ───

CREATE FUNCTION "stock_sale_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.stock_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'STOCK_SALE_FROZEN: une vente ne se supprime pas';
  END IF;
  IF NEW."reprintCount" < OLD."reprintCount"
     OR (NEW."number", NEW."registerId", NEW."sessionId", NEW."siteId", NEW."locationId", NEW."customerId",
         NEW."cashierUserId", NEW."cashierName", NEW."grossTotal", NEW."discountTotal", NEW."total",
         NEW."vatTotal", NEW."changeGiven", NEW."idempotencyKey", NEW."createdAt")
        IS DISTINCT FROM
        (OLD."number", OLD."registerId", OLD."sessionId", OLD."siteId", OLD."locationId", OLD."customerId",
         OLD."cashierUserId", OLD."cashierName", OLD."grossTotal", OLD."discountTotal", OLD."total",
         OLD."vatTotal", OLD."changeGiven", OLD."idempotencyKey", OLD."createdAt") THEN
    RAISE EXCEPTION 'STOCK_SALE_FROZEN: une vente encaissée ne change plus';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StockSale_frozen"
  BEFORE UPDATE OR DELETE ON "StockSale"
  FOR EACH ROW EXECUTE FUNCTION "stock_sale_guard"();

-- Lignes : seuls la quantité et le montant retournés augmentent.
CREATE FUNCTION "stock_sale_line_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.stock_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'STOCK_SALE_FROZEN: une ligne de vente ne se supprime pas';
  END IF;
  IF NEW."returnedQuantity" < OLD."returnedQuantity" OR NEW."refundedAmount" < OLD."refundedAmount"
     OR (NEW."saleId", NEW."variantId", NEW."sku", NEW."label", NEW."isStockable", NEW."quantity",
         NEW."unitPrice", NEW."vatRate", NEW."discount", NEW."total", NEW."vatAmount")
        IS DISTINCT FROM
        (OLD."saleId", OLD."variantId", OLD."sku", OLD."label", OLD."isStockable", OLD."quantity",
         OLD."unitPrice", OLD."vatRate", OLD."discount", OLD."total", OLD."vatAmount") THEN
    RAISE EXCEPTION 'STOCK_SALE_FROZEN: une ligne de vente ne change plus';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StockSaleLine_frozen"
  BEFORE UPDATE OR DELETE ON "StockSaleLine"
  FOR EACH ROW EXECUTE FUNCTION "stock_sale_line_guard"();

-- ─── Paiements et retours : ajout seul ───

CREATE TRIGGER "StockPayment_append_only"
  BEFORE UPDATE OR DELETE ON "StockPayment"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

CREATE TRIGGER "StockSaleReturn_append_only"
  BEFORE UPDATE OR DELETE ON "StockSaleReturn"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

CREATE TRIGGER "StockSaleReturnLine_append_only"
  BEFORE UPDATE OR DELETE ON "StockSaleReturnLine"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();
