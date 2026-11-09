# Ocall Suite — Crédits SMS School, notifications et expérience client (Sprint S2)

Branche `claude/suite-s02`, partie de `main` `66c5257` (S1 fusionné). Aucun paiement en ligne. Aucun
fournisseur SMS réel : seul le fournisseur simulé existe, aucun SMS réel n'est envoyé.

Décision du client du 09/11/2026 : les SMS restent réservés aux offres qui les incluent (essai ou
payant, règle S1 inchangée) **et** exigent un solde de crédits prépayés suffisant. L'offre Ocall School
Free n'a ni SMS ni recharge.

## 1. Ce que voit le client (documentation fonctionnelle)

### Crédits SMS School (page Communication, direction de l'établissement)

- **Solde par établissement** : disponible, réservé (envois en cours) et consommé. Les crédits d'un
  établissement ne servent jamais à un autre, même au sein du même client.
- **Unité de facturation** : 1 crédit = 1 segment SMS vers un numéro national.
  - Texte « GSM-7 » (alphabet SMS standard) : 160 caractères pour un SMS d'un seul segment, 153 par
    segment au-delà.
  - Texte « UCS-2 » (arabe, emoji, ou tout caractère hors GSM-7, y compris l'apostrophe typographique
    ’) : 70 caractères pour un seul segment, 67 par segment au-delà.
  - International (indicatif différent de celui du pays de l'établissement) : chaque segment coûte le
    nombre de crédits fixé par le tarif. Tant qu'Ocall n'a pas fixé cette valeur, les envois
    internationaux sont refusés.
  - Un numéro sans indicatif est national. Si le pays n'a pas d'indicatif connu, tout numéro au format
    international est traité comme international, pour ne jamais sous-facturer.
- **Demande de recharge** : nombre de crédits, de 50 à 100 000, et précision facultative.
  - Le montant indicatif s'affiche si Ocall a publié un prix ; sinon : « tarif communiqué par Ocall ».
  - Le paiement se fait hors plateforme, et rien n'est crédité à la demande.
  - Une seule demande en attente par établissement ; elle peut être annulée.
- **Après la décision d'Ocall** : demande validée (solde crédité) ou refusée (motif affiché). Dans les
  deux cas, notification dans le portail Suite.
- **Envoi d'un SMS** :
  - Les crédits sont réservés avant l'envoi. Sans solde suffisant, le SMS est annulé (« Solde SMS
    insuffisant »), jamais envoyé.
  - Les crédits sont consommés quand le fournisseur accepte le message, et rendus en cas d'échec
    définitif ou d'annulation.
  - Les nouvelles tentatives après un échec passager ne débitent pas une seconde fois.
- **Historique** : les envois affichent statut, crédits, motif lisible et numéro masqué, jamais le
  texte. Sont aussi consultables les demandes de recharge et les opérations du registre.

### Portail Ocall Suite (`/suite`)

- **Synthèse** : applications ouvertes et disponibles, prochaine échéance (essai ou abonnement, avec
  le nombre de jours), demandes en attente, notifications non lues.
- **Carte d'application** :
  - statut, tarif contractuel figé et option vitrine ;
  - échéance et jours restants, en évidence à 7 jours ou moins ;
  - demande en attente.
- **Demandes** :
  - _Activation_ : application jamais payée. Choix de l'offre, tarif en vigueur et mise en service
    selon la règle S1.
  - _Renouvellement_ : abonnement déjà payé une fois, offre en cours, **tarif contractuel conservé**
    (tarif historique, jamais le tarif du jour).
  - _Changement d'offre_ : autre offre de l'application, à son tarif en vigueur.
  - Une seule demande en attente par application, tous types confondus.
  - Un abonnement suspendu ou résilié se règle avec Ocall.
- **Contrat** : en plus du détail S1, l'historique des demandes (type, offre, montant, statut). Le motif
  n'apparaît que pour un refus : les références de règlement internes d'Ocall ne sont jamais montrées.
