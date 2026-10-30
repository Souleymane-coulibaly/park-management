# Restaurant : commandes, cuisine, QR, tables, stocks et réservations (Sprint 5)

Le module restaurant est disponible pour les organisations dont le métier couvre l'activité
**Restaurant** (`RESTAURANT` ou `PARK_RESTAURANT`), dans les établissements qui exercent cette
activité. L'API le vérifie à chaque requête :

- `@RequireActivity('RESTAURANT')` sur chaque route, sinon `403 MODULE_NOT_IN_PLAN` ;
- un établissement « parc seul » d'une organisation parc + restaurant est refusé avec
  `400 ESTABLISHMENT_NOT_RESTAURANT` ;
- les organisations `PARK` gardent la caisse et l'impression pour la billetterie (Sprint 4), sans
  aucune fonction de vente restaurant.

Tout est construit sur le **moteur de vente commun** des Sprints 2 et 4 (`SalesService.createSale`,
paiement `SalesService.pay`) : il n'existe pas de seconde logique de prix ou de paiement.

## Règle critique : paiement et préparation sont indépendants

| Statut             | Valeurs                                                            | Qui le fait évoluer                                    |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Paiement (`Sale`)  | `UNPAID` → `PAID` ; `CANCELLED` (vente non payée)                  | Encaissement (moteur commun), annulation `sale.cancel` |
| Préparation        | `NOT_SENT` → `SENT` → `IN_PREPARATION` → `READY` → `SERVED`        | Envoi explicite, cuisine, salle (voir ci-dessous)      |
| Demande QR (avant) | `PENDING_VALIDATION` → `ACCEPTED` (devient une vente) / `REJECTED` | Employé (`pos.sell`)                                   |

- **Payer n'envoie jamais en cuisine** : `pay()` ne touche pas `preparationStatus` (testé).
- **« Envoyer en cuisine »** est une action explicite (`POST /orders/:id/send-to-kitchen`, permission
  `order.send_kitchen`), indépendante du paiement : une commande sur place part en cuisine avant
  d'être réglée, une vente au comptoir peut être payée sans jamais aller en cuisine.
- Transitions : `send` (salle) ; `start` et `ready` (cuisine, `kitchen.update`) ; `serve` (salle,
  après `READY`). « Prête » est possible sans « en préparation ».
- **Idempotence** : une action rejouée ou dépassée (envoyer une commande déjà en cuisine, marquer
  prête une commande servie) ne modifie rien et renvoie `changed: false`. Chaque transition verrouille
  la ligne de la vente (`SELECT … FOR UPDATE`) : deux envois simultanés produisent une seule transition.
- **Historique** : chaque création, modification, transition, paiement, annulation et validation QR
  est enregistré dans `OrderEvent` (consultable dans le détail de la commande). Les actions sensibles
  (envoi en cuisine, modification, décision QR) sont aussi dans le journal d'audit.

## Commandes (`/app/caisse` et `/app/commandes`)

