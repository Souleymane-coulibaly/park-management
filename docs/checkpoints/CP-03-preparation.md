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
pnpm build; pnpm test:e2e        # journal complet dans test-logs/ (résultat dans SPRINT_STATUS.md)
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
| `PrismaService` : délai des transactions interactives 15 s (attente 10 s)                             | Défaut Prisma 5 s dépassé par un encaissement de billets avec la latence Neon `us-east-2` ; verrous toujours bornés                                                      |
| Paiement rejoué en simultané avec la même clé → renvoie le paiement existant                          | Avant : la seconde requête recevait `409 SALE_ALREADY_PAID` au lieu du paiement déjà enregistré                                                                          |
| Briques de caisse partagées (`components/pos/cash-session.tsx`)                                       | Extraites de `register.tsx`, réutilisées par la billetterie (aucune duplication)                                                                                         |

## Points d'attention connus

| Sujet                                                         | État                                                   | Référence                                            |
| ------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Scan caméra et impression des QR non testés sur matériel réel | Ouvert — validation sur tablette et imprimantes        | `docs/BILLETTERIE-PARC.md` (dernière section)        |
| Connecteur Android non compilé (Sprint 3)                     | Ouvert — validation matérielle requise                 | `docs/MATERIEL-POS.md` §7                            |
| Remboursement d'un billet annulé                              | Hors périmètre (annulation seule, auditée)             | `docs/BILLETTERIE-PARC.md`                           |
| Transaction Prisma bloquée 732 s (Sprint 2, 1 occurrence)     | Non reproduit (Sprints 3 et 4) ; délai désormais borné | `test-logs/integration-2026-10-29T20-33-12-703Z.log` |
| Latence Neon `us-east-2` (~300 ms par requête)                | Accepté en test ; région à choisir pour la production  | `docs/DEPLOIEMENT-RAILWAY.md` §8                     |

Les journaux `test-logs/` ne sont pas versionnés : ils sont disponibles sur le poste de développement.

## Critères proposés pour un GO

- Toutes les commandes de vérification au vert.
- Aucune anomalie critique de sécurité (isolation, RBAC, double entrée, QR, secrets).
- Validation matérielle (Sprint 3) et validation caméra / impression QR (Sprint 4) planifiées avant
  toute mise en service sur site.