- **Centre de notifications** (`/suite/notifications`) :
  - cloche avec le nombre de non lues, filtre « non lues » ;
  - marquage lu, une notification ou toutes ;
  - pagination et lien vers l'élément concerné.

### Notifications

Destinataires : les membres actifs de l'organisation qui voient l'abonnement (droit
`subscription.read` : propriétaire, administrateur, superviseur). Un caissier ou un compte School
« utilisateur produit » ne reçoit rien.

| Événement                       | Quand                                                                 |
| ------------------------------- | --------------------------------------------------------------------- |
| Essai démarré                   | inscription (Park), essai démarré par le client ou par Ocall          |
| Fin d'essai proche              | J-7, J-3, J-1 (politique configurable)                                |
| Essai terminé                   | jour J (échéance atteinte)                                            |
| Échéance d'abonnement proche    | J-7, J-3, J-1                                                         |
| Abonnement expiré               | jour J                                                                |
| Demande enregistrée             | activation, renouvellement, changement d'offre                        |
| Demande traitée ou non retenue  | clôture par Ocall (motif seulement en cas de refus)                   |
| Activation confirmée            | règlement validé : activation ou prolongation (une fois par échéance) |
| Suspension, réactivation        | action Ocall (le motif interne n'est pas transmis)                    |
| Recharge SMS validée ou refusée | décision Ocall                                                        |

Canal : portail Suite uniquement. Le dépôt n'a pas de service d'e-mail. Aucun SMS commercial n'est
envoyé, et les crédits SMS School ne servent jamais aux notifications Suite.

**Les notifications ne décident jamais de l'accès.** L'expiration reste appliquée côté serveur à chaque
requête : lecture seule Park (D3), contrats School (S1).

## 2. Super Admin

- **Crédits SMS School** (`/admin/sms`, lecture `platform.billing.read`) :
  - **Demandes en attente** : établissement, crédits, montant indicatif. Validation avec crédits
    accordés, référence du règlement vérifié et note ; refus motivé. Les deux exigent
    `platform.billing.validate`.
  - **Portefeuilles** : disponible, réservés, consommés. Le détail montre le registre, ainsi que la
    correction motivée (positive ou négative), avec 10 caractères de justification au moins et
    idempotente.
  - **Erreurs d'envoi** : motif et numéro masqué, jamais le texte.
  - **Tarif versionné** (création réservée à `platform.plans.manage`) : prix d'un crédit (facultatif,
    « non publié » sinon), coût fournisseur par segment (interne, jamais montré aux établissements),
    crédits par segment à l'international (facultatif : international refusé sinon). Chaque
    modification crée une version ; l'historique n'est jamais modifié.
- **Échéances et renouvellements** (`/admin/echeances`) :
  - abonnements à échéance, filtrés par application et horizon (7, 30 ou 90 jours), avec tarif
    contractuel et jours restants ;
  - essais en cours et expirés non convertis ;
  - demandes par type et statut ;
  - notifications émises : une ligne par fait, avec destinataires et lectures, sans contenu personnel ;
  - historique du traitement des rappels, avec lancement manuel (`platform.subscriptions.manage`).
- **Essais et activations** (S1) : le type de chaque demande est affiché. La clôture est inchangée
  (« Traitée » ou « Refuser » avec note).

Aucune donnée scolaire (élèves, notes) n'est montrée au Super Admin : noms d'établissement, soldes et
numéros masqués seulement.

## 3. Conception technique

### Modèle

Toutes les migrations sont additives : aucune suppression, aucune colonne retypée (`db:migrate:check`).

**Base School** — migration `20261114000000_school_s2_portefeuille_sms` :

- `SchoolSmsWallet` : clé `schoolId`, clé étrangère (client, établissement) vers `School`. Champs
  `balance` et `reserved`, avec `CHECK >= 0`.
