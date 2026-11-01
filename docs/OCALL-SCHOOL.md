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

## 8. Sprint 2 : dossiers élèves

### Modèles et migration

`20261104000000_dossiers_eleves`, base School uniquement, ajouts seuls : `SchoolStudent`, `SchoolGuardian`,
`SchoolStudentGuardian`, `SchoolEnrollment`, `SchoolClassAssignment`, `SchoolClassTeacher`,
`SchoolStudentDocument`, `SchoolStudentEvent`, `SchoolImportJob`, `SchoolStudentSettings`,
`SchoolNumberCounter`. Trois index partiels, hors du schéma Prisma, interdisent deux inscriptions actives
la même année, deux affectations ouvertes la même année et deux responsables principaux pour un élève.

### Règles

- **Matricule** : format et périmètre par établissement, compteur atomique, numéro déjà importé sauté. Le
  périmètre ne change plus une fois des dossiers créés.
  Fixe ensuite : seule une correction de la direction, motivée et historisée, le change.
- **Doublon entre établissements** : détecté sur tout le groupe. Sans accès à l'autre école ou sans droit de
  transfert, la réponse est un message neutre (`STUDENT_REVIEW_REQUIRED`), sans élève, établissement ni
  identifiant, et aucun contournement n'est possible ; la demande est journalisée sans donnée personnelle.
  Seul un utilisateur habilité sur les deux écoles voit le dossier, confirme un homonyme ou organise le
  transfert. Après un transfert, l'ancien établissement ne voit plus l'inscription dans ses listes. Une collision de matricule à l'échelle du groupe reste signalée comme telle.
- **Inscription** : brouillon, en attente, validée, annulée, terminée. Le secrétariat soumet, la direction
  valide. La validation exige une classe, un responsable et les pièces obligatoires de l'établissement.
- **Sortie** : transfert hors du groupe, départ ou abandon termine l'inscription et garde le dossier.
- **Clôture d'une année** : affectations fermées, statut des élèves remis à jour. L'inscription reste dans
  l'historique, et plus aucune validation, sortie ni changement de classe n'est accepté sur cette année.
- **Concurrence** : les opérations qui exigent une année ouverte prennent un verrou partagé sur l'établissement,
  que la clôture prend en exclusif. Toute écriture sur un dossier le verrouille et revérifie son établissement.
- **Transfert dans le groupe** : réservé à qui a accès aux deux établissements. Le même dossier suit, une
  nouvelle inscription attend validation ; un nouveau matricule n'est attribué qu'en cas de collision.
- **Besoins particuliers** : chiffrés en AES-256-GCM, route dédiée, chaque consultation est journalisée.
- **Documents** : type réel contrôlé, 5 Mo, stockage privé, lien signé de 5 minutes, téléchargement
  journalisé. Une suppression retire le fichier et garde la trace.
- **Import** : CSV ou XLSX, 1 000 lignes, 100 colonnes, 50 Mo décompressés réels, analyse sans écriture, puis une transaction par ligne. Un second
  envoi ne recrée rien. Le fichier n'est pas conservé et le rapport ne contient aucune donnée personnelle.
- **Export** : matricule, noms, naissance, niveau, classe et statuts. Jamais les adresses, observations ni
  besoins particuliers. Les contacts des responsables ont leur propre export.

### Droits

| Permission                       | Direction groupe | Directeur      | Secrétariat | Surveillant, comptable | Enseignant  |
| -------------------------------- | ---------------- | -------------- | ----------- | ---------------------- | ----------- |
| Liste restreinte                 | Tous sites       | Son école      | Son école   | Son école              | Ses classes |
| Dossier complet, historique      | Oui              | Oui            | Oui         | Non                    | Non         |
| Créer, modifier un dossier       | Oui              | Oui            | Oui         | Non                    | Non         |
| Besoins particuliers             | Oui              | Oui            | Non         | Non                    | Non         |
| Corriger un matricule, réglages  | Oui              | Oui            | Non         | Non                    | Non         |
| Préparer une inscription, classe | Oui              | Oui            | Oui         | Non                    | Non         |
| Valider, annuler, sortie         | Oui              | Oui            | Non         | Non                    | Non         |
| Transfert dans le groupe         | Oui              | Si deux écoles | Non         | Non                    | Non         |
| Responsables, documents          | Oui              | Oui            | Oui         | Non                    | Non         |
| Supprimer un document            | Oui              | Oui            | Non         | Non                    | Non         |
| Importer, exporter               | Oui              | Oui            | Oui         | Non                    | Non         |

Super Admin Ocall et clients Park : aucun accès aux dossiers.

### API (`/api/v1/school`)

| Domaine      | Routes                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Élèves       | `GET, POST students` ; `GET students/dashboard` ; `GET, PATCH students/:id` ; `POST students/:id/matricule` ; `GET, PUT students/:id/sensitive` ; `GET students/:id/history` ; `GET, PUT student-settings` |
| Inscriptions | `GET, POST enrollments` ; `GET students/:id/enrollments` ; `POST enrollments/:id/status`, `/class`, `/exit` ; `POST students/:id/transfer`                                                                 |
| Classes      | `GET rosters` ; `GET classes/:id/students` ; `POST classes/:id/teachers` ; `DELETE classes/:id/teachers/:memberId`                                                                                         |
| Responsables | `GET, POST guardians` ; `PATCH guardians/:id` ; `GET, POST students/:id/guardians` ; `PATCH, DELETE students/:id/guardians/:guardianId`                                                                    |
| Documents    | `GET, POST students/:id/documents` ; `GET students/:id/documents/:documentId/link` ; `DELETE students/:id/documents/:documentId` ; `GET files/:token`                                                      |
| Imports      | `POST imports/preview` ; `GET, POST imports` ; `GET exports/students` ; `GET exports/guardians`                                                                                                            |

### Déploiement

En plus de la procédure de la section 6, définissez sur Railway une clé propre à chaque environnement, et
conservez-la : la perdre rend les besoins particuliers illisibles.

```
SCHOOL_DATA_ENCRYPTION_KEY=<32 octets aléatoires en base64>
```

En production, l'API refuse de démarrer sans cette clé quand School est activé. Le stockage privé existant
doit être configuré sur un disque persistant ou un bucket (`MEDIA_STORAGE`) : sur un disque éphémère, les
documents disparaîtraient au redéploiement. Les nouvelles pages sont dans le web : redéployez-le aussi.

## 9. Limites actuelles

- Un employé Park existant ne peut pas encore recevoir de rôle School : il faut un compte dédié.
- Pas de logo, de notes, de bulletins ni de SMS. Modèles de documents personnalisés non livrés.
- Portail parents non livré : seul le contrôle des enfants autorisés est préparé.
- Aucun antivirus : un contrôle du type réel et du contenu actif des PDF, et un téléchargement en pièce
  jointe uniquement. Un PDF à flux compressé peut masquer du contenu actif.
- Pas de purge automatique des documents : les durées légales de conservation restent à fixer par pays.
- Les documents School ne sont pas comptés dans le quota de stockage de l'organisation.
- Import synchrone, limité à 1 000 lignes par fichier.
- Pas de PWA School : le Service Worker reste limité à `/app`.
- Les dates de contrat s'apprécient en UTC.
- La conformité des données de mineurs doit être validée pays par pays avant toute vraie donnée.
