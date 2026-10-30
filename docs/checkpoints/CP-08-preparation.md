# Checkpoint CP-08 — préparation (Sprints 1 à 9)

Ce document prépare l'audit indépendant Codex CP-08. Il ne constitue pas l'audit lui-même.

## Contexte de décision

- Dernier audit réalisé : **CP-03** (Sprints 1 à 4), GO SOUS RÉSERVES, avec A1, A2 et A5 ouvertes.
- CP-04, CP-05, CP-06 et CP-07 **n'ont pas été réalisés**. Leurs préparations restent valables :
  [CP-04](CP-04-preparation.md), [CP-05](CP-05-preparation.md), [CP-07](CP-07-preparation.md).
  Il n'existe pas de CP-06 : le Sprint 7 (CinetPay) a été reporté et n'a aucun code.
- Le Sprint 9 a été démarré **sans CP-07**, sur décision explicite du commanditaire (30/10/2026).
  Il a été découpé en **9A** (analyses, marges, exports CSV) puis **9B** (copilote enrichi,
  statistiques SaaS et règlements d'abonnement).
- **Exports en CSV uniquement** : Excel et PDF ont été reportés par le commanditaire, sans nouvelle
  dépendance.
- **Règlements SaaS** : un registre manuel a été ajouté. La validation ne prolonge l'abonnement que
  sur case explicite, décochée par défaut (choix du commanditaire).
- **CP-08 doit donc couvrir les Sprints 1 à 6, 8 et 9**, dont aucun n'a été audité après le Sprint 4.

## Référentiel

- Branche `claude/sprint-9`, créée depuis `claude/sprint-8` (`10f6453`, poussée). Le travail du
  Sprint 9 n'est **ni commité ni poussé** à la date de ce document.
- Migrations **non appliquées** (ni sur `test`, ni en développement) :
  - `20261030152753_impression_pwa_ticket_borne` (Sprint 6) ;
  - `20261030164331_intelligence_artificielle` (Sprint 8) ;
  - `20261030190000_analyses` (Sprint 9A) ;
  - `20261030210000_reglements_saas` (Sprint 9B).
- Base de développement préservée. Les tests automatisés tournent uniquement sur la branche Neon
  `test` (actuellement inaccessible, A11). Pas de production.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check
pnpm test
pnpm db:migrate:deploy:test
pnpm test:integration            # Sprints 1 à 9 — fournisseur IA simulé
pnpm build; pnpm test:e2e        # Sprints 1 à 9
```

## Points à vérifier — Sprint 9

1. **Règles de calcul** (`packages/shared/src/analytics.ts`, `modules/analytics/analytics-queries.ts`) :
   - CA = paiements réussis de ventes non annulées, datés à l'encaissement ;
   - pas de double comptage (lignes de quantité par sous-requête latérale) ;
   - commandes ≠ CA ; visiteurs = scans acceptés ;
   - billets vendus, payés, émis et scannés distincts ;
   - heures locales de chaque établissement ;
   - période précédente correcte (aujourd'hui → hier jusqu'à la même heure).
2. **SQL** : entièrement paramétré (seuls des noms de colonnes fixes passent par `Prisma.raw`) ;
   organisation et établissements du périmètre dans chaque requête.
3. **Périmètre** (`analytics-scope.ts`) :
   - organisation tirée de la session ;
   - superviseur limité à ses affectations ;
   - établissement d'une autre organisation → 404 ;
   - paramètre non prévu → 400.
4. **Protection de la base** : transaction `READ ONLY`, `statement_timeout` de 10 s, période de
   366 jours au plus, limites de débit (analyses et exports).
5. **Marges** :
   - coût matière tiré de la recette de l'établissement de vente, au coût actuel ;
   - marge incomplète sans recette ou avec un coût manquant, jamais estimée ;
   - jamais présentée comme un bénéfice.
6. **Exports CSV** :
   - mêmes calculs et mêmes droits que les écrans ;
   - injection de formules neutralisée ;
   - 50 000 lignes au plus ; colonnes connues uniquement ;
   - export journalisé.
7. **Règle commune appliquée à l'existant** : le tableau de bord, les meilleures ventes du tableau de
   bord restaurant et la fonction `top_products` du copilote sont désormais datés à l'encaissement.
8. **Copilote 9B** :
   - 5 fonctions adossées au service d'analyses ;
   - produit retrouvé par le serveur (ambigu ou introuvable → signalé) ;
   - marges soumises à `analytics.margins` ;
   - aucune écriture.
9. **Registre SaaS** (`platform/saas.service.ts`) :
   - réservé au Super Admin ;
   - transitions conditionnelles ;
   - prolongation seulement sur demande, jamais raccourcie ;
   - doublons de référence refusés ; CHECK en base ; journalisation ;
   - aucune intégration de paiement ;
   - séparé des recettes des établissements.
10. **Migrations** `20261030190000_analyses` et `20261030210000_reglements_saas` : additives.

## Résultats à la date de préparation

| Contrôle                                                                                                                              | Résultat                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Unitaires                                                                                                                             | 183/183 (shared 116, database 13, API 54) |
| Typecheck, lint, Prettier, build, `migrate:check`                                                                                     | OK                                        |
| Vérification SQL hors ligne des analyses (PostgreSQL embarqué PGlite, toutes migrations, script jetable hors dépôt, aucune base Neon) | 43/43 conforme                            |
| Vérification hors ligne du registre SaaS (vrai client Prisma, même PostgreSQL embarqué, servi en local par `pglite-socket`)           | 24/24 conforme                            |
| `sprint9-analytics.integration.spec.ts`, `sprint9b-copilot-saas.integration.spec.ts`, `e2e/sprint9-analytics.spec.ts`                 | **écrits, non exécutés** (A11)            |
| Régression des Sprints 1 à 8                                                                                                          | **non exécutée** (A11)                    |

## Anomalies et limites

### Reportées (ouvertes)

- A1 à A22 : voir CP-04, CP-05 et CP-07.
- A11 (base Neon `test` : authentification refusée) bloque toujours **tous** les tests sur base.

### Nouvelles au Sprint 9

| Anomalie                                                         | Gravité          | Impact et suite                                                                                       |
| ---------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| A23 — marges au coût d'achat actuel                              | Moyenne          | Le coût à la date de vente n'est pas enregistré ; c'est indiqué à l'écran et dans les exports         |
| A24 — performance sur Neon non mesurée                           | Moyenne          | Mesure hors ligne seulement (PGlite, de 0,5 à 2,1 s pour 20 000 ventes) ; le test 26 reste à exécuter |
| A25 — écrans d'analyse et Super Admin non vérifiés en navigateur | Moyenne          | E2E non exécuté ; la base de développement n'a pas les migrations des Sprints 6, 8 et 9               |
| A26 — Excel et PDF non livrés                                    | Basse (décision) | CSV uniquement                                                                                        |
| A27 — validation SaaS sans double contrôle                       | Basse            | Un seul Super Admin prévu ; auteur et validateur enregistrés                                          |
| A28 — abonnements échus non basculés automatiquement             | Basse (choix)    | Signalés « à vérifier » dans les statistiques ; aucune automatisation, conformément à la règle métier |
| A29 — pas d'E2E Super Admin                                      | Basse            | Le parcours des règlements est couvert par l'intégration et la vérification hors ligne seulement      |

## Critères proposés pour un GO

- Tests d'intégration et E2E des Sprints 1 à 9 exécutés sur Neon `test`, journaux complets conservés.
- Aucune faille d'isolation, d'injection (SQL, formules CSV) ni d'écriture via les analyses ou le
  copilote.
- Montants des analyses recoupés à la main sur un jeu de données réel (CA, billets, marges).
