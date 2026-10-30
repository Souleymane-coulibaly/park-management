# Analyses, statistiques et rentabilité (Sprint 9)

Écrans : **Analyses** dans la navigation (`/app/analytics`). Onglets : Vue globale, Restaurant,
Parc, Coûts et marges, Établissements. API : `GET /api/v1/analytics/*`.

Toutes les analyses sont calculées par le serveur, à partir des données réelles enregistrées (ventes,
paiements, billets, scans, recettes, entrées de stock). Les écrans, les exports et le tableau de bord
utilisent les mêmes règles de calcul, définies une seule fois (`packages/shared/src/analytics.ts`,
`apps/api/src/modules/analytics/`).

## 1. Règles de calcul

| Indicateur                 | Règle                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA encaissé                | Somme des **paiements réussis** de ventes **non annulées**. Une vente payée ne peut pas être annulée et n'a qu'un paiement réussi : aucun double comptage.                                             |
| Date d'un encaissement     | Moment du paiement (un paiement est créé « réussi » à l'encaissement, seul chemin d'écriture : `SalesService.pay`).                                                                                    |
| Transactions payées        | Nombre de ventes encaissées sur la période.                                                                                                                                                            |
| Panier moyen               | CA encaissé ÷ transactions payées, arrondi au franc ; « — » sans vente.                                                                                                                                |
| Commandes (restaurant)     | Ventes restaurant **non annulées**, payées ou non, datées à leur **création**. Jamais additionnées au CA.                                                                                              |
| Visiteurs / entrées        | **Scans acceptés** uniquement (au plus un par billet, contrainte unique en base). Un scan refusé n'est **jamais** une entrée ; les refus sont affichés à part, par motif.                              |
| CA par produit / catégorie | Somme des lignes encaissées, **avant remise fidélité**. La remise est affichée séparément : CA par produit − remises = CA encaissé.                                                                    |
| Billets vendus             | Unités des ventes parc non annulées créées sur la période (payées ou non). Une formule famille = 1 unité.                                                                                              |
| Billets payés              | Unités des ventes parc encaissées sur la période.                                                                                                                                                      |
| Billets émis               | Billets individuels créés sur la période, hors annulés (une famille de 5 = 5 billets).                                                                                                                 |
| Billets scannés            | Scans acceptés sur la période.                                                                                                                                                                         |
| Taux d'utilisation         | Billets émis sur la période déjà utilisés ÷ billets émis sur la période.                                                                                                                               |
| Période précédente         | Même durée juste avant ; « Aujourd'hui » est comparé à **hier jusqu'à la même heure** ; « Mois en cours » aux mêmes jours du mois précédent.                                                           |
| Heures et jours            | Heure **locale de chaque établissement** (colonne `timezone`). En consolidation, « 12 h » désigne 12 h locales dans chaque établissement. Les périodes sont résolues dans le fuseau de l'organisation. |

### Marges (estimations)

- Coût matière d'une unité vendue = Σ (quantité de l'ingrédient dans la recette de **l'établissement
  de vente** × coût d'achat unitaire **actuel** de l'ingrédient).
- Sans recette, ou si un seul ingrédient n'a pas de coût : la marge est **incomplète**, jamais
  estimée ; la raison et les ingrédients manquants sont affichés.
- L'écran et l'export distinguent : **CA**, **coût matière estimé**, **marge brute estimée**,
  **charges non intégrées** (personnel, loyer, énergie, taxes…). Une marge estimée n'est jamais
  présentée comme un bénéfice. Les montants sont TTC.
- Évolution des coûts : coûts saisis sur les entrées de stock (`IN`) de la période.

## 2. Filtres et périmètre

- Périodes : aujourd'hui, hier, 7 derniers jours, 30 derniers jours, mois en cours, période
  personnalisée (dates incluses, **366 jours au plus**).
- Établissement : un établissement accessible, ou tous. Un établissement d'une autre organisation,
  ou non affecté au superviseur, répond « introuvable » (404).
