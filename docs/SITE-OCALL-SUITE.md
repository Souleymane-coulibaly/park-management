# Site commercial Ocall Suite (Sprint 12A)

Le site commercial présente Ocall Suite et ses solutions. Il est **distinct** des sites vitrines des
clients (Sprint 10, route `/e/[slug]`, thème Aqua Premium), qui ne sont pas modifiés.

## Pages

| Page                                            | Contenu                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                             | Accueil : présentation, solutions (catalogue de l'API), avantages, fonctionnement, appels à l'action                                |
| `/solutions`                                    | Catalogue : nom, public visé, statut commercial, lien vers la page produit                                                          |
| `/solutions/[slug]`                             | Page produit : fonctionnalités **livrées** (Park, Restaurant) ou présentation de projet (autres), tarifs seulement si commercialisé |
| `/tarifs`                                       | Offres Ocall Park (API) : Restaurant 250 000 + 15 000/mois, Parc 250 000 + 15 000/mois, Parc + Restaurant 350 000 + 25 000/mois     |
| `/demo`                                         | Demande de démonstration (aucun abonnement créé)                                                                                    |
| `/a-propos`, `/contact`                         | Présentation et coordonnées — **champs à compléter**                                                                                |
| `/mentions-legales`, `/confidentialite`, `/cgu` | Pages légales — **champs à compléter, non indexées** (`noindex`)                                                                    |
| `/metiers`, `/fonctionnalites`                  | Redirections permanentes vers `/solutions` et `/solutions/ocall-park`                                                               |

Aucune information juridique ni coordonnée n'est inventée : les données manquantes sont signalées
« [À compléter : …] » et un bandeau rappelle que la page n'est pas publiable en l'état.

## Catalogue et statuts

Le statut est décidé **par le serveur** (`SaasProduct.status`) : `PLANNED` (non public),
`COMING_SOON` (« Bientôt disponible »), `PILOT`, `ACTIVE` (« Disponible »), `SUSPENDED`, `RETIRED`.
Seul `ACTIVE` est souscriptible (et `PILOT` par Ocall). L'API publique
`GET /api/v1/public/suite/products` ne renvoie que les produits listés et publics, et les tarifs
seulement pour un produit commercialisé. Ocall School, Clinic, RH, Solar et Docs sont « Bientôt
disponible », sans tarif ni date. La présentation (accroche, identifiant public, visibilité, adresse
de l'application, date validée) se modifie dans _Super Admin → Produits_.

## Demande de démonstration

- Champs : nom, entreprise, pays, téléphone, e-mail, produit souhaité, message, consentement.
- Anti-spam sans service tiers : champ piège invisible, délai minimal de 3 s, formulaire valable
  24 h, limite de 5 demandes par IP sur 10 minutes (`PUBLIC_LEAD_THROTTLE_LIMIT`). Un envoi
  automatisé reçoit la même réponse sans être enregistré.
- Conservation 24 mois puis anonymisation (_Super Admin → Demandes de démo → purge_, journalisée).
- Suivi : _Super Admin → Demandes de démo_ (statuts Nouvelle, Contactée, Démonstration planifiée,
  Gagnée, Perdue, Indésirable). **Aucun e-mail** n'est envoyé (V1).

## Domaines (cibles, non achetés)

| Cible                  | Configuration nécessaire                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `www.ocallsuite.com`   | Ajouter à `APP_HOSTS` (web) et `WEB_ORIGIN` (API) ; `SUITE_PUBLIC_URL` (web) pour le SEO |
| `admin.ocallsuite.com` | Même service web : ajouter à `APP_HOSTS` et `WEB_ORIGIN`                                 |
| Sites vitrines clients | **Inchangés** : `SITES_BASE_DOMAIN` reste `ocallpark.com` (décision du 2026-10-31)       |

Un domaine absent de `APP_HOSTS` est traité comme un site vitrine : toutes les pages commerciales y
renverraient une 404. Aucun domaine n'est acheté ni configuré à ce jour.

## SEO et accessibilité

Métadonnées propres au site (titre `… · Ocall Suite`, description, OpenGraph, URL canonique),
données structurées `Organization`, plan du site mis à jour, lien d'évitement « Aller au contenu »,
navigation au clavier, contrastes de la charte (vert `#176B53`, or `#D99B38`, terracotta `#C46A43`,
ivoire `#F6F0E5`, anthracite `#24352F`). Les métadonnées et la marque restent limitées au groupe de
pages du site commercial : l'application et les sites vitrines conservent les leurs.
