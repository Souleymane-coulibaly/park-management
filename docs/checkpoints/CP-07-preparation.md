# Checkpoint CP-07 — préparation (Sprints 1 à 8)

Ce document prépare l'audit indépendant Codex CP-07. Il ne constitue pas l'audit lui-même.

## Contexte de décision

- **CP-03** (Sprints 1 à 4) : GO SOUS RÉSERVES ; A1, A2, A5 toujours ouvertes.
- **CP-04** et **CP-05** n'ont pas été réalisés ; leur préparation reste à auditer :
  [CP-04-preparation.md](CP-04-preparation.md), [CP-05-preparation.md](CP-05-preparation.md).
- **Sprint 7** (CinetPay) : plan présenté, **reporté** par le commanditaire le 30/10/2026 ; aucun code.
  **CP-06 n'existe donc pas** : la condition « ne pas commencer si CP-06 contient un NO-GO » ne pouvait
  pas être vérifiée ; le commanditaire a demandé de passer au Sprint 8.
- CP-07 doit donc couvrir les Sprints 1 à 6 non audités **et** le Sprint 8.

## Référentiel

- Branche `claude/sprint-8`, créée depuis `claude/sprint-6` (`6daaddc`). `claude/sprint-5`,
  `claude/sprint-6` et `claude/sprint-8` ne sont pas poussées.
- Base de développement préservée ; tests sur la branche Neon `test` uniquement ; pas de production.
- Fournisseur IA : OpenAI (choix du commanditaire) ; **aucun appel réel** effectué.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check
pnpm test
pnpm db:migrate:deploy:test
pnpm test:integration            # Sprints 1 à 8 — fournisseur IA simulé
pnpm build; pnpm test:e2e        # Sprints 1 à 8 — fournisseur IA simulé
```

## Points à vérifier — Sprint 8

1. **Garde-fous des appels réels** (`modules/ai/ai.config.ts`) : `none` par défaut ; `openai` exige la
   clé ET `AI_REAL_CALLS_ENABLED=true` ; `simulated` interdit en production ; clé jamais renvoyée ni
   journalisée ; erreurs du fournisseur sans détail technique.
2. **Quotas** (`ai-usage.service.ts`) : réservation sous verrou `FOR UPDATE` avant l'appel ; appels
   simultanés au-delà du plafond refusés (test 20) ; coûts marqués « estimation », modèle sans tarif
   « non estimable » ; aucune donnée de contenu dans `AiUsage`.
3. **Import** (`imports/`) : type par signature ; fichier jamais écrit ni conservé ; revalidation serveur
   (prix absent, prix non lu, prix hors limites, devise, doublons) ; publication réservée
   (ANALYZED → PUBLISHED), reprise sans recréation ; pas d'écrasement ; billets désactivés ;
   permissions par type d'import ; isolation (tests 1 à 9).
4. **Copilote** (`copilot/`) : registre fermé de fonctions en lecture ; arguments à clés exactes ;
   établissement de la session uniquement ; permissions par fonction ; requête SQL paramétrée de
   `best_day` ; contrôle des chiffres cités (tests 10 à 14).
5. **Commande vocale** (`voice/`) : références courtes, revalidation contre le catalogue de
   l'établissement ; aucune commande avant confirmation ; confirmation idempotente via le moteur
   existant ; non payée, non envoyée en cuisine (tests 15 à 19).
6. **Conservation** : purge des résultats et transcriptions à échéance, traces conservées.
7. **Modifications transverses** : `CatalogModule`, `TicketingModule`, `RestaurantModule` exportent
   leurs services ; `TicketCategoriesService.create` accepte `inactive` ; `api.ts` (web) factorise
   l'envoi et ajoute `apiUpload`.
8. **Migration** `20261030164331_intelligence_artificielle` : additive, 3 CHECK ajoutées à la main.

## Anomalies et limites

### Reportées (ouvertes)

A1 à A15 : voir CP-04 et CP-05. A11 (base Neon `test` : authentification refusée) **bloque toujours
l'exécution** des tests d'intégration et E2E des Sprints 6 et 8.

### Nouvelles au Sprint 8

| Anomalie                                            | Gravité                     | Impact et suite                                                                                                                                            |
| --------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A16 — impression navigateur non testée sur matériel | Moyenne                     | Voir CP-05                                                                                                                                                 |
| A17 — aucun essai réel du fournisseur IA            | **Haute (avant ouverture)** | Précision, latence, coût réels inconnus ; adaptateur OpenAI jamais exécuté contre l'API. Essai encadré à autoriser (docs/INTELLIGENCE-ARTIFICIELLE.md §10) |
| A18 — conditions de traitement des données OpenAI   | Haute (avant ouverture)     | Conservation, entraînement, région : à vérifier au contrat et à inscrire au registre RGPD avant tout appel réel                                            |
| A19 — purge sans tâche planifiée                    | Basse                       | Purge à la lecture et sur demande (même limite que A12)                                                                                                    |
| A20 — PDF : nombre de pages non borné               | Basse                       | Taille bornée à 10 Mo seulement ; coût d'un long PDF plus élevé                                                                                            |
| A21 — commande vocale absente de l'écran Caisse     | Basse                       | Disponible dans Commandes uniquement                                                                                                                       |
| A22 — Sprints 5, 6 et 8 empilés sans audit          | Haute (processus)           | Décisions du commanditaire ; CP-07 doit couvrir tout le périmètre                                                                                          |

## Critères proposés pour un GO

- Tests d'intégration et E2E des Sprints 1 à 8 exécutés sur Neon `test`, journaux complets conservés.
- Aucune faille d'isolation, d'injection ou d'écriture via le copilote.
- A17 et A18 traités **avant** toute activation réelle de l'IA (autorisation explicite requise).
