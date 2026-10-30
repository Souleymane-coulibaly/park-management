# Ocall Park

Logiciel SaaS B2B de gestion pour les établissements africains : **parcs aquatiques et espaces de
loisirs**, **restaurants**, ou **les deux**. Lancement au Mali, en français, prix en FCFA (XOF).

> Statut : **Sprint 8 (en cours)** — socle SaaS (Sprint 1), caisse POS restaurant (Sprint 2), POS Android avec
> impression thermique ESC/POS et tiroir-caisse (Sprint 3, validation sur matériel réel à faire),
> billetterie du parc avec QR codes et contrôle d'accès (Sprint 4,
> [docs/BILLETTERIE-PARC.md](docs/BILLETTERIE-PARC.md)), restaurant : commandes, cuisine KDS en
> temps réel, commandes QR, tables, stocks, réservations et tickets cuisine (Sprint 5,
> [docs/RESTAURANT.md](docs/RESTAURANT.md)), bornes de commande, CRM, fidélité et planning du personnel
> (Sprint 6, [docs/BORNES-CRM-FIDELITE-PLANNING.md](docs/BORNES-CRM-FIDELITE-PLANNING.md)), intelligence
> artificielle : import de carte, copilote analytique, commande vocale (Sprint 8,
> [docs/INTELLIGENCE-ARTIFICIELLE.md](docs/INTELLIGENCE-ARTIFICIELLE.md)), analyses, marges et exports CSV
> (Sprint 9, [docs/ANALYSES.md](docs/ANALYSES.md)), sites vitrines publics et domaines (Sprint 10,
> [docs/SITES-VITRINES.md](docs/SITES-VITRINES.md)).
> Suivi détaillé : [SPRINT_STATUS.md](SPRINT_STATUS.md).

## Architecture

```
apps/
  api/        API REST NestJS (/api/v1, Swagger sur /api/docs)
  web/        Frontend Next.js App Router + Tailwind CSS
  android/    Connecteur Android (WebView + pont matériel imprimante / tiroir), Kotlin
packages/
  shared/     Contrats partagés : métiers, rôles, matrice RBAC, modules, navigation
  database/   Schéma Prisma, migrations, scripts (db:check, super admin)
e2e/          Tests Playwright
docs/         Documentation (déploiement Railway, caisse POS, matériel, billetterie, checkpoints)
scripts/      Outils de dépôt (journaux complets des tests dans test-logs/)
```

| Couche          | Technologie                          | Hébergement cible |
| --------------- | ------------------------------------ | ----------------- |
| Frontend        | Next.js 15, React 19, Tailwind CSS 3 | Railway (`web`)   |
| API             | NestJS 11, class-validator, Swagger  | Railway (`api`)   |
| Base de données | PostgreSQL + Prisma 6                | Neon              |
| CI              | GitHub Actions                       | GitHub            |

### Choix structurants

- **Multi-tenant strict** : chaque ressource porte un `organizationId`. L'organisation active vient
  **uniquement** de la session côté serveur ; tout champ `organizationId` envoyé par le client est
  refusé (400). Une ressource d'une autre organisation renvoie 404.
- **Session opaque** en cookie `httpOnly` / `SameSite=Lax` (seul son hash SHA-256 est stocké), révocable
  immédiatement (déconnexion, désactivation, suspension, changement de mot de passe).
- **Proxy same-origin** : le navigateur appelle `/api/v1/*` sur le domaine du frontend, que Next.js
  relaie vers l'API. Le cookie reste first-party, l'API n'est pas exposée en cross-site.
- **RBAC** : matrice unique dans `packages/shared/src/rbac.ts`, appliquée par l'API (gardes globales) et
  reflétée par l'interface. Le `SUPER_ADMIN` est un rôle plateforme sans accès aux données métier.
- **Métier vérifié côté serveur** : navigation et accès aux modules calculés par l'API selon
  `PARK | RESTAURANT | PARK_RESTAURANT`. Seule évolution permise : vers `PARK_RESTAURANT`, sans perte.
