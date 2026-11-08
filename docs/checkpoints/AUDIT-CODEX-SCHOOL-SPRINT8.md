# Ocall School, Sprint 8 : instructions pour l'audit indépendant Codex

Audit en lecture seule de la branche `claude/school-sprint-8`, à partir de `ab1f9f6` (Sprint 7 livré).
Interdits : modifier un fichier, lancer une migration, faire un appel réseau, accéder à une base Neon.
Données fictives uniquement.

Le Sprint 8 compte trois phases, validées par le client :

1. **Reporting consolidé** : tableau de bord de direction, rapports pédagogique, d'assiduité et financier,
   exports PDF, XLSX et CSV, vues enregistrées, historique des opérations sensibles.
2. **Ocall AI Core** : moteur IA unique de toutes les applications métier, extrait du moteur IA de Park.
   Park est rebranché dessus sans changement de règles métier ni de contrats d'API.
3. **Ocall School AI** : copilote de direction, assistant pédagogique, analyse scolaire, sur Ocall AI Core.

## Périmètre

- **Partagé** :
  - `packages/shared/src/school-reporting.ts` (calculs statistiques) ;
  - `school-ai.ts` (constantes IA) ;
  - `school.ts` (7 permissions : `school.reports.*`, `school.audit.read`, `school.ai.*`) ;
  - `school-i18n.ts` (textes FR/AR `rep.*`, `audit.*`, `ai.*`).
- **Reporting (API School)** :
  - `school-reporting.service.ts`, `school-reporting.controller.ts`, `school-reporting.dto.ts` ;
  - `school-report-export.ts`, `school-report-builders.ts` ;
  - migration `20261111000000_reporting_vues_enregistrees`.
- **Ocall AI Core** (`apps/api/src/ai-core/`) :
  - `ai-core.module.ts`, `ai-core.config.ts`, `ai-provider.ts` ;
  - `providers/openai.provider.ts` et `providers/simulated.provider.ts` ;
  - `ai-prompts.ts`, `ai-context.ts`, `ai-gateway.service.ts`, `ai-rate-limiter.ts`, `ai-tools.ts`.
- **Park rebranché** (`apps/api/src/modules/ai/`) :
  - `ai-usage.service.ts`, `park-ai-usage.store.ts`, `park-ai-simulation.ts` ;
  - `copilot/copilot.service.ts`, `copilot/copilot.prompt.ts`, `copilot/analytics-tools.ts` ;
  - `imports/*`, `voice/voice-order.service.ts` ;
  - migration Park additive `20261111000000_ai_core_versions_prompts`.
- **Ocall School AI** (`apps/api/src/modules/school/ai/`) :
  - usage store, prompts, outils, copilote, assistant, analyse, PDF, simulation, contrôleur, DTO ;
  - migration `20261112000000_ocall_school_ai`.
- **Tests** :
  - garde bloquante des bases de test : `packages/database/src/test-database.ts`
    (`assertDisposableTestDatabases`), appelée par `apps/api/test/helpers.ts` ;
  - `apps/api/test/school-sprint8.integration.spec.ts`, `school-sprint8-ai.integration.spec.ts`,
    `ai-core.integration.spec.ts` ;
  - `src/ai-core/ai-core.spec.ts`, `src/modules/school/ai/school-ai.spec.ts` ;
  - `school-boundaries.spec.ts`.
- **Web** :
  - `apps/web/src/app/school/{rapports,historique,ia}/page.tsx` ;
  - `components/school/{school-reports,school-ai}.tsx`.
- **Documentation** : `docs/OCALL-SCHOOL.md` (sections 13 bis, 13 ter et 14), `docs/OCALL-AI-CORE.md`.

## Choix validés par le client

- Le Sprint 8 de base d'abord, puis l'IA en complément.
- Un seul moteur IA (Ocall AI Core), indépendant des applications. Chaque application inscrit son stockage
  dans sa propre base.
- Fournisseurs OpenAI et simulé réutilisés ; tests avec le simulé uniquement.
- Prompts versionnés, avec la version tracée en base pour chaque appel, y compris dans une migration Park
  additive.
- Limitation de débit, journal des erreurs du fournisseur, nettoyage des réservations orphelines, découplage
  de Park.
- Tests d'intégration uniquement sur des bases locales jetables, derrière une garde bloquante.
- L'IA de School est désactivée par défaut, puis activée établissement par établissement.

## Questions prioritaires

