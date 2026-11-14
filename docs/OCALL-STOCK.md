# Ocall Stock

Ocall Stock est l'application de gestion des articles, des stocks, des achats et des ventes d'Ocall Suite.
Elle s'adresse aux commerces, grossistes, distributeurs, quincailleries, supermarchés et PME.

Elle est vendue indépendamment d'Ocall Facture. Les deux applications fonctionnent ensemble quand une
organisation a les deux abonnements (sprint S5).

**État : sprints S1 (socle et catalogue), S2 (sites, stocks, transferts, inventaires), S3 (achats), S4
(caisse), S5 (interconnexion Facture), S6 (tableaux de bord, alertes, recherche globale), S7 (site
vitrine), S8 (IA), S9 (stabilisation, revue de sécurité) et S10 (prix et vitrine par boutique)
livrés.** Prochaine étape : l'audit Codex indépendant (§18). Plan complet :
`ocall-audits/plan-ocall-stock-v1.md` (hors dépôt).

## 1. Activation

- **Désactivée par défaut.** Sans `STOCK_ENABLED=true`, l'application est absente du portail, ses routes
  répondent 404 et la migration de déploiement ne fait rien.
- **Base séparée.** Elle est distincte des bases Suite, School et Facture. Le démarrage est refusé sinon.
- **Accès.** Il faut un essai ou un abonnement Ocall Stock (socle S1 d'Ocall Suite) :
  - **essai en cours ou abonnement actif** : accès complet ;
  - **essai échu ou abonnement expiré** : consultation seulement (`SUBSCRIPTION_READ_ONLY`), aucune donnée
    supprimée.
- **Offres de la grille.** Deux offres, **inactives** :
  - « Sans vitrine » : 50 000 FCFA par mois ;
  - « Avec vitrine » : 65 000 FCFA par mois.

  Pour les deux, la mise en service coûte 200 000 FCFA et l'essai dure 14 jours. Le produit
  `OCALL_STOCK` reste « à venir » tant que sa commercialisation n'est pas décidée.

## 2. Architecture

| Élément              | Emplacement                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| Base et migrations   | `packages/stock-database` (`@ocall/stock-database`, client `.prisma/stock-client`) |
| API                  | `apps/api/src/modules/ocall-stock`, routes `/api/v1/ocall-stock/...`               |
| Contrat avec Facture | `apps/api/src/common/integration/catalog-integration.ts`                           |
| Règles partagées     | `packages/shared/src/stock.ts`, `stock-barcodes.ts`, `stock-labels.ts`             |
| Web                  | `apps/web/src/app/stock` (route `/stock`), `components/stock`, `components/scan`   |

- **Préfixe `/ocall-stock`.** Côté API, `/stock` appartient déjà au stock d'ingrédients du restaurant
  d'Ocall Park.
- **Frontières.** Elles sont vérifiées par un test (`ocall-stock-boundaries.spec.ts`) :
  - le module n'importe que le socle commun et `organizations` ;
  - aucun autre module ne l'importe.
- **Seul lien avec les autres modules** : les jetons `STOCK_CATALOG_READER` (lecture du catalogue) et
  `STOCK_MOVEMENT_GATEWAY` (demandes de mouvement, S5), définis dans `common/integration`.
- **Comptes de l'équipe.** Ce sont des comptes Suite au rôle `PRODUCT_USER`, sans droit Park ni School.
  Leur rôle Stock est enregistré dans la base Stock.
  - Ils sont créés par `ProductUserAccountsService` (module `organizations`), un service réutilisable par
    toute application à base séparée.
  - Facture garde pour l'instant son propre code : il y migrera au sprint S5.

## 3. Rôles et permissions

**Rôles :** Administrateur, Responsable de magasin, Responsable d'entrepôt, Magasinier, Caissier,
Commercial, Lecteur / auditeur. Le propriétaire de l'organisation est administrateur d'office.

**Permissions du sprint S1.** Chaque sprint ajoute les siennes : une permission n'existe que si une
fonction l'exige.

| Permission                                    | Admin. | Resp. magasin | Resp. entrepôt | Magasinier | Caissier | Commercial | Lecteur |
| --------------------------------------------- | :----: | :-----------: | :------------: | :--------: | :------: | :--------: | :-----: |
| Accéder                                       |   ✔    |       ✔       |       ✔        |     ✔      |    ✔     |     ✔      |    ✔    |
| Réglages                                      |   ✔    |               |                |            |          |            |         |
| Voir l'équipe                                 |   ✔    |       ✔       |       ✔        |            |          |            |    ✔    |
| Gérer l'équipe et les permissions             |   ✔    |               |                |            |          |            |         |
| Consulter le catalogue                        |   ✔    |       ✔       |       ✔        |     ✔      |    ✔     |     ✔      |    ✔    |
| Gérer le catalogue (hors prix)                |   ✔    |       ✔       |       ✔        |            |          |            |         |
| Voir les prix d'achat                         |   ✔    |       ✔       |       ✔        |            |          |            |    ✔    |
| Modifier les prix                             |   ✔    |       ✔       |                |            |          |            |         |
| Consulter les fournisseurs                    |   ✔    |       ✔       |       ✔        |     ✔      |          |            |    ✔    |
| Gérer les fournisseurs                        |   ✔    |       ✔       |       ✔        |            |          |            |         |
| Imprimer les étiquettes                       |   ✔    |       ✔       |       ✔        |     ✔      |          |     ✔      |         |
| Gérer les sites et leurs équipes (S2)         |   ✔    |               |                |            |          |            |         |
| Gérer les emplacements                        |   ✔    |       ✔       |       ✔        |            |          |            |         |
| Consulter les stocks                          |   ✔    |       ✔       |       ✔        |     ✔      |    ✔     |     ✔      |    ✔    |
| Consulter mouvements, transferts, inventaires |   ✔    |       ✔       |       ✔        |     ✔      |          |            |    ✔    |
| Saisir entrées, sorties, déplacements         |   ✔    |       ✔       |       ✔        |     ✔      |          |            |         |
| Ajuster le stock                              |   ✔    |       ✔       |       ✔        |            |          |            |         |
| Préparer et expédier les transferts           |   ✔    |       ✔       |       ✔        |     ✔      |          |            |         |
| Réceptionner les transferts                   |   ✔    |       ✔       |       ✔        |     ✔      |          |            |         |
| Compter un inventaire                         |   ✔    |       ✔       |       ✔        |     ✔      |          |            |         |
| Valider un inventaire                         |   ✔    |       ✔       |       ✔        |            |          |            |         |
| Consulter les achats (S3)                     |   ✔    |       ✔       |       ✔        |     ✔      |          |            |    ✔    |
| Gérer les commandes fournisseurs              |   ✔    |       ✔       |       ✔        |            |          |            |         |
| Réceptionner les commandes                    |   ✔    |       ✔       |       ✔        |     ✔      |          |            |         |
| Retourner aux fournisseurs                    |   ✔    |       ✔       |       ✔        |            |          |            |         |
| Gérer les caisses (S4)                        |   ✔    |       ✔       |                |            |          |            |         |
| Ouvrir et clôturer la caisse                  |   ✔    |       ✔       |                |            |    ✔     |     ✔      |         |
| Encaisser des ventes                          |   ✔    |       ✔       |                |            |    ✔     |     ✔      |         |
| Consulter les ventes et sessions              |   ✔    |       ✔       |       ✔        |            |    ✔     |     ✔      |    ✔    |
| Accorder des remises (plafonnées)             |   ✔    |       ✔       |                |            |          |     ✔      |         |
| Accorder des remises sans plafond             |   ✔    |       ✔       |                |            |          |            |         |
| Retours et remboursements                     |   ✔    |       ✔       |                |            |          |            |         |
| Consulter les clients                         |   ✔    |       ✔       |       ✔        |            |    ✔     |     ✔      |    ✔    |
| Gérer les clients                             |   ✔    |       ✔       |                |            |    ✔     |     ✔      |         |

**Ajustements par membre.** Un administrateur accorde ou retire une permission à un membre, en plus de son
rôle.

- L'accès, les réglages, la gestion de l'équipe, celle des sites et celle des caisses ne sont jamais
  ajustables.
- Personne ne modifie son propre accès.
- Désactiver un membre ferme aussitôt ses sessions.

**Contrôle côté serveur, à chaque requête :**

- un champ autre qu'un prix exige « Gérer le catalogue » ;
- un prix exige « Modifier les prix » ;
- un prix d'achat exige en plus « Voir les prix d'achat ».

Sans ce droit, le prix d'achat est retiré de toutes les réponses, historiques compris.

**Périmètre des sites (S2).** Un membre rattaché à des sites ne voit et ne touche qu'eux : sites, stocks,
mouvements, inventaires, transferts dont il est le départ ou l'arrivée. Un site hors périmètre est
« introuvable ». Sans aucun rattachement, il agit sur tous les sites (décision du 12/11/2026) ;
l'administrateur agit toujours sur tous. Préparer, expédier ou annuler un transfert exige le site de départ ;
le réceptionner, le site d'arrivée.

**Rôle par boutique (Ocall Suite, Sprint 2A).** Sur un site rattaché, un administrateur peut donner au
membre un **rôle propre à ce site** (par exemple responsable à Bamako, caissier à Ségou).

- Le rôle de site **restreint** le rôle principal, il ne l'élargit jamais : permissions du rôle de site
  (avec les mêmes ajustements) ∩ permissions du rôle principal. Jamais administrateur (contrôle en base).
- Sans rôle de site, le rôle principal s'applique : rien ne change pour les équipes existantes.
- Chaque route limite les sites à ceux où le rôle du membre porte sa permission ; les gestes précis sont
  vérifiés sur le site concerné (remise selon la boutique de la caisse, entrée ou ajustement selon
  l'emplacement, commande issue d'une proposition IA selon la boutique livrée) ; chaque section du
  tableau de bord et de la recherche ne compte que les sites où sa permission est portée.
- Les actions propres à l'organisation (catalogue, prix, fournisseurs, réglages) suivent le rôle principal.

**Membre existant (Ocall Suite, Sprint 2A).** Un administrateur peut ajouter à l'équipe une personne qui a
déjà un compte dans l'organisation (employé Park, membre de Facture ou School) : aucun nouveau compte,
son rôle Park et ses autres rôles restent inchangés.

## 4. Catalogue

- **Catégories.** Deux niveaux : catégorie, puis sous-catégorie. Un troisième niveau est refusé par la base
  (`STOCK_CATEGORY_DEPTH`). Les noms sont uniques par niveau, sans tenir compte de la casse.
- **Marques.** Noms uniques, sans tenir compte de la casse.
- **Articles :**
  - **référence (SKU)** : unique sans tenir compte de la casse, générée si elle n'est pas saisie (préfixe
    des réglages, par exemple `OC-000001`) ;
  - désignation, description, catégorie, marque et unité de vente ;
  - **prix de vente TTC** (prix payé, imprimé sur l'étiquette) et **prix d'achat HT** (facultatif, jamais
    estimé) ;
  - TVA de 0 à 30 % ;
  - seuil d'alerte ;
  - article stocké ou non (service) ;
  - archivage.
- **Variantes.** Chaque article a une **variante par défaut** : elle porte sa référence et ses codes. Les
  déclinaisons (taille, couleur, contenance) sont des variantes nommées, avec une référence propre et un
  prix facultatif ; à défaut, elles prennent celui de l'article.
- **Prix par boutique** (S10). Le prix de vente de l'article (ou de la variante) est le **prix commun** :
  il s'applique dans toutes les boutiques. Un responsable des prix peut fixer un **prix propre à une
  boutique** (exception, par variante), puis revenir au prix commun. La caisse de cette boutique, ses
  étiquettes et la vitrine quand le visiteur l'a choisie appliquent ce prix ; **Facture garde le prix
  commun**. Exceptions tracées dans l'historique des prix (avec la boutique) ; un membre limité à des
  boutiques ne voit et ne fixe que les prix des siennes ; une boutique archivée ne reçoit plus de prix.
- **Montants.** Entiers, dans la devise de l'organisation (XOF par défaut). Le franc CFA n'a pas de
  décimales.
- **Historiques en ajout seul, garantis par la base :**
  - historique des modifications de l'article ;
  - historique des prix de chaque variante.
- **Rien n'est supprimé.** Un élément sort des listes par archivage. Seuls un code-barres mal attribué et
  une photo se retirent.
- **Photos.** Quatre au plus par article, garanti par la base. Elles sont réencodées en JPEG : orientation
  appliquée, métadonnées et position GPS retirées, stockage privé.

## 5. Codes-barres et scan

- **Codes GTIN** (EAN-13, EAN-8, UPC-A). Ils viennent du fabricant ; Ocall Stock n'en invente jamais. Il en
  vérifie la longueur et la **clé de contrôle**, dans l'API et dans la base (contrainte
  `StockBarcode_code_check`).
  - Un code est unique dans l'organisation.
  - **Un UPC-A et sa forme EAN-13 (`0` + code) sont le même code.** Beaucoup de lecteurs le transmettent
    ainsi : la lecture et le contrôle des doublons tiennent compte des deux écritures.