- Activité : toutes, restaurant, parc (selon le métier de l'organisation).
- L'organisation vient **toujours** de la session ; tout paramètre non prévu est refusé (400).

## 3. Permissions

| Permission          | Rôles                    | Accès                                                             |
| ------------------- | ------------------------ | ----------------------------------------------------------------- |
| `analytics.read`    | OWNER, ADMIN, SUPERVISOR | Analyses (superviseur : ses établissements affectés)              |
| `analytics.margins` | OWNER, ADMIN             | Coûts matière et marges (écran et export)                         |
| `analytics.export`  | OWNER, ADMIN             | Exports CSV ; chaque export est journalisé (`analytics.exported`) |

Caissier, cuisine et agent d'entrée n'ont aucun accès aux analyses.

## 4. Exports

- Format **CSV** (Excel et PDF reportés par décision du commanditaire : aucune nouvelle dépendance).
- Rapports : vue globale, ventes par produit, ventes par produit et par heure, billetterie par
  catégorie, carte thermique, coûts et marges, comparaison des établissements.
- En-tête : rapport, période et période comparée, établissements, activité, fuseau horaire, devise
  (FCFA, TTC), date de génération, notes (estimation des marges, remises fidélité, scans refusés).
- Indicateurs sélectionnés : paramètre `columns` (clés connues uniquement, sinon 400).
- Excel en français : séparateur `;`, virgule décimale, UTF-8 avec BOM, fins de ligne CRLF.
- **Injection de formules** : toute valeur texte commençant par `=`, `+`, `-`, `@`, tabulation ou
  retour chariot (y compris après des espaces, et leurs variantes pleine chasse) est préfixée d'une
  apostrophe. Les nombres restent des nombres.
- Limite : 50 000 lignes (au-delà : 422, réduire la période).

## 5. Performance et protection de la base

- **Agrégation dans PostgreSQL** : une poignée de requêtes `GROUP BY` par écran, aucune ligne de vente
  rapatriée une à une (pas de N+1). Les quantités par vente sont calculées par une sous-requête
  latérale, pour ne pas multiplier les montants.
- **Préfiltre indexé** : chaque requête borne d'abord les dates en UTC (avec un jour de marge pour
  tous les fuseaux), puis applique le filtre exact en heure locale. Nouvel index
  `Payment(organizationId, createdAt)` (migration `20261030190000_analyses`, additive). Les ventes,
  billets et scans disposaient déjà d'index sur (organisation/établissement, date).
- **Transaction en lecture seule** (`SET TRANSACTION READ ONLY`) et **délai maximal de 10 s par
  requête** (`statement_timeout`) : une analyse ne peut ni écrire, ni monopoliser la base ; un
  dépassement renvoie `ANALYTICS_TIMEOUT` (503) avec une consigne.
- **Limites de débit** dédiées : 120 analyses par minute et 30 exports par 10 minutes par adresse IP.
- **Pas de cache** : les chiffres sont toujours à jour. À reconsidérer si le volume l'exige (cache
  court par organisation et période).
- Le POS, la cuisine et le contrôle d'accès ne sont pas modifiés : aucune écriture ajoutée sur leurs
  chemins.

Mesure indicative hors ligne (PostgreSQL embarqué PGlite, monothread, 20 000 ventes sur un mois) :
vue globale 1,4 s, restaurant 2,1 s, marges 0,5 s, établissements 1,1 s ; le plan d'exécution utilise
le nouvel index. **La mesure sur Neon `test` reste à faire** (test 26).

## 6. Règle commune appliquée aux écrans existants

Le tableau de bord (Sprint 1) datait le CA à la **création** de la vente, alors que le copilote
(Sprint 8) le datait au **paiement** : une vente créée la veille et payée le jour même tombait sur
deux jours différents. Le tableau de bord, les produits les plus vendus du tableau de bord
restaurant et la fonction `top_products` du copilote sont alignés sur la règle « daté à
l'encaissement ».

## 7. Limites

- Marges au coût d'achat **actuel** : le coût au moment de la vente n'est pas enregistré.
- Excel et PDF non livrés (CSV uniquement).
- Une organisation sur plusieurs fuseaux : les périodes suivent le fuseau de l'organisation, les
  heures celui de chaque établissement (documenté dans chaque export).

## 8. Copilote enrichi (Sprint 9B)

