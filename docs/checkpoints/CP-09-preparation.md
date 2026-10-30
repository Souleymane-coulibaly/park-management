# Checkpoint CP-09 — préparation (Sprints 1 à 10)

Ce document prépare l'audit indépendant Codex CP-09. Il ne constitue pas l'audit lui-même.

## Contexte de décision

- Dernier audit réalisé : **CP-03** (Sprints 1 à 4), GO SOUS RÉSERVES (A1, A2, A5 ouvertes).
- CP-04 à CP-08 **n'ont pas été réalisés**. Préparations : [CP-04](CP-04-preparation.md),
  [CP-05](CP-05-preparation.md), [CP-07](CP-07-preparation.md), [CP-08](CP-08-preparation.md).
- **Le Sprint 9 n'est pas validé** (pas de CP-08). Sur décision du commanditaire (30/10/2026), il a
  été commité localement (`69f4b96`, non poussé), et le Sprint 10 est parti de ce commit, sur
  `claude/sprint-10`.
- Décisions du commanditaire pour le Sprint 10 :
  - stockage compatible S3, **Cloudflare R2** ;
  - domaines personnalisés par **procédure administrative** avec abstraction (plafond Railway) ;
  - frais de mise en service et nouveaux tarifs (Restaurant et Parc : 250 000 + 15 000 FCFA par
    mois ; Parc + Restaurant : 350 000 + 25 000 FCFA par mois).
- **CP-09 doit couvrir les Sprints 1 à 6 et 8 à 10.**

## Référentiel

- Branche `claude/sprint-10`, créée depuis `69f4b96`. Le Sprint 10 n'est **ni commité ni poussé** à
  la date de ce document.
- **Migrations non appliquées**, ni sur `test` ni en développement : `20261030152753`,
  `20261030164331`, `20261030190000`, `20261030210000` et `20261030230000_sites_vitrines`. Cette
  dernière modifie les lignes des **3 offres** (nouveaux tarifs) ; c'est la seule modification de
  données existantes.
- Nouvelle dépendance : `@aws-sdk/client-s3` 3.700.0 (version figée), pour R2 ou tout stockage S3.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check
pnpm test
pnpm db:migrate:deploy:test
pnpm test:integration            # Sprints 1 à 10 — IA et domaines simulés
pnpm build; pnpm test:e2e
```

## Points à vérifier — Sprint 10

1. **Séparation brouillon / publié** (`public-sites/sites.service.ts`) :
   - le public ne lit que `published` ;
   - la publication fige noms et prix des seuls produits et tarifs sélectionnés ;
   - aucune donnée interne (coûts, stocks, identifiants, personnel).
2. **API publique** (`sites.controllers.ts`, `PublicSitesController`) :
   - lecture seule, limitée en débit ;
   - images servies seulement si publiées (`isPublished`) et site en ligne ;
   - en-têtes `nosniff` et CSP sur les images.
3. **Multi-tenant et RBAC** :
   - organisation et établissements de la session dans chaque requête ;
   - `site.manage` et `site.publish` (OWNER, ADMIN), `site.domain` (OWNER) ;
   - Super Admin pour l'activation des domaines.
4. **Médias** : type et dimensions lus dans le contenu (`inspectImage`), SVG et GIF refusés, 5 Mo,
   clés aléatoires validées (pas de traversée de chemin), plafond par site.
5. **Contenu** : validation stricte à clés exactes (`validateSiteContent`), texte brut uniquement,
   liens `https:`, JSON-LD échappé.
6. **Slugs et routage** :
   - noms réservés, unicité ;
   - middleware hôte → site (sous-domaine si activé, domaine **ACTIF** uniquement) ;
   - espaces privés introuvables sur un hôte de site ;
   - redirection 301 vers l'adresse canonique.
7. **Domaines** :
   - TXT de propriété ;
   - jamais ACTIVE sans preuve ; preuve revérifiée à l'activation ;
   - contrôle HTTPS réel (`.well-known/ocall-site`, sans suivre de redirection) ;
   - unicité, journalisation.
8. **SEO** : `canonical`, Open Graph, JSON-LD, `sitemap.xml` et `robots.txt` selon l'hôte,
   brouillons et sites suspendus non indexés.
9. **Abonnement** : suspension, expiration ou résiliation → site hors ligne, contenu conservé.
10. **Vérificateur simulé** interdit en production ; **stockage local** interdit en production sans
    volume.

## Résultats à la date de préparation

| Contrôle                                                                                                                                         | Résultat                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Unitaires                                                                                                                                        | shared 127/127, API 62/62, database 13/13   |
| Typecheck, lint, Prettier, build, `migrate:check`                                                                                                | OK                                          |
| Vérification hors ligne des sites : vrai client Prisma, PostgreSQL embarqué jetable (toutes les migrations), script hors dépôt, aucune base Neon | **50/50 conforme**                          |
| `sprint10-sites.integration.spec.ts`, `e2e/sprint10-sites.spec.ts`                                                                               | **écrits, non exécutés** (Neon `test`, A11) |
| Vérifications réelles DNS / HTTPS / domaines (docs/SITES-VITRINES.md § 7)                                                                        | **non réalisées** : aucun domaine acquis    |
| Régression des Sprints 1 à 9                                                                                                                     | **non exécutée** (A11)                      |

## Anomalies et limites

### Reportées

A1 à A29 : voir CP-04, CP-05, CP-07 et CP-08. A11 (base `test` inaccessible) bloque toujours **tous**
les tests sur base.

### Nouvelles au Sprint 10

| Anomalie                                                       | Gravité                    | Impact et suite                                                         |
| -------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| A30 — sous-domaines et domaines jamais testés réellement       | **Haute (avant annonce)**  | Domaine non acquis ; protocole du § 7 à exécuter                        |
| A31 — plafond Railway (20 domaines par service)                | Haute (croissance)         | Au-delà : Cloudflare for SaaS ou proxy dédié, à décider et budgéter     |
| A32 — bucket R2 non créé                                       | Moyenne (avant production) | Stockage local seulement en développement                               |
| A33 — images non recompressées, métadonnées EXIF conservées    | Moyenne                    | Taille limitée à 5 Mo ; retirer l'EXIF (position GPS) à prévoir         |
| A34 — page publique rendue à chaque visite (lecture de l'hôte) | Basse                      | Données en cache, pas d'appel à l'API par visite ; à mesurer en charge  |
| A35 — tarifs modifiés par la migration                         | Basse (décision)           | Seule modification de données existantes ; à vérifier après application |
| A36 — éditeur non vérifié en navigateur                        | Moyenne                    | E2E non exécuté                                                         |

## Critères proposés pour un GO

- Tests d'intégration et E2E des Sprints 1 à 10 exécutés sur Neon `test`, journaux conservés.
- Aucune fuite de brouillon, de donnée interne ni de site d'une autre organisation.
- Protocole réel du § 7 de SITES-VITRINES.md exécuté avant toute annonce des sous-domaines et des
  domaines personnalisés.
