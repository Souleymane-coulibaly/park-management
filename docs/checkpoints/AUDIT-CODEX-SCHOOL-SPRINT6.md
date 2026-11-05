# Ocall School, Sprint 6 : instructions pour l'audit indépendant Codex

Audit en lecture seule de la branche `claude/school-sprint-6`, à partir de `ca13fc8` (Sprint 5 livré). Aucune
modification de fichier, aucune migration, aucun appel réseau, aucune base Neon. Données fictives uniquement.

## Périmètre

- Authentification Suite (compte parent) : `apps/api/src/common/security/portal-accounts.ts`,
  `session.service.ts`, `common/auth-context.ts`, `common/common.module.ts`, `modules/auth/auth.service.ts`,
  `modules/auth/me.ts`.
- Partagé : `packages/shared/src/school-portal.ts` (présences, annonces, notifications, SMS), `school.ts`
  (permissions du Sprint 6), `school-i18n.ts` (textes FR/AR).
- Base : `packages/school-database/prisma/schema.prisma`, migration
  `20261109000000_portail_parents_presences_communication` (contraintes et index partiel écrits à la main).
- API School : `school-portal-accounts.service.ts`, `school-portal.service.ts`, `school-portal.controller.ts`
  (garde du portail, activation publique), `school-attendance.service.ts`, `school-announcements.service.ts`,
  `school-publications.service.ts`, `school-notifications.service.ts`, `school-sms.service.ts`,
  `school-sms.provider.ts`, `school-communication.controller.ts`, `school-portal.dto.ts`, `school.config.ts`,
  `school.module.ts` ; réutilisations modifiées : `school-assessment.service.ts` (`frozenResults`,
  `lockResults`), `school-report-cards.service.ts` (`views`), `school-payments.service.ts` (`receiptFile`),
  `school-finance.service.ts` (notification des échéances), `school-quran.service.ts` (`remarkShared`),
  `school.service.ts` (fuseau dans le contexte), `school-download.ts`.
- Web : `apps/web/src/app/parents/**`, `components/parents/parent-shell.tsx`, `app/parents.webmanifest`,
  `middleware.ts`, `lib/server-api.ts`, `lib/pwa.ts`, `app/(auth)/connexion/login-form.tsx`,
  `app/school/{portail-parents,presences,communication,publications}/**`, `app/school/coran/eleves/[id]`.
- Tests : `packages/shared/src/school-portal.spec.ts`, `apps/api/test/school-sprint6.integration.spec.ts`,
  `school-boundaries.spec.ts`.

## Questions prioritaires

1. **Comptes parents** : un compte sans adhésion n'est accepté que tant que le portail le déclare actif ; aucun
   membre, compte interne ou partenaire n'atteint les routes du portail, et un parent n'atteint aucune route du
   personnel. Invitation à usage unique, expirante, révocable ; activation sans double consommation.
2. **Lien parent-enfant** : chaque route du portail vérifie l'enfant autorisé (lien `canViewSchoolInfo`, même
   établissement, hors transfert, contrat actif) ; aucun accès horizontal (autre enfant, autre école, autre
   client) ; révocation effective à la requête suivante.
3. **Résultats** : jamais de brouillon ni de notes non validées ; publication liée à une validation active ;
   bulletin PDF de l'enfant seulement.
4. **Présences** : jamais deux appels pour une séance ; corrections motivées et historisées ; enseignant limité
   à ses classes ; justificatifs appliqués correctement.
5. **Annonces et notifications** : filtrage des destinataires ; aucune notification en double ; aucune
   notification d'un enfant retiré.
6. **SMS** : aucun envoi réel en test ; file, reprises bornées, échecs définitifs ; aucune donnée sensible dans
   le texte ; aucune clé dans le code.
7. **Isolation** : aucune fuite entre établissements ou clients ; journalisation des opérations sensibles.
8. **Migration** : strictement additive, cohérente avec le schéma ; aucune migration de la base Suite.

## Corrections après la passe 1 (NO GO, 5 P1 et 7 P2)

1. Résultats et bulletin : publication, validation, notes et appréciations lues dans un même instantané
   (`RepeatableRead`, `activeFor(..., tx)`).
2. Notifications d'annonce : consultables seulement tant que l'annonce vise encore un enfant autorisé
   (`PortalScope.announcementIds`, recalculé à chaque requête).
3. et 8. Invitation, activation et révocation : verrou de la fiche responsable puis des invitations, dans
   cet ordre partout (`lockGuardian`) ; compte relu sous verrou à la révocation.
4. et 6. Portail fermé si l'organisation est suspendue dans Ocall Suite ; établissements limités à la
   couverture du contrat (`organizationsOf`).
5. Enseignant : classes revérifiées à la publication, liens `SchoolClassTeacher` verrouillés en partage.
7. Appel et acceptation d'un justificatif : verrou consultatif par élève, ordre trié (`lockStudents`).
9. SMS : bail expiré après la cinquième tentative → échec définitif ; réservation filtrée par le compteur ;
   contrainte SQL alignée sur 5.
10. Activation journalisée dans la transaction School (`SchoolAccessDecision`) puis publiée ; la compensation
    ne couvre que les échecs antérieurs au commit.
11. Publication d'annonce : contenu, public, expiration et cibles relus sous le verrou du brouillon.
12. Statistiques individuelles agrégées par la base sur toute la période ; liste limitée signalée
    (`truncated`).

Six tests d'intégration ajoutés ; huit mutations (retrait de chaque correctif) toutes détectées par le test
attendu. Le correctif 1 (instantané) et le 11 (relecture sous verrou) ne sont pas couverts par un test de
concurrence déterministe.

