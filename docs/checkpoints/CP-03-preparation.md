# Checkpoint CP-03 — préparation (Sprints 1, 2, 3 et 4)

Document préparé pour l'audit indépendant Codex CP-03. Il liste le périmètre, les commandes de
vérification et les points d'attention. Il ne constitue pas l'audit lui-même. CP-02 n'a pas été
réalisé : CP-03 couvre donc l'ensemble des Sprints 1 à 4 (la préparation CP-02 reste valable pour
les Sprints 1 à 3 : [CP-02-preparation.md](CP-02-preparation.md)).

## Référentiel

- Dépôt local : `C:\Users\couli\park-management` — branche `claude/sprint-4` (contient les Sprints 1 à 3).
- Base de développement : Neon existante (`DATABASE_URL`), **à ne jamais utiliser pour les tests**.
- Base de test : branche Neon `test` (`TEST_DATABASE_URL`) ; les suites refusent toute autre base.
- Aucune base de production configurée ; aucun déploiement ; aucune fusion dans `main`.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check            # aucune migration destructrice
pnpm test                        # unitaires (attendu : 88/88)
pnpm db:migrate:deploy:test      # migrations en attente sur la branche test
pnpm test:integration            # attendu : 102/102 — journal complet dans test-logs/
pnpm build; pnpm test:e2e        # attendu : 20/20 — journal complet dans test-logs/
```

## Points à vérifier — Sprint 4 (billetterie et contrôle d'accès)

- **Moteur de vente unique** : `SalesService.createSale` sert la caisse restaurant et la billetterie
  (`Sale.activity`) ; pas de second moteur de paiement. Billets émis par `TicketIssuanceService`
  **dans la transaction** de `pay()`, jamais avant (`apps/api/src/modules/pos/sales.service.ts`).
- **Prix serveur** : `TicketSalesService.price` (catégories actives, fenêtre de vente, prénoms =
  quantité × personnes incluses, parc ouvert ce jour) ; DTO avec `forbidNonWhitelisted`.
- **Entrée atomique** : `AccessControlService.scan` — `updateMany WHERE status = 'VALID'` dans la
  transaction, `TicketScan.acceptedForTicketId @unique` en dernier recours ; test de 5 scans simultanés.
- **QR** : `OCP1-` + 128 bits aléatoires (`randomBytes(16)`), aucune donnée personnelle ;
  `parseTicketQr` n'accepte que ce format. Billet d'une autre organisation = « inconnu » sans détail.
- **Isolation établissement** : un agent ne peut ni se déclarer sur un parc non affecté (404) ni
  valider un billet d'un autre établissement (`OTHER_ESTABLISHMENT`).
- **Horaires** : `ParkScheduleService` n'est lu que par la billetterie et le contrôle d'accès ;
  établissement mixte : restaurant non affecté (testé).
- **Idempotence** : commande, paiement (y compris deux envois simultanés de la même clé), scan.
- **Statistiques** : `TicketingDashboardService` et chiffre d'affaires du tableau de bord principal
  séparé par activité (`Sale.activity`) — corrige le mélange parc / restaurant qui serait apparu.
- **Migration** `20261029234320_billetterie_parc` : additive ; appliquée sur `test` puis sur la base
  de développement (comptages inchangés avant / après).

## Changements transverses à examiner

| Changement                                                                                            | Raison                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sessions de caisse, ventes (liste, paiement) et matériel ouverts aux activités `RESTAURANT` et `PARK` | La billetterie réutilise la caisse et l'impression. `POST /sales` et `/pos/*` restent réservés au restaurant. Deux assertions des Sprints 2 et 3 adaptées en conséquence |
| `PrismaService` : délai des transactions interactives 15 s (attente 10 s)                             | Défaut Prisma 5 s dépassé par un encaissement de billets avec la latence Neon `us-east-2` ; voir A3 : ce délai ne borne pas un blocage du type A2                        |
| Paiement rejoué en simultané avec la même clé → renvoie le paiement existant                          | Avant : la seconde requête recevait `409 SALE_ALREADY_PAID` au lieu du paiement déjà enregistré                                                                          |
| Briques de caisse partagées (`components/pos/cash-session.tsx`)                                       | Extraites de `register.tsx`, réutilisées par la billetterie (aucune duplication)                                                                                         |

## Sujets prioritaires de l'audit

Le commanditaire demande que Codex examine en priorité les quatre sujets ci-dessous. Pour chacun,
**un test qui repasse ne prouve pas la résolution** : la cause doit être établie, ou déclarée
explicitement non trouvée avec la liste des vérifications effectuées.

### P1 — Arrêts inexpliqués de l'API et du frontend pendant les tests E2E

Éléments à analyser :

- les journaux E2E ;
- les processus : PID, code de sortie, signal ;
- la mémoire ;
- les ports 3000 et 4000 ;
- la configuration Playwright (`playwright.config.ts`) : `webServer` lance `node dist/main.js` et
  `npx next start -p 3000`, avec `reuseExistingServer: false` et un seul worker.

Voir l'anomalie A1.

### P2 — Transaction bloquée 732 secondes ; délai des transactions porté à 15 secondes

Éléments à analyser :

- la cause initiale du blocage ;
- les verrous PostgreSQL (`pg_locks`, `pg_stat_activity`) ;
- les transactions imbriquées ou les appels réseau effectués dans une transaction ouverte ;
- l'effet de la latence Neon et du pooler.

Vérifier aussi que le passage de 5 s à 15 s (`apps/api/src/prisma/prisma.service.ts`) ne masque pas
un problème. Voir les anomalies A2 et A3.

### P3 — Paiements concurrents

Éléments à vérifier :

- **Idempotence de `SalesService.pay`** (`apps/api/src/modules/pos/sales.service.ts`) : recherche
  d'un paiement déjà enregistré avant la transaction, puis renvoi de ce paiement en cas de violation
  d'unicité ou de `SALE_ALREADY_PAID`.
- **Contraintes de base** : `Payment @@unique([organizationId, clientRequestId])` et
  `Ticket @@unique([saleLineId, position])`.
- **Deux requêtes simultanées**, avec la même clé puis avec des clés différentes.

Test existant : `apps/api/test/sprint4-ticketing.integration.spec.ts`, cas « 7. paiement et commande
rejoués ». Deux paiements simultanés avec la même clé renvoient le même paiement. Un paiement avec une
autre clé reçoit `409 SALE_ALREADY_PAID`. La vente compte au final un seul paiement et deux billets.

### P4 — Sécurité des QR codes

- **Imprévisibilité** : le jeton fait 128 bits, issus de `crypto.randomBytes(16)` (22 caractères
  base64url), dans la colonne `Ticket.token @unique`. Il n'est dérivé ni de l'identifiant, ni de la
  date, ni d'un compteur.
- **Validation côté serveur** :
  - `parseTicketQr` (`packages/shared/src/park.ts`) n'accepte que `OCP1-` suivi de 22 caractères
    `[A-Za-z0-9_-]`.
  - Le serveur ne croit jamais le client : `AccessControlService.scan` recalcule le statut,
    l'établissement et la validité du billet.
- **Isolation multi-tenant** (tests 13 et 14 de l'intégration Sprint 4) :
  - un billet d'une autre organisation est refusé comme `UNKNOWN`, sans aucun détail ;
  - un billet d'un autre établissement est refusé comme `OTHER_ESTABLISHMENT` ;
  - un agent ne peut se déclarer que sur un établissement qui lui est affecté (404 sinon).
- **Atomicité** (test 10 : 5 scans simultanés, une seule entrée acceptée) :
  - le passage `VALID → USED` se fait par `updateMany WHERE status = 'VALID'` dans la transaction ;
  - la contrainte `TicketScan.acceptedForTicketId @unique` sert de dernier recours.
- **Contenu** : le QR ne contient ni donnée personnelle, ni prix, ni secret applicatif.

## Anomalies ouvertes

Échelle de gravité :

- **Haute** : peut bloquer une mise en service.
- **Moyenne** : à traiter avant la production.
- **Basse** : connue et acceptée à ce stade.

Les journaux cités sont **locaux** (`C:\Users\couli\park-management\test-logs\`) et ne sont pas
versionnés (`test-logs/` figure dans `.gitignore`). On n'y a trouvé aucune chaîne de connexion
(`postgres://`, `npg_`). Ils contiennent en revanche des données de test (noms, identifiants de
connexion générés). Ils sont donc fournis à l'auditeur sur le poste de développement, et ne sont
pas publiés sur GitHub.

### A1 — Arrêt des serveurs API et frontend pendant les tests E2E (P1)

| Rubrique              | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gravité               | **Haute** tant que la cause n'est pas connue : rien ne prouve que le problème soit propre à l'environnement de test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Impact                | Si la cause est dans l'application (fuite mémoire, exception non interceptée, arrêt du processus Node), l'API ou le frontend pourrait s'arrêter en production. En test, l'arrêt provoque de faux échecs en cascade                                                                                                                                                                                                                                                                                                                                                                                          |
| Preuves               | Deux occurrences. **Sprint 3** : `test-logs/e2e-s3-2026-10-29T23-05-46-468Z.log` (`ERR_CONNECTION_REFUSED` sur `localhost:3000`). **Sprint 4** : `test-logs/e2e-2026-10-30T00-46-22-458Z.log`, avec un échec réel d'assertion (`toBeVisible`), puis 10 `ERR_CONNECTION_REFUSED` (9 tests réussis, 11 échoués). Le journal ne contient aucune sortie des serveurs, car Playwright ne relaie pas leur stdout/stderr par défaut. Relances : `test-logs/e2e-s3-2026-10-29T23-07-20-700Z.log` (2/2) et `test-logs/e2e-2026-10-30T00-50-04-235Z.log` (20/20). Aucun hook git ni autre processus n'a été identifié |
| Tests à mener         | Journaliser la sortie des serveurs (`stdout: 'pipe'` et `stderr: 'pipe'` dans `webServer`). Enregistrer le PID, le code de sortie et le signal de chaque serveur. Mesurer la mémoire et les handles pendant l'exécution. Vérifier l'occupation des ports 3000 et 4000 avant et après. Journaliser `uncaughtException` et `unhandledRejection` dans l'API. Exécuter la suite complète au moins 10 fois de suite. Lancer les serveurs hors de Playwright et rejouer la suite contre eux, pour mettre Playwright hors de cause ou en cause                                                                     |
| Critère de résolution | La cause est identifiée et démontrée par un journal, un correctif est appliqué, puis **10 exécutions complètes consécutives se déroulent sans arrêt**, sortie des serveurs journalisée. Si la cause n'est pas trouvée, l'anomalie reste ouverte, quel que soit le nombre d'exécutions réussies                                                                                                                                                                                                                                                                                                              |

### A2 — Transaction bloquée 732 secondes (P2)

| Rubrique              | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gravité               | **Haute** : cause inconnue, une seule occurrence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Impact                | Une transaction restée ouverte peut garder des verrous et bloquer d'autres ventes. En caisse, l'encaissement resterait figé pour l'utilisateur                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Preuves               | `test-logs/integration-2026-10-29T20-33-12-703Z.log`, ligne 16, pendant une inscription (création d'organisation) : « The timeout for this transaction was 5000 ms, however 732101 ms passed since the start of the transaction ». Suivent des dépassements de délai des hooks Jest (25 tests réussis, 33 échoués). **Le délai de 5 s était déjà actif et n'a pas empêché le blocage** : Prisma n'a constaté l'expiration qu'à la requête suivante. Les relevés `pg_stat_activity` de `test-logs/diag-locks.log` ne montrent que des transactions brèves en état `idle in transaction` / `ClientRead`, sans `blocked_by`. Le blocage ne s'est pas reproduit dans les exécutions suivantes, dont `test-logs/integration-2026-10-30T00-13-36-942Z.log` (102/102) |
| Tests à mener         | Déterminer où le temps a été passé : côté client Node (boucle d'événements bloquée, connexion au pooler Neon suspendue, mise en veille de l'endpoint Neon) ou côté serveur (verrou). Rechercher les appels réseau, les `await` externes et les transactions imbriquées dans les `$transaction` de l'inscription et du paiement. Tenter de reproduire en relevant en continu `pg_stat_activity` et `pg_locks`. Tester `statement_timeout` et `idle_in_transaction_session_timeout`, qui limitent réellement la durée côté PostgreSQL                                                                                                                                                                                                                            |
| Critère de résolution | La cause est établie. À défaut, une limite effective côté serveur (`idle_in_transaction_session_timeout`) est démontrée par un test qui simule une transaction suspendue et vérifie que les verrous sont libérés                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### A3 — Délai des transactions interactives porté de 5 s à 15 s (P2)

| Rubrique              | Détail                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gravité               | **Moyenne**                                                                                                                                                                                                                                                                                                                                     |
| Impact                | Ce changement corrige des échecs réels : avec environ 300 ms par requête vers Neon `us-east-2`, un encaissement de billets dépassait 5 s. Mais il allonge la durée pendant laquelle des verrous peuvent être détenus, et **ne protège pas** contre un blocage comme celui de A2                                                                 |
| Preuves               | `apps/api/src/prisma/prisma.service.ts` : `transactionOptions: { maxWait: 10_000, timeout: 15_000 }`. La transaction de paiement a dépassé 5 s pendant le développement du Sprint 4 (`test-logs/integration-s4-2026-10-30T00-00-33-967Z.log` et suivants). Une requête de l'émission des billets a été supprimée pour raccourcir la transaction |
| Tests à mener         | Mesurer le nombre d'allers-retours et la durée de la transaction de paiement (billets et journal d'audit) pour 1, 10 et 40 visiteurs. Identifier ce qui peut sortir de la transaction ou être regroupé (`createMany`). Refaire la mesure avec une base située dans la région de production envisagée                                            |
| Critère de résolution | La durée mesurée de la transaction de paiement reste nettement sous le délai dans les conditions cibles, et la valeur du délai est justifiée par cette mesure ou ramenée plus bas                                                                                                                                                               |

### A4 — Latence Neon `us-east-2` ; région de production non choisie

| Rubrique              | Détail                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gravité               | **Moyenne**                                                                                                                                                               |
| Impact                | Environ 300 ms par requête, mesurés depuis le poste de développement : écrans et encaissements lents, et une des causes de A3. Aucune base de production n'est configurée |
| Preuves               | Durée des demandes d'impression en test (4 à 6 s chacune) et des transactions de paiement ; `docs/DEPLOIEMENT-RAILWAY.md` §8                                              |
| Tests à mener         | Mesurer la latence entre l'API et la base depuis la région Railway retenue, vers plusieurs régions Neon, en particulier en Europe (plus proche de l'Afrique de l'Ouest)   |
| Critère de résolution | La région de production est choisie et validée par le commanditaire, avec une latence mesurée et acceptable ; A3 est réévaluée avec cette mesure                          |

### A5 — Aucun test physique : QR imprimés, imprimantes, scan caméra, connecteur Android

| Rubrique              | Détail                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gravité               | **Haute** pour une mise en service sur site ; non bloquante pour l'audit du code                                                                                                                                                                                                                                                |
| Impact                | Un QR imprimé illisible, une coupe mal placée ou un scan trop lent bloqueraient l'entrée du parc. Le connecteur Android du Sprint 3 (`apps/android`) n'a **jamais été compilé**, faute de SDK Android et de Gradle sur le poste. Tant qu'il n'est pas validé, l'impression et le tiroir-caisse ne fonctionnent pas sur tablette |
| Preuves               | Les tests automatiques utilisent une imprimante **simulée**, clairement signalée comme telle. Le scan a été testé par la saisie manuelle, qui suit le même chemin côté serveur. Voir `docs/BILLETTERIE-PARC.md` (dernière section) et `docs/MATERIEL-POS.md` §7                                                                 |
| Tests à mener         | Compiler et installer le connecteur Android. Imprimer des billets sur de vraies imprimantes 58 et 80 mm. Scanner avec la tablette des agents : lumière du jour, billet froissé, QR affiché sur un téléphone, distance. Mesurer le temps de passage en 4G. Dérouler le protocole de `docs/MATERIEL-POS.md` §7                    |
| Critère de résolution | Le protocole matériel est exécuté sur site et donne lieu à un procès-verbal (modèles testés, taux de lecture, temps de passage) validé par le commanditaire                                                                                                                                                                     |

### A6 — Remboursement d'un billet annulé

| Rubrique              | Détail                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gravité               | **Basse** : hors périmètre du Sprint 4, limite connue                                                                                                     |
| Impact                | Le système ne rembourse pas un billet annulé. Un éventuel remboursement se fait hors du logiciel et n'apparaît ni dans la caisse ni dans les statistiques |
| Preuves               | `docs/BILLETTERIE-PARC.md`, ligne « Annulation d'un billet ». Seule l'annulation existe : motivée, atomique et auditée (test 12)                          |
| Tests à mener         | Aucun à ce stade. À spécifier dans un sprint ultérieur : effets sur la caisse, la session, les statistiques et les droits                                 |
| Critère de résolution | Le commanditaire décide : fonctionnalité planifiée, ou explicitement exclue                                                                               |

## Critères proposés pour un GO

- Toutes les commandes de vérification au vert.
- Aucune anomalie critique de sécurité (isolation, RBAC, double entrée, QR, secrets).
- Les quatre sujets prioritaires (P1 à P4) examinés, avec une conclusion argumentée pour chacun.
- A1 et A2 : cause établie ou plan d'investigation accepté ; aucune clôture fondée uniquement sur
  des exécutions vertes.
- Validation matérielle (Sprint 3) et validation caméra / impression QR (Sprint 4) planifiées avant
  toute mise en service sur site (A5).
