# Sites vitrines des établissements — Ocall School (Sprint 10)

Chaque établissement peut publier un site public multipage, en français et en arabe, à l'adresse
`<slug>.ocall.school`. Ce document décrit ce qui est livré, les règles de sécurité et de vie privée, et
la configuration DNS/TLS **qui reste à faire**.

> **État au 06/11/2026 : les sous-domaines ne sont PAS opérationnels.** `ocall.school` n'existe pas
> dans le DNS (NXDOMAIN, aucun serveur de noms ; vérifié par requête DNS). Le domaine de premier niveau
> `.school` existe. Tant que le domaine n'est pas acheté et configuré (§ 7), les sites sont servis à
> l'adresse provisoire `<origine>/s/<slug>`, et `SCHOOL_SITES_SUBDOMAINS_ENABLED` doit rester à `false`.
> Les tests automatisés valident le routage par nom d'hôte avec des noms **locaux**
> (`<slug>.ecoles.localhost`, résolus par Chromium sans DNS). Ils ne prouvent rien sur le DNS ni sur
> le certificat réels.

## 1. Ce que l'établissement peut faire

| Action                                                    | Qui (rôle School)                             |
| --------------------------------------------------------- | --------------------------------------------- |
| Créer le site (choix de l'adresse), l'activer, le publier | Direction (`school.site.publish`)             |
| Dépublier, désactiver, publier une actualité              | Direction                                     |
| Rédiger contenus, photos, actualités, réseaux sociaux     | Direction, secrétariat (`school.site.manage`) |
| Retirer immédiatement une photo                           | Direction, secrétariat                        |
| Exporter tous les contenus (JSON)                         | Direction, secrétariat                        |
| Enseignant, surveillant, comptable                        | Aucun accès                                   |

Toutes les vérifications sont faites par l'API (organisation, périmètre d'établissements, rôle,
contrat). Un autre client, ou un directeur d'un autre établissement du même client, reçoit 404.

## 2. Architecture

- **Base School** (migration additive `20261113000000_sites_vitrines_etablissements`) : `SchoolSite`
  (adresse unique, langues, thème, brouillon, version publiée), `SchoolSiteMedia`, `SchoolSiteNews`,
  `SchoolSiteLink`. Rien n'est écrit dans la base Ocall Suite/Park.
- **API** (`apps/api/src/modules/school/school-sites*.ts`, `school-site-*.ts`) : administration
  `school/sites/*`, lecture publique `public/school-sites/*` et `public/school-media/:key`.
- **Réutilisé de Park, sans modification de son comportement** : stockage des fichiers
  (`StorageProvider`, local ou S3/R2), lecture du type réel des images (`inspectImage`), règles
  d'adresse et noms réservés, contrôle de contraste, route de régénération du cache (étendue avec des
  étiquettes `school-site:<slug>` distinctes de celles des sites Park), limitation de débit des routes
  publiques.
- **Web** : pages publiques `app/s/[slug]/[[...path]]`, administration `app/school/site`. Le middleware
  envoie les hôtes `*.<SCHOOL_SITES_BASE_DOMAIN>` vers `/s/<slug>/…` uniquement ; les routes privées,
  l'API privée et les sites Park y sont introuvables.
- **Domaines personnalisés (Sprint 13)** : l'interface `SchoolSiteHostResolver` (sous-domaines au
  Sprint 10) accueillera un second résolveur sans modifier les appelants. Aucune gestion de domaine
  personnalisé n'est livrée au Sprint 10.

## 3. Pages publiques, langues, SEO

- Pages : `/` (accueil), `/a-propos`, `/enseignement`, `/galerie`, `/actualites`,
  `/actualites/<article>`, `/infos`, `/contact` ; les mêmes sous `/ar` en arabe. Tout autre chemin est
  introuvable.
- **Contenus distincts par langue.** Règle de repli explicite : un texte non traduit s'affiche dans
  l'autre langue, avec sa propre langue et son sens d'écriture (`lang`, `dir`), et une mention visible
  « Texte disponible en … uniquement ». Aucune traduction automatique.
