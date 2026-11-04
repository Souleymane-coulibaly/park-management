-- Ocall School, Sprint 5 : identité du reçu figée à l'encaissement. Strictement additive.

-- AlterTable
ALTER TABLE "SchoolPayment" ADD COLUMN     "receiptSnapshot" JSONB;

-- Tout encaissement porte son identité figée ; une contrepassation n'a pas de reçu propre.
ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_receipt_snapshot_check"
  CHECK ("kind" <> 'PAYMENT' OR "receiptSnapshot" IS NOT NULL);