- **Code interne.** Pour un article sans code fabricant : préfixe et 8 chiffres (`OC00000001`), un seul par
  variante. Il est imprimé en Code 128 ou en QR code.
- **Lecture** (`GET /ocall-stock/lookup`) : dans cet ordre, le code-barres exact (et son écriture
  équivalente), puis la référence de variante sans tenir compte de la casse.
  - Les espaces et caractères de contrôle ajoutés par certains lecteurs sont retirés.
  - Un code inconnu renvoie son type probable, et l'écran propose de créer l'article avec ce code.
- **Champ de scan réutilisable** (`components/scan/scan-field.tsx`) :
  - fonctionne avec les lecteurs USB et Bluetooth en mode clavier (HID) ;
  - garde le focus après chaque lecture ;
  - ignore une même lecture répétée dans les 1,5 s ;
  - donne un retour visuel, et sonore si on l'active (le réglage est mémorisé sur l'appareil).
- **Limites du matériel :**
  - un lecteur 1D ne lit pas les QR codes : il faut un lecteur 2D ;
  - le scan par la caméra (S2) exige HTTPS et l'autorisation du navigateur.
- **Caméra (S2)** : bouton « Caméra » du champ de scan (`components/scan/camera-barcode-scanner.tsx`).
  Détecteur natif du navigateur s'il lit tous les formats (Chrome Android), sinon `zxing-wasm` (iPhone,
  iPad) : EAN-13, EAN-8, UPC-A, Code 128, QR. Le fichier WebAssembly est servi par le site
  (`/vendor/zxing_reader.wasm`, copié par `apps/web/scripts/copy-vendor.mjs` avant `next dev` et
  `next build`), sans aucun appel à un service tiers.

## 6. Étiquettes

- **Formats.** PDF à la taille exacte : 40 × 30, 50 × 30 ou 60 × 40 mm, une étiquette par page.
- **Contenu.** Au choix : nom du magasin, article, variante, référence, code-barres, QR code, prix TTC et
  devise.
- **Impression.** À l'unité ou en série, 1 000 étiquettes au plus par impression.
- **Code imprimé** : dans cet ordre, celui du fabricant, sinon le code interne, sinon la référence (Code 128).
  Le QR code contient le même code, et Ocall Stock le relit.
- **Contrôle automatique.** Chaque symbologie imprimée est relue par un décodeur indépendant
  (`ocall-stock-label-pdf.spec.ts`, zxing chargé localement, sans réseau).
- **Impression depuis le navigateur**, par son dialogue d'impression : imprimante d'étiquettes ou planche.
  **Aucune impression silencieuse.** Les imprimantes d'étiquettes pilotées directement (TSPL, ZPL)
  viendront plus tard, derrière une interface dédiée.

