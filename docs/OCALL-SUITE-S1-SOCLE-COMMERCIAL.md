# Ocall Suite — Socle commercial (Sprint S1)

Ce document explique le socle commercial Ocall Suite (Sprint S1). Il complète `OCALL-SUITE.md`, qui décrit le catalogue et les contrats, et `GUIDE-PAIEMENT-MANUEL.md`, qui décrit le traitement des règlements.

Le socle permet à une organisation d'utiliser plusieurs applications Ocall. Chaque application a son propre contrat, son tarif, son essai gratuit et ses droits d'accès. Les applications métier restent indépendantes et ne sont pas réécrites :

- Ocall Park ;
- Ocall School ;
- Ocall Facture et Ocall Stock, à venir.

Les deux premières parties s'adressent à l'équipe Ocall (commerce, support, Super Admin). La troisième s'adresse aux développeurs.

## 1. Ce que voit le client (documentation fonctionnelle)

### Grille tarifaire

La même grille s'applique à chaque application, par organisation, en XOF :

| Offre                         | Prix                                             |
| ----------------------------- | ------------------------------------------------ |
| Application sans site vitrine | 50 000 FCFA par mois                             |
| Application avec site vitrine | 65 000 FCFA par mois                             |
| Mise en service et formation  | 200 000 FCFA par application, **une seule fois** |
| Essai gratuit                 | 14 jours, sans carte bancaire                    |

Le setup n'est jamais refacturé au renouvellement mensuel, ni lors du passage à l'offre avec vitrine.

**Exemple : Park et School, sans vitrine**

- première échéance : 400 000 de setup + 100 000 de mensualités = **500 000 FCFA** ;
- mois suivants : **100 000 FCFA**.

Les prix sont modifiables par le Super Admin, dans les offres en base. Un prix est figé sur le contrat à l'activation, et chaque changement est historisé. Les anciens tarifs Park par métier (Parc, Restaurant, Parc + Restaurant) ne sont plus proposés, mais les contrats existants gardent leurs prix.

**Ocall Park est une seule application.** Elle couvre un parc seul, un restaurant seul, ou les deux, au même tarif. Changer de métier ne modifie ni l'offre ni le prix.

### Essai gratuit

- **Démarrage.** L'essai commence à l'activation effective. Pour Ocall Park, c'est la création du compte : l'essai démarre automatiquement.
- **Calcul des dates.** Le serveur calcule les dates en UTC : la fin tombe exactement 14 jours après le début. Aucun écran ni aucune requête ne permet de les modifier.
- **Un seul essai.** Chaque organisation a droit à un seul essai par application. Changer d'utilisateur, résilier ou souscrire à nouveau ne le réinitialise pas.
- **À l'expiration.** Les données sont conservées et l'application passe en **lecture seule**. Le client peut demander son activation payante depuis le portail.

### Lecture seule Ocall Park

L'application Park passe en lecture seule dans les cas suivants :

- l'essai est échu ;
- l'abonnement a expiré, a été suspendu ou a été résilié.

**Ce qui reste possible :**

- toutes les consultations et tous les exports ;
- la connexion, le changement de mot de passe et la double authentification ;
- la gestion des membres et des rôles ;
- la consultation du contrat et des factures, et le règlement ;
- l'assistance ;
- le portail Ocall Suite, d'où le client demande son activation.

**Ce qui est bloqué :** les opérations métier, c'est-à-dire ventes, billets, encaissements, commandes, stocks, planning, IA et toute modification. L'API répond alors `403 PARK_READ_ONLY`.

**Organisations existantes.** Un abonnement Park créé avant S1 au statut « non activé » garde son accès complet : aucune restriction n'est appliquée rétroactivement. Toute nouvelle organisation démarre en essai.

### Ocall School

**En préproduction.** Le client voit l'application sur le portail mais ne peut ni démarrer d'essai ni souscrire lui-même. Il peut seulement demander une activation. Le Super Admin peut démarrer un essai de 14 jours ou activer un contrat payant.

**Offre gratuite permanente (School Free) :**

