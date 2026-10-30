# Ocall Park — suivi des sprints

| Sprint | Périmètre                                                     | Branche            | Statut                                            |
| ------ | ------------------------------------------------------------- | ------------------ | ------------------------------------------------- |
| 1      | Socle SaaS multi-tenant, frontend, établissements             | `claude/sprint-1`  | ✅ Validé                                         |
| 2      | Caisse POS restaurant                                         | `claude/sprint-2`  | ✅ Validé                                         |
| 3      | POS Android, impression thermique, tiroir-caisse              | `claude/sprint-3`  | ✅ Validé (validation matérielle à faire)         |
| 4      | Billetterie Parc, QR codes, contrôle d’accès                  | `claude/sprint-4`  | ✅ CP-03 : GO SOUS RÉSERVES (A1, A2, A5 ouvertes) |
| 5      | Restaurant : commandes, KDS, QR, tables, stocks, réservations | `claude/sprint-5`  | 🟡 Terminé — local, push à autoriser              |
| 6      | Bornes de commande, CRM, fidélité, planning du personnel      | `claude/sprint-6`  | 🟡 En cours — tests base bloqués (Neon `test`)    |
| 7      | Paiement des abonnements (CinetPay)                           | —                  | ⏸️ Reporté par le commanditaire (plan présenté)   |
| 8      | IA : import de carte, copilote, commande vocale               | `claude/sprint-8`  | 🟡 En cours — tests base bloqués (Neon `test`)    |
| 9A     | Analyses : CA, produits × heures, parc, marges, exports CSV   | `claude/sprint-9`  | 🟡 En cours — tests base bloqués (Neon `test`)    |
| 9B     | Copilote enrichi, statistiques SaaS, règlements d’abonnement  | `claude/sprint-9`  | 🟡 En cours — tests base bloqués (Neon `test`)    |
| 10     | Sites vitrines publics, domaines, tarifs SaaS                 | `claude/sprint-10` | 🟡 En cours — tests base bloqués (Neon `test`)    |

Environnements : base Neon de **développement** (préservée), branche Neon **`test`** réservée aux
tests automatisés, base de **production non configurée**. Aucune fusion dans `main`, aucun déploiement.

Checkpoints Codex :

- CP-02 n'a pas été réalisé.
- CP-03 (Sprints 1 à 4) : **GO SOUS RÉSERVES**, avec « Sprint 5 : NON » tant que A1, A2 et A5
  restaient ouvertes. Le commanditaire a **explicitement décidé de démarrer le Sprint 5** le
  30/10/2026, réserves maintenues.
- Le Sprint 6 est démarré sans audit CP-04, également sur décision du commanditaire : **CP-04 est
  intégré au CP-05**, qui couvrira les Sprints 1 à 6. Préparation :
  [CP-04-preparation.md](docs/checkpoints/CP-04-preparation.md) et
  [CP-05-preparation.md](docs/checkpoints/CP-05-preparation.md).
