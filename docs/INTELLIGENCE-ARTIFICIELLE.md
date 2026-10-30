# Intelligence artificielle — import de carte, copilote, commande vocale (Sprint 8)

## 1. Ce qui est livré, et ce qui reste à valider

| Élément                                                       | État                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Abstraction `AiProvider`, quotas, coûts estimés, conservation | ✅ Implémentés ; tests unitaires exécutés                                                              |
| Import de carte et de tarifs, copilote, commande vocale       | ✅ Implémentés ; tests d'intégration et E2E écrits avec le fournisseur **simulé**                      |
| Fournisseur OpenAI (GPT-5, transcription)                     | ⚠️ Écrit d'après le SDK officiel `openai@7.34.0`, **jamais appelé** (aucune clé, aucun appel autorisé) |
| Qualité réelle de lecture des cartes et de la voix            | ⚠️ **Non évaluée** : seul un essai réel autorisé le dira                                               |

**Tests simulés ≠ validation réelle.** Le fournisseur simulé est déterministe : il éprouve les règles
du serveur (validation, isolation, confirmation humaine, quotas, pannes), pas la qualité d'un modèle.
Le français est la seule langue visée ; aucune autre langue n'est annoncée sans essai réel.

## 2. Architecture

```
apps/api/src/modules/ai/
  providers/ai-provider.ts       interface AiProvider (extractFromDocument, structureText, runWithTools, transcribe)
  providers/openai.provider.ts   OpenAI : API Responses + transcription audio
  providers/simulated.provider.ts fournisseur simulé (développement, tests ; interdit en production)
  ai-usage.service.ts            point de passage obligé : activation, quota sous verrou, consommation, purge
  imports/                       import de carte (restaurant) et de grille tarifaire (parc)
  copilot/                       copilote : registre fermé de fonctions analytiques en lecture seule
  voice/                         commande vocale : transcription → panier proposé → confirmation
```

- Les règles métier ne dépendent que de `AiProvider` : changer de fournisseur ne réécrit aucune règle.
- Tout appel passe par `AiUsageService.run()` : fonctionnalité activée, quota réservé **avant** l'appel
  (verrou sur la ligne `AiSettings` : des appels simultanés ne dépassent pas le plafond), consommation
  et coût estimé enregistrés ensuite, erreurs traduites en messages clairs (« Vous pouvez continuer sans IA »).
- Réutilisation : publication via `CatalogService` et `TicketCategoriesService`, commande via
  `RestaurantOrdersService` (moteur de vente unique), filtres d'établissement existants.

## 3. Fournisseur retenu : OpenAI

Choix du commanditaire (30/10/2026), après comparaison (Anthropic, OpenAI, Google, Mistral).

| Usage                           | Modèle par défaut | API                                  |
| ------------------------------- | ----------------- | ------------------------------------ |
| Import de carte et de tarifs    | `gpt-5`           | Responses, sortie JSON stricte       |
| Copilote                        | `gpt-5`           | Responses, fonctions strictes        |
| Commande vocale (panier)        | `gpt-5`           | Responses, sortie JSON stricte       |
| Commande vocale (transcription) | `gpt-transcribe`  | Transcriptions audio, `language: fr` |

GPT-5 ne transcrit pas la voix : la transcription utilise le modèle dédié. Chaque modèle est réglable
par variable d'environnement (ex. `gpt-5-mini`, environ 5 fois moins cher).