- Arabe : mise en page de droite à gauche, police Noto Naskh Arabic servie par l'application.
- SEO : titre et description par page, adresse canonique, versions linguistiques (`hreflang`), plan du
  site propre à chaque hôte (`/sitemap.xml`), sites dépubliés ou indisponibles en `noindex`.
- Accessibilité : lien d'évitement, navigation au clavier, menu mobile sans script, textes
  alternatifs, contraste de la couleur principale imposé (4,5:1).
- Aucune inscription, aucun paiement, aucun portail parent public.

## 4. Photos et vie privée des mineurs

1. **Réencodage systématique** (Sharp) en WebP, en deux tailles (1600 et 480 px). Le fichier publié ne
   contient **aucune métadonnée** de l'original : EXIF, position GPS, appareil, XMP, IPTC. L'original
   n'est jamais conservé. Types acceptés d'après le contenu réel : JPEG, PNG, WebP (SVG et GIF
   refusés), 5 Mo et 64 à 6000 px au plus.
2. **Photo où figurent des mineurs** : l'envoi exige la référence de l'autorisation parentale détenue
   par l'établissement. L'attestation (référence, auteur, date) est enregistrée et journalisée.
   **Elle ne constitue pas une preuve à elle seule** : elle enregistre une déclaration et ne remplace
   pas les autorisations écrites que l'établissement doit détenir et produire sur demande. Ocall ne
   vérifie pas ces autorisations.
3. **Retrait immédiat** (bouton « Retirer », permis même avec un contrat en lecture seule) : l'image est
   retirée du brouillon, de la version publiée (sans republication) et des actualités, ses fichiers
   sont supprimés du stockage, les pages publiques sont régénérées. La ligne est conservée sans fichier
   (qui, quand, motif).
4. **Purge des caches** : l'API répond 404 dès le retrait ; les pages Next.js sont régénérées
   (étiquette `school-site:<slug>`). Les images ne passent pas par l'optimiseur d'images de Next.js
   (pas de copie en cache qui survivrait au retrait). Le seul cache restant est celui du navigateur ou
   d'un CDN, limité à **5 minutes** (`Cache-Control: public, max-age=300`).
5. Aucune donnée scolaire n'entre dans un site : le contenu est saisi pour le site, rien n'est repris
   automatiquement de l'établissement (ni coordonnées, ni élèves, notes, présences, finances).

## 5. Contrat et disponibilité

| Situation du contrat Ocall School | Site publié                                                                            | Publication |
| --------------------------------- | -------------------------------------------------------------------------------------- | ----------- |
| Actif                             | En ligne                                                                               | Permise     |
| Suspendu ou expiré                | Maintenu en lecture seule `SCHOOL_SITES_GRACE_DAYS` jours (défaut 30), puis hors ligne | Refusée     |
| Résilié                           | Hors ligne immédiatement ; export des contenus toujours disponible                     | Refusée     |
| Aucun contrat                     | Hors ligne                                                                             | Refusée     |

Pendant le maintien, une mention « site maintenu temporairement en consultation » apparaît sur le
site. Les actions protectrices restent possibles : retrait d'une photo, dépublication, désactivation,
retrait d'une actualité ou d'un lien. L'export (`GET /school/sites/:id/export`, format
`ocall-school-site/1`) contient réglages, brouillon, version publiée, actualités, liens et la liste des
médias.

## 6. Réseaux sociaux et liens externes

- Facebook, Instagram, TikTok, YouTube, WhatsApp, LinkedIn et autres liens (libellé obligatoire),
  activables, modifiables, supprimables, dans un ordre choisi.
- Adresses **https** uniquement, sur le domaine du réseau (ex. `instagram.com`) ; ni identifiants, ni
  port, ni adresse IP, ni nom local. Vérifiées à l'enregistrement **et** à chaque lecture publique.
- WhatsApp : numéro international explicite (`+221 …` ou `00221 …`) ou lien `wa.me` /
  `api.whatsapp.com`, publié en `https://wa.me/<numéro>`. Un numéro local est refusé (le pays serait
  deviné). Le bouton WhatsApp du site utilise le premier lien WhatsApp actif.
