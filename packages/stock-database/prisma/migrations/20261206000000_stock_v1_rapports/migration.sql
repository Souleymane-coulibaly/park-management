-- Ocall Stock V1 — S6 : tableaux de bord, alertes et recherche globale. Migration additive : réglage de
-- faible rotation, index des remboursements par date, index de recherche (clients, sites, emplacements).

-- AlterTable
ALTER TABLE "StockSettings" ADD COLUMN     "slowMovingDays" INTEGER NOT NULL DEFAULT 90;

-- CreateIndex
CREATE INDEX "StockSaleReturn_organizationId_createdAt_idx" ON "StockSaleReturn"("organizationId", "createdAt");

-- ─── Garanties et index écrits à la main ───

ALTER TABLE "StockSettings"
  ADD CONSTRAINT "StockSettings_slowMovingDays_check" CHECK ("slowMovingDays" BETWEEN 15 AND 365);

-- Recherche globale (S6) : noms sans accents ni casse, tolérance aux fautes (trigrammes).
CREATE INDEX "StockCustomer_search_trgm" ON "StockCustomer"
  USING gin ("stock_search_text"("name") gin_trgm_ops);
CREATE INDEX "StockSite_search_trgm" ON "StockSite"
  USING gin ("stock_search_text"("name") gin_trgm_ops);
CREATE INDEX "StockLocation_search_trgm" ON "StockLocation"
  USING gin ("stock_search_text"("name") gin_trgm_ops);
