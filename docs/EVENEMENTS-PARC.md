# Événements du parc et billetterie événementielle (lots E1 à E4)

Ocall Parc vend des billets **datés** pour des événements (concert, spectacle, festival, nocturne
payante…). Ce sont des **billets**, distincts des pass : un billet par visiteur, une seule entrée, valable
pour une séance. Tout réutilise la billetterie existante : tarifs (`TicketCategory`), vente et
encaissement (moteur de caisse commun), émission au paiement, QR, impression, contrôle d'accès et
annulation. Aucun nouveau module : le code vit dans `modules/ticketing` et `modules/ticket-issuance`.

## Parcours

1. **Responsable** (`ticketing.manage`), page `/app/billetterie/evenements` :
   - crée l'événement (brouillon), avec sa **tolérance d'entrée** : entrée acceptée N minutes avant le
     début (60 par défaut) et jusqu'à N minutes après la fin (0 par défaut) ;
   - ajoute les **séances** : date, début, fin (une fin antérieure au début = lendemain), **capacité
     globale** ;
   - ajoute les **tarifs** : prix, personnes incluses, **quota facultatif par séance**, billet
     **nominatif** ou non (prénom facultatif par défaut) ;
   - **publie** (au moins une séance à venir et un tarif actif), suspend la vente (brouillon) ou archive ;
   - ferme ou rouvre la vente d'une séance, modifie ses horaires ou sa capacité ;
   - **annule une séance** avec un motif.
2. **Caissier** (`pos.sell`), guichet `/app/billetterie`, onglet **Événements** :
   - choisit l'événement, la séance (places restantes affichées), puis les tarifs ;
   - prénoms facultatifs pour un billet non nominatif, obligatoires sinon ;
   - **acheteur facultatif** (fiche client), pour le contacter en cas d'annulation ;
   - encaisse : billets émis et imprimés (« BILLET ÉVÉNEMENT », nom de l'événement et séance).
3. **Agent d'entrée** (`access.scan`) : même écran de contrôle ; le résultat affiche l'événement et la
   séance.
4. **Suivi** (`sale.read_all`) : fiche de l'événement — places vendues, entrées, billets annulés, chiffre
   d'affaires ; par séance : remplissage, entrées, attendus ou absents, annulations, ventes par tarif ;
   liste des **acheteurs** de chaque séance.
5. **Public** : le site vitrine du parc affiche l'**agenda** des événements publiés (séances à venir,
   « Complet », tarifs indicatifs), sans vente en ligne.

## Règles garanties par l'API

| Règle                                | Mise en œuvre                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pas de survente**                  | Au paiement, dans la transaction de l'encaissement : chaque séance vendue est verrouillée (`SELECT … FOR UPDATE`, ordre stable), puis la capacité et les quotas sont vérifiés sur les billets émis non annulés. Dépassement : `409 EVENT_SOLD_OUT` ou `EVENT_TARIFF_SOLD_OUT`, rien n'est encaissé ni émis. Le contrôle à la commande n'informe que le caissier. |
| Place                                | Un billet individuel (une formule famille de 4 = 4 places). Un billet annulé libère sa place.                                                                                                                                                                                                                                                                    |
| Billet daté                          | Validité = séance élargie de la tolérance. Avant : `NOT_YET_VALID` ; après : `EXPIRED`.                                                                                                                                                                                                                                                                          |
| Horaires                             | Un billet d'événement suit sa séance, pas les horaires du parc (une nocturne se contrôle même parc « fermé »). Les billets du jour restent soumis aux horaires du parc.                                                                                                                                                                                          |
| Vente                                | Séance programmée, vente ouverte, événement publié, séance non terminée ; sinon `409 EVENT_SESSION_NOT_ON_SALE`. Une commande peut mêler billets du jour et billets d'événement.                                                                                                                                                                                 |
| Changement d'horaire ou de tolérance | La validité des billets encore valides est recalculée dans la même transaction (journalisé).                                                                                                                                                                                                                                                                     |
| Capacité                             | Jamais sous les places vendues (`409 EVENT_CAPACITY_BELOW_SOLD`).                                                                                                                                                                                                                                                                                                |
| Annulation de séance                 | Motif obligatoire ; vente fermée ; billets valides annulés en lot (« Séance annulée : motif ») ; billet déjà utilisé conservé ; vente non payée de la séance impossible à encaisser (`EVENT_SESSION_CANCELLED`) ; liste des acheteurs renvoyée. **Aucun remboursement automatique.**                                                                             |
| Billetterie classique                | Les tarifs d'événement n'apparaissent ni dans les tarifs du parc, ni au guichet du jour, ni sur la vitrine (section Tarifs), ni dans l'import IA ; ils ne se modifient que par l'événement. Le compteur « billets non utilisés » du tableau du jour exclut les billets d'événement.                                                                              |
| Isolation                            | Événements, séances et tarifs filtrés par organisation et par établissements du membre ; tarif d'une autre organisation : `EVENT_TARIFF_UNAVAILABLE`.                                                                                                                                                                                                            |
| Journal                              | Création, modification, statut, séances, annulation (nombre de billets annulés), émission.                                                                                                                                                                                                                                                                       |

