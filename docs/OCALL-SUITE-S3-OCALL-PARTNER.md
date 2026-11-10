# Ocall Suite — Ocall Partner (Sprint S3)

Branche `claude/suite-s03-partner`, partie de `main` `d3fb3b1` (S2 fusionné). Ce sprint étend le module
partenaires du Sprint 12B (`docs/PARTENAIRES.md`) sans le reconstruire : le moteur de commissions, la
détection des doublons de prospects, les règlements confirmés par une autre personne et la double
authentification obligatoire sont conservés.

## Décisions du client (09/11/2026)

1. **Attributions antérieures** : les attributions du Sprint 12B restent valables pour toutes les
   applications de l'organisation. Les nouvelles attributions se font par application.
2. **Activation du compte** : une candidature approuvée vaut agrément. Le compte créé par l'invitation
   est actif immédiatement, sans seconde vérification. La double authentification reste obligatoire.
3. **Revendeur** : il accompagne l'inscription d'un client par un lien parrainé ; le client s'inscrit
   lui-même. Le revendeur prépare ensuite les activations et les renouvellements de ses clients. Il ne
   crée jamais de compte client.
4. **Commission mensuelle** : versée à chaque mensualité encaissée, jusqu'à la fin de vie du contrat
   client, pour les deux types de partenaires. La commission s'arrête si Ocall met fin à
   l'attribution, ou si le partenaire est suspendu ou résilié. Une règle peut encore fixer une durée en
   mois.
5. **Prime de setup** : versée une seule fois par organisation et par application.
6. **Règlement** : mensuel, à la fin du mois qui suit l'encaissement. Exemple : primes de novembre
   réglées fin décembre.
7. **Attribution directe** : le Super Admin peut attribuer un client directement à un revendeur, ou à
   tout autre partenaire.
8. **Barèmes proposés** (non validés) :

   | Type      | Setup | Mensualités |
   | --------- | ----- | ----------- |
   | Apporteur | 10 %  | 5 %         |
   | Revendeur | 15 %  | 10 %        |

   Ils ne servent qu'à pré-remplir le formulaire : le barème reste fixé par l'admin, qui peut modifier
   chaque taux avant d'enregistrer, puis le valider (décision du 10/11/2026). Aucune prime n'est
   calculée tant qu'Ocall n'a pas validé une règle.

9. **E-mails** (10/11/2026) : envoi par Resend de l'accusé de candidature, de l'alerte à l'équipe
   Ocall, de l'invitation, du refus motivé, et des e-mails de règlement au partenaire.

## 1. Documentation fonctionnelle

### Candidature publique (`/devenir-partenaire`)

- **Accès au formulaire** : « Devenir partenaire » figure dans le menu du site, dans le pied de page et
  dans le dernier bloc de la page d'accueil. La page figure dans le sitemap.
- **Champs** : type (apporteur ou revendeur), prénom, nom, entreprise (facultative), e-mail, pays
  d'activité, ville, téléphone avec indicatif (pré-rempli selon le pays), expérience, secteurs
  ciblés, motivation, consentement à la politique de confidentialité.
  - Tous les champs sont validés côté navigateur et côté serveur.
  - Aucune pièce d'identité n'est demandée.
- **Réponse** : toujours la même confirmation, même si l'envoi provient d'un robot, double une
  candidature en attente ou utilise une adresse déjà connue. Personne ne peut deviner qui a candidaté.
- **Suite** : la candidature est examinée par le Super Admin. Le tableau de bord de l'administration
  affiche le nombre de candidatures à examiner. Aucun compte n'est créé à ce stade.

### Invitation et compte partenaire

1. Le Super Admin approuve la candidature. Le lien `/activation-partenaire?token=…` est envoyé par
   e-mail au candidat ; il est aussi affiché une seule fois au Super Admin, en secours si l'e-mail
   n'arrive pas (l'écran indique si l'envoi a réussi).
   - Le lien est à usage unique et valable 7 jours.
   - « Nouvelle invitation » révoque le lien précédent.
2. Le candidat choisit son mot de passe. Son compte est actif, et son code commercial est attribué.
3. À la première connexion, le partenaire configure la double authentification, obligatoire.

### Portail partenaire (`/partenaire`)

