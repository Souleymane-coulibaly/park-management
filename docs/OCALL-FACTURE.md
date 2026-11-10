# Ocall Facture

Application métier d'Ocall Suite : clients, devis, pro forma, bons de commande, factures, interventions
et notifications de rendez-vous. Développée dans le monorepo, sur le socle Suite (identité,
organisations, abonnements, Super Admin). Ses fonctionnalités et ses données métier sont séparées de
celles de Park et de School.

Proposition d'architecture et décisions : `ocall-audits/proposition-architecture-ocall-facture-v1.md`
(hors dépôt).

| Sprint               | Contenu                                                              | État                |
| -------------------- | -------------------------------------------------------------------- | ------------------- |
| **F0 — Socle**       | Base, accès, rôles, identité légale, TVA, numérotation, logo, PDF    | Livré               |
| **F1 — Commercial**  | Clients, catalogue, devis, pro forma, bons de commande, PDF, e-mail  | Livré               |
| **F2 — Facturation** | Factures émises figées, avoirs, encaissements, relances, exports     | Livré (ce document) |
| F3 — Interventions   | Techniciens, planning, équipements, temps, pièces, photos, signature | À venir             |
| F4 — Rendez-vous     | Notifications WhatsApp (fournisseur simulé en test)                  | À venir             |
| F5 — Site vitrine    | Site public, formulaires de demande, domaines, SEO local             | À venir             |

## 1. Architecture

