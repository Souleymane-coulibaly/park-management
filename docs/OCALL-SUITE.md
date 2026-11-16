# Ocall Suite — administration centrale (Sprint 11A)

Espace `/admin`, réservé aux comptes internes Ocall. Il ne donne aucun accès aux données métier des
clients (ventes, tickets, clients finaux) : seulement organisations, abonnements, factures et
règlements.

## Principe commercial

> **Sprint 12A** : les règlements sont désormais **déclarés puis confirmés par une autre personne**
> (virement, espèces avec reçu numéroté) ou payés **en ligne** (vérification serveur). L'activation
> suit le **mode figé** de l'abonnement (AUTO ou ADMIN_APPROVAL). Les étapes 3 et 4 ci-dessous sont
> remplacées par [GUIDE-PAIEMENT-MANUEL.md](GUIDE-PAIEMENT-MANUEL.md) et
> [PAIEMENT-EN-LIGNE.md](PAIEMENT-EN-LIGNE.md). Aucun prélèvement ni renouvellement automatique.

1. **Souscription** : fiche organisation → « Ajouter un produit » (produits commercialisés
   uniquement). L'abonnement est créé **non activé**.
2. **Facture** : « Factures » → « Émettre une facture ». Lignes : mise en service, mensualités
   (1 à 24), ajustement motivé. Les montants sont calculés par le serveur au tarif accepté. Une
   nouvelle tentative après une erreur réseau renvoie la même facture (clé d'idempotence).
3. **Règlement** : « Règlements » → « Saisir un règlement », en choisissant la facture. Le montant
   doit être égal au reste à payer.
4. **Validation** : après vérification de la réception, « Valider », en cochant éventuellement
   « Activer / prolonger l'abonnement ». La facture passe à « Payée ». À la première activation, le
   tarif de l'offre est **figé** sur l'abonnement : un changement de prix ultérieur de l'offre ne
   modifie pas les factures suivantes de ce client.

Annulation d'une facture : motif obligatoire, impossible dès qu'un règlement y est rattaché.

## Produits

| Code                    | Statut                               |
| ----------------------- | ------------------------------------ |
| `OCALL_PARK`            | Commercialisé                        |
| `OCALL_RESTAURANT`      | Commercialisé                        |
| `OCALL_PARK_RESTAURANT` | Commercialisé                        |
| `OCALL_SCHOOL`          | À venir : visible, non souscriptible |

Une organisation a au plus un abonnement par produit, et un seul produit de la famille Ocall Park
(lié à son métier). Un produit ne passe « commercialisé » qu'avec au moins une offre active.

Les offres d'un produit hors famille Ocall Park se créent dans « Produits » → « Ajouter une offre ».
Les offres Ocall Park (une par métier, utilisées à l'inscription) se modifient seulement, dans
« Abonnements et offres » : prix, mise en service et **quotas** (appels IA par mois, stockage en Mo).

## Tableau de bord commercial

- **Encaissé** : règlements **validés** sur la période (mise en service, mensualités, ajustements ;
  « sans facture » pour le registre historique).
- **Facturé** : factures émises non annulées sur la période.
- **MRR théorique** : tarifs acceptés des abonnements actifs. C'est un montant contractuel, pas un
  encaissement.
- **Impayés** : factures émises non payées, dont la part échue.

## Rôles internes

| Rôle                   | Accès                                                                                                   | MFA         |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| Propriétaire           | Tout, y compris les comptes internes                                                                    | Obligatoire |
| Administrateur délégué | Tout sauf les comptes internes                                                                          | Obligatoire |
| Facturation            | Tableau de bord, organisations, abonnements, factures, règlements, espèces, activations, démonstrations | Obligatoire |
| Assistance             | Tableau de bord, organisations, domaines, **support**, démonstrations                                   | Facultative |
| Consultation et audit  | Lecture : tableau de bord, organisations, facturation, audit, paramètres                                | Facultative |

Quotas et purge du stockage : propriétaire et administrateur délégué.

Les comptes sont nominatifs, avec un mot de passe temporaire changé à la première connexion. Le rôle
propriétaire ne s'attribue jamais depuis l'application, et personne ne modifie son propre compte.
Toute modification (rôle, désactivation, réinitialisation de la MFA) ferme les sessions de la
personne et est journalisée. Le compte historique `SUPER_ADMIN` est traité comme le propriétaire.

## Double authentification (TOTP)

- **Enrôlement** à la première connexion : scanner le code QR avec une application
  d'authentification, saisir le premier code, puis conserver les **10 codes de secours**, affichés
  une seule fois.
- **À chaque connexion**, un code à 6 chiffres ou un code de secours est demandé. Chaque code de
  secours ne sert qu'une fois, et un même code TOTP n'est pas accepté deux fois.
- Une MFA activée volontairement par un rôle « facultatif » devient obligatoire pour ce compte.
- **Téléphone perdu** : utiliser un code de secours, puis demander au propriétaire « Réinitialiser
  la MFA » (« Comptes internes »). Pour le propriétaire lui-même, passer par la procédure serveur :

  ```bash
  pnpm db:reset-mfa -- --email <email>
  ```

  Elle réinitialise la MFA, ferme les sessions et écrit une entrée d'audit.

## Quotas IA et stockage (Sprint 11B)

- Chaque offre fixe un **plafond mensuel d'appels IA** et un **quota de stockage**. Le Super Admin
  peut accorder une **dérogation** à une organisation (« Consommation IA » ou « Stockage » →
  « Ajuster ») ; laisser vide revient au quota de l'offre. Chaque changement est journalisé
  (avant / après).
- L'organisation peut se fixer un plafond IA plus bas dans ses réglages, jamais plus haut que celui
  d'Ocall.
- Au-delà du plafond IA, les fonctions IA sont refusées et l'application fonctionne sans IA. Au-delà
  du quota de stockage, les dépôts (images des sites, pièces jointes) sont refusés.
- « Consommation IA » : appels par organisation, établissement et fonctionnalité sur la période,
  coût **estimé** (le fournisseur facture séparément), appels du mois face au plafond.

## Stockage et fichiers privés (Sprint 11B)

- Fournisseur compatible S3 (Cloudflare R2 retenu) ou local en développement ; **bucket privé**.
- Fichiers privés rangés par organisation et établissement, jamais servis directement : chaque
  téléchargement passe par un **lien temporaire signé** (5 minutes), délivré après contrôle d'accès,
  et **journalisé**. Type vérifié par signature (images, PDF), 5 Mo au plus.
- Conservation : pièces jointes du support 365 jours, puis purge (« Stockage » → « Purger les
  fichiers expirés ») ; la trace en base est conservée.

## Support (Sprint 11B)

Voir [GUIDE-SUPPORT.md](GUIDE-SUPPORT.md).

## Paramètres généraux

Lecture seule (« Paramètres généraux ») : environnement, fournisseur IA, stockage et son état,
sécurité (MFA configurée, cookie sécurisé). Aucun secret affiché ; la configuration se modifie sur
l'hébergeur ([PRODUCTION.md](PRODUCTION.md)).

## Configuration

`MFA_ENCRYPTION_KEY` : 32 octets en base64, **obligatoire en production** (l'API refuse de démarrer
sans elle). Elle chiffre les secrets TOTP au repos (AES-256-GCM). La changer rend les secrets
existants illisibles : il faut alors réinitialiser la MFA de chaque compte interne.

`STORAGE_SIGNING_SECRET` : signe les liens temporaires, obligatoire en production.

Migrations : `20261031010000_ocall_suite_plateforme` et `20261031020000_ocall_suite_support_quotas`
(additive : quotas, fichiers privés, support, borne des transactions inactives). La première est additive, reprend chaque abonnement
existant vers le produit de son offre et assouplit deux contraintes d'unicité (un abonnement par
organisation, une offre par métier).

## Sprint 12A — catalogue, règlements, administration

- **Catalogue** : statuts `PLANNED`, `COMING_SOON`, `PILOT`, `ACTIVE`, `SUSPENDED`, `RETIRED` ; règle
  serveur unique (seul `ACTIVE` souscriptible, `PILOT` par Ocall ; facturation et activation
  seulement `ACTIVE` ou `PILOT`). Produits Ocall Clinic, RH, Solar et Docs ajoutés « Bientôt
  disponible », sans offre. Présentation publique : voir [SITE-OCALL-SUITE.md](SITE-OCALL-SUITE.md).
- **Offres** : mode d'activation `AUTO` / `ADMIN_APPROVAL` (défaut), figé sur chaque abonnement.
- **Abonnements** : suspendre, réactiver, changer d'offre (tarif historisé dans
  `SubscriptionPriceHistory`), résilier (définitif) ; passage automatique « Expiré » à échéance.