**Options de confidentialité** : `store: false` (les réponses ne sont pas conservées pour être
réutilisées) ; aucune clé côté navigateur. La politique d'OpenAI en vigueur à l'activation
(conservation pour la détection d'abus, non-utilisation des données de l'API pour l'entraînement) est
à **vérifier dans le contrat** avant d'ouvrir le service réel, et à reporter dans le registre RGPD.

### Données transmises (minimisation)

| Fonctionnalité | Envoyé au fournisseur                                                             | Jamais envoyé                        |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| Import         | La photo ou le PDF de la carte / grille                                           | Identifiants, clients, ventes        |
| Copilote       | La question, le nom de l'établissement, les résultats agrégés des fonctions       | Données clients, identifiants, SQL   |
| Vocal          | L'enregistrement, les noms et références courtes (`p1`, `t1`) des plats et tables | Prix, identifiants internes, clients |

## 4. Import de carte et de tarifs

Parcours (`/app/catalogue/import-ia`, `/app/billetterie/import-ia`) : photographier ou choisir un
fichier → analyser → revoir et corriger chaque ligne → publier.

- **Formats** : JPEG, PNG, WebP, PDF ; type vérifié par la signature du fichier, 10 Mo au plus.
- **Fichier non conservé** : traité en mémoire ; seuls l'empreinte SHA-256, le nom, le type et la taille
  sont gardés (traçabilité). Résultat effacé à l'échéance de conservation.
- **Jamais de prix inventé** : le serveur revalide la réponse ; un prix absent reste vide, un prix qui
  ne figure pas dans le texte lu est retiré, un prix ambigu est signalé. Aucune ligne sans prix saisi
  ne peut être publiée.
- **Doublons** : rapprochement avec le catalogue existant et dans le document ; une ligne doublon est
  ignorée par défaut ; un nom déjà utilisé est refusé (`PRODUCT_NAME_TAKEN`) : **jamais d'écrasement**.
- **Publication** : réservée (pas de double publication), par les services existants ; en cas d'échec
  en cours, les lignes déjà créées sont mémorisées et non recréées. Billets créés **désactivés**.
- **Droits** : `catalog.manage` (carte), `ticketing.manage` (tarifs) ; isolation par organisation et
  établissement d'affectation.

## 5. Copilote analytique (`/app/copilot`)

- **Lecture seule par construction** : le modèle ne peut appeler que 12 fonctions de lecture
  (chiffre d'affaires et panier moyen, produits les plus vendus, stocks bas, entrées au parc, meilleur
  jour, commandes préparées, billets vendus ; depuis le Sprint 9B : ventes par produit et par heure,
  produits qui rapportent le plus, heures de pointe, jour le plus fréquenté, marges estimées par
  catégorie — voir [ANALYSES.md](ANALYSES.md) §8). Aucune fonction d'écriture, aucun SQL libre, aucune commande.
- **Établissement imposé par le serveur** : choisi par l'utilisateur dans son périmètre, revérifié ;
  le modèle ne fournit jamais d'établissement (un argument en trop est refusé, `INVALID_ARGUMENTS`).
- **Périodes** : liste fermée (`today`, `yesterday`, `this_week`, `last_7_days`, `this_month`,
  `last_30_days`), calculées dans le fuseau de l'établissement, toujours affichées.
- **Chiffres** : calculés par le serveur et affichés tels quels ; si la phrase rédigée par l'IA cite un
  nombre absent des résultats, elle est écartée (`grounded: false`).
- Données manquantes signalées ; question ambiguë → demande de précision.
- **Droits** : `ai.copilot` (propriétaire, administrateur, superviseur) ; chaque fonction exige en plus
  sa permission (`sale.read_all`, `stock.read`, `analytics.margins`) et l'activité de l'établissement.
- Les fonctions du Sprint 9B réutilisent le service d'analyses (`modules/analytics`).

## 6. Commande vocale (Commandes → « Commande vocale »)

1. L'employé appuie sur « Enregistrer » (aucun enregistrement sans geste explicite), une minute au plus.
2. Transcription, puis panier proposé à partir du **catalogue réel** de l'établissement : seules les
   références fournies sont acceptées ; un produit absent est marqué « absent du catalogue ».
3. Quantité ou produit douteux : « à confirmer ». Table reconnue par son nom.
4. L'employé corrige et **valide** : la commande est créée par le moteur existant — prix calculés par le
   serveur, **non payée, non envoyée en cuisine**. Validation idempotente (double appui sans doublon).

L'audio n'est jamais conservé ; la transcription et le panier proposé sont effacés à échéance.
Droits : `pos.sell`, session de caisse ouverte (comme une commande saisie à la main).

## 7. Coûts et quotas

- Une ligne `AiUsage` par appel : fonctionnalité, établissement, modèle, jetons ou secondes audio,
  coût **estimé** (micro-dollars), durée, statut. Aucun contenu.
- Tarifs d'estimation (`packages/shared/src/ai.ts`, relevés le 30/10/2026) : `gpt-5` 1,25 $ / 10 $ par
  million de jetons (entrée / sortie), `gpt-5-mini` 0,25 $ / 2 $, `gpt-transcribe` environ 0,0045 $ la
  minute (source secondaire). Un modèle sans tarif connu est « non estimable », jamais compté nul.
- Réglages par organisation (`/app/parametres/ia`, `ai.manage`) : chaque fonctionnalité activable,
  plafond mensuel d'appels (500 par défaut), seuil d'alerte (80 %), conservation (30 jours).
  Une commande vocale consomme **2 appels** (transcription + panier).
- Ordre de grandeur estimé avec `gpt-5`, pour un restaurant (2 imports, 300 questions, 1 500 commandes
  vocales par mois) : environ 25 $ ≈ 15 000 FCFA ; avec `gpt-5-mini`, environ 5 fois moins. À mesurer
  lors de l'essai réel.

## 8. Protection des données

- Isolation multi-tenant et RBAC sur chaque route ; imports et brouillons invisibles hors périmètre (404).
- Clé API uniquement côté serveur ; erreurs sans détail technique.
- Fichiers et audio en mémoire, jamais écrits ni conservés ; conservation configurable (1 à 365 jours)
  des résultats et transcriptions, purge à la lecture et à la demande (`POST /ai/purge`).
- **Injection de prompt** : les contenus (photo, PDF, transcription, question) sont déclarés comme
  données ; sorties en schéma strict ; revalidation serveur ; copilote sans fonction d'écriture ;
  chiffres contrôlés. Testé (test 14).
- Audit : analyse et publication d'import, brouillon et confirmation de commande vocale, réglages,
  alerte de quota.

## 9. Variables d'environnement

Voir `apps/api/.env.example`. `AI_PROVIDER` (`none` par défaut, `simulated`, `openai`),
`AI_REAL_CALLS_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL` (+ surcharges par fonctionnalité),
`OPENAI_TRANSCRIBE_MODEL`, `AI_TIMEOUT_MS`, `AI_USD_XOF_RATE`. Le démarrage échoue si `openai` est
demandé sans clé ou sans `AI_REAL_CALLS_ENABLED=true`, et si `simulated` est demandé en production.

## 10. Activer les appels réels (après autorisation du commanditaire)

1. Créer une clé API OpenAI dédiée, avec un plafond de dépense au niveau du compte OpenAI.
2. Vérifier les conditions de traitement des données (conservation, entraînement, région) ; mettre à
   jour le registre RGPD et la politique de confidentialité.
3. Renseigner `OPENAI_API_KEY`, `AI_PROVIDER=openai`, `AI_REAL_CALLS_ENABLED=true` (jamais dans Git).
4. Essai réel encadré : 3 cartes réelles (photo nette, photo floue, PDF), 20 questions, 20 commandes
   dictées dans un environnement bruyant ; mesurer précision, durée et coût réels.
5. Ajuster modèles, plafonds et instructions, puis consigner les résultats (séparés des tests simulés).

## 11. API (`/api/v1`)

| Route                                                                                         | Permission                    |
| --------------------------------------------------------------------------------------------- | ----------------------------- |
| `GET /ai/status`                                                                              | `dashboard.read`              |
| `GET/PUT /ai/settings`, `GET /ai/usage`, `POST /ai/purge`                                     | `ai.manage`                   |
| `POST /ai/imports/catalog`, `GET /ai/imports/catalog`, `POST /ai/imports/:id/publish/catalog` | `catalog.manage` (restaurant) |
| `POST /ai/imports/tickets`, `GET /ai/imports/tickets`, `POST /ai/imports/:id/publish/tickets` | `ticketing.manage` (parc)     |
| `GET /ai/imports/:id`, `POST /ai/imports/:id/discard`                                         | selon le type d'import        |
| `POST /ai/copilot/ask`                                                                        | `ai.copilot`                  |
| `POST /ai/voice-orders`, `GET …/:id`, `POST …/:id/confirm`, `POST …/:id/discard`              | `pos.sell` (restaurant)       |

## 12. Données

Migration `20261030164331_intelligence_artificielle`, additive : tables `AiSettings`, `AiUsage`,
`AiImport`, `VoiceOrderDraft` et 5 énumérations ; contraintes CHECK ajoutées à la main (plafond,
seuil, conservation). Option `inactive` ajoutée à la création de catégorie de billet (sans effet sur
l'existant).

## 13. Limites connues

- Aucun essai réel : précision, latence et coût réels inconnus.
- Nombre de pages d'un PDF non borné séparément (seule la taille l'est).
- Purge « à la lecture » et sur demande : pas de tâche planifiée (comme A12).
- Copilote sans mémoire de conversation (chaque question est indépendante).
- Commande vocale proposée dans l'écran Commandes, pas encore dans l'écran Caisse.
- iOS/Safari : enregistrement selon le support de `MediaRecorder` (formats mp4 acceptés).
