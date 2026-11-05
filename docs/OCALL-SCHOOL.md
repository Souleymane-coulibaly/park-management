# Ocall School

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
- Matières religieuses créées uniquement si l'établissement le choisit.

### Langue de l'établissement (Sprint 3A)

Chaque établissement choisit sa langue (`School.defaultLocale`). **Le français est la langue par défaut** :
tout établissement créé sans précision est en Français. L'arabe est un choix de l'établissement.

| Langue            | Interface                 | Champs et contenus arabes            | Exports                      |
| ----------------- | ------------------------- | ------------------------------------ | ---------------------------- |
| Français (défaut) | Français                  | Jamais affichés ni demandés          | Aucune colonne arabe         |
| Arabe             | Arabe, de droite à gauche | Affichés ; libellé arabe prioritaire | En-têtes et valeurs en arabe |
| Bilingue          | Français                  | Affichés à côté du français          | En-têtes « Nom / اللقب »     |

- La direction (`school.structure.manage`) change la langue depuis « Établissements ». Le changement est
  journalisé (`school.locale_changed`, ancienne et nouvelle valeur) ; secrétariat et enseignants sont
  refusés, un autre client ne voit pas l'établissement.
- Aucune donnée n'est supprimée : en Français, les champs arabes sont masqués et ne sont pas envoyés lors
  d'une modification, donc jamais effacés. Ils réapparaissent en Arabe ou en Bilingue.
- Le champ principal (`name`, `lastName`…) reste obligatoire dans toutes les langues ; un établissement
  en Arabe peut le saisir en arabe. La saisie de l'arabe n'est jamais obligatoire.
- Le menu général et la page compte d'Ocall Suite restent en français (composants partagés avec Park).
  Les pages School suivent la langue de l'établissement choisi ; la fiche élève, celle de l'élève.
- Textes : `packages/shared/src/school-i18n.ts`. Chaque texte français a sa traduction arabe, vérifiée
  par le compilateur et par un test. Les erreurs de l'API sont traduites par leur code ; un code inconnu
  et les détails de validation gardent le message français de l'API.
- Champs complémentaires : un libellé en arabe reçoit une clé numérotée (`champ_1`). Le refus des données
  sensibles (religion, santé, ethnie…) couvre aussi les libellés arabes, `labelAr` compris.
- **Les traductions arabes doivent être relues par un arabophone avant toute mise en production.**

## 5. Règles de notation

`GradingPolicyVersion` : barème, moyenne de passage, décimales, règle des ex æquo, affichage des rangs.
Ajout seul : chaque modification crée une version, pour que les futurs bulletins restent reproductibles.
Le moteur de calcul est livré au Sprint 4 (section 10) ; la règle facultative `absences` (écartées ou zéro)
s’ajoute au JSON des versions, sans migration.

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

Une base School distante doit porter le marqueur de test (`pnpm db:school:mark-test`). La variable est
`SCHOOL_TEST_DATABASE_URL`. Le workflow manuel `School Neon test` lit le secret GitHub du même nom.

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
- **Documents** : type réel contrôlé, 5 Mo, stockage privé. Le lien signé de 5 minutes ne suffit jamais :
  chaque téléchargement exige la session de son bénéficiaire et revérifie compte, contrat, rôle et
  établissement actuel de l'élève. Une perte de droits vaut donc dès l'accès suivant. Téléchargement
  journalisé. Une suppression retire le fichier et garde la trace.
- **Import** : CSV ou XLSX, 1 000 lignes, 100 colonnes, 50 Mo décompressés réels, analyse sans écriture, puis une transaction par ligne. Un second
  envoi ne recrée rien. Le fichier n'est pas conservé et le rapport ne contient aucune donnée personnelle.
  Si des colonnes obligatoires ne sont pas reconnues, l'analyse renvoie les en-têtes et les colonnes
  manquantes sans lire les lignes ; l'écran les fait associer, puis relance l'analyse. L'enregistrement
  refuse toujours une correspondance incomplète.
- **Export** : matricule, noms, naissance, niveau, classe et statuts. Jamais les adresses, observations ni
  besoins particuliers. Les contacts des responsables ont leur propre export. Le fichier est construit en
  mémoire, donc borné : limiteur dédié (30 exports par 10 minutes et par IP), 20 000 lignes au plus
  (`EXPORT_TOO_LARGE`, exporter par classe : `classId` filtre les deux exports), deux exports simultanés
  par instance (`EXPORT_BUSY`).

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

### Activation d'un membre entre les deux bases

Il n'y a pas de transaction commune. L'ordre d'écriture garantit qu'une panne ne donne jamais plus que les droits validés dans School :
School valide d'abord la décision et les droits, puis Suite recopie l'état validé dans School. L'accès exige
les deux bases ouvertes, et seuls les comptes dédiés à School (`PRODUCT_USER`) y entrent, en plus du
propriétaire de l'organisation. Le tableau part de deux bases à l'état précédent de la décision.

| Décision interrompue par une panne de Suite | School | Suite  | Effet                                       |
| ------------------------------------------- | ------ | ------ | ------------------------------------------- |
| Désactivation                               | Fermé  | Ouvert | School refusé aussitôt                      |
| Réactivation, avec ou sans restriction      | Ouvert | Fermé  | Connexion refusée, nouveaux droits en place |

Chaque décision d'accès (membre, affectation d'enseignant) est écrite dans la transaction School qui l'applique
(`SchoolAccessDecision`, migration `20261105000000_decisions_acces`), puis publiée au journal Suite. Si le
journal est indisponible, la décision reste en attente et la publication reprend à l'opération suivante, sans
doublon sauf cas extrême : une transaction School annulée pendant l'écriture dans Suite peut produire deux entrées
de journal portant le même `decisionId`. Cette réserve se lève par une contrainte d'unicité dans la base Suite,
non ajoutée tant qu'aucune migration côté Ocall Park n'est autorisée. Les changements d'année suivent le même
chemin. Une panne de School avant sa validation ne change rien. L'administrateur reçoit une erreur et rejoue la
décision. Une demande d'activation d'un membre partagé, même à valeur égale, est réservée à qui couvre tous ses
établissements. Reste à livrer au Sprint 3 : reprise automatique, sans intervention de l'administrateur.

## 9. Sprint 3B : équipe pédagogique

### Modèles et migration

Migration additive `20261106000000_enseignants_classes_matieres` (colonnes avec valeur par défaut, nouvelles
tables, index) : `Subject.isActive` et `catalogKey`, `SubjectLevel`, `SchoolClass.isActive`,
`SchoolClassGroup` et `SchoolClassGroupStudent`, `SchoolMember.firstNameAr` et `lastNameAr`,
`SchoolTeacherSubject`, `SchoolTeachingAssignment`. Deux index partiels écrits à la main : un seul enseignant
actif par classe, groupe (ou classe entière) et matière ; un seul professeur principal actif par classe.
Vérifiée par `prisma migrate diff` (différence vide) sur une base jetable. Elle n'est appliquée sur aucune base
Neon sans accord.

### Règles

- **Matières** : catalogue commun Ocall (`packages/shared/src/school-teaching.ts`). L'établissement active les
  matières qu'il enseigne et en reçoit sa propre copie, qu'il renomme, désactive et associe à ses niveaux
  (coefficient et horaire par niveau) sans toucher aux autres écoles. Rien n'est activé d'office, les
  matières religieuses comprises. Les matières propres à l'établissement restent possibles.