## API (`/api/v1`, Swagger « Billetterie — événements »)

| Méthode et route                                          | Permission         | Rôle                                                   |
| --------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| `GET /ticketing/event-catalog?establishmentId`            | `pos.sell`         | Événements en vente, séances, places restantes         |
| `POST /ticketing/quote`, `POST /ticketing/orders`         | `pos.sell`         | Lignes avec `eventSessionId` ; `customerId` facultatif |
| `GET /ticketing/events?establishmentId[&includeArchived]` | `sale.read_all`    | Liste                                                  |
| `GET /ticketing/events/:id`                               | `sale.read_all`    | Détail : séances (vendues, restantes), tarifs          |
| `GET /ticketing/events/:id/dashboard`                     | `sale.read_all`    | Suivi par séance et par tarif                          |
| `GET /ticketing/events/:id/sessions/:sessionId/buyers`    | `sale.read_all`    | Acheteurs d'une séance                                 |
| `POST /ticketing/events`, `PATCH /ticketing/events/:id`   | `ticketing.manage` | Création, modification, statut                         |
| `POST/PATCH /ticketing/events/:id/sessions[/:sessionId]`  | `ticketing.manage` | Séances                                                |
| `POST /ticketing/events/:id/sessions/:sessionId/cancel`   | `ticketing.manage` | Annulation motivée                                     |
| `POST/PATCH /ticketing/events/:id/tariffs[/:tariffId]`    | `ticketing.manage` | Tarifs                                                 |
| `GET /public/sites/:slug`                                 | public             | `events` : agenda du parc (lu en direct)               |

## Données (migration `20261219000000_parc_evenements`, additive)

- Tables `ParkEvent` et `ParkEventSession` (jamais supprimés : archivé, annulée).
- `TicketCategory` : `eventId`, `eventScope`, `sessionQuota`, `requiresVisitorName` (valeurs par défaut :
  tarif classique, prénom obligatoire). L'unicité du nom passe de (établissement, nom) à (établissement,
  portée, nom) : le nouvel index est créé avant la suppression de l'ancien, sans modifier aucune ligne.
- `SaleLine.eventSessionId`, `Ticket.eventSessionId` (facultatifs).
- Contraintes `CHECK` : cohérence de la portée, quota et capacité positifs, fin après le début, tolérance
  de 0 à 720 minutes, prénom facultatif réservé aux tarifs d'événement.

## Reste à valider en conditions réelles

- Impression des billets d'événement sur les imprimantes 58 et 80 mm réelles.
- Affluence à l'entrée d'un événement (plusieurs agents, réseau 4G).
- Vente en ligne, billet sur téléphone, envoi par SMS, WhatsApp ou e-mail, remboursement, vente à la
  borne, places numérotées, pass donnant accès aux événements, formule billet + repas : **hors V1**.
