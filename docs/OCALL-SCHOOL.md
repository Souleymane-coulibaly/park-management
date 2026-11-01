# Ocall School : Sprint 1

Ocall School est un produit d'Ocall Suite, vendu **uniquement sur contrat B2B** : aucun tarif public,
aucune offre à prix fixe. Ce sprint livre le socle : contrats, portail, structure pédagogique et rôles.
Les élèves, notes, classements, bulletins PDF et SMS arrivent aux sprints suivants.

## 1. Architecture

```
Navigateur ─ Next.js (/suite, /school, /admin/contrats)
                │
             API NestJS, un seul service
             ├─ modules/suite-contracts  contrats et droits d'accès
             └─ modules/school           domaine School, aucun import des modules Park
                │                                  │
     Base Ocall Suite (identité, organisations,    Base Ocall School (écoles, années, classes,
     contrats, journal d'audit)                    matières, rôles School)
```

- **Deux bases PostgreSQL distinctes**, deux schémas Prisma, deux jeux de migrations et d'identifiants.
  Aucune clé étrangère entre les deux : l'API contrôle `organizationId` et `userId`.
- **Isolation entre clients** : `organizationId` sur chaque table, et liens par clé composée
  `(organizationId, id)`. PostgreSQL refuse lui-même un lien entre deux clients.
- **Protection de Park** : la base School est connectée à la demande, jamais au démarrage. `/health` n'en
  dépend pas. Une panne de School n'arrête ni l'API ni Park.

## 2. Contrats (`/admin/contrats`)

| Statut                   | Accès du client                                   |
| ------------------------ | ------------------------------------------------- |
| Brouillon                | Aucun                                             |
| Actif                    | Complet, du début à la fin du contrat             |
| Actif, échéance dépassée | Lecture seule et export, sans traitement planifié |
| Suspendu                 | Lecture seule et export                           |
| Expiré                   | Lecture seule et export                           |
| Résilié                  | Lecture seule et export ; définitif               |

**Aucun statut ne supprime de données.** Le contrat porte sa référence, ses dates, ses modules, sa limite
d'établissements et les établissements couverts. Chaque changement est historisé et journalisé.

## 3. Rôles

Un rôle Ocall Park ne donne aucun droit School, sauf le **propriétaire de l'organisation**, direction du
groupe d'office. Un compte créé dans School porte le rôle `PRODUCT_USER`, sans aucune permission Park.

| Permission (Sprint 1)  | Direction groupe | Directeur      | Secrétariat | Enseignant, surveillant, comptable |
| ---------------------- | ---------------- | -------------- | ----------- | ---------------------------------- |
| Consulter la structure | Tous sites       | Son école      | Son école   | Son école                          |
| Créer un établissement | Oui              | Non            | Non         | Non                                |
| Modifier la structure  | Oui              | Son école      | Non         | Non                                |
| Règles de notation     | Oui              | Son école      | Non         | Non                                |
| Voir l'équipe          | Oui              | Son école      | Son école   | Non                                |
| Gérer l'équipe         | Oui              | Hors direction | Non         | Non                                |
| Exporter               | Oui              | Son école      | Non         | Non                                |

Les équipes internes d'Ocall gèrent les contrats et ne voient que les noms d'établissements nécessaires à
la couverture, jamais les données scolaires.

## 4. Français et arabe

- Noms bilingues (`name`, `nameAr`) sur les établissements, parcours, cycles, niveaux, classes, matières
  et périodes, conservés en Unicode.
- Saisie et affichage de l'arabe de droite à gauche. L'interface elle-même reste en français à ce stade.
- Matières religieuses créées uniquement si l'établissement le choisit.

## 5. Règles de notation

`GradingPolicyVersion` : barème, moyenne de passage, décimales, règle des ex æquo, affichage des rangs.
Ajout seul : chaque modification crée une version, pour que les futurs bulletins restent reproductibles.
**Les moteurs de calcul ne sont pas livrés à ce sprint** : ces règles sont enregistrées, pas appliquées.

## 6. Déploiement

Prérequis : votre accord explicite pour chaque étape sur un environnement existant.

**1. Base School.** Créez sur Neon Europe une base dédiée, avec une branche de test. Récupérez ses URL
`-pooler` et directe.

**2. Migration de la base Ocall Suite**, additive (`20261103000000_suite_contrats`) : deux valeurs
d'énumération et deux tables, sans rien supprimer. Sur un poste disposant de `apps/api/.env.staging` :

```
pnpm db:migrate:deploy:staging
```

**3. Variables Railway (`ocall-api`)** :

```
SCHOOL_ENABLED=true
SCHOOL_DATABASE_URL=<URL Neon School avec pooler>
SCHOOL_DIRECT_URL=<URL Neon School directe>
```

L'API refuse de démarrer si `SCHOOL_DATABASE_URL` désigne la même base que `DATABASE_URL`.

**4. Déploiement.** Le pré-déploiement enchaîne `db:migrate:deploy` et `db:school:migrate:deploy`. Sans
`SCHOOL_ENABLED=true`, cette seconde commande ne fait rien. Déployez l'API, puis le web. Aucune nouvelle
variable n'est nécessaire sur Vercel.

**5. Vérifications.**

- `/api/v1/health` répond `{"status":"ok"}` et Park fonctionne.
- `/admin/contrats` : créez un client, puis activez son contrat.
- Le responsable se connecte, arrive sur `/suite` et ouvre Ocall School.

**Retour arrière** : `SCHOOL_ENABLED=false` puis redémarrage. Les routes School répondent 404, Park n'est
pas touché et aucune donnée n'est supprimée.

## 7. Tests

```
TEST_DATABASE_URL=… TEST_SCHOOL_DATABASE_URL=… pnpm --filter @ocall/api exec jest --runInBand school-sprint1
```

Une base School distante doit porter le marqueur de test (`pnpm db:school:mark-test`).

## 8. Limites du Sprint 1

- Un employé Park existant ne peut pas encore recevoir de rôle School : il faut un compte dédié.
- Pas de logo, de matricule, d'élèves, de notes, de bulletins ni de SMS.
- Pas de PWA School : le Service Worker reste limité à `/app`.
- Les dates de contrat s'apprécient en UTC.
- La conformité des données de mineurs doit être validée pays par pays avant toute vraie donnée.