- **Prix des offres en base** (`SubscriptionPlan`), modifiables par le Super Admin, historisés dans
  l'audit. Paiement Wave : interface `PaymentProvider` seulement — un abonnement ne sera jamais activé
  sur la foi du frontend.
- **Sécurité** : Argon2id, verrouillage de compte après échecs, limitation par IP des routes sensibles,
  contrôle d'origine (CSRF), Helmet, journal d'audit en ajout seul.

## Prérequis (Windows)

- Node.js ≥ 20.11 (testé avec Node 24), pnpm 10 (`corepack enable` ou `npm i -g pnpm@10.17.0`)
- Une base PostgreSQL Neon (une **branche de développement** est recommandée)

## Installation (PowerShell)

```powershell
git clone https://github.com/Souleymane-coulibaly/park-management.git
cd park-management
pnpm install

# Variables d'environnement (jamais commitées)
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
# Éditez apps/api/.env : DATABASE_URL / DIRECT_URL (base Neon de développement)
# et TEST_DATABASE_URL / TEST_DIRECT_URL (branche Neon « test »)
```

## Environnements

| Environnement | Base                                   | Variables                              |
| ------------- | -------------------------------------- | -------------------------------------- |
| Développement | Base Neon existante                    | `DATABASE_URL`, `DIRECT_URL`           |
| Test          | Branche Neon `test` / base éphémère CI | `TEST_DATABASE_URL`, `TEST_DIRECT_URL` |
| Production    | À choisir avant le déploiement         | Variables Railway (non configurées)    |

Jamais de migration destructrice ni de nettoyage de tests sur la base de développement. Détails :
[docs/DEPLOIEMENT-RAILWAY.md](docs/DEPLOIEMENT-RAILWAY.md).

## Base de données

```powershell
pnpm db:check                          # connexion et migrations appliquées (développement)
pnpm db:migrate:status                 # état des migrations
pnpm db:migrate:create -- nom_evolution  # génère une migration (lecture seule sur la base)
pnpm db:migrate:check                  # refuse les migrations destructrices
pnpm db:migrate:deploy                 # contrôle puis applique les migrations en attente
pnpm db:bootstrap-super-admin -- --email admin@exemple.com --first-name Awa --last-name Traoré
```

La migration initiale crée aussi les trois offres : Parc 25 000, Restaurant 35 000,
Parc + Restaurant 55 000 FCFA/mois. `prisma migrate dev` n'est pas utilisé : il peut proposer de
réinitialiser la base.

## Lancer en local

```powershell
pnpm build:packages   # compile packages/shared et packages/database
pnpm dev              # API sur http://localhost:4000, web sur http://localhost:3000
```

- Application : http://localhost:3000
- Swagger : http://localhost:4000/api/docs
- En développement, le lien de réinitialisation de mot de passe est écrit dans la console de l'API
  (aucun fournisseur e-mail n'est branché au Sprint 1).

## Qualité et tests

```powershell
pnpm lint               # ESLint
pnpm format:check       # Prettier
pnpm typecheck          # TypeScript strict sur tous les paquets
pnpm test               # tests unitaires (Jest)
pnpm db:migrate:deploy:test   # migrations sur la base de test
pnpm test:integration   # tests d'intégration API — base de TEST uniquement
pnpm build; pnpm test:e2e   # tests Playwright (démarre l'API et le web construits, base de TEST)
```

⚠️ Les tests d'intégration et E2E **créent puis suppriment** des données. Ils s'exécutent uniquement
sur la base désignée par `TEST_DATABASE_URL` / `TEST_DIRECT_URL` (branche Neon `test`) et
**refusent de démarrer** si elle est absente ou identique à `DATABASE_URL`. Création de la branche :
voir [docs/DEPLOIEMENT-RAILWAY.md](docs/DEPLOIEMENT-RAILWAY.md#1-branches-neon). La CI GitHub Actions
utilise sa propre base PostgreSQL éphémère.

## Déploiement

Voir [docs/DEPLOIEMENT-RAILWAY.md](docs/DEPLOIEMENT-RAILWAY.md). Aucun déploiement de production sans
validation.
