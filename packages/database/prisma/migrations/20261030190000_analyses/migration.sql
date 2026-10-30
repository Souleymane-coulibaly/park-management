-- Sprint 9 — analyses : index des encaissements par organisation et date.
-- Additive : aucune donnée modifiée. Verrou bref des écritures sur "Payment" le temps de la création.
-- CreateIndex
CREATE INDEX "Payment_organizationId_createdAt_idx" ON "Payment"("organizationId", "createdAt");