- **Tableau de bord**
  - **Solde de primes** :
    - payable maintenant ;
    - validé, en attente de la fin du mois M+1 ;
    - acquis, en validation par Ocall ;
    - en cours de règlement ;
    - réglé ;
    - prochaine date de règlement.
  - **Indicateurs** : prospects actifs et convertis, clients attribués, contrats actifs, encaissé
    attribué, primes acquises, primes réglées, solde payable. Ce sont des montants enregistrés, sans
    estimation.
  - **Liens de recommandation** : inscription d'un client et demande de démonstration.
- **Prospects (CRM)**
  - Étapes du pipeline : Nouveau, Contacté, Qualifié, Démonstration, Proposition, Gagné, Perdu.
    « Gagné » est posé par Ocall, au moment où il confirme l'attribution.
  - Champs : secteur d'activité et prochaine relance.
  - Recherche, filtres (étape, relances dues), tri, pagination côté serveur.
  - Historique des étapes et détection des doublons, issue du Sprint 12B.
- **Mes clients** : la liste des organisations attribuées, application par application.
  - Pour chaque application : état de l'abonnement, échéance, montant encaissé depuis l'attribution,
    primes générées.
  - Le revendeur voit aussi l'offre et le tarif contractuel. Il prépare l'activation ou le
    renouvellement de ses clients, sans confirmer aucun paiement.
- **Primes et règlements** : solde, demande de règlement (une seule en attente à la fois),
  annulation, suivi des demandes, détail des primes avec leur date de règlement, règlements reçus.
- **Mon profil** : raison sociale, téléphone et ville sont modifiables. Le type de partenariat, le
  statut et les taux relèvent d'Ocall.

### Ce qu'un partenaire ne peut jamais faire

Toutes ces interdictions sont vérifiées côté serveur. Un partenaire ne peut pas :

- confirmer un paiement, activer un contrat, modifier un tarif ou ses taux, valider ses primes ou ses
  règlements ;
- voir les données d'un autre partenaire, ou les données métier Park et School d'un client.

## 2. Super Admin

- **Candidatures partenaires** (`/admin/partenaires/candidatures`) :
  - liste paginée avec filtres (statut, type) et recherche ;
  - approbation avec lien d'invitation ;
  - refus motivé ;
  - réinvitation ;
  - anonymisation des candidatures échues.
- **Partenaires** :
  - type de partenaire, résiliation (définitive, historique conservé) ;
  - statistiques par pays et par application.
- **Prospects et attributions** :
  - attribution par application ;
  - attribution directe motivée, confirmée immédiatement ;
  - fin d'attribution motivée (arbitrage) ;
  - proposition depuis un prospect.
