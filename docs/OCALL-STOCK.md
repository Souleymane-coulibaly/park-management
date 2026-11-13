# Ocall Stock

Ocall Stock est l'application de gestion des articles, des stocks, des achats et des ventes d'Ocall Suite.
Elle s'adresse aux commerces, grossistes, distributeurs, quincailleries, supermarchés et PME.

Elle est vendue indépendamment d'Ocall Facture. Les deux applications fonctionnent ensemble quand une
organisation a les deux abonnements (sprint S5).

**État : sprints S1 (socle et catalogue), S2 (sites, stocks, transferts, inventaires), S3 (achats), S4
(caisse), S5 (interconnexion Facture), S6 (tableaux de bord, alertes, recherche globale) et S7 (site
vitrine) livrés.** L'IA et la stabilisation suivent (§16). Plan complet :
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

## 14. Base et déploiement

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

| Variable                         | Rôle                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| `STOCK_ENABLED`                  | `true` pour activer l'application                           |
| `STOCK_DATABASE_URL`             | URL de la base Stock                                        |
| `STOCK_DIRECT_URL`               | URL directe, pour les migrations ; même base                |
| `STOCK_SITES_BASE_DOMAIN`        | Domaine des vitrines Stock (`<slug>.<domaine>`), API et web |
| `STOCK_SITES_SUBDOMAINS_ENABLED` | `true` pour servir les vitrines sur leur sous-domaine       |

## 15. Tests

| Type                | Fichier                                                                                         | Contenu                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unitaires, partagés | `packages/shared/src/stock.spec.ts`                                                             | Rôles, ajustements, montants, clés GTIN, détection, nettoyage des lectures, équivalence UPC-A ↔ EAN-13 |
| Unitaires, API      | `ocall-stock.config.spec.ts`, `ocall-stock-boundaries.spec.ts`, `ocall-stock-label-pdf.spec.ts` | Configuration, frontières, codes relus par zxing, PDF à la taille du format                            |
| Unitaires, base     | `packages/database/src/migration-safety.spec.ts`                                                | Garde de la cible des migrations Stock                                                                 |
| Unitaires, S2       | `packages/shared/src/stock-warehouse.spec.ts`                                                   | QR codes d'emplacement, ordre des niveaux, permissions S2                                              |
| Unitaires, S4       | `packages/shared/src/stock-sales.spec.ts`                                                       | Montants, remises plafonnées, paiements et monnaie, remboursements, ticket 58 / 80 mm, droits          |
| Unitaires, S7       | `packages/shared/src/stock-showcase.spec.ts`                                                    | Adresse canonique, pages servies, données structurées (prix seulement s'il est affiché)                |
| Unitaires, S6       | `packages/shared/src/stock-reports.spec.ts`                                                     | CMUP, coût retenu, marges et exclusions, valeur, faible rotation, période                              |
| Unitaires, S5       | `packages/shared/src/stock-facture.spec.ts`                                                     | TTC → HT, quantités par article, sortie nette de la source, plafond des retours, délais de relance     |
| Intégration         | `apps/api/test/stock-s1…s7.integration.spec.ts` (`TEST_STOCK_DATABASE_URL`)                     | Voir le détail ci-dessous                                                                              |
| E2E                 | `e2e/stock-s1.spec.ts` à `stock-s7.spec.ts`                                                     | Voir le détail ci-dessous                                                                              |

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
  applications) ; garanties en base.

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
  l'article, reçue dans « Demandes du site ».

## 16. Suite de la feuille de route

| Sprint | Contenu                                                        |
| ------ | -------------------------------------------------------------- |
| S8     | IA : réapprovisionnement, ruptures, analyse, images d'articles |
| S9     | Stabilisation                                                  |
