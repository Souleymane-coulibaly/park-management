# Ocall School, Sprint 4 : instructions pour l'audit indépendant Codex

Audit en lecture seule de la branche `claude/school-sprint-4`, à partir de `1d03903` (Sprint 3B livré). Aucune
modification de fichier, aucune migration, aucun appel réseau, aucune base Neon. Données fictives uniquement.

## Périmètre

- Partagé : `packages/shared/src/school-assessment.ts` (moteur de calcul), `school-quran.ts` (catalogue et
  historique des sourates), `school.ts` (permissions, règle `absences`), `school-i18n.ts` (textes).
- Base : `packages/school-database/prisma/schema.prisma`, migration
  `20261107000000_evaluations_notes_bulletins_coran` (contraintes CHECK et index partiel écrits à la main).
- API : `apps/api/src/modules/school/school-assessment.{service,controller,dto}.ts`,
  `school-report-cards.service.ts`, `school-report-card.pdf.ts`, `school-rtl-text.ts`,
  `school-quran.service.ts`, `school.module.ts`.
- Web : `apps/web/src/app/school/{periodes,evaluations,resultats,classements,bulletins,coran}`,
  `apps/web/src/components/school/school-assessment.tsx`, `school-report-cards.tsx`, `notation/page.tsx`.
- Tests : `school-assessment.spec.ts`, `school-quran.spec.ts`, `school-rtl-text.spec.ts`,
  `school-report-card.pdf.spec.ts`, `apps/api/test/school-sprint4.integration.spec.ts`.

## Questions prioritaires

1. **Isolation** : chaque route refuse-t-elle (404) une classe, une période, une évaluation, un élève d'un
   autre client ou d'un établissement hors périmètre ? Un verrou peut-il porter sur une ligne étrangère ?
2. **Droits des enseignants** : saisie limitée aux matières, classes et groupes de leurs affectations actives,
   y compris sous fin d'affectation concurrente (verrou partagé sur `SchoolTeachingAssignment`) ; lecture
   restreinte (pas de moyenne générale, rang ni bulletin).
3. **Validation et verrouillage** : aucune note, évaluation ou appréciation d'enseignant ne peut s'écrire
   après validation ; la validation fige-t-elle exactement les résultats lus (verrou consultatif classe et
   période pris par toute écriture) ? Ordre des verrous sans cycle avec la clôture d'année et les affectations.
4. **Calculs** : moyennes pondérées, absences (écartées ou zéro), dispenses, groupes, coefficients 0,
   arrondis, ex æquo `SHARED`/`DENSE`, matières exclues du classement, version de règles par période.
5. **Journal** : toute modification de note tracée (avant, après, auteur, motif) dans la même transaction ;
   décisions de validation et de réouverture publiées sans le motif.
6. **Bulletins PDF** : aucune adresse directe ni mise en cache ; contenu limité au périmètre ; aucune donnée
   sensible dans les journaux ; rendu arabe et bilingue sans champ arabe obligatoire.
7. **Mémorisation du Coran** : module masqué (404) hors Bilingue ou désactivé, y compris après un changement
   de langue concurrent ; saisie réservée à l'enseignant de la matière Coran ; historique en ajout seul ;
   consultations journalisées ; aucune entrée dans les moyennes.
8. **Migration** : strictement additive, cohérente avec le schéma (noms d'index générés par Prisma).

## Vérifications à rejouer (optionnel, hors Neon)

- `pnpm -r run typecheck`, `pnpm -r run test`, `npx eslint .`, `npx prettier --check .`.
- Intégration School sur une base PostgreSQL jetable : `TEST_DATABASE_URL`, `TEST_SCHOOL_DATABASE_URL`, puis
  `npx jest --runInBand test/school-sprint4.integration.spec.ts` dans `apps/api` (les tests de concurrence
  exigent plusieurs connexions réelles et sont ignorés sous PGlite).

## Format attendu

Verdict (GO, GO SOUS RÉSERVES, NO GO), puis anomalies classées P0 à P3 avec fichier, ligne, scénario concret
et correction proposée.
