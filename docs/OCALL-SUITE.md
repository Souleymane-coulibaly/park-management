# Ocall Suite — administration centrale (Sprint 11A)

Espace `/admin`, réservé aux comptes internes Ocall. Il ne donne aucun accès aux données métier des
clients (ventes, tickets, clients finaux) : seulement organisations, abonnements, factures et
règlements.

## Principe commercial

Les clients paient Ocall **directement, hors plateforme** (espèces, virement, mobile money). Aucun
prestataire de paiement, aucun encaissement ni renouvellement automatique.

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

| Rôle                   | Accès                                                                    | MFA         |
| ---------------------- | ------------------------------------------------------------------------ | ----------- |
| Propriétaire           | Tout, y compris les comptes internes                                     | Obligatoire |
| Administrateur délégué | Tout sauf les comptes internes                                           | Obligatoire |
| Facturation            | Tableau de bord, organisations, abonnements, factures, règlements        | Obligatoire |
| Assistance             | Tableau de bord, organisations, domaines, **support**                    | Facultative |
| Consultation et audit  | Lecture : tableau de bord, organisations, facturation, audit, paramètres | Facultative |

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
