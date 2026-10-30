# Sites vitrines publics (Sprint 10) — architecture, DNS et hébergement

Chaque établissement peut publier un site vitrine : présentation, photos, horaires, coordonnées,
services, menu (restaurant) et tarifs d'entrée (parc), tous **indicatifs**. Le site ne propose **ni
vente, ni réservation, ni commande, ni paiement, ni livraison**. Ce n'est pas une marketplace.

Guide utilisateur : [GUIDE-SITE-VITRINE.md](GUIDE-SITE-VITRINE.md).

## 1. Ce qui est livré, et ce qui reste à valider

| Élément                                                          | État                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Éditeur `/app/site-web`, brouillon / publication, aperçu, thèmes | Développé ; vérifié hors ligne (vrai client Prisma, PostgreSQL embarqué) ; tests sur Neon `test` écrits, **non exécutés** |
| Pages publiques `/e/<slug>`, SEO, plan du site, robots           | Développé ; build OK ; **jamais servi en production**                                                                     |
| Sous-domaines `<slug>.<domaine>`                                 | Code prêt ; **inactif** tant que le domaine, le DNS wildcard et le certificat ne sont pas configurés et testés            |
| Domaines personnalisés                                           | Parcours complet ; vérifications **simulées** en test ; **aucun domaine réel testé**                                      |
| Stockage des médias                                              | Local (développement) ; **Cloudflare R2** prévu (compatible S3) ; **aucun bucket créé**                                   |

> ⚠️ Rien ici ne permet d'affirmer que les sous-domaines ou les domaines personnalisés fonctionnent
> en production. Ils doivent être testés réellement (§ 7) avant toute annonce aux clients.

## 2. Architecture

```
Visiteur ──HTTPS──▶ Railway « web » (Next.js)
                     ├─ middleware : hôte → site (sous-domaine Ocall, domaine personnalisé ACTIF)
                     ├─ /e/<slug> : page mise en cache (5 min), régénérée à la publication
                     ├─ /sitemap.xml, /robots.txt, /.well-known/ocall-site (selon l'hôte)
                     └─ /api/v1/public/* ──réseau privé──▶ Railway « api » (NestJS)
                                                            ├─ PublicSite.published (copie figée)
                                                            └─ médias publiés ──▶ Cloudflare R2
```

- **Brouillon et publié sont séparés** (`PublicSite.draft` / `PublicSite.published`). Le public ne
  lit **que** la copie publiée, figée à la publication. Elle contient les textes, les images
  publiées, et les produits et tarifs **explicitement** sélectionnés, avec leurs noms et prix du
  moment. Aucun coût, stock, vente, identifiant interne ni donnée du personnel n'y figure.
- **Performance.** Une page publique = une lecture par clé unique (`slug`), servie depuis le cache
  du frontend. La caisse, la cuisine et le contrôle d'accès ne sont pas sollicités.
- **Images.**
  - Elles ne sont servies publiquement que si elles figurent dans la version en ligne.
  - Leur type est imposé par le serveur ; elles sont envoyées avec `nosniff` et
    `Content-Security-Policy: default-src 'none'; sandbox`, et un cache d'un jour.
- **Textes** en texte brut : React échappe tout, aucun HTML n'est interprété. Le JSON-LD est
  sérialisé avec `<` neutralisé.
- **Composants réutilisables par une future Ocall Suite** : stockage des médias (`media-storage.ts`),
  vérification de domaines (`domain-verifier.ts`), adresse canonique et validation des domaines
  (`packages/shared/src/sites.ts`).

## 3. Adresses et contenu dupliqué

Il y a une seule adresse canonique par site :

1. le domaine personnalisé **ACTIF** ;
2. sinon le sous-domaine `<slug>.<SITES_BASE_DOMAIN>`, si `SITES_SUBDOMAINS_ENABLED=true` ;
3. sinon `<SITES_PUBLIC_ORIGIN>/e/<slug>`.

