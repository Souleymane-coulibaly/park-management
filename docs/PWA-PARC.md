# PWA du parc (Sprint 13)

Application installable pour les employés du parc, sans passer par les stores. Elle réutilise les
écrans et les API existants ; aucune migration de base n'est nécessaire.

## 1. Écrans

Sur téléphone et tablette en portrait, une barre en bas de l'écran remplace les onglets. Elle n'affiche
que ce que le rôle autorise ; l'API applique les mêmes règles.

| Écran           | Adresse                    | Permission       | Rôles par défaut                          |
| --------------- | -------------------------- | ---------------- | ----------------------------------------- |
| Tableau de bord | `/app/billetterie/tableau` | `sale.read_all`  | Propriétaire, administrateur, superviseur |
| Billetterie     | `/app/billetterie`         | `pos.sell`       | Responsables, caissier                    |
| Scanner         | `/app/controle-acces`      | `access.scan`    | Responsables, agent d'entrée              |
| Visiteurs       | `/app/parc/visiteurs`      | `sale.read_all`  | Responsables                              |
| Entrées         | `/app/parc/historique`     | `access.scan`    | Responsables, agent d'entrée              |
| Statistiques    | `/app/analytics/parc`      | `analytics.read` | Responsables                              |
| Paramètres      | `/app/parc/parametres`     | Session          | Tous (appareil et compte seulement)       |

La page Visiteurs n'affiche jamais de QR : elle sert à retrouver un visiteur, pas à présenter un billet.

## 2. Résultat d'un contrôle

| Couleur | Signification                                                 | Décision de l'agent          |
| ------- | ------------------------------------------------------------- | ---------------------------- |
| Vert    | Le serveur a enregistré l'entrée                              | Laisser entrer               |
| Rouge   | Le serveur refuse : déjà utilisé, expiré, inconnu, parc fermé | Ne pas laisser entrer        |
| Orange  | Pas de réponse fiable (réseau, délai de 10 s, erreur serveur) | Attendre, vérifier à nouveau |

Seul le serveur décide. Après une réponse perdue, **Vérifier à nouveau** renvoie le même billet avec la
même clé : si l'entrée avait été enregistrée, le serveur renvoie ce résultat, et non « déjà utilisé ».
Cette clé reste en mémoire : si la page est rechargée entre-temps, un billet déjà enregistré apparaîtra
« déjà utilisé », avec l'heure d'entrée, que l'agent peut comparer.

## 3. Réseau

- La connexion est vérifiée en interrogeant `/api/v1/health` (toutes les 30 s, toutes les 5 s pendant une
  coupure, et au retour au premier plan), car `navigator.onLine` reste vrai sur un Wi-Fi sans Internet.
  Deux échecs consécutifs sont exigés : une réponse lente isolée ne suspend pas les ventes.
- Pendant une coupure : indicateur « Hors ligne » dans l'en-tête, ventes et entrées suspendues.
- Au retour du réseau : indicateur retiré, listes rechargées. Un scan en échec n'est **jamais** rejoué
  automatiquement, car le visiteur peut être parti.
- Une page qui ne peut pas être chargée affiche une explication, puis se recharge seule.

**Cache du Service Worker** (portée `/app`) : `_next/static`, icônes et page hors ligne uniquement.
Jamais `/api` ni les pages de l'application, donc aucune donnée de vente, de visiteur ou de session.
Le contrôle hors ligne n'est pas activé : voir [CONTROLE-HORS-LIGNE.md](CONTROLE-HORS-LIGNE.md).

## 4. Installation

HTTPS obligatoire (caméra, Service Worker, installation).

- **Android (Chrome)** : _Paramètres_ → _Installer l'application_, ou menu de Chrome → _Installer l'application_.
- **iPhone et iPad (Safari)** : _Partager_ → _Sur l'écran d'accueil_.

## 5. Mise à jour

Chaque déploiement change la version du Service Worker (`VERCEL_GIT_COMMIT_SHA` ou
`RAILWAY_GIT_COMMIT_SHA`). L'application propose alors « Nouvelle version disponible » : rien n'est
rechargé sans l'accord de l'employé, pour ne pas interrompre un contrôle. Les pages étant chargées depuis
le réseau, une correction serveur s'applique sans attendre.

## 6. Recette sur appareils réels

À faire en HTTPS, ces points ne sont pas prouvés par les tests automatisés :

- [ ] Android : installation, icône, écran de lancement, mode plein écran
- [ ] iPhone : ajout à l'écran d'accueil, icône, écran de lancement
- [ ] Android et iPhone : caméra arrière, lecture d'un vrai QR imprimé et sur écran, en plein soleil
- [ ] Mode avion pendant un scan : orange, puis retour au vert après **Vérifier à nouveau**
- [ ] Wi-Fi sans Internet : indicateur « Hors ligne » en moins d'une minute
- [ ] Deux téléphones scannent le même billet : un vert, un rouge
- [ ] Déploiement d'une nouvelle version : proposition de mise à jour, application après accord

## 7. Limites connues

- iPhone : les écrans de lancement couvrent cinq formats courants en portrait ; ailleurs, fond uni.
- iPhone : Safari ne propose aucun bouton d'installation, d'où les instructions affichées.
- La recherche de visiteurs porte sur une journée de vente et affiche 100 billets au plus.
- L'historique affiche 200 passages au plus par journée.
