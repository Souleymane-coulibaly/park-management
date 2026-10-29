# Checkpoint CP-02 — préparation (Sprints 1, 2 et 3)

Document préparé pour l'audit Codex CP-02. Il liste le périmètre, les commandes de vérification et
les points d'attention. Il ne constitue pas l'audit lui-même.

## Référentiel

- Dépôt local : `C:\Users\couli\park-management` — branche `claude/sprint-3` (contient les Sprints 1 et 2).
- Base de développement : Neon existante (`DATABASE_URL`), **à ne jamais utiliser pour les tests**.
- Base de test : branche Neon `test` (`TEST_DATABASE_URL`) ; les suites refusent toute autre base.
- Aucune base de production configurée ; aucun déploiement ; aucune fusion dans `main`.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check            # aucune migration destructrice
pnpm test                        # unitaires (attendu : 72/72)
pnpm db:migrate:deploy:test      # migrations en attente sur la branche test
pnpm test:integration            # attendu : 76/76 — journal complet dans test-logs/
pnpm build; pnpm test:e2e        # attendu : 19/19 — journal complet dans test-logs/
```

## Points à vérifier par sprint

### Sprint 1 — socle SaaS

- Isolation multi-tenant : `organizationId` issu de la session uniquement, ressource étrangère → 404.
- Sessions opaques hashées, révocation (déconnexion, désactivation, suspension, changement de mot de passe).
- RBAC (`packages/shared/src/rbac.ts`) appliqué par `PermissionsGuard` ; protection du dernier OWNER.
- Aucun lien ni jeton de réinitialisation dans les journaux hors `NODE_ENV=development`.

### Sprint 2 — caisse POS

- Montants calculés uniquement par le serveur (`SalePricingService`), prix client refusé.
- Paiement et préparation indépendants : `preparationStatus` jamais modifié par l'encaissement.
- Idempotence vente / paiement, verrous de ligne (double encaissement concurrent → un seul paiement).
- Sessions de caisse : espèces attendues recalculées, écart historisé.
- Wave : `PaymentMethodsService` le déclare indisponible ; aucun paiement simulé.

### Sprint 3 — matériel

- `PrintJob` : ticket uniquement après paiement, pas de double original, réimpression motivée et
  autorisée, échec d'impression sans effet sur la vente.
- `DrawerEvent` : ouverture automatique seulement pour un paiement `CASH` confirmé, unicité par
  paiement (`paymentId @unique`), refus Wave, manuelle justifiée avec délai minimal.
- Pont Android : origine unique (`addWebMessageListener`), 4 commandes, validation miroir
  (`bridge-protocol.ts` / `CommandValidator.kt`), flux d'impression sans `ESC p`.
- Imprimante réseau limitée aux IPv4 privées et aux ports 9100–9109 (anti-SSRF via le pont).

## Points d'attention connus

| Sujet                                                        | État                                                  | Référence                                            |
| ------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------- |
| Connecteur Android non compilé, aucun test sur matériel réel | Ouvert — validation matérielle requise                | `docs/MATERIEL-POS.md` §7                            |
| Transaction Prisma bloquée 732 s (Sprint 2, 1 occurrence)    | Non reproduit depuis (Sprints 2 et 3)                 | `test-logs/integration-2026-10-29T20-33-12-703Z.log` |
| Arrêt des serveurs E2E (Sprint 3, 1 occurrence)              | Non reproduit à la relance                            | `test-logs/e2e-s3-2026-10-29T23-05-46-468Z.log`      |
| Latence Neon `us-east-2` (~300 ms par requête)               | Accepté en test ; région à choisir pour la production | `docs/DEPLOIEMENT-RAILWAY.md` §8                     |
| Limite du pont : pas de vérification métier native           | Assumé et documenté                                   | `docs/MATERIEL-POS.md` §4                            |

Les journaux `test-logs/` ne sont pas versionnés : ils sont disponibles sur le poste de développement.

## Critères proposés pour un GO

- Toutes les commandes de vérification au vert.
- Aucune anomalie critique de sécurité (isolation, RBAC, secrets, pont matériel).
- Validation matérielle du Sprint 3 planifiée ou réalisée avant toute mise en service en magasin.
