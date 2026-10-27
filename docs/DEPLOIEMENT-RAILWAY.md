# Déploiement sur Railway (frontend + API) avec Neon

Architecture :

```
Navigateur ──HTTPS──▶ Railway « web » (Next.js) ──réseau privé──▶ Railway « api » (NestJS) ──TLS──▶ Neon (PostgreSQL)
                         │  /api/v1/* est relayé vers l'API
                         └─ cookie de session httpOnly, first-party sur le domaine du frontend
```

- **Aucune base PostgreSQL n'est créée sur Railway** : la base reste sur Neon.
- L'API n'a pas besoin de domaine public : le frontend l'appelle via le réseau privé Railway.
- Les migrations sont **non destructives** : seul `prisma migrate deploy` est exécuté (application des
  migrations en attente). Aucune commande `migrate reset`, `db push` ou suppression n'est automatisée.

> ⚠️ Ne déployez pas en production sans validation. Commencez par un environnement Railway de
> pré-production relié à une **branche Neon de pré-production**, jamais à la base de production.

## 1. Créer le projet Railway

1. Railway → New Project → Deploy from GitHub repo → `park-management`.
2. Créer **deux services** depuis ce même dépôt, nommés `api` et `web`.
3. Pour chaque service, dans _Settings_ :
   - **Root Directory** : laisser vide (racine du monorepo, nécessaire au workspace pnpm).
   - **Config-as-code / Railway config file** :
     - service `api` → `apps/api/railway.json`
     - service `web` → `apps/web/railway.json`
   - **Branche** : celle validée (pas `main` tant que le Sprint 1 n'est pas validé).

Les fichiers `railway.json` définissent la construction (Railpack + pnpm), la commande de démarrage, la
commande de pré-déploiement (migrations) et la sonde de santé.

## 2. Variables du service `api`

| Variable                     | Valeur                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`               | URL Neon **pooled** (hôte `-pooler`), `sslmode=require`       |
| `DIRECT_URL`                 | URL Neon **directe** (hôte sans `-pooler`), pour Prisma       |
| `NODE_ENV`                   | `production`                                                  |
| `PORT`                       | `8080` (fixé pour être référencé par le frontend)             |
| `WEB_ORIGIN`                 | `https://<domaine-public-du-service-web>`                     |
| `COOKIE_SECURE`              | `true`                                                        |
| `TRUST_PROXY_HOPS`           | `2` (proxy Railway + proxy Next.js) — **à vérifier**, voir §6 |
| `SESSION_TTL_HOURS`          | `12`                                                          |
| `LOGIN_THROTTLE_LIMIT`       | `10`                                                          |
| `ACCOUNT_LOCK_THRESHOLD`     | `5`                                                           |
| `PASSWORD_RESET_TTL_MINUTES` | `30`                                                          |

Les identifiants Neon se saisissent uniquement dans Railway (jamais dans GitHub). Utilisez des
_variables scellées_ (« sealed ») pour `DATABASE_URL` et `DIRECT_URL`.

## 3. Variables du service `web`

| Variable  | Valeur                                                 |
| --------- | ------------------------------------------------------ |
| `API_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` |

`API_URL` est lue **au build** (règles de proxy Next.js) **et à l'exécution** (rendu serveur). Après
toute modification, redéployez le service `web`.

Générez ensuite un domaine public pour `web` (Settings → Networking → Generate Domain) et reportez-le
dans `WEB_ORIGIN` du service `api`.

## 4. Premier déploiement

1. Déployer `api` : la commande de pré-déploiement `pnpm db:migrate:deploy` applique les migrations en
   attente sur Neon, puis l'API démarre. Vérifier `https://…/api/v1/health` → `{"status":"ok"}` (via le
   domaine web : `https://<web>/api/v1/health`).
2. Déployer `web`.
3. Créer le premier Super Admin depuis votre poste (PowerShell), avec les variables de la base cible
   dans `apps/api/.env` :
   ```powershell
   pnpm db:bootstrap-super-admin -- --email admin@votre-domaine.com --first-name Prénom --last-name Nom
   ```
   Le mot de passe temporaire s'affiche une seule fois et devra être changé à la première connexion.

## 5. Vérifications avant d'ouvrir l'accès

- [ ] `pnpm db:check` sur la base cible : connexion OK et migrations appliquées.
- [ ] Inscription, connexion, déconnexion depuis le domaine public.
- [ ] Le cookie `ocp_session` est `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] `/api/docs` n'est pas exposé en production (sauf `SWAGGER_ENABLED=true` volontaire).
- [ ] La CI GitHub Actions est verte sur le commit déployé.

## 6. Points à valider sur le premier environnement Railway

- **`TRUST_PROXY_HOPS`** : la limitation par IP doit voir l'IP réelle du client. Après déploiement,
  vérifier dans le journal d'audit (`ipAddress` des connexions) que l'IP enregistrée est celle du client
  et non celle d'un proxy ; ajuster la valeur si nécessaire.
- **Région** : la base Neon actuelle est en `us-east-2`. Pour des utilisateurs en Afrique de l'Ouest,
  une région européenne (Neon `eu-central-1` / Railway `europe-west4`) réduirait fortement la latence ;
  l'inscription enchaîne une dizaine de requêtes dans une transaction. API et base doivent être dans la
  même région.
- **Format `preDeployCommand`** : vérifier dans l'interface Railway que la commande de pré-déploiement
  est bien reconnue depuis `railway.json`.

## 7. Retour arrière

- Railway → service → Deployments → _Redeploy_ d'un déploiement précédent.
- Les migrations étant additives, un retour arrière du code ne nécessite pas de retour arrière de la
  base. Toute migration future qui supprime ou renomme une colonne devra être découpée en étapes
  compatibles (ajout → migration des données → suppression dans un sprint ultérieur).