1. **Isolation** :
   - organisation, établissement et périmètre dans chaque rapport, export, vue, conversation, contenu et
     appel IA ;
   - aucun accès croisé entre applications Park et School (stockages, quotas, compteurs de débit) ;
   - historique d'audit limité au client et réservé à la direction du groupe.
2. **Permissions** :
   - le financier exige `school.finance.reports` à chaque point d'entrée (rapport, export, vue, outil
     IA) ;
   - l'enseignant est limité à ses affectations dans l'assistant pédagogique ;
   - les contenus et conversations sont propres à leur auteur.
3. **IA** :
   - aucun SQL ni aucune commande proposés par le modèle ne sont exécutés ;
   - arguments d'outils stricts ;
   - contexte toujours issu de la session ;
   - contrôle des chiffres (décimales à la française) ;
   - aucune donnée nominative d'élève envoyée au fournisseur ;
   - aucune écriture dans les données scolaires ;
   - validation humaine avant tout PDF d'un contenu ;
   - protection contre l'injection de prompt ;
   - clé jamais renvoyée.
4. **Ocall AI Core** :
   - réservation atomique du quota ;
   - consommation toujours enregistrée, y compris en échec ;
   - orphelins libérés ;
   - débit limité avant la réservation ;
   - pas de régression ni de cycle d'import pour Park ;
   - contrats Park inchangés : routes, réponses, codes ; `AI_TOO_MANY_REQUESTS` ne crée pas d'import en
     échec.
5. **Reporting** :
   - moyennes du moteur du Sprint 4 sans réinterprétation ;
   - aucune lecture hors transaction pendant un instantané ;
   - bornes de coût (`REPORT_MAX_CLASS_PERIODS`, plafond d'export) ;
   - exports conformes aux filtres, sans données sensibles inutiles.
6. **Migrations** : strictement additives, cohérentes avec les schémas.
7. **Garde des bases de test** : bloquante, sans contournement involontaire (CI, second démarrage dans un
   même fichier).

## Format attendu

Verdict (GO, GO SOUS RÉSERVES ou NO GO), puis anomalies classées de P0 à P3, chacune avec le fichier, la
ligne, un scénario concret et une correction proposée.

## Corrections après la passe 1 (NO GO : 1 P1, 8 P2, 3 P3)

- **P1, données nominatives :** `SchoolAiPrivacyService.protect` contrôle les textes libres **avant** tout
  appel au fournisseur : question du copilote, sujet, objectifs, consigne de régénération, ainsi que le
  titre et les sections renvoyés (y compris les textes saisis à la main).
  - Un texte qui cite un élève ou un responsable de l'établissement est refusé (`AI_PERSONAL_DATA`, aucun
    appel réservé) : prénom et nom côte à côte, dans un ordre ou l'autre, en latin ou en arabe, ou
    matricule.
  - Les adresses électroniques et les téléphones sont masqués.
- **P2, contenu validé modifié par une régénération :** toute écriture d'un brouillon (modification,
  régénération, validation) est conditionnelle (`writeDraft`) : seulement si le contenu est encore
  `DRAFT` et dans la version lue (`updatedAt`), sinon `AI_DOCUMENT_CHANGED` (409). La validation accepte la
  version relue par l'auteur ; l'écran valide la version qu'il vient d'enregistrer. Aucune transaction
  n'est ouverte pendant l'appel IA.
- **P2, affectation non revérifiée :** la régénération revérifie la classe, la matière et l'affectation
  active de l'enseignant. Ses anciens contenus restent consultables.
- **P2, contrôle des chiffres :** les chiffres autorisés ne viennent plus que des résultats du serveur (et
  de l'identité de l'école), jamais de la question. Les chiffres arabes, persans et les séparateurs arabes
  sont normalisés avant comparaison (`extractNumbers`, paquet partagé ; contrôle plus strict pour Park
  aussi). Le copilote de Park, lui, garde la question parmi ses références : son comportement n'a pas été
  modifié (réserve, à traiter avec Park).
- **P2, libellé de période hors périmètre :** chaque rapport déclare ses filtres appliqués
  (`SCHOOL_REPORT_FILTERS`).
  - Un filtre inapplicable est refusé (`REPORT_FILTER_UNSUPPORTED`).
  - Une période d'une autre année est refusée (`REPORT_PERIOD_OUTSIDE_YEAR`).
  - Les libellés des exports viennent des seuls objets autorisés par `header`.
  - Les vues enregistrées ne gardent que les filtres applicables.