## 7. Recherche

- **Articles** (liste paginée, 100 par page au plus) et **recherche globale** (`/ocall-stock/search` :
  articles, catégories, marques, fournisseurs).
- **Normalisation.** Sans accents ni casse : fonction `stock_search_text`, avec l'extension `unaccent`.
- **Fautes de frappe tolérées.** Proximité de trigrammes `pg_trgm`, seuil explicite de 0,45. Le seuil par
  défaut (0,6) ne trouvait pas « acrilique » pour « acrylique ».
- **Ordre des résultats** : référence exacte, nom qui commence par le texte, proximité, puis nom.
- **Code exact.** Un code lu par le scanner mène directement à la fiche.
- **Sécurité.** Requêtes paramétrées, toujours limitées à l'organisation et aux droits (fournisseurs selon
  la permission). Pas d'Elasticsearch.

## 8. Interconnexion avec Ocall Facture (S5)

**Principe : Stock est la seule source des quantités ; la synchronisation est à sens unique.** Les articles
vont de Stock vers Facture (lecture seule) ; les demandes de mouvement vont de Facture vers Stock, par le
moteur de stock uniquement. Facture ne modifie jamais un article Stock, Stock ne modifie jamais un document
Facture. Les deux applications restent indépendantes :

- **Facture seul (cas A)** : catalogue Facture autonome, aucune fonction Stock.
- **Stock seul (cas B)** : Stock ne dépend pas de Facture.
- **Les deux (cas C)** : ce qui suit.

**Contrats** (`common/integration`) :

