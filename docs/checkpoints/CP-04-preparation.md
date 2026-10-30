# Checkpoint CP-04 — préparation (Sprints 1 à 5)

Ce document prépare l'audit indépendant Codex CP-04 : il en fixe le périmètre, les commandes de
vérification et les points d'attention. Il ne constitue pas l'audit lui-même.

## Contexte de décision

- Le rapport CP-03 ([CHECKPOINT_CP03_SPRINTS_1_4.md](CHECKPOINT_CP03_SPRINTS_1_4.md)) a conclu
  **GO SOUS RÉSERVES**, avec « autorisation de commencer le Sprint 5 : NON », tant que A1, A2 et A5
  restaient ouvertes.
- Le **30/10/2026**, le commanditaire a **explicitement décidé de démarrer le Sprint 5 malgré ce NON**,
  en maintenant A1, A2 et A5 ouvertes et en les reportant à CP-04.
- Aucune de ces trois réserves n'a été levée pendant le Sprint 5 : elles restent ouvertes et doivent
  être réexaminées ici, avec la même exigence de preuve.

## Référentiel

- Dépôt local : `C:\Users\couli\park-management`.
- Branche `claude/sprint-5`, créée depuis `claude/sprint-4` (`aab4c63`, qui contient les Sprints 1 à
  4 et le rapport CP-03).
