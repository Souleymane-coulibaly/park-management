# Audit Codex — Ocall School, Sprint 9 (stabilisation)

Périmètre : commits `89bd01b`, `e2e1634` et `7a709f0` au-dessus du Sprint 8 (`dd99500`). Aucune
fonctionnalité nouvelle : stabilisation de la CI, E2E School dans le dépôt, réserves P3 du Sprint 8.

## 1. Changements

### 1.1 CI Park (`89bd01b`) — sans changement de règle métier

| Fichier                                               | Changement                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/sprint9-analytics.integration.spec.ts` | `ANALYZE` des tables après l'insertion massive du test 26 (statistiques vides → plan en boucles imbriquées > 10 s → 503). Mesuré : 0/3 avant, 3/3 après (0,65 à 0,97 s). |
| `apps/web/src/components/site/site-editor.tsx`        | L'effet dépendait de l'objet `useApi` recréé à chaque rendu et réinitialisait le brouillon à chaque saisie ; dépend des données.    |
| `apps/web/next.config.ts`                             | `Permissions-Policy` : `microphone=(self)` (au lieu de `()`, qui interdisait la commande vocale partout) ; `camera=(self)` inchangé. |
| `apps/web/src/lib/connectivity.ts`                    | Une sonde partie avant une coupure n'efface plus la coupure signalée par le navigateur (`navigator.onLine` relu à la réponse).     |
| `playwright.config.ts`                                | Serveur de test : limite de connexion relevée (`LOGIN_THROTTLE_LIMIT`), régénération des sites configurée (secret aléatoire par exécution). |
| `e2e/sprint13-pwa.spec.ts`                            | Attente de l'écran du scanner avant la coupure réseau simulée.                                                                   |

### 1.2 E2E School (`e2e1634`)

12 tests Playwright (`e2e/school-*.spec.ts`) : un parcours par module, contrôles d'accès, isolation entre
clients, interface arabe, IA simulée. Base School de test dédiée (`TEST_SCHOOL_DATABASE_URL`), garde
(`e2e/school-database.ts`) : distincte de la base Suite et de toute base configurée pour l'application,
marqueur « test » exigé pour une base distante. Nettoyage des données School et des contrats E2E en fin
de suite. Specs ignorées sans base hors CI, obligatoires en CI. CI : base School éphémère passée à
l'étape E2E.

### 1.3 Réserves P3 du Sprint 8 (`7a709f0`)

- Période sans note : « aucun élève noté » (outil `results_by_period`, analyse), jamais « effectif
  insuffisant ».
- `compare_periods` : écart d'établissement seulement si les deux périodes comparées ont un même barème
  unique.
- Plafond des contenus pédagogiques : recompte et création sous verrou consultatif par auteur.

## 2. Choix validés par le client

- Corriger la CI sans modifier les règles métier de Park ; mesurer avant et après.
- Ajouter les E2E School au dépôt (parcours critiques, environ 15 à 20 tests).
- Données fictives uniquement ; tests destructifs seulement sur base jetable.

## 3. Résultats mesurés (local, PostgreSQL jetable)

- E2E complets : 48 réussis / 3 échecs avant → 51/51 après les corrections de CI ; 63/63 avec les E2E
  School (deux exécutions sur quatre ; les deux autres interrompues par un plantage natif de Node 24
  sous Windows, code 0xC0000409, sans rapport avec le code).
- Unitaires IA School 21/21 ; intégration `school-sprint8-ai` 22/22, `school-sprint8` 14/14.

## 4. Questions prioritaires pour l'audit

1. Les corrections Park changent-elles un comportement métier, une permission ou une surface de sécurité
   (en particulier `Permissions-Policy`) au-delà de l'intention décrite ?
2. La garde de la base School des E2E peut-elle être contournée (base de développement ou de production
   visée par `TEST_SCHOOL_DATABASE_URL`) ? Le nettoyage par passes peut-il supprimer des données d'une
   organisation non E2E ?
3. Les E2E School vérifient-ils réellement ce qu'ils annoncent (aucune assertion vacuité, aucun
   `if visible`) ?
4. Le verrou du plafond documentaire est-il correct (clé, transaction, cohérence avec l'archivage) ?
5. Les nouvelles règles d'effectif et de barème du copilote restent-elles cohérentes avec le reporting
   du Sprint 8 et les exports ?
