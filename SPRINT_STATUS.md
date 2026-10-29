# Ocall Park — suivi des sprints

| Sprint | Périmètre                                         | Branche           | Statut                                                               |
| ------ | ------------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| 1      | Socle SaaS multi-tenant, frontend, établissements | `claude/sprint-1` | ✅ Validé                                                            |
| 2      | Caisse POS restaurant                             | `claude/sprint-2` | ✅ Validé                                                            |
| 3      | POS Android, impression thermique, tiroir-caisse  | `claude/sprint-3` | 🟡 Terminé, en attente de validation (validation matérielle à faire) |
| 4      | —                                                 | —                 | ⛔ Non démarré (accord requis)                                       |

Environnements : base Neon de **développement** (préservée), branche Neon **`test`** réservée aux
tests automatisés, base de **production non configurée**. Aucune fusion dans `main`, aucun déploiement.
Checkpoint Codex suivant : **CP-02** (Sprints 1 à 3), voir `docs/checkpoints/CP-02-preparation.md`.

---

## Sprint 3 — POS Android, impression thermique, tiroir-caisse

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
