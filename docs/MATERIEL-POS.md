# Matériel de caisse — POS Android, imprimantes thermiques et tiroirs-caisses (Sprint 3)

## 1. Ce qui est livré, et ce qui reste à valider

| Élément                                      | État                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Serveur : postes, impressions, tiroir, audit | ✅ Implémenté et testé (tests d'intégration sur la branche Neon `test`)                          |
| Application web : caisse, impression, tiroir | ✅ Implémentée, testée en E2E **avec l'imprimante « Simulation »**                               |
| Encodeur ESC/POS (58 / 80 mm, accents PC858) | ✅ Implémenté et testé unitairement (octets et mise en page)                                     |
| Connecteur Android (WebView + pont, Kotlin)  | ⚠️ Écrit, **non compilé et non testé** : aucun SDK Android dans l'environnement de développement |
| Impression réelle USB / Bluetooth / réseau   | ⚠️ **Non validée** : aucune imprimante physique disponible                                       |
| Ouverture réelle d'un tiroir-caisse          | ⚠️ **Non validée** : aucun tiroir physique disponible                                            |

Les tests automatisés valident le parcours logiciel et les règles de sécurité. **Ils ne prouvent pas**
qu'une imprimante donnée imprime correctement : cette preuve relève du protocole du §7, à dérouler
sur le matériel cible.

## 2. Architecture

```
Tablette Android
 ┌──────────────────────────────────────────────────────────┐
 │ Application « Ocall Park Caisse » (apps/android)         │
 │  WebView ── charge https://<domaine Ocall Park>          │
 │     │  pont « OcallHardware » (origine autorisée unique) │
 │     ▼                                                    │
 │  HardwareBridge ─► CommandValidator ─► Transport         │
 │                         NETWORK (TCP 9100) / BLUETOOTH (SPP) / USB (bulk)
 └──────────────────────────────────────────────────────────┘
          │ HTTPS                               │ ESC/POS
          ▼                                     ▼
   API Ocall Park (autorise, historise)    Imprimante thermique ─(RJ11)─ Tiroir-caisse
```

1. L'appareil demande au serveur une impression (`POST /print-jobs`) ou une ouverture de tiroir
   (`POST /drawer-events`).
2. Le serveur vérifie permissions, établissement, statut de la vente ou du paiement, idempotence,
   puis renvoie la commande (flux ESC/POS du ticket, ou broche du tiroir).
3. L'appareil l'exécute via le pont Android (ou la simulation), puis rapporte le résultat
   (`POST /…/:id/result`), conservé dans l'historique.

Le tiroir-caisse est relié à l'imprimante (port RJ11 « DK ») : son ouverture est une impulsion
envoyée par l'imprimante (commande ESC/POS `ESC p`).

## 3. Règles garanties par le serveur

| Règle                                                           | Mise en œuvre                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ticket imprimé **après** confirmation du paiement               | `409 SALE_NOT_PAID` sinon                                                                      |
| Un échec d'impression n'annule jamais une vente encaissée       | Les impressions sont dans une table séparée ; aucune écriture sur la vente (testé)             |
| Historique des tentatives                                       | Une ligne `PrintJob` par tentative (statut, code d'erreur, auteur, poste, date)                |
| Pas de double impression du ticket original                     | Clé d'idempotence ; `PRINT_IN_PROGRESS` ; `RECEIPT_ALREADY_PRINTED` après succès               |
| Réimpression contrôlée                                          | Permission `receipt.reprint`, motif obligatoire, mention **DUPLICATA**, audit                  |
| Tiroir : automatique uniquement après paiement espèces confirmé | Moyen `CASH`, statut `SUCCEEDED`, encaissé par le demandeur, moins de 10 min                   |
| Tiroir : jamais pour Wave                                       | `409 DRAWER_NOT_ALLOWED_FOR_METHOD`                                                            |
| Tiroir : une seule ouverture par paiement                       | Contrainte d'unicité `DrawerEvent.paymentId` ; requêtes concurrentes testées                   |
| Tiroir : ouverture manuelle                                     | Permission `drawer.open_manual`, justification (5 à 200 caractères), audit                     |
| Protection contre les commandes répétées                        | Délai minimal de 10 s entre deux ouvertures manuelles par poste (`429`), + 3 s côté connecteur |
| Isolation                                                       | Poste, vente et paiement doivent appartenir à l'organisation et à l'établissement              |

Permissions : `hardware.manage` (propriétaire, administrateur) configure les postes et lance les tests ;
`receipt.reprint` et `drawer.open_manual` sont accordées aussi au superviseur ; le caissier imprime
ses tickets et déclenche l'ouverture automatique de ses paiements en espèces.

## 4. Sécurité du pont Android

- Le pont est injecté avec `WebViewCompat.addWebMessageListener`, **limité à une seule origine HTTPS**
  (celle de l'application, fixée au build). Aucune autre page, iframe ou site tiers ne peut l'appeler.
- La WebView ne navigue que sur cette origine ; pas d'accès fichiers, pas de contenu mixte, pas de
  trafic HTTP en clair.
- Quatre commandes seulement : `info`, `print`, `test`, `openDrawer`. Validation identique côté web
  (`packages/shared/src/hardware/bridge-protocol.ts`) et côté natif (`CommandValidator.kt`) :
  - imprimante réseau : **IPv4 privée** uniquement (10/8, 172.16/12, 192.168/16) et port **9100–9109** —
    le pont ne peut pas servir à joindre une machine arbitraire ;
  - flux d'impression : base64 valide, 64 Kio maximum, **refusé s'il contient une séquence d'ouverture
    de tiroir** (`ESC p`, `DLE DC4`) ;
  - la commande de tiroir est **générée par le connecteur**, jamais transmise par la page.
- Limite assumée : le pont ne peut pas vérifier lui-même l'autorisation métier. Une page compromise
  servie depuis l'origine autorisée pourrait demander une ouverture de tiroir ; la protection repose
  sur l'intégrité de l'application web (HTTPS) et sur le délai minimal natif de 3 s.
- Aucun secret n'est stocké dans le connecteur : la session reste le cookie httpOnly de la WebView.

## 5. Imprimantes prises en charge

Toute imprimante thermique compatible **ESC/POS** (jeu de commandes Epson), en 58 mm (32 caractères)
ou 80 mm (48 caractères), avec la page de code **PC858** (accents français et €).

| Connexion  | Adresse saisie                        | Prérequis                                                  |
| ---------- | ------------------------------------- | ---------------------------------------------------------- |
| Réseau     | `192.168.1.50:9100` (port facultatif) | Imprimante et tablette sur le même réseau local, IP fixe   |
| Bluetooth  | `00:11:22:33:44:55`                   | Imprimante appairée dans les réglages Android (profil SPP) |
| USB        | `04B8:0202` (vendorId:productId)      | Câble OTG ; autorisation USB acceptée sur la tablette      |
| Simulation | —                                     | Aucun matériel : tests et démonstrations uniquement        |

## 6. Mode simulation

L'imprimante « Simulation (aucun matériel) » n'envoie rien : le ticket est consigné dans la console
du navigateur (et dans `window.__ocallSimulated` pour les tests E2E). La case « Simuler une
imprimante indisponible » (page Matériel) provoque un échec, pour vérifier la gestion d'erreur.
**Un test réussi en simulation n'est pas une validation matérielle.**

## 7. Protocole de validation sur matériel réel (à dérouler avant mise en service)

Matériel : une tablette Android 8+ (idéalement celle du client), une imprimante ESC/POS par type de
connexion visé, un tiroir-caisse relié à l'imprimante (RJ11), des rouleaux 58 et 80 mm.

1. **Construction** : `cd apps/android && ./gradlew assembleRelease -PocallParkUrl=https://<domaine>`
   (Android Studio ou SDK requis), installation de l'APK, vérification que la caisse se charge.
2. **Détection du pont** : page Matériel → « Connecteur Android détecté ».
3. Pour **chaque** connexion (réseau, Bluetooth, USB) et **chaque** largeur (58, 80 mm) :
   - [ ] « Tester » : la page de test sort, lisible, accents corrects (é è ê à ç ù ô î €), colonnes alignées ;
   - [ ] vente encaissée en espèces : ticket conforme à l'aperçu, coupe du papier ;
   - [ ] tiroir : s'ouvre **une seule fois** après le paiement ; broche 2 puis 5 si nécessaire ;
   - [ ] imprimante éteinte : échec affiché, **vente toujours « Payée »**, échec visible dans l'historique ;
   - [ ] imprimante rallumée : « Réessayer l'impression » fonctionne ;
   - [ ] réimpression par un superviseur : mention DUPLICATA ;
   - [ ] ouverture manuelle justifiée ; deux demandes rapprochées : la seconde est refusée.
4. **Robustesse** : coupure Wi-Fi pendant un encaissement (aucun double paiement), rotation de
   l'écran portrait / paysage, mise en veille et reprise.
5. **Sécurité** : vérifier qu'une page d'un autre domaine ouverte dans la WebView n'a pas accès à
   `OcallHardware`, et qu'une imprimante réseau en IP publique est refusée.

Consigner pour chaque essai : modèle d'imprimante, connexion, largeur, version Android, résultat,
photo du ticket. Ces résultats constituent la validation matérielle du Sprint 3.