- Le Sprint 7 (CinetPay) a été **reporté** par le commanditaire le 30/10/2026, après présentation du
  plan ; le Sprint 8 a été démarré à sa demande, sans CP-05 ni CP-06 (aucun rapport CP-06 n'existe).
  Préparation : [CP-07-preparation.md](docs/checkpoints/CP-07-preparation.md).
- Le Sprint 9 est démarré **sans audit CP-07** (seule sa préparation existe), sur décision explicite
  du commanditaire le 30/10/2026. Il est découpé en **9A** (analyses, marges, exports) puis **9B**
  (copilote, Super Admin), démarré à la demande du commanditaire le 30/10/2026 ; exports en **CSV uniquement** (Excel et PDF
  reportés, aucune nouvelle dépendance). CP-08 couvrira les Sprints 1 à 9 :
  [CP-08-preparation.md](docs/checkpoints/CP-08-preparation.md).
- Le Sprint 10 est démarré **sans CP-08** : le Sprint 9 n'est donc pas validé. Sur décision du
  commanditaire, il est commité localement (`69f4b96`, non poussé) et sert de base à
  `claude/sprint-10`. Préparation : [CP-09-preparation.md](docs/checkpoints/CP-09-preparation.md).

---

## Sprint 10 — Sites vitrines publics, domaines et tarifs SaaS (en cours, non commité)

Documentation : [docs/SITES-VITRINES.md](docs/SITES-VITRINES.md) (architecture, DNS, hébergement,
vérifications réelles) et [docs/GUIDE-SITE-VITRINE.md](docs/GUIDE-SITE-VITRINE.md) (guide utilisateur).

### Fonctionnalités réalisées

- Module `public-sites` :
  - un site par établissement, **brouillon et publié séparés** ;
  - la publication fige textes, images, menu et tarifs **explicitement** choisis, sans aucune donnée
    interne ;
  - aperçu du brouillon et dépublication avec contenu conservé.
- Éditeur `/app/site-web` (contenu, photos, menu et tarifs, apparence, nom de domaine) :
  - 3 thèmes, couleur au contraste vérifié, ordre et masquage des sections ;
  - sections selon le métier (Parc, Restaurant, Parc + Restaurant).
- Pages publiques `/e/<slug>` :
  - responsive, accessibles, mises en cache et régénérées à la publication ;
  - liens Appeler, WhatsApp et Itinéraire, sans script tiers ;
  - aucune vente, réservation, commande ni paiement.
- Routage par hôte : sous-domaines Ocall (si activés) et domaines personnalisés **ACTIFS**,
  redirection canonique 301, espaces privés introuvables sur un hôte de site.
- Domaines personnalisés :
  - preuve de propriété par TXT, activation par le Super Admin après contrôle HTTPS réel
    (`/admin/domaines`) ;
  - statuts PENDING / VERIFYING / VERIFIED / ACTIVE / ERROR, unicité, journalisation.
- SEO : titre, description, Open Graph, `canonical`, JSON-LD (Restaurant / AmusementPark),
  `sitemap.xml` et `robots.txt` selon l'hôte ; brouillons et sites suspendus jamais indexés.
- Médias : type et dimensions lus dans le contenu (JPEG, PNG, WebP), 5 Mo, stockage local ou
  compatible S3 (**Cloudflare R2** retenu ; bucket non créé).
- Abonnement : organisation suspendue ou abonnement expiré → site hors ligne, contenu conservé.
- Tarifs SaaS : colonne frais de mise en service. Restaurant et Parc : 250 000 + 15 000 FCFA par
  mois ; Parc + Restaurant : 350 000 + 25 000 FCFA par mois. Affichés sur la page Tarifs et
  modifiables par le Super Admin.
- Migration `20261030230000_sites_vitrines` : 3 tables, colonne `setupFee`, 3 CHECK, mise à jour des
  3 offres. **Non appliquée.**

### Tests

- Unitaires : shared 127/127, API 62/62, database 13/13. Typecheck, lint, Prettier, build,
  `migrate:check` : OK.
- **Vérification hors ligne** avec le vrai client Prisma (PostgreSQL embarqué jetable, toutes les
  migrations, hors dépôt, aucune base Neon) : **50/50 conforme**. Elle couvre les tests 1 à 21, 24
  et 25, ainsi que les tarifs migrés.
- `apps/api/test/sprint10-sites.integration.spec.ts` et `e2e/sprint10-sites.spec.ts` (mobile, SEO,
  données structurées) : **écrits, non exécutés** (A11).
- Vérifications réelles DNS, HTTPS et domaines : **non réalisées**, aucun domaine acquis
  (`ocallpark.com` absent du DNS au 30/10/2026). Protocole : SITES-VITRINES.md § 7.

### Limites connues

A30 à A36 : voir [CP-09-preparation.md](docs/checkpoints/CP-09-preparation.md).

---

## Sprint 9B — Copilote enrichi, statistiques SaaS et règlements d’abonnement (en cours, non commité)

Documentation : [docs/ANALYSES.md](docs/ANALYSES.md) §8 et §9. Même branche `claude/sprint-9`.

### Fonctionnalités réalisées

- Copilote : 5 nouvelles fonctions en lecture seule, adossées au service d’analyses du 9A — ventes
  par produit et par heure (produit retrouvé par le serveur, jamais deviné), produits qui rapportent
  le plus, heures de pointe, jour le plus fréquenté du parc, marges estimées par catégorie
  (`analytics.margins`). Affichage dédié dans `/app/copilot`, exemples de questions.
- Super Admin : `/admin/statistiques` (organisations, abonnements par statut, offres, encaissements
  SaaS validés par mois, règlements à vérifier, renouvellements à 30 jours et échus, historique,
  revenu théorique distinct) et `/admin/reglements` (saisie, validation, rejet motivé).
- Règlements payés à Ocall hors plateforme, validés manuellement ; prolongation de l’abonnement
  uniquement sur case explicite (décochée par défaut, choix du commanditaire), jamais raccourcie ;
  aucun paiement en ligne ni renouvellement automatique ; séparés des recettes des établissements.
- Migration additive `20261030210000_reglements_saas` (table `SubscriptionPayment`, 2 CHECK).
  **Non appliquée.**

### Tests

- Unitaires : shared 116/116, API 54/54 (10 nouveaux : copilote, produit cité, fournisseur simulé),
  database 13/13. Typecheck, lint, Prettier, build, `migrate:check` : OK.
- Vérification hors ligne du registre SaaS avec le vrai client Prisma (PostgreSQL embarqué jetable,
  hors dépôt, aucune base Neon) : 24/24 conforme.
- `apps/api/test/sprint9b-copilot-saas.integration.spec.ts` (tests 24 et 25) : **écrit, non
  exécuté** (A11).

### Limites connues

- A27 — validation sans double contrôle ; A28 — abonnements échus signalés, jamais basculés
  automatiquement ; A29 — pas d’E2E Super Admin. Voir CP-08.

---

## Sprint 9A — Analyses, statistiques, rentabilité et exports CSV (en cours, non commité)

Documentation : [docs/ANALYSES.md](docs/ANALYSES.md). Branche `claude/sprint-9`, créée depuis
`claude/sprint-8` (`10f6453`).

### Fonctionnalités réalisées

- Module `analytics` (API, lecture seule) : vue globale, restaurant, ventes par produit et par heure,
  parc, carte thermique, coûts et marges estimés, comparaison des établissements, export CSV.
- Règles de calcul uniques (`packages/shared/src/analytics.ts`) : CA daté à l'encaissement, impayées
  et annulées exclues, visiteurs = scans acceptés, billet vendu / payé / émis / scanné distincts,
  heures locales de chaque établissement, période précédente de même durée.
- Écrans `/app/analytics` (5 onglets), graphiques HTML/SVG sans dépendance, filtres communs
  (période, dates, établissement, activité), tableaux filtrables, comparaison entre deux journées.
- Permissions `analytics.read` (OWNER, ADMIN, SUPERVISOR), `analytics.margins` et
  `analytics.export` (OWNER, ADMIN) ; exports journalisés ; injection de formules neutralisée.
- Protection de la base : transaction en lecture seule, `statement_timeout` 10 s, période ≤ 366 jours,
  export ≤ 50 000 lignes, limites de débit dédiées.
- Migration additive `20261030190000_analyses` : index `Payment(organizationId, createdAt)`.
  **Non appliquée** (ni `test`, ni développement).
- Règle commune appliquée au tableau de bord (CA daté au paiement au lieu de la création de la vente),
  aux meilleures ventes du tableau de bord restaurant et à `top_products` du copilote.

### Tests

- Unitaires : shared 114/114 (11 nouveaux), API 44/44 (18 nouveaux : CSV et formules, exports,
  périmètre serveur, période), database 13/13. Typecheck, lint, Prettier, build, `migrate:check` : OK.
- **Vérification SQL hors ligne** (PostgreSQL embarqué PGlite, toutes les migrations appliquées,
  script jetable hors dépôt, aucune base Neon) : 43/43 contrôles conformes — tests 1 à 18, 20, lecture
  seule ; performance indicative sur 20 000 ventes.
- `apps/api/test/sprint9-analytics.integration.spec.ts` (tests 1 à 20, 23, 26) et
  `e2e/sprint9-analytics.spec.ts` : **écrits, non exécutés** — branche Neon `test` inaccessible (A11).
- Tests 21 (Excel) et 22 (PDF) : sans objet (CSV seul, décision du commanditaire). Tests 24
  (copilote) et 25 (SaaS) : Sprint 9B. Test 27 (régression 1 à 8) : bloqué par A11.

### Limites connues

- A23 — marges au coût d'achat actuel (coût à la date de vente non enregistré).
- A24 — performance sur Neon non mesurée (test 26 non exécuté).
- A25 — écrans d'analyse non vérifiés dans un navigateur (E2E non exécuté, base de développement
  sans les migrations des Sprints 6, 8 et 9).

