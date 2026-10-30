# Ocall Park — suivi des sprints

| Sprint | Périmètre                                         | Branche           | Statut                                            |
| ------ | ------------------------------------------------- | ----------------- | ------------------------------------------------- |
| 1      | Socle SaaS multi-tenant, frontend, établissements | `claude/sprint-1` | ✅ Validé                                         |
| 2      | Caisse POS restaurant                             | `claude/sprint-2` | ✅ Validé                                         |
| 3      | POS Android, impression thermique, tiroir-caisse  | `claude/sprint-3` | ✅ Validé (validation matérielle à faire)         |
| 4      | Billetterie Parc, QR codes, contrôle d’accès      | `claude/sprint-4` | 🟡 Terminé — en attente de validation et de CP-03 |

Environnements : base Neon de **développement** (préservée), branche Neon **`test`** réservée aux
tests automatisés, base de **production non configurée**. Aucune fusion dans `main`, aucun déploiement.
Checkpoint Codex : CP-02 non réalisé (démarrage du Sprint 4 accepté sans ce rapport) ; le prochain audit, **CP-03**, couvrira les Sprints 1 à 4.

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
