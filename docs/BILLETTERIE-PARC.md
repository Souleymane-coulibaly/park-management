# Billetterie du parc, QR codes et contrôle d'accès (Sprint 4)

La billetterie est disponible pour les organisations dont le métier couvre l'activité **Parc**
(`PARK` ou `PARK_RESTAURANT`), dans les établissements parc actifs. L'API le vérifie sur chaque route
(`@RequireActivity('PARK')`) : une organisation `RESTAURANT` reçoit `403 MODULE_NOT_IN_PLAN`.

## Parcours

1. **Tarifs** (`/app/billetterie/configuration`, permission `ticketing.manage`) : catégories Adulte,
   Enfant, Famille, Groupe ou Personnalisée, avec prix, **personnes incluses** (une famille de 4 = 4 billets),
   conditions, période de vente et durée de validité. Une catégorie n'est jamais supprimée : elle est
   désactivée. Un nouveau prix ne concerne que les ventes suivantes.
2. **Horaires** (même écran) : semaine type, puis **dates particulières** (fermeture exceptionnelle,
   horaires spéciaux, nocturne) qui priment sur la semaine. Sans horaire configuré, le parc est
   considéré ouvert en permanence. Fuseau : celui de l'établissement (`Africa/Bamako` par défaut).
3. **Vente** (`/app/billetterie`, permission `pos.sell`) : session de caisse ouverte (la même que la
   caisse restaurant), grandes tuiles tactiles, **prénom obligatoire pour chaque visiteur**, total
   calculé par le serveur, encaissement en espèces par le moteur de paiement commun.
4. **Billets** : émis **uniquement** dans la transaction qui confirme le paiement. Un billet par
   visiteur, chacun avec son QR code, affichés à l'écran et imprimés (58 ou 80 mm).
5. **Contrôle des entrées** (`/app/controle-acces`, permission `access.scan`) : caméra arrière ou
   saisie manuelle, résultat en très grand (vert / rouge + motif), historique des passages.
6. **Tableau de bord** (`/app/billetterie/tableau`, permission `sale.read_all`) : billets vendus,
   entrées, billets non utilisés, chiffre d'affaires, ventes par catégorie, activité par heure,
   comparaison avec la veille.

## Règles garanties par l'API

| Règle                                     | Mise en œuvre                                                                                                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aucun prix du navigateur ne fait autorité | La commande ne contient que `ticketCategoryId`, `quantity`, `visitorNames` ; tout autre champ → `400`. Prix lus en base, totaux par `computeSaleTotals`                                                                                               |
| Pas de billet avant paiement              | Les billets sont créés dans la transaction de `POST /sales/:id/payments` ; une vente non payée n'a aucun billet, donc aucun QR                                                                                                                        |
| Émission idempotente                      | Contrainte unique `(saleLineId, position)` ; un paiement rejoué (même `clientRequestId`, y compris en simultané) renvoie le paiement existant sans réémettre                                                                                          |
| **Une seule entrée par billet**           | Passage `VALID → USED` par une mise à jour conditionnelle (`UPDATE … WHERE status = 'VALID'`) : PostgreSQL verrouille la ligne, la seconde transaction ne trouve plus le billet valide. Garde-fou de schéma : `TicketScan.acceptedForTicketId` unique |
| QR sans donnée sensible                   | Contenu : `OCP1-` + jeton aléatoire de 128 bits (base64url, 22 caractères). Ni nom, ni prix, ni identifiant interne, ni signature dérivée d'un secret                                                                                                 |
| QR falsifié ou d'une autre organisation   | Refusé « Billet inconnu », sans aucun détail                                                                                                                                                                                                          |
| Agent de l'établissement A, billet de B   | Refusé « Billet d'un autre établissement » ; l'agent ne peut pas se déclarer sur un établissement qui ne lui est pas affecté (404)                                                                                                                    |
| Expiration                                | Vérifiée à chaque scan (`validUntil`) ; le statut passe à `EXPIRED` à ce moment                                                                                                                                                                       |
| Parc fermé                                | Vente refusée si le parc n'ouvre pas ce jour (`409 PARK_CLOSED`) ; entrée refusée hors horaires (`PARK_CLOSED`)                                                                                                                                       |
| **Parc + restaurant**                     | Les horaires du parc ne sont lus que par la billetterie et le contrôle d'accès : fermer le parc ne ferme jamais le restaurant (testé)                                                                                                                 |
| Hors connexion                            | Aucune validation locale : l'écran de contrôle refuse de valider et le signale                                                                                                                                                                        |
| Annulation d'un billet                    | Permission `ticket.cancel`, motif obligatoire, billet `VALID` uniquement (atomique), auditée. Remboursement : hors périmètre                                                                                                                          |
| Réimpression                              | Permission `receipt.reprint`, motif obligatoire, mention DUPLICATA ; tous les billets ou **un seul** (`ticketId`) ; les billets annulés ne sont plus imprimés                                                                                         |
| Journalisation                            | Chaque scan (accepté ou refusé) est enregistré dans `TicketScan` ; tarifs, horaires, émissions et annulations dans le journal d'audit                                                                                                                 |

