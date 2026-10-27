# Déploiement sur Railway (frontend + API) avec Neon

```
Navigateur ──HTTPS──▶ Railway « web » (Next.js) ──réseau privé──▶ Railway « api » (NestJS) ──TLS──▶ Neon (PostgreSQL)
                         │  /api/v1/* est relayé vers l'API
                         └─ cookie de session httpOnly, first-party sur le domaine du frontend
```

- **Aucune base PostgreSQL n'est créée sur Railway** : la base reste sur Neon (branche principale).
- L'API n'a pas besoin de domaine public : le frontend l'appelle via le réseau privé Railway.
- Les migrations sont **non destructives** : seul `prisma migrate deploy` est exécuté.
- Les tests automatisés n'utilisent **jamais** la branche principale Neon (voir §2).

> ⚠️ Aucun déploiement de production sans validation explicite.

## 1. Branches Neon

| Branche Neon        | Usage                                      | Variables                              |
| ------------------- | ------------------------------------------ | -------------------------------------- |
| principale (`main`) | Données réelles — API déployée sur Railway | `DATABASE_URL`, `DIRECT_URL`           |
| `development`       | Tests d'intégration et E2E, essais locaux  | `TEST_DATABASE_URL`, `TEST_DIRECT_URL` |

### Créer la branche `development` (sans toucher à la branche principale)

Dans la console Neon : projet → **Branches** → **Create branch** → nom `development`, parent : la branche
principale, option _Current data_. La création d'une branche est une copie copy-on-write : la branche
principale n'est ni modifiée ni verrouillée.

Ou en ligne de commande (PowerShell), avec la CLI Neon authentifiée :

```powershell
npx neonctl@latest auth
npx neonctl@latest branches create --name development
npx neonctl@latest connection-string development --pooled   # → TEST_DATABASE_URL
npx neonctl@latest connection-string development             # → TEST_DIRECT_URL
```

Reportez ces deux URL dans `apps/api/.env` (`TEST_DATABASE_URL`, `TEST_DIRECT_URL`), puis :

```powershell
pnpm db:migrate:deploy:test   # applique les migrations en attente sur la branche development
pnpm test:integration
pnpm build; pnpm test:e2e
```

### Garde-fou

Les tests d'intégration, les tests E2E et `db:migrate:deploy:test` passent par
`resolveTestDatabase()` (`packages/database/src/test-database.ts`) : ils **refusent de démarrer** si
`TEST_DATABASE_URL` est absente ou désigne la même base que `DATABASE_URL` (avec ou sans `-pooler`).
Playwright démarre toujours ses propres serveurs sur la base de test et ne réutilise jamais un serveur
déjà lancé. La CI GitHub Actions utilise une base PostgreSQL éphémère.

## 2. Migrations Prisma

| Commande                      | Effet                                                                  | Où                      |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| `pnpm db:check`               | Teste la connexion (`DATABASE_URL`) et liste les migrations            | poste local             |
| `pnpm db:migrate:status`      | État des migrations                                                    | poste local             |
| `pnpm db:migrate:deploy`      | Applique les migrations **en attente** (`DIRECT_URL`) — non destructif | pré-déploiement Railway |
| `pnpm db:migrate:deploy:test` | Idem sur la base de test                                               | poste local             |
| `pnpm db:migrate:dev`         | Crée une nouvelle migration — **base de développement uniquement**     | poste local             |

Règles :

- Sur Railway, la commande de pré-déploiement du service `api` est `pnpm db:migrate:deploy`. Si elle
  échoue, le nouveau déploiement n'est pas mis en service et l'ancien continue de tourner.
- Jamais de `prisma migrate reset`, `prisma db push` ni de suppression automatisée sur la branche
  principale.
- Une évolution qui supprime ou renomme une colonne se fait en plusieurs migrations compatibles
  (ajout → reprise des données → suppression dans un sprint ultérieur), afin qu'un retour arrière du
  code reste possible sans retour arrière de la base.
