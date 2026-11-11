-- CreateEnum
CREATE TYPE "FacturePaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHECK', 'CARD', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FactureDocumentStatus" ADD VALUE 'PARTIALLY_PAID';
ALTER TYPE "FactureDocumentStatus" ADD VALUE 'PAID';
ALTER TYPE "FactureDocumentStatus" ADD VALUE 'CREDITED';

-- AlterTable
ALTER TABLE "FactureDocument" ADD COLUMN     "amountCredited" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "amountPaid" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "creditedInvoiceId" UUID,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "paymentTermsDays" INTEGER,
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FacturePayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "FacturePaymentMethod" NOT NULL,
    "paidAt" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "FacturePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacturePayment_organizationId_invoiceId_idx" ON "FacturePayment"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "FacturePayment_organizationId_paidAt_idx" ON "FacturePayment"("organizationId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "FacturePayment_organizationId_id_key" ON "FacturePayment"("organizationId", "id");

-- CreateIndex
CREATE INDEX "FactureDocument_organizationId_creditedInvoiceId_idx" ON "FactureDocument"("organizationId", "creditedInvoiceId");

-- CreateIndex
CREATE INDEX "FactureDocument_organizationId_type_dueDate_idx" ON "FactureDocument"("organizationId", "type", "dueDate");

-- AddForeignKey
ALTER TABLE "FactureDocument" ADD CONSTRAINT "FactureDocument_organizationId_creditedInvoiceId_fkey" FOREIGN KEY ("organizationId", "creditedInvoiceId") REFERENCES "FactureDocument"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturePayment" ADD CONSTRAINT "FacturePayment_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "FactureDocument"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Contrôles métier (en plus de la validation de l'API) ───
-- Les nouvelles valeurs du statut (PARTIALLY_PAID, PAID, CREDITED) ne sont pas utilisables dans la
-- transaction qui les crée : aucun contrôle ci-dessous ne les nomme (les fonctions plpgsql, elles, ne
-- sont interprétées qu'à l'exécution).

ALTER TABLE "FactureDocument"
  ADD CONSTRAINT "FactureDocument_settlement_check" CHECK (
    "amountPaid" >= 0 AND "amountCredited" >= 0
    AND "amountPaid" <= "totalTtc" AND "amountCredited" <= "totalTtc"
    -- Encaissements et avoirs ne concernent qu'une facture émise.
    AND (("type" = 'INVOICE' AND "status" <> 'DRAFT') OR ("amountPaid" = 0 AND "amountCredited" = 0))
  ),
  ADD CONSTRAINT "FactureDocument_paymentTerms_check" CHECK (
    ("paymentTermsDays" IS NULL OR "paymentTermsDays" BETWEEN 0 AND 365)
    AND ("type" = 'INVOICE' OR "paymentTermsDays" IS NULL)
  ),
  -- Une facture émise a toujours une échéance ; aucun autre document n'en a.
  ADD CONSTRAINT "FactureDocument_dueDate_check" CHECK (
    ("dueDate" IS NOT NULL) = ("type" = 'INVOICE' AND "status" <> 'DRAFT')
  ),
  -- Un avoir corrige toujours une facture ; seul un avoir en corrige une.
  ADD CONSTRAINT "FactureDocument_creditNote_check" CHECK (
    ("type" = 'CREDIT_NOTE') = ("creditedInvoiceId" IS NOT NULL)
  ),
  ADD CONSTRAINT "FactureDocument_reminderCount_check" CHECK ("reminderCount" >= 0);

ALTER TABLE "FacturePayment"
  ADD CONSTRAINT "FacturePayment_amount_check" CHECK ("amount" > 0 AND "amount" <= 10000000000000),
  ADD CONSTRAINT "FacturePayment_cancel_check" CHECK (
    ("cancelledAt" IS NULL) = ("cancelledByUserId" IS NULL)
    AND ("cancelledAt" IS NULL) = ("cancelReason" IS NULL)
  );

-- ─── Document émis figé (F2) ───
-- Mêmes règles qu'en F1, plus : l'échéance, le délai et la facture corrigée par un avoir sont figés ;
-- une facture ou un avoir émis n'est jamais annulé, accepté ni refusé (correction par avoir) ; seuls
-- évoluent le statut, les dates d'envoi et de relance, et les montants encaissés et crédités.

CREATE OR REPLACE FUNCTION "facture_document_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Seule exception : la purge d'une organisation entière (`purgeFactureOrganizations`), qui pose ce
    -- réglage local à sa transaction. L'API ne le pose jamais.
    IF OLD."status" <> 'DRAFT' AND current_setting('ocall.facture_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: un document émis ne se supprime pas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."status" = 'DRAFT'
    OR (OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED')
    OR (OLD."type" IN ('INVOICE', 'CREDIT_NOTE')
        AND NEW."status"::text IN ('CANCELLED', 'ACCEPTED', 'REFUSED'))
    OR (OLD."type" = 'CREDIT_NOTE' AND NEW."status"::text NOT IN ('ISSUED', 'SENT'))
    OR (NEW."organizationId", NEW."type", NEW."number", NEW."year", NEW."sequence", NEW."clientId",
        NEW."sourceDocumentId", NEW."subject", NEW."clientReference", NEW."notes", NEW."terms",
        NEW."vatExemptionReason", NEW."validityDays", NEW."issueDate", NEW."validUntil", NEW."currency",
        NEW."totalHt", NEW."totalVat", NEW."totalTtc", NEW."vatBreakdown", NEW."sellerSnapshot",
        NEW."clientSnapshot", NEW."createdByUserId", NEW."issuedAt", NEW."issuedByUserId",
        NEW."paymentTermsDays", NEW."dueDate", NEW."creditedInvoiceId")
       IS DISTINCT FROM
       (OLD."organizationId", OLD."type", OLD."number", OLD."year", OLD."sequence", OLD."clientId",
        OLD."sourceDocumentId", OLD."subject", OLD."clientReference", OLD."notes", OLD."terms",
        OLD."vatExemptionReason", OLD."validityDays", OLD."issueDate", OLD."validUntil", OLD."currency",
        OLD."totalHt", OLD."totalVat", OLD."totalTtc", OLD."vatBreakdown", OLD."sellerSnapshot",
        OLD."clientSnapshot", OLD."createdByUserId", OLD."issuedAt", OLD."issuedByUserId",
        OLD."paymentTermsDays", OLD."dueDate", OLD."creditedInvoiceId")
  ) THEN
    RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: un document émis est figé'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Avoir : la facture corrigée est une facture émise du même client.
CREATE FUNCTION "facture_credit_note_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice RECORD;
BEGIN
  IF NEW."creditedInvoiceId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "type", "status", "clientId" INTO invoice FROM "FactureDocument"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."creditedInvoiceId";
  IF invoice."type" IS DISTINCT FROM 'INVOICE' OR invoice."status" = 'DRAFT'
     OR invoice."clientId" IS DISTINCT FROM NEW."clientId" THEN
    RAISE EXCEPTION 'FACTURE_CREDIT_NOTE_INVALID: un avoir corrige une facture émise du même client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureDocument_creditNote"
  BEFORE INSERT OR UPDATE OF "creditedInvoiceId", "clientId" ON "FactureDocument"
  FOR EACH ROW EXECUTE FUNCTION "facture_credit_note_guard"();

-- Encaissement : jamais modifié ni supprimé ; seule son annulation (une fois, motif obligatoire) est
-- permise. Suppression : purge d'une organisation entière seulement.
CREATE FUNCTION "facture_payment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.facture_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'FACTURE_PAYMENT_FROZEN: un encaissement ne se supprime pas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."cancelledAt" IS NOT NULL
     OR NEW."cancelledAt" IS NULL
     OR (NEW."organizationId", NEW."invoiceId", NEW."amount", NEW."method", NEW."paidAt",
         NEW."reference", NEW."note", NEW."createdByUserId", NEW."createdAt")
        IS DISTINCT FROM
        (OLD."organizationId", OLD."invoiceId", OLD."amount", OLD."method", OLD."paidAt",
         OLD."reference", OLD."note", OLD."createdByUserId", OLD."createdAt") THEN
    RAISE EXCEPTION 'FACTURE_PAYMENT_FROZEN: un encaissement ne se modifie pas (annulation seule)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FacturePayment_frozen"
  BEFORE UPDATE OR DELETE ON "FacturePayment"
  FOR EACH ROW EXECUTE FUNCTION "facture_payment_guard"();