- `SchoolSmsLedgerEntry` : registre **en ajout seul**.
  - Toute mise à jour est refusée par un déclencheur ; la suppression reste possible pour l'effacement
    d'un client.
  - Champs : `kind` (TOPUP, RESERVE, CAPTURE, RELEASE, ADJUSTMENT), `availableDelta`, `reservedDelta`,
    soldes après l'opération, message ou demande liés, auteur, motif.
  - Unicité `(organizationId, idempotencyKey)`.
- `SchoolSmsTopUpRequest` : demandes de recharge, avec un index unique partiel (une seule `PENDING`
  par établissement) et des montants `CHECK > 0`.
- `SchoolSmsTariff` : versions du tarif (`version` unique, mises à jour refusées par déclencheur).
- `SchoolSmsMessage` reçoit des colonnes ajoutées avec une valeur par défaut : `segments`, `encoding`,
  `international`, `creditsReserved`, `creditState` (NONE, RESERVED, CAPTURED, RELEASED).

**Base Suite** — migration `20261116000000_suite_s2_notifications_renouvellements` :

- `ActivationRequest.kind` (ACTIVATION, RENEWAL, PLAN_CHANGE) : les demandes S1 deviennent des
  activations, aucune autre donnée n'est modifiée.
- `SuiteNotification` :
  - un enregistrement par destinataire, unicité `(userId, dedupeKey)` ;
  - clés étrangères en cascade vers l'organisation et le compte.
- `SuiteScheduledJob` : verrou à bail d'un traitement planifié.
- `SuiteJobRun` : historique des exécutions (statistiques, erreur technique sans donnée client).
- Index `Subscription.expiresAt`.

### Intégrité des crédits

Toutes les écritures passent par `applySmsLedger`
(`apps/api/src/modules/school/school-sms-ledger.ts`) :

1. La clé d'idempotence est vérifiée.
2. Le portefeuille est créé s'il n'existe pas. La clé étrangère refuse un établissement d'un autre
   client.
3. Le solde est mis à jour par une requête conditionnelle :
   `UPDATE … WHERE balance + Δ >= 0 AND reserved + Δr >= 0`. Le verrou de ligne implicite empêche que
   deux envois simultanés dépensent le même crédit.
4. L'écriture du registre est faite dans la même transaction. Une concurrence sur la même clé échoue à
   l'insertion et annule la transaction entière, solde compris.

Les opérations s'enchaînent ainsi :

- **Réservation**, dans la transaction qui prend les messages en charge (`FOR UPDATE SKIP LOCKED`
  existant) : clé `reserve:<message>`, une seule fois par message.
- **Règlement** : `settleSmsCredits` fait passer conditionnellement le message de RESERVED à CAPTURED
  ou RELEASED. Il est appliqué :
  - dans la même transaction que le statut SENT ou FAILED ;
  - à l'annulation : destinataire inéligible, droit SMS retiré du contrat, solde insuffisant,
    destination refusée ;
  - à l'abandon après la dernière tentative interrompue.
- **Recharge** : passage conditionnel de PENDING à APPROVED, puis crédit sous la clé `topup:<demande>`,
  dans la même transaction. La double validation est refusée (409).
- **Correction** : la clé `adjust:<uuid>` est fournie par l'écran, ce qui neutralise le double clic.

**Politique de facturation retenue** :

- succès → crédits consommés ;
- échec définitif signalé par le fournisseur, ou annulation → crédits rendus ;
- échec passager → réservation conservée pour la tentative suivante ;
- **résultat inconnu** → message clos `OUTCOME_UNKNOWN`, crédits consommés, **jamais renvoyé** (le
  parent ne reçoit pas de doublon).

Le résultat est inconnu quand le marqueur `SENDING`, posé à la prise en charge, est retrouvé après
l'expiration du bail : arrêt brutal entre l'appel au fournisseur et l'enregistrement du résultat.

