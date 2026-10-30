# Bornes de commande, CRM, fidélité et planning du personnel (Sprint 6)

Le Sprint 6 reste dans le monolithe modulaire existant : aucun microservice, aucune nouvelle
application. Il réutilise :

- les commandes du Sprint 5 ;
- le moteur de vente commun (`SalesService`) ;
- les employés et les rôles du Sprint 1.

Les modules sont activés selon le métier de l'organisation, qui correspond à l'offre d'abonnement :

| Module              | Activité requise | Permission de base                                                  |
| ------------------- | ---------------- | ------------------------------------------------------------------- |
| Bornes              | Restaurant       | `kiosk.manage`                                                      |
| Clients et fidélité | Tous les métiers | `customer.read`                                                     |
| Planning            | Tous les métiers | `dashboard.read` pour son planning, `planning.manage` pour l'équipe |

## Bornes de commande libre-service (`/kiosk`, administration `/app/bornes`)

### Parcours

1. Un propriétaire ou un administrateur (`kiosk.manage`) crée une borne pour **un** établissement
   restaurant. Il obtient un **code d'appairage** :
   - 8 caractères sans ambiguïté (pas de 0/O, ni de 1/I/L) ;
   - valable 15 minutes, à usage unique ;
   - affiché une seule fois.
2. Sur la tablette, `/kiosk` en plein écran (mode kiosque du navigateur ou épinglage d'écran
   Android) : saisie du code. La borne reçoit un **jeton d'appareil** de 256 bits, dans un cookie :
   - `httpOnly`, `SameSite=Strict`, `Secure` en production ;
   - limité au chemin `/api/v1/kiosk` ;
   - expiration : 180 jours.
3. Le client touche l'écran, ce qui ouvre une **session de borne** : une commande au plus, 15
   minutes au plus.
4. Il compose sa commande : catalogue, catégories, photos, variantes, quantités, instructions.
5. Il la valide et reçoit un **numéro** (« B-0042 »), qui reste affiché 20 s, puis l'écran revient à
   l'accueil.
6. La commande est une **demande en attente de paiement à la caisse**. Elle suit le parcours du
   Sprint 5 :
   - un employé la valide (canal `KIOSK`, non payée, non envoyée en cuisine) ;
   - il l'encaisse ;
   - il l'envoie explicitement en cuisine.

   **Aucun paiement n'est simulé. Le paiement ne déclenche jamais la préparation.**

### Sécurité

