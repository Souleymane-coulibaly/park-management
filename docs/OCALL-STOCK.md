# Ocall Stock

Ocall Stock est l'application de gestion des articles, des stocks, des achats et des ventes d'Ocall Suite.
Elle s'adresse aux commerces, grossistes, distributeurs, quincailleries, supermarchés et PME.

Elle est vendue indépendamment d'Ocall Facture. Les deux applications fonctionnent ensemble quand une
organisation a les deux abonnements (sprint S5).

**État : sprint S1 livré (socle et catalogue).** Les stocks, achats, caisse, interconnexion avec Facture,
tableaux de bord, vitrine et IA suivent, sprint par sprint (§11). Plan complet :
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

| Élément | Emplacement |
|---|---|
| Base et migrations | `packages/stock-database` (`@ocall/stock-database`, client `.prisma/stock-client`) |
| API | `apps/api/src/modules/ocall-stock`, routes `/api/v1/ocall-stock/...` |
| Contrat avec Facture | `apps/api/src/common/integration/catalog-integration.ts` |
| Règles partagées | `packages/shared/src/stock.ts`, `stock-barcodes.ts`, `stock-labels.ts` |
| Web | `apps/web/src/app/stock` (route `/stock`), `components/stock`, `components/scan` |

- **Préfixe `/ocall-stock`.** Côté API, `/stock` appartient déjà au stock d'ingrédients du restaurant
  d'Ocall Park.
- **Frontières.** Elles sont vérifiées par un test (`ocall-stock-boundaries.spec.ts`) :
  - le module n'importe que le socle commun et `organizations` ;
  - aucun autre module ne l'importe.
- **Seul lien avec les autres modules** : le jeton `STOCK_CATALOG_READER`, défini dans `common/integration`.
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

| Permission | Admin. | Resp. magasin | Resp. entrepôt | Magasinier | Caissier | Commercial | Lecteur |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Accéder | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Réglages | ✔ | | | | | | |
| Voir l'équipe | ✔ | ✔ | ✔ | | | | ✔ |
| Gérer l'équipe et les permissions | ✔ | | | | | | |
| Consulter le catalogue | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Gérer le catalogue (hors prix) | ✔ | ✔ | ✔ | | | | |
| Voir les prix d'achat | ✔ | ✔ | ✔ | | | | ✔ |
| Modifier les prix | ✔ | ✔ | | | | | |
| Consulter les fournisseurs | ✔ | ✔ | ✔ | ✔ | | | ✔ |
| Gérer les fournisseurs | ✔ | ✔ | ✔ | | | | |
| Imprimer les étiquettes | ✔ | ✔ | ✔ | ✔ | | ✔ | |

**Ajustements par membre.** Un administrateur accorde ou retire une permission à un membre, en plus de son
rôle.
- L'accès, les réglages et la gestion de l'équipe ne sont jamais ajustables.
- Personne ne modifie son propre accès.
- Désactiver un membre ferme aussitôt ses sessions.

**Contrôle côté serveur, à chaque requête :**
- un champ autre qu'un prix exige « Gérer le catalogue » ;
- un prix exige « Modifier les prix » ;
- un prix d'achat exige en plus « Voir les prix d'achat ».

Sans ce droit, le prix d'achat est retiré de toutes les réponses, historiques compris.

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
  - le scan par la caméra du téléphone ou de la tablette arrive au sprint S2.

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

## 8. Contrat avec Ocall Facture (préparé au S1, utilisé au S5)

`StockCatalogReader` (`common/integration/catalog-integration.ts`) se lit dans un seul sens : de Stock vers
Facture.
- `isAvailable` : Stock est activé et l'organisation y a droit (consultation seule comprise).
- `search` : recherche des articles actifs.
- `variants` : articles désignés, de cette organisation seulement.

Chaque article renvoie : libellé (article et variante), référence, unité, prix TTC du jour, TVA, code
principal, stocké ou non.

Facture ne modifie jamais un article Stock. Les demandes de mouvement passeront par un contrat distinct :
- déstockage unique à l'émission d'une facture ;
- retours ;
- file de sortie idempotente.

## 9. Base et déploiement

- **Migration** `20261201000000_stock_v1_catalogue` (additive) :
  - 13 tables ;
  - extensions `pg_trgm` et `unaccent` ;
  - contrôles : prix, TVA, préfixe, format et clé des codes, positions des photos ;
  - unicités sans tenir compte de la casse : références, catégories, marques ;
  - une seule variante par défaut par article ;
  - déclencheurs : profondeur des catégories, historiques en ajout seul.
  - Une purge d'organisation (`purgeStockOrganizations`, réglage local `ocall.stock_purge`) est seule admise
    à supprimer les historiques.
- **Base Suite** : migration de données `20261201000100_stock_v1_offres` (2 offres inactives).
- **Pré-déploiement** : `apps/api/railway.json` contient `db:stock:migrate:deploy`.

**⚠️ Le service Railway de préproduction utilise la commande de pré-déploiement de son tableau de bord.**
Elle ne contient ni l'étape Facture ni l'étape Stock : il faut la mettre à jour avant de déployer Stock.

**Variables.**

| Variable | Rôle |
|---|---|
| `STOCK_ENABLED` | `true` pour activer l'application |
| `STOCK_DATABASE_URL` | URL de la base Stock |
| `STOCK_DIRECT_URL` | URL directe, pour les migrations ; même base |

## 10. Tests

| Type | Fichier | Contenu |
|---|---|---|
| Unitaires, partagés | `packages/shared/src/stock.spec.ts` | Rôles, ajustements, montants, clés GTIN, détection, nettoyage des lectures, équivalence UPC-A ↔ EAN-13 |
| Unitaires, API | `ocall-stock.config.spec.ts`, `ocall-stock-boundaries.spec.ts`, `ocall-stock-label-pdf.spec.ts` | Configuration, frontières, codes relus par zxing, PDF à la taille du format |
| Unitaires, base | `packages/database/src/migration-safety.spec.ts` | Garde de la cible des migrations Stock |
| Intégration | `apps/api/test/stock-s1.integration.spec.ts` (`TEST_STOCK_DATABASE_URL`) | Voir le détail ci-dessous |
| E2E | `e2e/stock-s1.spec.ts` | Voir le détail ci-dessous |

**Intégration**, sur bases locales jetables :
- accès, essai, portail et lecture seule ;
- catégories sur deux niveaux, articles, historiques en ajout seul (refusés par la base) ;
- codes-barres : clé, doublons, UPC-A ↔ EAN-13, code interne, contrainte en base ;
- lecture des scanners et recherche (fautes, accents, pagination) ;
- variantes, équipe et ajustements, photos, fournisseurs, étiquettes ;
- contrat de lecture ;
- isolation entre organisations.

**E2E**, parcours navigateur :
- portail et réglages ;
- catégories, article, codes ;
- scan d'un code connu, puis d'un code inconnu suivi de la création de l'article ;
- recherche, étiquettes PDF, équipe ;
- format téléphone.

## 11. Suite de la feuille de route

| Sprint | Contenu |
|---|---|
| S2 | Sites, emplacements et QR, registre des mouvements, transferts, inventaires, scan caméra |
| S3 | Achats et réceptions |
| S4 | Caisse et tickets thermiques |
| S5 | Interconnexion Facture |
| S6 | Tableaux de bord et recherche complète |
| S7 | Vitrine |
| S8 | IA : réapprovisionnement, ruptures, analyse, images d'articles |
| S9 | Stabilisation |
