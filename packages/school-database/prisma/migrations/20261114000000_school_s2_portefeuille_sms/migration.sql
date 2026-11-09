-- Sprint S2 : portefeuille SMS prépayé des établissements (registre en ajout seul, demandes de
-- recharge validées par Ocall, tarif versionné). Migration additive : colonnes ajoutées avec valeur par
-- défaut, aucune modification ni suppression de donnée existante.
-- CreateEnum
CREATE TYPE "SchoolSmsCreditState" AS ENUM ('NONE', 'RESERVED', 'CAPTURED', 'RELEASED');

-- CreateEnum
CREATE TYPE "SchoolSmsLedgerKind" AS ENUM ('TOPUP', 'RESERVE', 'CAPTURE', 'RELEASE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SchoolSmsTopUpStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "SchoolSmsMessage" ADD COLUMN     "creditState" "SchoolSmsCreditState" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "creditsReserved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "encoding" TEXT,
ADD COLUMN     "international" BOOLEAN,
ADD COLUMN     "segments" INTEGER;

-- CreateTable
CREATE TABLE "SchoolSmsWallet" (
    "schoolId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSmsWallet_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolSmsLedgerEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "kind" "SchoolSmsLedgerKind" NOT NULL,
    "availableDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "messageId" UUID,
    "topUpRequestId" UUID,
    "actorUserId" UUID,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolSmsLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSmsTopUpRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "creditsRequested" INTEGER NOT NULL,
    "tariffVersion" INTEGER,
    "quotedAmountXof" INTEGER,
    "requestNote" TEXT,
    "requestedByUserId" UUID NOT NULL,
    "status" "SchoolSmsTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "creditsGranted" INTEGER,
    "paymentReference" TEXT,
    "handledByUserId" UUID,
    "handledAt" TIMESTAMP(3),
    "handlingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolSmsTopUpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSmsTariff" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "creditPriceXof" INTEGER,
    "providerCostPerSegmentXof" DECIMAL(10,2),
    "internationalCreditsPerSegment" INTEGER,
    "note" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolSmsTariff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSmsWallet_organizationId_schoolId_key" ON "SchoolSmsWallet"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolSmsLedgerEntry_organizationId_schoolId_createdAt_idx" ON "SchoolSmsLedgerEntry"("organizationId", "schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolSmsLedgerEntry_messageId_idx" ON "SchoolSmsLedgerEntry"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSmsLedgerEntry_organizationId_idempotencyKey_key" ON "SchoolSmsLedgerEntry"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SchoolSmsTopUpRequest_status_createdAt_idx" ON "SchoolSmsTopUpRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolSmsTopUpRequest_organizationId_schoolId_createdAt_idx" ON "SchoolSmsTopUpRequest"("organizationId", "schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSmsTariff_version_key" ON "SchoolSmsTariff"("version");

-- AddForeignKey
ALTER TABLE "SchoolSmsWallet" ADD CONSTRAINT "SchoolSmsWallet_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Soldes jamais négatifs, montants strictement positifs (défense en profondeur sous le service).
ALTER TABLE "SchoolSmsWallet" ADD CONSTRAINT "SchoolSmsWallet_balance_check" CHECK ("balance" >= 0);
ALTER TABLE "SchoolSmsWallet" ADD CONSTRAINT "SchoolSmsWallet_reserved_check" CHECK ("reserved" >= 0);
ALTER TABLE "SchoolSmsLedgerEntry" ADD CONSTRAINT "SchoolSmsLedgerEntry_after_check" CHECK ("balanceAfter" >= 0 AND "reservedAfter" >= 0);
ALTER TABLE "SchoolSmsTopUpRequest" ADD CONSTRAINT "SchoolSmsTopUpRequest_credits_check" CHECK ("creditsRequested" > 0 AND ("creditsGranted" IS NULL OR "creditsGranted" > 0));
ALTER TABLE "SchoolSmsMessage" ADD CONSTRAINT "SchoolSmsMessage_credits_check" CHECK ("creditsReserved" >= 0);
ALTER TABLE "SchoolSmsTariff" ADD CONSTRAINT "SchoolSmsTariff_values_check" CHECK (("creditPriceXof" IS NULL OR "creditPriceXof" > 0) AND ("internationalCreditsPerSegment" IS NULL OR "internationalCreditsPerSegment" > 0) AND ("providerCostPerSegmentXof" IS NULL OR "providerCostPerSegmentXof" >= 0));

-- Une seule demande de recharge en attente par établissement (une double demande est refusée).
CREATE UNIQUE INDEX "SchoolSmsTopUpRequest_pending_unique" ON "SchoolSmsTopUpRequest"("organizationId", "schoolId") WHERE "status" = 'PENDING';

-- Registre et tarifs en ajout seul : toute mise à jour est refusée par la base (la suppression reste
-- possible pour l'effacement d'un client).
CREATE FUNCTION "school_sms_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Écriture en ajout seul : % ne peut pas être modifié', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "SchoolSmsLedgerEntry_append_only" BEFORE UPDATE ON "SchoolSmsLedgerEntry" FOR EACH ROW EXECUTE FUNCTION "school_sms_append_only"();
CREATE TRIGGER "SchoolSmsTariff_append_only" BEFORE UPDATE ON "SchoolSmsTariff" FOR EACH ROW EXECUTE FUNCTION "school_sms_append_only"();