Toute autre adresse redirige en **301** vers l'adresse canonique. La balise `canonical` et Open Graph
utilisent cette même adresse. Le plan du site d'un hôte ne liste que les sites dont l'adresse
canonique est sur cet hôte.

Ne sont jamais indexés :

- les brouillons, absents du public et renvoyant 404 ;
- les sites dépubliés (404) ;
- les sites suspendus (page « momentanément indisponible », `noindex`) ;
- l'aperçu, dans l'espace authentifié.

**Slugs** : 3 à 40 caractères `[a-z0-9-]`, uniques en base. Une liste de noms réservés s'y ajoute
(`www`, `api`, `admin`, `app`, `mail`, `ocallpark`…).

## 4. Prérequis d'hébergement

### 4.1 Domaine Ocall

Au 30/10/2026, `ocallpark.com` **n'existe pas dans le DNS** (NXDOMAIN). Il est probablement libre ;
c'est à confirmer chez un registraire avant tout achat. Rien n'est acquis.

- Acheter le domaine et confier son DNS à **Cloudflare** : il prend en charge le domaine générique
  (`*`) et l'aplatissement de CNAME à la racine, ce que GoDaddy et Route 53 ne font pas d'après
  Railway.
- Suggestion d'organisation :

| Hôte                   | Rôle                     |
| ---------------------- | ------------------------ |
| `app.ocallpark.com`    | application              |
| `ocallpark.com`, `www` | pages commerciales       |
| `*.ocallpark.com`      | sites des établissements |

### 4.2 Railway : constats vérifiés (documentation Railway, 30/10/2026)

- Domaines personnalisés par service : **1** en essai, **2** en Hobby, **20** en Pro (relevable sur
  demande, mais d'après le forum Railway, pas pour un usage multi-clients). L'API publique
  (`customDomainCreate`) est soumise au même plafond.
- **Domaine générique pris en charge** (`*.ocallpark.com`) : un CNAME pour `*`, un CNAME pour
  `_acme-challenge` (certificat) et un TXT de vérification. Le CNAME `authorize.railwaydns.net` ne
  doit pas passer par le proxy Cloudflare.
- Certificats Let's Encrypt automatiques, en général en moins d'une heure ; la propagation DNS peut
  prendre jusqu'à 72 h.
- **Conséquence** : un seul domaine générique suffit pour tous les sous-domaines. En revanche,
  Railway ne peut pas porter **des centaines de domaines personnalisés**. Au-delà d'une vingtaine,
  il faudra Cloudflare for SaaS (Custom Hostnames, certificats automatiques) ou un proxy dédié.
  C'est un choix à faire et à budgéter le moment venu ; ce n'est ni intégré ni testé.

### 4.3 Stockage des médias : Cloudflare R2

1. Cloudflare → R2 → créer un bucket privé (ex. `ocall-sites`).
2. Créer un jeton d'API R2 limité à ce bucket (lecture et écriture d'objets).
3. Variables de l'API (scellées sur Railway) :

   ```
   MEDIA_STORAGE=s3
   S3_ENDPOINT=https://<ID_COMPTE>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=ocall-sites
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   ```

Le bucket n'a pas besoin d'être public : les images passent par l'API, qui vérifie qu'elles sont
publiées. Une diffusion directe par le CDN de R2 est une optimisation possible plus tard.

### 4.4 Variables

Les variables `SITES_*`, `MEDIA_STORAGE*` et `S3_*` (API) et `APP_HOSTS` (web) sont décrites dans
`apps/api/.env.example` et `apps/web/.env.example`. `SITES_REVALIDATE_SECRET` doit être identique
dans les deux services.

## 5. Mise en service des sous-domaines (une fois)

1. Cloudflare DNS : `*` en CNAME vers la cible du service `web` indiquée par Railway, plus
   `_acme-challenge` et le TXT demandés par Railway. Pas de proxy sur `authorize.railwaydns.net`.
2. Railway → service `web` → Custom Domain → `*.ocallpark.com`, puis attendre le certificat.
3. Variables : `SITES_BASE_DOMAIN=ocallpark.com` (api et web), `SITES_SUBDOMAINS_ENABLED=true`
   (api et web), `APP_HOSTS=app.ocallpark.com,ocallpark.com,www.ocallpark.com` (web).