```
Navigateur ─ Next.js (/suite, /facture)
                │
             API NestJS, un seul service
             └─ modules/facture        domaine Facture, aucun import des modules Park ni School
                │                                  │
     Base Ocall Suite (identité, organisations,    Base Ocall Facture (identité légale, membres,
     abonnements, essais, journal d'audit)         numérotation, clients, catalogue, documents)
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
| Consulter clients et catalogue                  | Oui    | Oui        | Oui       | Oui        |
| Gérer les clients                               | Oui    | Oui        | Oui       | Non        |
| Gérer le catalogue                              | Oui    | Oui        | Non       | Non        |
| Consulter et gérer les documents commerciaux    | Oui    | Oui        | Oui       | Non        |
| Émettre et relancer les factures                | Oui    | Oui        | Oui       | Non        |
| Encaissements et avoirs                         | Oui    | Non        | Oui       | Non        |
| Exports comptables (journaux CSV)               | Oui    | Non        | Oui       | Non        |

Désactiver un membre ferme aussi son compte Suite et ses sessions : Facture décide d'abord, Suite recopie
l'état validé (même mécanisme que School).

## 4. Identité légale et mentions (Mali)

Paramètres de l'organisation, imprimés sur chaque document :

- raison sociale (seule obligatoire), activité ou slogan (imprimé sous le nom), nom commercial,
  adresse, ville, téléphone, e-mail ;
- **NIF** (numéro d'identification fiscale du vendeur), RCCM, **régime d'imposition** ;
- coordonnées bancaires et mentions complémentaires en pied de document ;
- **TVA par défaut choisie dans une liste de 0 à 20 %** (décision du 10/11/2026), 18 % proposé (taux
  normal au Mali), 0 % affiché « Exonéré » ; contrôle aussi en base (`CHECK`) ;
- délai de paiement (0 à 365 jours), devise XOF.

**NIF, adresse et régime d'imposition sont facultatifs** (décision du 10/11/2026) : imprimés s'ils sont
renseignés ; les absents sont signalés à l'écran (`factureLegalMissing`) sans bloquer l'émission, qui
exige seulement une identité enregistrée. **À faire valider par un expert-comptable malien avant F2** :
liste exacte des mentions, obligation du RCCM, règles de numérotation.

**Logos** (tous les documents) : 3 en en-tête (logo principal compris), 6 en bas de page (3 à gauche,
3 à droite des mentions), 1 cachet ou signature (case « Le fournisseur »). Plafonds tenus sous verrou,
même en envois simultanés. Chaque image : PNG, JPEG ou WebP d'1 Mo au plus, vérifié puis réencodé en PNG sans métadonnées (600 × 300 au
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

## 6. Documents commerciaux (F1)

- **Clients** : entreprise ou particulier ; nom obligatoire, tout le reste facultatif (contact, e-mail,
  téléphone, adresse, NIF unique par organisation, RCCM, RIB, description imprimée sous le nom). Jamais
  supprimés : archivés.
- **Catalogue** : articles et prestations, référence unique, unité, prix HT en FCFA entiers, TVA 0–20 %.
- **Documents** : devis, pro forma, bons de commande (commandes clients), factures en brouillon. Un
  modèle commun `FactureDocument` + lignes (référence, désignation, description, quantité à 3 décimales,
  unité, prix, remise %, TVA).
- **Montants recalculés par l'API** (jamais repris du navigateur) : ligne arrondie au franc, TVA par taux
  sur la base cumulée, TTC = HT + TVA ; montant arrêté en toutes lettres (`packages/shared/src/facture-documents.ts`).
- **Cycle de vie** : brouillon (sans numéro, modifiable, supprimable) → émis (numéro définitif, identités
  du vendeur, du vendeur-personne et du client figées) → envoyé → accepté / refusé (devis, pro forma) ;
  annulation avec motif (numéro conservé, refusée si un document dérivé est en vigueur).
- **Document émis figé par la base** : déclencheurs `FactureDocument_frozen` et `FactureDocumentLine_frozen`
  (ni modification, ni retour en brouillon, ni suppression). Seule exception : la purge d'une organisation
  entière (`purgeFactureOrganizations`, réglage local `ocall.facture_purge`), jamais utilisée par l'API.
- **Conversions** : devis → pro forma, bon de commande ou facture ; pro forma → bon ou facture ; bon →
  facture. Idempotentes (une par origine et par type) ; convertir un devis vaut acceptation.
- **Envoi par e-mail** : PDF en pièce jointe, réponse adressée à l'entreprise ; statut « envoyé » seulement
  si le fournisseur accepte ; destinataire jamais journalisé.
- **PDF** (charte validée le 10/11/2026, commune à tous les documents Facture) : filet et couleur d'accent,
  logos, nom et activité, bloc client « Doit », date et heure, validité, référence client, vendeur (nom
  et identifiant), document d'origine, tableau avec référence article, sous-total, remise, TVA par taux,
  net à payer, montant en lettres, exonération, conditions, cases « Bon pour accord » et « Le fournisseur »
  (cachet), pied numéroté avec logos et mentions. `facture-pdf.ts` (charte) et `facture-document-pdf.ts`.

## 7. Facturation (F2)

- **Facture émise définitive** : numéro `FAC-AAAA-NNNNN`, échéance = date d'émission + délai de paiement
  (réglages, modifiable sur le brouillon ; 0 = à réception). Jamais annulée ni supprimée : elle se
  corrige par un **avoir**. La base le garantit aussi (déclencheur `FactureDocument_frozen` : ni
  échéance, ni délai, ni facture corrigée modifiables ; ni annulation, acceptation ou refus d'une facture
  ou d'un avoir).
- **Encaissements** (`FacturePayment`) : partiels, montant au plus égal au reste à payer, date au plus tard
  aujourd'hui, mode (espèces, mobile money, virement, chèque, carte, autre), référence. Saisis sous verrou
  de la facture : deux saisies simultanées ne dépassent jamais le reste dû. Jamais modifiés ni supprimés :
  une erreur s'**annule** avec un motif (déclencheur `FacturePayment_frozen`).
- **Avoirs** (`AV-AAAA-NNNNN`) : créés depuis une facture émise (lignes reprises, à ajuster pour un avoir
  partiel ; client imposé) ; un seul brouillon d'avoir à la fois par facture. À l'émission, sous verrou de
  la facture : montant positif, plafonné au TTC de la facture moins les avoirs déjà émis. Un avoir émis
  après paiement complet donne un **trop-perçu** à rembourser (reste dû négatif, affiché comme tel).
- **Statut d'une facture**, déduit de ses montants : émise / envoyée → payée en partie → soldée ; annulée
  par avoir si les avoirs couvrent tout sans encaissement (`factureInvoiceStatus`).
- **Relance** : e-mail rappelant le reste à payer et l'échéance, facture jointe ; comptée seulement si le
  fournisseur accepte le message (clé d'idempotence par rang de relance). Relance manuelle, pas d'envoi
  automatique en V1.
- **Tableau de bord** (`/facture`) : facturé HT du mois net des avoirs, encaissé du mois, reste à
  encaisser, retards (montant, nombre, 10 plus anciennes échéances), devis en attente.
- **Exports CSV** (Excel français, « ; », UTF-8 avec BOM, cellules protégées contre l'injection de
  formules) : journal des ventes (factures et avoirs émis, avoirs en négatif, TVA par taux, échéance,
  reste à payer) et journal des encaissements (annulations comprises), sur une période d'un an au plus.
- **PDF** : charte F1 ; la facture porte son échéance (ou son délai sur le brouillon), l'avoir la facture
  corrigée, le bloc « En faveur de » et le « Total de l'avoir ».
- **Hors V1** : remboursement d'un trop-perçu, relances automatiques, paiement en ligne.

## 8. API (`/api/v1/facture`)

| Route                                                                                                                    | Permission          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `GET context`                                                                                                            | entrer              |
| `GET settings` · `GET settings/logo` · `GET settings/letterhead.pdf`                                                     | entrer              |
| `PUT settings` · `POST settings/logo` · `POST/DELETE settings/logos`                                                     | gérer l'identité    |
| `GET settings/logos` · `GET settings/logos/:id`                                                                          | entrer              |
| `GET clients` · `GET clients/:id`                                                                                        | voir les clients    |
| `POST clients` · `PATCH clients/:id`                                                                                     | gérer les clients   |
| `GET items` / `POST items` · `PATCH items/:id`                                                                           | catalogue           |
| `GET documents` · `GET documents/:id` · `GET documents/:id/pdf`                                                          | voir les documents  |
| `POST documents` · `PUT/DELETE documents/:id` · `POST documents/:id/{issue,accept,refuse,cancel,convert,duplicate,send}` | gérer les documents |
| `POST documents/:id/remind`                                                                                              | gérer les documents |
| `POST documents/:id/credit-note` · `POST documents/:id/payments` · `POST documents/:id/payments/:paymentId/cancel`       | facturation         |
| `GET dashboard`                                                                                                          | voir les documents  |
| `GET exports/sales?from&to` · `GET exports/payments?from&to`                                                             | exports comptables  |
| `GET members`                                                                                                            | voir l'équipe       |
| `POST members` · `PATCH members/:id`                                                                                     | gérer l'équipe      |

Écrans : `/facture` (tableau de bord, exports), `/facture/documents` (liste, reste à payer, retards) et
`/facture/documents/:id` (éditeur du brouillon, actions du document émis ; règlement, encaissements, avoirs
et relance d'une facture), `/facture/clients`, `/facture/catalogue`,
`/facture/parametres` (identité, présentation, logos par emplacement), `/facture/equipe`.

## 9. Base et déploiement

- Migrations : `20261120000000_facture_v1_socle` (F0), `20261121000000_facture_v1_commercial` (F1 :
  clients, catalogue, documents, lignes, logos ; contrôles `CHECK` et déclencheurs du document figé) et
  `20261122000000_facture_v1_billing` (F2 : encaissements, avoirs, échéance ; contrôles et déclencheurs
  `FactureDocument_creditNote`, `FacturePayment_frozen`), appliquées par `pnpm db:facture:migrate:deploy` (refus des instructions
  destructrices et d'une base Suite ou School).
- Pré-déploiement Railway : `db:migrate:deploy && db:school:migrate:deploy && db:facture:migrate:deploy`
  — sans `FACTURE_ENABLED=true`, l'étape Facture ne fait rien.
- Variables : `FACTURE_ENABLED`, `FACTURE_DATABASE_URL`, `FACTURE_DIRECT_URL`.
- **Aucune base Facture n'est créée en préproduction ni en production** sans GO.

## 10. Tests

- Unitaires : `packages/shared/src/facture.spec.ts` (TVA, numérotation, mentions, permissions),
  `facture-documents.spec.ts` (montants exacts, remises, TVA par taux, conversions, montant en lettres,
  reste dû, statut d'une facture, échéance dépassée),
  `facture-boundaries.spec.ts` (frontières, configuration), `migration-safety.spec.ts` (cible Facture).
- Intégration : `apps/api/test/facture-f0.integration.spec.ts` (accès, lecture seule, TVA, logo, PDF,
  équipe sur deux bases, numérotation concurrente, isolation), `facture-f1.integration.spec.ts`
  (clients, catalogue, montants serveur, émission concurrente, document figé par la base, e-mail simulé,
  conversions idempotentes, annulation, logos par emplacement sous concurrence, rôles, lecture seule),
  `facture-f2.integration.spec.ts` (facture figée, échéance, encaissements partiels plafonnés sous
  concurrence, annulation d'un encaissement, avoirs plafonnés, trop-perçu, relance simulée, tableau de
  bord, exports CSV, rôles, isolation, déclencheurs de la base) — exigent `TEST_FACTURE_DATABASE_URL`.
- E2E : `e2e/facture-f0.spec.ts` (portail, identité, logo, équipe), `e2e/facture-f1.spec.ts` (client,
  article, devis → bon de commande → facture brouillon, PDF), `e2e/facture-f2.spec.ts` (facture émise,
  payée en deux fois, avoir, tableau de bord, export).
- CI : base `ocall_facture_ci` éphémère, migrée puis utilisée par les tests d'intégration et E2E.