- **Règlements** : déclaration, confirmation à quatre yeux, rejet, annulation, remboursement,
  décisions d'activation ; espèces avec reçu numéroté, remises et rapprochement de caisse.
- **Paiement en ligne** : socle et prestataire simulé ; adaptateur CinetPay réel à livrer après
  confirmation de l'API du compte marchand.
- **Nouvelles permissions** : `platform.billing.cash.declare`, `platform.activations.approve`,
  `platform.demo.manage` ; côté client : `subscription.pay` (propriétaire, administrateur).
- **Nouvelles sections** : Paiements en ligne, Caisse et remises, Demandes de démo ; tableau de bord :
  activations à approuver, démonstrations, encaissé par canal, remboursé.

## Sprint 2A (multi-établissements) — rôles par application et par site

Décisions et architecture : `ocall-audits/audit-architecture-multisite-ocall-suite.md` (audit validé le
14/11/2026).

- **Un compte, un rôle par application.** Les gardes d'Ocall School, Facture et Stock lisent leur table de
  membres pour **tout** membre de l'organisation, quel que soit son rôle Suite ; le propriétaire reste
  administrateur d'office de chaque application. Un employé Park (caissier, superviseur, administrateur…)
  n'a aucun droit applicatif tant que l'application ne l'a pas ajouté.