Cinq fonctions s'ajoutent au registre fermé du copilote (`modules/ai/copilot/analytics-tools.ts`).
Elles appellent le service d'analyses ci-dessus : mêmes règles, même transaction en lecture seule,
établissement de la session uniquement.

| Fonction               | Question type                                                       | Permission          |
| ---------------------- | ------------------------------------------------------------------- | ------------------- |
| `product_hourly_sales` | « Combien de poulets braisés entre 12 h et 14 h ? », « … à 19 h ? » | `sale.read_all`     |
| `top_products_revenue` | « Quel produit a généré le plus de revenus cette semaine ? »        | `sale.read_all`     |
| `busiest_hours`        | « Quelles heures génèrent le plus de commandes ? »                  | `sale.read_all`     |
| `busiest_park_day`     | « Quel est le jour le plus fréquenté du parc ? »                    | `sale.read_all`     |
| `category_margins`     | « Quelle catégorie est la plus rentable selon les coûts connus ? »  | `analytics.margins` |

- Le produit cité est cherché **par le serveur** dans le catalogue de l'établissement (singulier,
  sans accents). S'il est ambigu, le copilote demande de préciser ; s'il est introuvable, il le dit.
  Il ne devine jamais.
- Arguments à clés exactes, plage horaire bornée et ordonnée, aucun SQL, aucune écriture. Un chiffre
  cité par le modèle mais absent des résultats fait écarter sa formulation (contrôle du Sprint 8).
- Les marges sont présentées comme **estimées**. La catégorie « la plus rentable » n'est choisie que
  parmi celles dont les coûts sont complets.

## 9. Statistiques SaaS et règlements d'abonnement (Super Admin, Sprint 9B)

Écrans : `/admin/statistiques` et `/admin/reglements`. API : `GET /platform/saas-stats`,
`GET|POST /platform/subscription-payments`, `POST /platform/subscription-payments/:id/validate|reject`.
Ces routes sont réservées au Super Admin.

**Règle métier.** Les abonnements sont payés directement à Ocall, hors plateforme (espèces,
virement, mobile money, chèque). Le Super Admin saisit chaque règlement ; celui-ci reste « à
vérifier » jusqu'à ce qu'il soit validé ou rejeté (motif obligatoire).

- Aucun paiement en ligne, aucune intégration CinetPay, Wave ou Orange Money, aucun renouvellement
  automatique.
- À la validation, l'abonnement n'est modifié **que si** le Super Admin coche « Activer / prolonger
  jusqu'au … ». La case est décochée par défaut. L'abonnement passe alors Actif, avec une échéance au
  lendemain de la fin de période (minuit, fuseau de l'organisation). Une échéance plus lointaine
  n'est jamais raccourcie. Un événement d'historique est créé.
- Garde-fous :
  - transitions conditionnelles : deux validations simultanées n'en appliquent qu'une ;
  - une référence déjà saisie pour ce client est refusée (sauf si le premier règlement a été rejeté) ;
  - montant positif et période ordonnée, contrôlés aussi en base (CHECK) ;
  - date de règlement non future, période de 3 ans au plus ;
  - chaque saisie, validation et rejet est journalisé.
- **Statistiques.** Le tableau de bord SaaS présente :
  - les organisations (actives, suspendues) et les abonnements par statut ;
  - les abonnements actifs dont l'échéance est dépassée, à vérifier (aucune bascule automatique) ;
  - la répartition des offres ;
  - les encaissements **validés** (total, mois en cours, 12 derniers mois) et les règlements à
    vérifier ;
  - les renouvellements à venir dans les 30 jours ou échus, avec le dernier règlement validé ;
  - l'historique des abonnements ;
  - le revenu mensuel **théorique** (prix des offres actives), distinct des encaissements.
- **Séparation.** Les règlements SaaS sont dans une table dédiée (`SubscriptionPayment`, migration
  additive `20261030210000_reglements_saas`). Ils n'apparaissent jamais dans les analyses des
  établissements, qui ne lisent que `Sale` / `Payment`.
- **Limite.** La validation n'exige pas une seconde personne (un seul Super Admin est prévu).
  L'auteur de la saisie et le validateur sont tous deux enregistrés.