- Base de développement : Neon existante (`DATABASE_URL`), **jamais utilisée pour les tests**.
- Base de test : branche Neon `test` (`TEST_DATABASE_URL`) ; les suites refusent toute autre base.
- Aucune base de production configurée ; aucun déploiement ; aucune fusion dans `main`.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check            # aucune migration destructrice
pnpm test                        # unitaires — résultat attendu dans SPRINT_STATUS.md
pnpm db:migrate:deploy:test      # migrations en attente sur la branche test
pnpm test:integration            # Sprints 1 à 5 — journal complet dans test-logs/
pnpm build; pnpm test:e2e        # Sprints 1 à 5 — journal complet dans test-logs/
```

## Points à vérifier — Sprint 5 (restaurant)

1. **Paiement ≠ préparation** :
   - `SalesService.pay` ne modifie jamais `preparationStatus` ;
   - seul `RestaurantOrdersService.transition('send')` (permission `order.send_kitchen`) fait quitter
     `NOT_SENT` ;
   - tests 6 et 7 de `sprint5-restaurant.integration.spec.ts`.
2. **Transitions** : `decidePreparationTransition` (`packages/shared/src/restaurant.ts`) ; verrou de
   ligne, conditions et idempotence dans `orders.service.ts` ; deux envois simultanés → une seule
   transition (test 7).
3. **Temps réel (SSE)** :
   - authentification par cookie, puis revérification à chaque battement (session, rôle,
     affectation) : `realtime-stream.ts` ;
   - isolation par organisation et par établissement : `RestaurantEventsService.stream` et contrôle de
     l'établissement à l'ouverture ;
   - évènements sans données métier ;
   - fermeture des flux à l'arrêt de l'application ;
   - tests 10 et 11, et le test « session révoquée ».
4. **Reconnexion côté navigateur** (`apps/web/src/lib/use-live-stream.ts`) :
   - réouverture au retour du réseau et après 60 s de silence ;
   - resynchronisation par `ready` ;
   - test E2E avec coupure réelle (`setOffline`). Ce test a **révélé et fait corriger** un écran
     resté « En direct » après une coupure.
5. **Commandes QR publiques** (`qr-orders.service.ts`) :
   - jetons de 128 bits ;
   - réponse « introuvable » uniforme ;
   - plafond de demandes en attente par point de commande, sous verrou ;
   - limite par IP (`publicOrder`, `throttling.ts`) ;
   - idempotence par établissement et clé client ;
   - validation par un employé en une seule transaction (`afterCreate` + `updateMany` conditionnel) ;
   - aucune donnée interne exposée ;
   - tests « 4. commandes par QR code ».
6. **Prix** : seuls `variantId`, `quantity` et `notes` sont acceptés (`forbidNonWhitelisted`) ; prix
   figés sur la ligne ; revalorisation à la validation d'une demande QR (test 5).
7. **Stocks** (`stock-consumption.service.ts`) :
   - déduction à la première action (envoi en cuisine ou paiement) ;
   - double protection : `stockDeductedAt` conditionnel et clé unique `sale:<vente>:<article>` ;
   - ordre de verrouillage stable entre articles ;
   - coûts jamais estimés ;
   - tests 13, 14 et 15.
8. **Réservations** (`reservations.service.ts`) : contrôle de chevauchement `[début, fin[` sous verrou
   de la table ; deux saisies simultanées → une seule réservation (test 16).
9. **Ticket cuisine** : `PrintJobsService` (`kind: KITCHEN`) ; uniquement après l'envoi ; aucun prix
   (`layoutKitchenTicket`) ; un échec ne touche ni la commande ni le paiement (test 12).
10. **Tableau de bord** : CA = paiements réussis du jour ; pas de double comptage avec un paiement
    rejoué en simultané (test 19).
11. **Activités** :
    - une organisation `PARK` reçoit `403` sur tout le module restaurant ;
    - un établissement parc seul d'une organisation mixte reçoit `400 ESTABLISHMENT_NOT_RESTAURANT` ;
    - la billetterie garde la caisse et l'impression.
12. **Migrations**, toutes deux additives :
    - `20261030100338_restaurant_commandes_cuisine_stocks_reservations` : tables, colonnes
      facultatives, valeurs d'énumération ajoutées ;
    - `20261030120121_ordre_lignes_vente` : `SaleLine.lineNo`, avec valeur par défaut 0.
13. **Ordre des lignes et des billets** : les billets étaient triés par l'identifiant aléatoire de
    leur ligne de vente. Leur ordre dépendait donc du hasard, ce qui faisait échouer un test du
    Sprint 4 une fois sur deux.
    - Les tickets de caisse et les tickets cuisine avaient le même défaut.
    - Corrigé par `lineNo` (ordre de saisie), utilisé pour tous les tris : tickets, billets, écrans.

## Changements transverses à examiner

| Changement                                                                                      | Raison                                                                      |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SalesService.createSale` : options `order` (canal, table, zone, instructions) et `afterCreate` | Commandes et validation QR sur le moteur commun, dans une seule transaction |
| `SalesService.pay` : historique et déduction de stock pour les ventes restaurant                | Déduction à l'encaissement d'une vente jamais envoyée en cuisine            |
| `SalePricingService` : instruction par ligne ; doublon autorisé si les instructions diffèrent   | « Burger » et « burger sans oignon » sur la même commande                   |
| Catalogue vendable extrait (`sellable-catalog.ts`)                                              | Partagé par la caisse et le menu public (pas de duplication)                |
| `PrintJobsService` : type `KITCHEN` ; `PosTerminal.kitchenPrinter`                              | Tickets cuisine sur le connecteur du Sprint 3                               |
| Throttler : troisième limite `publicOrder`                                                      | Demandes publiques limitées par IP sans toucher aux autres limites          |
| `EstablishmentScope` générique (web)                                                            | Partagé par le parc et le restaurant (pas de duplication)                   |

## Points d'attention connus

### Reportés de CP-03 (toujours ouverts)

| Anomalie                                                                     | Gravité                 | État au Sprint 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 — arrêts des serveurs E2E sans sortie                                     | Haute                   | Ouvert, avec une **preuve nouvelle** : le 30/10/2026, le processus Jest des tests d'intégration s'est arrêté sans sortie après trois fichiers verts, avec le code Windows `0xC0000409` (STATUS_STACK_BUFFER_OVERRUN). Journal : `test-logs/integration-2026-10-30T11-12-00-733Z.log`. C'est le même symptôme que les arrêts des serveurs E2E, mais cette fois avec un code de sortie, qui oriente vers un module natif (moteur Prisma sous Windows, ou Node 24) plutôt que vers le code applicatif. À instruire : version de Node, moteur Prisma (bibliothèque ou binaire), reproduction en boucle. La sortie des serveurs est désormais visible dans le journal Playwright |
| A2 — transaction bloquée 732 s                                               | Haute                   | Ouvert : non reproduit ; aucune borne côté PostgreSQL ajoutée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A3 — délai des transactions à 15 s                                           | Moyenne                 | Ouvert : inchangé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A4 — latence Neon `us-east-2`, région de production                          | Moyenne                 | Ouvert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A5 — matériel (connecteur Android non compilé, QR et imprimantes non testés) | Haute (mise en service) | Ouvert : les tickets cuisine utilisent l'imprimante simulée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A6 — remboursement d'un billet annulé                                        | Basse                   | Hors périmètre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Nouveaux points du Sprint 5

| Sujet                                                      | Gravité                                       | Détail                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A7 — bus temps réel en mémoire                             | Moyenne (avant passage à plusieurs instances) | Correct pour une seule instance d'API. Plusieurs instances nécessiteraient un canal partagé (`LISTEN/NOTIFY` sur connexion directe, ou Redis)                                                                                                     |
| A8 — démarrage E2E interrompu : base injoignable (`P1001`) | À surveiller                                  | Une fois, au lancement de l'API sur Neon `test` (`test-logs/e2e-s5-2026-10-30T11-00-31-805Z.log`) ; TCP rétabli quelques secondes plus tard, relance verte. Distinct de A1 : le serveur n'a pas démarré, il ne s'est pas arrêté en cours de route |
| A9 — limite par IP des demandes QR                         | Basse                                         | Les clients d'un même Wi-Fi partagent une IP : limite fixée à 30 demandes par 10 min et par IP, complétée par le plafond par table. À ajuster après observation réelle                                                                            |
| A10 — heures des réservations                              | Basse                                         | Saisies et affichées dans le fuseau de l'appareil, identique à celui des établissements actuels (UTC+0). À revoir pour un établissement dans un autre fuseau                                                                                      |
| Choix métier à confirmer                                   | —                                             | Une commande envoyée puis annulée n'est pas recréditée en stock (ingrédients considérés comme utilisés) ; une vente peut rendre un stock négatif (alerte)                                                                                         |

Les journaux `test-logs/` ne sont pas versionnés : ils sont disponibles sur le poste de développement.

## Critères proposés pour un GO

- Toutes les commandes de vérification au vert.
- Aucune anomalie critique de sécurité : isolation des flux temps réel, endpoints publics, RBAC,
  prix, double déduction de stock, double réservation.
- A1 et A2 : cause établie ou plan d'investigation accepté ; aucune clôture fondée uniquement sur des
  exécutions vertes.
- A5 : validation matérielle (imprimante cuisine comprise) planifiée avant toute mise en service.