- **Ajout d'un membre existant** : `GET /<app>/members/candidates` (membres actifs, hors propriétaire et
  hors membres de l'application) puis `POST /<app>/members/existing` (`userId`, `role`, et `schoolIds` pour
  School), réservés au gestionnaire de l'équipe de l'application ; un compte d'une autre organisation, le
  propriétaire ou un compte inconnu donnent 404 ; un second ajout 409. Journal : `<app>.member_attached`
  avec le rôle Suite d'origine.
- **Fermeture d'un accès** : désactiver un membre dans une application ne touche ni les autres
  applications ni Park. Un compte réservé aux applications (`PRODUCT_USER`) reste ouvert tant qu'une
  application au moins lui donne un rôle actif ; il est fermé (sessions révoquées) quand plus aucune ne lui
  en donne, et rouvert dès qu'une le réactive. Chaque application déclare sa lecture de l'état de ses
  membres auprès de `ProductUserAccountsService` (`registerProbe`) ; l'état est relu sous verrou.
- **Rôle par site** : Ocall Stock (rôle propre à une boutique, voir `OCALL-STOCK.md` §3). Park et School
  par établissement : après le référentiel commun des enseignes et établissements (étape B).
- **Migration** : `20261210000000_suite_s2a_roles_par_site` (base Stock, additive) : colonne facultative
  `StockMemberSite.role`, contrôle « jamais administrateur ».
- **Tests** : `apps/api/test/suite-s2a-roles.integration.spec.ts`, `e2e/suite-s2a-roles.spec.ts`.

## Sprint 2B (multi-établissements) — référentiel commun des sites

- **Établissements réutilisés.** Les établissements de la base Suite (déjà ceux de Park et Restaurant)
  deviennent le référentiel des lieux physiques de l'organisation : un lieu est enregistré **une seule
  fois** et plusieurs applications l'utilisent. Aucune table de sites en double.
