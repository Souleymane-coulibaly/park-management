# Ocall AI Core — moteur IA commun d'Ocall Suite

Ocall AI Core est le moteur IA unique de toutes les applications métier d'Ocall Suite : Ocall Park,
Ocall School et les applications à venir. Il a été extrait du moteur IA de Park pendant le Sprint 8
d'Ocall School. Il n'y a pas deux moteurs IA indépendants.

## 1. Audit du moteur IA de Park (avant consolidation)

| Fonctionnalité                         | Statut      | Preuves                                                                                                        |
| -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Copilote analytique en lecture seule   | Implémenté  | `POST /ai/copilot/ask`, 12 outils, écran `/app/copilot`, tests `sprint8-ia` et `sprint9b-copilot-saas`         |
| Import de carte et de grille tarifaire | Implémenté  | `/ai/imports/*`, écrans `catalogue/import-ia` et `billetterie/import-ia`, publication après validation humaine |
| Commande vocale                        | Implémentée | `/ai/voice-orders/*`, dialogue des commandes, confirmation humaine                                             |
| Réglages, quotas, consommation         | Implémentés | `/ai/status`, `/ai/settings`, `/ai/usage`, `/ai/purge` ; quota de l'offre (Sprint 11B)                         |

Fournisseurs : `none`, `simulated` (interdit en production) et `openai`. Les appels réels exigent
`OPENAI_API_KEY` **et** `AI_REAL_CALLS_ENABLED=true`. La clé reste côté serveur.

Limites relevées, toutes traitées par la consolidation :

- prompts écrits en dur dans le code, sans version ;
- pas de limiteur de débit propre à l'IA ;
- erreurs du fournisseur jamais journalisées côté serveur ;
- réservations de quota « en cours » jamais nettoyées après une interruption ;
- moteur couplé au domaine Park : base Park, contexte Park, liste de fonctionnalités figée, fournisseur
  simulé contenant des heuristiques Park.

## 2. Architecture cible

Le moteur est un module NestJS global dans le monolithe modulaire. Il n'introduit ni microservice ni
infrastructure supplémentaire.

```
apps/api/src/ai-core/
  ai-core.module.ts        module global : fournisseur configuré + orchestrateur
  ai-core.config.ts        configuration commune (fournisseur, modèles par fonctionnalité, débit, orphelins)
  ai-provider.ts           AI Provider Adapter : interface AiProvider, AiProviderError
  providers/openai.provider.ts     OpenAI (API Responses, transcription)
  providers/simulated.provider.ts  simulé générique + scénarios inscrits par les applications
  ai-prompts.ts            Prompt Management : prompts versionnés (id application.nom + version)
  ai-context.ts            Tenant & Application Context (AiCallContext) et port de stockage (AiUsageStore)
  ai-gateway.service.ts    AI Request Orchestrator : débit → fournisseur → réservation → appel → consommation
  ai-rate-limiter.ts       Rate Limiting : par utilisateur et par organisation, par application
  ai-tools.ts              Tool Calling sécurisé : registre fermé, arguments stricts, plafond d'appels
```

| Composant demandé                      | Réalisation                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AI Provider Adapter                    | `AiProvider`, implémentations OpenAI et simulée, fabrique dans `AiCoreModule`                                                 |
| Prompt Management                      | `defineAiPrompt` : version obligatoire. Un texte modifié sans nouvelle version est refusé.                                    |
| AI Request Orchestrator                | `AiGatewayService.run`                                                                                                        |
| Tool Calling sécurisé                  | `toolExecutor`, `exactKeys`, `strictObject`                                                                                   |
| Usage Tracking / Token & Cost Tracking | Port `AiUsageStore` : jetons, coût estimé, latence, version du prompt, erreurs                                                |
| Quota Management                       | `AiUsageStore.reserve` : fonctionnalité activée et plafond de la période, atomique sous verrou, dans la base de l'application |
| Rate Limiting                          | `AiRateLimiter` : `AI_RATE_LIMIT_USER_PER_MINUTE`, `AI_RATE_LIMIT_ORG_PER_MINUTE`                                             |
| Error Handling                         | Codes communs `AI_*`, statuts HTTP uniques, message « Vous pouvez continuer sans IA »                                         |
| Audit Logging                          | Journal technique `OcallAiCore` (identifiants et code, jamais de contenu) ; audit métier par l'application                    |
| Nettoyage des réservations orphelines  | Toutes les 5 min, les réservations en cours depuis plus de `AI_ORPHAN_AFTER_MS` passent en échec `AI_ABANDONED`               |
| Tenant & Application Context           | `AiCallContext` : application, organisation, établissement, utilisateur, rôle, opération, fuseau                              |

### Contexte et isolation

Chaque appel porte un `AiCallContext` construit par l'application à partir de **sa** session :

