# Environnements, base de données et déploiement Railway

```
Navigateur ──HTTPS──▶ Railway « web » (Next.js) ──réseau privé──▶ Railway « api » (NestJS) ──TLS──▶ PostgreSQL
                         │  /api/v1/* est relayé vers l'API
                         └─ cookie de session httpOnly, first-party sur le domaine du frontend
```

> ⚠️ Aucun déploiement de production sans autorisation explicite. La base de production n'est **pas
> encore choisie** : aucune n'est configurée.

## 1. Séparation des environnements

| Environnement     | Base PostgreSQL                                     | Variables                              | Qui l'utilise                       |
| ----------------- | --------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| **Développement** | Base Neon existante (`neondb`)                      | `DATABASE_URL`, `DIRECT_URL`           | API lancée en local, essais manuels |
| **Test**          | Branche Neon `test` (à créer) — ou base éphémère CI | `TEST_DATABASE_URL`, `TEST_DIRECT_URL` | Tests d'intégration et E2E          |
| **Production**    | **À choisir avant le déploiement**                  | `DATABASE_URL`, `DIRECT_URL` (Railway) | Services Railway — non configurés   |

Règles :

- La base de **développement** est conservée telle quelle. On n'y exécute **jamais** de migration
  destructrice ni de nettoyage de tests. Une seule base de développement : pas de seconde branche Neon
  de développement.