- **Canaux** : sur place (`DINE_IN`, table ou zone facultative), à emporter (`TAKEAWAY`), comptoir
  (`COUNTER`), QR code (`QR`, uniquement par validation d'une demande client).
- **Contenu** : numéro unique par établissement, établissement, produits, variantes, quantités,
  instruction par ligne, instruction générale, table ou zone, canal, montants calculés par le serveur,
  statuts de paiement et de préparation, historique.
- **Prix** : le navigateur n'envoie que `variantId`, `quantity` et `notes` (tout autre champ → `400`).
  Les libellés et prix sont **figés sur la ligne de vente** à la commande : un changement de tarif
  ultérieur ne modifie pas une commande existante (testé). Un même article peut figurer sur deux
  lignes uniquement si leurs instructions diffèrent.
- **Modification** (`PATCH /orders/:id`) : articles et instructions modifiables tant que la
  commande n'est **ni payée ni envoyée** (montants recalculés) ; table modifiable tant qu'elle n'est
  pas payée. Après paiement : `409 ORDER_LOCKED_PAID` ; articles après envoi : `409 ORDER_LOCKED_SENT`.
- La caisse (`/app/caisse`) propose trois actions explicites : **Encaisser**, **Envoyer en cuisine**,
  **Enregistrer** (sans encaisser). La page `/app/commandes` suit en direct les commandes non servies
  ou non payées et les demandes QR à valider.

## Écran cuisine KDS (`/app/cuisine`)

- Colonnes « À préparer », « En préparation », « Prêtes » ; numéro, articles, variantes, quantités,
  instructions, table ou zone, heure de réception et durée d'attente (mise en évidence après 15 min).
- **Jamais une commande non envoyée** : l'API ne renvoie que `SENT`, `IN_PREPARATION` et `READY`
  (les commandes prêtes restent affichées 6 h au plus). Aucun prix n'est transmis à la cuisine.
- **Temps réel : Server-Sent Events (SSE)** plutôt que WebSockets. Le flux passe par le proxy
  Next.js existant (`/api/v1/*`), il est authentifié par le cookie de session httpOnly, et le
  navigateur se reconnecte seul. Aucune dépendance nouvelle n'est nécessaire.
  - `GET /kitchen/stream?establishmentId=` (`kitchen.view`) et `GET /orders/stream` (`pos.sell`).
  - L'établissement est contrôlé comme pour l'API REST : un cuisinier ne s'abonne qu'à un
    établissement qui lui est affecté, une autre organisation reçoit `404`.
  - Les évènements ne contiennent que des identifiants (`type`, `saleId`, `requestId`, `at`) :
    l'écran recharge les données par l'API REST, soumise aux contrôles habituels.
  - Un battement toutes les 25 s revérifie la session, le rôle et l'affectation. Une session révoquée
    ferme le flux (testé).
- **Reconnexion** : le message `ready` est émis à chaque (re)connexion et l'écran recharge alors sa
  file complète, si bien qu'aucune commande envoyée pendant une coupure n'est perdue. Côté navigateur :
  - perte du réseau : état « Reconnexion » affiché immédiatement, avec rechargement de secours toutes
    les 15 s ;
  - retour du réseau : réouverture immédiate du flux ;
  - flux silencieux depuis 60 s : réouverture.

  Ce comportement est testé dans le navigateur avec une vraie coupure (Playwright `setOffline`).

- **Limite connue** : le bus d'évènements est en mémoire, ce qui suffit pour une seule instance d'API
  (déploiement actuel). Avec plusieurs instances, il faudra un canal partagé (PostgreSQL
  `LISTEN/NOTIFY` sur connexion directe, ou Redis).

## Commandes par QR code (sans compte)

- Chaque **table** et chaque **zone** (ex. bord de piscine, sans table précise) a un QR code. Son URL
  `/commande/<jeton>` ne contient qu'un jeton aléatoire de 128 bits, régénérable : l'ancien QR cesse
  alors immédiatement de fonctionner.
- Le menu public (`GET /public/menu/:token`) affiche l'établissement, la table ou la zone, et les
  produits disponibles. Il n'expose aucun identifiant interne.
- Le client choisit variantes, quantités et instructions, puis envoie une **demande**
  (`POST /public/menu/:token/orders`). La demande **n'est ni payée ni envoyée en cuisine**.
- Un employé la **valide** (`POST /orders/qr-requests/:id/accept`, session de caisse ouverte) :
  - elle devient une commande QR non payée, non envoyée en cuisine, dont les prix sont recalculés à
    la validation ;
  - l'employé l'envoie ensuite en cuisine explicitement ;
  - il peut aussi la **refuser** avec un motif, que le client voit.
- Le client suit sa demande sur `/commande/suivi/<jeton>`, avec un rafraîchissement toutes les 10 s.
- **Protection anti-abus** :
  - jetons imprévisibles ;
  - limite par IP de 30 demandes par 10 minutes (`PUBLIC_ORDER_THROTTLE_LIMIT`) ;
  - 5 demandes en attente au plus par table ou zone (sous verrou) ;
  - 30 lignes et 20 unités par ligne au plus ;
  - clé d'idempotence obligatoire (un double envoi ne crée pas de doublon) ;
  - prix toujours calculés par le serveur ;
  - champs inconnus refusés ;
  - table hors service ou établissement non restaurant : réponse « introuvable », sans détail.

## Salles, zones et tables (`/app/restaurant/tables`, permission `tables.manage`)

- **Zones** : salle, terrasse, bord de piscine, espace personnalisé. Elles sont facultatives : un
  restaurant fonctionne sans zone et sans bord de piscine.
- **Tables** : nom ou numéro, zone, couverts, statut calculé (libre, occupée par une commande en
  cours, réservée dans l'heure, hors service), QR code (affichage, impression, régénération) et nombre
  de commandes en cours.

## Stocks (`/app/stocks`)

- Articles et ingrédients par établissement : quantité (décimal exact, 3 décimales), unité (pièce,
  g, kg, ml, cl, l), seuil d'alerte, **coût d'achat facultatif**. Un coût inconnu reste inconnu, aucun
  coût n'est estimé.
- Mouvements en ajout seul :
  - entrée (`IN`) et sortie (`OUT`) : permission `stock.move` ; une sortie ne peut pas dépasser la
    quantité disponible ;
  - ajustement d'inventaire (`ADJUSTMENT`) : permission `stock.manage`, quantité comptée, écart
    enregistré et audité ;
  - consommation par les ventes (`SALE`) ;
  - historique complet.
- **Recettes simples** : quantité d'ingrédient consommée par unité vendue d'une variante, pour un
  établissement donné.
- **Moment de la déduction** : à la **première** de ces deux actions, l'envoi en cuisine ou le
  paiement. Une commande en salle consomme ses ingrédients à l'envoi en cuisine ; une vente au
  comptoir jamais envoyée les consomme à l'encaissement.
  - Une commande envoyée puis annulée (non payée) **n'est pas recréditée** : les ingrédients sont
    considérés comme utilisés.
  - Une vente peut faire passer un stock sous zéro (signalé par l'alerte) : on ne bloque pas une vente
    pour un inventaire inexact.
- **Pas de double déduction**, à deux niveaux :
  1. `Sale.stockDeductedAt` est revendiqué par une mise à jour conditionnelle ;
  2. chaque mouvement porte une clé unique `sale:<vente>:<article>`.

  Un envoi en cuisine et un paiement simultanés ne déduisent qu'une fois (testé). Les saisies manuelles
  sont idempotentes par clé client.

- **Alertes** : quantité au niveau du seuil ou en dessous, visibles dans la liste et le tableau de
  bord.

## Réservations (`/app/reservations`, permission `reservation.manage`)

- **Contenu** : nom du client, téléphone facultatif, date et heure, durée (90 min par défaut),
  nombre de personnes, table ou zone, remarque.
- **Statuts** : en attente, confirmée, annulée, terminée, non présentée.
- **Aucun conflit** : deux réservations actives (en attente ou confirmée) ne peuvent pas occuper la
  même table sur des créneaux qui se chevauchent, intervalles `[début, fin[`. Des créneaux bout à bout
  sont acceptés.
  - Le contrôle se fait sous verrou de la table, dans la transaction : deux saisies simultanées du
    même créneau donnent une seule réservation (testé).
  - Annuler ou terminer une réservation libère le créneau ; la remettre en « confirmée » est refusé
    si le créneau a été repris.
- **Vues** : liste et calendrier hebdomadaire. Les heures sont saisies et affichées dans le fuseau de
  l'appareil, Africa/Bamako (UTC+0) pour les établissements actuels.

## Tickets cuisine

Ils réutilisent le connecteur et l'historique d'impression du Sprint 3, avec le type `PrintJob`
`KITCHEN`.

- **Contenu** : numéro, articles, quantités, variantes, instructions, table ou zone, date et heure
  d'envoi, en gros caractères. **Aucun prix.**
- L'imprimante de cuisine est un poste avec l'option « Imprimante de la cuisine » (`kitchenPrinter`).
- **Impression uniquement après l'envoi explicite en cuisine** (`409 ORDER_NOT_SENT` sinon). Elle est
  lancée automatiquement après « Envoyer en cuisine ».
- Une réimpression porte la mention RÉIMPRESSION.
- **Un échec d'impression ne modifie ni la commande ni son paiement** (testé).
- **Limite matérielle** : le connecteur Android du Sprint 3 n'est toujours ni compilé ni testé sur
  matériel. Les tests utilisent l'imprimante **simulée**, clairement identifiée (anomalie A5 du CP-03).

## Tableau de bord (`/app/restaurant/tableau`, permission `sale.read_all`)

Il couvre la journée en cours, dans le fuseau de l'établissement.

- **CA encaissé** : somme des paiements réussis du jour sur les ventes restaurant. Une vente impayée
  n'y figure jamais. Une vente n'y compte qu'une fois, car l'idempotence garantit un seul paiement
  (testé avec un paiement rejoué en simultané).
- Commandes du jour, panier moyen.
- Commandes en attente et en préparation, demandes QR à valider.
- Temps moyen de préparation, de l'envoi à « prête ».
- Produits les plus vendus.
- Alertes de stock.

Les analyses avancées (par produit, par heure, sur une période) relèvent du Sprint 9.

## Permissions

| Permission           | OWNER | ADMIN | SUPERVISOR | CASHIER | KITCHEN |
| -------------------- | :---: | :---: | :--------: | :-----: | :-----: |
| `pos.sell`           |   ✔   |   ✔   |     ✔      |    ✔    |         |
| `order.send_kitchen` |   ✔   |   ✔   |     ✔      |    ✔    |         |
| `kitchen.view`       |   ✔   |   ✔   |     ✔      |         |    ✔    |
| `kitchen.update`     |   ✔   |   ✔   |     ✔      |         |    ✔    |
| `reservation.manage` |   ✔   |   ✔   |     ✔      |    ✔    |         |
| `stock.read`         |   ✔   |   ✔   |     ✔      |         |    ✔    |
| `stock.move`         |   ✔   |   ✔   |     ✔      |         |         |
| `stock.manage`       |   ✔   |   ✔   |            |         |         |
| `tables.manage`      |   ✔   |   ✔   |            |         |         |
| `sale.read_all`      |   ✔   |   ✔   |     ✔      |         |         |

- Hors propriétaire et administrateur, un membre n'agit que dans les établissements qui lui sont
  affectés.
- Un caissier ne voit que ses propres commandes.
- La cuisine voit toutes les commandes envoyées de ses établissements, sans prix.

## API (`/api/v1`, Swagger : tags « Restaurant — … » et « Commande par QR code »)

| Méthode et route                                                                                  | Permission                        |
| ------------------------------------------------------------------------------------------------- | --------------------------------- |
| `GET/POST /orders`, `GET/PATCH /orders/:id`                                                       | `pos.sell`                        |
| `POST /orders/:id/send-to-kitchen`, `/serve`                                                      | `order.send_kitchen`              |
| `GET /orders/stream` (SSE)                                                                        | `pos.sell`                        |
| `GET /orders/qr-requests`, `POST …/:id/accept                                                     | reject`                           | `pos.sell` |
| `GET /kitchen/orders`, `GET /kitchen/stream` (SSE)                                                | `kitchen.view`                    |
| `POST /kitchen/orders/:id/start`, `/ready`                                                        | `kitchen.update`                  |
| `GET /restaurant/establishments`                                                                  | `dashboard.read`                  |
| `GET /restaurant/dining`                                                                          | `pos.sell`                        |
| `POST/PATCH /restaurant/zones`, `/tables`, `…/regenerate-qr`                                      | `tables.manage`                   |
| `GET /restaurant/dashboard`                                                                       | `sale.read_all`                   |
| `GET/POST /stock/items`, `PATCH /stock/items/:id`                                                 | `stock.read` / `stock.manage`     |
| `POST /stock/movements`, `GET /stock/movements`                                                   | `stock.move` / `stock.read`       |
| `GET /stock/recipes`, `PUT /stock/recipes/:variantId`                                             | `stock.read` / `stock.manage`     |
| `GET/POST /reservations`, `PATCH /reservations/:id`                                               | `reservation.manage`              |
| `GET /public/menu/:token`, `POST /public/menu/:token/orders`, `GET /public/order-requests/:token` | public                            |
| `POST /print-jobs` (`kind: KITCHEN`)                                                              | `pos.sell` + `order.send_kitchen` |

## Données (migrations `20261030100338_restaurant_commandes_cuisine_stocks_reservations` et `20261030120121_ordre_lignes_vente`, additives)

- **Nouvelles tables** : `OrderEvent`, `DiningZone`, `DiningTable`, `QrOrderRequest`, `StockItem`,
  `StockMovement`, `RecipeComponent`, `Reservation`.
- **Nouvelles colonnes facultatives** : `Sale.channel/tableId/zoneId/notes`, horodatages de
  préparation, `stockDeductedAt` ; `SaleLine.notes` ; `PosTerminal.kitchenPrinter`, avec valeur par
  défaut.
- **Valeurs ajoutées aux énumérations** : `PreparationStatus.IN_PREPARATION`, `PrintJobKind.KITCHEN`.
- `SaleLine.lineNo` : rang de saisie, qui donne un ordre stable aux tickets, aux billets et aux écrans.
- Aucune suppression de table, de colonne ni de donnée.