- **Classes** : modification et archivage (jamais de suppression) ; la capacité ne descend pas sous
  l'effectif inscrit. **Groupes** dans une classe ; leurs élèves sont inscrits (inscription validée) dans la
  classe.
- **Enseignants** : comptes `SchoolMember` de rôle `TEACHER` (aucun doublon de personne), noms arabes
  facultatifs, matières enseignables (filtre et alerte « hors spécialité », jamais un refus).
- **Affectations** : enseignant, classe, groupe éventuel, matière, professeur principal éventuel. Contrôles :
  classe active, année ouverte, groupe de la classe, matière active de l'établissement et enseignée au niveau
  de la classe, enseignant actif affecté à l'établissement. Un remplacement termine l'affectation et confie la
  même place au remplaçant dans une seule transaction ; tout reste dans l'historique. La clôture de l'année
  termine ses affectations.
- **Accès de l'enseignant** : le lien `SchoolClassTeacher` (base de sa lecture des élèves, inchangée depuis le
  Sprint 2) est créé avec la première affectation dans la classe et retiré avec la dernière : l'accès s'arrête
  à la requête suivante. Chaque affectation et chaque fin sont des décisions tracées dans la transaction
  (`school.teaching_assigned`, `school.teaching_ended`), publiées au journal Suite. L'ancienne route de retrait
  d'un enseignant termine aussi ses affectations dans la classe.
- **Verrous** : établissement (partagé, contre la clôture), classe, puis membre (partagé, contre une
  désactivation simultanée). Les index partiels tranchent deux affectations simultanées sur la même place.
  Le remplacement verrouille l'ancien et le nouvel enseignant, triés, avant toute écriture. Le remplacement
  des niveaux d'une matière verrouille la matière.

### Isolation des verrous et des lectures (durcissement Codex, passes 1 à 11)