---

## Sprint 8 — Intelligence artificielle : import de carte, copilote, commande vocale (en cours, non poussé)

Documentation : [docs/INTELLIGENCE-ARTIFICIELLE.md](docs/INTELLIGENCE-ARTIFICIELLE.md). Branche
`claude/sprint-8`, créée depuis `claude/sprint-6` (`6daaddc`) : les Sprints 5 et 6, dont dépendent les
commandes et les stocks, ne sont pas validés.

**Fournisseur** : OpenAI, choisi par le commanditaire — GPT-5 pour le texte et l'image,
`gpt-transcribe` pour la voix (GPT-5 ne transcrit pas). Abstraction `AiProvider` ; fournisseur simulé
pour les tests. **Aucun appel réel n'a été fait** (pas de clé ni d'autorisation).

### Fonctionnalités réalisées

1. **Import IA de carte** (`/app/catalogue/import-ia`) et **de grille tarifaire** (`/app/billetterie/import-ia`)
   - Photo, image ou PDF (10 Mo), type vérifié par signature ; fichier jamais conservé (empreinte gardée).
   - Revalidation serveur : prix absent jamais inventé, prix non lu retiré, prix ambigu signalé, doublons.
   - Revue ligne par ligne, publication confirmée, sans écrasement ; billets importés désactivés.
2. **Copilote analytique** (`/app/copilot`)
   - 7 fonctions de lecture prédéfinies ; établissement imposé par le serveur ; périodes fermées.
   - Chiffres du serveur affichés ; phrase de l'IA écartée si elle cite un chiffre absent des données.
3. **Commande vocale** (écran Commandes)
   - Enregistrement sur geste explicite, transcription, panier rapproché du catalogue réel.
   - Confirmation humaine obligatoire ; commande non payée, non envoyée en cuisine, prix serveur.
4. **Coûts et quotas** (`/app/parametres/ia`)
   - Fonctionnalités désactivables, plafond mensuel (réservé sous verrou), alerte, coûts **estimés**.
   - Conservation configurable des résultats et transcriptions, purge.

**Migration** `20261030164331_intelligence_artificielle` : additive, 3 contraintes CHECK.
`db:migrate:check` OK. **Pas encore appliquée** (base `test` injoignable).

### Tests