Une erreur d'enregistrement après l'acceptation n'est jamais traitée comme une erreur du fournisseur :
l'enregistrement est retenté une fois, puis le message est clos « résultat inconnu » au passage
suivant.

> **À aligner** avec la politique du fournisseur réel avant toute mise en service, en particulier la
> facturation d'un message accepté puis non distribué. Il n'existe pas d'accusé de réception de
> distribution aujourd'hui.

### Rappels d'échéance

`SuiteRemindersService` (`apps/api/src/modules/suite-notifications/`) suit le modèle des traitements
existants : `setInterval` horaire avec `.unref()`, première exécution une minute après le démarrage,
rien en test. S'y ajoutent :

- **Verrou à bail en base** : une seule instance exécute le traitement, et il est repris après 10 min
  en cas d'arrêt brutal.
- **Historique des exécutions** : statistiques et erreur.
- **Lancement manuel** : `POST platform/suite-notifications/run-reminders`.

Règles :

- **Politique** : `SUITE_REMINDER_OFFSETS`, « 7,3,1 » par défaut (`parseReminderOffsets`).
- **Seuil émis** : seul le seuil le plus proche déjà franchi est émis. Après une interruption, les
  seuils manqués ne partent pas en rafale.
- **Jour J** : notifié dans les 7 jours qui suivent l'échéance.
- **Clé de déduplication** : `trial|sub:<id>:<échéance ISO>:J-n|J0`. Un redémarrage, une reprise ou
  une exécution concurrente ne crée aucun doublon. Un renouvellement change l'échéance, donc réarme les
  rappels.
- **Essais** : rappels seulement si l'abonnement est encore en essai (TRIALING). Un essai converti,
  suspendu ou résilié n'en reçoit plus.
- **Abonnements** : ACTIVE, PAST_DUE, PENDING_ACTIVATION, et EXPIRED pour le jour J.
- **Dates** : UTC en base et dans les calculs ; affichées au format français (UTC).

Les événements (essai démarré, demandes, activation, suspension, réactivation) sont notifiés par
`notifyOrganization` (`apps/api/src/common/suite-notify.ts`), **dans la transaction du fait notifié** :
la notification existe si, et seulement si, le fait est enregistré.

Les recharges SMS forment l'exception, puisque deux bases sont en jeu. La décision est d'abord
enregistrée dans le registre School, avec son auteur et son motif. Le journal Ocall et la notification
sont écrits ensuite dans la base Suite ; s'ils échouent, l'erreur est journalisée, sans annuler le
crédit.

### API

Toutes les routes appliquent :

- l'organisation de la session, jamais un identifiant d'organisation venant du client ;
- l'établissement vérifié par `assertSchool` ;
- des DTO validés en liste blanche ;
- une pagination par curseur pour les historiques.

| Route                                                                                                       | Droit                              |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `GET suite/notifications?unread=&cursor=` · `GET suite/notifications/unread-count`                          | membre (ses propres notifications) |
| `POST suite/notifications/:id/read` · `POST suite/notifications/read-all`                                   | membre                             |
| `POST suite/apps/:code/activation-request` `{ planId, kind? }`                                              | `subscription.pay`                 |
| `GET suite/apps/:code/requests`                                                                             | `subscription.read`                |
| `GET school/sms/wallet` · `GET school/sms/ledger` · `GET school/sms/top-ups`                                | `school.sms.manage`                |
| `POST school/sms/top-ups` (20/min) · `POST school/sms/top-ups/:id/cancel`                                   | `school.sms.manage`                |
| `GET platform/school-sms/wallets` · `…/wallets/:schoolId/ledger` · `…/top-ups` · `…/failures` · `…/tariffs` | `platform.billing.read`            |
| `POST platform/school-sms/top-ups/:id/approve` · `…/reject` · `…/wallets/:schoolId/adjustments`             | `platform.billing.validate`        |
| `POST platform/school-sms/tariffs`                                                                          | `platform.plans.manage`            |
| `GET platform/suite-notifications` · `…/job-runs` · `…/due-soon`                                            | `platform.billing.read`            |
| `POST platform/suite-notifications/run-reminders`                                                           | `platform.subscriptions.manage`    |
| `GET platform/suite-commercial/activation-requests?status=&kind=&productCode=&organizationId=`              | `platform.billing.read`            |

