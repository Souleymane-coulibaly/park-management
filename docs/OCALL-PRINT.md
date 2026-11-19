# Ocall Print — cartes scolaires et badges (moteur commun)

Ocall Print personnalise, commande et suit les cartes. Il couvre deux types de carte : la carte scolaire
d'un élève et le badge d'un membre du personnel. L'impression physique est centralisée dans l'**atelier
Ocall de Bamako**.

Print est un **module commun et indépendant** :

- **Ocall School** est la première application source ;
- **Ocall Parc** (cartes de pass) et **Sabatii** (carte QR) s'y brancheront de la même façon ;
- un **accès autonome gratuit** est ouvert aux écoles et aux entreprises qui n'ont pas School.

Lots livrés :

- **PR-1** : socle (modèles, moteur de rendu, cartes, QR) ;
- **PR-2** : commandes, atelier, encaissement, purge ;
- **SC-1** : données School ;
- **SC-2** : écrans ;
- **SC-3** : recette.

## 1. Décisions (19/11/2026)

| N°  | Décision                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module commun et indépendant, réutilisable par School, Parc et Sabatii                                                                                           |
| 2   | Impression centralisée dans l'atelier Ocall de Bamako                                                                                                            |
| 3   | Badges du personnel **avec ou sans compte** : enseignants, administration, gardiens, cuisine, autres agents                                                      |
| 4   | **3 000 FCFA** par carte scolaire ou par badge. Prix unitaire, quantité et montant total sont affichés sur chaque commande, et le prix est figé dans la commande |
| 5   | Paiement **en espèces à la livraison** (V1), suivi administratif du règlement, **aucun paiement en ligne**                                                       |
| 6   | Fichiers de production conservés **90 jours** après la clôture, puis purgés automatiquement (section 6)                                                          |
| 7   | QR sécurisé, vérifiable seulement par des utilisateurs autorisés, sans exposition publique des données                                                           |
| 8   | Photo **obligatoire pour commander**, facultative pour l'inscription scolaire                                                                                    |
| 9   | Photos **réencodées**, métadonnées EXIF et GPS supprimées                                                                                                        |
| 10  | Accès autonome **gratuit** pour les organisations non abonnées à School                                                                                          |
| 11  | Rôle interne **Imprimeur** limité à la production, avec une supervision centrale depuis le Super Admin                                                           |
| 12  | Reprise des fiches et des photos de l'accès autonome à l'activation de School, **sans doublon**                                                                  |

## 2. Architecture

```
 Ocall School ─┐  PRINT_GATEWAY (common/integration/print-gateway.ts)  ┌─ accès autonome /ocall-print
 (Parc, Sabatii)┘                         │                            │
                      ┌───────────────────┴─ module ocall-print ───────┴──────────────┐
                      │ modèles versionnés · rendu PDF/SVG CR80 · cartes · QR signés  │
                      │ commandes · lignes figées · atelier · encaissement · purge     │
                      └──────────────────────── base Print distincte ─────────────────┘
```

### Base de données

- **Base dédiée** : `@ocall/print-database`, activée par `PRINT_ENABLED`, `PRINT_DATABASE_URL` et `PRINT_DIRECT_URL`.
- **Séparation** : la base doit être distincte des bases Suite, School, Facture et Stock. Le contrôle est fait au démarrage et à la migration.
- **Liens entre bases** : aucune clé étrangère. `organizationId`, `scopeId` (l'établissement School) et `holderId` (l'élève ou le membre du personnel) sont contrôlés par l'API.
- **Isolation dans la base** : chaque lien interne passe par une clé composée `(organizationId, id)`.

### Frontières du code

- Le module Print n'importe aucun module métier.
- Aucun module n'importe Print autrement que par `PRINT_GATEWAY`.
- Les deux règles sont vérifiées par `print-boundaries.spec.ts`.

### Partage du travail entre School et Print

- **School** contrôle les droits et le périmètre des établissements. Il fournit les données de la carte au format fermé `ocall-print/card@1` et la photo.
- **Print** fait tout le reste. Il n'y a **aucun code d'impression propre à School**.

### Moteur de rendu

- Une seule mise en page, calculée en points au format CR80 (85,6 × 54 mm, paysage ou portrait), produit des primitives.
- Ces primitives sont dessinées :
  - en **PDF** : bon à tirer A4, et fichier de production CR80 recto verso, une page par face ;
  - en **SVG** : aperçu, affiché comme image, donc sans script possible.
- Polices Noto embarquées. Le nom en arabe est mis en ordre de droite à gauche.