- **P2, filtre de classe du tableau de bord :** le tableau de bord n'accepte plus aucun filtre
  (établissement entier, mention à l'écran). Les filtres affichés suivent `SCHOOL_REPORT_FILTERS`.
- **P2, effectif insuffisant dans les exports :** colonne « Effectif insuffisant » dans les tableaux
  d'établissement et de classes (PDF, XLSX, CSV).
- **P2, garde des bases de test :**
  - identité canonique commune (`databaseIdentity` : `localhost`, `127.0.0.1` et `::1` équivalents, port
    effectif, nom décodé) ;
  - `NODE_ENV` d'origine capturé avant son écrasement par `setup-env.ts` (`OCALL_ORIGINAL_NODE_ENV`).
- **P2, consommation perdue lors des échecs :** `AiProviderError.usage` transporte les jetons déjà
  rapportés (tours réussis du copilote, réponse refusée, incomplète ou illisible). `AiUsageStore.fail` les
  enregistre avec le coût estimé (Park et School). Le compteur School des coûts inconnus couvre aussi les
  échecs qui ont consommé des jetons.
- **P3, versionnement des prompts :** manifeste versionné d'empreintes (`ai-prompt-manifest.ts`) vérifié
  par un test ; un texte modifié sans nouvelle version échoue.
- **P3, plafond documentaire :** les contenus archivés ne comptent plus.
- **P3, limites d'historique non atomiques :** laissé en réserve (dépassement de quelques unités possible
  sous concurrence, sans enjeu de sécurité).

Vérification ciblée :

- unitaires : 49 tests IA, 26 pour la garde des bases, 16 pour l'IA partagée, 8 pour le manifeste ;
- intégration sur bases jetables : `school-sprint8` 12/12, `school-sprint8-ai` 21/21, `ai-core` 3/3,
  `sprint8-ia` 15/15 ;
- mutations détectées : confidentialité retirée, affectation non revérifiée, question réintroduite dans le
  contrôle des chiffres.

## Corrections après la passe 2 (NO GO : P1 partiel, 4 P2 partiels, 3 P2 nouveaux, 3 P3)

