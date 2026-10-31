# Partenaires commerciaux (Sprint 12B)

Les partenaires sont des **apporteurs d'affaires** : ils prospectent, suivent leurs opportunités et
consultent leurs commissions, **sans aucun privilège d'administration SaaS**.

## 1. Compte partenaire

- **Invitation** par le Super Admin (_Partenaires → Inviter_) : compte nominatif, mot de passe
  temporaire affiché une fois et changé à la première connexion, **double authentification
  obligatoire**, code de parrainage unique.
- **Vérification** : le profil est « à vérifier » ; avant validation, le partenaire n'accède qu'à son
  profil. **Suspension** : sessions fermées immédiatement, connexion refusée, plus aucune nouvelle
  commission ; **réactivation** motivée.
- Un compte partenaire est **exclusif** : jamais membre d'une organisation cliente ni compte interne.
- Portail : `/partenaire` (domaine cible envisagé `partners.ocallsuite.com`, non configuré ; même
  règle que les autres domaines : l'ajouter à `APP_HOSTS` et `WEB_ORIGIN`).

## 2. Ce que voit et fait un partenaire

| Section                | Contenu                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Tableau de bord        | Prospects par statut, clients apportés, commissions à venir et versées, lien de parrainage |
| Prospects              | Enregistrement, statut (sauf « gagné »), demande de démonstration                          |
| Clients apportés       | **Nom de l'organisation et montants encaissés uniquement** (aucune donnée métier)          |
| Commissions            | Base encaissée, taux, montant, statut ; versements                                         |
| Espèces                | Seulement s'il y est habilité (voir §6)                                                    |
| Produits et ressources | Produits **commercialisés** et tarifs fixés par Ocall (non modifiables)                    |

Il ne peut jamais : activer un abonnement, confirmer un paiement, modifier un tarif, consulter les
dossiers des clients ou les données scolaires, médicales ou RH, ni voir les prospects, clients ou
commissions d'un autre partenaire. Toutes les règles sont appliquées par le serveur (garde
`@PartnerOnly`, filtrage sur le partenaire de la session).

## 3. Prospects et doublons

- Comparaison côté serveur : **téléphone** (8 derniers chiffres), **e-mail** et **nom d'entreprise**
  normalisés (sans accents, ponctuation ni forme juridique).
- Un prospect est **réservé 90 jours** à son partenaire ; le Super Admin peut prolonger.
- Prospect déjà suivi par un autre partenaire (ou client déjà converti) : refus
  `PROSPECT_ALREADY_ATTRIBUTED`, **sans révéler** quel partenaire.

## 4. Attribution d'un client

- Proposée à partir d'un prospect, d'un lien de parrainage (`/demo?ref=CODE`) ou par Ocall, puis
  **toujours confirmée par le Super Admin** (_Prospects et attributions_).
- **Une seule attribution confirmée par organisation** (sous verrou) ; confirmer rejette les autres
  propositions en attente (conflit tranché). La règle de commission applicable est figée.

## 5. Commissions

- **Règles** (_Commissions partenaires_) : taux en points de base, créées **inactives**, validées
  par le **propriétaire** uniquement. Hypothèse initiale : 15 % de la mise en service encaissée,
  10 % des mensualités encaissées pendant les **12 mois suivant la première activation** du client.
  Aucun taux dans le code.
- **Calcul** : uniquement sur un règlement **CONFIRMÉ** (virement, espèces ou paiement en ligne
  vérifié), jamais sur une déclaration ni une facture impayée ; réparti au prorata des lignes de la
  facture (paiements partiels compris) ; une commission par règlement et par nature (aucun doublon).
- **Remboursement ou litige** : commission non versée → annulée ; déjà versée → régularisation
  négative, déduite du versement suivant.
- **Validation** puis **versement** saisi manuellement (VER-AAAA-NNNNN) et **confirmé par une autre
  personne**. Aucun versement automatique.

## 6. Collecte d'espèces par un partenaire

Désactivée par défaut ; activable par partenaire avec un **plafond** des collectes non encore
remises. Le partenaire **déclare** la collecte (facture d'un client qui lui est attribué, reçu
remis au client, numéro de reçu Ocall attribué) ; Ocall la **confirme** à la remise des espèces
(contrôle à quatre yeux de fait). Le rapprochement de caisse affiche une ligne par partenaire.

## 7. Permissions internes

| Permission                      | Rôles par défaut                                  |
| ------------------------------- | ------------------------------------------------- |
| `platform.partners.manage`      | Propriétaire, administrateur délégué              |
| `platform.commissions.validate` | Propriétaire, administrateur délégué, facturation |
| `platform.payouts.manage`       | Propriétaire, administrateur délégué, facturation |

Activation des règles de commission : propriétaire uniquement. Toutes les actions sont journalisées
(`platform.partner_*`, `platform.attribution_*`, `platform.commission*`, `platform.payout_*`,
`partner.*`).
