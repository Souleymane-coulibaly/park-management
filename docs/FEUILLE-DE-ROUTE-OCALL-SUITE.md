# Ocall Suite — feuille de route

Chantiers validés. **Aucun ne démarre sans autorisation explicite**, et rien n'est déployé en préproduction ou en
production sans accord. État au 18/11/2026, `main` à `be26d3b`.

Le détail d'Ocall School est dans [OCALL-SCHOOL-FEUILLE-DE-ROUTE.md](OCALL-SCHOOL-FEUILLE-DE-ROUTE.md). La dette
connue est dans [DETTE-TECHNIQUE.md](DETTE-TECHNIQUE.md).

## Vue d'ensemble

| Réf.  | Chantier                                                                 | État                                                      |
| ----- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| R-001 | Stockage objet R2 de préproduction (DT-001)                              | **Reporté**, prioritaire (décision du 17/11/2026)         |
| R-002 | Audit responsive sous Chromium Linux : Parc, Restaurant, School, Facture | **Audit en lecture seule en cours** (17/11/2026)          |
| R-003 | Ocall Parc : événements et abonnements                                   | Pass livrés ; événements E1 à E4 développés (branche)     |
| R-004 | Ocall School                                                             | Livré dans `main` ; grille par site en préproduction      |
| R-005 | Ocall Restaurant (application indépendante)                              | Publié en préproduction, grille par site                  |
| R-006 | Interconnexion Facture ↔ Stock (et Parc ↔ Stock)                         | Facture ↔ Stock livré sur un emplacement ; suite à cadrer |
| R-007 | Facturation multi-sites                                                  | Grille par site active en préproduction (5 applications)  |
| R-008 | Ocall Print                                                              | À cadrer ; contrat de données préparé                     |
| R-009 | Sabatii                                                                  | À cadrer                                                  |
| R-010 | PWA et hors ligne                                                        | PWA Parc livrée ; contrôle hors ligne étudié, non activé  |
| R-011 | Préparation commerciale et mise en production                            | J1 et J2 livrés dans `main` ; production à planifier      |

## R-001 — Stockage objet R2 de préproduction