- **Ajouts facultatifs** : nature du lieu (`kind` : parc, restaurant, boutique, dépôt, école, agence,
  bureau, autre) et **enseigne** (`Brand`, propre à l'organisation, jamais supprimée : désactivée).
  Un lieu sans activité Park (`businessType = NONE`) est désormais accepté : il n'apparaît dans aucune
  vente Park ni Restaurant (filtres d'activité existants).
- **Rattachements** : `StockSite.establishmentId` et `School.establishmentId` (UUID, sans clé étrangère
  entre bases ; un seul site Stock et une seule école par lieu). Rattacher un lieu existant, le créer à
  partir de la fiche, ou retirer le rattachement : toujours un choix explicite, journalisé. Lieu d'une
  autre organisation : introuvable ; lieu désactivé ou déjà pris : refusé. Les données existantes restent
  non rattachées : aucune reprise automatique.
- **API** : `GET /establishments/registry` (sites et applications qui les utilisent),
  `GET|POST|PATCH /establishments/brands` ; `GET /ocall-stock/sites/registry`,
  `PUT /ocall-stock/sites/:id/establishment` ; `GET /school/schools/registry`,
  `PUT /school/schools/:id/establishment`. Contrat commun : `common/integration/site-registry.ts`
  (`SITE_REGISTRY`, module `establishments` global) ; chaque application déclare ses rattachements.
- **Web** : portail Suite « Sites de l'organisation » (`/suite/sites`, propriétaire et administrateurs) ;
  rattachement depuis Stock (Sites) et School (Établissements).
- **Migrations** (`20261211000000_suite_s2b_etablissements`, additives) : base Suite (énumération
  `EstablishmentKind`, table `Brand`, colonnes facultatives `Establishment.kind` et `brandId`), base
  Stock (`StockSite.establishmentId`), base School (`School.establishmentId`).
- **Désactivation globale ou retrait d'un rôle** : désactiver un employé Park ferme son compte (toutes
  applications, sessions révoquées) ; une réactivation dans une application ne le rouvre pas. Retirer un
  rôle applicatif ne ferme que cette application. Un compte réservé aux applications n'a pas encore de
  désactivation unique (à prévoir à l'étape D).
- **Tests** : `apps/api/test/suite-s2b-etablissements.integration.spec.ts`, `e2e/suite-s2b-sites.spec.ts`.

## Sprint 2C (multi-établissements) — plusieurs organisations pour un même compte

- **Invitation acceptée.** Le propriétaire ou un administrateur invite une personne qui a déjà un compte
  Ocall, par son e-mail ou son identifiant, avec un rôle (jamais propriétaire ; un administrateur
  n'invite pas d'administrateur) et, pour un rôle limité, ses établissements Park. La réponse est la même
  que le compte existe ou non. Rien n'est créé avant l'acceptation par la personne, depuis son propre
  compte (portail Suite) ; refus possible ; invitation échue après 7 jours ; révocable. Une seule
  invitation en attente par organisation et par personne (index unique partiel).
- **Changement d'organisation** (sélecteur dans l'en-tête du portail) : `POST /auth/switch-organization`
  ouvre une nouvelle session liée à la seule adhésion choisie et ferme la session courante ; la page est
  entièrement rechargée. Organisation sans adhésion active, adhésion désactivée ou organisation suspendue :
  introuvable. La connexion ouvre la plus ancienne organisation active.
- **Compte partagé** : depuis une seule organisation, ni réinitialisation du mot de passe ni modification
  de l'identité ou de l'e-mail (`SHARED_ACCOUNT`) ; chaque organisation garde la main sur son adhésion
  (rôle, établissements, désactivation).
- **API** : `GET|POST /organization/invitations`, `POST /organization/invitations/:id/revoke`
  (`employee.manage`) ; `GET /auth/organizations`, `POST /auth/switch-organization`,
  `GET /auth/invitations`, `POST /auth/invitations/:id/accept|decline`.
- **Écarts de l'étape B corrigés** : tableau de bord et analyses Park sans les lieux sans activité Park ;
  pages Park Établissements et Employés limitées aux établissements Park ; un lieu encore rattaché à une
  application ne se désactive pas (`ESTABLISHMENT_IN_USE`) ; création d'un site Stock : nom du lieu
  vérifié avant toute écriture, et lieu tout juste créé annulé si le site échoue
  (`establishment.creation_rolled_back`).
- **Migration** `20261212000000_suite_s2c_invitations_organisation` (base Suite, additive).
- **Tests** : `apps/api/test/suite-s2c-organisations.integration.spec.ts`,
  `e2e/suite-s2c-organisations.spec.ts`.
- **Flux temps réel et anciens onglets** (risque traité avant la production) : chaque évènement d'un flux
  SSE est revérifié avant l'envoi (session, adhésion, rôle, établissement) ; une session révoquée par un
  changement d'organisation, une déconnexion ou une désactivation ne reçoit plus rien et le flux se ferme,
  sans attendre le battement suivant (`suite-s2c-realtime.integration.spec.ts`). Le cookie de session étant
  commun aux onglets, l'onglet qui change d'organisation le signale aux autres (`storage` et
  `BroadcastChannel`) : les onglets des espaces connectés se rechargent sur le portail.
- **Échec intermittent du parcours Stock S10** : cause identifiée, indépendante de l'étape C. Le test
  attendait « Site en ligne » par `getByText`, qui cherche une sous-chaîne sans casse : l'aide « … sur le
  site en ligne. » de la carte Articles, visible avant la publication, satisfaisait l'attente ; le test
  ouvrait la vitrine pendant que la publication était encore en cours (trace : publication interrompue,
  catalogue 404). Attente corrigée en texte exact dans `stock-s10` et `stock-s7`.

## Sprint 2D (multi-établissements) — accès harmonisés entre applications

- **Désactivation d'une adhésion** (`POST /employees/:id/deactivate|reactivate`) : durable
  (`OrganizationMembership.suspendedAt`, `suspendedByUserId`) et limitée à l'organisation ; les adhésions du
  même compte ailleurs et leurs sessions ne changent pas. Compte réservé aux applications (`PRODUCT_USER`) :
  désactivé par le propriétaire seulement ; tant qu'il est désactivé, aucun rôle d'application ne rouvre
  l'adhésion (`ProductUserAccountsService.syncActive` relit la suspension sous verrou). La réactivation
  ne rouvre ce compte que si une application lui donne encore un rôle actif. Page Employés : statut
  « Sans rôle d'application » pour un compte fermé par les applications.
- **Portail** (`GET /suite/overview`) : `hasRole` par application, lu comme la garde de l'application
  (propriétaire : responsable d'office ; Park : tout rôle Park ; School, Facture, Stock : membre actif).
  « Mes applications » ne contient que les applications ouvertes où la personne a un rôle ; sans droit de
  facturation, rien d'autre n'est présenté ; propriétaire et administrateurs voient aussi les applications
  ouvertes sans rôle pour eux (sans lien) et le catalogue.
- **Gardes School, Facture, Stock** : étapes communes dans `common/app-guard.ts` (application activée,
  adhésion, droit commercial, lecture seule, propriétaire responsable d'office, refus uniforme) ; règles
  propres à chaque application inchangées.
- **Migration** `20261213000000_suite_s2d_suspension_adhesion` (base Suite, additive, sans modification des
  lignes existantes).
- **Tests** : `apps/api/test/suite-s2d-acces.integration.spec.ts`, `e2e/suite-s2d-acces.spec.ts`.

## Établissement émetteur Ocall Facture (après Sprint 2D)

- Un document Facture peut porter un **établissement émetteur facultatif**, lu dans le référentiel commun des
  sites (`SITE_REGISTRY`) : aucun référentiel Facture. Contrôle à l'organisation (établissements actifs de
  l'organisation) ; rôles Facture inchangés. Détail : `docs/OCALL-FACTURE.md` (« Établissement émetteur »).
- **Numérotation** : une seule suite par organisation, type et année, avec ou sans établissement.
- **Documents émis** : établissement copié et figé à l'émission (base : `FactureDocument_establishment_frozen`) ;
  les documents émis avant restent sans établissement.
- **Stock** : la vente lue par Facture porte l'établissement de sa boutique (`StockSaleForInvoice.establishmentId`) ;
  la facture de la vente le reprend.
- Le référentiel ne compte pas Facture parmi les applications qui « utilisent » un lieu : un document émis ne
  doit jamais empêcher de désactiver un lieu (sa copie reste imprimée).
- **Migration** `20261214000000_facture_suite_etablissement_emetteur` (base Facture, additive).
- **Tests** : `apps/api/test/facture-etablissement-emetteur.integration.spec.ts`,
  `apps/api/src/modules/facture/facture-document-pdf.spec.ts`, `e2e/facture-etablissement.spec.ts`.

## Étape 5 — tableau de bord de l'organisation (reporting multi-établissements)

Cadrage validé le 15/11/2026 (décisions D1 à D5). Aucune migration.

- **Écran** `/suite/tableau-de-bord` (lien « Tableau de bord de l'organisation » du portail) et **API**
  `GET /dashboard/organization?period&from&to&establishmentId` (`establishmentId` : un établissement du
  référentiel, `none` = « Non rattaché », absent = tous ; un établissement d'une autre organisation : 404).
- **Accès (D1)** : permission `organization.reports.read` (propriétaire, administrateur). Chaque bloc applique en
  plus les **droits réels de l'application** : application ouverte (abonnement, essai ou contrat) et rôle avec le
  droit de consulter ses indicateurs (Park/Restaurant `analytics.read` ; Facture `facture.documents.read` ;
  Stock l'un des droits de son tableau de bord, boutiques du membre ; School `school.finance.reports`, écoles du
  membre). Sans ce droit, le bloc n'apparaît pas.
- **Blocs** : Parc (billetterie encaissée, ventes payées, entrées), Restaurant (encaissé, ventes, commandes,
  panier moyen), Facture (facturé TTC net des avoirs, encaissé, reste à encaisser, en retard), Stock (ventes en
  caisse encaissées, ventes, valeur du stock, alertes), School (encaissé, reste à percevoir, élèves inscrits de
  l'année en cours, **par devise de l'école**). Chaque montant porte sa **nature** (encaissé, facturé, reste dû,
  valeur du stock) et sa **devise**.
- **Aucun total entre applications (D2)** ; les factures issues de ventes en caisse Stock sont **isolées** dans
  Facture (« dont ventes Stock », D3) : déjà comptées dans le bloc Stock.
- **Par établissement** : tableau comparatif ; ce qui n'est rattaché à aucun établissement (documents Facture
  sans établissement, boutiques et écoles non rattachées) est dans « **Non rattaché** », jamais attribué
  automatiquement. Les lieux Park sont tous des établissements.
- **Fuseau et devise** : période résolue une fois dans le fuseau de l'organisation (jours locaux transmis aux
  applications comptées au jour ; Park/Restaurant à l'heure locale de chaque établissement) ; devise de
  l'organisation, montants d'une autre devise présentés à part.
- **Connecteurs analytiques** (`apps/api/src/common/integration/organization-reporting.ts`) : chaque application
  inscrit au démarrage un connecteur (`OrgReportConnector` : produit, libellé, ordre, lien, `report(query)`)
  auprès du registre global ; une application future (Ocall Print, Sabatii…) ajoute le sien sans toucher au
  tableau de bord. Appels en parallèle, délai de 20 s par bloc : une application en panne ou trop lente donne un
  bloc « indisponible », jamais une erreur de la page.
- **Lien « Détail »** : rapport de l'application sur la même période (jours explicites) et le même
  établissement (Facture, Stock, analyses Park/Restaurant lisent ces paramètres).
- **Lot B** : tableau de bord Facture (`from`, `to`, `establishmentId`, factures de ventes Stock isolées), exports
  Facture (filtre et colonne « Établissement » = nom figé à l'émission), tableau de bord Stock (`establishmentId`
  → boutiques rattachées, toujours dans celles du membre).
- **Lot C** : copilote IA — un lieu sans activité Park/Restaurant est introuvable et n'est plus proposé ;
  `/dashboard` — chiffre d'affaires d'un superviseur par `establishmentScope` (même résultat) ; analyses — devise
  de l'organisation au lieu de XOF codé en dur.
- **Hors périmètre** : tarification de l'étape 6 (inchangée), interconnexion Park ↔ Stock (étape 7, reportée).
- **Tests** : `apps/api/test/suite-s5-reporting.integration.spec.ts`,
  `apps/api/src/common/integration/organization-reporting.spec.ts`, `packages/shared/src/organization-report.spec.ts`,
  `e2e/suite-s5-dashboard.spec.ts`.

## Étape 6 — facturation par site activé

Grille validée (FCFA) : par application, **premier site 17 500 / mois**, **chaque site supplémentaire
7 500 / mois**, **supplément vitrine 5 000 / mois par application** ; **mise en service 150 000** pour la
première application installée, **112 500** pour chacune des suivantes ; Facture compte toujours **un
site**. Aucun contrat existant n'est modifié automatiquement.

- **Offres** : `SubscriptionPlan.pricingMode` = `FLAT` (offres historiques, inchangées) ou `PER_SITE`
  (`monthlyPrice` = premier site, `extraSiteMonthlyPrice`, `showcaseMonthlyPrice`, `extraAppSetupFee`).
  Les offres « — Par site » et « — Par site avec vitrine » de Park, Restaurant, School, Facture et Stock
  sont créées **inactives** par la migration `20261215000000_suite_s6_facturation_par_site` ; Ocall les
  active depuis le Super Admin. Un client passe au par site par un **changement d'offre explicite**.
  L'inscription et l'essai ne choisissent **jamais** une offre par site, même active (offre forfaitaire
  en vigueur seulement) : le prix le plus bas n'est pas une règle commerciale.
- **Tarif figé** : une seule règle (`freezeAgreedPrices`) à la première facture, à la première activation et
  au changement d'offre ; prix du site supplémentaire et de la vitrine figés sur l'abonnement
  (`agreedExtraSitePrice`, `agreedShowcasePrice`) et dans l'historique des prix.
- **Sites facturés** : `SiteActivation` (base Suite) — une activation par (organisation, application
  source, site), jamais supprimée ; index unique partiel sur les activations ouvertes. Sources : activité
  parc (`OCALL_PARK`) et activité restaurant (`OCALL_RESTAURANT`) comptées **séparément** ; boutiques et
  entrepôts Stock non archivés ; écoles actives ; Facture = `organization`. Une fiche rattachée compte pour
  son établissement (jamais deux fois pour la même application), une fiche non rattachée pour elle-même.
  Rapprochement à chaque facture, au changement d'offre et toutes les heures (abonnements par site
  seulement) ; une application illisible ou non chargée donne 503 `SITE_COUNT_UNAVAILABLE` (aucune
  facture, aucune activation fermée), jamais un décompte réduit ; le devis du portail n'affiche alors
  aucun montant.
- **Parc et Restaurant** : préparés comme deux applications commerciales indépendantes ; tant que
  `PARK_RESTAURANT_SEPARATED` vaut `false`, Ocall Park couvre les établissements parc **ou** restaurant
  (un établissement mixte compté une fois). `GET /platform/subscriptions/park-restaurant-split` donne un
  **aperçu** de la migration des contrats combinés (aucune écriture, aucun prix changé) ; la bascule se fera
  au sprint de retrait de l'offre « Parc + Restaurant ».
- **Facture** : la mensualité d'une offre par site ajoute `EXTRA_SITES` (sites supplémentaires × mois),
  `SHOWCASE` et `SITE_PRORATA` ; `MONTHLY` garde le sens « mois » (paiement en ligne et commissions
  inchangés ; les nouvelles natures comptent comme mensualités). Les sites facturés sont photographiés
  (`Invoice.sitesSnapshot`) et jamais recalculés. Ajout de site : prorata jusqu'à l'échéance (jours
  entamés, mois de 30 jours) sur la facture suivante, une seule fois ; retrait : effet à l'échéance.
- **Écrans** : Super Admin (prix par site des offres, aperçu de séparation, estimation et sites facturés
  des factures), portail (devis par site, mise en service dégressive), page Tarifs (grille par site dès
  qu'une offre par site est active).
