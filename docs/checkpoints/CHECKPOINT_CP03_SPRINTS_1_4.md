# Checkpoint CP-03 — Sprints 1 à 4

## Contexte

- Référentiel validé : `C:\Users\couli\park-management`
- Branche active : `claude/sprint-4`
- Base de développement : conservée, non modifiée
- Base de test : branche Neon `test` uniquement, conformément au projet
- Base de production : non configurée
- Règle de suivi : aucune fusion dans `main`, aucun déploiement, aucun démarrage du Sprint 5

Le présent document est l’audit indépendant de validation des Sprints 1 à 4, préparé à partir des documents de statut et des journaux de validation disponibles dans le dépôt local.

---

## 1) Vérification du périmètre et de la branche

Le dépôt et la branche confirmés sont cohérents avec l’objectif CP-03 :

- `SPRINT_STATUS.md` indique que le Sprint 1 est validé, le Sprint 2 validé, le Sprint 3 validé avec validation matérielle à compléter, et le Sprint 4 en attente de validation CP-03.
- `docs/checkpoints/CP-03-preparation.md` précise que CP-02 n’a pas été réalisé et que CP-03 couvre l’ensemble des Sprints 1 à 4.
- `playwright.config.ts` impose une base de test stricte (`resolveTestDatabase`) et refuse de démarrer sur la base de développement.

Conclusion : la branche `claude/sprint-4` correspond bien au périmètre demandé pour ce checkpoint CP-03.

---

## 2) Vérification fonctionnelle et de validation

### Sprints validés

- Sprint 1 : validé.
- Sprint 2 : validé.
- Sprint 3 : validé au niveau logiciel, mais validation matérielle non terminée.
- Sprint 4 : validé sur le plan de tests automatisés, avec des anomalies ouvertes à clôturer avant mise en service.

### Résultats de validation documentés

`SPRINT_STATUS.md` consolide les résultats suivants sur la branche Neon `test` :

- Unitaires : 88/88 (Sprint 4)
- Intégration API Sprint 4 : 26/26
- Intégration API Sprints 1 à 4 : 102/102
- E2E Playwright Sprints 1 à 4 : 20/20
- Lint, Prettier, TypeScript strict, build : OK
- Contrôle des migrations destructrices : OK

Ces éléments sont compatibles avec une validation de code et de régression on the test branch, mais ne suffisent pas à clore les risques de production décrits ci-dessous.

---

## 3) Points de qualité vérifiés

### 3.1 Sécurité et isolation

Les documents de référence confirment :

- les QR de billet sont sans donnée personnelle, sans prix, sans secret applicatif, et sont générés avec un jeton aléatoire 128 bits (`OCP1-` + token)
- la validation d’accès est calculée côté serveur et ne se fie pas à l’input navigateur
- les billets d’une autre organisation ou d’un autre établissement sont refusés
- les agents ne peuvent se déclarer que sur un établissement affecté
- l’unicité et l’idempotence sont garanties sur les ventes, paiements et scans

`docs/BILLETTERIE-PARC.md` confirme la logique de blocage de double entrée et les règles de refus (`ALREADY_USED`, `EXPIRED`, `CANCELLED`, `UNKNOWN`, `OTHER_ESTABLISHMENT`, `PARK_CLOSED`, `NOT_YET_VALID`).

### 3.2 Politique de test et de base de données

Le dépôt impose explicitement :

- base de test dédiée uniquement (`TEST_DATABASE_URL` / `TEST_DIRECT_URL`)
- refus du lancement si la base test est absente ou identique à la base de développement
- aucune exécution sur la base de développement

C’est cohérent avec le niveau d’autonomie attendu pour l’audit CP-03.

---

## 4) Anomalies ouvertes — synthèse A1 à A6

### A1 — Arrêt des serveurs API et frontend pendant les tests E2E

- Gravité : élevée
- Impact : arrêt réel du service test, puis faux échecs en cascade (`ERR_CONNECTION_REFUSED`)
- Preuves : deux occurrences documentées dans `test-logs/`, dont un incident sur le Sprint 4, suivies d’une relance isolée réussie
- Conclusion : non fermée tant que la cause n’est pas identifiée

### A2 — Transaction bloquée 732 secondes

- Gravité : élevée
- Impact : blocage potentiel de verrou ou transaction non libérée
- Preuves : journal historique `integration-2026-10-29T20-33-12-703Z.log` avec timeout 5000 ms dépassé à 732101 ms
- Conclusion : non clôturée ; le non-repro dans des exécutions ultérieures ne remplace pas une cause démontrée

### A3 — Délai des transactions interactives porté de 5 s à 15 s

- Gravité : moyenne
- Impact : corrige des erreurs réelles de latence Neon, mais peut prolonger la fenêtre de verrouillage
- Preuves : `apps/api/src/prisma/prisma.service.ts` avec `maxWait: 10_000, timeout: 15_000`
- Conclusion : correctif partiel, pas une résolution de A2

### A4 — Latence Neon `us-east-2` et absence de région production validée

- Gravité : moyenne
- Impact : parcours lents, composants de caisse / billets plus sensibles à la latence
- Preuves : latence mesurée ~300 ms par aller-retour, temps de ticket/print dans l’environnement de test
- Conclusion : non résolue tant que la région cible de production n’est pas choisie et validée

### A5 — Validation matérielle manquante

- Gravité : élevée pour un déploiement sur site
- Impact : QR imprimé, scan caméra, connecteur Android et tiroir-caisse non validés en conditions réelles
- Preuves : tests automatiques utilisent une imprimante simulée ; le connecteur Android n’a pas été compilé dans l’environnement
- Conclusion : non validé sur matériel réel, donc non prêt à mise en service sur site

### A6 — Remboursement d’un billet annulé

- Gravité : basse
- Impact : fonctionnalité hors périmètre du Sprint 4, non couverte par le sprint en cours
- Conclusion : connue et explicitement hors périmètre ; non bloquante pour ce checkpoint

---

## 5) Verdict des recommandations CP-03

### Recommandation finale

GO SOUS RÉSERVES.

Cette recommandation est justifiée par les éléments suivants :

- le socle technique est globalement validé sur les Sprints 1 à 4 ;
- les suites de tests automatisés documentées sont vertes ;
- les règles métier clés sont couvertes par les tests d’intégration et la documentation ;
- mais les anomalies A1, A2 et A5 restent ouvertes et ne peuvent être déclarées closes sans preuve de cause et de correctif vérifié.

### État de décision

- Autorisation éventuelle de commencer le Sprint 5 : NON
- Aptitude à déployer un pilote : NON
- Aptitude à mettre en production : NON

### Règles de sécurité opérationnelle

- Ne pas fusionner dans `main`
- Ne pas déployer
- Ne pas démarrer le Sprint 5
- Maintenir la branche `claude/sprint-4` en état d’audit uniquement

---

## 6) Conclusion du checkpoint

Le projet est en état de validation fonctionnelle sur les Sprints 1 à 4, mais pas en état de mise en service. Les tests automatiques sont globalement convaincants, et la base du produit est solide, mais les points critiques A1, A2 et A5 nécessitent une clôture technique avant toute décision de mise en service ou d’extension du périmètre.

Le bon niveau de décision pour ce checkpoint est donc :

- validation de code et de régression : oui
- validation de déploiement : non
- validation de production : non
- progression vers le Sprint 5 : non
