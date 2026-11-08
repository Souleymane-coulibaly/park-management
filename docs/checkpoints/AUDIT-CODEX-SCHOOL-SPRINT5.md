# Ocall School, Sprint 5 : instructions pour l'audit indépendant Codex

Audit en lecture seule de la branche `claude/school-sprint-5`, à partir de `720f5c3` (Sprint 4 livré). Aucune
modification de fichier, aucune migration, aucun appel réseau, aucune base Neon. Données fictives uniquement.

## Périmètre

- Partagé : `packages/shared/src/school-finance.ts` (montants, échéanciers, avantages, soldes), `school.ts`
  (permissions financières), `school-i18n.ts` (textes).
- Base : `packages/school-database/prisma/schema.prisma`, migration
  `20261108000000_finances_frais_encaissements` (contraintes CHECK et index partiel écrits à la main).
- API : `apps/api/src/modules/school/school-finance.{service,controller,dto}.ts`,
  `school-payments.service.ts`, `school-receipt.pdf.ts`, `school-pdf.ts` (socle PDF mis en commun avec les
  bulletins), `school-imports.service.ts` (méthodes d'export rendues publiques), `school.module.ts`.
- Web : `apps/web/src/app/school/finances/**`, `apps/web/src/components/school/school-finance*.tsx`.
- Tests : `school-finance.spec.ts`, `school-receipt.pdf.spec.ts`,
  `apps/api/test/school-sprint5.integration.spec.ts`.

## Questions prioritaires

1. **Exactitude monétaire** : aucun nombre à virgule dans les calculs ; partage exact des échéances ;
   réductions arrondies de façon cohérente ; devise unique par établissement ; bornes contre les dépassements.
2. **Doubles encaissements** : idempotence par formulaire (y compris soumissions simultanées), référence
   unique par moyen tant que confirmée, alerte sur un encaissement semblable ; aucun trop-perçu (CHECK).
3. **Atomicité et concurrence** : encaissement, affectations et soldes dans une seule transaction ; ordre des
   verrous (établissement, frais, élève, échéances) sans cycle avec la génération, les avantages, les
   ajustements, les annulations et les opérations des Sprints 2 à 4 (transferts, changements de classe).
4. **Non-rétroactivité** : un changement de tarif ou d'échéancier ne modifie aucune échéance générée ni
   aucun reçu émis ; jamais de double génération.
5. **Annulations** : réservées à la direction, motivées, par contrepassation ; aucun encaissement confirmé
   modifiable ou supprimable ; reçu conservé au statut annulé.
6. **Droits et isolation** : chaque route refuse (404) une ressource d'un autre client ou d'un établissement
   hors périmètre ; enseignants sans accès ; secrétariat en caisse seulement si la direction l'autorise.
7. **Reçus et exports** : aucune adresse directe, aucune mise en cache, contenu limité au périmètre, mobile
   money jamais présenté comme vérifié ; exports plafonnés et journalisés ; aucune donnée sensible dans les
   journaux.
8. **Migration** : strictement additive, cohérente avec le schéma.

## Vérifications à rejouer (optionnel, hors production)

- `pnpm -r run typecheck`, `pnpm -r run test`, `npx eslint .`, `npx prettier --check .`.
- Intégration sur une base School de test (Neon `test` marquée ou PostgreSQL jetable) :
  `npx jest --runInBand test/school-sprint5.integration.spec.ts` dans `apps/api` (les tests de concurrence
  exigent plusieurs connexions réelles et sont ignorés sous PGlite).

## Format attendu

Verdict (GO, GO SOUS RÉSERVES, NO GO), puis anomalies classées P0 à P3 avec fichier, ligne, scénario concret
et correction proposée.
