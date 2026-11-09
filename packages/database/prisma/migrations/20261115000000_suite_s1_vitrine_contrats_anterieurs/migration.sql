-- Socle commercial Ocall Suite (S1), correctif d'audit : option vitrine (décision D5).
-- Données uniquement. Les clients dont un contrat Ocall Suite existait AVANT l'application du socle S1
-- conservent le droit de publier leur site vitrine (droits acquis), au même titre que ceux qui avaient
-- un abonnement ou un site publié. L'absence d'abonnement n'accorde plus ce droit aux nouveaux clients.
-- Rejouable sans effet : ne fait que passer des organisations à true.
UPDATE "Organization" o SET "showcaseGrandfathered" = true
WHERE o."showcaseGrandfathered" = false
  AND EXISTS (
    SELECT 1 FROM "SuiteContract" c
    WHERE c."organizationId" = o."id"
      AND c."createdAt" < COALESCE(
        (SELECT m."started_at" FROM "_prisma_migrations" m
         WHERE m."migration_name" = '20261114000000_suite_s1_socle_commercial'
           AND m."finished_at" IS NOT NULL AND m."rolled_back_at" IS NULL
         ORDER BY m."started_at" LIMIT 1),
        CURRENT_TIMESTAMP)
  );