## 3. Données

| Table (base Print)                      | Rôle                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PrintTemplate`, `PrintTemplateVersion` | Modèle et versions : une commande garde sa version                                                                                                                                      |
| `PrintPerson`                           | Fiches de l'accès autonome ; `transferredApp` et `transferredId` après reprise par School                                                                                               |
| `PrintCard`                             | Carte : numéro opaque, état `ACTIVE` ou `REVOKED`, remplacement. **Une seule carte active par titulaire** (index unique partiel)                                                        |
| `PrintOrder`, `PrintOrderItem`          | Commande au prix figé ; lignes figées (`data` au format `card@1`, photo copiée). **Une carte n'est imprimée qu'une fois** (index unique partiel sur les lignes à imprimer ou imprimées) |
| `PrintOrderEvent`                       | Journal en ajout seul (déclencheur)                                                                                                                                                     |
| `PrintCounter`                          | Numéros `IMP-AAAA-NNNNN`, compteur atomique                                                                                                                                             |

Base School (migration additive `20261220000000_school_cartes_personnel`) :

- **`SchoolStaff`** : fiche du personnel avec ou sans compte. Elle porte :
  - le numéro `P-000001`, unique dans le client ;
  - la catégorie et la fonction ;
  - la photo réencodée ;
  - le lien facultatif et unique vers un compte School.
- **`SchoolStudent.cardPhotoDocumentId`** : photo du dossier retenue pour la carte. Par défaut, c'est la plus récente.
- **`printPersonId`** sur l'élève et sur le membre du personnel : lien unique de reprise d'une fiche Print.

Base Suite :

- **Énumération** : valeur `PRINT_OPERATOR` ajoutée à `PlatformRole` (migration additive).

## 4. Droits

| Qui                                                   | Accès                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Accès autonome (`/ocall-print`)                       | Propriétaire et administrateurs de l'organisation, **sans abonnement**, exemptés de la lecture seule Park |
| School : direction (groupe, établissement)            | Cartes, modèles, personnel, **commande**, vérification                                                    |
| School : secrétariat                                  | Personnel, photos, modèles, cartes, vérification ; **pas de commande**                                    |
| School : surveillant                                  | Consultation des cartes et du personnel, vérification à l'entrée                                          |
| School : enseignant, comptable                        | Aucun                                                                                                     |
| Reprise des fiches Print dans School                  | Direction du groupe seulement (les fiches autonomes couvrent toute l'organisation)                        |
| Imprimeur (`PRINT_OPERATOR`, double authentification) | File des commandes, détail, étapes, refus, fichier de production, encaissement                            |
| Propriétaire et administrateurs de la plateforme      | En plus : supervision, annulation d'un règlement, purge manuelle                                          |

Le périmètre School est toujours celui de l'utilisateur, c'est-à-dire ses établissements et ses contrats. Une carte, une commande ou un modèle d'un autre établissement ou d'une autre organisation répond « introuvable ».

## 5. Commandes

- **États** : envoyée → acceptée → en production → prête → livrée, plus annulée et refusée.
- **Côté client** : l'annulation est possible avant la production.
- **Côté atelier** :
  - refuser une carte (photo illisible…) ou toute la commande avant la production ;
  - les étapes se suivent dans l'ordre ;
  - au passage à « prête », les cartes sont marquées imprimées.
- **Montant dû** : prix unitaire × cartes à imprimer ou imprimées. Une carte refusée, annulée ou révoquée avant la production n'est pas due.
- **Encaissement** :
  - en espèces, à la livraison (commande prête ou livrée), au montant exact, avec la référence du reçu ;
  - l'annulation d'un règlement est réservée à la supervision ;
  - chaque action est inscrite au journal de la commande **et** au journal d'audit de la plateforme.
- **Envoi idempotent** : une clé d'envoi est tirée par le navigateur. Une reprise après coupure ou un double clic rend la même commande. Deux commandes simultanées d'une même carte : une seule passe (index unique).
- **Révocation d'une carte** (perte, départ, remplacement) : ses lignes encore à imprimer sont retirées des commandes non commencées, et une commande vidée est annulée.

## 6. Politique de conservation et de purge (décision 6)

- **Purgé 90 jours après la clôture** d'une commande (livraison, annulation ou refus) :
  - les **fichiers de production** : photos copiées dans le stockage Print ;
  - les **données nominatives figées** des lignes : nom, données de la carte.
- **Conservé pour le suivi administratif** :
  - numéro, établissement, modèle et version ;
  - quantités, prix unitaire, montants ;
  - règlement : montant, date, référence du reçu ;
  - états et dates ;
  - numéros de carte ;
  - journal de la commande et journal d'audit.
- **Fonctionnement** : la purge tourne toutes les 6 heures (`PrintRetentionService`).
  - Une seule instance à la fois : verrou à bail `print-retention` dans la Suite.
  - Historique dans `SuiteJobRun`.
  - Chaque commande est traitée en une transaction, puis ses fichiers sont supprimés : une reprise après panne termine le travail.
  - La supervision peut la lancer à la main (`POST /platform/print/retention/run`).
- **Non concernés** : les fiches et photos de l'accès autonome et des dossiers School. Elles suivent la vie de la fiche, qui appartient au client.

## 7. QR et vérification (décision 7)

- **Format** : `OCP1.<numéro>.<signature>`.
- **Numéro** : 12 caractères aléatoires, sans caractère ambigu, sans aucune donnée personnelle.
- **Signature** : HMAC-SHA256 tronqué à 128 bits. La clé est dérivée de la clé du serveur et propre à Print ; elle n'est jamais stockée.
- **Lecture** :
  - **pas de page publique** : la lecture exige un utilisateur connecté et autorisé ;
  - School ne reconnaît que les cartes School de **ses** établissements ;
  - une carte est **valide** seulement si elle est active **et** si son titulaire est toujours actif dans l'établissement de la carte (élève inscrit, membre du personnel actif) ;
  - un QR falsifié, inconnu ou d'une autre organisation répond « carte inconnue », sans aucun détail.

## 8. Photos (décisions 8 et 9)

- **Contrôle** : le type réel est lu dans le contenu (JPEG, PNG ou WebP ; jamais SVG ni GIF). Taille maximale : 8 Mo.
- **Réencodage** par Sharp, orientation appliquée, **sans aucune métadonnée** (EXIF, GPS, appareil, profil). Le code est commun, dans `common/images/image-reencode.ts`.
- **Photos d'élèves dans School** : les nouvelles photos du dossier sont désormais réencodées en JPEG ; les anciennes photos restent telles quelles en base. Une image illisible est refusée.
- **Dimensions minimales** :
  - pour une carte ou un badge : 200 × 240 pixels ;
  - pour une photo du dossier School : 64 × 64 pixels.
- **Commande** : la photo est obligatoire (`PRINT_PHOTO_REQUIRED`, avec la liste des cartes concernées). Elle est réencodée **de nouveau** avant d'être copiée dans le stockage Print : une ancienne photo non réencodée ne part jamais à l'atelier avec ses métadonnées.

## 9. Reprise à l'activation de School (décision 12)

- **Accès** : la direction du groupe lance la reprise depuis School (Cartes → Reprise Ocall Print).
- **Pour chaque fiche Print** :
  - une fiche School déjà liée est retrouvée ;
  - sinon, la même personne est rattachée : élève de même nom, prénom et date de naissance, ou membre du personnel de même nom ;
  - sinon, la fiche est créée avec sa photo.
- **Cartes** : elles passent à School avec leur numéro et leur QR, donc **aucune réimpression**.
- **Relance** : une relance ne recrée rien. Un élève sans date de naissance n'est pas repris, et la raison est affichée.

## 10. Exploitation

- **Activation** :
  - créer la base Print (Neon, base distincte) ;
  - renseigner `PRINT_ENABLED=true`, `PRINT_DATABASE_URL` et `PRINT_DIRECT_URL` ;
  - au déploiement, le pré-déploiement Railway applique `pnpm db:print:migrate:deploy`, sans effet si Print est désactivé.
- **Stockage** : les photos et logos vont dans le stockage privé commun (`org/<organisation>/…`). En préproduction, le stockage R2 est hors service (DT-001), donc les envois de photos y échouent.
- **Imprimeur** : compte interne avec le rôle « Imprimeur (atelier Ocall Print) », créé par le propriétaire de la plateforme. Double authentification obligatoire.

## 11. Limites connues de la V1

- **Prix** : unique (3 000 FCFA), défini dans le code. Il est figé dans chaque commande.
- **Paiement** : en espèces seulement.
- **Langue** : les écrans des cartes sont en français. Seul l'onglet « Carte » de la fiche élève est aussi traduit en arabe.
- **Connexion à Ocall Parc** : les cartes de pass utilisent toujours `ocall-print/pass-card@1`. Leur branchement sur le moteur commun est un lot distinct.
