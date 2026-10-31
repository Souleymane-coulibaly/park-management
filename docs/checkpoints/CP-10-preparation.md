# Checkpoint CP-10 — préparation (Sprints 1 à 11)

Ce document prépare l'audit indépendant Codex CP-10. Il ne constitue pas l'audit lui-même.
Consigne de l'auditeur : [CP-10-consigne-codex.md](CP-10-consigne-codex.md).

## Contexte de décision

- Dernier audit réalisé : **CP-03** (Sprints 1 à 4), GO SOUS RÉSERVES (A1, A2, A5 ouvertes).
- CP-04 à CP-09 **n'ont pas été réalisés** (préparations seulement). Les Sprints 5 à 10 ne sont donc
  pas validés par un audit indépendant.
- Sprint 11 découpé par le commanditaire en **11A** (Ocall Suite : produits, abonnements
  multi-produits, factures, rôles internes, MFA, tableau de bord commercial) puis **11B**
  (stockage privé et quotas, quotas IA, support, préparation production, pilote).
- **CP-10 doit couvrir les Sprints 1 à 6 et 8 à 11** (le Sprint 7, paiement CinetPay, est reporté).
- Décision du commanditaire (2026-10-31) : le Sprint 12A ne démarre qu'après présentation des
  résultats de CP-10 ; les anomalies ouvertes ne sont pas considérées comme résolues.

## Référentiel

- Branche `claude/sprint-11`, commit **`e1efd33`**, poussé sur `origin/claude/sprint-11`
  (2026-10-31). Contient le thème Aqua Premium (`6bcee39`).
- Migrations `20261031010000_ocall_suite_plateforme` et `20261031020000_ocall_suite_support_quotas`
  **appliquées sur la base de développement** le 2026-10-31, avec l'accord du commanditaire :
  52 → 59 tables (7 nouvelles, dont `SaasProduct` avec 4 lignes), aucun comptage existant modifié,
  3 offres et 3 abonnements rattachés à leur produit, `idle_in_transaction_session_timeout=60s`
  enregistré. Base `test` : aucune migration des Sprints 6 à 11 (A11).
- Région de production validée : Europe (A43 résolue). Base de production non créée.
- Aucune nouvelle dépendance au Sprint 11.

## Blocage Neon `test` (A11) — diagnostic du 2026-10-31

Diagnostic sans secret (script en lecture seule, `SELECT 1`) :

| Base                            | DNS | TCP 5432 | Authentification                                    |
| ------------------------------- | --- | -------- | --------------------------------------------------- |
| `test` (`ep-odd-rice-…-pooler`) | OK  | OK       | **refusée** : identifiants invalides pour ce rôle   |
| développement                   | OK  | OK       | OK (`SELECT 1` en 1,5 s depuis le poste, us-east-2) |

Cause : le mot de passe (ou le rôle) de `TEST_DATABASE_URL` dans `apps/api/.env` n'est plus valide
(mot de passe régénéré ou rôle supprimé côté Neon). Ce n'est ni un problème réseau ni un problème
de code. **Résolution** : le commanditaire copie depuis la console Neon (branche `test`, rôle
propriétaire) les URL _pooled_ et directe, les place dans `TEST_DATABASE_URL` / `TEST_DIRECT_URL`
(jamais dans Git), puis : `pnpm db:migrate:deploy:test` → `pnpm test:integration` →
`pnpm test:e2e`. En attendant, l'intégration tourne sur PostgreSQL embarqué (PGlite) : preuve
utile, mais pas sur Neon (A37).

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

## Résultats au 2026-10-31 (commit `e1efd33`)

| Contrôle                                               | Résultat                                           |
| ------------------------------------------------------ | -------------------------------------------------- |
| Unitaires                                              | shared 145/145, API 81/81, database 13/13          |
| Typecheck, lint, Prettier, build web, `migrate:check`  | OK                                                 |
| Intégration sur Neon `test`                            | **non exécutée** : authentification refusée (A11)  |
| Intégration sur PostgreSQL embarqué (PGlite, pool à 1) | voir tableau suivant — **10 suites vertes sur 12** |
| E2E navigateur                                         | **non exécuté** (exige une base de test autorisée) |
| Matériel (Android, imprimantes, scanners)              | **non vérifiable ici**                             |
| Test de restauration                                   | **non réalisé** (base de production non créée)     |

Intégration, une base embarquée neuve par suite, toutes les migrations, vrai client Prisma :

