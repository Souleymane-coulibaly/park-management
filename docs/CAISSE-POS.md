# Caisse POS — règles et architecture (Sprint 2)

La caisse est disponible pour les organisations dont le métier couvre l'activité **Restaurant**
(`RESTAURANT` ou `PARK_RESTAURANT`), dans les établissements restaurant actifs. Le contrôle est fait
par l'API sur chaque route (`@RequireActivity('RESTAURANT')`) : une organisation `PARK` reçoit
`403 MODULE_NOT_IN_PLAN`, quelle que soit l'interface utilisée.

## Parcours

1. **Catalogue** (`/app/catalogue`) : catégories → produits → variantes (au moins une, ex.
   « Standard ») → un tarif par variante **et par établissement** (FCFA, TTC). Un prix absent = la
   variante n'est pas vendue dans cet établissement. Rien n'est supprimé : produits, variantes et
   catégories sont désactivés, car les ventes passées y font référence.
2. **Ouverture de caisse** (`/app/caisse`) : l'employé déclare son fond de caisse. Une seule session
   ouverte par employé.
3. **Vente** : la tablette n'envoie que `variantId` et `quantity`. Le serveur lit les tarifs de
   l'établissement, calcule lignes et total (`computeSaleTotals`) et fige libellés et prix sur la vente.
4. **Encaissement** en espèces : montant remis ≥ total ; la monnaie rendue est calculée par le serveur.
5. **Fermeture** : l'employé saisit les espèces comptées. Espèces attendues = fond + encaissements en
   espèces de la session ; écart = compté − attendu (négatif = manque). Tout est historisé (session et
   journal d'audit).

## Règles métier garanties par l'API

| Règle                                                     | Mise en œuvre                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Montants calculés uniquement par le serveur               | Tout champ de prix envoyé par le client est refusé (`400 VALIDATION_ERROR`)                                                                                                                                                         |
| **Paiement et préparation indépendants**                  | `paymentStatus` et `preparationStatus` sont deux champs distincts ; l'encaissement ne modifie jamais `preparationStatus` (`NOT_SENT` par défaut). Seul un envoi explicite en cuisine (module KDS, sprint ultérieur) le fera évoluer |
| Pas de double vente ni de double paiement (réseau mobile) | Clé d'idempotence `clientRequestId` sur la vente et sur le paiement ; verrou de ligne sur la vente pendant l'encaissement                                                                                                           |
| Une seule fermeture de caisse                             | Verrou de ligne sur la session ; `409 CASH_SESSION_CLOSED` ensuite                                                                                                                                                                  |
| Vente impossible sans caisse ouverte                      | `409 CASH_SESSION_REQUIRED`                                                                                                                                                                                                         |
| Annulation                                                | Uniquement une vente **non payée**, par un rôle `sale.cancel` (superviseur, admin, propriétaire)                                                                                                                                    |
| Isolation multi-tenant                                    | Toutes les requêtes filtrent par `organizationId` de la session ; ressource étrangère → 404                                                                                                                                         |

## Permissions

| Permission       | OWNER | ADMIN | SUPERVISOR | CASHIER | KITCHEN |
| ---------------- | :---: | :---: | :--------: | :-----: | :-----: |
| `catalog.read`   |   ✔   |   ✔   |     ✔      |    ✔    |    ✔    |
| `catalog.manage` |   ✔   |   ✔   |            |         |         |
| `pos.sell`       |   ✔   |   ✔   |     ✔      |    ✔    |         |
| `sale.read_all`  |   ✔   |   ✔   |     ✔      |         |         |
| `sale.cancel`    |   ✔   |   ✔   |     ✔      |         |         |
| `cash.supervise` |   ✔   |   ✔   |     ✔      |         |         |

Un caissier ne voit que ses propres ventes et sessions, dans ses établissements affectés. Un rôle de
supervision peut fermer la caisse d'un employé de son périmètre.

## Wave : architecture préparatoire, aucun accès actif

- `PaymentProvider` (`apps/api/src/modules/payments/payment-provider.ts`) définit la création d'une
  session de paiement et la lecture d'une notification **dont la signature est vérifiée**.
- `PaymentMethodsService` n'annonce un moyen électronique comme disponible que si un fournisseur est
  réellement enregistré. **Aucun ne l'est** : `GET /payments/methods` renvoie Wave `available: false`,
  et un paiement Wave est refusé (`409 PAYMENT_METHOD_UNAVAILABLE`). Rien n'est simulé.
- Le modèle `Payment` porte déjà `method` (`CASH` / `WAVE`), `status` (`PENDING` / `SUCCEEDED` /
  `FAILED`) et `providerReference`, pour accueillir le flux asynchrone de Wave.
- Règles pour l'intégration future : montant toujours issu du serveur, confirmation uniquement par
  notification serveur à serveur vérifiée, et jamais de modification du statut de préparation.

## Points d'API

| Méthode    | Route                                                  | Rôle                                       |
| ---------- | ------------------------------------------------------ | ------------------------------------------ |
| GET        | `/catalog/categories`, `/catalog/products`             | Catalogue de l'organisation                |
| POST/PATCH | `/catalog/categories[/:id]`, `/catalog/products[/:id]` | Gestion (`catalog.manage`)                 |
| GET        | `/pos/establishments`                                  | Établissements où encaisser                |
| GET        | `/pos/catalog?establishmentId=`                        | Articles vendables de l'établissement      |
| POST       | `/pos/quote`                                           | Montants d'un panier (sans enregistrement) |
| GET        | `/cash-sessions/current?establishmentId=`              | Session ouverte et totaux en cours         |
| POST       | `/cash-sessions`, `/cash-sessions/:id/close`           | Ouverture, fermeture avec écart            |
| POST       | `/sales`, `/sales/:id/payments`, `/sales/:id/cancel`   | Vente, encaissement, annulation            |
| GET        | `/sales`, `/sales/:id`, `/cash-sessions`               | Historiques (selon permissions)            |
| GET        | `/payments/methods`                                    | Moyens de paiement et disponibilité réelle |

## Hors périmètre du Sprint 2

Impression thermique, tiroir-caisse, remises, TVA détaillée, remboursement d'une vente payée,
paiement partiel ou multiple, envoi en cuisine (KDS) et mode hors ligne.