4. Redéployer, puis exécuter le protocole réel du § 7.

## 6. Domaines personnalisés : procédure administrative

| Étape | Qui                    | Action                                                                                                     | Statut          |
| ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| 1     | Propriétaire du client | Saisit `www.monrestaurant.ml` dans « Nom de domaine »                                                      | PENDING         |
| 2     | Propriétaire du client | Crée le TXT `_ocallpark-verify.<domaine>` = `ocallpark-site-verification=<jeton>` et le CNAME indiqué      | PENDING         |
| 3     | Propriétaire du client | « Vérifier la propriété » : lecture du TXT via les DNS publics (1.1.1.1, 8.8.8.8)                          | VERIFIED        |
| 4     | Ocall                  | Ajoute le domaine au service `web` dans Railway (20 au plus) et attend le certificat                       | VERIFIED        |
| 5     | Super Admin            | « Activer » (`/admin/domaines`) : nouvelle lecture du TXT, puis contrôle HTTPS réel de la page de contrôle | ACTIVE ou ERROR |

Garanties :

- **jamais ACTIVE sans preuve de propriété** ;
- un domaine n'appartient qu'à un seul site (unicité en base) ;
- les domaines Ocall et les adresses IP sont refusés ;
- une preuve retirée fait échouer toute réactivation ;
- chaque étape est journalisée ;
- le Super Admin peut mettre un domaine hors service.

## 7. Vérifications réelles (à exécuter avant toute annonce)

Les tests automatisés utilisent un vérificateur **simulé** (`SITES_DOMAIN_VERIFIER=simulated`) : ils
ne prouvent rien sur la production. Pour chaque environnement :

1. `curl -I https://<slug>.ocallpark.com` : réponse 200 en HTTPS, certificat valide
   (`openssl s_client -connect <hôte>:443 -servername <hôte>`).
2. `curl https://<slug>.ocallpark.com/.well-known/ocall-site` : renvoie l'identifiant du site.
3. `curl -I https://app.ocallpark.com/e/<slug>` : redirection 301 vers l'adresse canonique.
4. Un hôte `inconnu.ocallpark.com` renvoie 404 ; `/app` et `/admin` sur un hôte de site renvoient 404.
5. Domaine personnalisé de test (domaine Ocall de test) : parcours du § 6 jusqu'à ACTIVE, puis
   points 1 à 3 sur ce domaine.
6. `https://<hôte>/sitemap.xml` et `robots.txt` corrects pour chaque hôte.
7. Consigner les résultats (dates, commandes, sorties) dans le rapport de checkpoint.

## 8. Abonnement et suspension

- Organisation suspendue, abonnement expiré ou résilié : le site est **hors ligne**. Il affiche
  « momentanément indisponible », non indexé, et sort du plan du site.
- Le contenu (brouillon, version publiée, images, domaine) est **conservé** et revient à la
  réactivation.
- Paiements SaaS entièrement manuels (registre du Sprint 9B). Tarifs : Restaurant ou Parc
  250 000 FCFA de mise en service + 15 000 FCFA par mois ; Parc + Restaurant 350 000 + 25 000 FCFA
  par mois.

## 9. Limites connues

- Les images ne sont ni redimensionnées ni recompressées (pas de bibliothèque d'image). Elles sont
  limitées à 5 Mo et 6 000 px. Les métadonnées EXIF (dont la position GPS éventuelle) sont
  conservées ; les retirer est une amélioration à prévoir.
- La page `/e/<slug>` lit l'hôte de la requête (redirection canonique). Elle est donc rendue à
  chaque visite, mais à partir de données mises en cache (pas d'appel à l'API à chaque visite).
- Domaines personnalisés : plafond de Railway (§ 4.2) ; un seul domaine par site.
- Pas d'éditeur visuel : trois thèmes, une couleur, l'ordre et le masquage des sections.
