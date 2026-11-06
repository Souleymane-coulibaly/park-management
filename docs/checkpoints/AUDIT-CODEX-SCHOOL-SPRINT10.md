# Audit Codex — Ocall School, Sprint 10 (sites vitrines publics)

Périmètre : commit Sprint 10 au-dessus du Sprint 9 clos (`f268053`). Documentation fonctionnelle et
technique : `docs/SITES-VITRINES-SCHOOL.md`.

## 1. Changements

- **Base School** : migration additive `20261113000000_sites_vitrines_etablissements` (`SchoolSite`,
  `SchoolSiteMedia`, `SchoolSiteNews`, `SchoolSiteLink`), aucune table existante modifiée.
- **Partagé** : `packages/shared/src/school-site.ts` (chemins publics, repli de langue, validation du
  brouillon, liens externes et WhatsApp, disponibilité selon le contrat), permissions
  `school.site.manage` (direction, secrétariat) et `school.site.publish` (direction), textes FR/AR.
- **API** : `school-sites.service.ts`, `school-site-media.service.ts`, `school-sites.controller.ts`
  (administration + lecture publique), `school-site-image.ts` (Sharp), `school-site-host.ts`
  (`SchoolSiteHostResolver`), configuration `school.config.ts` (`SCHOOL_SITES_*`), exemption
  `@AllowInReadOnly` du garde School (actions protectrices), `SuiteContractsService.contractWindow`.
- **Web** : pages publiques `app/s/[slug]/[[...path]]`, composants `components/school-site/*`,
  administration `app/school/site` ; middleware et `site-hosts.ts` (hôtes `*.<SCHOOL_SITES_BASE_DOMAIN>`),
  plan du site par hôte ; pages publiques School lues sans cache.
- **Tests** : unitaires partagés et API, intégration `school-sprint10`, E2E `school-8-sites` (sous-domaines
  locaux `*.ecoles.localhost`).

## 2. Choix validés par le client

- Base School indépendante ; composants techniques de Park réutilisés sans changer leur comportement.
- Sites multipages FR/AR, sous-domaines gratuits, réseaux sociaux configurables, `SiteHostResolver`
  préparant le Sprint 13 (aucune gestion de domaine personnalisé au Sprint 10).
- Sharp pour réencoder les images et supprimer EXIF/GPS ; attestation de consentement pour les photos de
  mineurs, sans valeur de preuve à elle seule ; retrait et purge du cache.
- Contrat suspendu ou expiré : site publié maintenu en lecture seule pendant une durée configurable ;
  aucune publication sans contrat valide ; résiliation : dépublication et export.
- Middleware et layout partagés modifiés de façon sûre ; non-régression des sites Park ; isolation des
  domaines, caches et routes privées.
- R2/S3 préparé sans service externe obligatoire en local ; DNS/TLS non déclarés opérationnels
  (`ocall.school` NXDOMAIN au 06/11/2026).

## 3. Questions prioritaires pour l'audit

1. Isolation : un autre client, un autre établissement du même client ou un rôle non autorisé peut-il
   lire ou modifier un site, un média, une actualité ou un lien ? La lecture publique peut-elle exposer
   un brouillon, un média non publié ou retiré, un identifiant interne ou une donnée scolaire ?
2. Routage : un hôte de site School peut-il atteindre une route privée, l'API privée, un site Park, ou
   l'inverse ? Le cache d'un site School peut-il se confondre avec celui d'un site Park ?
3. Médias : réencodage effectif, types et tailles, fichiers orphelins, retrait réellement immédiat
   (version publiée, actualités, stockage, cache), plafond sous concurrence.
4. Liens externes : validation https par réseau, WhatsApp, revalidation à la lecture,
   `rel="noopener noreferrer"`.
5. Contrat : calcul du maintien (date de passage en lecture seule), refus de publication, exemptions
   `@AllowInReadOnly` limitées aux actions protectrices, résiliation et export.
6. Non-régression Park : middleware, `isAppHost`, plan du site.

## 4. Passes Codex

Rapports : `C:\Users\couli\ocall-audits\audit-codex-school-10-passe1..11.md`.

| Passe | Commit    | Verdict | Constats principaux                                                                                                                                                                                                                                                                                                                  |
| ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `50f3f10` | NO GO   | P1 actualité publiée modifiable par le secrétariat ; P2 caches publics, périmètre du contrat, synchronisation concurrente des médias, compensation d'envoi, suppression non rejouable, expiration tardive, ordre des contrats, API publiques de l'autre produit, article au-delà des 50 récents.                                  |
| 2     | `d1f4669` | NO GO   | P1 actualité devenue publiée pendant une modification ; P2 interblocage, image retirée réintroduite par une publication, orphelins à l'envoi, casse dans le middleware.                                                                                                                                                            |
| 3     | `fbf230c` | NO GO   | P2 envoi long, plafond contournable, actualité écrasée, brouillon réintroduisant une image retirée.                                                                                                                                                                                                                                 |
| 4     | `819ab70` | NO GO   | P2 clés d'un envoi abandonné effacées trop tôt, lien et réglages écrasés.                                                                                                                                                                                                                                                         |
| 5     | `731e172` | NO GO   | P2 interface renvoyant tous les champs, limite de 24 h insuffisante.                                                                                                                                                                                                                                                              |
| 6     | `8953522` | NO GO   | P2 différences calculées contre les données rechargées, points forts perdus.                                                                                                                                                                                                                                                      |
| 7     | `00905b5` | NO GO   | P2 limite par IP partagée entre visiteurs (lectures sans cache), saisie des points forts.                                                                                                                                                                                                                                          |
| 8     | `d69bae6` | NO GO   | P2 IP de visiteur fournie par l'appelant signée par le web.                                                                                                                                                                                                                                                                       |
| 9     | `bdea304` | NO GO   | P2 adresses « sitemap » et « resolve » en collision avec les routes techniques.                                                                                                                                                                                                                                                   |
| 10    | `eb1c69b` | NO GO   | P2 brouillon complet écrasé depuis un navigateur périmé.                                                                                                                                                                                                                                                                          |
| 11    | `ddf0215` | **GO**  | Aucune anomalie P0 à P2.                                                                                                                                                                                                                                                                                                          |

Vérification finale sur `ddf0215` (PostgreSQL jetable) : intégration complète 27/27 suites, 623/623 ;
E2E 64/64 (deux exécutions, la première interrompue par le plantage natif de Node 24 sous Windows).

### Réserves conservées

- **P3** — reprise après un conflit de brouillon : la sauvegarde est refusée (409) mais le formulaire
  garde sa révision ; une reprise guidée (rechargement avec conservation des saisies) reste à faire.
- **Hors Sprint 10, décision du client** — le garde School (Sprint 1, tous modules) résout les droits
  d'administration sur un seul contrat : avec deux contrats couvrant des établissements différents,
  l'administration d'un établissement couvert peut être refusée. La disponibilité publique des sites, elle,
  est calculée par établissement.
- `WEB_TRUSTED_PROXY_HOPS` (web) et `TRUST_PROXY_HOPS` (API) à vérifier au premier déploiement.
- DNS/TLS de `ocall.school` non configurés (domaine inexistant au 06/11/2026).
