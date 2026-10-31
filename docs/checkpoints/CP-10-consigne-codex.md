# Consigne d'audit indépendant — Checkpoint CP-10 (Ocall Park, Sprints 1 à 11)

Destinataire : auditeur indépendant (Codex). Ce document est la consigne à lui transmettre telle
quelle. Le dossier de préparation est [CP-10-preparation.md](CP-10-preparation.md) : il décrit ce
que l'équipe de développement affirme. **Ton rôle est de le vérifier, pas de le croire.**

## 1. Mission

Auditer le dépôt `park-management`, branche `claude/sprint-11`, commit `e1efd33`, et rendre une
décision **GO / GO SOUS RÉSERVES / NO-GO** sur deux questions distinctes :

1. Peut-on **préparer** le pilote (3 à 5 établissements à Bamako) sur cette base ?
2. Peut-on **démarrer** le pilote réel ?

Périmètre : Sprints 1 à 6 et 8 à 11 (le Sprint 7, paiement en ligne, est reporté). Les Sprints 5 à
11 n'ont jamais été audités indépendamment ; le dernier audit (CP-03) couvrait les Sprints 1 à 4.

## 2. Règles impératives

- **Lecture seule** sur le code : aucun commit, push, merge, ni modification de fichier suivi par
  Git, sauf ton rapport (§6).
- **Aucune base distante** : ne jamais se connecter à la base Neon de développement ni à aucune
  base de production ; ne jamais lancer `prisma migrate dev`, `migrate reset` ou `db push`.
  Tests base de données : uniquement une base PostgreSQL locale jetable (Docker `postgres:16` ou
  équivalent), ou Neon `test` si le commanditaire t'en fournit l'accès.
- **Aucun appel IA réel** et aucun fournisseur payant : `AI_PROVIDER=simulated` ou `none`.
- Ne jamais afficher ni recopier de secret (`apps/api/.env`, clés, URL de connexion).
- Ne pas modifier `docs/checkpoints/audit-*.md` ni `CHECKPOINT_*.md` existants.

## 3. Mise en route

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check
pnpm test
# Base locale jetable, puis :
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/ocall_audit"
$env:TEST_DIRECT_URL=$env:TEST_DATABASE_URL
pnpm --filter @ocall/database exec prisma migrate deploy   # sur la base jetable uniquement
pnpm --filter api test:integration
pnpm build; pnpm test:e2e                                    # si l'environnement le permet
```

Indique dans ton rapport ce que tu as réellement exécuté, sur quelle base, avec quels résultats.
Une vérification non exécutée doit être déclarée comme telle.

## 4. Axes d'audit

Pour chaque axe : lire le code, tenter de le mettre en défaut, et prouver chaque constat (fichier
et ligne, commande, ou test reproductible).

1. **Isolation multi-organisation** : toute lecture et écriture filtrée par l'organisation de la
   session (jamais par un identifiant fourni par le client) ; périmètre par établissement ;
   identifiants d'un autre client → 404. Accès direct par identifiant (IDOR) sur commandes,
   ventes, billets, fichiers, demandes de support, imports IA, factures.
2. **Authentification et autorisations** : sessions, verrouillage, réinitialisation du mot de passe,
   changement obligatoire, MFA TOTP des comptes internes (anti-rejeu, chiffrement, codes de
   secours), matrice des rôles client (`packages/shared/src/rbac.ts`) et des rôles internes
   (`packages/shared/src/platform.ts`), gardes globales (`apps/api/src/common/guards`). Chaque route
   doit être décorée ; un membre client ne doit atteindre aucune route plateforme.
3. **Argent** : POS, caisse, billetterie, restaurant, paiement saisi (aucun encaissement en ligne) :
   montants calculés par le serveur, arrondis, sessions de caisse, écarts, idempotence, double
   validation, verrous et transactions, concurrence.
4. **Facturation SaaS Ocall** : abonnements multi-produits, prix convenus figés, factures et lignes,
   numérotation, règlements manuels, validation et prolongation, MRR, encaissé ≠ facturé. Aucun
   paiement, prélèvement ou renouvellement automatique ; aucun prestataire de paiement.
5. **Transactions et pool de connexions** : requêtes hors transaction pendant une transaction
   ouverte (deux connexions), verrous `FOR UPDATE`, délais, comportement sous un pool réduit.
6. **Fichiers et stockage** : clés, traversée de chemin, liens signés (HMAC, durée, liaison au
   fichier et à l'organisation), en-têtes de téléchargement, quotas sous verrou, purge.
7. **IA** : aucun appel réel sans configuration explicite, quotas et plafonds sous verrou,
   copilote en lecture seule et sans donnée inventée, imports relus par un humain.
8. **Sites vitrines publics** : routage par hôte (`apps/web/src/middleware.ts`), aucune donnée
   interne publiée, domaines personnalisés, médias.
9. **Migrations** : additives, rejouables sur une base vide, garde anti-SQL destructif
   (`packages/database/src/migration-safety.ts`), reprise des données des migrations 11A.
10. **Exploitation** : journaux (masquage des secrets), sondes de santé, configuration de
    production (démarrage refusé si secret manquant), procédures de sauvegarde, restauration et
    retour arrière (`docs/PRODUCTION.md`).
11. **Tests** : les suites prouvent-elles ce qu'elles prétendent ? Repérer les tests jamais
    exécutables, les assertions vides ou conditionnelles, les zones non couvertes.
12. **Anomalies déclarées** (A1 à A51 dans les préparations CP-04 à CP-10) : confirmer, infirmer
    ou requalifier chacune ; en chercher d'autres.

## 5. Gravité

- **P0** : perte ou fuite de données entre organisations, erreur d'argent, contournement
  d'autorisation, secret exposé. Bloque toute décision GO.
- **P1** : défaut fonctionnel ou de sécurité important, sans contournement acceptable.
- **P2** : défaut à corriger avant la généralisation, contournable pendant le pilote.
- **P3** : amélioration, dette, documentation.

## 6. Livrable

Un seul fichier : `docs/checkpoints/audit-cp10.md`, en français, contenant :

1. Référentiel audité (commit) et environnement réellement utilisé.
2. Commandes exécutées et résultats exacts (y compris les échecs).
3. Constats numérotés `CP10-P<gravité>-<n>` : description, preuve (fichier:ligne, reproduction),
   impact, correction recommandée.
4. Statut de chaque anomalie A1 à A51 : confirmée, infirmée, requalifiée, avec justification.
5. Vérifications non réalisées et pourquoi.
6. **Décision** : une pour la préparation du pilote, une pour son démarrage (GO / GO SOUS RÉSERVES /
   NO-GO), avec les réserves numérotées et les conditions de levée.