- l'application (`park`, `school`, etc.) ;
- l'organisation et l'établissement contrôlé ;
- l'utilisateur authentifié ;
- son rôle ;
- l'opération autorisée.

Le modèle ne fournit jamais ces valeurs. Chaque application inscrit son stockage auprès de l'orchestrateur
(`registerApplication`), dans sa propre base. Les quotas, la consommation et les compteurs de débit sont
donc séparés par application. Le moteur n'exécute jamais de SQL ni de commande proposés par le modèle :
les outils sont des lectures de services validés côté serveur.

### Brancher une application

1. Implémenter `AiUsageStore` dans la base de l'application : réservation sous verrou, succès, échec,
   orphelins.
2. L'inscrire au démarrage de son module avec `gateway.registerApplication('<app>', store)`.
3. Déclarer ses prompts avec `defineAiPrompt({ id: '<app>.<nom>', version, instructions })`.
4. Appeler `gateway.run(ctx, { model: gateway.model(operation), prompt }, (provider) => …)`.
5. Facultatif : inscrire des scénarios de simulation pour les tests (`registerAiSimulation`).

## 3. Composants réutilisés et refactorisés

- **Réutilisés tels quels :**
  - interface `AiProvider` et fournisseur OpenAI (déplacés) ;
  - `estimateAiCostMicroUsd` et `numbersAreGrounded` (paquet partagé) ;
  - les 12 outils analytiques de Park, leurs schémas et leur validation.
- **Refactorisés :**
  - `AiUsageService` de Park : réservation déplacée dans `ParkAiUsageStore`, appels délégués à
    l'orchestrateur ;
  - copilote de Park : exécuteur d'outils du cœur ;
  - fournisseur simulé : générique, avec les heuristiques Park déplacées dans `park-ai-simulation.ts` ;
  - configuration : modèles par fonctionnalité sans liste figée, alias `TICKET_IMPORT` vers
    `CATALOG_IMPORT` conservé.
- **Prompts Park versionnés :** `park.copilot@1`, `park.import@1`, `park.voice_order@1`. Leurs textes sont
  inchangés.
- **Contrats d'API Park inchangés :**
  - routes ;
  - formes de réponse ;
  - codes et statuts (`AI_NOT_CONFIGURED` 503, `AI_FEATURE_DISABLED` 403, `AI_QUOTA_EXCEEDED` 429,
    `AI_LIMIT_ABOVE_PLAN` 409, codes du fournisseur) ;
  - sémantique de comptage (toutes les lignes du mois comptent) ;
  - actions d'audit.

  Un seul code est nouveau, `AI_TOO_MANY_REQUESTS` (429, limitation de débit). Il ne crée pas d'import en
  échec.

- **Migration Park strictement additive :** `20261111000000_ai_core_versions_prompts` ajoute `AiUsage.promptId`
  et `AiUsage.promptVersion`, tous deux facultatifs. Pendant le développement, elle n'est appliquée que sur
  des bases jetables. Sur les bases Park réelles, elle ne sera appliquée qu'au déploiement, avec accord.

## 4. Configuration

| Variable                        | Défaut            | Rôle                                                             |
| ------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `AI_PROVIDER`                   | `none`            | `none`, `simulated` (interdit en production) ou `openai`         |
| `AI_REAL_CALLS_ENABLED`         | absent            | `true` est obligatoire avec `openai`                             |
| `OPENAI_API_KEY`                | absent            | Clé secrète, côté serveur seulement                              |
| `OPENAI_MODEL`                  | `gpt-5`           | Modèle par défaut                                                |
| `OPENAI_MODEL_<FONCTIONNALITÉ>` | absent            | Modèle d'une fonctionnalité (`COPILOT`, `SCHOOL_TEACHING`, etc.) |
| `OPENAI_TRANSCRIBE_MODEL`       | `gpt-transcribe`  | Transcription vocale                                             |
| `AI_TIMEOUT_MS`                 | `60000`           | Délai maximal d'un appel                                         |
| `AI_USD_XOF_RATE`               | `600`             | Taux indicatif des coûts estimés                                 |
| `AI_RATE_LIMIT_USER_PER_MINUTE` | `60`              | Débit par utilisateur et par application                         |
| `AI_RATE_LIMIT_ORG_PER_MINUTE`  | `300`             | Débit par organisation et par application                        |
| `AI_ORPHAN_AFTER_MS`            | 4 × délai + 1 min | Libération des réservations restées en cours                     |

Avant toute activation d'appels réels en production, il faut vérifier les garanties contractuelles et de
protection des données du fournisseur.

## 5. Limites

- La limitation de débit est en mémoire, par instance d'API : sur plusieurs instances, la limite effective
  est multipliée par leur nombre. Le quota mensuel, lui, reste exact, car il est compté en base sous verrou.
- Le nettoyage des réservations orphelines tourne dans chaque instance (opération idempotente).
- Tests : uniquement avec le fournisseur simulé, aucun appel payant.