- **Commissions** :
  - règles par type de partenaire ;
  - durée de récurrence facultative (vide : jusqu'à la fin du contrat) ;
  - pré-remplissage avec les barèmes proposés ;
  - date de règlement de chaque prime ;
  - demandes de règlement : marquées « réglées » seulement avec un versement confirmé, ou refusées
    avec un motif.

## 3. Conception technique

### Modèle de données

Migration additive `20261117000000_suite_s3_ocall_partner`. Aucune instruction destructrice
(`db:migrate:check`) ; les partenaires existants deviennent des apporteurs.

- **`Partner`** :
  - `type` (REFERRER par défaut), `city`, `terminatedAt`, `terminationReason` ;
  - `applicationId` (unique) ;
  - le statut gagne la valeur `TERMINATED`.
- **`PartnerApplication`** :
  - candidature numérotée `CAND-AAAA-NNNNN` ;
  - une seule candidature `PENDING` par e-mail (index unique partiel) ;
  - `retentionUntil` et `anonymizedAt` pour l'anonymisation.
- **`PartnerInvitation`** : `tokenHash` unique (SHA-256), `expiresAt`, `usedAt`, `revokedAt`.
- **`ProspectEvent`** :
  - historique en ajout seul ;
  - `Prospect` gagne `sector` et `nextFollowUpAt` ;
  - l'étape `PROPOSAL` est ajoutée.
- **`Attribution`** :
  - `productId` : vide pour une attribution antérieure couvrant toutes les applications ;
  - statut `ENDED`, avec `endedAt`, `endedById` et `endReason` ;
  - index unique partiel : une seule attribution confirmée par organisation et application.
- **`CommissionRule`** :
  - `partnerType` : vide pour tous les types ;
  - `monthlyWindowMonths` facultatif : vide jusqu'à la fin du contrat.
- **`Commission.payableFrom`** :
  - date de règlement, à la fin du mois qui suit l'encaissement ;
  - recalculée par la migration pour les commissions existantes.
- **`PartnerPayoutRequest`** : demande de règlement, une seule `PENDING` par partenaire, montant
  strictement positif.
- **`ActivationRequest.partnerId`** : renseigné pour une demande préparée par un revendeur.

### Moteur de commissions (`apps/api/src/common/commissions.ts`)

Conditions de déclenchement :

- un règlement **confirmé** et facturé ;
- l'attribution confirmée de l'application payée, ou l'attribution antérieure « toutes
  applications ». La famille Park historique est rattachée à Ocall Park ;
- un partenaire actif.

Choix de la règle (`applicableRule`) : seule une règle **validée** par Ocall peut s'appliquer.

1. La règle figée sur l'attribution reste appliquée même si elle a été désactivée ensuite : les
   conditions contractuelles sont conservées.
2. Sinon, la règle du partenaire.
3. Sinon, dans l'ordre : type de partenaire + application, puis type, puis application, puis règle
   générale.

Calcul :

- **Setup une seule fois** : la base cumulée des primes de setup d'une organisation et d'une
  application est plafonnée au setup facturé, tous partenaires et versements confondus. Une prime
  annulée libère le plafond.
- **Mensualités** : commissionnées si la règle n'a pas de durée, ou tant que la durée n'est pas
  écoulée.
- **Montants** : arrondis à l'inférieur, en XOF entiers.
- **Doublons** : une prime par règlement et par nature (contrainte d'unicité).
- **Date de règlement** : `payableFrom = commissionPayableFrom(paidAt)`.
- **Remboursement** : il annule les primes non réglées, ou crée une régularisation négative si la
  prime a déjà été réglée (Sprint 12B).

### Attribution

- **Contrôle sous verrou** : chaque confirmation pose un verrou sur l'organisation, puis vérifie
  qu'aucune attribution confirmée n'existe déjà pour la même application, ou pour toutes les
  applications.
- **Conflit** : il est signalé (`ORGANIZATION_ALREADY_ATTRIBUTED`). Le Super Admin l'arbitre en
  mettant fin, avec un motif, à l'attribution en cours. Aucun transfert ne se fait en silence.
- **Attribution directe** (`POST platform/attributions/assign`) : création et confirmation dans la
  même transaction, avec un motif journalisé.
- **Inscription parrainée** (`ref` dans `POST auth/signup`) :
  - elle crée une attribution Ocall Park « à confirmer » au partenaire actif qui porte le code ;
  - un code inconnu et l'auto-parrainage sont ignorés ;
  - le code ne donne aucun droit sur l'organisation.

### Routes

| Route                                                                                 | Accès                            |
| ------------------------------------------------------------------------------------- | -------------------------------- |
| `POST public/partners/applications`                                                   | public, limité (5 / 10 min / IP) |
| `POST public/partners/activation/check` · `POST public/partners/activation`           | public, routes sensibles         |
| `GET/POST platform/partner-applications…` (liste, approve, reject, reinvite, purge)   | `platform.partners.manage`       |
| `POST platform/partners/:id/terminate` · `GET platform/partner-stats`                 | `platform.partners.manage`       |
| `POST platform/attributions/assign` · `POST platform/attributions/:id/end`            | `platform.partners.manage`       |
| `GET platform/partner-payout-requests` · `POST …/:id/decide`                          | `platform.payouts.manage`        |
| `GET partner/balance` · `PATCH partner/profile` · `GET partner/prospects/:id/history` | partenaire (actif)               |
| `GET/POST partner/payout-requests` · `POST …/:id/cancel`                              | partenaire (actif)               |
| `POST partner/subscription-requests`                                                  | revendeur seulement              |

## 4. Rapport de sécurité

- **Fraude aux commissions** :
  - jamais sur une simple déclaration ou demande de paiement ;
  - jamais sans une règle validée par le propriétaire de la plateforme ;
  - setup plafonné, aucun doublon ;
  - le partenaire ne valide ni ses primes ni ses règlements ;
  - règlement confirmé par une autre personne que celle qui l'a saisi.
- **Double attribution** : verrou de l'organisation, index unique partiel, fin d'attribution motivée.
- **Double règlement** : demande unique en attente (index partiel) ; une demande n'est « réglée »
  qu'avec un versement confirmé du même partenaire ; les primes sont marquées payées seulement à la
  confirmation du versement.
- **Invitations** :
  - jeton aléatoire de 256 bits, stocké haché, jamais journalisé (les chemins sont journalisés sans
    leur paramètre) ;
  - usage unique sous verrou de ligne, expiration à 7 jours, révocation à la réinvitation ;
  - aucune donnée personnelle renvoyée par la vérification.
- **Permissions partenaires** : chaque requête est filtrée sur le partenaire de la session. Les
  capacités du revendeur sont vérifiées côté serveur. Un partenaire résilié ou suspendu ne peut plus
  se connecter.
- **Isolation** :
  - prospects, clients, soldes et demandes sont strictement liés au partenaire ;
  - un client non attribué renvoie « introuvable », sans fuite d'information ;
  - aucune donnée métier Park ou School n'est exposée.
- **Conditions contractuelles** : la règle figée sur l'attribution reste appliquée ; les mensualités
  sont calculées sur les lignes de facture, donc au prix contractuel (Sprint 12B / S1).
- **Données personnelles** :
  - pas de pièce d'identité ;
  - consentement explicite ;
  - conservation configurable (`PARTNER_APPLICATION_RETENTION_MONTHS`, 24 mois par défaut), puis
    anonymisation ;
  - journal sans données personnelles ;
  - section dédiée dans la politique de confidentialité ;
  - pages d'activation et portail exclus de l'indexation (`robots.txt`).

## 5. Tests

- **Unitaires** (`packages/shared/src/partners.spec.ts`) :
  - date de règlement M+1, y compris l'année bissextile ;
  - mensualités sans limite de durée, ou bornées ;
  - arrondi XOF ;
  - capacités du revendeur ;
  - barèmes proposés.
- **Intégration** (`apps/api/test/suite-s3-partner.integration.spec.ts`, 14 tests) :
  - candidature : robots, doublons, validation, journal sans données personnelles ;
  - approbation unique sous concurrence ; jeton haché ; réinvitation et révocation ;
  - activation à usage unique sous concurrence, puis double authentification ;
  - refus et anonymisation ;
  - CRM : étapes, historique, recherche, isolation, doublons ;
  - inscription parrainée et auto-parrainage ;
  - demande préparée par le revendeur ; l'apporteur est refusé ;
  - arbitrage et attribution directe ; blocage par une attribution antérieure ;
  - règle non validée : aucune prime ;
  - setup réglé en deux fois puis refacturé : une seule prime ;
  - mensualités cinq ans après l'activation ;
  - solde de primes et règlement refusé avant la date ;
  - demande de règlement unique, versement confirmé par une autre personne ;
  - remboursement ; profil ; statistiques ; résiliation.
- **Tests existants adaptés** : le spec du Sprint 12B. Il précise l'application des attributions,
  prend en compte la nouvelle forme de la liste des clients et simule la date de règlement atteinte
  avant un versement.
- **E2E** (`e2e/suite-s3-partner.spec.ts`) : le parcours complet en 12 étapes, de la candidature au
  règlement. La page publique est ajoutée au contrôle mobile (`responsive.spec.ts`).

## 6. Risques résiduels et limites

1. **E-mails sans relance automatique.** Un envoi raté (fournisseur indisponible) n'est pas rejoué :
   il est journalisé (type d'e-mail seulement) et l'écran du Super Admin le signale ; le lien
   d'invitation reste disponible une fois en secours, et « Nouvelle invitation » renvoie un e-mail.
2. **Configuration Resend à faire.** Tant que `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`
   (domaine vérifié chez Resend) et `PARTNER_ALERT_EMAILS` ne sont pas renseignés sur Railway, aucun
   e-mail n'est envoyé (désactivé par défaut).
3. **Rien n'est encore payable.** Aucun barème n'est validé : les taux définitifs sont à saisir, puis à
   valider par le propriétaire de la plateforme.
4. **Statistiques.** Le « chiffre encaissé attribué » des statistiques porte sur les encaissements qui
   ont généré une prime ; les encaissements sans règle validée n'y figurent pas.
5. **Attributions antérieures.** Les attributions « toutes applications » du Sprint 12B restent
   prioritaires sur toute l'organisation : elles se terminent explicitement pour réattribuer une
   application.
6. **Litige sur un règlement.** Un litige annule les primes du règlement sans rendre le plafond du
   setup (le règlement reste encaissé) ; seul un remboursement le rend.

## 7. Audit Codex et correctifs

Audit statique indépendant (rapport `ocall-audits/audit-codex-suite-s3.md`), verdict initial NO GO :
6 P0, 4 P1, 1 P2. Tous corrigés dans une passe unique, chacun couvert par un test :

| #     | Anomalie                                                              | Correction                                                                                                                        |
| ----- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| P0-1  | Échéance M+1 contournable par une date de versement future            | Date future refusée (`PAYOUT_DATE_IN_FUTURE`) ; échéance contrôlée aussi sur l'heure du serveur, à la saisie et à la confirmation |
| P0-2  | Setup remboursé puis réglé de nouveau : plus aucune prime             | Les primes de setup d'un règlement remboursé (compensées par une régularisation) libèrent le plafond                              |
| P0-3  | Collecte d'espèces sur une autre application de l'organisation        | Factures collectables et déclaration limitées à l'application attribuée (famille Park comprise)                                   |
| P0-4  | Régularisation de remboursement bloquée jusqu'à M+1                   | Régularisation imputable dès sa création (après validation) ; reprise des données alignée                                         |
| P0-5  | Proposition 12B sans application confirmée sans règle figée           | Règle validée sans application figée à la confirmation                                                                            |
| P0-6  | Règle Ocall Park ignorée pour une offre historique de la famille Park | Règles recherchées sur le produit exact et sur l'application Ocall Park                                                           |
| P1-7  | Ancien versement réutilisé pour « régler » une nouvelle demande       | Versement postérieur à la demande, couvrant son montant, jamais réutilisé (index unique partiel)                                  |
| P1-8  | Lien d'inscription parrainé ignoré par le formulaire                  | Code `ref` lu, validé et transmis ; E2E par le vrai lien                                                                          |
| P1-9  | Renouvellement impossible pour une offre retirée                      | Offre contractuelle exposée au revendeur et utilisée pour le renouvellement                                                       |
| P1-10 | Demandes revendeur indisponibles pour School (préproduction)          | Produits du portail alignés sur les statuts des demandes (actif ou préproduction)                                                 |
| P2-11 | Prospects au-delà de 50 inaccessibles dans l'administration           | Recherche et pagination serveur sur la page Attributions                                                                          |

Migration : les commissions déjà engagées dans un versement du Sprint 12B et les régularisations sont
imputables dès leur création (un versement 12B en cours n'est pas bloqué par le délai M+1).

## 8. E-mails transactionnels

Service commun `apps/api/src/common/mail` (fournisseur Resend par API HTTP, sans dépendance ajoutée).
Les e-mails partent **après** la validation de la transaction métier et ne la font jamais échouer.
Chacun porte une clé d'idempotence (un événement = un e-mail chez Resend). Destinataires, contenu et
liens ne sont jamais journalisés ; seul le type d'e-mail l'est en cas d'échec.

| E-mail                                  | Destinataire           | Déclencheur                                                   |
| --------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| Accusé de candidature                   | candidat               | dépôt enregistré (pas pour un robot ni un doublon en attente) |
| Nouvelle candidature                    | `PARTNER_ALERT_EMAILS` | idem, sans l'adresse ni le téléphone du candidat              |
| Invitation                              | candidat               | approbation, nouvelle invitation                              |
| Refus motivé                            | candidat               | refus (le motif saisi lui est communiqué)                     |
| Règlement confirmé                      | partenaire             | confirmation d'un versement par une seconde personne          |
| Demande de règlement traitée ou refusée | partenaire             | décision du Super Admin                                       |

| Variable               | Rôle                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `MAIL_PROVIDER`        | `disabled` (défaut), `resend`, `simulated` (tests ; interdit en production) |
| `RESEND_API_KEY`       | clé Resend, variables Railway uniquement                                    |
| `MAIL_FROM`            | expéditeur sur un domaine vérifié chez Resend                               |
| `PARTNER_ALERT_EMAILS` | équipe Ocall alertée des candidatures (virgules)                            |
| `PUBLIC_WEB_URL`       | origine des liens (défaut : première valeur de `WEB_ORIGIN`)                |

Les tests utilisent le fournisseur simulé : aucun e-mail réel n'est envoyé. Le fournisseur Resend est
testé avec un client HTTP simulé (en-têtes, idempotence, échec sans exception). La politique de
confidentialité mentionne Resend comme prestataire d'envoi.