- Les **tests automatisés** ne s'exécutent que sur la base de test. Ils créent puis suppriment leurs
  propres données (organisations suffixées par un identifiant d'exécution).
- La base de **production** sera définie uniquement dans les variables Railway, le moment venu. Ne pas
  réutiliser la base de développement pour un environnement public.

### Créer la branche Neon `test`

Console Neon → projet → **Branches** → **Create branch** → nom `test`, parent : la base de
développement. Une branche Neon est une copie copy-on-write : la base parente n'est ni modifiée ni
verrouillée. Ou en PowerShell, avec la CLI Neon :

```powershell
npx neonctl@latest auth
npx neonctl@latest branches create --name test
npx neonctl@latest connection-string test --pooled   # → TEST_DATABASE_URL
npx neonctl@latest connection-string test            # → TEST_DIRECT_URL
```

Reporter ces deux URL dans `apps/api/.env`, puis :

```powershell
pnpm db:migrate:deploy:test   # migrations en attente sur la branche test
pnpm test:integration
pnpm build; pnpm test:e2e
```

Si la branche `test` accumule des données, elle peut être réinitialisée depuis sa parente dans la
console Neon (_Reset from parent_) : seule la branche `test` est concernée.

### Garde-fou automatique

Les tests d'intégration, les tests E2E (configuration Playwright et nettoyage final) et
`db:migrate:deploy:test` passent par `resolveTestDatabase()` (`packages/database/src/test-database.ts`).
Ils **refusent de démarrer** si `TEST_DATABASE_URL` est absente ou désigne la base de développement
(avec ou sans `-pooler`). Playwright démarre toujours ses propres serveurs sur la base de test et ne
réutilise jamais un serveur de développement déjà lancé. La CI GitHub Actions utilise une base
PostgreSQL éphémère, détruite à la fin de chaque exécution.

## 2. Migrations Prisma

| Commande                      | Effet                                                                       | Base        |
| ----------------------------- | --------------------------------------------------------------------------- | ----------- |
| `pnpm db:check`               | Teste la connexion et liste les migrations appliquées                       | dév.        |
| `pnpm db:migrate:status`      | État des migrations                                                         | dév.        |
| `pnpm db:migrate:create -- x` | Génère une migration depuis `schema.prisma` — **lecture seule** sur la base | dév.        |
| `pnpm db:migrate:check`       | Refuse toute migration destructrice (aussi exécuté en CI)                   | aucune      |
| `pnpm db:migrate:deploy`      | Vérification, puis application des migrations **en attente**                | dév. / prod |
| `pnpm db:migrate:deploy:test` | Idem sur la base de test                                                    | test        |

Processus pour faire évoluer le schéma :

1. Modifier `packages/database/prisma/schema.prisma`.
2. `pnpm db:migrate:create -- ajout_billetterie` : le SQL est calculé en comparant la base de
   développement (lecture seule) au schéma, puis écrit dans `prisma/migrations/`.
3. Relire le SQL, puis `pnpm db:migrate:deploy` (développement) et `pnpm db:migrate:deploy:test`.

Pourquoi pas `prisma migrate dev` : en cas d'écart entre la base et l'historique, cette commande propose
de **réinitialiser la base** (perte de toutes les données). Elle n'est donc pas utilisée sur le projet.

Migrations destructrices : `db:migrate:check` bloque `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`,
`DROP SCHEMA`, `TRUNCATE`, `DELETE FROM` et les changements de type de colonne. Il s'exécute
automatiquement avant chaque `db:migrate:deploy` (donc avant chaque déploiement Railway) et en CI. Une
suppression réellement nécessaire se fait en plusieurs migrations additives (ajout → reprise des
données → suppression dans un sprint ultérieur) ; elle ne passe le contrôle qu'après validation
explicite, matérialisée par le commentaire `-- ocall:destructive-approved` dans le fichier SQL.

`DIRECT_URL` (connexion directe) sert aux migrations ; `DATABASE_URL` (connexion « pooled ») à l'API.

## 3. Variables d'environnement

### Poste local — `apps/api/.env` (jamais commité)

| Variable                                | Valeur                                            |
| --------------------------------------- | ------------------------------------------------- |
| `DATABASE_URL` / `DIRECT_URL`           | Base Neon de **développement** (pooled / directe) |
| `TEST_DATABASE_URL` / `TEST_DIRECT_URL` | Branche Neon **test** (pooled / directe)          |
| `NODE_ENV`                              | `development`                                     |
| `API_PORT`                              | `4000`                                            |
| `WEB_ORIGIN`                            | `http://localhost:3000`                           |
| `COOKIE_SECURE`                         | `false`                                           |
| `TRUST_PROXY_HOPS`                      | `1`                                               |

Frontend : `apps/web/.env.local` avec `API_URL=http://localhost:4000`.

### Service Railway `api`

| Variable                     | Obligatoire | Valeur                                                           |
| ---------------------------- | ----------- | ---------------------------------------------------------------- |
| `DATABASE_URL`               | oui         | Base de **production** pooled — _à définir_                      |
| `DIRECT_URL`                 | oui         | Base de **production** directe — _à définir_                     |
| `NODE_ENV`                   | oui         | `production`                                                     |
| `PORT`                       | oui         | `8080` (référencé par le service `web`)                          |
| `WEB_ORIGIN`                 | oui         | `https://<domaine-public-du-service-web>` (plusieurs : virgules) |
| `COOKIE_SECURE`              | oui         | `true` (l'API refuse de démarrer en production sinon)            |
| `TRUST_PROXY_HOPS`           | oui         | `2`, puis vérification (§4)                                      |
| `SESSION_TTL_HOURS`          | non         | `12`                                                             |
| `LOGIN_THROTTLE_LIMIT`       | non         | `10` tentatives par IP…                                          |
| `LOGIN_THROTTLE_TTL_SECONDS` | non         | …par fenêtre de `60` secondes                                    |
| `ACCOUNT_LOCK_THRESHOLD`     | non         | `5` échecs avant verrouillage du compte                          |
| `ACCOUNT_LOCK_MINUTES`       | non         | `15`                                                             |
| `PASSWORD_RESET_TTL_MINUTES` | non         | `30`                                                             |
| `SWAGGER_ENABLED`            | non         | absent (Swagger désactivé en production)                         |

Jamais de `TEST_DATABASE_URL` sur Railway. Saisir les URL de base comme variables **scellées**.

### Service Railway `web`

| Variable  | Obligatoire | Valeur                                                 |
| --------- | ----------- | ------------------------------------------------------ |
| `API_URL` | oui         | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` |

`API_URL` est lue **au build** (règles de proxy Next.js) **et à l'exécution** (rendu serveur) :
redéployer `web` après toute modification. Railway fournit `PORT` au service `web`.

## 4. `TRUST_PROXY_HOPS`

L'API limite les tentatives de connexion **par adresse IP** et enregistre l'IP dans le journal d'audit.
Derrière des proxys, l'IP vue par l'API est celle du dernier proxy ; la vraie IP du client figure dans
l'en-tête `X-Forwarded-For`, que chaque proxy complète. `TRUST_PROXY_HOPS` indique à Express combien de
proxys de confiance précèdent l'API, donc quelle entrée de `X-Forwarded-For` retenir.

| Environnement | Chaîne                                          | Valeur |
| ------------- | ----------------------------------------------- | ------ |
| Local         | navigateur → Next.js (proxy `/api/v1`) → API    | `1`    |
| Railway       | navigateur → edge Railway → Next.js `web` → API | `2`    |

- **Trop basse** : toutes les requêtes semblent venir du proxy ; un attaquant peut bloquer la connexion
  de tous les utilisateurs en épuisant la limite commune.
- **Trop haute** : l'API croit une entrée de `X-Forwarded-For` fournie par le client, qui peut usurper
  une IP et contourner la limite.

**Vérification au premier déploiement** : se connecter depuis un réseau dont l'IP publique est connue,
puis lire le champ `ipAddress` de l'entrée `auth.login` dans `AuditLog`. Il doit correspondre à l'IP
publique du poste ; sinon ajuster et redéployer. Le verrouillage de compte après échecs répétés
(indépendant de l'IP) reste actif dans tous les cas.

## 5. Préparer Railway (sans déployer en production)

1. Railway → New Project → Deploy from GitHub repo → `park-management`.
2. Créer **deux services** depuis ce dépôt : `api` et `web`. **Ne pas créer de base PostgreSQL sur
   Railway.**
3. Pour chaque service, _Settings_ :
   - **Root Directory** : vide (racine du monorepo, nécessaire au workspace pnpm) ;
   - **Railway config file** : `apps/api/railway.json` pour `api`, `apps/web/railway.json` pour `web`.
4. Renseigner les variables (§3). Tant que la base de production n'est pas choisie, laisser les
   déploiements désactivés ou les services sans domaine public.

Contenu des fichiers `railway.json` (validés contre `https://railway.com/railway.schema.json`) :

| Clé                | `api`                                            | `web`                                         |
| ------------------ | ------------------------------------------------ | --------------------------------------------- |
| `builder`          | `RAILPACK`                                       | `RAILPACK`                                    |
| `buildCommand`     | installation complète + build `@ocall/api...`    | installation complète + build `@ocall/web...` |
| `preDeployCommand` | `pnpm db:migrate:deploy` (contrôle + migrations) | —                                             |
| `startCommand`     | `pnpm --filter @ocall/api start`                 | `pnpm --filter @ocall/web start`              |
| `healthcheckPath`  | `/api/v1/health` (vérifie aussi la base)         | `/`                                           |
| `watchPatterns`    | `apps/api/**`, `packages/**`                     | `apps/web/**`, `packages/shared/**`           |

- Le build commence par `NODE_ENV=development pnpm install --frozen-lockfile` : avec `NODE_ENV=production`
  défini sur Railway, pnpm ignorerait sinon les dépendances de développement nécessaires au build
  (CLI Nest, TypeScript). Les outils de migration (`prisma`, `tsx`, `dotenv-cli`) sont des dépendances
  d'exécution du paquet `@ocall/database`, disponibles pour la pré-commande.
- Le suffixe `...` du filtre pnpm construit aussi les paquets internes dont dépend le service.
- Les scripts de base de données lisent `apps/api/.env` s'il existe, sinon les variables Railway.
- Si la pré-commande échoue (migration refusée ou en erreur), le nouveau déploiement n'est pas mis en
  service et la version précédente continue de tourner.

## 6. Premier déploiement (après choix de la base de production et autorisation)

1. Renseigner `DATABASE_URL` / `DIRECT_URL` de production sur le service `api`.
2. Déployer `api` (contrôle des migrations, migrations en attente, démarrage), puis `web`.
3. Vérifier `https://<web>/api/v1/health` → `{"status":"ok"}`.
4. Créer le premier Super Admin depuis un poste disposant des URL de la base de production :
   ```powershell
   pnpm db:bootstrap-super-admin -- --email admin@votre-domaine.com --first-name Prénom --last-name Nom
   ```

## 7. Vérifications avant ouverture

- [ ] `pnpm db:check` sur la base cible : connexion OK, migrations appliquées.
- [ ] Inscription, connexion, déconnexion depuis le domaine public.
- [ ] Cookie `ocp_session` : `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] `/api/docs` non exposé (sauf `SWAGGER_ENABLED=true` volontaire).
- [ ] `ipAddress` correct dans l'audit (§4).
- [ ] Aucun lien ni jeton de réinitialisation dans les journaux (affichés uniquement avec
      `NODE_ENV=development`).
- [ ] CI GitHub Actions verte sur le commit déployé.

## 8. Région et latence

La base de développement Neon est en `us-east-2`. Pour la production (utilisateurs en Afrique de
l'Ouest), une région européenne (Neon `eu-central-1`, Railway `europe-west4`) réduirait nettement la
latence. L'API et la base de production doivent être dans la même région.

## 9. Retour arrière

Railway → service → Deployments → _Redeploy_ d'un déploiement précédent. Les migrations étant
additives, un retour arrière du code ne nécessite pas de retour arrière de la base.