- `StockCatalogReader` : `isAvailable`, `search`, `variants` (S1) ; `availability` (disponible à
  l'emplacement des ventes Facture) et `sale` (vente en caisse à facturer). **Droits vérifiés côté Stock**
  (consulter les stocks, consulter les ventes, périmètre des sites) : un compte Facture sans droit Stock ne
  voit ni quantités ni ventes.
- `StockMovementGateway` : `canWrite` (Stock activé et abonnement en cours) et `apply` (une demande, une clé,
  toutes ses lignes ou aucune). Refus typés : `STOCK_UNAVAILABLE`, `STOCK_LOCATION_NOT_SET`,
  `STOCK_INSUFFICIENT`, `STOCK_VARIANT_NOT_FOUND`.

**Articles dans Facture.**

- Dans un document (et les pièces d'une intervention, pour le gérant), « Articles Ocall Stock » cherche par
  nom, référence ou code-barres : prix du jour (TTC et hors taxe), TVA, disponibilité si le compte peut la
  voir.
- Ajouter un article crée ou réutilise un **article miroir** `FactureItem` (`stockVariantId`, un seul par
  article Stock). Nom, unité, prix hors taxe (`TTC × 100 / (100 + TVA)`, arrondi) et TVA sont relus dans
  Stock à chaque ajout. Le miroir est en **lecture seule** dans Facture (archivage seul) tant que le lien
  existe. Une TVA au-delà de 20 % est refusée (plage de Facture).
- **Doublon** : un article Facture qui porte la référence de l'article Stock est **proposé** ; l'utilisateur
  choisit « Rapprocher » (l'article existant devient le miroir, tracé) ou « Créer un article distinct ».
  Jamais de rapprochement automatique. **Délier** reste possible tant qu'aucune demande de mouvement ni
  facture de vente en caisse ne cite l'article.
- Les documents émis gardent leur instantané : un changement de prix ne touche jamais un document émis.

**Déclencheur unique de déstockage, par source.**

| Source                | Déclencheur                            | Clé                             |
| --------------------- | -------------------------------------- | ------------------------------- |
| Vente en caisse Stock | Vente encaissée (S4)                   | `stock-sale:<vente>:<ligne>`    |
| Facture               | **Émission** de la facture             | `facture-invoice:<document>`    |
| Intervention          | **Signature** (pièces posées)          | `facture-part:<intervention>`   |
| Avoir                 | Émission, si « marchandise retournée » | `facture-credit:<avoir>`        |
| Retour en caisse      | Retour validé (S4)                     | `stock-return:<retour>:<ligne>` |

Un devis, une pro forma, un bon de commande ou un brouillon ne demandent jamais rien. Seuls les articles
miroirs **stockés** comptent : un service ne sort jamais du stock.

**Jamais deux déstockages.** Une facture ne demande que ce que sa source n'a pas déjà sorti, article par
article :

- la **facture d'une vente en caisse** (« Facturer une vente en caisse », une seule par vente ; quantités
  nettes des retours en caisse, figées sur la facture) ;
- la **facture d'une intervention** (pièces sorties à la signature).

Rien à sortir : la demande est close d'emblée, gardée pour la traçabilité. La clé unique protège en dernier
recours.

**Avoir « marchandise retournée »** (case du brouillon d'avoir, figée à l'émission) : retour en stock,
jamais plus que ce qui est sorti pour la facture (sa demande et sa source), avoirs précédents déduits.

**Transport sans transaction commune.**

1. À l'émission (ou à la signature), Facture écrit la demande dans sa file de sortie `FactureStockOutbox`,
   **dans la même transaction**.
2. Un répartiteur (toutes les 30 s, et aussitôt après l'émission) la réserve sous bail (`SKIP LOCKED`) et
   l'envoie à Stock.
3. Stock l'applique en une transaction : verrou sur la clé, rejeu reconnu par son journal
   `StockInboundEvent`, mouvements par le moteur (politique de stock négatif comprise) à l'**emplacement des
   ventes Facture** (réglage Stock).
4. **Reprise** :
   - refus de Stock (stock insuffisant, emplacement non réglé, Stock indisponible) : « synchronisation en
     échec », avec le motif, visible du gérant (page « Ocall Stock » de Facture, et sur le document) ; il
     corrige, puis clique « Relancer » ;
   - incident passager : nouvelles tentatives espacées (1, 2, 4… min, 6 au plus), puis « en échec » ;
   - aucune perte : la demande n'est jamais supprimée, et un résultat perdu est rejoué sans effet.

**Avant l'émission**, la facture affiche ce qui sortira du stock et ce qui manque. C'est un avertissement,
jamais un blocage : une facture émise est un document légal.

**Abonnements.**

- **Stock échu** (consultation seule) : Facture continue ; articles miroirs et documents intacts ; les
  factures émises ne demandent rien et portent « stock non mis à jour » (définitif, non relançable).
- **Facture échu** : Stock n'en dépend pas.
- Aucune suppression de données, dans les deux cas.

**Côté Stock** : le réglage « Emplacement des ventes Facture » et la liste « Mises à jour reçues d'Ocall
Facture » (Réglages) ; mouvements « Facture émise », « Pièces d'intervention », « Avoir — marchandise
retournée ».

## 9. Sites, stocks, transferts et inventaires (S2)

- **Sites** : magasins, dépôts, entrepôts. Code court unique (2 à 8 caractères) qui ne change plus : il est
  imprimé dans les QR codes. Chaque site naît avec un emplacement « Général » : un site non découpé
  fonctionne sans configuration.
- **Emplacements** : zone → allée → rayonnage → emplacement (A-01-03), dans cet ordre, dans le même site
  (contrôlé par la base). Code unique dans le site, inchangeable. **QR code** : `L:<site>/<emplacement>`,
  imprimé sur étiquette (formats des étiquettes d'articles) et lu par le champ de scan. Un site ou un
  emplacement qui contient du stock ou une opération en cours ne s'archive pas.
- **Moteur de stock** (`ocall-stock-ledger.service.ts`) : seule porte d'écriture des quantités.
  - **Niveau** par variante et par emplacement : en stock, réservé (transfert préparé) ; disponible =
    en stock − réservé.
  - **Registre des mouvements** en ajout seul (garanti par la base), avec la quantité à l'emplacement
    après chaque mouvement et l'opération d'origine (saisie, transfert, inventaire). Une correction est
    un mouvement compensatoire.
  - **Idempotence** : chaque écriture a une clé unique ; l'appareil envoie une clé par saisie. Une
    requête répétée (double clic, réseau instable), même simultanée, n'est comptée qu'une fois (verrou
    consultatif sur la clé, puis contrôle).
  - **Concurrence** : niveaux verrouillés (`FOR UPDATE`) dans un ordre fixe. Deux caisses qui sortent
    le dernier article : la seconde attend puis est refusée (`STOCK_INSUFFICIENT`).
  - **Stock négatif** refusé par défaut (une sortie ne puise que dans le disponible) ; l'administrateur
    peut l'autoriser dans les réglages.
  - Un article non stocké (service) n'a aucun mouvement ; un article qui a du stock ne peut pas devenir
    « non stocké ».
- **Saisies** : entrée (coût unitaire facultatif), sortie et ajustement (motif obligatoire ; ajuster exige
  son propre droit), déplacement entre deux emplacements du même site.
- **Stocks** : par site et par variante, avec la quantité **en transit** (expédiée vers le site, ni reçue ni
  déclarée manquante), même si le site n'a encore aucun stock de l'article ; filtre « sous le seuil
  d'alerte » (seuil de l'article comparé au stock du site). Détail par emplacement sur la fiche article.
- **Transferts** : demandé → préparé (emplacement de prélèvement par ligne, quantités réservées) →
  expédié (sorties de la source, réservations consommées, en transit) → reçu, en une ou plusieurs fois,
  rangé à l'emplacement choisi du site d'arrivée. Un **manque** se déclare avec un motif : il clôt le
  reste attendu sans entrée. Annulation possible avant l'expédition (réservations libérées). Chaque
  transition verrouille le transfert ; une expédition ou une réception rejouée n'est pas recomptée ; une
  réception supérieure au reste attendu est refusée.
- **Inventaires** : complet (tout article en stock dans le périmètre et non compté est ramené à 0) ou
  partiel (seules les lignes comptées), sur tout le site ou des emplacements choisis ; deux inventaires
  ouverts ne couvrent jamais le même emplacement. Comptage par saisie ou par scan (+1 par lecture),
  sans toucher au stock. **Validation** par une personne habilitée : **écart = compté − stock au moment
  de la validation**, lu sous le verrou de chaque ligne (décision du 12/11/2026) : un mouvement fait
  pendant le comptage n'est pas perdu. Stock et écart figés sur chaque ligne ; rapports CSV (tableur) et
  PDF.

## 10. Achats (S3)

- **Commandes fournisseurs** : fournisseur, site de livraison, date attendue, lignes (article, quantité,
  coût HT, TVA), totaux HT, TVA, TTC. **Brouillon** modifiable, puis **commandée** : ses lignes ne
  changent plus (déclencheur en base). Reçue en partie, reçue, **close** (le reste n'est plus attendu) ou
  **annulée** (seulement avant toute réception). Bon de commande en PDF.
- **Réceptions** : une ou plusieurs par commande (livraisons partielles), référence du bon de livraison,
  rangement à l'emplacement choisi du site de livraison, **jamais au-delà du reste commandé**. Entrées en
  stock par le moteur (mouvement « Réception fournisseur », coût reçu). Une réception envoyée deux fois
  (même clé) n'est enregistrée qu'une fois. Coût réellement facturé facultatif, et report sur le prix
  d'achat de l'article au choix (droit de modifier les prix).
- **Annulation d'une réception** (erreur de saisie, livraison refusée) : motif obligatoire, sorties
  compensatoires aux mêmes emplacements (refusées si la marchandise n'y est plus, sauf stock négatif
  autorisé), commande rouverte ; rien n'est supprimé. Réception et lignes reçues figées par la base (seule
  l'annulation est admise, une fois).
- **Retours fournisseurs** : sorties tracées avec motif, commande d'origine facultative ; soumis à la
  politique de stock négatif ; idempotents ; ajout seul.
- **Prix d'achat** : historique par fournisseur et par article (une entrée par ligne reçue, ajout seul).
- **Coûts** : montrés seulement avec le droit de voir les prix d'achat. Un magasinier réceptionne (quantités,
  emplacements) sans voir ni saisir de coût ; le bon de commande lui est fermé.
- **Documents joints** à une commande, une réception ou un retour : PDF, JPEG ou PNG de 10 Mo au plus,
  10 par pièce, **type vérifié par la signature du fichier** (un faux PDF est refusé), nom nettoyé, stockage
  privé, téléchargement réservé à l'organisation et au site.
- **Étiquettes** après une réception : un clic imprime les étiquettes des articles reçus (une par unité,
  200 au plus par article).

## 11. Caisse (S4)

Décisions du 13/11/2026 : liste de clients propre à Stock ; remises soumises à un droit et plafonnées ;
écart de caisse enregistré avec un motif obligatoire.

- **Caisses** : une caisse appartient à un site et vend depuis un de ses emplacements. Elle a une
  imprimante de tickets (simulation, réseau, Bluetooth ou USB par le connecteur Android, WebUSB ou
  Bluetooth BLE depuis le navigateur) et une largeur de papier (58 ou 80 mm). Créées par un responsable.
- **Sessions** : fond de caisse à l'ouverture. **Une seule session ouverte par caisse**, garanti par la
  base. Clôture : espèces comptées contre espèces attendues (fond + espèces encaissées − espèces
  remboursées). Un écart exige un motif ; la session se clôt quand même et l'écart figure au rapport. Une
  session close ne change plus (déclencheur).
- **Vente** :
  - articles trouvés au scan (code-barres, référence) ou par une recherche tolérante aux fautes ;
  - prix TTC et TVA **relus dans le catalogue par le serveur**, jamais fournis par la caisse ;
  - client facultatif, choisi ou créé depuis la caisse ;
  - sortie de stock par le moteur à l'emplacement de la caisse (clé `stock-sale:<vente>:<ligne>`) ;
  - deux caisses qui vendent le dernier article : la seconde est refusée ;
  - une vente envoyée deux fois (même clé) n'est enregistrée qu'une fois ;
  - un article non stocké (service) se vend sans mouvement.
- **Remises** : par ligne, avec le droit « Accorder des remises », dans la limite du plafond des réglages
  (10 % par défaut). Le droit « remises sans plafond » permet de le dépasser. Le caissier n'en a pas par
  défaut ; un administrateur peut le lui accorder.
- **Paiements** : espèces, mobile money, carte, autre, **saisis à la main**. Aucune confirmation d'un
  prestataire n'est simulée ; la référence de la transaction est enregistrée. Paiements mixtes ; leur somme
  égale le total ; seules les espèces rendent la monnaie (un seul paiement en espèces par vente).
- **Paniers en attente** : 20 par caisse au plus. À la reprise, les prix et disponibilités sont relus ; un
  panier ne se reprend qu'une fois.
- **Ticket** : numéro, magasin, adresse et téléphone, caisse, caissier, client, articles, remises, TVA par
  taux, total, paiements et références, monnaie rendue, QR code du numéro de vente, pied de ticket. La même
  mise en page sert à l'aperçu, à l'impression ESC/POS (58 et 80 mm) et au PDF. Réimpression : mention
  DUPLICATA, comptée et tracée. **Impression réelle à valider sur matériel**, comme pour Ocall Park.
- **Retours** : quantités rendues, jamais plus que vendu (retours précédents déduits) ; remboursement au
  prorata du montant payé, le dernier retour rembourse exactement le reste ; dans la session ouverte d'une
  caisse du même magasin ; marchandise remise en stock ou non (défectueuse). Rejoué, un retour n'est fait
  qu'une fois.
- **Base** : une vente encaissée est figée (seul le compteur de réimpressions augmente) ; ses lignes aussi
  (seules les quantités et montants retournés augmentent) ; paiements et retours en ajout seul.
- **Clients** : nom, téléphone, e-mail, note ; archivés, jamais supprimés. La facture d'une vente en caisse
  se fait dans Facture, au client Facture choisi (§8).

## 12. Tableaux de bord, alertes et recherche globale (S6)

**Tableau de bord** (`/stock`, `GET reports/dashboard?from&to&siteId`) : 30 derniers jours par défaut, un an
au plus, un site ou tous ceux du membre. Chaque bloc n'apparaît qu'avec son droit ; sinon il vaut `null` :

| Bloc                                           | Droit                           |
| ---------------------------------------------- | ------------------------------- |
| Ventes, CA, ventes par jour, meilleures ventes | Consulter les ventes            |
| Marges, valeur du stock, valeur des réceptions | Voir les prix d'achat (en plus) |
| Stock, alertes                                 | Consulter les stocks            |
| Achats (commandes passées, réceptions)         | Consulter les achats            |
| Écarts d'inventaire                            | Consulter les mouvements        |

**Méthodes de calcul**, renvoyées par l'API et affichées à côté de chaque chiffre :

- **Chiffre d'affaires** : ventes encaissées en caisse Ocall Stock sur la période, moins les remboursements
  de la période. Les factures Ocall Facture restent dans Facture (aucun double compte).
- **Marge estimée** : CA hors taxe − quantités vendues × prix d'achat de la fiche article ; les articles sans
  prix d'achat sont exclus et comptés.
- **Marge brute** : CA hors taxe − quantités vendues × **coût moyen pondéré (CMUP)** des réceptions
  fournisseurs validées ; à défaut de réception, prix d'achat de la fiche (signalé).
- **Bénéfice net** : non calculé (aucune charge n'est saisie dans Ocall Stock).
- **Valeur du stock** : quantité × CMUP, ou prix de la fiche (signalé) ; sans aucun coût : non valorisé,
  compté à part.
- Les marges portent sur les ventes de la période, nettes de leurs retours.

**Alertes** (`/stock/alertes`, `GET reports/alerts`) : dans l'application seulement, rien n'est envoyé.

- **Rupture** : plus rien en stock sur le site.
- **À réapprovisionner** : disponible ≤ seuil d'alerte de la fiche, par site.
- **Faible rotation** : en stock, sans aucune sortie (vente, facture, pièce d'intervention, transfert, retour
  fournisseur, sortie manuelle) depuis N jours ; N = 90 par défaut, de 15 à 365 dans les réglages.
- Le menu affiche le nombre de ruptures et de stocks sous le seuil (`GET reports/alerts/count`).

**Recherche globale** : un champ en tête de chaque page (autocomplétion dès 2 caractères, flèches, Entrée)
et la page `/stock/recherche`.

- Types : articles (nom, référence, code-barres, **disponible par site**), catégories, marques,
  fournisseurs, clients (nom ou téléphone), ventes (numéro ou client), commandes fournisseurs (numéro ou
  fournisseur), sites et emplacements (code ou nom).
- Sans accents ni casse, fautes tolérées (`pg_trgm`, index GIN), requêtes paramétrées et limitées.
- Filtre par type, paginé (20 par page) ; lien vers chaque fiche.
- Droits et sites du membre respectés : un type non autorisé n'apparaît pas.

## 13. Site vitrine (S7)

Sur le modèle des vitrines Facture (adresse, brouillon puis publication, images, domaine personnalisé,
demandes), avec un **catalogue public facultatif**. Ce n'est pas un e-commerce : ni panier payant ni
commande en ligne.

- **Publication** : offre Ocall Stock « avec vitrine » exigée (sans droit historique), Stock accessible en
  plein, organisation active. Le brouillon reste toujours modifiable ; seule la version **publiée** est
  lue par le public. Une fois en ligne, l'adresse ne change plus.
- **Adresse** : domaine personnalisé actif, sinon sous-domaine des vitrines Stock
  (`STOCK_SITES_BASE_DOMAIN`, `STOCK_SITES_SUBDOMAINS_ENABLED`), sinon `/m/<slug>`. Les autres adresses
  redirigent (301) vers l'adresse canonique. Pages : accueil, `/catalogue`, `/article/<id>`.
- **Catalogue public** (réglage « Catalogue public ») : seulement les articles cochés **« Publier sur la
  vitrine »**, un par un (faux par défaut : rien n'est public sans décision). Lu en direct : un article
  archivé ou décoché disparaît aussitôt.
  - Prix de vente TTC si « Afficher les prix » est coché (le plus bas des variantes, « à partir de »),
    sinon « Prix sur demande ».
  - Disponibilité réduite à un badge **« Disponible »** (somme du disponible des sites actifs > 0) ou
    **« Sur commande »** ; un service est toujours disponible.
  - Photos des fiches article, servies seulement pour un article publié d'un site en ligne.
  - **Jamais publiés** : prix d'achat, marges, quantités, fournisseurs, clients.
  - Filtre par catégorie, recherche (fautes tolérées), 24 articles par page.
- **Demandes** (renseignement, devis) : le visiteur ajoute des articles à « ma demande » (quantités
  modifiables, gardées dans son navigateur), puis envoie le formulaire. Anti-spam (champ piège, durée de
  saisie), limitation de débit, téléphone ou e-mail exigé, articles publiés seulement. La demande arrive
  dans **« Demandes du site »** (Stock) ; rien n'est envoyé au visiteur, aucune vente ni commande créée.
- **Référencement** : métadonnées et Open Graph par page, adresse canonique, plan du site (accueil,
  catalogue, fiches), données structurées `Store` (accueil) et `Product` + `Offer` (fiche : prix s'il est
  affiché, `InStock` ou `BackOrder`). `robots.txt` autorise les images publiques des vitrines Stock.
- **Domaine personnalisé** : propriété prouvée par TXT, activation par le Super Admin (TXT revérifié, page
  de contrôle HTTPS). **Registre commun des domaines** (`common/sites/site-domain-registry.ts`) : un nom
  déclaré pour une vitrine Facture n'est jamais repris par Stock, et réciproquement (ni un site Park).
- **Droits** : « Gérer le site vitrine » (administrateur, responsable de magasin) ; « Traiter les demandes
  du site » (responsable de magasin, commercial).
- **Mise en page** (S9) : celle des sites Park (thème Aqua Premium) — en-tête fixe avec menu mobile,
  accueil plein écran sur la photo de couverture, sections alternées, articles en cartes, galerie en
  mosaïque, cartes de contact, pied de page, bouton WhatsApp permanent sur mobile — à la **couleur
  principale** choisie par le commerçant (même règle que Park : texte blanc lisible, contraste ≥ 4,5:1 ;
  sinon refusée ; sans choix, couleur Ocall). Composants communs aux vitrines Stock et Facture :
  `apps/web/src/components/site/showcase-premium.tsx`.
- **Plusieurs boutiques** (S10) : une seule vitrine (une adresse, un domaine), avec les **boutiques
  présentées** choisies par le commerçant (sites actifs de l'organisation ; téléphone, WhatsApp, horaires
  et carte propres ; nom et adresse repris du site, figés à la publication ; une boutique archivée n'est
  pas publiée). Page **« Nos boutiques »** (`/boutiques`) ; le visiteur choisit sa boutique (`?boutique=`,
  gardée de page en page) : catalogue et fiches affichent **son prix** et **sa disponibilité** (stock de
  cette boutique seulement), contacts et pied de page sont les siens, et la demande lui est **adressée**.
  Une boutique non présentée, archivée ou inconnue est ignorée (vitrine de l'entreprise). Dans « Demandes
  du site », la boutique est indiquée ; un membre limité à des boutiques voit les demandes des siennes et
  celles adressées à l'entreprise.

## 14. Intelligence artificielle (S8)

Sur **Ocall AI Core** (application `stock`), comme Facture : fournisseur configuré par la plateforme
(`AI_PROVIDER`), contexte de chaque appel construit depuis la session Stock, prompts versionnés
(`stock.restock`, `stock.stockout`, `stock.analysis`, `stock.product_photo`, `stock.illustration`,
empreintes au manifeste), consommation tracée sans contenu (`StockAiUsage`), propositions tracées
(`StockAiProposal`).

**Règles absolues.** L'IA propose, une personne décide. Elle ne modifie jamais une quantité, ne passe jamais
une commande, ne change jamais un prix, ne voit jamais une autre organisation et n'invente aucun chiffre :

- tous les chiffres sont calculés par le serveur (`packages/shared/src/stock-ai.ts`) ;
- les textes du modèle sont contrôlés : références connues seulement, aucun nombre absent des données
  fournies, aucune rupture annoncée comme certaine ; sinon la réponse est refusée (`AI_INVALID_OUTPUT`) et
  la consommation est tracée en échec.

**Réglages et quotas** (`/stock/ia`, administrateur) : IA **désactivée par défaut** ; activation et plafond
mensuel par fonctionnalité, sous les plafonds Ocall `STOCK_AI_MAX_MONTHLY_CALLS` (150 par défaut) et
`STOCK_AI_MAX_MONTHLY_IMAGES` (20, une image coûtant plus qu'un texte). Réservation atomique avant l'appel,
alerte au journal à 80 %. Droits : « Utiliser les assistants IA » et « Utiliser l'IA du catalogue »
(responsables de magasin et d'entrepôt).

| Fonctionnalité         | Calculé par le serveur                                                                                                                                                     | Rôle de l'IA                                                                        | Décision humaine                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Réapprovisionnement    | Sorties nettes sur 90 jours, disponible du site, déjà commandé, délai fournisseur (7 j supposé s'il manque, signalé), couverture visée, seuil d'alerte → quantité suggérée | Classe (urgent, bientôt, peut attendre) et explique                                 | « Créer le brouillon de commande » : lignes retenues, quantités corrigées ; commande **brouillon** seulement                                      |
| Ruptures               | Fourchette de jours avant épuisement (rythmes 30 et 90 jours), risque selon le délai                                                                                       | Explique les facteurs, prudemment                                                   | Consultation seule ; aucune date, aucune garantie                                                                                                 |
| Analyse commerciale    | Indicateurs du tableau de bord, période et période précédente (marges seulement pour qui voit les prix d'achat)                                                            | Synthèse, tendances, points forts et faibles, suggestions                           | Consultation seule                                                                                                                                |
| Fiche depuis une photo | Catégories de l'organisation ; code-barres gardé seulement si sa clé GTIN est juste (« lu sur la photo, à vérifier »)                                                      | Lit nom, marque, contenance, catégorie                                              | Le commerçant vérifie et crée l'article                                                                                                           |
| Illustration           | Description de l'article (articles **sans photo** seulement)                                                                                                               | Génère une image (`generateImage`, extension d'Ocall AI Core, `OPENAI_IMAGE_MODEL`) | « Ajouter à l'article » ou « Refuser » ; mention **« Illustration générée par IA »** ; visible sur la vitrine seulement si le commerçant le coche |

Aucun article à commander ou à risque, aucune vente à analyser : aucun appel, aucune consommation.

## 15. Base et déploiement

- **Migration** `20261201000000_stock_v1_catalogue` (additive) :
  - 13 tables ;
  - extensions `pg_trgm` et `unaccent` ;
  - contrôles : prix, TVA, préfixe, format et clé des codes, positions des photos ;
  - unicités sans tenir compte de la casse : références, catégories, marques ;
  - une seule variante par défaut par article ;
  - déclencheurs : profondeur des catégories, historiques en ajout seul.
  - Une purge d'organisation (`purgeStockOrganizations`, réglage local `ocall.stock_purge`) est seule admise
    à supprimer les historiques.
- **Migration** `20261202000000_stock_v1_entrepots` (S2, additive) : 9 tables (sites, rattachements,
  emplacements, niveaux, mouvements, transferts et lignes, inventaires et lignes), réglage
  `allowNegativeStock` ; contrôles (codes, quantités, réception ≤ expédition, deux sites distincts),
  « Général » unique par site, déclencheurs : arborescence des emplacements, emplacement dans le bon site,
  registre en ajout seul.
- **Migration** `20261203000000_stock_v1_achats` (S3, additive) : 8 tables (commandes et lignes,
  réceptions et lignes, retours et lignes, prix fournisseurs, documents) ; contrôles (quantités, reçu ≤
  commandé, coûts, motif d'annulation, types de documents) ; déclencheurs : lignes de commande figées dès la
  commande, réception figée sauf annulation, lignes reçues, retours et prix en ajout seul.
- **Migration** `20261204000000_stock_v1_caisse` (S4, additive) : 9 tables (clients, caisses, sessions,
  ventes et lignes, paiements, retours et lignes, paniers en attente), réglages de caisse (plafond des
  remises, coordonnées et pied des tickets) ; contrôles (totaux, quantités retournées ≤ vendues, paiements,
  motif d'écart) ; une session ouverte par caisse ; déclencheurs : session close figée, vente et lignes
  figées, paiements et retours en ajout seul.
- **Migration** `20261205000000_stock_v1_facture` (S5, additive) : 3 natures de mouvement (Facture),
  réglage `factureLocationId`, table `StockInboundEvent` (une ligne par clé, en ajout seul).
- **Migration** `20261206000000_stock_v1_rapports` (S6, additive) : réglage `slowMovingDays` (15 à 365),
  index des remboursements par date, index de recherche (clients, sites, emplacements).
- **Migration** `20261207000000_stock_v1_vitrine` (S7, additive) : `StockProduct.showcasePublished` (faux
  par défaut), vitrine, images, domaines, demandes ; contrôles (adresse, site en ligne publié, domaine,
  contact et longueur des demandes, 20 articles au plus) ; index partiel du catalogue public.
- **Migration** `20261208000000_stock_v1_ia` (S8, additive) : réglages, consommation et propositions IA ;
  `StockProductImage.aiGenerated` et `showcaseApproved` (une photo réelle est toujours visible sur la
  vitrine, contrôlé par la base).
- **Base Facture** : migration `20261129000000_facture_v1_stock` (S5, additive) :
  - colonnes facultatives : `FactureItem.stock*`, `FactureDocument.stockSale*`, `stockCovered`,
    `stockReturnGoods` ;
  - table `FactureStockOutbox` ;
  - contrôles : lien complet ou absent, vente sur une facture seulement, retour sur un avoir seulement ;
  - déclencheurs : colonnes S5 figées à l'émission, vente d'une facture immuable, demande jamais supprimée,
    états « transmise » et « non transmise » définitifs.
- **Base Suite** : migration de données `20261201000100_stock_v1_offres` (2 offres inactives).
- **Pré-déploiement** : `apps/api/railway.json` contient `db:stock:migrate:deploy`.

**⚠️ Le service Railway de préproduction utilise la commande de pré-déploiement de son tableau de bord.**
Elle ne contient ni l'étape Facture ni l'étape Stock : il faut la mettre à jour avant de déployer Stock.

**Variables.**

| Variable                         | Rôle                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| `STOCK_ENABLED`                  | `true` pour activer l'application                             |
| `STOCK_DATABASE_URL`             | URL de la base Stock                                          |
| `STOCK_DIRECT_URL`               | URL directe, pour les migrations ; même base                  |
| `STOCK_SITES_BASE_DOMAIN`        | Domaine des vitrines Stock (`<slug>.<domaine>`), API et web   |
| `STOCK_SITES_SUBDOMAINS_ENABLED` | `true` pour servir les vitrines sur leur sous-domaine         |
| `STOCK_AI_MAX_MONTHLY_CALLS`     | Plafond Ocall par fonctionnalité IA et par mois (150)         |
| `STOCK_AI_MAX_MONTHLY_IMAGES`    | Plafond Ocall des illustrations par mois (20)                 |
| `OPENAI_IMAGE_MODEL`             | Modèle de génération d'images d'Ocall AI Core (`gpt-image-1`) |

## 16. Tests

| Type                | Fichier                                                                                         | Contenu                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unitaires, partagés | `packages/shared/src/stock.spec.ts`                                                             | Rôles, ajustements, montants, clés GTIN, détection, nettoyage des lectures, équivalence UPC-A ↔ EAN-13 |
| Unitaires, API      | `ocall-stock.config.spec.ts`, `ocall-stock-boundaries.spec.ts`, `ocall-stock-label-pdf.spec.ts` | Configuration, frontières, codes relus par zxing, PDF à la taille du format                            |
| Unitaires, base     | `packages/database/src/migration-safety.spec.ts`                                                | Garde de la cible des migrations Stock                                                                 |
| Unitaires, S2       | `packages/shared/src/stock-warehouse.spec.ts`                                                   | QR codes d'emplacement, ordre des niveaux, permissions S2                                              |
| Unitaires, S4       | `packages/shared/src/stock-sales.spec.ts`                                                       | Montants, remises plafonnées, paiements et monnaie, remboursements, ticket 58 / 80 mm, droits          |
| Unitaires, S8       | `packages/shared/src/stock-ai.spec.ts`, `apps/api/src/ai-core/ai-core.spec.ts`                  | Quantité à commander, rupture prudente, code-barres lu sur photo ; génération d'image simulée          |
| Unitaires, S7       | `packages/shared/src/stock-showcase.spec.ts`                                                    | Adresse canonique, pages servies, données structurées (prix seulement s'il est affiché)                |
| Unitaires, S6       | `packages/shared/src/stock-reports.spec.ts`                                                     | CMUP, coût retenu, marges et exclusions, valeur, faible rotation, période                              |
| Unitaires, S5       | `packages/shared/src/stock-facture.spec.ts`                                                     | TTC → HT, quantités par article, sortie nette de la source, plafond des retours, délais de relance     |
| Unitaires, S9       | `apps/api/src/common/download.spec.ts`, `packages/shared/src/stock-sales.spec.ts`               | Nom de fichier quelconque téléchargeable ; total du ticket jamais tronqué                              |
| Intégration         | `apps/api/test/stock-s1…s8.integration.spec.ts`, `stock-s9-*`, `stock-s10.integration.spec.ts`  | Voir le détail ci-dessous                                                                              |
| E2E                 | `e2e/stock-s1.spec.ts` à `stock-s8.spec.ts`, `stock-s10.spec.ts`                                | Voir le détail ci-dessous                                                                              |

**Intégration**, sur bases locales jetables :

- accès, essai, portail et lecture seule ;
- catégories sur deux niveaux, articles, historiques en ajout seul (refusés par la base) ;
- codes-barres : clé, doublons, UPC-A ↔ EAN-13, code interne, contrainte en base ;
- lecture des scanners et recherche (fautes, accents, pagination) ;
- variantes, équipe et ajustements, photos, fournisseurs, étiquettes ;
- contrat de lecture ;
- isolation entre organisations ;
- S2 : sites et emplacements (arborescence refusée par la base, QR codes, étiquettes) ; entrée rejouée
  une seule fois ; stock insuffisant, service refusé ; déplacements ; deux sorties simultanées du dernier
  article (une seule passe) ; même clé envoyée deux fois en même temps ; stock négatif selon le réglage ;
  transfert réservé, expédié une fois, en transit, reçu en partie (rejeu sans effet), manque, annulation ;
  inventaire complet avec mouvement pendant le comptage, validation réservée, rapports ; périmètre des
  sites ; registre en ajout seul ; isolation ;
- S3 : commande brouillon puis figée par la base, totaux, bon de commande PDF ; réception partielle,
  rejouée, au-delà du commandé ou hors site refusée ; magasinier sans coûts ; report du coût réel et
  historique des prix ; annulation d'une réception (compensation, une seule fois, refusée si vendue) ;
  clôture, annulation ; retour fournisseur (rejeu, stock insuffisant, ajout seul) ; documents (signature
  vérifiée, isolation) ; isolation ;
- S4 : caisses et sessions (une seule ouverte, vente refusée sans session) ; articles en caisse ; vente aux
  prix du catalogue, paiements mixtes, monnaie, rejeu ; paiements refusés, article archivé ; remises selon
  le rôle et le plafond ; dernier article vendu par deux caisses ; ticket (aperçu, ESC/POS, PDF, duplicata),
  vente figée par la base ; retours (droit, prorata, remise en stock ou non, jamais plus que vendu, autre
  magasin refusé) ; clôture avec écart motivé, session figée ; paniers en attente ; clients ; sites ;
  isolation ;
- S5 (bases Stock et Facture) : Facture seul sans fonction Stock ; recherche, miroir en lecture seule, prix
  du jour, doublon proposé, rapproché, délié ; devis et brouillon sans effet, facture émise déstockée une
  fois (rejeu sans effet, service ignoré) ; emplacement non réglé et stock insuffisant en échec, relance
  réservée au gérant ; vente en caisse puis facture (deux demandes simultanées : une facture ; seul l'ajout
  sort) ; intervention signée puis facturée sans second déstockage, lien plus déliable ; avoir avec et sans
  retour, plafonné ; Stock échu (« stock non mis à jour ») ; garanties en base ; deux répartiteurs
  simultanés ;
- S6 : CA net des remboursements, hors taxe, jours, meilleures ventes, période refusée ; marges estimée et
  brute (CMUP), exclusions ; valeur du stock (repli signalé, non valorisé), achats, écarts d'inventaire,
  sites ; droits (caissier sans coûts), périmètre des sites, site d'une autre organisation refusé ; alertes
  et réglage de rotation, compteur ; recherche de tous les types, fautes, pagination, multi-sites, droits,
  isolation ;
- S7 : brouillon puis publication (offre « avec vitrine » exigée, version publiée seule), catalogue des
  seuls articles cochés (prix au choix, badge, aucune donnée interne), fiche, photos des seuls articles
  publiés, catalogue désactivé, article archivé ; demandes (articles, contact, anti-spam, formulaire
  fermé, droits, isolation) ; domaine (TXT, activation, adresse canonique, plan du site, unicité entre
  applications) ; garanties en base ;
- S8 (fournisseur IA simulé) : désactivée par défaut, réglages, droits, fonctionnalité désactivée ;
  réapprovisionnement (quantités du serveur, déjà commandé déduit, brouillon seulement, rien d'autre ne
  bouge, aucun appel sans article) ; chiffre inventé refusé ; ruptures (fourchette, risque, jamais
  « certaine ») ; analyse ; photo (catégorie, code-barres contrôlé) ; illustration (sans photo, mention,
  vitrine sur décision, quota propre, contrôle en base) ; propositions limitées aux sites du membre, aux
  ventes et aux coûts d'achat qu'il peut voir ; isolation ;
- S9, isolation (`stock-s9-tenancy`) : une organisation tente **chaque route** avec les identifiants d'une
  autre (76 routes à identifiant, 19 identifiants dans le corps, 26 listes) : 404 partout, aucune donnée
  dans les listes, rien de modifié (empreinte des tables). Une garde relit les contrôleurs : une nouvelle
  route à identifiant non couverte fait échouer le test ;
- S9, concurrence (`stock-s9-concurrency`) : réception rejouée, annulation de réception, expédition et
  réception de transfert, validation d'inventaire, vente rejouée, retours de la totalité, panier repris,
  clôture de caisse, proposition IA validée deux fois ou validée et refusée — chaque fois lancées deux fois
  en même temps : une seule compte ;
- S9, impression (`stock-s9-printing`) : étiquettes d'articles et d'emplacements à la taille exacte de
  chaque format, une par page ; tickets 58 et 80 mm (aucune ligne plus large que le papier, accents en
  PC858, coupe, jamais d'ouverture de tiroir), ticket PDF à la largeur du rouleau, duplicata ; bon de
  commande A4 paginé ; rapport d'inventaire ; CSV protégé contre les formules ;
- S9, sécurité (`stock-s9-security`) : corrections de la revue (§17) ;
- S10 (`stock-s10`) : prix de boutique fixé, inchangé s'il est identique, modifié puis retiré, tracé avec la
  boutique ; prix invalide, caissier sans droit, boutique d'une autre organisation ou hors des sites du
  membre, boutique archivée refusés ; un membre limité ne voit que les prix et l'historique de ses
  boutiques ; caisse de chaque boutique à son prix (paiement au prix commun refusé) ; étiquettes au prix de
  la boutique demandée ou de l'unique boutique du membre ; vitrine (boutiques en double, d'une autre
  organisation, lien de carte non https refusés ; boutique archivée jamais publiée, puis retirée du choix
  si archivée après publication ; prix et disponibilité de la boutique choisie ; boutique inconnue
  ignorée ; prix masqués partout ; plan du site) ; demandes adressées à une boutique présentée, visibles
  et modifiables par les seuls membres de cette boutique ; Facture garde le prix commun. Isolation : les
  deux routes de prix de boutique et les croisements variante / boutique entre organisations.

**E2E**, parcours navigateur :

- portail et réglages ;
- catégories, article, codes ;
- scan d'un code connu, puis d'un code inconnu suivi de la création de l'article ;
- recherche, étiquettes PDF, équipe ;
- format téléphone ;
- S2 : sites et emplacement, entrée, transfert préparé, expédié, reçu en partie puis manque, stocks par
  site, inventaire compté au scan et validé, panneau caméra ;
- S3 : commande passée, réception partielle puis du reste, annulation d'une réception, document joint,
  retour fournisseur ;
- S4 : caisse avec imprimante simulée, session, vente à la recherche avec monnaie et ticket imprimé, vente
  au scan mise en attente puis reprise et payée en deux moyens, retour remboursé, clôture avec écart, client,
  caisse sur téléphone ;
- S5 : emplacement des ventes Facture réglé ; article Stock cherché et ajouté dans une facture (prix,
  disponibilité, recherche sur téléphone), avertissement, émission puis « Stock mis à jour », trace dans
  Stock ; facture d'une vente en caisse ; miroir en lecture seule au catalogue ;
- S6 : tableau de bord (CA, marge et méthode, meilleures ventes), compteur d'alertes du menu et page des
  alertes, autocomplétion jusqu'à la fiche d'une vente, filtre par type et disponible par site, tableau de
  bord sur téléphone ;
- S7 : site créé, contenu et prix, article publié, mise en ligne ; accueil, catalogue (article interne
  absent), fiche (prix, « Disponible », données structurées), fiche sur téléphone ; demande de devis avec
  l'article, reçue dans « Demandes du site » ;
- S8 : IA activée, suggestion de réapprovisionnement puis brouillon de commande, ruptures, illustration
  (mention IA, hors vitrine), fiche préremplie depuis une photo, page IA sur téléphone ;
- S10 : prix propre à une boutique fixé sur la fiche article, retour au prix commun, historique ; vitrine à
  deux boutiques, choix de la boutique sur « Nos boutiques », son prix au catalogue et sur la fiche,
  demande adressée à la boutique et reçue avec elle, page des boutiques sur téléphone.

## 17. Stabilisation et revue de sécurité (S9)

**Revue de sécurité** du module (isolation, sites, droits, routes publiques, envois de fichiers, SQL,
concurrence, IA, journaux) : aucune faille critique. Corrigé :

| Gravité    | Constat                                                                                                                                                       | Correction                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Importante | Les propositions IA (réapprovisionnement, ruptures, analyse) étaient visibles de tout utilisateur de l'IA, quels que soient ses sites et ses droits           | Périmètre réel gardé avec chaque proposition ; liste, aperçu et décision limités aux sites du membre (une proposition sur toute l'organisation reste aux membres sans restriction), analyse réservée au droit des ventes, marges et coûts d'achat retirés pour qui ne les voit pas |
| Mineure    | Un responsable d'entrepôt (catalogue « hors prix ») fixait le prix de vente en créant un article                                                              | Fixer un prix exige le droit de gérer les prix : sans lui, l'article est créé au prix de vente 0, sans prix d'achat, et un responsable fixe ensuite le prix (indiqué dans le formulaire)                                                                                           |
| Mineure    | Une modification répondait 200 ou 403 selon que la valeur envoyée était le prix d'achat actuel                                                                | Droit vérifié dès que le champ est envoyé                                                                                                                                                                                                                                          |
| Mineure    | Le magasinier ouvrait les factures et bons fournisseurs joints (qui portent les prix d'achat) ; les photos jointes gardaient leurs métadonnées (position GPS) | Ouverture réservée au droit « Voir les prix d'achat » (la liste reste visible) ; photos réencodées sans métadonnées                                                                                                                                                                |
| Mineure    | Erreur 500 au téléchargement d'un fichier dont le nom contient « ’ » ; nom reçu mal décodé (« bonâ€™livraison »)                                              | En-tête `Content-Disposition` avec repli ASCII et nom exact encodé (outil commun : un nom ASCII est inchangé pour Facture et School) ; nom relu en UTF-8                                                                                                                           |
| Mineure    | Deux validations simultanées d'une proposition IA : deux brouillons de commande, ou photo dont le fichier venait d'être supprimé par un refus                 | Réservation atomique de la proposition avant l'action, rendue décidable si l'action échoue                                                                                                                                                                                         |
| Mineure    | Les mouvements venus de Facture étaient listés hors des sites du membre                                                                                       | Filtrés sur les emplacements de ses sites                                                                                                                                                                                                                                          |
| Mineure    | Un domaine déclaré mais jamais vérifié restait réservé sans fin ; la page de contrôle HTTPS publique révélait l'identifiant de l'organisation                 | Déclaration en attente libérée au bout de 7 jours ; la page sert une preuve dérivée du jeton du domaine                                                                                                                                                                            |
| Mineure    | Une requête anonyme du plan du site recalculait toutes les vitrines                                                                                           | Plan gardé 10 minutes par adresse servie (adresses inconnues jamais gardées), vitrines interrogées par lots de 10                                                                                                                                                                  |

Trouvés par les nouveaux tests et corrigés : le total du ticket 58 mm était tronqué (« TOTA 64 900 FCFA »
dès 10 000 FCFA) — libellé puis montant quand ils ne tiennent pas sur une ligne en double largeur ;
l'historique des prix d'achat d'une variante d'une autre organisation répondait une liste vide au lieu de 404.

**Validation sur le matériel cible** (à faire sur place, aucun matériel réel n'a été testé) :

1. Imprimante thermique 58 mm puis 80 mm (connecteur Ocall) : ticket d'une vente avec un article au nom
   long accentué et un total d'au moins 100 000 FCFA ; vérifier accents, largeur, coupe, QR code, puis
   duplicata ; le tiroir ne s'ouvre jamais par l'impression.
2. Étiquettes 40 × 30, 50 × 30 et 60 × 40 mm (imprimante d'étiquettes, échelle 100 %) : une étiquette par
   page, code-barres EAN-13 relu par la douchette et par le téléphone, QR code relu.
3. Étiquettes d'emplacements : QR code relu par la caméra (Android et iPhone) dans l'inventaire.
4. Douchette USB (mode clavier) en caisse et à l'inventaire ; caméra du téléphone (iPhone : lecture de
   secours `zxing-wasm`).

## 18. Audit Codex indépendant

Dossier préparé hors dépôt : `ocall-audits/brief-codex-ocall-stock-v1.md` (périmètre, branches, commandes
de test, règles absolues, points d'attention). Reste ensuite : migrations et déploiement en préproduction,
chacun sur accord explicite (le pré-déploiement Railway doit d'abord inclure les étapes Facture et Stock,
§15).
