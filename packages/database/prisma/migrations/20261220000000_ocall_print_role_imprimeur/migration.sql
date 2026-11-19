-- Ocall Print (lot PR-2) : rôle interne « Imprimeur » de l'atelier Ocall de Bamako. Accès limité à la
-- production des cartes ; double authentification obligatoire. Migration additive : aucune donnée modifiée.
ALTER TYPE "PlatformRole" ADD VALUE 'PRINT_OPERATOR';