| Suite                           | Résultat  | Remarque                                           |
| ------------------------------- | --------- | -------------------------------------------------- |
| Sprint 1 — socle                | 33/33     |                                                    |
| Sprint 2 — POS                  | 26/26     | première exécution depuis le Sprint 11             |
| Sprint 3 — matériel             | 17/17     | idem                                               |
| Sprint 4 — billetterie          | 26/26     | idem                                               |
| Sprint 5 — restaurant           | **26/27** | **A50** : défaut réel (connexion hors transaction) |
| Sprint 6 — borne, CRM, planning | 15/15     | première exécution depuis le Sprint 11             |
| Sprint 8 — IA                   | 15/15     |                                                    |
| Sprint 9A — analyses            | **0/14**  | **A51** : test jamais exécutable                   |
| Sprint 9B — copilote, SaaS      | 7/7       |                                                    |
| Sprint 10 — sites vitrines      | 12/12     |                                                    |
| Sprint 11A — Ocall Suite        | 6/6       |                                                    |
| Sprint 11B — exploitation       | 8/8       |                                                    |

## Anomalies et limites

### Reportées

A1 à A36 : voir les préparations CP-04 à CP-09, en particulier A27 (validation d'un règlement sans
double contrôle) et A28 (abonnements échus jamais passés « expirés »). **A11 bloque toujours la
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

### Constatées pendant la préparation de CP-10 (2026-10-31, non corrigées)

Chaque anomalie a été vérifiée dans le code ; aucune n'est corrigée à ce stade.

| Anomalie                                                                                                                                                                                                                                          | Gravité               | Impact et suite                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A44 — MRR calculé sur le **prix catalogue** dans l'ancien tableau de bord (`platform.service.ts:55`) et les statistiques 9B (`saas.service.ts`, `theoreticalMonthlyRevenue`), alors que le tableau de bord commercial utilise le **prix convenu** | Moyenne (facturation) | Deux MRR différents selon l'écran ; harmoniser sur le prix convenu                                                   |
| A45 — un produit **retiré** reste facturable : `issueInvoice` ne refuse que « à venir » (`suite.service.ts:549`)                                                                                                                                  | Moyenne (facturation) | Règle unique « produit facturable / souscriptible » côté serveur                                                     |
| A46 — la validation d'un règlement avec prolongation ne vérifie ni le statut du produit ni celui de l'abonnement : elle peut réactiver un abonnement résilié (`saas.service.ts`, `validatePayment`)                                               | Moyenne (facturation) | Refuser ou exiger une action explicite ; tester                                                                      |
| A47 — changer le métier d'une organisation remet à zéro les prix convenus (`organizations.service.ts:95-104`) ; l'ancien tarif ne survit qu'en texte dans l'évènement                                                                             | Moyenne (facturation) | Historique des tarifs appliqués (table dédiée)                                                                       |
| A48 — un règlement sans facture n'est rattachable qu'à l'abonnement Ocall Park (`saas.service.ts:197-208`)                                                                                                                                        | Basse                 | Produits hors Parc : passer par une facture ; à documenter ou généraliser                                            |
| A49 — aucune action d'administration pour suspendre, résilier ou changer d'offre un abonnement (aggrave A28)                                                                                                                                      | Moyenne               | Actions journalisées, permissions dédiées                                                                            |
| A50 — **modification d'une commande restaurant** : la table est recherchée hors de la transaction ouverte (`orders.service.ts:172` → `dining.service.ts:240` via `this.prisma`) ; deux connexions par requête, blocage avec un pool à 1 connexion | Haute (avant pilote)  | Même famille que la commande vocale corrigée au 11B ; risque d'épuisement du pool en pointe ; passer `tx`            |
| A51 — la suite d'intégration **Sprint 9A n'a jamais pu passer** : elle ouvre deux sessions de caisse avec le même propriétaire, refusé par la règle « une session ouverte par employé » (en place depuis `eed1c11`, Sprint 2)                     | Haute (preuve)        | Les analyses 9A (CA, marges, heures, exports) n'ont **aucune preuve d'intégration** ; corriger le test, puis rejouer |

Constat de méthode : A50 et A51 n'apparaissaient qu'en exécutant réellement les suites ; les
« suites écrites mais non exécutées » des sprints précédents ne valent pas preuve.

## Proposition de décision

**GO SOUS RÉSERVES pour la préparation du pilote ; NO-GO pour le démarrage du pilote réel** tant que :

1. les suites d'intégration et E2E des Sprints 1 à 11 n'ont pas tourné sur Neon `test` (A11, A37) ;
2. A50 n'est pas corrigée et la suite 9A n'est pas rendue exécutable et verte (A51) ;
3. les anomalies de facturation A44 à A47 ne sont pas corrigées ou acceptées par écrit ;
4. la base de production n'est pas créée en Europe (région validée le 2026-10-31, A43) ;
5. la supervision et le test de restauration ne sont pas faits (A42) ;
6. la recette matérielle n'est pas faite sur le premier site (anomalies historiques 5 à 7).

Décision finale : commanditaire, après l'audit Codex CP-10.