### Tests

- **Unitaires** (`packages/shared`) :
  - segments GSM-7 et UCS-2, multipart, extension GSM, destination nationale ou internationale, coût,
    montant indicatif ;
  - seuils J-7, J-3, J-1 et J, absence de rafale, clé de déduplication, politique configurable,
    textes.
- **Intégration** :
  - `suite-s2-sms-wallet` (14 tests) :
    - portefeuille vide, demande sans crédit, unicité de la demande en attente, bornes ;
    - quatre validations simultanées donnent un seul crédit ; refus ; annulation ;
    - offre gratuite refusée ;
    - envoi GSM-7 en 2 segments, UCS-2 arabe ;
    - solde insuffisant : SMS jamais transmis ;
    - 6 SMS pour 3 crédits avec 3 traitements simultanés : exactement 3 envois, solde 0 ;
    - échec définitif : crédits rendus ; échec passager : débit unique en 3 tentatives ;
    - reprise après une interruption ;
    - international refusé, puis facturé selon le tarif ;
    - corrections idempotentes, jamais un solde négatif ;
    - registre en ajout seul et cohérence registre ↔ solde ;
    - isolation des établissements.
  - `suite-s2-notifications` (11 tests) :
    - centre de notifications, isolation, destinataires ;
    - suspension et réactivation ;
    - J-7, J-3, J-1 et J sans doublon, y compris avec 5 exécutions simultanées ;
    - activation et renouvellement qui réarment les rappels ;
    - historique et droits du Super Admin, échéances filtrées ;
    - renouvellement au tarif historique, une seule demande en attente sous concurrence ;
    - changement d'offre, refus motivé.
- **Tests existants adaptés** :
  - les établissements des essais SMS du sprint 6 sont crédités, puisqu'aucun SMS ne part sans solde ;
  - les nettoyages incluent les nouvelles tables.
- **E2E** (`e2e/suite-s2.spec.ts`) :
  1. Portail : synthèse, notifications (badge, tout lire, filtre), contrat, jours restants,
     renouvellement au tarif contractuel. Mobile sans débordement.
  2. Recharge SMS demandée par l'établissement, validée par un Super Admin sous double
     authentification réelle, solde crédité et établissement notifié.
  3. Isolation : un autre client obtient 404 sur le portefeuille, 403 sur l'administration, et est
     redirigé hors de `/admin`.

  La config E2E génère une clé MFA jetable à chaque lancement : aucun secret n'est versionné.

### Correctifs de l'audit Codex (fin de sprint)

Audit statique indépendant : NO GO en première passe (2 P0, 2 P1, 5 P2). Tout a été corrigé en une
passe, et chaque correctif est couvert par un test.