| Exigence                                      | Mise en œuvre                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mode kiosque, jamais d'écran d'administration | `/kiosk` n'a aucun lien. Le jeton d'appareil n'est pas une session d'employé : toute route `/api/v1` hors `/kiosk` répond 401 (testé). La tablette n'a pas de session (`/app` → connexion) |
| Association à un établissement                | Fixée à la création de la borne ; l'établissement doit être actif et exercer l'activité restaurant                                                                                         |
| Jeton révocable et limité                     | Seul le hash SHA-256 du jeton est stocké. Expiration à 180 jours. Révocation immédiate : jeton et code effacés, sessions closes                                                            |
| Secrets                                       | Aucun secret serveur exposé ; le code et le jeton ne sont jamais renvoyés après coup                                                                                                       |
| Isolation                                     | La borne ne vend que les articles de son établissement ; une autre organisation ne voit ni ne gère ses bornes (404)                                                                        |
| Fin de session                                | Retour à l'accueil après 90 s d'inactivité (avertissement 15 s avant) ou après la confirmation. Le panier et le prénom sont effacés, la session est close côté serveur                     |
| Commandes répétées                            | Une commande par session (contrainte d'unicité) ; clé d'idempotence (un renvoi réseau rend le même numéro) ; 30 commandes au plus par borne et par 10 minutes                              |
| Perte de connexion                            | Écran « Connexion perdue » et validation suspendue ; reprise avec la même clé, donc sans doublon                                                                                           |
| Appairage par force brute                     | 31⁸ codes possibles, 15 minutes, usage unique, limite stricte par IP (même limite que la connexion)                                                                                        |

### Photos des produits

Le champ « Photo (adresse https) » du catalogue accepte uniquement une URL https de 500 caractères au
plus. **Limite :** aucun stockage de fichiers n'est configuré, il n'y a donc pas d'envoi d'image
depuis le poste.

## CRM (`/app/clients`)

### Fiches

- La fiche client est au niveau de l'organisation (partagée par ses établissements).
- **Toutes les informations sont facultatives** ; un nom **ou** un téléphone suffit. Le téléphone est
  normalisé et unique dans l'organisation.
- **Consentement obligatoire** pour créer une fiche (date enregistrée). Le consentement aux offres est
  facultatif et daté. **Aucune campagne SMS ou WhatsApp** n'existe.
- La fiche affiche :
  - les soldes de fidélité ;
  - l'historique des achats (ventes payées) ;
  - le nombre de visites, la dernière visite et les dépenses cumulées ;
  - les mouvements de points.
- Recherche par nom ou téléphone ; filtres : avec des points, accepte les offres, sans visite depuis
  90 jours.

### Protection des données

| Rôle                                              | Accès                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Caissier (`customer.read`, `customer.manage`)     | **Recherche** uniquement : 3 caractères au moins, 10 résultats. Ni liste complète, ni remarques, ni historique, ni dépenses |
| Superviseur (`customer.history`)                  | Liste complète, historique (ventes de ses établissements), dépenses                                                         |
| Propriétaire et administrateur (`customer.erase`) | Anonymisation et règle de conservation, en plus des accès précédents                                                        |
| Cuisine, agent d'entrée                           | Aucun accès                                                                                                                 |

- **Demande de suppression** : anonymisation irréversible.
  - Le nom, le téléphone, les remarques et le consentement aux offres sont effacés, et les points sont
    annulés.
  - Les ventes restent (comptabilité) sans personne identifiable.
- **Conservation** : les fiches sans visite depuis **36 mois** sont anonymisées. Un administrateur
  applique la règle depuis « Programmes de fidélité ». Aucune tâche planifiée n'existe encore dans le
  projet : c'est une limite connue.
- Le journal d'audit ne contient **aucune donnée personnelle** (identifiants et motifs seulement,
  testé).

## Fidélité Parc et Restaurant

### Principes

- Il y a **deux portefeuilles par client** : Parc et Restaurant.
- Une organisation parc + restaurant garde deux soldes indépendants, **sans aucun transfert**.
- Chaque vente alimente le portefeuille de son activité (`Sale.activity`).

### Règles par activité (`/app/clients/fidelite`, permission `loyalty.configure`)

- État : actif ou inactif.
- Montant payé pour 1 point (par exemple 1 000 FCFA).
- Valeur d'un point utilisé (par exemple 10 FCFA).
- Minimum de points pour une utilisation.

### Garanties

| Exigence                                  | Mise en œuvre                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Points uniquement après paiement effectif | Crédit dans la **transaction du paiement**, sur le **montant réellement payé** (après remise). Une vente impayée ou annulée ne rapporte rien (testé)                                                                      |
| Pas de double crédit                      | Clé unique `earn:<vente>`, vérification sous le verrou de la vente. Un paiement rejoué en simultané ou un rattachement tardif du client, même rejoué, ne crédite qu'une fois (testé)                                      |
| Rattachement tardif                       | Client rattaché à une vente déjà payée : crédit une fois. Le client d'une vente payée ne change plus (`CUSTOMER_LOCKED`)                                                                                                  |
| Utilisation des points                    | Remise **calculée par le serveur** sur une vente non payée : `points × valeur`, jamais au-delà du total (`EXCEEDS_TOTAL`), au moins le minimum. Le total de la vente est recalculé ; aucun montant ne vient du navigateur |
| Jamais de solde négatif                   | Débit conditionnel (`balance >= points`) : deux utilisations simultanées ne peuvent pas passer toutes les deux (testé). **Contrainte CHECK** en base en dernier recours (testée)                                          |
| Annulation                                | Retrait de la remise avant paiement, ou annulation de la vente non payée : points recrédités (`REVERSAL`), total rétabli                                                                                                  |
| Remboursements                            | Une vente payée ne s'annule pas et il n'existe pas de remboursement (fonctionnalité absente) : aucun débit de points n'est donc prévu pour ce cas                                                                         |
| Correction manuelle                       | `loyalty.adjust` (propriétaire et administrateur) : motif obligatoire, idempotente, auditée, sans solde négatif                                                                                                           |
| Articles figés                            | Une commande avec remise ne peut plus changer d'articles (`LOYALTY_APPLIED`) sans retirer d'abord la remise                                                                                                               |

