# Préparation de la production (Sprint 11B)

Complète [DEPLOIEMENT-RAILWAY.md](DEPLOIEMENT-RAILWAY.md) (environnements, variables, premier
déploiement). **Aucun déploiement sans autorisation du commanditaire.** Région de production
**validée le 2026-10-31** : Europe (§7).

## 1. Variables ajoutées aux Sprints 11A et 11B (service `api`)

| Variable                 | Obligatoire en production | Rôle                                                                                                                                    |
| ------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `MFA_ENCRYPTION_KEY`     | oui                       | Chiffre les secrets de double authentification (32 octets base64). Ne jamais la changer sans réinitialiser la MFA des comptes internes. |
| `STORAGE_SIGNING_SECRET` | oui                       | Signe les liens temporaires des fichiers privés (32 octets base64 au moins). La changer invalide seulement les liens en cours (5 min).  |
| `LOG_FORMAT`             | non                       | `json` par défaut en production, `text` en développement.                                                                               |
| `MEDIA_STORAGE` / `S3_*` | oui (`s3`)                | Stockage compatible S3 (Cloudflare R2 retenu). **Bucket privé** : aucun accès public requis.                                            |

Génération d'une clé : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Saisir toutes ces valeurs comme variables **scellées** sur Railway ; jamais dans Git.

L'API **refuse de démarrer** en production si `MFA_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET` ou
`COOKIE_SECURE=true` manquent, ou si un fournisseur simulé (IA, domaines) est configuré.

## 2. Sondes de santé

| Sonde                      | Usage                                 | Vérifie                                                      | Réponse                                              |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `GET /api/v1/health`       | Railway (`healthcheckPath`), vivacité | base de données                                              | `200 {"status":"ok"}` ou `503`                       |
| `GET /api/v1/health/ready` | supervision externe, disponibilité    | base et stockage, latence de chaque, durée de fonctionnement | `200` si tout est disponible, sinon `503 "degraded"` |

Chaque vérification est bornée à 3 secondes. Aucune information sensible (ni hôte, ni message
d'erreur, ni version) n'est renvoyée.

## 3. Journaux structurés

- En production, une ligne JSON par événement : `time`, `level`, `context`, `message`, `detail`.
- Journal d'accès HTTP : `requestId` (renvoyé au client dans l'en-tête `X-Request-Id`, à demander
  au client pour le support), méthode, chemin **sans paramètres de requête**, statut, durée. Ni
  corps, ni cookie. La sonde `/health` n'est pas journalisée.
- **Masquage systématique** avant écriture : identifiants dans les URL de connexion, jetons
  `Bearer`, clés `sk-…`, champs `password` / `secret` / `token` / `apiKey` / `cookie`, liens signés
  `/files/…`, cookie de session. Couvert par `json-logger.spec.ts`.
- Les journaux d'audit métier restent en base (`AuditLog`) ; les journaux techniques sont lus dans
  Railway (onglet _Logs_, filtres par `level` et `requestId`).

## 4. Supervision et alertes (à mettre en place avant le pilote)

| Alerte                       | Source                                                                        | Seuil proposé                          | Action                                                 |
| ---------------------------- | ----------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| API indisponible             | moniteur externe sur `/api/v1/health/ready` (ex. UptimeRobot, offre gratuite) | 2 échecs consécutifs à 1 min           | Vérifier Railway, base Neon, stockage                  |
| Taux d'erreurs 5xx           | journaux Railway, `level=error`, `context=Http`                               | > 1 % sur 15 min                       | Lire les `requestId`, revenir en arrière si régression |
| Latence                      | `durationMs` du journal d'accès                                               | p95 > 2 s sur 15 min                   | Vérifier la base (région, pool), §7                    |
| Stockage proche du quota     | `/admin/stockage`                                                             | > 90 % pour une organisation           | Prévenir le client ou ajuster la dérogation            |
| Consommation IA              | `/admin/consommation-ia`, `ai.quota_alert`                                    | seuil d'alerte de l'organisation       | Vérifier l'usage, le coût estimé                       |
| Demandes de support urgentes | `/admin/support`                                                              | urgence « Urgente » non traitée en 2 h | Prendre en charge                                      |

Aucun service de supervision payant n'est activé sans accord.

## 5. Sauvegardes

- **Neon** : restauration à un instant donné (_point-in-time restore_) sur la fenêtre d'historique
  de l'offre souscrite (à vérifier : 24 h en offre gratuite, 7 jours ou plus en offre payante).
  C'est la sauvegarde principale de la base.
