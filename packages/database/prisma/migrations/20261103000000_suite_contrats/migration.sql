-- CreateEnum
CREATE TYPE "SuiteContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');

-- AlterEnum
ALTER TYPE "BusinessType" ADD VALUE 'NONE';

-- AlterEnum
ALTER TYPE "MemberRole" ADD VALUE 'PRODUCT_USER';

-- CreateTable
CREATE TABLE "SuiteContract" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "SuiteContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limits" JSONB NOT NULL DEFAULT '{}',
    "coveredSchoolIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuiteContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuiteContractEvent" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "SuiteContractStatus",
    "toStatus" "SuiteContractStatus",
    "fromEndsOn" DATE,
    "toEndsOn" DATE,
    "reason" TEXT,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuiteContractEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuiteContract_reference_key" ON "SuiteContract"("reference");

-- CreateIndex
CREATE INDEX "SuiteContract_organizationId_productId_status_idx" ON "SuiteContract"("organizationId", "productId", "status");

-- CreateIndex
CREATE INDEX "SuiteContract_status_endsOn_idx" ON "SuiteContract"("status", "endsOn");

-- CreateIndex
CREATE INDEX "SuiteContractEvent_contractId_createdAt_idx" ON "SuiteContractEvent"("contractId", "createdAt");

-- AddForeignKey
ALTER TABLE "SuiteContract" ADD CONSTRAINT "SuiteContract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteContract" ADD CONSTRAINT "SuiteContract_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteContractEvent" ADD CONSTRAINT "SuiteContractEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SuiteContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