À la caisse et à la billetterie, la fenêtre d'encaissement propose « Client et fidélité » :
recherche, création rapide avec consentement, rattachement, solde, utilisation de points. Le ticket
de caisse imprime la ligne « Remise fidélité ».

## Planning du personnel (`/app/personnel/planning`)

- Il est volontairement simple : **pas** de pointage, d'absences, de congés, de calcul de salaire, de
  paie ni d'évaluation.
- **Postes** configurables :
  - postes par défaut : caisse, cuisine, entrée, surveillance, entretien ;
  - autres postes à ajouter librement ;
  - désactivation plutôt que suppression.
- Un **créneau** associe un employé, un poste, un établissement, un début, une fin et une remarque.
  - Un « planning » journalier, hebdomadaire ou mensuel est l'ensemble des créneaux de la période :
    il n'y a pas de table séparée. Les modèles `StaffSchedule` et `StaffAssignment` demandés sont
    couverts par `StaffPosition` et `StaffAssignment`.
- **Vues** jour, semaine et mois, avec le total des heures planifiées par employé.
  - Les responsables (`planning.manage` : propriétaire, administrateur, superviseur) planifient dans
    leurs établissements.
  - **Chaque employé voit son propre planning** (`/planning/me`).
- **Chevauchements interdits** pour un même employé, **tous établissements confondus**, sur des
  intervalles `[début, fin[`. Des créneaux bout à bout sont acceptés.
  - Le contrôle se fait sous verrou de l'adhésion de l'employé : deux saisies simultanées donnent un
    seul créneau (testé).
  - Une contrainte CHECK garantit fin > début ; un créneau dure au plus 16 h.
  - Un employé doit être affecté à l'établissement, sauf pour le propriétaire et l'administrateur.
- Toute création, modification ou suppression est **journalisée**.

## Données

Migration `20261030142337_bornes_crm_fidelite_planning`, additive, avec des contraintes CHECK
ajoutées à la main.

- **Nouvelles tables** :
  - `KioskDevice`, `KioskSession` ;
  - `Customer` ;
  - `LoyaltyRule`, `LoyaltyWallet`, `LoyaltyTransaction` ;
  - `StaffPosition`, `StaffAssignment`.
- **Nouvelles colonnes**, facultatives ou avec valeur par défaut :
  - `Sale.customerId`, `loyaltyDiscount`, `loyaltyPointsRedeemed` ;
  - `QrOrderRequest.source`, `kioskDeviceId`, `kioskSessionId` (unique), `displayNumber` ;
  - `Establishment.orderRequestSeq` ;
  - `Product.imageUrl`.
- **Valeur d'énumération ajoutée** : `OrderChannel.KIOSK`.
- **Contraintes CHECK** :
  - `LoyaltyWallet.balance >= 0` ;
  - `StaffAssignment.endsAt > startsAt`.
- Les modèles de commandes, paiements, utilisateurs et établissements ne sont pas dupliqués.

## API (`/api/v1`, Swagger)

| Route                                                                                                      | Permission                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `GET/POST /kiosk-devices`, `POST …/:id/pairing-code`, `POST …/:id/revoke`                                  | `kiosk.manage`                        |
| `POST /kiosk/pair`                                                                                         | public, limite stricte                |
| `GET /kiosk/me`, `/kiosk/menu`, `POST /kiosk/sessions`, `…/:id/orders`, `…/:id/end`                        | jeton d'appareil                      |
| `GET/POST /customers`, `GET/PATCH /customers/:id`                                                          | `customer.read` / `customer.manage`   |
| `POST /customers/:id/anonymize`, `POST /customers/retention/apply`                                         | `customer.erase`                      |
| `GET /loyalty/rules`, `PUT /loyalty/rules/:activity`                                                       | `customer.read` / `loyalty.configure` |
| `POST /loyalty/adjustments`                                                                                | `loyalty.adjust`                      |
| `PUT /sales/:id/customer`, `POST/DELETE /sales/:id/loyalty-redemption`                                     | `pos.sell` + `customer.read`          |
| `GET /planning/me`                                                                                         | `dashboard.read`                      |
| `GET/POST/PATCH /planning/positions`, `GET /planning/staff`, `GET/POST/PATCH/DELETE /planning/assignments` | `planning.manage`                     |