Voir [DT-001](DETTE-TECHNIQUE.md#dt-001--stockage-objet-de-préproduction-inutilisable-prioritaire). Les
identifiants S3/R2 de préproduction ne sont pas valides. Les photos de titulaire de pass, les logos Facture et
tous les fichiers stockés échouent. Le chantier est reporté. La liste des tests à rejouer est dans DT-001.

## R-002 — Audit responsive sous Chromium Linux

- **Origine** : correctif CI Stock du 17/11/2026 (`7ef3e3e`). Sous Chromium Linux (le moteur d'Android), 4 pages
  Stock débordaient de 17 px sur téléphone. Sous Windows, elles ne débordaient pas.
- **Cause type** : une grille de formulaire sans colonne explicite sous le point de rupture (`grid` +
  `sm:grid-cols-N`, sans `grid-cols-1`). Elle s'élargit à la largeur minimale d'une liste déroulante ou d'un
  champ, et cette largeur dépend de la plateforme.
- **Périmètre** : Ocall Parc, Ocall Restaurant, Ocall School et Ocall Facture, sur ordinateur et sur téléphone.
- **Méthode** : image Docker Playwright Linux contre les serveurs locaux, sur une base jetable ; mesure de chaque
  page ; relevé de chaque élément qui dépasse.
- **Ordre** : l'audit en lecture seule vient d'abord. Les corrections ne commencent qu'après validation, en
  réutilisant les composants existants, avec des vérifications E2E de débordement.

## R-003 — Ocall Parc : événements et abonnements

- **Livré** : les pass et abonnements visiteurs du sprint 8 (journalier, hebdomadaire, mensuel, annuel ; QR
  dynamique ; quotas multi-parcs). Le code est dans `main` (`01390a5`) et déployé en préproduction. Voir
  [PASS-ABONNEMENTS-PARC.md](PASS-ABONNEMENTS-PARC.md).
- **À faire** :
  - Rejouer en préproduction les cas avec photo, après R-001.
- **Événements (lots E1 à E4)** : développés sur la branche `claude/parc-evenements`, non fusionnés.
  Billets datés par séance, distincts des pass ; capacité par séance et quotas par tarif, réservation
  atomique à l'encaissement ; prénom facultatif ; contrôle selon la séance avec tolérance ; annulation
  avec la liste des acheteurs ; suivi ; agenda sur la vitrine. Voir [EVENEMENTS-PARC.md](EVENEMENTS-PARC.md).
- **Reporté** :
  - formule billet + repas (décision D7 de la séparation Parc/Restaurant) ;
  - vente et renouvellement en ligne (décision D11 du sprint 8), y compris les billets d'événement ;
  - billet sur téléphone et envoi des billets, remboursement, vente à la borne, places numérotées.

## R-004 — Ocall School

- **Livré dans `main`** :
  - sprints 1 à 10 (PR #7) ;
  - crédits SMS, notifications et renouvellements (Suite S2) ;
  - rattachement des écoles au référentiel commun des sites (Suite 2B).
- **Préproduction (18/11/2026)** : grille par site active pour les nouveaux clients, forfaits retirés du
  catalogue. Les contrats existants sont inchangés. L'offre gratuite School Free (contrat, jusqu'à 50 élèves
  actifs, sans SMS) est conservée et vérifiée : le 51e élève est refusé.
- **À faire** : décider de la suite et la planifier dans
  [OCALL-SCHOOL-FEUILLE-DE-ROUTE.md](OCALL-SCHOOL-FEUILLE-DE-ROUTE.md).

## R-005 — Ocall Restaurant

- **Livré** (étape 7, `5dcf13c`) :
  - Parc et Restaurant sont deux applications indépendantes, avec leurs propres droits et abonnements ;
  - les contrats combinés existants sont conservés ;
  - la bascule d'un contrat combiné est explicite ;
  - les interconnexions (clients, fidélité, paiements, caisse, statistiques) sont conservées.
- **Préproduction (J1, 18/11/2026)** : Ocall Restaurant est publié au catalogue sur la grille par site ; un
  restaurant seul démarre son essai sans contrat combiné. L'offre « Parc + Restaurant »
  (`OCALL_PARK_RESTAURANT`) est hors catalogue, sans offre active ; les contrats combinés existants et leurs
  droits sont conservés, sans changement de prix.
- **À faire** : reproduire ce réglage en production, avec la mise en production (R-011).

## R-006 — Interconnexion Facture ↔ Stock (et Parc ↔ Stock)

- **Livré** :
  - Facture ↔ Stock par ports et file de messages (articles miroirs, mouvements, factures de ventes Stock) ;
  - établissement émetteur Facture, figé à l'émission.
- **À faire** : un emplacement Stock par établissement émetteur. Aujourd'hui, toute l'organisation partage un
  seul emplacement (`factureLocationId`).
- **Reporté** : Parc ↔ Stock (étape 7 de l'audit multi-sites), tant qu'une architecture garantissant la
  cohérence entre ventes et stock n'est pas validée.

## R-007 — Facturation multi-sites

- **Livré** (étape 6, `6d184c1`) :
  - offres par site ;
  - activations de site et prorata ;
  - lignes « sites supplémentaires » et « vitrine ».
- **Commercialisation J1** (`d1eb5ab`) : un nouvel essai prend l'offre par site dès qu'Ocall a retiré tous les
  forfaits d'une application ; aucun client n'est basculé automatiquement.
- **Préproduction** : grille par site active et forfaits retirés du catalogue sur les cinq applications —
  Stock, Facture et Restaurant (J2), Parc et School (18/11/2026). Empreinte des contrats existants identique
  avant et après chaque activation.
- **Tarifs confirmés** :
  - par application : 17 500 FCFA par mois pour le premier site, 7 500 FCFA par site supplémentaire ;
  - vitrine : +5 000 FCFA par mois et par application ;
  - installation : 150 000 FCFA pour la première application, puis 112 500 FCFA.
- **Clients historiques (décision du 18/11/2026)** : ils gardent leur forfait, leurs prix et leurs contrats,
  et restent gérés par Ocall. Un client en essai sur un forfait retiré ne peut pas l'activer lui-même
  (`PLAN_NOT_FOUND`) ; Ocall l'active depuis l'administration. Pas d'auto-activation des anciens forfaits.
- **À faire** :
  - activer la grille en production, avec la mise en production (R-011) ;
  - organiser le passage volontaire des clients existants vers la grille, seulement après une transition
    acceptée.

## R-008 — Ocall Print

- **Définition** : personnalisation, commande et impression de cartes pour School, Parc et Sabatii, plus un
  portail autonome gratuit.
- **Préparé** :
  - le contrat de données `ocall-print/pass-card@1` (cartes de pass Parc) ;
  - `PassCard.printRequestedAt` ;
  - les connecteurs du tableau de bord de l'organisation, prévus pour accueillir de futures applications.
- **À faire** : audit et cadrage avant tout développement.

## R-009 — Sabatii

- **Définition** : fidélité, carte QR universelle, points par enseigne, plusieurs boutiques.
- **Tarif décidé** : gratuit jusqu'à 10 clients actifs, puis 5 000 FCFA par mois. Ce n'est pas le tarif standard.
- **À faire** : audit et cadrage avant tout développement. Le chantier réutilise le référentiel des sites et les
  connecteurs du tableau de bord.

## R-010 — PWA et hors ligne

- **Livré** : PWA de contrôle du parc (installation, mise à jour, état du réseau). Voir [PWA-PARC.md](PWA-PARC.md).
- **Étudié, non activé** : contrôle d'accès hors ligne. Voir [CONTROLE-HORS-LIGNE.md](CONTROLE-HORS-LIGNE.md).
  Cela demande un QR vérifiable sans serveur, une liste de révocation, une file d'envoi chiffrée et un mode limité
  dans le temps. Les risques de double entrée sont à accepter explicitement avant de lancer ce chantier.
- **À faire** :
  - décider de l'extension de la PWA aux autres applications ;
  - décider s'il faut lancer le hors ligne.

## R-011 — Préparation commerciale et mise en production

- **Pilote** de 3 à 5 établissements : voir [PILOTE.md](PILOTE.md).
- **Production** : voir [PRODUCTION.md](PRODUCTION.md). Restent à faire :
  - supervision et alertes ;
  - test de restauration ;
  - application des migrations accumulées depuis Suite S1 (production non migrée ni déployée depuis).
- **Commercial, livré dans `main` (`be26d3b`)** :
  - J1 : lancement de la grille par site, Ocall Restaurant indépendant ;
  - J2 : identité légale Ocall, pages légales, factures (définitives ou provisoires) et reçus d'abonnement en
    PDF ;
  - préproduction : les cinq applications en vente sur la grille par site, Ocall Stock compris.
- **Commercial, à faire** :
  - saisir l'identité légale d'Ocall, avant toute facture définitive ;
  - décider de la TVA sur les abonnements ;
  - fournir les textes CGU, cadre légal de la confidentialité et À propos.
- **Reporté** : envoi des e-mails (Resend), fichiers (R2), environnement de production.
- **Prérequis** : R-001 avant toute ouverture (identifiants R2 valides en production) ; R-002 corrigé.