| Suite                                                                               | Résultat                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Unitaires (shared 103, database 13, api 26)                                         | 142/142 — dont règles IA (formats, périodes, coûts, revalidation, arguments stricts) |
| Lint, Prettier, TypeScript strict, build                                            | OK                                                                                   |
| Injection de dépendances NestJS (module complet, sans base)                         | OK                                                                                   |
| Intégration Sprint 8 (`sprint8-ia.integration.spec.ts`, tests 1 à 21) — **simulés** | **Non exécutée** : base Neon `test` injoignable                                      |
| E2E Sprint 8 (`e2e/sprint8-ia.spec.ts`) — **simulé**                                | **Non exécuté** (même cause)                                                         |
| Test 22 : régression Sprints 1 à 6 (le Sprint 7 n'a pas de code)                    | **En attente** de la base `test`                                                     |
| Tests réels avec OpenAI                                                             | **Non exécutés** : non autorisés (coûts), aucune clé                                 |

---

## Sprint 6 — Bornes de commande, CRM, fidélité, planning (en cours, non poussé)

Documentation : [docs/BORNES-CRM-FIDELITE-PLANNING.md](docs/BORNES-CRM-FIDELITE-PLANNING.md).

### Fonctionnalités réalisées

1. **Bornes libre-service** (`/kiosk`, administration `/app/bornes`)
   - Appairage par code à usage unique (15 min).
   - Jeton d'appareil haché dans un cookie `httpOnly` limité aux routes de la borne ; révocation
     immédiate.
   - Catalogue avec photos, variantes, quantités, instructions.
   - Une commande par session, numéro affiché, retour automatique à l'accueil.
   - Perte de connexion gérée, commandes répétées bloquées.
   - Commande en attente de paiement à la caisse, sans paiement simulé ni préparation automatique.
2. **CRM** (`/app/clients`)
   - Fiches facultatives avec consentement, recherche et filtres.
   - Historique, visites, dépenses (responsables) ; accès restreint du caissier.
   - Anonymisation sur demande, règle de conservation de 36 mois.
3. **Fidélité Parc et Restaurant**
   - Deux soldes indépendants, sans transfert ; règles configurables.
   - Crédit uniquement à la confirmation du paiement, une seule fois.
   - Utilisation en remise calculée par le serveur, sans solde négatif (contrainte CHECK en base).
   - Corrections auditées ; annulations recréditées.
4. **Planning du personnel** (`/app/personnel/planning`)
   - Postes configurables, créneaux, vues jour, semaine et mois.
   - Chevauchements refusés sous verrou ; planning personnel visible par chaque employé.
   - Pas de pointage, d'absences, de congés ni de paie.
5. **Impression directe PWA et ticket de borne** (extension approuvée en cours de sprint)
   - Imprimantes USB (WebUSB) et Bluetooth BLE pilotées par le navigateur, sans connecteur
     Android : caisse, billetterie, cuisine, borne. Association par geste sur chaque appareil.
   - Ticket de commande imprimé par la borne (numéro, articles, total indicatif), historisé, sans
     réimpression ; un échec n'annule pas la commande.
   - Non validé sur imprimante physique (A16). Bluetooth classique et port 9100 : connecteur Android.

**Migration** `20261030142337_bornes_crm_fidelite_planning` : additive, avec deux contraintes CHECK.

- Appliquée sur `test`, puis sur la base de développement.
- Comptages des 36 tables existantes identiques avant et après ; 8 tables nouvelles, vides.

**Migration** `20261030152753_impression_pwa_ticket_borne` : additive (3 valeurs d'énumération,
2 colonnes facultatives, `PrintJob.requestedById` facultatif). `db:migrate:check` OK. **Pas encore
appliquée** : en attente de la base `test`.

### Tests

| Suite                                                                           | Résultat                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Unitaires (shared 90, database 13, api 11)                                      | 114/114                                                           |
| Lint, Prettier, TypeScript strict, build                                        | OK                                                                |
| Intégration Sprint 6 (`sprint6-kiosk-crm-planning.integration.spec.ts`, 20 cas) | **Non exécutée** : base Neon `test` injoignable (voir ci-dessous) |
| Régression intégration Sprints 1 à 6, E2E Sprint 6 et régression E2E            | **En attente** du rétablissement de la base `test`                |

**Incident — branche Neon `test` injoignable** (30/10/2026, à partir d'environ 14 h 39).

- La connexion échoue, par le pooler comme par l'accès direct, alors que la base de développement
  répond.
- C'était déjà le cas d'environ 13 h 06 à 14 h 21.
- La première exécution de l'intégration du Sprint 6 a donc échoué au démarrage, sans exécuter
  aucun test : `test-logs/integration-s6-2026-10-30T14-39-16-150Z.log`.
- **Cause établie le 30/10/2026 (diagnostic lecture seule)** : ce n'est ni le réseau ni un quota.
  - Le serveur répond : TCP en IPv4 et IPv6, TLS, puis demande d'authentification SCRAM.
  - Le message « Can't reach database server » de Prisma venait de son délai de connexion de 5 s,
    dépassé pendant le réveil du calcul.
  - Avec un délai de 60 s, l'erreur réelle apparaît : **authentification refusée** pour le rôle
    sur la branche `test`, par le pooler comme par l'accès direct.
  - Le même rôle et le même mot de passe sont acceptés par la base de développement : le mot de
    passe du rôle a donc changé sur la branche `test`.
  - Correctif : dans la console Neon, mettre à jour la chaîne de connexion de la branche `test`
    dans `apps/api/.env` (`TEST_DATABASE_URL`, `TEST_DIRECT_URL`). Action réservée au
    commanditaire : aucune modification n'est faite sur Neon depuis le poste.
- Les tests ne sont jamais lancés sur la base de développement.

---

## Sprint 5 — Restaurant : commandes, KDS, commandes QR, tables, stocks, réservations (terminé, non poussé)

### Fonctionnalités réalisées

Documentation complète : [docs/RESTAURANT.md](docs/RESTAURANT.md).

1. **Commandes**
   - Canaux : sur place (table ou zone), à emporter, comptoir, QR code.
   - Le POS du Sprint 2 est étendu avec le canal, la table, une instruction par ligne et une
     instruction générale, et trois actions explicites : Encaisser, Envoyer en cuisine, Enregistrer.
   - Prix figés et calculés par le serveur ; modification interdite après paiement, articles figés
     après l'envoi en cuisine.
   - Historique `OrderEvent` de chaque commande.
2. **Paiement et préparation indépendants**
   - Payer n'envoie jamais en cuisine. « Envoyer en cuisine » est une action explicite (permission
     `order.send_kitchen`).
   - Transitions : envoyée → en préparation → prête → servie, idempotentes, verrouillées et auditées.
3. **Écran cuisine** (`/app/cuisine`)
   - Temps réel par SSE, authentifié par le cookie de session, isolé par établissement et par
     organisation, avec revérification de la session à chaque battement.
   - Aucune commande non envoyée, aucun prix.
   - Durée d'attente affichée ; reconnexion et resynchronisation après coupure réseau.
4. **Commandes QR sans compte**
   - Menu public par table ou par zone ; demande ni payée ni envoyée en cuisine.
   - Validation ou refus motivé par un employé ; suivi par le client.
   - Protection anti-abus : jetons de 128 bits, limite par IP, plafond par table, idempotence.
5. **Salles, zones et tables**
   - Zones facultatives (pas de piscine obligatoire) ; statut des tables en direct.
   - QR codes affichés, imprimables et régénérables.
6. **Stocks**
   - Articles, unités, seuils d'alerte, coûts facultatifs (jamais inventés).
   - Entrées, sorties, inventaires et historique ; recettes simples.
   - Déduction unique, à l'envoi en cuisine ou au paiement.
7. **Réservations**
   - Statuts : en attente, confirmée, annulée, terminée, non présentée.
   - Aucun chevauchement sur une même table, contrôle fait sous verrou.
   - Vues liste et calendrier.
8. **Tickets cuisine**
   - Ils réutilisent le connecteur du Sprint 3 ; aucun prix.
   - Imprimés après l'envoi explicite en cuisine ; un échec d'impression est sans effet sur le
     paiement.
   - Imprimante simulée : le connecteur Android n'est toujours pas compilé (A5).
9. **Tableau de bord restaurant**
   - CA encaissé (paiements réussis uniquement), commandes, panier moyen.
   - Files de cuisine, temps moyen de préparation, produits les plus vendus, alertes de stock.

**Migrations**, additives, appliquées sur `test` puis sur la base de développement :

- `20261030100338_restaurant_commandes_cuisine_stocks_reservations` : comptages des 28 tables
  existantes identiques avant et après ; 8 tables nouvelles, vides.
- `20261030120121_ordre_lignes_vente` : colonne `SaleLine.lineNo` avec valeur par défaut ; aucun
  comptage modifié.

### Tests (branche Neon `test` uniquement)

| Suite                                                                           | Résultat                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Unitaires (shared 78, database 13, api 11)                                      | 102/102                                                                                                                         |
| Intégration — Sprint 5 (20 cas demandés et isolation)                           | 27/27                                                                                                                           |
| Intégration — Sprints 1 à 5                                                     | 129/129 : S1 33, S2 26, S3 17, S4 26 (relancé après correction de l'ordre), S5 27 ; en plusieurs exécutions, voir les incidents |
| E2E Playwright — Sprint 5 (parcours complet, dont une coupure réseau réelle)    | 1/1                                                                                                                             |
| E2E Playwright — Sprints 1 à 5 (régression complète)                            | 21/21 (`test-logs/e2e-2026-10-30T14-08-19-692Z.log`)                                                                            |
| Lint, Prettier, TypeScript strict, build, contrôle des migrations destructrices | OK                                                                                                                              |

### Incidents et corrections

- **Ordre des billets aléatoire (défaut du Sprint 4), corrigé.** La régression navigateur a échoué une
  fois au Sprint 4 : le premier QR scanné n'était pas celui du premier visiteur.
  - Cause : les billets étaient triés par l'identifiant aléatoire (UUID) de leur ligne de vente, donc
    dans un ordre dû au hasard, une fois sur deux.
  - Le même défaut touchait les lignes des tickets de caisse et des tickets cuisine.
  - Correction : rang de saisie `SaleLine.lineNo`, utilisé pour tous les tris.
  - Le test n'a pas été modifié ; une assertion d'ordre a été ajoutée au Sprint 5.
- **Défaut trouvé par le test navigateur, puis corrigé.** Après une coupure réseau, l'écran cuisine
  restait affiché « En direct » sans se resynchroniser. Désormais :
  - le flux est rouvert dès le retour du réseau ;
  - il est rouvert aussi après 60 s sans battement ;
  - l'état « Reconnexion » s'affiche immédiatement.
- **Plantage natif du processus de test d'intégration (nouvelle preuve pour A1).** Après les fichiers
  des Sprints 5, 4 et 3 (tous verts), le processus Jest s'est arrêté sans aucune sortie, avec le code
  Windows `0xC0000409` (STATUS_STACK_BUFFER_OVERRUN). Journal :
  `test-logs/integration-2026-10-30T11-12-00-733Z.log`.
  - C'est la première fois qu'un code de sortie accompagne un arrêt silencieux : il oriente vers un
    module natif (moteur Prisma ou Node) plutôt que vers le code applicatif.
  - Les Sprints 1 et 2 ont été relancés séparément : Sprint 2 26/26, Sprint 1 33/33 après
    adaptation d'une assertion (voir ci-dessous).
  - Journaux : `test-logs/integration-s1s2-2026-10-30T11-38-26-097Z.log`, puis `integration-s1-…`.
- **Assertion du Sprint 1 adaptée.** Le test vérifiait que le module « Cuisine KDS » était « à
  venir » ; il est disponible depuis le Sprint 5. Le contrôle côté serveur de l'accès par métier est
  conservé, sur le CRM, encore « à venir ».
- **Démarrage E2E interrompu une fois** : l'API n'a pas pu joindre Neon `test` au lancement (`P1001`).
  La connexion TCP était rétablie quelques secondes plus tard, et la relance est verte. Journal :
  `test-logs/e2e-s5-2026-10-30T11-00-31-805Z.log`.
- **Panne de la base Neon `test` pendant environ 75 minutes** (30/10/2026, de 13 h 06 à 14 h 21) :
  `Can't reach database server`, puis `Server has closed the connection`.
  - Le `beforeAll` de l'intégration du Sprint 5 a dépassé son délai et les 27 tests ont échoué en
    cascade. Journal : `test-logs/integration-s4s5-2026-10-30T12-06-29-630Z.log`.
  - Dans la même exécution, le Sprint 4 est vert (26/26).
  - Conséquence révélée : le nettoyage ayant échoué, l'application de test n'était pas fermée et le
    processus Jest restait ouvert indéfiniment. Le test ferme désormais toujours l'application
    (`try`/`finally`).
  - Relance du Sprint 5 : 27/27 (`test-logs/integration-s5-2026-10-30T13-54-16-717Z.log`).
- **Build de production écrasé par erreur de manipulation.** Des serveurs de développement (`next dev`,
  lancés à la demande sur les ports 3001 et 4001) ont écrasé le build de production dans `.next`. La
  régression navigateur n'a donc pas pu démarrer (`e2e-2026-10-30T14-05-26-594Z.log`). Le code n'est
  pas en cause : reconstruction, puis relance.

### Limites connues

- Bus temps réel en mémoire : adapté à une seule instance d'API.
- Photos de produits : pas encore gérées.
- Heures des réservations : saisies dans le fuseau de l'appareil.

Analyses avancées : Sprint 9.

---

## Sprint 4 — Billetterie Parc, QR codes sécurisés, contrôle d'accès (en attente de validation)

### Fonctionnalités réalisées

1. **Tarifs** (`/app/billetterie/configuration`) : catégories Adulte, Enfant, Famille, Groupe,
   Personnalisée ; prix, personnes incluses, conditions, période de vente, validité ; désactivation
   plutôt que suppression ; nouveau prix sans effet sur les billets déjà émis.
2. **Vente tactile** (`/app/billetterie`) : grandes tuiles, prénom obligatoire par visiteur, total
   calculé par le serveur, **moteur de vente et de paiement communs** avec la caisse (session de caisse,
   idempotence, espèces ; Wave toujours non activé, aucun paiement simulé).
3. **QR codes** : un billet par visiteur, émis **uniquement dans la transaction du paiement
   confirmé**, émission idempotente ; QR = `OCP1-` + jeton aléatoire de 128 bits, sans donnée
   personnelle ni secret ; statuts `VALID`, `USED`, `EXPIRED`, `CANCELLED` ; annulation motivée et auditée.
4. **Contrôle d'accès** (`/app/controle-acces`) : caméra (détecteur natif ou `jsqr`) ou saisie
   manuelle, résultat en très grand, historique ; **validation atomique en PostgreSQL** (5 scans
   simultanés → 1 entrée) ; motifs : déjà utilisé, expiré, annulé, inconnu, autre établissement, parc
   fermé, pas encore valable ; **refus hors connexion**.
5. **Impression** (réutilise le Sprint 3) : billets 58 / 80 mm avec QR ESC/POS, plusieurs billets
   séparés par une coupe, réimpression contrôlée (tous ou un seul billet, DUPLICATA), historique,
   échec sans effet sur la vente ; billets annulés non réimprimés.
6. **Horaires** : semaine type, dates particulières (fermeture, horaires spéciaux, évènement) ; vente
   et entrée refusées parc fermé ; **parc + restaurant : le restaurant reste ouvert** (testé).
7. **Tableau de bord Parc** (`/app/billetterie/tableau`) : billets vendus, entrées, non utilisés,
   chiffre d'affaires, par catégorie, par heure, comparaison avec la veille ; tableau de bord principal
   avec chiffre d'affaires **séparé par activité**.

API : `/ticketing/*`, `/tickets`, `/access/*` (Swagger). Migration additive
`20261029234320_billetterie_parc` (5 tables, colonnes avec valeur par défaut), appliquée sur `test`
puis sur la base de développement (comptages inchangés). Documentation :
[docs/BILLETTERIE-PARC.md](docs/BILLETTERIE-PARC.md), [CP-03](docs/checkpoints/CP-03-preparation.md).

### Tests (branche Neon `test` uniquement)

| Suite                                                    | Résultat |
| -------------------------------------------------------- | -------- |
| Unitaires (shared 67, database 13, api 8)                | 88/88    |
| Intégration API — Sprint 4 (19 cas demandés + isolation) | 26/26    |
| Intégration API — Sprints 1 à 4 (régression complète)    | 102/102  |
| E2E Playwright — Sprints 1 à 4 (régression)              | 20/20    |
| Lint, Prettier, TypeScript strict, build                 | OK       |
| Contrôle des migrations destructrices                    | OK       |

### Corrections et changements transverses

- **Paiement rejoué en simultané** (même clé d'idempotence) : renvoyait `409 SALE_ALREADY_PAID` au
  lieu du paiement existant ; corrigé.
- **Délai des transactions Prisma** porté de 5 s (défaut) à 15 s : un encaissement de billets
  dépassait 5 s avec la latence Neon `us-east-2`.
- **Chiffre d'affaires du tableau de bord** filtré par activité (sinon les ventes parc auraient été
  comptées comme restaurant).
- Sessions de caisse, ventes et matériel ouverts aux organisations `PARK` (`POST /sales` et `/pos/*`
  restent restaurant) : deux assertions des Sprints 2 et 3 adaptées, l'isolation reste vérifiée.

### Nécessite encore une validation sur matériel réel

- Scan **caméra** sur la tablette des agents (HTTPS, lumière, billet froissé, QR sur téléphone).
- Lisibilité des **QR imprimés** sur imprimantes 58 et 80 mm réelles, coupe entre billets.
- Validation matérielle du Sprint 3 toujours à faire (connecteur Android non compilé).

### Problèmes restants

- **Arrêt des serveurs de test pendant une exécution E2E (2ᵉ occurrence, après celle du Sprint 3)** :
  l'API puis le frontend ont cessé de répondre au milieu de l'exécution (1 échec réel, 10 échecs
  `ERR_CONNECTION_REFUSED` en cascade), sans aucune sortie serveur ; aucun hook git ni autre processus
  en cause identifié. Relance isolée : **20/20**. Journaux conservés :
  `test-logs/e2e-2026-10-30T00-46-22-458Z.log` (incident), `test-logs/e2e-2026-10-30T00-50-04-235Z.log` (20/20).
- Remboursement d'un billet annulé : hors périmètre.
- Latence Neon `us-east-2` : encaissement de billets ≈ 5 s en test (≈ 12 allers-retours).

---

## Sprint 3 — POS Android, impression thermique, tiroir-caisse (validé)

### Fonctionnalités réalisées (logiciel)

1. **POS Android** : caisse tactile portrait / paysage (PWA `orientation: any`), écran maintenu allumé
   (Wake Lock), bandeau **hors connexion** qui suspend l'encaissement, prévention des doubles
   paiements conservée (idempotence Sprint 2), choix du **poste de caisse** mémorisé sur l'appareil.
2. **Connecteur matériel** : abstraction indépendante du fabricant (ESC/POS) ; pont Android
   `OcallHardware` limité à une origine HTTPS et à 4 commandes ; transports réseau (TCP 9100),
   Bluetooth (SPP) et USB (bulk) dans `apps/android` ; imprimante « Simulation » clairement signalée.
3. **Impression thermique** : tickets 58 mm (32 car.) et 80 mm (48 car.), accents (PC858), impression
   **après confirmation du paiement**, test d'impression, **réimpression contrôlée** (DUPLICATA, motif,
   permission, audit), gestion de l'imprimante indisponible avec nouvelle tentative, **historique des
   tentatives** ; un échec d'impression ne modifie jamais la vente (testé).
4. **Tiroir-caisse** : ouverture **automatique uniquement après paiement espèces confirmé**, une seule
   fois par paiement (unicité en base, concurrence testée), **jamais pour Wave**, ouverture manuelle
   réservée et **justifiée**, délai minimal anti-répétition (10 s serveur, 3 s connecteur), audit.
5. **Administration** (`/app/caisse/materiel`) : postes par établissement, connexion et adresse de
   l'imprimante (validée), format de papier, impression automatique, tiroir et broche, test, échecs
   récents, ouvertures du tiroir.

API : `/pos-terminals`, `/print-jobs`, `/drawer-events` ; migration additive (3 tables). Documentation :
[docs/MATERIEL-POS.md](docs/MATERIEL-POS.md), [apps/android/README.md](apps/android/README.md).

### Tests (branche Neon `test` uniquement)

| Suite                                            | Résultat |
| ------------------------------------------------ | -------- |
| Unitaires (shared 51, database 13, api 8)        | 72/72    |
| Intégration API — Sprints 1, 2 et 3 (régression) | 76/76    |
| E2E Playwright — Sprints 1, 2 et 3 (régression)  | 19/19    |
| Lint, Prettier, TypeScript strict, build         | OK       |
| Contrôle des migrations destructrices            | OK       |

Les tests matériels Sprint 3 utilisent l'imprimante **simulée** (marqués « [simulation matérielle] ») :
ils valident le parcours logiciel, **pas** le matériel physique.

### Nécessite encore une validation matérielle

- **Compilation du connecteur Android** : non compilé (pas de SDK Android ni de Gradle dans
  l'environnement de développement).
- Impression réelle **USB, Bluetooth, réseau**, en 58 et 80 mm, rendu des accents et de la coupe.
- Ouverture réelle du **tiroir-caisse** (broche 2 / 5), une seule fois par paiement.
- Comportement réel en coupure Wi-Fi, rotation et veille de la tablette.
- Protocole complet : [docs/MATERIEL-POS.md §7](docs/MATERIEL-POS.md).

### Problèmes restants

- **Latence vers Neon `us-east-2`** : ~300 ms par aller-retour mesurés ; une impression prend 4 à 6 s
  côté serveur en environnement de test (tiroir et ticket désormais demandés en parallèle). En
  production, API et base dans la même région ramèneront cela à quelques dizaines de millisecondes.
- **Arrêt des serveurs de test pendant une exécution E2E (1 occurrence)** : aucune sortie serveur dans
  le journal, réussite à la relance ; journal conservé (`test-logs/e2e-s3-2026-10-29T23-05-46-468Z.log`).
- **Problème PostgreSQL intermittent du Sprint 2** : **non réapparu** sur les exécutions du Sprint 3
  (3 exécutions d'intégration complètes, 76/76) ; surveillance maintenue, journaux conservés.
- Hors périmètre : paiement Wave effectif, KDS, impression de commandes cuisine, logo sur ticket,
  sélection d'imprimante par découverte réseau / Bluetooth (adresse saisie manuellement).

---

## Sprint 2 — Caisse POS (validé)

### Fonctionnalités réalisées

1. **Interface POS tactile** (`/app/caisse`) : grille d'articles par catégorie (cibles ≥ 44 px),
   choix de variante, ticket avec quantités, barre d'encaissement fixe en portrait ; testée en
   800×1280 et 1280×800 (aucun défilement horizontal). Établissement mémorisé sur l'appareil.
2. **Catalogue** (`/app/catalogue`) : catégories, produits, variantes, **tarifs par établissement**
   (FCFA, TTC), disponibilité, désactivation sans suppression.
3. **Panier, ventes, montants calculés par le serveur** : la caisse n'envoie que variante et quantité ;
   devis serveur à chaque modification du ticket ; prix figés sur la vente ; numéro par établissement.
4. **Sessions de caisse** : ouverture avec fond, espèces attendues en temps réel, fermeture avec
   espèces comptées, **écart calculé et historisé** (`/app/caisse/sessions`, journal d'audit).
5. **Paiement manuel en espèces** : montant remis, monnaie rendue calculée par le serveur, reçu ;
   chaque vente, paiement, annulation, ouverture et fermeture est journalisé.
6. **Wave — architecture préparatoire** : interface `PaymentProvider` et registre des moyens de
   paiement ; Wave est affiché « Non activé » et refusé par l'API (`PAYMENT_METHOD_UNAVAILABLE`).
   Aucun accès API Wave n'est revendiqué ni simulé.
7. **Historique et permissions** : historique filtrable (`/app/caisse/ventes`), détail, encaissement
   différé, annulation d'une vente non payée ; 6 nouvelles permissions (caissier : ses ventes
   uniquement ; cuisine : catalogue en lecture ; superviseur : supervision et annulation).
8. **Isolation multi-tenant** sur toutes les routes, et accès réservé aux métiers Restaurant
   (`403 MODULE_NOT_IN_PLAN` pour un parc), vérifiés par des tests.
9. **Tableau de bord** : chiffre d'affaires restaurant réellement encaissé (jour, 30 jours).

**Règle métier** : paiement et préparation sont deux statuts indépendants ; l'encaissement ne modifie
jamais `preparationStatus` (`NOT_SENT`), vérifié en base par un test d'intégration et affiché en caisse.

Robustesse : clés d'idempotence (vente, paiement) contre les doubles envois réseau, verrous de ligne
(double encaissement simultané → un seul paiement, testé), migration additive vérifiée par le contrôle
anti-destructif. Détails : [docs/CAISSE-POS.md](docs/CAISSE-POS.md).

### Tests (exécutés sur la branche Neon `test` uniquement)

| Suite                                      | Résultat |
| ------------------------------------------ | -------- |
| Unitaires (shared, database, api)          | 49/49    |
| Intégration API (Sprint 1 + Sprint 2)      | 59/59    |
| E2E Playwright (desktop, mobile, tablette) | 17/17    |
| Lint, Prettier, TypeScript strict, build   | OK       |
| Contrôle des migrations destructrices      | OK       |

Journaux complets de chaque exécution : `test-logs/` (non versionné, conservé localement ; envoyé
comme artefact par la CI en cas d'échec).

### Problèmes restants

- **Blocage intermittent non expliqué (1 occurrence)** : lors d'une exécution d'intégration, une
  transaction d'inscription est restée bloquée 732 s sur la branche Neon `test`, faisant échouer le
  fichier suivant. Non reproduit sur 4 exécutions complètes ultérieures (dans les deux ordres), y
  compris avec captures de `pg_stat_activity` : aucune contention de verrou observée. Journal conservé :
  `test-logs/integration-2026-10-29T20-33-12-703Z.log`. Hypothèse non vérifiée : coupure ou attente
  côté pooler Neon.
- **Restes de test** : une exécution interrompue a laissé 3 organisations sur la branche `test`
  (supprimées) ; le nettoyage purge désormais aussi les restes de plus d'une heure.
- **Crash ponctuel de Playwright sous Windows** (code `0xC0000409` au démarrage, aucun test exécuté),
  réussi à la relance ; journal conservé.
- **Latence** : base Neon en `us-east-2` ; un parcours complet de caisse prend ~1 min en E2E.
- **Hors périmètre** : impression thermique, tiroir-caisse, remises, TVA détaillée, remboursement,
  paiement partiel, envoi en cuisine (KDS), mode hors ligne, paiement Wave effectif.

---

## Sprint 1 — Socle SaaS (validé)

Authentification (Argon2id, sessions révocables, mot de passe initial imposé, réinitialisation),
organisations et métiers, établissements, employés et rôles RBAC, protection du dernier propriétaire,
abonnements en lecture (prix en base), espace Super Admin, charte graphique, CI, préparation Railway.
Détails : [README.md](README.md) et [docs/DEPLOIEMENT-RAILWAY.md](docs/DEPLOIEMENT-RAILWAY.md).
