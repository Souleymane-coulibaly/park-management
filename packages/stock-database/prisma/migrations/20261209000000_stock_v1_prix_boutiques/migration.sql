-- Ocall Stock V1 — S10 : prix par boutique et vitrine multi-boutiques. Migration additive : une table
-- d'exceptions de prix (sans ligne, la boutique applique le prix commun : aucune donnée existante ne change),
-- la boutique d'un changement de prix dans l'historique et celle choisie par le visiteur d'une vitrine.

-- AlterTable
ALTER TABLE "StockPriceHistory" ADD COLUMN     "siteId" UUID;

-- AlterTable
ALTER TABLE "StockShowcaseRequest" ADD COLUMN     "siteId" UUID;

-- CreateTable
CREATE TABLE "StockSitePrice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "salePrice" INTEGER NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSitePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockSitePrice_organizationId_siteId_idx" ON "StockSitePrice"("organizationId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "StockSitePrice_organizationId_variantId_siteId_key" ON "StockSitePrice"("organizationId", "variantId", "siteId");

-- CreateIndex
CREATE INDEX "StockShowcaseRequest_organizationId_siteId_createdAt_idx" ON "StockShowcaseRequest"("organizationId", "siteId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockSitePrice" ADD CONSTRAINT "StockSitePrice_organizationId_variantId_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "StockVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSitePrice" ADD CONSTRAINT "StockSitePrice_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockShowcaseRequest" ADD CONSTRAINT "StockShowcaseRequest_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "StockSite"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Garde-fous
ALTER TABLE "StockSitePrice"
  ADD CONSTRAINT "StockSitePrice_salePrice_check" CHECK ("salePrice" >= 0);