- Liens ouverts dans un nouvel onglet avec `rel="noopener noreferrer"`. Pictogrammes dessinés en
  ligne : aucun script ni traceur tiers.

## 7. Mise en service réelle de `*.ocall.school` (à faire, non vérifiée)

Prérequis constatés pour les sites Park (voir `SITES-VITRINES.md` § 4.2, documentation Railway
consultée le 30/10/2026) ; ils sont à **revérifier** au moment de la mise en service :

1. Acheter `ocall.school` (registre `.school`) et confier son DNS à **Cloudflare** (domaine générique
   et aplatissement de CNAME pris en charge).
2. Cloudflare DNS : `*` en CNAME vers la cible du service `web` indiquée par Railway, plus le CNAME
   `_acme-challenge` et le TXT demandés par Railway. Pas de proxy Cloudflare sur
   `authorize.railwaydns.net`.
3. Railway → service `web` → Custom Domain → `*.ocall.school`, puis attendre le certificat Let's
   Encrypt (souvent moins d'une heure ; propagation DNS jusqu'à 72 h).
4. Variables, sur l'API **et** le web : `SCHOOL_SITES_BASE_DOMAIN=ocall.school`,
   `SCHOOL_SITES_SUBDOMAINS_ENABLED=true`. API : `SCHOOL_SITES_PUBLIC_ORIGIN` (origine de l'application,
   pour les adresses provisoires). Web : ajouter `app.ocall.school` à `APP_HOSTS` s'il sert
   l'application. `SITES_REVALIDATE_SECRET` identique dans les deux services.
5. Redéployer, puis vérifier réellement : résolution DNS d'un sous-domaine, certificat valide
   (`https://<slug>.ocall.school`), page publiée, sous-domaine inconnu en 404, `/school` et
   `/api/v1/school/*` en 404 sur un hôte de site, `sitemap.xml` de l'hôte.

**Limite connue** : un seul domaine générique suffit pour tous les sous-domaines. Les domaines
personnalisés (Sprint 13) sont soumis au plafond de Railway (20 par service en Pro, partagé avec les
sites Park) ; au-delà, Cloudflare for SaaS sera nécessaire.

## 8. Stockage des médias en production

Le stockage est celui de la plateforme (`MEDIA_STORAGE`) :

- **Production : S3 compatible, recommandé Cloudflare R2** (bucket privé ; aucun accès public requis,
  les images passent par l'API qui vérifie leur publication) :

  ```
  MEDIA_STORAGE=s3
  S3_ENDPOINT=https://<ID_COMPTE>.r2.cloudflarestorage.com
  S3_REGION=auto
  S3_BUCKET=ocall-sites
  S3_ACCESS_KEY_ID=…        (secret Railway scellé, jamais dans le dépôt)
  S3_SECRET_ACCESS_KEY=…    (secret Railway scellé, jamais dans le dépôt)
  ```

  L'API refuse de démarrer si une variable S3 manque.

- `MEDIA_STORAGE=local` en production exige un volume persistant (`MEDIA_STORAGE_DIR`), sinon l'API
  refuse de démarrer. **Aucun bucket R2 n'existe encore** : à créer avant la mise en production.
- Développement et tests : stockage local, aucun service externe requis.

## 9. Variables

| Variable                           | Service  | Défaut       | Rôle                                              |
| ---------------------------------- | -------- | ------------ | ------------------------------------------------- |
| `SCHOOL_SITES_BASE_DOMAIN`         | api, web | —            | Domaine des sous-domaines (`ocall.school`)        |
| `SCHOOL_SITES_SUBDOMAINS_ENABLED`  | api, web | `false`      | `true` seulement après le § 7                     |
| `SCHOOL_SITES_PUBLIC_ORIGIN`       | api      | `WEB_ORIGIN` | Origine des adresses provisoires `/s/<slug>`      |
| `SCHOOL_SITES_GRACE_DAYS`          | api      | `30`         | Maintien d'un site après suspension ou expiration |
| `SITES_REVALIDATE_URL` / `_SECRET` | api, web | —            | Régénération des pages (partagée avec Park)       |
| `MEDIA_STORAGE`, `S3_*`            | api      | `local`      | Stockage des médias (§ 8)                         |
