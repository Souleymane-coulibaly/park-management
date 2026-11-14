-- Ocall Suite — Sprint 2, étape A : rôle propre à un site pour un membre Ocall Stock. Migration additive :
-- une colonne facultative (sans valeur, le rôle principal du membre s'applique : aucun droit existant ne
-- change). Un rôle de site n'est jamais administrateur.

-- AlterTable
ALTER TABLE "StockMemberSite" ADD COLUMN     "role" "StockRole";

ALTER TABLE "StockMemberSite"
  ADD CONSTRAINT "StockMemberSite_role_check" CHECK ("role" IS NULL OR "role" <> 'ADMIN');