| #   | Anomalie                                                                                                                                 | Correctif                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0  | Crédits rendus pour un SMS accepté (erreur d'enregistrement traitée comme une erreur fournisseur ; arrêt brutal à la dernière tentative) | Erreurs fournisseur et d'enregistrement séparées ; marqueur `SENDING` ; résultat inconnu → consommé, jamais renvoyé ; enregistrement du succès retenté |
| P0  | Référence de règlement et note interne visibles de l'établissement                                                                       | Projection client : registre sans motif ; note de traitement montrée seulement en cas de refus                                                         |
| P1  | Renouvellement impossible pour une offre historique désactivée (ou Restaurant)                                                           | Le renouvellement porte sur l'offre contractuelle de l'abonnement, même inactive ou historique                                                         |
| P1  | Recharge d'un établissement Free permise par le contrat payant d'un autre                                                                | Droit SMS calculé par établissement (`smsAllowedSchools`) : affichage, demande, validation (revérifiée), mise en file et envoi                         |
| P2  | Devis de renouvellement incohérent (mensualité figée, échéances au tarif du jour)                                                        | Devis entier calculé au tarif contractuel                                                                                                              |
| P2  | Suspension et type de demande contournables avec `ACTIVATION`                                                                            | Suspendu → aucune demande ; abonnement déjà payé → pas d'activation ; `canRequestActivation` aligné                                                    |
| P2  | Rappel créé après une conversion, un renouvellement ou une suspension concurrents                                                        | Abonnement verrouillé et relu dans la transaction qui crée le rappel                                                                                   |
| P2  | Formulaire de demande conservant l'offre d'un autre type                                                                                 | Formulaire réinitialisé à chaque type                                                                                                                  |
| P2  | Historiques au-delà de 50 lignes inaccessibles                                                                                           | Pagination par curseur : registre (établissement et Super Admin), recharges                                                                            |

**Vérification Codex ciblée** des 9 correctifs, au commit `0e270e5` :

- 7 correctifs sont confirmés, dont les deux P0, P1-3 et le correctif de concurrence des rappels
  (P2-7). Ce dernier a été vérifié par raisonnement : même verrou de ligne que l'activation, le
  renouvellement et la suspension, comparaison d'échéance cohérente, pas d'interblocage.
- 2 correctifs sont partiels, et complétés depuis :
  - P1-4 : sans contrat actif (suspendu, expiré), l'établissement gardait le droit aux SMS. Le droit
    exige désormais un accès complet, et le réglage d'activation des SMS est lui aussi calculé par
    établissement.
  - P2-6 : le portail proposait une activation pour un essai suspendu. Il ne propose plus aucune
    demande sur un abonnement suspendu.

Chaque correctif complémentaire a son test, et sa mutation est détectée.

### Risques résiduels et limites

1. **Fournisseur réel absent.** La politique de facturation (succès consommé, échec rendu) devra être
   alignée sur celle du fournisseur retenu, en particulier les accusés de distribution. Aucun
   fournisseur payant n'est activé.
2. **Opérations sur deux bases.** La validation d'une recharge crédite la base School puis journalise
   et notifie dans la base Suite. Si cette seconde écriture échoue, elle n'est pas rejouée
   automatiquement ; le registre School conserve néanmoins l'auteur et la référence.
3. **Coût des SMS en français.** L'apostrophe typographique (’) des modèles de SMS impose l'UCS-2,
   soit 70 caractères par segment. Normaliser ces caractères avant l'envoi réduirait le coût (P3,
   backlog).
4. **Pas d'e-mail.** Les notifications restent dans le portail tant qu'aucun service d'e-mail n'existe.
   Les préférences de notification ne sont pas nécessaires avec un seul canal.
5. **Prix.** Aucun prix commercial SMS n'est publié : le mécanisme est en place, le prix est à fixer
   par Ocall dans le tarif versionné.
6. **Recalcul du solde.** Le registre permet de recalculer le solde (vérifié en test). Aucun traitement
   automatique de réconciliation n'est planifié.

7. **Résultat inconnu.** Un arrêt brutal entre la prise en charge et l'enregistrement clôt le message
   en « résultat inconnu », avec les crédits consommés, même si le fournisseur n'avait finalement pas
   été appelé. C'est un choix prudent : aucun doublon chez le parent, aucune restitution indue. Cas
   rare, visible dans l'historique et dans les erreurs d'envoi du Super Admin.

### Hors périmètre de S2

Ocall Facture, Ocall Stock, mode hors ligne, paiement en ligne, nouveau fournisseur SMS, refonte Park
ou School, landing page.
