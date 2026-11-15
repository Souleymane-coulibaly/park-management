-- Ocall Suite Sprint 2 — Facture : établissement émetteur facultatif. Migration additive : une colonne
-- facultative (un établissement du référentiel commun des sites, base Suite, sans clé étrangère entre bases)
-- et son index. Les documents existants restent sans établissement (null) ; aucune donnée existante n'est
-- modifiée. La numérotation reste unique pour toute l'organisation.

-- AlterTable
ALTER TABLE "FactureDocument" ADD COLUMN     "establishmentId" UUID;

-- CreateIndex
CREATE INDEX "FactureDocument_organizationId_establishmentId_idx" ON "FactureDocument"("organizationId", "establishmentId");

-- ─── Garantie écrite à la main ───

-- Établissement émetteur d'un document émis : figé (sa copie imprimée est dans « sellerSnapshot », déjà
-- figé). Fonction distincte : le contrôle des documents émis existant n'est pas modifié.
CREATE FUNCTION "facture_document_establishment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND NEW."establishmentId" IS DISTINCT FROM OLD."establishmentId" THEN
    RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: un document émis est figé'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureDocument_establishment_frozen"
  BEFORE UPDATE ON "FactureDocument"
  FOR EACH ROW EXECUTE FUNCTION "facture_document_establishment_guard"();