- **P1, confidentialité de toute la requête sortante :**
  - les clés de section sont imposées par le type de contenu (`SCHOOL_AI_SECTIONS`) en modification
    (`AI_SECTION_INVALID`) et en régénération : aucune clé libre ne part au fournisseur ;
  - une personne est reconnue dès que tous les mots de son prénom et tous ceux de son nom figurent dans
    le texte, où qu'ils soient (« prénom : Awa ; nom : Traoré ») ;
  - la recherche porte sur chaque texte puis sur l'ensemble des champs d'une requête (prénom dans un champ,
    nom dans l'autre).
- **P2, version relue :**
  - la version est obligatoire pour modifier, régénérer et valider ;
  - `writeDraft` verrouille la ligne, revérifie état et version, puis renvoie la ligne qu'il vient
    d'écrire, dans une transaction courte, sans appel IA dedans ;
  - l'écran enregistre puis valide exactement la version enregistrée.
- **P2, argument du modèle comme référence :** le contrôle des chiffres ne retient que les valeurs
  calculées (`data`, `period`) des résultats non vides, jamais les filtres renvoyés (« classe 999 »).
- **P2, exception CI :** `CI=true` ne suffit plus. La base locale partagée avec l'application n'est
  admise que si le pipeline la déclare jetable (`OCALL_TEST_EPHEMERAL_DATABASE=1`), ce que font les
  conteneurs de service de `ci.yml` et de `school-neon-test.yml`.
- **P2, consommation lors d'une erreur d'outil :**
  - `attachAiUsage` / `aiUsageOf` joignent les jetons déjà consommés à toute erreur postérieure à un appel
    (fournisseur réel et simulé) ;
  - l'erreur garde son type et son statut, et son code métier est enregistré (ex. `REPORT_TOO_LARGE`) ;
  - le compteur Park des coûts inconnus couvre aussi les échecs qui ont consommé des jetons.
- **P2, filtre de dates financier :** écran et exports distinguent « Encaissé (cumul de l'année) » et
  « Encaissé sur la période » (global et par classe) dès qu'un filtre de dates est actif.
- **P2, régénération et éditions locales :** l'écran enregistre d'abord les modifications locales (avec la
  version), régénère la version enregistrée et verrouille les champs pendant l'opération.
- **P2, paragraphe arabe tronqué dans le PDF :** les paragraphes sont découpés mot à mot en morceaux d'au
  plus 220 points de haut ; chaque morceau passe à la page suivante si nécessaire.
- **P3, réglés :**
  - l'écran indique que chaque question du copilote est traitée indépendamment ;
  - quand l'IA est coupée, l'espace Enseignants reste ouvert en consultation (génération et régénération
    masquées), via `status.allowed`.
- **P3, laissé en réserve :** plafonds de création non atomiques.

Vérification ciblée :

- 58 tests unitaires IA (dont l'erreur d'outil métier) et 26 pour la garde des bases ;
- intégration sur bases jetables : `school-sprint8` 13/13, `school-sprint8-ai` 22/22, `ai-core` 3/3,
  `sprint8-ia` 15/15 ;
- mutations détectées : noms contigus seulement, filtres réintroduits dans le contrôle des chiffres,
  version non contrôlée à la régénération.

## Corrections après la passe 3 (NO GO : P1 partiel, 5 P2, 2 P3)

- **P1, confidentialité :**
  - toute combinaison d'un alias du prénom et d'un alias du nom d'une même personne est reconnue, quelle
    que soit l'écriture (« Awa ديوب », « آوا Diop ») ;
  - sont masqués les téléphones internationaux et les numéros locaux d'au moins 8 chiffres, groupés par
    deux ou trois (« 76 12 34 56 ») ou d'un seul tenant ; les montants usuels, notes et années restent
    intacts (tests unitaires).
- **P2, éditeur après un échec :**
  - la réponse de l'enregistrement est appliquée immédiatement, avant la régénération ou la validation ;
  - après un conflit de version, « Reprendre la version enregistrée » relit le contenu et conserve les
    saisies affichées (brouillon).
- **P2, navigation pendant une mutation :**
  - l'historique est désactivé pendant une opération ;
  - chaque réponse n'est appliquée que si elle concerne le document affiché (`currentId`), les réponses
    tardives d'un autre document sont ignorées.
- **P2, période financière :** dès qu'un filtre de dates est actif, le calcul reçoit les bornes
  résolues et affichées par l'en-tête (une borne seule est complétée par le début ou la fin de l'année).
- **P2, unités mineures :**
  - `toMajorUnits` (paquet partagé) convertit les montants des exports (tableau de bord, rapport
    financier : indicateurs, classes, mois, moyens de paiement) et des données remises au copilote
    (`school_overview`, `finance_summary`) dans l'unité de la devise ;
  - les contrats métier restent en unités mineures.
- **P2, changement de barème :**
  - une classe dont le barème change entre périodes n'a ni tendance ni écart (`scaleChanged`) ;
  - le rapport expose `scaleMixed` ;
  - la comparaison du copilote et l'analyse suspendent les écarts concernés, et l'analyse signale
    « barème de notation différent… : tendances et écarts suspendus » ;
  - aucune renormalisation des résultats du Sprint 4.
- **P3, coût inconnu :** les réglages signalent les appels au coût non estimé (`unestimatedCalls`).
- **P3, plafonds non atomiques :** réserve maintenue.

Vérification ciblée :

- unitaires : 12 pour School AI (alias mixtes, téléphones, montants EUR, barème), 13 pour les finances
  partagées, 161 pour l'API ;
- intégration sur bases jetables : `school-sprint8` 13/13, `school-sprint8-ai` 22/22, `ai-core` 3/3,
  `sprint8-ia` 15/15 ;
- preuves navigateur après recompilation : IA 22/22, rapports 24/24.

## Corrections après la passe 4 (NO GO : P1 partiel, P2 partiel, 3 P2, 3 P3)

- **P1, téléphones en chiffres arabes ou persans :** la détection se fait sur une copie du texte en
  chiffres latins de même longueur (positions identiques), et le segment d'origine est masqué. Une suite
  groupée n'est un téléphone qu'à partir de huit chiffres (P3 : « Comparer 12 14 16 » reste intact).
- **P2, écarts de matières :** chaque moyenne de matière par période porte son barème (`scale`,
  `scaleMixed`). La comparaison du copilote suspend l'écart (`scaleChanged`, `change: null`) lorsque les
  barèmes diffèrent ou sont mélangés (test unitaire avec matières).
- **P2, agrégats sur barèmes différents :** `meanOnCommonScale` ne fait une moyenne qu'entre moyennes
  d'un même barème. En cas de mélange, la moyenne est indisponible (`null`, `scaleMixed: true`) pour
  l'établissement par période, les matières et les résultats du tableau de bord. Aucune renormalisation
  des résultats du Sprint 4.
- **P2, conversations du copilote :**
  - ouverture et création sont désactivées pendant un envoi ;
  - chaque requête porte un numéro, et seule la dernière (envoi ou ouverture) met l'écran à jour.
- **P2, synthèse et indicateurs :** l'écran affiche avec la synthèse les indicateurs renvoyés par la même
  réponse, avec leur instant de calcul (`computedAt`).
- **P3, documentation monétaire :** distinction explicitée entre l'API métier et les exports du Sprint 5
  (unités mineures) d'une part, les exports du Sprint 8 et le copilote (unité de la devise) d'autre part.
- **P3, plafonds non atomiques :** réserve maintenue.

Vérification ciblée :

- unitaires School AI : 12 (téléphones arabes et persans, seuil de huit chiffres, matières à barème
  changé) ;
- intégration sur bases jetables : `school-sprint8` 13/13, `school-sprint8-ai` 22/22 ;
- preuve navigateur IA après recompilation : 22/22.

## Corrections après la passe 5 (NO GO : P1 résiduel, 2 P2 nouveaux, 3 P3)

- **P1, téléphone suivi d'une ponctuation :** une virgule ou un point n'est un séparateur numérique que
  s'il touche un chiffre des deux côtés. « 76 12 34 56, préparer… » et « 76123456, merci » sont masqués ;
  « 11,33 » et « 1 234 567,89 FCFA » restent intacts. Les chiffres arabes et persans restent traités sur
  une copie de même longueur.
- **P2, année pas encore commencée :**
  - sans borne saisie, la période se réduit au premier jour de l'année ; les rapports sont servis avec
    `yearNotStarted` ;
  - mention à l'écran et dans les exports (« année non commencée ») ;
  - l'erreur de plage est réservée aux bornes incohérentes saisies par l'utilisateur.
- **P2, effectif insuffisant dans l'analyse :**
  - réserve ajoutée par classe et période (« effectif noté insuffisant : CM1 A (Trimestre 1) ») ;
  - astérisque et note sous le tableau des classes ;
  - une alerte d'accompagnement en baisse porte la réserve `insufficient` (badge à l'écran).