- **Export logique quotidien** recommandé en complément (hors Neon) : `pg_dump --format=custom` de la
  base de production vers un stockage privé distinct, conservé 30 jours. À programmer (GitHub Actions
  planifiée ou tâche Railway) après accord ; il exige l'URL **directe** de production.
- **Fichiers (R2)** : objets jamais modifiés après écriture (clés uniques) ; activer la réplication
  ou une copie périodique vers un second bucket si le budget le permet. Les fichiers privés expirés
  sont purgés volontairement (§6).

## 6. Test de restauration (à faire avant le pilote, avec autorisation)

1. Créer une **branche Neon jetable** depuis la production à un instant T (jamais sur `development`,
   jamais en écrasant la production).
2. `pnpm db:check` sur cette branche (variables pointant vers elle) : connexion, migrations.
3. Vérifier des comptages de référence relevés à l'instant T (organisations, abonnements, factures,
   ventes du jour) et une connexion réelle sur une API locale pointée vers la branche.
4. Noter la durée totale (objectif de reprise) et l'écart de données (objectif de point de reprise).
5. Supprimer la branche jetable. Consigner le résultat dans le dossier du checkpoint.

Le test de restauration **n'a pas été réalisé** : il nécessite la base de production (non créée) et
votre autorisation.

## 7. Base de données : délais et verrous

- `idle_in_transaction_session_timeout = 60s` est posé **au niveau de la base** par la migration
  `20261031020000` : une session restée « en transaction inactive » plus de 60 s est fermée par
  PostgreSQL et ses verrous libérés (cause probable de l'anomalie « transaction bloquée 732 s »). Si
  le rôle de migration n'a pas le privilège nécessaire, la migration continue avec un avertissement :
  poser alors la valeur dans la console Neon (_Settings → Compute → Postgres settings_ ou
  `ALTER DATABASE … SET`).
- Délai des transactions Prisma : 15 s (contrôlé à la requête suivante) ; la borne serveur ci-dessus
  couvre le cas d'un processus bloqué.
- **Région** : la base de développement est en `us-east-2` (≈ 300 ms par aller-retour depuis
  l'Europe). Recommandation : base de production Neon `eu-central-1` et services Railway en Europe
  de l'Ouest, dans la même région. **Validé par le commanditaire le 2026-10-31.**
- Pool : utiliser l'URL _pooled_ (PgBouncer) à l'exécution, l'URL directe pour les migrations.

## 8. Procédure de déploiement

1. CI verte sur le commit (format, lint, types, unitaires, intégration sur Neon `test`).
2. Variables de §1 présentes sur Railway (scellées).
3. Déployer `api` : la pré-commande contrôle puis applique les migrations ; si elle échoue, l'ancienne
   version continue de tourner.
4. Vérifier `/api/v1/health/ready` → `200`.
5. Déployer `web`, vérifier la connexion, la double authentification d'un compte interne, une vente
   de test dans une organisation de recette.
6. Consigner la version déployée (hash du commit) et l'heure.

## 9. Retour arrière

- **Code** : Railway → service → _Deployments_ → _Redeploy_ du déploiement précédent. Les migrations
  étant additives, l'ancien code fonctionne sur le nouveau schéma.
- **Données** : en cas de corruption, restauration Neon à l'instant précédant l'incident sur une
  **nouvelle branche**, vérification (§6), puis bascule des variables `DATABASE_URL` / `DIRECT_URL`.
  Jamais de réinitialisation de la base.
- **Clés** : ne jamais faire tourner `MFA_ENCRYPTION_KEY` lors d'un retour arrière.

## 10. Liste de contrôle avant ouverture du pilote

- [ ] Base de production créée en Europe (Neon `eu-central-1`) ; variables scellées.
- [ ] Bucket R2 privé créé, clés d'accès limitées à ce bucket.
- [ ] `MFA_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET` définies et conservées hors ligne.
- [ ] Propriétaire de la plateforme créé (`pnpm db:bootstrap-super-admin`), MFA enrôlée, codes de
      secours rangés hors ligne.
- [ ] Moniteur externe sur `/api/v1/health/ready`.
- [ ] Test de restauration réalisé (§6).
- [ ] Contrôles de [DEPLOIEMENT-RAILWAY.md §7](DEPLOIEMENT-RAILWAY.md).
