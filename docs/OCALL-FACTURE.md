# Ocall Facture

Application métier d'Ocall Suite : clients, devis, pro forma, bons de commande, factures, interventions
et notifications de rendez-vous. Développée dans le monorepo, sur le socle Suite (identité,
organisations, abonnements, Super Admin). Ses fonctionnalités et ses données métier sont séparées de
celles de Park et de School.

Proposition d'architecture et décisions : `ocall-audits/proposition-architecture-ocall-facture-v1.md`
(hors dépôt).

| Sprint             | Contenu                                                              | État                |
| ------------------ | -------------------------------------------------------------------- | ------------------- |
| **F0 — Socle**     | Base, accès, rôles, identité légale, TVA, numérotation, logo, PDF    | Livré (ce document) |
| F1 — Commercial    | Clients, catalogue, devis, pro forma, bons de commande               | À venir             |
| F2 — Facturation   | Factures émises figées, avoirs, encaissements                        | À venir             |
| F3 — Interventions | Techniciens, planning, équipements, temps, pièces, photos, signature | À venir             |
| F4 — Rendez-vous   | Notifications WhatsApp (fournisseur simulé en test)                  | À venir             |
| F5 — Site vitrine  | Site public, formulaires de demande, domaines, SEO local             | À venir             |

## 1. Architecture

```
Navigateur ─ Next.js (/suite, /facture)
                │
             API NestJS, un seul service
             └─ modules/facture        domaine Facture, aucun import des modules Park ni School
                │                                  │
     Base Ocall Suite (identité, organisations,    Base Ocall Facture (identité légale, membres,
     abonnements, essais, journal d'audit)         numérotation ; documents aux sprints suivants)
```

- **Base PostgreSQL distincte** (`@ocall/facture-database`) : schéma Prisma, migrations et client
  propres, distincte des bases Suite et School (refus au démarrage, à la migration et dans les tests).
  Aucune clé étrangère entre bases : l'API contrôle `organizationId` et `userId`.
- **Connexion à la demande** : une panne de la base Facture n'arrête ni l'API, ni Park, ni School.
- **Désactivée par défaut** : sans `FACTURE_ENABLED=true`, l'application est absente du portail et ses
  routes répondent 404 ; la migration de déploiement ne fait rien.
- **Frontières vérifiées par un test** : `modules/facture` n'importe que le socle commun et
  `organizations` ; aucun autre module n'importe Facture.

## 2. Accès

Accès par **abonnement et essai** (socle S1), recalculé à chaque requête (`common/app-access.ts`) :

| Situation                                             | Accès                                      |
| ----------------------------------------------------- | ------------------------------------------ |
| Essai en cours, abonnement actif ou en renouvellement | Complet                                    |
| Essai échu, abonnement expiré, suspendu ou résilié    | Consultation seulement, données conservées |
| Aucun abonnement, ou abonnement jamais activé         | Aucun                                      |

Le produit `OCALL_FACTURE` reste « à venir » au catalogue : le Super Admin le passe en préproduction et
crée ses offres depuis l'administration (grille S1) quand la commercialisation est décidée.

## 3. Rôles

Le **propriétaire de l'organisation est gérant d'office**. Les autres comptes sont créés dans Facture
avec le rôle Suite `PRODUCT_USER` (aucun droit Park ni School) et un rôle Facture. Un rôle Park ou School
ne donne aucun droit Facture.

| Permission                                      | Gérant | Commercial | Comptable | Technicien |
| ----------------------------------------------- | ------ | ---------- | --------- | ---------- |
| Entrer, consulter l'identité de l'entreprise    | Oui    | Oui        | Oui       | Oui        |
| Modifier l'identité, le logo, la TVA par défaut | Oui    | Non        | Non       | Non        |
| Voir l'équipe                                   | Oui    | Oui        | Oui       | Non        |
| Gérer l'équipe                                  | Oui    | Non        | Non       | Non        |

Désactiver un membre ferme aussi son compte Suite et ses sessions : Facture décide d'abord, Suite recopie
l'état validé (même mécanisme que School).