- **P3, barème présenté :** chaque moyenne du rapport pédagogique est affichée avec son barème
  (« 11,33 / 20 ») ; une période aux barèmes mélangés affiche « barèmes différents ».
- **P3, historique pédagogique :** la liste renvoie jusqu'au plafond de 500 contenus actifs.
- **P3, plafonds non atomiques :** réserve maintenue.

Vérification ciblée :

- unitaires School AI : 12 (téléphone suivi d'une virgule, décimales intactes) ;
- intégration sur bases jetables : `school-sprint8` 14/14 (année non commencée), `school-sprint8-ai`
  22/22 (réserve par classe) ;
- preuves navigateur après recompilation : rapports 24/24, IA 22/22.

## Corrections après la passe 6 (NO GO : 1 P1, 1 P2, 2 P3)

- **P1, formats téléphoniques usuels :**
  - la copie de détection ramène les espaces insécables (U+00A0, U+202F, U+2007) à des espaces
    ordinaires, sans changer la longueur ni les positions ;
  - un groupe peut être entre parenthèses (« +221 (77) 123 45 67 », « (77) 123 45 67 ») ;
  - le seuil de huit chiffres et les protections des décimales sont conservés : « 1 234 567,89 FCFA »
    écrit avec des espaces fines reste intact.
- **P2, effectif propre à chaque matière :**
  - le reporting compte, par classe et période, les élèves ayant une moyenne dans la matière (résultats
    du moteur du Sprint 4, sans recalcul) ; il les agrège par matière et période (`graded`,
    `insufficient`) ;
  - une baisse de matière fondée sur moins de trois élèves porte la réserve `insufficient` ;
  - la réserve figure aussi dans les limites (« effectif noté insuffisant en Mathématiques (T2) »),
    dans les outils du copilote (`results_by_period`, `compare_periods`), avec astérisque et note sous
    les tableaux des matières (rapport et analyse).
- **P3, barème partout :**
  - tableau des matières : chaque moyenne affiche son barème, ou « barèmes différents » ;
  - exports : colonne « Barème » dans les sections établissement, classes, matières et résultats de la
    dernière période, avec la mention « barèmes différents » au lieu d'une cellule vide ;
  - section matières : colonnes « Élèves notés » et « Effectif insuffisant ».
- **P3, plafond documentaire non atomique :** réserve maintenue.

Vérification ciblée :

- unitaires School AI : 14 (espaces insécables, parenthèses, baisse de matière sur un élève, colonnes
  d'export) ;
- intégration sur bases jetables : `school-sprint8` 14/14 (assertion d'export mise à jour pour la
  colonne Barème), `school-sprint8-ai` 22/22 ;
- preuves navigateur après recompilation : rapports 24/24, IA 22/22.

## Corrections après la passe 7 (NO GO : 1 P2, 1 P3 nouveau ; P1 et P2 de la passe 6 corrigés)

- **P2, comparaison du copilote et effectif par classe :** `compare_periods` transmet pour chaque classe
  et chaque matière les effectifs notés des deux périodes (`firstGraded`, `secondGraded`) et la réserve
  `insufficient`. Les limites (`missing`) nomment la classe ou la matière et la période concernées
  (« effectif insuffisant : CM1 A (T1) »). Une période sans aucun élève noté ne déclenche pas de réserve.
- **P3, barème dans les autres restitutions :**
  - analyse : moyennes de l'établissement et des classes avec leur barème, ou « barèmes différents » ;
  - outil `results_by_period` : barème et effectif par moyenne ;
  - tableau de bord : moyenne de la dernière période et résultats par classe avec leur barème.
- **P3, plafond documentaire non atomique :** réserve maintenue.

Vérification ciblée :

- unitaires School AI : 15 (classe à un élève dans une comparaison où l'établissement est suffisant) ;
- intégration sur base jetable : `school-sprint8-ai` 22/22 ;
- preuves navigateur après recompilation : rapports 24/24, IA 22/22.

## Corrections après la passe 8 (NO GO : 1 P2 nouveau, 3 P3 ; P2 et P3 de la passe 7 corrigés)

- **P2, `school_overview` et réserve d'effectif :**
  - le reporting porte `insufficient` sur les résultats de la dernière période, pour l'établissement et
    pour chaque classe ; une période sans aucune note n'est pas concernée ;
  - l'outil transmet le barème, l'effectif noté, la réserve et le détail par classe ;
  - les limites nomment la période et les classes concernées ;
  - tableau de bord : astérisque et note sur la moyenne et les résultats par classe ;
  - exports : lignes « Barème », « Élèves notés » et « Effectif insuffisant » dans les indicateurs
    clés, et colonne « Effectif insuffisant » par classe.
- **P3, barème dans `school_overview` et `compare_periods` :** barème par période pour l'établissement,
  les classes et les matières (`firstScale`, `secondScale`, ou « barèmes différents »).
- **P3, période sans note dans la comparaison :** signalée « aucun élève noté en T2 », distincte de la
  réserve d'effectif, désormais limitée aux périodes notées.
- **P3, ordre inversé :** la plage affichée est chronologique ; l'écart suit l'ordre demandé.
- **P3, plafond documentaire non atomique :** réserve maintenue.

Vérification ciblée :

- unitaires School AI : 17 (`school_overview` à un élève noté ; comparaison inversée avec période sans
  note) ;
- intégration sur bases jetables : `school-sprint8` 14/14, `school-sprint8-ai` 22/22 ;
- preuves navigateur après recompilation : rapports 24/24, IA 22/22.

## Verdict de la passe 9 : GO SOUS RÉSERVES

Aucun P0, P1 ou P2. Toutes les corrections de la passe 8 sont jugées corrigées. Réserves P3 non
bloquantes, reportées au Sprint 9 (stabilisation) :

- **absence de notes et petit effectif :** `results_by_period` et l'analyse qualifient encore une période
  sans aucune note d'« effectif noté insuffisant », alors que la comparaison la signale « aucun élève
  noté ». Aucune valeur fausse (moyennes nulles) ;
- **comparabilité dans `compare_periods` :** l'écart d'établissement est suspendu dès qu'une autre
  période de l'année utilise un barème différent. Il devrait dépendre des deux seules périodes
  comparées. Indisponibilité excessive, sans calcul trompeur ;
- **plafond documentaire non atomique** (réserve connue) : deux générations simultanées à 499 contenus
  peuvent porter le total à 501.

Rapports d'audit : `C:\Users\couli\ocall-audits\audit-codex-school-8-passe1.md` à `passe9.md`.
