# Checkpoint CP-10 — préparation (Sprints 1 à 11)

Ce document prépare l'audit indépendant Codex CP-10. Il ne constitue pas l'audit lui-même.

## Contexte de décision

- Dernier audit réalisé : **CP-03** (Sprints 1 à 4), GO SOUS RÉSERVES (A1, A2, A5 ouvertes).
- CP-04 à CP-09 **n'ont pas été réalisés** (préparations seulement). Les Sprints 5 à 10 ne sont donc
  pas validés par un audit indépendant.
- Sprint 11 découpé par le commanditaire en **11A** (Ocall Suite : produits, abonnements
  multi-produits, factures, rôles internes, MFA, tableau de bord commercial) puis **11B**
  (stockage privé et quotas, quotas IA, support, préparation production, pilote).
- **CP-10 doit couvrir les Sprints 1 à 6 et 8 à 11** (le Sprint 7, paiement CinetPay, est reporté).

## Référentiel

- Branche `claude/sprint-11`, depuis `6bcee39` (thème Aqua Premium, poussé). Sprint 11 **ni commité
  ni poussé** à la date de ce document.
- Migrations **non appliquées** (ni développement, ni `test`) : `20261031010000_ocall_suite_plateforme`
  (assouplit deux contraintes d'unicité, reprend les abonnements vers leur produit) et
  `20261031020000_ocall_suite_support_quotas` (additive ; pose `idle_in_transaction_session_timeout`).
- Aucune nouvelle dépendance au Sprint 11.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check
pnpm test
pnpm db:migrate:deploy:test
pnpm test:integration            # IA, domaines simulés ; stockage local temporaire
pnpm build; pnpm test:e2e
```

## Points à vérifier — Sprint 11A

1. **Rôles internes** (`packages/shared/src/platform.ts`, `permissions.guard.ts`) : matrice unique,
   contrôle par route (`@RequirePlatformPermission`), un membre d'organisation refusé sur toute
   route plateforme, propriétaire jamais attribuable, aucune auto-gestion.
2. **MFA** (`totp.ts`, `mfa.service.ts`, `auth.guard.ts`) : RFC 6238, anti-rejeu, secret chiffré
   AES-256-GCM, codes de secours hachés à usage unique, aucune route métier avant validation,
   procédure serveur de réinitialisation du propriétaire.
3. **Multi-produits** : un abonnement par produit, un seul de la famille Ocall Park, Ocall School non
   souscriptible, migration de reprise.
4. **Factures et règlements** : montants calculés par le serveur au tarif accepté (figé),
   idempotence, numérotation atomique, montant exact, double validation refusée, annulation
   impossible après règlement, **aucun prestataire de paiement**.
5. **Tableau de bord** : encaissé (validé) ≠ facturé ≠ MRR théorique.

## Points à vérifier — Sprint 11B

1. **Fichiers privés** (`common/storage/*`) : clés générées et validées (aucune traversée),
   isolation par organisation et établissement, jamais servis sans lien signé, lien HMAC court
   (5 min) lié au fichier et à l'organisation, fichier supprimé = refusé, téléchargement journalisé,
   en-têtes `no-store`, `nosniff`, pièce jointe, CSP `sandbox`.
2. **Quotas de stockage** : vérifiés sous verrou de l'organisation (médias des sites et pièces
   jointes), objet supprimé en cas de refus, contrôle préalable avant d'enregistrer un message.
3. **Quotas IA** : plafond Ocall (offre puis dérogation) appliqué dans la réservation sous verrou ;
   l'organisation ne peut que le restreindre.
4. **Support** : isolation entre organisations (404), propriétaire / administrateur voient toute
   l'organisation, superviseur ses demandes, caissier aucune ; notes internes jamais renvoyées au
   client ; pièces jointes vérifiées par signature.
5. **Exploitation** : paramètres sans secret, journaux JSON avec masquage, sonde `/health/ready`
   bornée, purge de conservation idempotente.
6. **Correctifs** : consigne de simulation exclue des données autorisées du copilote, lecture du
   délai de conservation hors transaction (commande vocale), formulaire des réglages IA.

## Résultats à la date de préparation

| Contrôle                                                                                         | Résultat                                                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Unitaires                                                                                        | shared 145/145, API 81/81                                                                          |
| Typecheck, lint, Prettier, build, `migrate:check`                                                | OK (voir SPRINT_STATUS.md pour la dernière exécution)                                              |
| Intégration sur PostgreSQL **local jetable** (PGlite, toutes les migrations, vrai client Prisma) | 11A 6/6, 11B 8/8, Sprint 10 12/12, Sprint 9B 7/7, Sprint 8 15/15, Sprint 1 : voir SPRINT_STATUS.md |
| Intégration sur Neon `test`                                                                      | **non exécutée** (A11)                                                                             |
| Régression des Sprints 2 à 6 et 9A                                                               | **non exécutée** dans ce sprint                                                                    |
| E2E navigateur                                                                                   | **non exécuté**                                                                                    |
| Matériel (Android, imprimantes, scanners)                                                        | **non vérifiable ici**                                                                             |
| Test de restauration                                                                             | **non réalisé** (base de production non créée)                                                     |

## Anomalies et limites

### Reportées

A1 à A36 : voir les préparations CP-04 à CP-09. **A11 (base `test` inaccessible) bloque toujours la
preuve sur Neon.** Anomalies historiques réexaminées : [ANOMALIES-HISTORIQUES.md](../ANOMALIES-HISTORIQUES.md).

### Nouvelles au Sprint 11

| Anomalie                                                                         | Gravité              | Impact et suite                                                               |
| -------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| A37 — intégration seulement sur PostgreSQL embarqué (PGlite), pool à 1 connexion | Haute (avant pilote) | Comportement Neon (latence, pool, `idle_in_transaction`) à prouver sur `test` |
| A38 — fermeture effective des transactions inactives non observée                | Moyenne              | Paramètre enregistré (prouvé) ; terminaison à observer sur Neon               |
| A39 — aucun e-mail (support, échéances)                                          | Moyenne              | Suivi dans l'application, relances manuelles (WhatsApp)                       |
| A40 — interfaces 11A / 11B non vérifiées en navigateur                           | Moyenne              | Build et types OK ; E2E à écrire et exécuter                                  |
| A41 — clé de signature aléatoire hors production                                 | Basse                | Liens invalidés au redémarrage en développement ; obligatoire en production   |
| A42 — supervision et sauvegarde logique non branchées                            | Haute (avant pilote) | Procédures écrites ([PRODUCTION.md](../PRODUCTION.md)), à activer avec accord |
| A43 — région de production                                                       | Résolue (2026-10-31) | Europe validée ; base de production à créer avec accord                       |

## Proposition de décision

**GO SOUS RÉSERVES pour la préparation du pilote ; NO-GO pour le démarrage du pilote réel** tant que :

1. les suites d'intégration et E2E des Sprints 1 à 11 n'ont pas tourné sur Neon `test` (A11, A37) ;
2. la base de production n'est pas créée en Europe (région validée le 2026-10-31, A43) ;
3. la supervision et le test de restauration ne sont pas faits (A42) ;
4. la recette matérielle n'est pas faite sur le premier site (anomalies historiques 5 à 7).

Décision finale : commanditaire, après l'audit Codex CP-10.