## 4. Identité légale et mentions (Mali)

Paramètres de l'organisation, imprimés sur chaque document :

- raison sociale, nom commercial, adresse, ville, téléphone, e-mail ;
- **NIF** (numéro d'identification fiscale du vendeur), RCCM, **régime d'imposition** ;
- coordonnées bancaires et mentions complémentaires en pied de document ;
- **TVA par défaut choisie dans une liste de 0 à 20 %** (décision du 10/11/2026), 18 % proposé (taux
  normal au Mali), 0 % affiché « Exonéré » ; contrôle aussi en base (`CHECK`) ;
- délai de paiement (0 à 365 jours), devise XOF.

Avant l'émission d'une facture (sprint F2), raison sociale, adresse, NIF et régime d'imposition sont
exigés (`factureLegalMissing`). **À faire valider par un expert-comptable malien avant F2** : liste exacte
des mentions, obligation du RCCM, règles de numérotation.

**Logo** : PNG, JPEG ou WebP d'1 Mo au plus, vérifié puis réencodé en PNG sans métadonnées (600 × 300 au
plus), stocké en privé (`org/<organisation>/_/<uuid>.png`), servi seulement par l'API après contrôle
d'accès. Limite connue : le logo n'entre pas dans le quota de stockage de l'organisation (registre des
fichiers privés réservé au support jusqu'ici) ; les photos d'intervention (F3) l'y feront entrer.

**Aperçu PDF de l'en-tête** : `GET /facture/settings/letterhead.pdf`, avec la liste des mentions encore
manquantes. Socle PDF commun à School et Facture : `common/pdf/pdf-document.ts`.

## 5. Numérotation

`allocateFactureNumber` attribue le numéro **dans la transaction qui émet le document** : unique,
séquentiel et chronologique par organisation, type de document et année (UTC, heure du Mali), sans trou
(une émission annulée rend son rang). Format `FAC-2026-00001` (préfixes DEV, PRO, BC, FAC, AV). Un
brouillon n'a pas de numéro.

## 6. API (`/api/v1/facture`)

| Route                                                                | Permission       |
| -------------------------------------------------------------------- | ---------------- |
| `GET context`                                                        | entrer           |
| `GET settings` · `GET settings/logo` · `GET settings/letterhead.pdf` | entrer           |
| `PUT settings` · `POST settings/logo`                                | gérer l'identité |
| `GET members`                                                        | voir l'équipe    |
| `POST members` · `PATCH members/:id`                                 | gérer l'équipe   |

Écrans : `/facture` (tableau de bord, mentions manquantes), `/facture/parametres`, `/facture/equipe`.

## 7. Base et déploiement

- Migration : `packages/facture-database/prisma/migrations/20261120000000_facture_v1_socle`
  (3 tables, contrôles `CHECK`), appliquée par `pnpm db:facture:migrate:deploy` (refus des instructions
  destructrices et d'une base Suite ou School).
- Pré-déploiement Railway : `db:migrate:deploy && db:school:migrate:deploy && db:facture:migrate:deploy`
  — sans `FACTURE_ENABLED=true`, l'étape Facture ne fait rien.
- Variables : `FACTURE_ENABLED`, `FACTURE_DATABASE_URL`, `FACTURE_DIRECT_URL`.
- **Aucune base Facture n'est créée en préproduction ni en production** sans GO.

## 8. Tests

- Unitaires : `packages/shared/src/facture.spec.ts` (TVA, numérotation, mentions, permissions),
  `facture-boundaries.spec.ts` (frontières, configuration), `migration-safety.spec.ts` (cible Facture).
- Intégration : `apps/api/test/facture-f0.integration.spec.ts` (accès, lecture seule, TVA, logo, PDF,
  équipe sur deux bases, numérotation concurrente, isolation) — exige `TEST_FACTURE_DATABASE_URL`.
- E2E : `e2e/facture-f0.spec.ts` (portail, identité légale, logo, aperçu PDF, équipe).
- CI : base `ocall_facture_ci` éphémère, migrée puis utilisée par les tests d'intégration et E2E.
