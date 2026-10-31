# Paiement en ligne des factures SaaS (Sprint 12A)

Les organisations clientes peuvent régler leurs **factures Ocall** par carte ou mobile money. Les
règlements manuels (virement, espèces) restent disponibles : voir
[GUIDE-PAIEMENT-MANUEL.md](GUIDE-PAIEMENT-MANUEL.md).

**État au 2026-10-31** : le socle est livré et testé avec un **prestataire simulé**. L'adaptateur
CinetPay réel **n'est pas livré** : le commanditaire doit d'abord confirmer l'API de son compte
marchand (voir §6). Aucun appel réel n'a été fait.

## 1. Règles de sécurité

| Règle                                                     | Mise en œuvre                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Aucune donnée de carte reçue ni stockée                   | Le client paie sur la page sécurisée du prestataire ; l'API ne reçoit qu'une référence                       |
| Aucun secret dans le navigateur                           | Identifiants du prestataire uniquement côté API (variables scellées)                                         |
| Une redirection du navigateur ne confirme jamais          | La page de retour interroge l'API, qui **revérifie** auprès du prestataire                                   |
| Une notification non vérifiée n'active rien               | Notification authentifiée (jeton du prestataire), puis **toujours** revérifiée par un appel serveur          |
| Référence, montant, devise et facture contrôlés           | Écart → statut `REVIEW_REQUIRED`, **aucun encaissement**, journal d'audit                                    |
| Idempotence (notifications répétées, double activation)   | Verrou du paiement en ligne, statuts finaux jamais rejoués, un seul règlement par paiement (unicité en base) |
| Aucun abonnement récurrent, aucun prélèvement automatique | Chaque paiement porte sur une facture émise                                                                  |
| Produit indisponible ou suspendu                          | Paiement refusé à l'initialisation ; activation refusée                                                      |

## 2. Parcours

1. **Client** (permission `subscription.pay`, propriétaire et administrateur) : _Abonnement → Factures
   Ocall → Payer en ligne_ (carte, mobile money ou les deux).
2. L'API verrouille la facture, calcule le **reste dû**, crée une référence unique et persistante
   (`OCS…`), puis appelle le prestataire **hors transaction**. Une tentative récente encore en cours
   est réutilisée (même référence) ; une autre tentative est refusée pendant 30 minutes
   (`ONLINE_PAYMENT_PENDING_TTL_MINUTES`).
3. Le client paie chez le prestataire, puis revient sur `/app/abonnement/paiement/<référence>`.
4. **Notification** sur `POST /api/v1/online-payments/notify` (publique, limitée en débit,
   authentifiée par le prestataire) → **vérification serveur** → règlement.
5. Succès vérifié et cohérent : création d'un règlement **CONFIRMED** (`CINETPAY_CARD` ou
   `CINETPAY_MOBILE_MONEY`), facture payée, puis activation selon le **mode figé** de l'abonnement
   (§3). La période couverte suit l'échéance en cours (ou commence le jour même) pour le nombre de
   mois facturés ; une facture sans mensualité n'active rien.

Statuts d'un paiement en ligne : `CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED`,
`REVIEW_REQUIRED`, `REFUNDED`. Chaque étape est journalisée (`OnlinePaymentEvent`, sans secret).

## 3. Activation : AUTO ou ADMIN_APPROVAL

Réglée **par offre** (`SubscriptionPlan.activationMode`, défaut `ADMIN_APPROVAL`), **figée** sur
chaque abonnement à la souscription ou à un changement d'offre explicite : modifier l'offre n'est
jamais rétroactif. Le changement est journalisé (`platform.plan_updated`, avant / après).

- **AUTO** : activation ou prolongation automatique si le produit est commercialisé et l'abonnement
  n'est ni résilié ni suspendu ; sinon le règlement passe en approbation (motif enregistré).
- **ADMIN_APPROVAL** : le règlement est encaissé et compté ; l'activation attend une décision dans
  _Super Admin → Règlements → Activations à approuver_ (compteur au tableau de bord). Un abonnement
  non valide passe `PENDING_ACTIVATION` ; un renouvellement d'abonnement **encore valide reste
  ACTIVE** (seule la prolongation attend).
- **Refus** (motif obligatoire) : le paiement reste encaissé ; il est à rembourser. L'abonnement
  revient à son état précédent.

Les mêmes règles s'appliquent après la **confirmation** d'un règlement manuel.

## 4. Remboursements

Aucune API de remboursement n'est documentée par CinetPay. Le remboursement est fait dans l'espace
marchand, puis **enregistré à la main** (_Règlements → Remboursement_, motif obligatoire) : le
règlement passe `REFUNDED`, le paiement en ligne aussi, la facture redevient à payer si elle n'est
plus soldée. L'abonnement n'est jamais modifié automatiquement (suspension éventuelle : action
explicite).

## 5. Configuration

| Variable (API)                       | Rôle                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `ONLINE_PAYMENT_PROVIDER`            | `none` (défaut), `simulated` (tests, **interdit en production**), `cinetpay` (**refusé** tant que l'adaptateur n'est pas livré) |
| `API_PUBLIC_URL`                     | Adresse publique de l'API (URL de notification), **https** en production                                                        |
| `WEB_APP_URL`                        | Adresse de l'application web (retour du client)                                                                                 |
| `ONLINE_PAYMENT_PENDING_TTL_MINUTES` | Délai avant une nouvelle tentative (défaut 30)                                                                                  |

## 6. Adaptateur CinetPay réel : à confirmer

Deux API coexistent ; la documentation officielle (`docs.cinetpay.com`) était injoignable le
2026-10-31 depuis le poste de développement.

|              | « Checkout V2 »                                              | Nouvelle API (SDK officiel actuel)                           |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Hôtes        | `api-checkout.cinetpay.com/v2`                               | bac à sable `api.cinetpay.net`, production `api.cinetpay.co` |
| Identifiants | `apikey` + `site_id`                                         | `api_key` + `api_password`, jeton Bearer, un compte par pays |
| Notification | en-tête `x-token` HMAC-SHA256 (liste des champs à confirmer) | `notify_token` comparé à la valeur stockée                   |
| Vérification | `POST /v2/payment/check`                                     | `GET /v1/payment/{merchant_transaction_id}`                  |

L'adaptateur implémentera `OnlinePaymentProvider` (`initiate`, `verify`, `authenticateNotification`)
sans changer le reste. Avant tout paiement réel : compte de test, essais en bac à sable, validation
du format exact de la notification sur une transaction de test, puis autorisation du commanditaire.

## 7. Super Admin

- _Paiements en ligne_ : tentatives, statuts, revérification manuelle (`platform.billing.validate`).
- _Règlements_ : règlements issus des paiements en ligne, décisions d'activation, remboursements.
