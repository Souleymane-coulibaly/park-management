# Checkpoint CP-11 — préparation (Sprint 12A ; 12B à venir)

Ce document prépare l'audit indépendant Codex CP-11. Il ne constitue pas l'audit lui-même. CP-11
couvrira le Sprint 12 entier (12A puis 12B, portail partenaires) ; cette version décrit le 12A.

## Contexte de décision

- **CP-10 (Sprints 1 à 11) n'est pas réalisé** : le commanditaire a fait démarrer le 12A avant
  l'audit (2026-10-31). Les anomalies ouvertes de CP-10 restent ouvertes, sauf celles corrigées
  ci-dessous, qui doivent être revérifiées par l'auditeur.
- Extensions ajoutées pendant le sprint, validées par le commanditaire : paiement en ligne CinetPay
  (socle et simulateur), double mode d'activation, paiement en espèces.

## Référentiel

- Branche `claude/sprint-12` depuis `e1efd33`, **non commitée** à la date de ce document.
- Migration `20261101000000_ocall_suite_12a`, additive, **non appliquée** : renommages de valeurs
  d'énumérations (`AVAILABLE`→`ACTIVE`, `UPCOMING`→`COMING_SOON`, `PENDING`→`PENDING_VERIFICATION`,
  `VALIDATED`→`CONFIRMED`, `BANK_TRANSFER`→`MANUAL_TRANSFER`), nouvelles tables
  (`SubscriptionPriceHistory`, `OnlinePayment`, `OnlinePaymentEvent`, `DemoRequest`,
  `CashRemittance`), 4 produits futurs, reprise des tarifs acceptés et des modes d'activation.
  Vérifiée : appliquée sur une base vierge, le schéma obtenu est identique au schéma Prisma.

## Points à vérifier

1. **Commercialisation** (`packages/shared/src/platform.ts`, `suite.service.ts`,
   `subscription-billing.ts`) : règle unique `canSubscribeToProduct` / `isProductBillable` appliquée à
   la souscription, la facture, la prolongation, le paiement en ligne et l'API publique.
2. **Règlements** (`platform/payments.service.ts`) : facture obligatoire, reste dû sous verrou
   (surpaiement, double déclaration), reçus numérotés et uniques, quatre yeux (déclarant et
   collecteur exclus), transitions conditionnelles, remboursement, remises d'espèces.
3. **Activation** : mode figé par abonnement ; AUTO bloqué si produit indisponible ou abonnement
   résilié / suspendu ; ADMIN_APPROVAL n'interrompt pas un abonnement en cours ; refus motivé sans
   annulation de l'encaissement.
4. **Paiement en ligne** (`modules/online-payments/*`) : aucune confirmation par redirection,
   notification authentifiée puis revérifiée, contrôle de cohérence (montant, devise, transaction,
   facture), idempotence, isolation entre organisations, prestataire simulé interdit en production,
   adaptateur réel refusé tant qu'il n'existe pas.
5. **Abonnements** (`subscription-admin.service.ts`) : suspendre, réactiver, résilier, changer
   d'offre (historique des tarifs), expiration idempotente.
6. **Site public** : statuts publics décidés par le serveur, aucun tarif pour un produit non
   commercialisé, demande de démonstration (anti-spam, conservation, aucune création
   d'abonnement), pages légales sans donnée inventée, sites vitrines clients inchangés.
7. **Autorisations** : nouvelles permissions, routes plateforme refusées aux clients.

## Résultats à la date de préparation

Voir le rapport de livraison du 12A (SPRINT_STATUS.md). Intégration sur PostgreSQL embarqué
(PGlite) uniquement ; Neon `test` refuse toujours l'authentification (A11). E2E écrits, non exécutés.

## Anomalies

| Anomalie                                                                       | Statut                          |
| ------------------------------------------------------------------------------ | ------------------------------- |
| A27, A28, A44 à A51                                                            | Corrigées au 12A — à revérifier |
| A52 — le statut d'abonnement ne conditionne aucun accès à l'application client | Ouverte, décision reportée      |
| A53 — adaptateur CinetPay réel non livré (API du compte marchand à confirmer)  | Ouverte                         |
| A54 — pages légales et coordonnées à compléter par Ocall avant publication     | Ouverte                         |
| A55 — aucun e-mail (demandes de démonstration, activations)                    | Acceptée pour la V1             |
| A11, A37, A42 et réserves antérieures                                          | Ouvertes (voir CP-10)           |