## Statuts et motifs de refus

Billet : `VALID`, `USED`, `EXPIRED`, `CANCELLED`.
Refus : `ALREADY_USED`, `EXPIRED`, `CANCELLED`, `UNKNOWN`, `OTHER_ESTABLISHMENT`, `PARK_CLOSED`,
`NOT_YET_VALID`.

Validité : du début du jour de la vente (heure locale) à la fin du dernier jour de validité
(`validityDays`). Le prix d'une formule est réparti entre ses billets ; le reste de la division va au
premier billet (10 000 FCFA pour 3 → 3 334 + 3 333 + 3 333).

## Permissions

| Permission         | OWNER | ADMIN | SUPERVISOR | CASHIER | GATE_AGENT |
| ------------------ | :---: | :---: | :--------: | :-----: | :--------: |
| `pos.sell`         |   ✔   |   ✔   |     ✔      |    ✔    |            |
| `access.scan`      |   ✔   |   ✔   |     ✔      |         |     ✔      |
| `ticket.cancel`    |   ✔   |   ✔   |     ✔      |         |            |
| `ticketing.manage` |   ✔   |   ✔   |            |         |            |
| `sale.read_all`    |   ✔   |   ✔   |     ✔      |         |            |
| `receipt.reprint`  |   ✔   |   ✔   |     ✔      |         |            |

Hors OWNER / ADMIN, un membre n'agit que dans les établissements qui lui sont affectés.

## API (`/api/v1`, documentée dans Swagger, tag « Billetterie » et « Contrôle d'accès »)

| Méthode et route                             | Permission         | Rôle                                                     |
| -------------------------------------------- | ------------------ | -------------------------------------------------------- |
| `GET /ticketing/establishments`              | `pos.sell`         | Parcs où vendre                                          |
| `GET /ticketing/catalog?establishmentId`     | `pos.sell`         | Catégories en vente aujourd'hui, état d'ouverture        |
| `POST /ticketing/quote`                      | `pos.sell`         | Montants calculés par le serveur (rien n'est enregistré) |
| `POST /ticketing/orders`                     | `pos.sell`         | Vente `PARK` non payée (idempotente)                     |
| `POST /sales/:id/payments`                   | `pos.sell`         | Encaissement (moteur commun) → émission des billets      |
| `GET /tickets?saleId`                        | `pos.sell`         | Billets d'une vente visible, avec contenu du QR          |
| `POST /tickets/:id/cancel`                   | `ticket.cancel`    | Annulation motivée                                       |
| `GET/POST/PATCH /ticketing/categories`       | `ticketing.manage` | Tarifs                                                   |
| `GET /ticketing/schedule`                    | `ticketing.manage` | Horaires, état d'ouverture                               |
| `PUT /ticketing/schedule/weekly`             | `ticketing.manage` | Semaine type (liste complète)                            |
| `POST/DELETE /ticketing/schedule/exceptions` | `ticketing.manage` | Dates particulières                                      |
| `GET /ticketing/dashboard?establishmentId`   | `sale.read_all`    | Indicateurs du jour et de la veille                      |
| `GET /access/establishments`                 | `access.scan`      | Parcs où contrôler                                       |
| `POST /access/scans`                         | `access.scan`      | Scan (toujours 200 ; résultat et motif dans la réponse)  |
| `GET /access/scans?establishmentId`          | `access.scan`      | Historique des passages                                  |
| `POST /print-jobs` (`ticketId` optionnel)    | `pos.sell`         | Impression des billets (réimpression d'un seul billet)   |

## Données (migration `20261029234320_billetterie_parc`, additive)

Nouvelles tables `TicketCategory`, `Ticket`, `TicketScan`, `ParkOpeningSchedule`,
`ParkCalendarException` ; nouvelles colonnes avec valeur par défaut (`Sale.activity`,
`SaleLine.ticketCategoryId/peoplePerUnit/visitorNames`, `PrintJob.ticketId`) ; `SaleLine.variantId`
devient facultatif. Aucune suppression de table, de colonne ni de donnée.

Les ventes restaurant et parc partagent `Sale`, `Payment` et `CashSession` ; `Sale.activity` les
distingue, y compris dans le chiffre d'affaires du tableau de bord principal.

## Reste à valider sur matériel réel

- **Scan caméra** : détecteur natif (Chrome Android) ou décodeur `jsqr` ; exige HTTPS. Testé en
  automatique par la saisie manuelle uniquement (même chemin serveur). À vérifier sur la tablette des
  agents : distance, lumière du jour, billet froissé, QR affiché sur un téléphone.
- **Impression des QR** (`GS ( k`, modèle 2, correction M) sur les imprimantes 58 et 80 mm réelles :
  lisibilité du QR imprimé par la caméra, coupe entre billets.
- Temps de passage à l'entrée en conditions réelles (réseau 4G).
