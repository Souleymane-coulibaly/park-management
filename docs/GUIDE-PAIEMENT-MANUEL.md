# Guide des règlements manuels des abonnements (virement, espèces)

Les factures Ocall se règlent **en ligne** (voir [PAIEMENT-EN-LIGNE.md](PAIEMENT-EN-LIGNE.md)) ou
**auprès d'Ocall** : virement ou espèces contre reçu. Aucun prélèvement, aucun renouvellement
automatique. Depuis le Sprint 12A, un règlement manuel est **déclaré**, puis **confirmé par une
autre personne** (contrôle à quatre yeux).

## Rôles

| Action                              | Permission Ocall                | Rôles par défaut                                  |
| ----------------------------------- | ------------------------------- | ------------------------------------------------- |
| Émettre ou annuler une facture      | `platform.billing.manage`       | Facturation, administrateur délégué, propriétaire |
| Déclarer un virement                | `platform.billing.manage`       | idem                                              |
| Déclarer des espèces, une remise    | `platform.billing.cash.declare` | idem                                              |
| Confirmer, rejeter, rembourser      | `platform.billing.validate`     | idem — **jamais le déclarant ni le collecteur**   |
| Approuver ou refuser une activation | `platform.activations.approve`  | idem                                              |
| Consulter                           | `platform.billing.read`         | + Consultation et audit                           |

Il faut donc **au moins deux comptes internes habilités** (par exemple le propriétaire et un
responsable facturation). Toutes ces actions exigent la double authentification et sont
journalisées.

## Déroulé

1. **Facture** (`/admin/factures`) : mise en service, mensualités, ajustement motivé éventuel, au
   tarif accepté par le client. Communiquer le numéro (OCP-AAAA-NNNNN).
2. **Réception** du paiement : relevé bancaire pour un virement ; pour des espèces, **reçu papier
   remis au client**. Ne jamais se fier à une capture d'écran seule.
3. **Déclaration** (`/admin/reglements` → « Déclarer un règlement ») : organisation, **facture
   (obligatoire)**, montant, devise de la facture, référence du virement ou **référence du reçu
   papier** (espèces, obligatoire), date, période couverte, observations. Pour des espèces, un
   **numéro de reçu Ocall** (REC-AAAA-NNNNN) est attribué automatiquement et le collecteur est
   enregistré. Statut : **À vérifier**. Une déclaration **n'est pas un encaissement** et n'active
   rien.
4. **Confirmation** par une **autre personne** habilitée, après vérification de la réception
   effective. Statut : **Confirmé**. Si la facture est alors soldée, l'activation suit le **mode
   figé** de l'abonnement : automatique (AUTO) ou dans la file « Activations à approuver »
   (ADMIN_APPROVAL, défaut).
5. En cas de doute : **rejeter** avec un motif. Le déclarant peut **annuler** sa déclaration avant
   confirmation.

## Montants

- **Paiement partiel** : accepté ; la facture reste « Émise » avec son reste dû.
- **Surpaiement** et **double déclaration** : refusés. Le montant ne peut pas dépasser le reste dû,
  règlements déclarés et à vérifier compris (contrôle sous verrou de la facture).
- **Reçu en double** : une même référence de reçu papier est refusée pour un même client.
- **Remboursement** : enregistré après coup avec un motif ; la facture redevient à payer si elle
  n'est plus soldée.

## Espèces : remises et rapprochement de caisse

`/admin/caisse` présente, par collecteur : espèces en cours, confirmées, remises, en attente de
remise, **à remettre** et remboursées. Quand un collecteur dépose ses espèces chez Ocall, il
déclare une **remise** (RCA-AAAA-NNNNN) regroupant ses règlements en espèces confirmés ; une
**autre personne** la confirme (ou la rejette : les règlements redeviennent « à remettre »).

## Activation des abonnements

Voir [PAIEMENT-EN-LIGNE.md §3](PAIEMENT-EN-LIGNE.md#3-activation--auto-ou-admin_approval). Le
paiement et l'abonnement sont indépendants : refuser une activation ne supprime pas l'encaissement
(il est à rembourser).

## Autres actions sur un abonnement

Fiche organisation → Abonnements → **Suspendre**, **Réactiver**, **Changer d'offre** (nouveau tarif
accepté, historisé), **Résilier** (définitif). Les abonnements échus passent automatiquement
« Expiré » (vérification horaire, ou bouton dédié) ; rien n'est jamais prolongé sans encaissement.

## Contrôle mensuel

Comparer « Encaissé (confirmé) » du tableau de bord commercial — détaillé en ligne, espèces et
virements — avec les relevés bancaires, l'espace marchand du prestataire et le rapprochement de
caisse ; toute différence doit être expliquée avant la clôture.