- jusqu'à **50 élèves actifs** par organisation. Un élève actif est inscrit ou scolarisé. Les élèves transférés, sortis ou déscolarisés ne comptent pas.
- au-delà, toute nouvelle inscription est refusée (`SCHOOL_FREE_STUDENT_LIMIT`) : création, import, validation d'inscription, réinscription ou transfert d'un élève inactif. La consultation et la modification des élèves déjà actifs restent possibles.
- **20 requêtes IA** par mois et par établissement (`SCHOOL_FREE_AI_LIMIT`). On peut toujours continuer sans IA.
- **aucun SMS** : l'activation des SMS est refusée (`SCHOOL_FREE_SMS_NOT_INCLUDED`) et aucun SMS n'est envoyé. Les autres notifications (portail, invitations remises par l'établissement) continuent de fonctionner. Les crédits SMS prépayés arrivent au Sprint S2.
- **aucun frais de mise en service.**

**Passage au payant.** Un contrat payant sans limite lève tous ces plafonds. En cas de retour à l'offre gratuite, les élèves restent conservés et modifiables, mais les nouvelles inscriptions au-delà de 50 sont de nouveau bloquées.

### Option site vitrine

- **Nouveaux contrats.** Publier un site vitrine (Park ou School) exige l'offre « avec vitrine », sinon l'API répond `403 SHOWCASE_OPTION_REQUIRED`. Le brouillon reste modifiable.
- **Organisations existantes.** Celles qui avaient déjà un site publié ou un abonnement avant S1 gardent le droit de publier, sans changer d'offre.
- **Changement d'offre.** Passer à l'offre avec vitrine se fait par un changement d'offre, sans nouveau setup.

### Portail `/suite`

**Mes applications.** Pour chaque application ouverte, le portail affiche :

- le statut ;
- les jours d'essai restants ;
- l'offre (avec ou sans vitrine) et le tarif mensuel ;
- la date de renouvellement ;
- le badge « Consultation seule » si l'application est en lecture seule.

Chaque carte propose des actions réelles : ouvrir l'application, consulter le contrat, demander l'activation.

**Découvrir d'autres applications.** Selon le cas, le client peut :

- démarrer l'essai, pour une application « Disponible » dont l'essai n'a jamais été utilisé ;
- demander l'activation ;
- découvrir la fiche produit, par exemple pour Facture et Stock, « Bientôt disponible ».

**Visibilité.** Les tarifs et contrats ne sont visibles qu'avec le droit « Consulter l'abonnement ». Démarrer un essai ou demander une activation exige le droit « Payer les factures Ocall ».

### Demande d'activation payante (paiement hors plateforme)

1. Le client choisit son offre, avec ou sans vitrine, et voit le montant : setup éventuel et première échéance.
2. Il envoie sa demande. Une seule demande peut être en attente par application. Il règle ensuite hors plateforme.
3. Le Super Admin vérifie le paiement et le valide dans **Règlements**, ce qui active ou prolonge l'abonnement.
4. Le Super Admin clôt la demande dans **Essais et activations**.

Aucun paiement n'est déclaré confirmé sans l'intervention d'un compte autorisé. Chaque étape est inscrite au journal d'audit.

## 2. Super Admin

La page **Essais et activations** (`/admin/essais-activations`) regroupe trois éléments :

- les demandes d'activation en attente, à clôturer comme « Traitée » ou « Refusée » avec un motif ou une référence de règlement ;
- les essais, avec un formulaire pour démarrer un essai Ocall, par exemple pour School en préproduction ;
- les frais de mise en service, avec leur statut : à facturer, facturés, réglés ou non dus.

**Facturation.** Une facture qui porte une ligne de setup déjà facturée est refusée (`SETUP_FEE_ALREADY_BILLED`). Annuler une facture impayée rend le setup de nouveau facturable. Quand une facture est soldée, son setup passe à « réglé ».

**Offre gratuite School.** On la crée avec un contrat dont les dates vont du jour de démarrage au 9999-12-31, avec ces limites : `{ "tier": "FREE", "maxStudents": 50, "aiMonthlyCallsPerSchool": 20, "sms": false }`.

## 3. Conception technique

### Modèle (base Suite uniquement, migrations additives)

| Élément                                                          | Rôle                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Subscription` (unique par organisation et produit)              | Contrat commercial de chaque application : offre, prix figés, statut, historique.                                          |
| `SubscriptionPlan.includesShowcase`, `trialDays`                 | Deux offres par application : sans vitrine et avec vitrine.                                                                |
| `ProductTrial` (unique par organisation et produit)              | Essai : `startedAt` et `endsAt` en UTC, jamais supprimé.                                                                   |
| `ProductSetupFee` (unique par organisation et produit)           | Setup unique. Statuts `DUE`, `INVOICED`, `PAID`, `WAIVED`.                                                                 |
| `ActivationRequest` (index unique partiel `PENDING`)             | Demande d'activation : une seule en attente par application.                                                               |
| `Organization.showcaseGrandfathered`                             | Droit de publier un site sans offre vitrine, pour les organisations antérieures à S1.                                      |
| `SubscriptionStatus.TRIALING`, `SaasProductStatus.PREPRODUCTION` | Nouveaux statuts. L'essai échu n'est pas un statut stocké : il est calculé.                                                |
| `SuiteContract` (inchangé)                                       | Périmètre School : établissements, modules, limites. L'offre gratuite et l'essai School sont des contrats (`limits.tier`). |

Les migrations sont les suivantes :

- `20261114000000_suite_s1_socle_commercial` : structure ;
- `20261114000100_suite_s1_grille_catalogue` : données idempotentes. Elle installe la nouvelle grille, désactive les anciennes offres et passe School en préproduction. Elle ajoute Facture et Stock et masque Restaurant ainsi que Parc + Restaurant, sans rien supprimer. Elle reprend l'antériorité vitrine et les setups déjà facturés ou dispensés.

Aucun abonnement existant n'est modifié.

### Règles partagées (`packages/shared/src/suite-commercial.ts`)

- `quoteSubscription` et `quoteTotal` : montants de souscription.
- `isSetupFeeDue` : indique si le setup est dû.
- `trialEndsAt` et `trialDaysRemaining` : dates et jours restants de l'essai.
- `canStartTrial` : client seulement pour une application « Disponible » ; Ocall aussi pour un pilote ou une préproduction.
- `commercialState` et `subscriptionAccess` : état présenté et droit d'accès. Ils sont calculés à l'instant de la demande, sans tâche planifiée. Un statut inconnu ne donne jamais un accès complet.
- `canPublishShowcase` : droit de publier un site vitrine.

`suite-contracts.ts` gère les limites `maxStudents`, `aiMonthlyCallsPerSchool`, `sms` et `tier`. Pour chaque limite, la plus favorable des contrats actifs s'applique, sans cumul.

### API

**Client** (organisation toujours lue dans la session) :

- `GET /suite/overview` ;
- `GET /suite/apps/:code/contract` ;
- `POST /suite/apps/:code/trial` ;
- `POST /suite/apps/:code/activation-request`.

**Plateforme** (permissions de facturation et d'abonnements) :

- `GET /platform/suite-commercial/trials` et `POST` sur la même route ;
- `GET /platform/suite-commercial/setup-fees` ;
- `GET /platform/suite-commercial/activation-requests` ;
- `POST /platform/suite-commercial/activation-requests/:id/close`.

**Gardes et contrôles serveur :**

- `ParkReadOnlyGuard` (garde globale) : refuse toute écriture d'un membre quand `loadParkAccess` ne donne pas `full`. Les contrôleurs exemptés sont listés dans la garde, et une route d'écriture peut être exemptée avec `@AllowInParkReadOnly()`. En cas d'erreur de lecture des droits, l'écriture est refusée.
- **Setup unique** : `common/setup-fee.ts`. La ligne est verrouillée par `FOR UPDATE` dans la transaction de facturation.
- **Option vitrine** : `common/showcase.ts`, appelé par la publication des sites Park et School.
- **Élèves actifs School** : `modules/school/school-free-limits.ts`. Verrou transactionnel par organisation, puis recomptage dans la même transaction que l'écriture.
- **IA School** : plafond contractuel `contractMonthlyLimit` dans `AiCallContext`, appliqué sous le verrou existant du quota.
- **IA Park** : nouvelles offres à 150 requêtes par mois et par organisation. Les réglages IA affichent le plafond réellement appliqué (le plus bas entre le réglage et l'offre) : un réglage antérieur ou par défaut supérieur reste enregistrable tel qu'affiché.
- **Commissions partenaires** : calculées sur les lignes de facture réellement réglées, elles-mêmes issues des prix figés sur le contrat (ou, à défaut, de son offre, même retirée du catalogue). Un contrat antérieur à S1 garde donc ses anciens tarifs et ses commissions associées.

### Tests

- **Unitaires :**
  - `packages/shared/src/suite-commercial.spec.ts` : grille, essai, états et droits, option vitrine, School Free dans le résolveur ;
  - `suite-contracts.spec.ts`.
- **Intégration :** `apps/api/test/suite-s1-commercial.integration.spec.ts` :
  - essai unique, y compris en concurrence ;
  - préproduction ;
  - lecture seule et rétablissement ;
  - setup unique, y compris en concurrence ;
  - demandes d'activation et isolation ;
  - option vitrine ;
  - réglages IA d'un nouveau client enregistrables ;
  - contrat antérieur à S1 : facture et commissions au tarif contractuel ;
  - School Free : élèves en concurrence, SMS, passage au payant.
- Les suites existantes ont été adaptées aux règles validées :
  - prix de la grille ;
  - essai à l'inscription ;
  - School en préproduction ;
  - offre vitrine requise pour publier.

### Limite connue

Les canaux publics de commande (borne, commande en ligne sans compte membre) ne passent pas par `ParkReadOnlyGuard`, qui ne s'applique qu'aux membres connectés : une organisation en lecture seule peut encore y recevoir des commandes. À traiter dans un sprint ultérieur.

### Hors périmètre de S1

- Paiement en ligne.
- Mode hors ligne.
- Crédits SMS (Sprint S2).
- Applications Facture et Stock : seulement leurs fiches « Bientôt disponible ».
- Toute migration ou tout déploiement en production.
