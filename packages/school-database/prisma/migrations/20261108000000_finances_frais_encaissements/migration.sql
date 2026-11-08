-- CreateEnum
CREATE TYPE "SchoolFeeCategory" AS ENUM ('REGISTRATION', 'REENROLLMENT', 'TUITION', 'CANTEEN', 'TRANSPORT', 'EXAM', 'OTHER');

-- CreateEnum
CREATE TYPE "SchoolPlanKind" AS ENUM ('ANNUAL', 'MONTHLY', 'QUARTERLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SchoolBenefitKind" AS ENUM ('FIXED', 'PERCENT', 'SCHOLARSHIP', 'EXEMPTION', 'FAMILY');

-- CreateEnum
CREATE TYPE "SchoolBenefitStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "SchoolPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "SchoolPaymentKind" AS ENUM ('PAYMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "SchoolPaymentStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SchoolPaymentVerification" AS ENUM ('NOT_APPLICABLE', 'DECLARED_UNVERIFIED');

-- CreateTable
CREATE TABLE "SchoolFinanceSettings" (
    "schoolId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "receiptPrefix" TEXT NOT NULL DEFAULT 'REC',
    "secretaryCanCollect" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolFinanceSettings_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolFee" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "levelId" UUID,
    "classId" UUID,
    "category" "SchoolFeeCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "planKind" "SchoolPlanKind" NOT NULL,
    "plan" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolFeeInstallment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "feeId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "dueOn" DATE NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "SchoolFeeInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolFeeEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "feeId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolFeeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolCharge" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "feeId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "category" "SchoolFeeCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "labelAr" TEXT,
    "dueOn" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "adjustment" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolChargeAdjustment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolChargeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolBenefit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "kind" "SchoolBenefitKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "category" "SchoolFeeCategory",
    "feeId" UUID,
    "reason" TEXT NOT NULL,
    "status" "SchoolBenefitStatus" NOT NULL DEFAULT 'ACTIVE',
    "approvedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,

    CONSTRAINT "SchoolBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolPayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "kind" "SchoolPaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "SchoolPaymentMethod" NOT NULL,
    "reference" TEXT,
    "verification" "SchoolPaymentVerification" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "receivedByUserId" UUID NOT NULL,
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT,
    "receiptNumber" TEXT,
    "balanceAfter" INTEGER,
    "classLabel" TEXT,
    "status" "SchoolPaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" UUID,
    "cancelReason" TEXT,
    "reversalOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolPaymentAllocation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "SchoolPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFinanceSettings_organizationId_schoolId_key" ON "SchoolFinanceSettings"("organizationId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolFee_organizationId_schoolId_schoolYearId_idx" ON "SchoolFee"("organizationId", "schoolId", "schoolYearId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFee_organizationId_id_key" ON "SchoolFee"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFee_organizationId_schoolId_id_key" ON "SchoolFee"("organizationId", "schoolId", "id");

-- CreateIndex
CREATE INDEX "SchoolFeeInstallment_organizationId_feeId_idx" ON "SchoolFeeInstallment"("organizationId", "feeId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeeInstallment_feeId_position_key" ON "SchoolFeeInstallment"("feeId", "position");

-- CreateIndex
CREATE INDEX "SchoolFeeEvent_organizationId_feeId_createdAt_idx" ON "SchoolFeeEvent"("organizationId", "feeId", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolCharge_organizationId_schoolId_schoolYearId_dueOn_idx" ON "SchoolCharge"("organizationId", "schoolId", "schoolYearId", "dueOn");

-- CreateIndex
CREATE INDEX "SchoolCharge_organizationId_studentId_idx" ON "SchoolCharge"("organizationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolCharge_studentId_feeId_position_key" ON "SchoolCharge"("studentId", "feeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolCharge_organizationId_id_key" ON "SchoolCharge"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SchoolChargeAdjustment_organizationId_chargeId_idx" ON "SchoolChargeAdjustment"("organizationId", "chargeId");

-- CreateIndex
CREATE INDEX "SchoolBenefit_organizationId_studentId_schoolYearId_idx" ON "SchoolBenefit"("organizationId", "studentId", "schoolYearId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPayment_reversalOfId_key" ON "SchoolPayment"("reversalOfId");

-- CreateIndex
CREATE INDEX "SchoolPayment_organizationId_schoolId_paidAt_idx" ON "SchoolPayment"("organizationId", "schoolId", "paidAt");

-- CreateIndex
CREATE INDEX "SchoolPayment_organizationId_studentId_idx" ON "SchoolPayment"("organizationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPayment_organizationId_id_key" ON "SchoolPayment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPayment_organizationId_idempotencyKey_key" ON "SchoolPayment"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPayment_schoolId_receiptNumber_key" ON "SchoolPayment"("schoolId", "receiptNumber");

-- CreateIndex
CREATE INDEX "SchoolPaymentAllocation_organizationId_chargeId_idx" ON "SchoolPaymentAllocation"("organizationId", "chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPaymentAllocation_paymentId_chargeId_key" ON "SchoolPaymentAllocation"("paymentId", "chargeId");

-- AddForeignKey
ALTER TABLE "SchoolFinanceSettings" ADD CONSTRAINT "SchoolFinanceSettings_organizationId_schoolId_fkey" FOREIGN KEY ("organizationId", "schoolId") REFERENCES "School"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolFee" ADD CONSTRAINT "SchoolFee_organizationId_schoolId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolFee" ADD CONSTRAINT "SchoolFee_organizationId_levelId_fkey" FOREIGN KEY ("organizationId", "levelId") REFERENCES "Level"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolFee" ADD CONSTRAINT "SchoolFee_organizationId_schoolYearId_classId_fkey" FOREIGN KEY ("organizationId", "schoolYearId", "classId") REFERENCES "SchoolClass"("organizationId", "schoolYearId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolFeeInstallment" ADD CONSTRAINT "SchoolFeeInstallment_organizationId_feeId_fkey" FOREIGN KEY ("organizationId", "feeId") REFERENCES "SchoolFee"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolFeeEvent" ADD CONSTRAINT "SchoolFeeEvent_organizationId_feeId_fkey" FOREIGN KEY ("organizationId", "feeId") REFERENCES "SchoolFee"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolCharge" ADD CONSTRAINT "SchoolCharge_organizationId_schoolId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolCharge" ADD CONSTRAINT "SchoolCharge_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolCharge" ADD CONSTRAINT "SchoolCharge_organizationId_schoolId_feeId_fkey" FOREIGN KEY ("organizationId", "schoolId", "feeId") REFERENCES "SchoolFee"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolChargeAdjustment" ADD CONSTRAINT "SchoolChargeAdjustment_organizationId_chargeId_fkey" FOREIGN KEY ("organizationId", "chargeId") REFERENCES "SchoolCharge"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolBenefit" ADD CONSTRAINT "SchoolBenefit_organizationId_schoolId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolBenefit" ADD CONSTRAINT "SchoolBenefit_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolBenefit" ADD CONSTRAINT "SchoolBenefit_organizationId_schoolId_feeId_fkey" FOREIGN KEY ("organizationId", "schoolId", "feeId") REFERENCES "SchoolFee"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_organizationId_schoolId_schoolYearId_fkey" FOREIGN KEY ("organizationId", "schoolId", "schoolYearId") REFERENCES "SchoolYear"("organizationId", "schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "SchoolStudent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "SchoolPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPaymentAllocation" ADD CONSTRAINT "SchoolPaymentAllocation_organizationId_paymentId_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "SchoolPayment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPaymentAllocation" ADD CONSTRAINT "SchoolPaymentAllocation_organizationId_chargeId_fkey" FOREIGN KEY ("organizationId", "chargeId") REFERENCES "SchoolCharge"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Contraintes métier (Prisma ne sait pas les décrire), garanties par la base même sous accès concurrent.
-- Montants entiers en unités mineures, bornés ; devise sur trois lettres.
ALTER TABLE "SchoolFinanceSettings" ADD CONSTRAINT "SchoolFinanceSettings_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "SchoolFee" ADD CONSTRAINT "SchoolFee_amount_check"
  CHECK ("amount" BETWEEN 0 AND 1000000000 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "SchoolFeeInstallment" ADD CONSTRAINT "SchoolFeeInstallment_amount_check"
  CHECK ("amount" >= 0 AND "position" >= 1);

-- Échéance : réduction entre zéro et le montant, jamais de trop-perçu (payé <= dû), payé positif.
ALTER TABLE "SchoolCharge" ADD CONSTRAINT "SchoolCharge_amounts_check"
  CHECK (
    "amount" >= 0
    AND "discount" BETWEEN 0 AND "amount"
    AND "paid" >= 0
    AND "amount" - "discount" + "adjustment" >= "paid"
  );
ALTER TABLE "SchoolChargeAdjustment" ADD CONSTRAINT "SchoolChargeAdjustment_amount_check"
  CHECK ("amount" <> 0 AND "amount" BETWEEN -1000000000 AND 1000000000);

-- Cumuls bornés : ajustement total et dû d'une échéance dans la plage des entiers, sans débordement.
ALTER TABLE "SchoolCharge" ADD CONSTRAINT "SchoolCharge_bounds_check"
  CHECK ("adjustment" BETWEEN -1000000000 AND 1000000000 AND "amount" + "adjustment" <= 1000000000);
ALTER TABLE "SchoolBenefit" ADD CONSTRAINT "SchoolBenefit_value_check"
  CHECK ("value" >= 0);

-- Encaissement : montant positif ; une contrepassation désigne toujours l'encaissement qu'elle annule.
ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_amount_check"
  CHECK ("amount" > 0 AND ("kind" = 'REVERSAL') = ("reversalOfId" IS NOT NULL));
ALTER TABLE "SchoolPaymentAllocation" ADD CONSTRAINT "SchoolPaymentAllocation_amount_check"
  CHECK ("amount" <> 0);

-- Une référence de transaction (virement, mobile money) n'est encaissée qu'une fois par établissement et
-- par moyen tant que l'encaissement reste confirmé : protection contre les doubles saisies.
CREATE UNIQUE INDEX "SchoolPayment_confirmed_reference_key" ON "SchoolPayment"(
  "schoolId", "method", lower("reference")
) WHERE "kind" = 'PAYMENT' AND "status" = 'CONFIRMED' AND "reference" IS NOT NULL;