- Les migrations utilisent `DIRECT_URL` (connexion directe, sans pooler) ; l'API utilise
  `DATABASE_URL` (connexion « pooled »).

## 3. Variables d'environnement

### Service Railway `api`

| Variable                     | Obligatoire | Valeur recommandée                                               |
| ---------------------------- | ----------- | ---------------------------------------------------------------- |
| `DATABASE_URL`               | oui         | URL Neon principale **pooled** (`-pooler`), `sslmode=require`    |
| `DIRECT_URL`                 | oui         | URL Neon principale **directe** (migrations)                     |
| `NODE_ENV`                   | oui         | `production`                                                     |
| `PORT`                       | oui         | `8080` (fixé pour être référencé par le service `web`)           |
| `WEB_ORIGIN`                 | oui         | `https://<domaine-public-du-service-web>` (plusieurs : virgules) |
| `COOKIE_SECURE`              | oui         | `true` (l'API refuse de démarrer en production sinon)            |
| `TRUST_PROXY_HOPS`           | oui         | `2` puis vérification, voir §4                                   |
| `SESSION_TTL_HOURS`          | non         | `12`                                                             |
| `LOGIN_THROTTLE_LIMIT`       | non         | `10` tentatives par IP…                                          |
| `LOGIN_THROTTLE_TTL_SECONDS` | non         | …par fenêtre de `60` secondes                                    |
| `ACCOUNT_LOCK_THRESHOLD`     | non         | `5` échecs avant verrouillage du compte                          |
| `ACCOUNT_LOCK_MINUTES`       | non         | `15`                                                             |
| `PASSWORD_RESET_TTL_MINUTES` | non         | `30`                                                             |
| `SWAGGER_ENABLED`            | non         | absent (Swagger désactivé en production)                         |

Ne jamais définir `TEST_DATABASE_URL` / `TEST_DIRECT_URL` sur Railway. Saisir les URL Neon comme
variables **scellées** (sealed) : elles n'apparaissent plus dans l'interface ni dans GitHub.

### Service Railway `web`

| Variable  | Obligatoire | Valeur                                                 |
| --------- | ----------- | ------------------------------------------------------ |
| `API_URL` | oui         | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` |

`API_URL` est lue **au build** (règles de proxy Next.js) **et à l'exécution** (rendu serveur) :
redéployez `web` après toute modification. Railway fournit `PORT` au service `web` automatiquement.

### Poste local (`apps/api/.env`, jamais commité)

Mêmes variables que le service `api` avec `NODE_ENV=development`, `API_PORT=4000`,
`WEB_ORIGIN=http://localhost:3000`, `COOKIE_SECURE=false`, `TRUST_PROXY_HOPS=1`, plus
`TEST_DATABASE_URL` / `TEST_DIRECT_URL` (branche `development`). Frontend : `apps/web/.env.local`
avec `API_URL=http://localhost:4000`.

## 4. `TRUST_PROXY_HOPS`

L'API limite les tentatives de connexion **par adresse IP** et enregistre l'IP dans le journal d'audit.
Derrière des proxys, l'IP vue par l'API est celle du dernier proxy ; la vraie IP du client figure dans
l'en-tête `X-Forwarded-For`, que chaque proxy complète. `TRUST_PROXY_HOPS` indique à Express combien
de proxys de confiance se trouvent devant l'API, donc quelle entrée de `X-Forwarded-For` retenir.

| Environnement | Chaîne                                          | Valeur |
| ------------- | ----------------------------------------------- | ------ |
| Local         | navigateur → Next.js (proxy `/api/v1`) → API    | `1`    |
| Railway       | navigateur → edge Railway → Next.js `web` → API | `2`    |

- Valeur **trop basse** : toutes les requêtes semblent venir du proxy ; un attaquant peut bloquer la
  connexion de tous les utilisateurs en épuisant la limite commune.
- Valeur **trop haute** : l'API fait confiance à une entrée de `X-Forwarded-For` fournie par le client,
  qui peut alors usurper une IP et contourner la limite.

**Vérification après le premier déploiement** : se connecter depuis un réseau dont l'IP publique est
connue, puis consulter le champ `ipAddress` de l'entrée `auth.login` dans la table `AuditLog`. Il doit
correspondre à l'IP publique du poste ; sinon ajuster la valeur et redéployer. Le verrouillage de
compte après échecs répétés (indépendant de l'IP) reste actif dans tous les cas.

## 5. Créer le projet Railway

1. Railway → New Project → Deploy from GitHub repo → `park-management`.
2. Créer **deux services** depuis ce dépôt : `api` et `web`.
3. Pour chaque service, _Settings_ :
   - **Root Directory** : vide (racine du monorepo, nécessaire au workspace pnpm) ;
   - **Railway config file** : `apps/api/railway.json` pour `api`, `apps/web/railway.json` pour `web` ;
   - **Branche** : `claude/sprint-1` pour un environnement de pré-production — pas de production avant
     validation.
4. Renseigner les variables (§3), générer un domaine public pour `web` et le reporter dans
   `WEB_ORIGIN` de `api`.

Contenu des fichiers `railway.json` (validés contre `https://railway.com/railway.schema.json`) :

| Clé                | `api`                                   | `web`                                   |
| ------------------ | --------------------------------------- | --------------------------------------- |
| `builder`          | `RAILPACK`                              | `RAILPACK`                              |
| `buildCommand`     | `pnpm --filter @ocall/api... run build` | `pnpm --filter @ocall/web... run build` |
| `preDeployCommand` | `pnpm db:migrate:deploy`                | —                                       |
| `startCommand`     | `pnpm --filter @ocall/api start`        | `pnpm --filter @ocall/web start`        |
| `healthcheckPath`  | `/api/v1/health` (vérifie aussi Neon)   | `/`                                     |
| `watchPatterns`    | `apps/api/**`, `packages/**`            | `apps/web/**`, `packages/shared/**`     |

Le suffixe `...` du filtre pnpm construit aussi les paquets internes dont dépend le service. Les scripts
de base de données lisent `apps/api/.env` s'il existe et utilisent sinon les variables Railway.

## 6. Premier déploiement (pré-production)

1. Déployer `api` : la pré-commande applique les migrations en attente, puis l'API démarre.
2. Déployer `web`, puis vérifier `https://<web>/api/v1/health` → `{"status":"ok"}`.
3. Créer le premier Super Admin depuis le poste local (avec les URL de la base cible dans
   `apps/api/.env`) :
   ```powershell
   pnpm db:bootstrap-super-admin -- --email admin@votre-domaine.com --first-name Prénom --last-name Nom
   ```
   Le mot de passe temporaire s'affiche une seule fois et doit être changé à la première connexion.

## 7. Vérifications avant ouverture

- [ ] `pnpm db:check` sur la base cible : connexion OK, migrations appliquées.
- [ ] Inscription, connexion, déconnexion depuis le domaine public.
- [ ] Cookie `ocp_session` : `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] `/api/docs` non exposé (sauf `SWAGGER_ENABLED=true` volontaire).
- [ ] `ipAddress` correct dans l'audit (§4).
- [ ] Aucun lien ni jeton de réinitialisation dans les journaux Railway (ils ne sont affichés qu'avec
      `NODE_ENV=development`).
- [ ] CI GitHub Actions verte sur le commit déployé.

## 8. Région et latence

La base Neon actuelle est en `us-east-2`. Pour des utilisateurs en Afrique de l'Ouest, une région
européenne (Neon `eu-central-1`, Railway `europe-west4`) réduirait nettement la latence : l'inscription
enchaîne une dizaine de requêtes dans une transaction. L'API et la base doivent être dans la même région.

## 9. Retour arrière

Railway → service → Deployments → _Redeploy_ d'un déploiement précédent. Les migrations étant
additives, un retour arrière du code ne nécessite pas de retour arrière de la base.