- **Aucun verrou hors périmètre** : chaque `FOR UPDATE` / `FOR SHARE` sur un identifiant fourni par le client
  est borné dans la requête même à l'organisation et au périmètre de l'utilisateur (membres :
  `SchoolService.lockMemberInScope` ; élèves : `SchoolStudentsService.lockInScope` ; responsables : règle de
  visibilité `visibleSql`, enfants liés compris, y compris pour la réutilisation à l'import ; enseignants et
  élèves d'un groupe). Une ligne étrangère n'est jamais verrouillée ni attendue ; un verrou vide (ligne sortie
  du périmètre depuis le contrôle) donne 404 sans relecture. Ce durcissement couvre aussi du code des Sprints
  1 et 2 (modification de membre, d'élève et de responsable, import), à la demande de la direction.
- **Contrôle et restitution dans un même instantané** (`RepeatableRead`) : fiche enseignant, affectations
  d'un enseignant, « Mes classes », liste des classes d'un enseignant, fiche de classe, groupes.
- **Garde d'accès** : rôle, activation et établissements d'un membre sont lus par une seule instruction SQL,
  jamais un ancien rôle associé à un nouveau périmètre.
- **Preuves** : tests de concurrence sur PostgreSQL réel (une autre connexion tient le verrou : réponse en
  moins de 5 s ; pauses imposées entre contrôle et restitution) et 28 mutations, toutes détectées. Les tests
  de concurrence sont ignorés sous PGlite (connexion unique).

### Droits

| Permission                                                                      | Rôles                                |
| ------------------------------------------------------------------------------- | ------------------------------------ |
| `school.teaching.read` (équipe, affectations, historique)                       | Direction, secrétariat, surveillance |
| `school.teaching.manage` (affecter, remplacer, terminer, matières enseignables) | Direction                            |
| `school.structure.manage` (matières, niveaux, classes, groupes)                 | Direction                            |

L'enseignant voit « Mes classes » (`GET teaching/mine`) et la fiche de ses seules classes.

### Écrans

`/school/enseignants` et sa fiche, `/school/classes` (fiches de classe) et sa fiche (groupes, équipe
pédagogique, historique), `/school/matieres` (catalogue, niveaux, activation), `/school/mes-classes`. Tous
suivent la langue de l'établissement (Sprint 3A) ; une fiche de classe suit celle de la classe.

## 10. Sprint 4 : évaluations, notes, bulletins, mémorisation du Coran

### Audit de l'existant

Réutilisé tel quel : `AcademicPeriod` (création au Sprint 1 ; modification et suppression ajoutées),
`GradingPolicyVersion` (barème, décimales, moyenne de passage, ex æquo, classement, versions en ajout seul ;
réglage facultatif `absences` ajouté au JSON, sans migration), coefficients de `Subject` et `SubjectLevel`,
affectations 3B (droits des enseignants), inscriptions validées (élèves d'une classe), journal des décisions.
Rien n'existait pour les évaluations, les notes, les moyennes, les bulletins ni la mémorisation.

### Modèles et migration

Migration additive `20261107000000_evaluations_notes_bulletins_coran` : trois énumérations, huit tables,
deux index uniques composés sur des tables existantes (`AcademicPeriod`, `Subject`), toujours satisfaits.
`SchoolEvaluation`, `SchoolGrade`, `SchoolGradeEvent` (journal en ajout seul), `SchoolAppreciation`,
`SchoolReportComment`, `SchoolResultValidation`, `SchoolQuranSettings`, `SchoolQuranProgress`,
`SchoolQuranEvaluation`. Clés étrangères composées : PostgreSQL refuse une période d'une autre année, une
matière d'un autre établissement, un groupe d'une autre classe. Contraintes écrites à la main : une note porte
une valeur si et seulement si elle est « notée » (absence et dispense ne sont jamais un zéro), barème et
coefficient positifs, sourate de 1 à 114, une seule validation active par classe et période (index partiel).
Vérifiée par `prisma migrate diff` (différence vide) sur une base jetable. Non appliquée sur Neon.

### Règles de calcul (`packages/shared/src/school-assessment.ts`)

Moteur pur, partagé, testé à l'unité ; la version de règles appliquée est la plus récente entrée en vigueur à
la fin de la période.

- Moyenne de matière : notes ramenées au barème de l'établissement, pondérées par le coefficient de chaque
  évaluation. Dispense et note non saisie écartées ; absence écartée (par défaut) ou comptée zéro selon la
  règle `absences`. Une évaluation de groupe ne concerne que ses élèves.
- Moyenne générale : moyennes de matière **arrondies** (celles du bulletin, pour qu'une famille puisse la
  recalculer), pondérées par le coefficient de la matière au niveau (à défaut, celui de la matière) ; une
  matière de coefficient 0 n'y entre pas.
- Classement (si activé) : sur la moyenne arrondie, sans les matières exclues du classement ; ex æquo
  `SHARED` (1, 1, 3) ou `DENSE` (1, 1, 2) ; un élève sans moyenne n'est pas classé.
- Arrondi au plus proche, la moitié vers le haut, sans l'erreur binaire (1,005 → 1,01).

### Notes, validation et verrouillage

- Saisie individuelle ou en tableau (`PUT evaluations/:id/grades`) : seules les lignes réellement modifiées
  sont écrites, chacune avec sa trace (avant, après, auteur, motif facultatif) dans la même transaction.
  Une évaluation qui a reçu une note, même effacée depuis, ne se supprime plus ; un barème ne descend pas sous
  une note saisie ; une période ne se raccourcit pas en laissant des évaluations dehors.
- Validation par la direction : résultats calculés sous verrou, figés avec leurs règles dans la validation
  (une nouvelle version des règles ne les change plus), décision tracée et publiée au journal Suite. Notes,
  évaluations et appréciations des enseignants sont alors refusées (409 `RESULTS_VALIDATED`) ; l'appréciation
  générale de la direction reste possible. Réouverture motivée : la validation reste dans l'historique, le
  motif ne sort pas dans le journal.
- Verrous, dans cet ordre : établissement (partagé, contre la clôture d'année), verrou consultatif de la
  classe et de la période (sérialise toute écriture de résultats avec la validation), affectations de
  l'enseignant (partagé : une fin d'affectation attend la saisie en cours), puis la ligne visée, bornée à
  l'organisation. Lectures : contrôle et restitution dans un même instantané.

### Durcissement (audit Codex du Sprint 4)

- Ordre des verrous de toute écriture de résultats, aligné sur celui du module : établissement (partagé),
  élèves visés (partagé, bornés à l’établissement de la classe ; étranger = 404), classe (partagé), année
  (`FOR KEY SHARE`), verrou consultatif, affectations (partagé), période (partagé), ligne visée. Un transfert,
  une sortie, un changement de classe ou de groupe et une fin d’affectation attendent la saisie en cours ;
  aucune clé étrangère ne peut former de cycle. Une période se modifie sous verrou exclusif.
- Vue de l’enseignant recalculée sur ses seules affectations : élèves, évaluations couvertes (une
  affectation de groupe ne couvre que les évaluations du groupe), agrégats et appréciations.
- Bulletins validés : élèves, effectif et rang figés par la validation, même après un changement de classe.
- Mémorisation : élève et établissement relus dans l’instantané des données restituées ; numéro d’ordre
  attribué sous verrou de l’élève pour départager deux évaluations du même jour.
- Arrondi exact (mantisse et exposant séparés puis décalage décimal, jamais `NaN`), DTO de création strict,
  404 pour toute ressource étrangère (historique d’une note, validations, saisies).
- Passe 2 : historique d’une note contrôlé dans l’instantané (périmètre, inscription et groupe actuel de
  l’élève) ; vue de l’enseignant d’une feuille validée calculée avec les règles et coefficients figés ;
  appréciation générale possible pour un élève figé ; élèves autorisés par matière dans le formulaire des
  appréciations ; vue coranique de classe limitée aux élèves encore rattachés à l’établissement ; classes de
  l’élève verrouillées en partage avant une évaluation coranique (un changement de groupe attend).
- Passe 3 : la validation verrouille en partage les élèves de la classe avant de calculer (une sortie en cours
  attend : l’état figé est celui d’avant ou d’après) ; règles de classement entièrement validées avant
  enregistrement (booléen, liste d’identifiants de matières de l’établissement) et lues avec tolérance ;
  brouillons d’appréciations des autres matières conservés après un enregistrement.
- Passe 4 : un élève entré dans la classe pendant la prise des verrous fait recommencer la validation (trois
  essais, puis 409 `RESULTS_BUSY`), sans jamais verrouiller un élève après la classe ; identifiants de
  matières exclues normalisés en minuscules ; saisies faites pendant un envoi conservées (notes,
  appréciations, commentaires).
- Passe 5 : clé du verrou consultatif construite sur les identifiants en minuscules (un UUID écrit en
  majuscules ne contourne plus la sérialisation) ; une traduction arabe masquée (établissement en Français)
  n’est ni écrasée ni supprimée par une modification du texte français.
- Passe 6 : la validation fige aussi les groupes de chaque élève ; la vue de l’enseignant d’une feuille
  validée se recalcule sur ces élèves et groupes figés (un retrait de groupe ultérieur ne change rien).
- Preuves : 32 tests d’intégration sur PostgreSQL réel (attente d’un transfert, deux validations
  simultanées, note et validation simultanées, évaluation coranique pendant un changement de groupe, verrou
  étranger jamais attendu, validation pendant une sortie d’élève) et 16 mutations, toutes détectées. La
  reprise d’une validation sur changement d’effectif n’a pas de test d’entrelacement déterministe.

### Bulletins PDF

Générés à la demande par l'API (`pdfkit`, sans navigateur), derrière la garde et la permission
`school.report_cards`, jamais stockés : aucune adresse directe n'existe ; réponse `Cache-Control: no-store`,
pièce jointe, chaque édition journalisée. Un élève ou toute la classe (une page par élève). Contenu :
établissement, élève, classe et année, matières, coefficients, moyennes de l'élève et de la classe, moyenne
générale, rang si activé, appréciations des enseignants et de la direction, date d'édition ; « Provisoire »
avant validation. Français, Arabe (mise en page de droite à gauche, le français en repli d'un libellé sans
traduction) et Bilingue (une langue par ligne). Aucun champ arabe exigé. Polices embarquées
(`apps/api/assets/fonts`, Noto Sans et Noto Naskh Arabic, licence OFL jointe) ; ordre visuel du texte arabe
par `school-rtl-text.ts` (version réduite de l'algorithme bidirectionnel Unicode, testée).

### Mémorisation du Coran (module facultatif)

- Actif seulement pour un établissement en **Bilingue** dont la direction l'a activé, avec la matière dont les
  enseignants saisissent la mémorisation. Ailleurs, toutes les routes de données répondent 404 ; désactiver ou
  changer de langue masque le module sans rien supprimer.
- Catalogue de référence des 114 sourates (numéro, nom arabe, translittération, nombre de versets), généré
  depuis les métadonnées Tanzil (CC BY 3.0) et vérifié par les tests (6 236 versets).
- Suivi par élève et par sourate : Non commencée, En cours, Mémorisée, À réviser ; dates de mémorisation et
  de dernière révision recalculées depuis tout l'historique, quel que soit l'ordre de saisie. Historique en
  ajout seul (une erreur se corrige par une nouvelle évaluation).
- Saisie par l'enseignant affecté à la matière Coran de la classe (ou du groupe) de l'élève ; consultation
  par la direction ; chaque consultation et chaque évaluation journalisées ; aucun export. Données séparées
  des notes : elles n'entrent dans aucune moyenne.
- Lecture seule préparée pour le futur portail parents : `quranSurahStates` (statuts et dates, sans remarque
  ni évaluateur). Aucune route parent n'est ouverte.

### Droits

| Permission                                                                 | Rôles                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------- |
| `school.assessment.read` (évaluations, notes, moyennes)                    | Direction, secrétariat, enseignant (ses affectations) |
| `school.assessment.manage` (évaluations, notes, appréciations)             | Direction, enseignant (ses affectations)              |
| `school.results.validate` (validation, réouverture, appréciation générale) | Direction                                             |
| `school.report_cards` (moyennes générales, classements, bulletins PDF)     | Direction, secrétariat                                |
| `school.quran.settings` (activation du module)                             | Direction                                             |
| `school.quran.read` (progression)                                          | Direction, enseignant (matière Coran)                 |
| `school.quran.manage` (évaluation de mémorisation)                         | Enseignant (matière Coran)                            |

L'enseignant ne voit que les matières de ses affectations, sans moyenne générale ni rang. Une évaluation de
toute la classe exige une affectation à toute la classe ; un enseignant de groupe n'évalue que son groupe. La
fin d'une affectation retire ces droits à la requête suivante.

### API (`/api/v1/school`)

`GET periods`, `PATCH|DELETE periods/:id` ; `GET|POST evaluations`, `GET|PATCH|DELETE evaluations/:id`,
`PUT evaluations/:id/grades`, `GET evaluations/:id/grades/:studentId/history` ; `GET results`,
`PUT results/appreciations`, `GET|PUT results/comments`, `GET results/validations`, `POST results/validate`,
`POST results/unlock` ; `GET report-cards`, `GET report-cards/pdf` ; `GET|PUT quran/settings`,
`GET quran/surahs`, `GET quran/classes/:id`, `GET quran/students/:id`, `POST quran/students/:id/evaluations`.

### Écrans

`/school/periodes`, `/school/evaluations`, `/school/evaluations/[id]` (saisie en tableau, journal),
`/school/resultats` (moyennes, validation, appréciations), `/school/classements`, `/school/bulletins`
(appréciation de la direction, PDF), `/school/coran` (activation, progression de la classe),
`/school/coran/eleves/[id]` (114 sourates, saisie, historique). Le réglage des absences est ajouté à
`/school/notation`. Tous suivent la langue de l'établissement ; le menu général Ocall Suite est inchangé.

## 11. Sprint 5 : gestion financière, frais et encaissements

### Audit de l'existant

Aucun modèle financier dans Ocall School. Ceux d'Ocall Park (ventes, paiements, factures) vivent dans la
base Suite et ne sont pas réutilisés : aucune dépendance fonctionnelle à Park. Réutilisé : compteur
atomique `SchoolNumberCounter` (numéros de reçus), journal des décisions, moteur PDF du Sprint 4 (mis en
commun dans `school-pdf.ts`, sans duplication), exports CSV / XLSX du Sprint 2 (créneaux, plafond).

### Modèles et migration

Migration additive `20261108000000_finances_frais_encaissements` : huit énumérations, neuf tables
(`SchoolFinanceSettings`, `SchoolFee`, `SchoolFeeInstallment`, `SchoolFeeEvent`, `SchoolCharge`,
`SchoolChargeAdjustment`, `SchoolBenefit`, `SchoolPayment`, `SchoolPaymentAllocation`), aucune table
existante modifiée. Contraintes écrites à la main : montants entiers bornés, devise sur trois lettres,
réduction entre zéro et le montant, **jamais de trop-perçu** (payé ≤ dû), contrepassation liée à son
encaissement, et un index partiel qui interdit d'encaisser deux fois la même référence de transaction
(par établissement et par moyen) tant que l'encaissement reste confirmé. Migration additive
`20261108010000_recu_identite_figee` : colonne `SchoolPayment.receiptSnapshot` (identité du reçu figée),
obligatoire pour tout encaissement (CHECK). Vérifiées par `prisma migrate diff` (différence vide).

### Règles (`packages/shared/src/school-finance.ts`)

- **Montants exacts** : entiers en unités mineures de la devise de l'établissement (XOF par défaut ;
  décimales selon ISO 4217), jamais de nombre à virgule. Saisie convertie sans arrondi ; partage exact
  d'un total en échéances (la somme vaut toujours le total). Montant unitaire et total dû par élève et
  par année bornés à 1 000 000 000 unités mineures (`AMOUNT_TOO_LARGE`, `TOTAL_TOO_LARGE`) : soldes,
  contraintes SQL et reçus restent dans la plage des entiers.
- **Frais** : inscription, réinscription, scolarité, cantine, transport, examen, divers ; par
  établissement et année, éventuellement un niveau ou une classe ; montant, devise, date d'application,
  obligatoire ou facultatif, activation, **historique** de chaque modification (avant, après, auteur,
  échéancier saisi et échéances calculées compris). Un frais ne se facture qu'à partir de sa date
  d'application (`FEE_NOT_YET_EFFECTIVE` avant).
- **Non-rétroactivité** : chaque échéance copie libellé, date et montant à sa génération ; un nouveau
  montant ne vaut que pour les échéances générées ensuite. L'échéancier d'un frais déjà facturé garde
  son type et son nombre d'échéances.
- **Échéanciers** : annuel, mensuel, trimestriel, personnalisé (somme contrôlée). Génération par élève
  (inscription validée dans le périmètre du frais) ; **jamais deux fois** (unicité élève, frais, rang) ;
  frais facultatif pour les seuls élèves désignés. Élèves verrouillés en exclusif, dans l'ordre de leurs
  identifiants et dans l'établissement du frais, éligibilité relue sous ces verrous : un transfert ou un
  changement de classe simultané n'est jamais facturé sur l'ancienne situation, deux générations se
  suivent élève par élève (cumul jamais dépassé, aucune attente croisée).
- **Statuts** : à venir, partiellement payé, payé, en retard (date limite dépassée et un reste), selon la
  date du jour dans le fuseau de l'établissement. Ajustements signés, motivés, tracés ; jamais sous le
  montant déjà payé. Ajustement d'une échéance et retrait d'un avantage : droit sur l'établissement de
  l'écriture, possibles après un transfert de l'élève.
- **Avantages** : réduction fixe (par échéance), en pourcentage, bourse partielle, exonération totale,
  réduction familiale ; limités à un frais, une catégorie ou tous. Justifiés, accordés par la direction,
  tracés (décision publiée) ; recalculés sur les échéances de l'année ; refusés s'ils créaient un
  trop-perçu. Ils apparaissent distinctement des encaissements.

### Encaissements, reçus et annulations

- **Caisse** : espèces, virement, mobile money **déclaré** (jamais présenté comme vérifié par
  l'opérateur, mention sur le reçu) ; paiement partiel ou couvrant plusieurs échéances (affectation
  explicite, ou de la plus ancienne à la plus récente). Référence obligatoire hors espèces.
- **Anti-doublon** : clé d'idempotence par formulaire (une soumission répétée renvoie le même
  encaissement ; la même clé avec une autre demande, comparée par empreinte complète, répond
  `IDEMPOTENCY_MISMATCH`), référence unique par moyen (index de la base), alerte sur un encaissement semblable de
  moins de deux minutes, à confirmer explicitement.
- **Atomicité** : encaissement, affectations et soldes dans une transaction, sous le verrou exclusif de
  l'élève (deux caisses simultanées pour un même élève se suivent) puis de ses échéances ; numéro de
  reçu par compteur atomique (`PRÉFIXE-AAAA-000001`). Droit de caisse relu sous le verrou de
  l'établissement : une autorisation du secrétariat retirée pendant l'attente n'est jamais utilisée.
  Chaque encaissement écrit sa décision (`school.payment_recorded`) dans sa transaction, publiée au
  journal Suite avec reprise.
- **Reçu PDF** à la demande (garde, permission, aucune adresse directe, `no-store`, journalisé) :
  établissement, numéro, date, élève, classe et année, frais réglés, montant, moyen, référence, solde
  restant figé à l'encaissement, mention de vérification. Français, Arabe (RTL) ou Bilingue. Un reçu
  réédité reste identique au reçu remis : établissement, coordonnées, langue, fuseau, identité de l'élève
  et année sont figés à l'encaissement ; seul le statut d'annulation est courant. Pagination explicite :
  numéro du reçu, en-tête du tableau, filigrane et pied de page répétés ; total et mentions jamais
  coupés ; chaque texte tient sur une ligne logique (retours à la ligne aplatis) et un mot plus large
  que sa colonne est découpé (aussi pour l'arabe, bulletins compris) ; la largeur réservée à chaque mot
  est celle de son dessin, ponctuation détachée comprise.
- **Annulation** : réservée à la direction, motivée ; contrepassation (écriture négative sur les mêmes
  échéances), encaissement initial conservé au statut annulé avec son reçu. Jamais de suppression ni de
  modification directe ; correction par une nouvelle opération (la référence redevient utilisable).
  Le droit suit l'établissement de l'encaissement : il reste annulable après un transfert de l'élève.

### Tableau de bord, impayés, exports

Attendu (dû après réductions et ajustements), encaissé, solde, réductions, échéances en retard, élèves en
impayé, encaissements par mois et par moyen (nets des contrepassations), répartition par niveau et classe
; filtres année, classe, type de frais, période. Impayés triés par retard. Exports CSV et XLSX (impayés,
encaissements) : permission, créneaux et plafond partagés avec les exports élèves, journalisation, en-têtes
dans la langue de l'établissement. Les filtres classe et type de frais s'appliquent aussi à l'export des
encaissements : un encaissement est retenu s'il touche une échéance du type filtré, pour un élève inscrit
dans la classe filtrée, et il est exporté pour son montant total. Attendu, encaissé et solde décrivent la
situation de l'année à ce jour (attendu = encaissé + solde) ; avec un filtre de dates, un indicateur
distinct « encaissé sur la période » (affectations datées, contrepassations comprises, aussi par classe)
s'y ajoute, avec une note explicative. Historique des encaissements et reçus paginé par 100 dans un ordre
total (date, création, identifiant) ; les reçus sont filtrés par la base avant la pagination. Les lignes
d'un reçu suivent un ordre stable (date limite, rang). Les jours filtrés (historique, tableau de bord,
export) et les mois des encaissements s'entendent dans le fuseau de l'établissement, comme les dates des
reçus ; un jour commence à son premier instant local, même quand un changement d'heure supprime minuit.
L'historique est recréé après une annulation : aucune page chargée auparavant ne s'y mêle. En caisse, un
montant d'affectation renseigné mais invalide bloque l'encaissement. Dans les exports, les montants sont des nombres (signés pour les contrepassations), jamais du
texte. Les impayés sont agrégés par la base
(une ligne par élève) et l'export borné avant construction ; limiteur dédié aux exports (30 par
10 minutes et par IP). Écrans des réductions et des impayés :
aucun montant ni aucune saisie avant le chargement de la devise réelle de l'établissement.

### Droits

| Permission                                                           | Rôles                                                            |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `school.finance.read` (situation, échéances, paiements, reçus)       | Direction, comptabilité, secrétariat                             |
| `school.finance.settings` (réglages, frais, échéanciers, génération) | Direction                                                        |
| `school.finance.collect` (encaissement)                              | Direction, comptabilité ; secrétariat si la direction l'autorise |
| `school.finance.benefits` (avantages, ajustements)                   | Direction                                                        |
| `school.finance.cancel` (annulation, contrepassation)                | Direction                                                        |
| `school.finance.reports` (tableau de bord, impayés, exports)         | Direction, comptabilité                                          |

Enseignants et surveillance : aucun accès financier. Parents : vue en lecture seule préparée
(`guardianChargeView`, sans agent ni motif interne) ; aucune route parent ouverte.

### API (`/api/v1/school/finance`)

`GET|PUT settings` ; `GET|POST fees`, `GET|PATCH fees/:id`, `GET fees/:id/history`,
`POST fees/:id/generate` ; `GET students/:id` ; `POST charges/:id/adjust` ; `GET|POST benefits`,
`POST benefits/:id/revoke` ; `GET|POST payments` (liste : `{ items, nextCursor }`, paramètres
`cursor` et `receipts`), `GET payments/:id`, `POST payments/:id/cancel`,
`GET payments/:id/receipt` ; `GET dashboard`, `GET unpaid`, `GET export` ; `GET leavers` (élèves
sortis qui doivent encore une échéance de l'année dans l'établissement, recherche `q` par nom ou
matricule, 50 au plus avec `truncated` invitant à affiner ; proposés à la caisse et à la situation).

### Écrans

`/school/finances` (tableau de bord), `/school/finances/parametres`, `/school/finances/frais`,
`/school/finances/echeanciers`, `/school/finances/eleves`, `/school/finances/caisse`,
`/school/finances/paiements`, `/school/finances/recus`, `/school/finances/impayes`,
`/school/finances/reductions`. Ordinateur et tablette ; langue de l'établissement ; menu Ocall Park
inchangé.

## 12. Sprint 6 : portail parents, présences, communication et notifications

### Audit de l'existant

Réutilisé : authentification Suite (connexion, sessions, réinitialisation du mot de passe), liens
responsables du Sprint 2 (`canViewSchoolInfo`, `canReceiveSms`, `portalUserId` déjà prévu), résultats figés
des validations du Sprint 4 et moteur des bulletins PDF, situation financière et reçus du Sprint 5
(`guardianChargeView`, `receiptSnapshot`), vue des 114 sourates (`quranSurahStates`), journal des décisions,
Service Worker de la PWA. Absents au départ : compte parent (la connexion n'acceptait que membres, comptes
internes et partenaires), présences, annonces, notifications, SMS, notion de « publié aux familles ».

### Comptes parents

- **Compte Suite sans adhésion**, déclaré au cœur de l'authentification par un registre de portails
  (`PortalAccounts`) : le module School s'y inscrit au démarrage, le cœur ne dépend d'aucun module métier.
  Aucune migration de la base Suite (Ocall Park). `/auth/me` renvoie `accountKind: 'guardian'` ; la connexion
  mène à `/parents` ; aucune route du personnel n'est ouverte à ce compte, et inversement.
- **Invitation** par l'établissement (`school.portal.manage`) : jeton haché, usage unique, 7 jours, révocable ;
  une nouvelle invitation révoque la précédente (opérations sérialisées sur la fiche responsable, même ordre
  de verrouillage que l'activation et les révocations). Le lien n'est affiché qu'une fois au personnel et peut partir
  par SMS (adresse publique `SCHOOL_PORTAL_BASE_URL`). Refusée si le responsable n'est autorisé à suivre aucun
  enfant (`NO_AUTHORIZED_CHILD`).
- **Activation** publique (`/parents/activation`, limitée en débit) : vérification sans consommation, puis
  consommation sous verrou ; création du compte (identifiant de l'organisation) ou, pour un compte existant,
  nouveau mot de passe et sessions fermées. Échec de la partie School : le compte Suite créé est désactivé.
  L'activation est journalisée dans la transaction School puis publiée au journal Suite (reprise en cas
  d'échec) : une erreur de journalisation ne désactive jamais un compte activé.
- **Enfants visibles** : uniquement les liens que l'établissement a autorisés (`canViewSchoolInfo`), élève du
  même établissement que la fiche, hors transfert, organisation non suspendue dans Ocall Suite, contrat
  School encore actif et couvrant l'établissement (lecture seule : aucune soumission). Un parent ne rattache jamais seul un élève. Plusieurs enfants par compte, plusieurs comptes par
  enfant.
- **Révocation** : retrait du rattachement (lien du Sprint 2) ou de l'accès (`portalUserId` retiré ; le compte
  de l'organisation est révoqué quand il ne suit plus aucune fiche). Effet à la requête suivante : la session
  relit le compte à chaque requête.

### Présences

- Appel par classe, date et séance (`JOURNEE` par défaut, code court sinon) ; **jamais deux appels pour une
  même séance** (unicité en base, création sous verrou). Date ni future (fuseau de l'établissement) ni hors de
  l'année ; année clôturée refusée.
- Enregistrement collectif ou individuel ; **correction motivée** obligatoire pour un relevé existant
  (`CORRECTION_REASON_REQUIRED`) ; historique en ajout seul (saisie et corrections, auteur, motif, valeurs
  avant et après du statut, des minutes de retard et de la note). L'écran d'appel renvoie les notes existantes
  et envoie une grande classe par lots de 200. Un élève relevé puis sorti de la classe reste affiché et
  corrigeable ; une nouvelle saisie exige l'effectif actuel (pas d'effectif reconstitué à une date passée).
- L'enseignant ne fait l'appel et ne consulte que **ses classes** (affectation revérifiée et tenue sous verrou
  pendant l'enregistrement) ; l'historique d'un élève ne lui montre que les relevés de ses classes, sans les
  justificatifs. Surveillant, secrétariat et direction dans leur périmètre (l'historique d'un élève transféré
  exclut les relevés et justificatifs des établissements hors périmètre). Statistiques par élève et par
  classe (un retard compte comme une présence), suivi des retards ; statistiques individuelles agrégées sur
  toute la période, la liste affichée étant limitée ; les statistiques de classe incluent les élèves sortis (`truncated`, signalé aux parents).
- **Justificatifs** : motif transmis par le parent (en attente) ou saisi par l'établissement (accepté) ; un mois
  au plus, au plus un mois à l'avance. Accepté, il justifie les absences relevées sur sa période et celles
  saisies ensuite, **dans son établissement seulement** (après un transfert, jamais celles du nouvel
  établissement) ; l'appel et l'acceptation prennent un même verrou par élève (ordre trié), sans fenêtre.

### Résultats, bulletins, finances et Coran pour les parents

- **Publication aux familles** (`school.results.publish`, direction) des résultats validés d'une classe pour une
  période, liée à cette validation : rouverts, ils disparaissent du portail jusqu'à une nouvelle validation et
  publication. Les parents voient moyennes, notes des évaluations de la période publiée, rang si
  l'établissement l'affiche, et le bulletin PDF de leur enfant seulement (jamais un brouillon ni des notes non
  validées). Publication, validation et notes sont lues dans un même instantané.
- **Finances** en lecture seule : échéances (sans motif interne), paiements, reçus PDF, soldes ; aucun paiement
  en ligne ni encaissement.
- **Coran** : seulement si le module est actif pour l'établissement (sinon introuvable) ; progression, 114
  sourates, évaluations, et observations des enseignants **uniquement celles qu'ils ont autorisées**
  (`remarkShared`, nouvelle case à la saisie).

### Annonces, notifications et SMS

- **Annonces** : brouillon, publication, archivage, expiration facultative, historique. Publics : tout
  l'établissement, des classes, des élèves, des responsables choisis ; l'enseignant (`school.announcements.class`)
  ne publie que pour ses classes, revérifiées à la publication. Contenu, public et cibles relus sous le
  verrou du brouillon au moment de publier. Les parents ne voient que ce qui vise leurs enfants (50 par page).
- **Notifications internes** : nouvelle annonce, absence, retard, bulletin publié, nouvelle échéance, échéance
  impayée (contrôle horaire, parcours par curseur, échéance relue sous verrou, notification et SMS d'une échéance écrits ensemble).
  Destinataires : responsables et élèves de l'établissement du fait seulement. Les notifications de nouvelles échéances sont écrites dans
  la transaction de génération. Une seule notification par fait et par compte (clé du fait unique) ; non
  lues, lecture, tout marquer lu, pagination, lien vers la page concernée ; limitées aux enfants autorisés aujourd'hui (une notification d'annonce reste
  consultable tant que l'annonce vise encore l'un d'eux).
- **SMS** : désactivés par défaut, activés par la direction. File d'attente en base, envoi hors transaction,
  tentatives bornées (5, aussi en base) à délai croissant ; bail expiré après la dernière tentative : échec
  définitif, jamais une tentative de plus ; destinataire relu avant l'envoi (lien retiré, SMS refusés ou désactivés, numéro changé : message annulé) ; échec définitif conservé, historique aux numéros masqués (filtre par statut, pagination). Textes
  courts sans note, montant ni motif (prénom et date au plus). Fournisseur par adaptateur
  (`SCHOOL_SMS_PROVIDER`, clé `SCHOOL_SMS_API_KEY` lue dans l'environnement, jamais dans le code) : seul le
  fournisseur **simulé** est livré, aucun SMS réel n'est envoyé.

### Modèles et migration

Migration additive `20261109000000_portail_parents_presences_communication` : 13 tables (`SchoolPortalAccount`,
`SchoolGuardianInvitation`, `SchoolAttendanceSession`, `SchoolAttendanceRecord`, `SchoolAttendanceEvent`,
`SchoolAbsenceJustification`, `SchoolResultPublication`, `SchoolAnnouncement`, `SchoolAnnouncementTarget`,
`SchoolAnnouncementEvent`, `SchoolNotification`, `SchoolSmsSettings`, `SchoolSmsMessage`) et la colonne
`SchoolQuranEvaluation.remarkShared`. Contraintes écrites à la main : format de séance, retard réservé au
statut « en retard », période de justificatif, une seule publication active par classe et période, une cible
par destinataire, tentatives SMS bornées. Vérifiée par `prisma migrate diff` (différence vide).

### Droits

| Permission                                          | Rôles                                                          |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `school.portal.manage` (invitations, accès)         | Direction, secrétariat                                         |
| `school.results.publish`                            | Direction                                                      |
| `school.attendance.read` / `school.attendance.take` | Direction, secrétariat, surveillant ; enseignant (ses classes) |
| `school.attendance.justify`                         | Direction, secrétariat, surveillant                            |
| `school.announcements.manage`                       | Direction, secrétariat                                         |
| `school.announcements.class`                        | Direction, secrétariat ; enseignant (ses classes)              |
| `school.sms.manage`                                 | Direction                                                      |

Parents : consultation des enfants autorisés, motif d'absence, annonces et notifications, sur leurs seules
routes (`/api/v1/school/portal`).

### API

Établissement : `GET guardians/:id/portal`, `POST guardians/:id/portal/invitations`,
`POST guardians/:id/portal/invitations/:id/revoke`, `POST guardians/:id/portal/revoke` ;
`GET|PUT attendance/sheet`, `GET attendance/records/:id/history`, `GET attendance/students/:id`,
`GET attendance/stats`, `GET|POST attendance/justifications`, `POST attendance/justifications/:id/review` ;
`GET|POST results/publications`, `POST results/publications/:id/withdraw` ; `GET|POST announcements`,
`GET|PUT announcements/:id`, `POST announcements/:id/publish|archive` ; `GET|PUT sms/settings`,
`GET sms/messages`. Public : `POST portal/activation/check`, `POST portal/activation`. Parents :
`GET portal/dashboard`, `GET portal/children`, `GET portal/children/:id/attendance`,
`POST portal/children/:id/justifications`, `GET portal/children/:id/results`,
`GET portal/children/:id/report-cards/:publicationId`, `GET portal/children/:id/finance`,
`GET portal/children/:id/payments/:id/receipt`, `GET portal/children/:id/quran`, `GET portal/announcements`,
`GET portal/notifications`, `POST portal/notifications/:id/read`, `POST portal/notifications/read-all`.

### Écrans

Parents (`/parents`, PWA installable, manifeste propre, langue de l'établissement de l'enfant, arabe de
droite à gauche) : activation, tableau de bord, mes enfants, présences et absences (motif), résultats,
bulletins, situation financière, mémorisation du Coran, annonces, notifications, profil ; connexion par
`/connexion`. Établissement : `/school/portail-parents`, `/school/presences`, `/school/presences/justificatifs`,
`/school/communication` (annonces, SMS), `/school/publications`.

## 13. Sprint 7 : emplois du temps, salles, calendrier scolaire et examens

### Audit de l'existant

Réutilisé : années et périodes (`SchoolYear`, `AcademicPeriod`), classes et groupes, matières et horaire
indicatif par niveau, affectations d'enseignement du Sprint 3B (seule source « enseignant × classe ×
matière »), évaluations du Sprint 4 (seule source des notes), fuseau et langue de l'établissement, portail
parents et centre de notifications du Sprint 6, journal des décisions. Absents au départ : salles, emplois
du temps, calendrier d'événements, horaires d'examens, indisponibilités. Aucun compte élève : les élèves
consultent par le portail parents. Le centre de notifications reste celui des familles.

### Choix validés

1. **Semaine type versionnée** : une version par classe et par période de validité, brouillon puis
   publication ; annulation ponctuelle d'un cours par exception datée.
2. **Examens** : programmation dans une table liée à l'évaluation du Sprint 4 (aucun second système de notes).
3. **Indisponibilités** : fermetures du calendrier (vacances, fériés, journées pédagogiques) et
   indisponibilités hebdomadaires de chaque enseignant.
4. **Notifications** : familles par le centre existant ; enseignants par le fil des changements publiés.

### Emplois du temps

- Version : classe, validité dans l'année (année non clôturée), libellé, copie d'une version de la classe
  (semaine type) ; un seul brouillon par classe (index partiel). Suppression d'un brouillon seulement.
- Créneau : jour ISO (lundi à dimanche, chaque établissement choisit ses jours), début et fin (fin après le
  début, minuit accepté), cours (matière, enseignant, groupe et salle facultatifs) ou pause (récréation,
  déjeuner), contrainte SQL comprise. L'enseignant d'un cours doit avoir une affectation active pour la
  matière dans la classe (ou le groupe).
- **Conflits refusés** à la création, à la modification et à la publication : chevauchement dans la classe
  (deux groupes différents peuvent avoir cours en même temps), même enseignant dans une autre classe (y
  compris d'un autre établissement du groupe), même salle, indisponibilité de l'enseignant, affectation
  terminée. Chaque refus détaille les créneaux en cause (jour, heures, classe) en français ou en arabe.
- Vérification sans publier, puis **publication par la direction** (`school.planning.publish`) : tout est
  revérifié sous verrou ; les versions publiées de la classe qui la recouvrent sont raccourcies (ou
  archivées si elles commencent après elle) ; une version qui la dépasserait par la fin est refusée.
- Une version publiée reste modifiable (créneau ajouté, modifié, supprimé) avec les mêmes contrôles ; les
  familles sont notifiées. Archivage d'une version publiée. Historique en ajout seul (création, créneaux,
  publication, raccourcissement, archivage, annulations).
- **Concurrence** : toute écriture du planning (créneaux, publication, indisponibilités, examens,
  événements) prend un verrou consultatif par organisation : deux écritures incompatibles se suivent, la
  seconde voit la première.

### Vues

Semaine (lundi à dimanche, navigation) d'une classe, d'un enseignant (planning personnel, examens
surveillés, fil des changements publiés des 30 derniers jours) et d'une salle (occupation). Chaque jour :
la version publiée valable ce jour-là, cours annulés (motif), jours de fermeture applicables à la classe,
examens publiés.

### Salles

Nom (unique dans l'établissement), nom arabe, capacité, activation ; jamais supprimées. Facultatives : un
établissement peut n'en gérer aucune.

### Calendrier scolaire

Année et périodes affichées depuis le Sprint 3A ; événements propres à chaque établissement (aucun
calendrier national supposé) : vacances, jours fériés, journées pédagogiques, sessions d'examens, réunions
parents-enseignants, sorties, événements de l'établissement. Titre (et arabe), période, horaires
facultatifs, public (établissement, classes, groupes), visibilité (personnel, ou personnel et familles),
brouillon, publication, annulation. Un événement important visible des familles les notifie. Les fermetures
publiées suspendent les cours ces jours-là et refusent un examen. Vue mensuelle (grille sur grand écran,
liste sur mobile).

### Examens

Programmation d'une évaluation du Sprint 4 : date (dans l'année, hors fermeture de la classe), heure, durée
(5 minutes à 8 heures), salle et surveillant facultatifs ; conflits refusés avec un autre examen de la même
classe (groupes distincts exceptés), de la même salle ou du même surveillant. Publiée, elle apparaît dans
les semaines et notifie les familles ; un changement d'horaire publié et une annulation les notifient
aussi. Les notes restent saisies dans l'évaluation.

### Portail parents

Emploi du temps de l'enfant (sa classe, ses groupes seulement, cours annulés, jours sans cours, examens
publiés) et calendrier des familles (événements publiés visibles des familles visant l'établissement, la
classe ou un groupe de l'enfant). Notifications : emploi du temps publié ou modifié, cours annulé, examen
publié, déplacé ou annulé, événement important ; une par fait et par enfant.

### Droits

| Permission                | Rôles                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `school.planning.read`    | Tout le personnel ; l'enseignant, ses classes et son planning           |
| `school.planning.manage`  | Direction, secrétariat (brouillons, créneaux, salles, indisponibilités) |
| `school.planning.publish` | Direction                                                               |
| `school.calendar.manage`  | Direction, secrétariat                                                  |
| `school.exams.manage`     | Direction, secrétariat                                                  |

### Modèles et migration

Migration additive `20261110000000_planning_emplois_du_temps_calendrier` : 9 tables (`SchoolRoom`,
`SchoolTimetable`, `SchoolTimetableSlot`, `SchoolTimetableEvent`, `SchoolLessonException`,
`SchoolTeacherUnavailability`, `SchoolCalendarEvent`, `SchoolCalendarEventTarget`, `SchoolExamSchedule`),
6 énumérations, 4 nouveaux types de notification. Contraintes écrites à la main : validité ordonnée, un
brouillon par classe, heures des créneaux et des indisponibilités, cours complet ou pause sans ressource,
capacité positive, période et horaires des événements, une cible par ligne, horaires et durée des examens.
Différence avec le schéma vérifiée vide. Index par établissement, classe, enseignant, salle et période.

### API

Personnel : `GET|POST rooms`, `PATCH rooms/:id`, `GET rooms/:id/week` ; `GET|POST timetables`,
`GET|PATCH|DELETE timetables/:id`, `POST timetables/:id/slots`, `PUT|DELETE timetables/:id/slots/:slotId`,
`POST timetables/:id/check|publish|archive`, `POST timetable-slots/:id/cancellations`,
`DELETE timetable-slots/:id/cancellations/:date` ; `GET planning/class-week`, `GET planning/teacher-week` ;
`GET|POST teacher-unavailability`, `DELETE teacher-unavailability/:id` ; `GET calendar`,
`GET|PUT calendar/events/:id`, `POST calendar/events`, `POST calendar/events/:id/publish|cancel` ;
`GET|POST exams`, `PUT exams/:id`, `POST exams/:id/publish|cancel`. Parents :
`GET portal/children/:id/planning`, `GET portal/calendar`.

### Écrans

Personnel : `/school/emplois-du-temps` (semaine publiée, versions, créneaux, conflits, publication,
historique, annulation d'un cours, indisponibilités), `/school/mon-planning`, `/school/calendrier`,
`/school/examens`, `/school/salles`. Parents : `/parents/enfants/[id]/planning`, `/parents/calendrier`.
Français et arabe (RTL), un seul jeu de composants.

## 14. Limites actuelles

- Réserves P3 de l'audit du Sprint 6 (non bloquantes) : reprise de l'écran d'appel quand la réponse du
  premier lot se perd, liste des justificatifs limitée à 200 sans pagination, saisie modifiée pendant l'envoi
  des lots non envoyée.
- Appel : pas d'effectif reconstitué à une date passée ; une saisie rétroactive utilise l'effectif actuel.
- Un employé Park existant ne peut pas encore recevoir de rôle School : il faut un compte dédié.
- L'horaire hebdomadaire par niveau reste indicatif : l'emploi du temps ne contrôle pas le volume horaire.
- Planning : pas de remplacement ponctuel d'un enseignant ni de déplacement d'un cours à une date (seule
  l'annulation datée existe) ; pas de génération automatique d'emploi du temps ; un brouillon d'une autre
  classe n'est comparé qu'à sa publication.
- Écrans : une fin de créneau ou d'indisponibilité à minuit (`24:00`, acceptée par l'API) n'est pas
  saisissable dans les champs horaires du navigateur (réserve P3 de l'audit du Sprint 7).
- Archivage manuel d'une version publiée encore applicable, sans remplacement : ses cours disparaissent des
  vues sans notification aux familles ni fait dans le fil des enseignants (réserve P3 de l'audit du
  Sprint 7 ; le remplacement par une nouvelle version publiée, lui, est notifié).
- Fil des enseignants : un enseignant dont tous les cours disparaissent d'une classe lors du remplacement
  par une nouvelle version publiée n'y voit pas ce remplacement (son planning, lui, est à jour ; les
  familles sont notifiées) — réserve P3 de l'audit du Sprint 7.
- Examens : le surveillant n'est pas comparé à ses propres cours. La programmation fixe la date de
  l'évaluation (dans sa période, tant que les résultats ne sont pas validés).
- L'enseignant d'un groupe voit la liste restreinte de toute la classe (choix validé au cadrage).
- Pas de logo. Modèles de documents personnalisés non livrés : le bulletin a une mise en page unique.
- SMS : seul le fournisseur simulé est livré (aucun envoi réel) ; un fournisseur réel s'ajoute par un
  adaptateur. Pas de réinitialisation du mot de passe par SMS : un parent sans e-mail reçoit une nouvelle
  invitation de l'établissement.
- Un membre du personnel qui est aussi parent utilise un compte distinct pour le portail.
- Le module coranique reste disponible aux seuls établissements en Bilingue (règle du Sprint 4), pour le
  personnel comme pour les parents.
- Aucun antivirus : un contrôle du type réel et du contenu actif des PDF, et un téléchargement en pièce
  jointe uniquement. Un PDF à flux compressé peut masquer du contenu actif.
- Pas de purge automatique des documents : les durées légales de conservation restent à fixer par pays.
- Les documents School ne sont pas comptés dans le quota de stockage de l'organisation.
- Import synchrone, limité à 1 000 lignes par fichier.
- PWA : espace client (`/app`) et portail parents (`/parents`) ; les écrans School du personnel n’en sont pas.
- Messages de validation détaillés de l'API (champs refusés) et erreurs ligne par ligne de l'import
  restent en français, y compris pour un établissement en Arabe.
- Les dates de contrat s'apprécient en UTC.
- La conformité des données de mineurs doit être validée pays par pays avant toute vraie donnée.
- Réserves P3 de cohérence (audit Codex 3B, non bloquantes) : la liste d'une classe (roster), la liste des
  inscriptions, l'historique et le tableau de bord des élèves et la langue des exports peuvent mêler deux
  états proches lors d'une modification simultanée, sans exposer de données hors périmètre.
- « Mes classes » et la garde d'accès n'ont pas de test d'entrelacement dédié : leur fenêtre (requêtes
  internes de Prisma) est supprimée par construction (instantané, instruction unique).
- Bulletins : générés à la demande, jamais archivés ; un bulletin réédité après une correction des noms
  reflète les noms actuels (les résultats, eux, restent figés par la validation). Pas de moyenne annuelle ni
  de récapitulatif sur plusieurs périodes. Édition de toute une classe synchrone.
- Un élève sorti de la classe après la validation n’apparaît plus dans ses bulletins (liste des élèves =
  inscriptions validées dans la classe).
- Ordre du texte arabe dans les PDF : version réduite de l’algorithme bidirectionnel, suffisante pour des
  noms, libellés et appréciations ; un texte qui mêle longuement arabe et latin peut être mal ordonné.
- Mémorisation du Coran : données d’enseignement religieux de mineurs (RGPD article 9 et lois équivalentes) ;
  validation juridique et information des familles requises avant toute vraie donnée. Pas de suivi verset par
  verset, d’analyse audio ni d’évaluation automatique (hors périmètre du Sprint 4).
- Le lien de menu « Mémorisation du Coran » reste visible (menu School statique) ; hors module actif, la page
  répond « introuvable » aux rôles autres que la direction.
- Finances : pas d’intégration Wave, Orange Money ni paiement en ligne (hors périmètre) ; un mobile money
  reste déclaré. Pas de comptabilité générale ni de clôture de caisse journalière. Une seule devise par
  établissement, verrouillée dès qu’un frais ou une réduction fixe existe (même retirée). Pas d’avoir ni
  de trop-perçu : un excédent n’est jamais encaissé.
- La caisse n’est proposée qu’à qui peut encaisser (comptabilité, direction, secrétariat autorisé) ; un
  élève sorti sans transfert y reste accessible tant qu’il a des échéances dans l’établissement.
- Un élève transféré dans un autre établissement ne peut plus être encaissé par l’ancien (arriérés) ; ses
  encaissements passés y restent consultables et annulables.
- Pas de versions tarifaires : un frais porte un seul montant à la fois ; un tarif dont la date
  d’application est future ne se génère qu’à partir de cette date (créer un frais distinct pour un
  changement programmé).
- La réduction fixe s’applique à chaque échéance concernée ; un taux s’arrondit à l’unité inférieure.
- Les montants d’export sont en unités mineures de la devise.
