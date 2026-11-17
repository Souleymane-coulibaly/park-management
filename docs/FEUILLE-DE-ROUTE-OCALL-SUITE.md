# Ocall Suite — feuille de route

Chantiers validés. **Aucun ne démarre sans autorisation explicite**, et rien n'est déployé en préproduction ou en
production sans accord. État au 17/11/2026, `main` à `7ef3e3e`.

Le détail d'Ocall School est dans [OCALL-SCHOOL-FEUILLE-DE-ROUTE.md](OCALL-SCHOOL-FEUILLE-DE-ROUTE.md). La dette
connue est dans [DETTE-TECHNIQUE.md](DETTE-TECHNIQUE.md).

## Vue d'ensemble

| Réf.  | Chantier                                                                 | État                                                      |
| ----- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| R-001 | Stockage objet R2 de préproduction (DT-001)                              | **Reporté**, prioritaire (décision du 17/11/2026)         |
| R-002 | Audit responsive sous Chromium Linux : Parc, Restaurant, School, Facture | **Audit en lecture seule en cours** (17/11/2026)          |
| R-003 | Ocall Parc : événements et abonnements                                   | Pass et abonnements livrés ; événements à cadrer          |
| R-004 | Ocall School                                                             | Livré dans `main` ; suite à décider                       |
| R-005 | Ocall Restaurant (application indépendante)                              | Séparation livrée ; offres inactives                      |
| R-006 | Interconnexion Facture ↔ Stock (et Parc ↔ Stock)                         | Facture ↔ Stock livré sur un emplacement ; suite à cadrer |
| R-007 | Facturation multi-sites                                                  | Moteur livré ; offres par site inactives                  |
| R-008 | Ocall Print                                                              | À cadrer ; contrat de données préparé                     |
| R-009 | Sabatii                                                                  | À cadrer                                                  |
| R-010 | PWA et hors ligne                                                        | PWA Parc livrée ; contrôle hors ligne étudié, non activé  |
| R-011 | Préparation commerciale et mise en production                            | À planifier                                               |

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
  - Cadrer les **événements**. Les pass savent déjà porter un jour unique et des jours autorisés ; une offre
    « événement » réutilisera les mêmes règles, quotas et contrôle d'accès.
- **Reporté** :
  - formule billet + repas (décision D7 de la séparation Parc/Restaurant) ;
  - vente et renouvellement en ligne (décision D11 du sprint 8).

## R-004 — Ocall School

- **Livré dans `main`** :
  - sprints 1 à 10 (PR #7) ;
  - crédits SMS, notifications et renouvellements (Suite S2) ;
  - rattachement des écoles au référentiel commun des sites (Suite 2B).
- **À faire** : décider de la suite (formules, offre gratuite jusqu'à 50 élèves conservée) et la planifier dans
  [OCALL-SCHOOL-FEUILLE-DE-ROUTE.md](OCALL-SCHOOL-FEUILLE-DE-ROUTE.md).

## R-005 — Ocall Restaurant

- **Livré** (étape 7, `5dcf13c`) :
  - Parc et Restaurant sont deux applications indépendantes, avec leurs propres droits et abonnements ;
  - les contrats combinés existants sont conservés ;
  - la bascule d'un contrat combiné est explicite ;
  - les interconnexions (clients, fidélité, paiements, caisse, statistiques) sont conservées.
- **À faire** :
  - activer commercialement les offres Restaurant, aujourd'hui inactives ;
  - retirer l'offre « Parc + Restaurant » (`OCALL_PARK_RESTAURANT`), par migration non destructive des contrats
    existants et sans changement automatique de prix.

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
  - offres par site **inactives** ;
  - activations de site et prorata ;
  - lignes « sites supplémentaires » et « vitrine ».
- **Tarifs confirmés** :
  - par application : 17 500 FCFA par mois pour le premier site, 7 500 FCFA par site supplémentaire ;
  - vitrine : +5 000 FCFA par mois et par application ;
  - installation : 150 000 FCFA pour la première application, puis 112 500 FCFA.
- **À faire** :
  - activer commercialement les offres par site ;
  - organiser le passage volontaire des clients existants, qui gardent leurs prix et contrats jusqu'à une
    transition acceptée.

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
- **Commercial** :
  - activation des offres (R-005, R-007) ;
  - page de tarifs publique ;
  - mise en vente d'Ocall Stock et d'Ocall Facture (aujourd'hui en préproduction ou « à venir »).
- **Prérequis** : R-001 avant toute ouverture (identifiants R2 valides en production) ; R-002 corrigé.
