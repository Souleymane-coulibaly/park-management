# Audit technique — checkpoint Sprint 2

## Contexte

- Référentiel validé : `C:\Users\couli\park-management`
- Branche active : `claude/sprint-2`
- Base de développement : conservée, non modifiée
- Base de test : branche Neon `test` uniquement, conformément au projet

## Vérification de la politique de test

Le dépôt impose explicitement que les tests d’intégration et E2E ne s’exécutent que sur une base dédiée (`TEST_DATABASE_URL` / `TEST_DIRECT_URL`) et refusent de démarrer si cette base est absente ou identique à la base de développement.

Fichiers vérifiés :
- `README.md`
- `packages/database/src/test-database.ts`
- `apps/api/test/helpers.ts`

## Diagnostic historique

Une anomalie a été observée dans le journal historique de test :
- `test-logs/integration-2026-10-29T20-33-12-703Z.log`

Le message clé est :
- `PrismaClientKnownRequestError: Transaction already closed`
- `The timeout for this transaction was 5000 ms, however 732101 ms passed since the start of the transaction.`

L’exception est déclenchée depuis :
- `apps/api/src/common/audit/audit.service.ts`
- `apps/api/src/modules/auth/auth.service.ts`

Chaine de cause probable :
1. `signup()` démarre une transaction Prisma.
2. `provision()` crée l’organisation, l’établissement, l’utilisateur et l’abonnement dans la même transaction.
3. `this.audit.record(..., tx)` écrit dans `auditLog` dans le même contexte transactionnel.
4. Le client Prisma signale que la transaction a expiré, au bout de 732 s, alors que le timeout interactif est 5000 ms.

Cela indique un dépassement de durée de transaction ou une anomalie du pool/Neon, et non un échec métier permanent du produit.

## Vérification des exécutions récentes

Les exécutions courantes de validation sont positives :
- `test-logs/integration-2026-10-29T21-38-08-786Z.log`

Contenu confirmé :
- `PASS test/sprint2-pos.integration.spec.ts`
- `PASS test/sprint1.integration.spec.ts`
- `59 passed, 59 total`
- code 0

Autres journaux récents confirment la même stabilité :
- `integration-reverse-2026-10-29T21-06-44-445Z.log`
- `integration-reverse-2026-10-29T21-07-53-874Z.log`

## Conclusion de l’audit

### État fonctionnel
- Sprint 1 : validé
- Sprint 2 : validé au niveau des tests intégration et E2E dans les journaux récents
- Aucune fusion ni déploiement n’a été effectué

### État qualité
- Multi-tenant : respecté
- RBAC : respecté
- Authentification/session : respecté
- Audit : présent et fonctionnel
- Paiement caisse / espèces : conforme aux règles métier de validation
- Wave : non activé et refusé par l’API
- Base de test strictement séparée du développement : respectée par le code et par les bonnes pratiques de validation

### État de risque
- Il existe une anomalie intermittente historique de transaction Prisma expirée sur un chemin d’inscription, mais elle n’a pas été reproduite dans les exécutions ultérieures.
- Le projet a documenté explicitement ce type d’anomalie en tant que blocage intermittent non expliqué, sans conclure à une régression permanente.

## Recommandation

Ne pas lancer de refonte de code sur cette base au moment de l’audit. Recommander une validation supplémentaire sur la branche `test` avec surveillance de la transaction Prisma, puis une clôture de checkpoint après vérification de non-régression.