## Corrections après la passe 2 (NO GO, 12 points corrigés, 2 P1, 5 P2 et 2 P3 nouveaux)

- N1 : justificatif appliqué aux seules séances de son établissement (`apply`, `justifiedOn`) ; l'examen
  verrouille l'élève avant le justificatif.
- N2 : `save` prend la classe (`FOR KEY SHARE`) puis revérifie le lien enseignant sous verrou partagé
  (`SchoolService.holdsClasses`, partagé avec la publication des annonces), dans l'ordre de la fin
  d'affectation (classe puis lien).
- N3 : historique d'un élève pour l'enseignant limité à ses classes (lues dans le même instantané), sans les
  justificatifs.
- N4 : `SchoolAttendanceEvent` conserve minutes de retard et note avant et après (migration du Sprint 6
  complétée, différence avec le schéma vide).
- N5 : contrôle des impayés par curseur `(dueOn, id)`.
- N6 : notifications de nouvelles échéances écrites dans la transaction de génération (`chargesGenerated`
  supprimé), pour les seuls élèves recevant une échéance nouvelle.
- N7 : l'écran d'appel renvoie la note existante ; l'historique affiche minutes et notes.
- N8 : pagination des notifications parents par curseur.
- N9 : liste de présences limitée signalée aux parents (`par.att.truncated`, FR et AR).

Trois tests d'intégration ajoutés (N1, N3, N4) ; six mutations toutes détectées. N2 et N5 ne sont pas
couverts par un test déterministe (concurrence, volume de plus de 1 000 échéances).

## Corrections après la passe 3 (NO GO, 9 points corrigés, 1 P1, 4 P2 et 2 P3 nouveaux)

- N10 : historique d'un élève pour le personnel limité aux établissements de son périmètre (séances et
  justificatifs), en plus du filtre enseignant.
- N11 : destinataires d'un fait limités aux responsables et élèves de l'établissement du fait.
- N12 : contrôle des impayés : notification et SMS d'une échéance écrits dans une même transaction.
- N13 : un élève relevé dans une séance puis sorti de la classe reste affiché (`former`) et corrigeable ;
  une nouvelle saisie exige l'effectif actuel.
- N14 : l'écran d'appel envoie une grande classe en lots de `SCHOOL_ATTENDANCE_BATCH` (200, limite partagée
  avec le DTO).
- N15 : annonces des parents paginées (`?page=`, 50 par page, ordre stable).
- N16 : historique SMS : filtre par statut et pagination par curseur.

Quatre tests d'intégration ajoutés (N10, N11, N13, N15) ; quatre mutations toutes détectées. N12 et N14 ne
sont pas couverts par un test déterministe (interruption de processus, écran).

## Corrections après la passe 4 (NO GO, 2 P2 et 3 P3 nouveaux)

- N17 : la file SMS conserve le responsable et l'élève (`guardianId`, `studentId`) ; à la réservation, un
  message dont le destinataire n'est plus éligible (SMS désactivés, responsable absent ou d'un autre
  établissement, numéro changé, lien retiré ou SMS refusés, élève sorti de l'établissement) passe à
  `CANCELLED` (`RECIPIENT_INELIGIBLE`), sans tentative comptée ni envoi.
- N18 : rappel d'impayé : l'échéance est relue sous verrou partagé dans la transaction de notification ;
  soldée entre-temps, aucun rappel.
- N19 : écran d'appel : après l'échec d'un lot, la feuille est relue (séance et motif visibles) sans perdre
  la saisie en cours.
- N20 : statistiques de classe : les élèves relevés puis sortis de la classe figurent dans le détail
  (`former`).
- N21 : liste des annonces du personnel paginée (`page`, 200 par page, ordre stable) ; tailles de page
  partagées (`SCHOOL_ANNOUNCEMENTS_PAGE`, `SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE`).

Deux tests d'intégration ajoutés et deux complétés (N17, N20, N21) ; trois mutations détectées. N18 et N19 ne
sont pas couverts par un test déterministe (concurrence, écran). Les tests de concurrence et de volume du
Sprint 6 sont ignorés sur PGlite (connexion unique), comme ceux des sprints précédents.

## Verdict de la passe 5 : GO SOUS RÉSERVES

Aucun P0, P1 ni P2. N17, N18, N20 et N21 corrigés ; N19 partiel, repris en N22. Réserves P3 non bloquantes,
laissées en l'état pour livrer le code tel qu'audité :

- N22 : écran d'appel : si la réponse du premier lot se perd alors qu'il a été validé, la feuille n'est pas
  relue (motif de correction masqué jusqu'au rechargement de la page).
- N23 : liste des justificatifs du personnel limitée à 200, sans pagination.
- N24 : écran d'appel : une modification faite pendant l'envoi des lots n'est pas envoyée et le rechargement
  l'écrase.

Rapports : `C:\Users\couli\ocall-audits\audit-codex-school-6-passe1.md` à `passe5.md`.

## Vérifications à rejouer (optionnel, hors production)

- `pnpm -r run typecheck`, `pnpm -r run test`, `npx eslint .`, `npx prettier --check .`.
- Intégration sur une base School de test : `npx jest --runInBand test/school-sprint6.integration.spec.ts`
  dans `apps/api` (les tests de concurrence exigent plusieurs connexions réelles).

## Format attendu

Verdict (GO, GO SOUS RÉSERVES, NO GO), puis anomalies classées P0 à P3 avec fichier, ligne, scénario concret
et correction proposée.
