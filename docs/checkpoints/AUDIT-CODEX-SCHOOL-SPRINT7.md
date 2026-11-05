# Ocall School, Sprint 7 : instructions pour l'audit indépendant Codex

Audit en lecture seule de la branche `claude/school-sprint-7`, à partir de `692e4c4` (Sprint 6 livré). Aucune
modification de fichier, aucune migration, aucun appel réseau, aucune base Neon. Données fictives uniquement.

## Périmètre

- Partagé : `packages/shared/src/school-planning.ts` (heures, chevauchements, conflits, fermetures),
  `school.ts` (permissions du Sprint 7), `school-portal.ts` (types de notification), `school-i18n.ts`
  (textes FR/AR, messages d'erreur arabes).
- Base : `packages/school-database/prisma/schema.prisma`, migration
  `20261110000000_planning_emplois_du_temps_calendrier` (contraintes et index partiel écrits à la main).
- API School : `school-timetables.service.ts` (versions, créneaux, conflits, publication, annulations,
  indisponibilités, vues de semaine), `school-calendar.service.ts`, `school-exams.service.ts`,
  `school-rooms.service.ts`, `school-planning.controller.ts`, `school-planning.dto.ts`, ajouts à
  `school-portal.service.ts` et `school-portal.controller.ts` (planning et calendrier des parents),
  `school.service.ts` (`lockPlanning`), `school.module.ts`.
- Web : `apps/web/src/app/school/{emplois-du-temps,mon-planning,calendrier,examens,salles}/page.tsx`,
  `components/school/school-planning.tsx`, `app/parents/(portal)/{calendrier,enfants/[id]/planning}`,
  `components/parents/parent-shell.tsx`, `app/school/layout.tsx`.
- Tests : `packages/shared/src/school-planning.spec.ts`, `apps/api/test/school-sprint7.integration.spec.ts`.

## Choix validés par le client

Semaine type versionnée avec exceptions datées (annulation) ; examens dans une table liée à l'évaluation du
Sprint 4 ; indisponibilités = fermetures du calendrier et indisponibilités hebdomadaires des enseignants ;
notifications aux familles par le centre existant, fil des changements pour les enseignants.

## Questions prioritaires

1. **Conflits** : enseignant (y compris entre établissements du groupe), salle, classe (groupes distincts
   admis), indisponibilité, affectation terminée ; contrôlés à la création, à la modification et à la
   publication ; résistance aux écritures concurrentes (verrou consultatif par organisation).
2. **Publication** : réservée à la direction ; remplacement des versions précédentes (raccourcissement,
   archivage, refus d'un dépassement par la fin) ; aucune version publiée ne coexiste avec une autre pour
   une même classe et un même jour.
3. **Isolation et droits** : tout filtré par organisation et établissement côté serveur ; l'enseignant ne
   voit que ses classes et son planning ; brouillons réservés à qui prépare ; parent limité à ses enfants
   autorisés (et à leurs groupes).
4. **Calendrier** : fermetures appliquées aux bonnes classes ; visibilité personnel / familles ; examen
   refusé un jour de fermeture.
5. **Examens** : aucune note hors du Sprint 4 ; conflits de classe, salle, surveillant.
6. **Notifications** : aucune donnée inaccessible au destinataire, pas de doublon (clé du fait).
7. **Migration** : strictement additive, cohérente avec le schéma.

## Corrections après la passe 1 (NO GO, 2 P1, 12 P2, 1 P3)

1. Enseignant : semaine d'une salle et planning personnel limités à ses classes actuelles (examens qu'il
   surveille exceptés) ; fil des changements limité de même.
2. Portail parents : une fermeture réservée au personnel n'apparaît que comme suspension, sans titre ni
   catégorie (`closureView(..., families)`).
3. et 4. `closureApplies` exige l'établissement du cours et évalue une fermeture de groupe selon le groupe
   du cours, de l'examen ou de l'enfant ; vue d'une classe limitée aux fermetures de son établissement.
5. Cours de toute la classe : affectation de toute la classe exigée (plus d'affectation de groupe).
6. Affectation lue `FOR SHARE` jusqu'au commit (la fin d'affectation attend ou est vue).
7. Publication ou modification d'une fermeture refusée si un examen non annulé de la même cible s'y trouve
   (`CLOSURE_EXAM_CONFLICT`), sous le verrou du planning.
8. Conflit seulement si le jour existe dans l'intersection des validités (`weekdayOccurs`).
9. Date d'examen dans la période de l'évaluation ; la programmation fixe aussi `heldOn` sous le verrou des
   résultats, refusée si les résultats sont validés ; le Sprint 4 refuse de changer la date d'un examen
   programmé (`EVALUATION_SCHEDULED`).
10. Textes de notification distincts : examen déplacé, annulé ; cours rétabli.
11. Rétablissement d'un cours : familles notifiées, fil des enseignants.
12. Suppression d'une évaluation (Sprint 4) : programmation en brouillon ou annulée supprimée avec elle ;
    publiée : refus métier `EVALUATION_EXAM_PUBLISHED` ; verrou du planning pris en premier.
13. Publication : matières, groupes et salles revalidés (actifs), lus `FOR SHARE`.
14. Événement : un texte facultatif absent d'une modification est conservé ; l'écran conserve et édite la
    description arabe.
15. Contrainte SQL des horaires d'événement corrigée (les deux renseignés ou aucun).

Six tests d'intégration ajoutés et des tests unitaires complétés ; onze mutations toutes détectées. Le
point 6 (concurrence avec la fin d'affectation) n'a pas de test déterministe.

## Corrections après la passe 2 (NO GO, 11 points corrigés, 4 partiels, 7 P2 et 3 P3)

- B1 : enseignants verrouillés (`FOR KEY SHARE`, ordre trié) avant leurs affectations, à la saisie d'un
  cours et à la publication : plus de cycle avec la désactivation d'un membre.
- B2 : programmation d'un examen : verrous dans l'ordre planning → établissement et année
  (`guardSchools`) → résultats de la classe pour la période → lignes ; période lue `FOR SHARE` avant ses
  bornes.
- B3 : annulation et rétablissement relisent le créneau et sa version sous le verrou ; version non publiée :
  rien n'est rétabli ni annoncé.
- B4 : un créneau sans occurrence dans sa validité n'a aucun conflit (indisponibilités comprises) ; une
  indisponibilité n'est refusée que pour un cours qui a encore une occurrence à venir.
- B5 : publication d'un événement refusée si une classe ou un groupe visé est archivé ou désactivé ;
  destinataires d'un groupe calculés comme au portail (groupe actif, inscription de l'année en cours).
- B6 : chaque fait de créneau enregistre les enseignants concernés avant et après ; le fil d'un enseignant
  les retrouve même si la version ne le cite plus.
- B7 : planning d'un enseignant demandé hors du périmètre d'établissements : introuvable.
- P3 : ordre des verrous des examens rétabli, messages des codes de ressource désactivée, conflit affiché une
  seule fois dans le formulaire du calendrier.

Quatre tests d'intégration ajoutés et un test unitaire ; mutations B5, B6 et B7 détectées. B3 n'est pas
discriminé par un test séquentiel (le contrôle préalable refuse déjà une version archivée ; la relecture
protège le cas concurrent) ; B1 et B2 relèvent de la concurrence, sans test déterministe.

## Corrections après la passe 3 (NO GO, 3 P2 et 2 P3)

- R1 : rétablissement refusé (`LESSON_NOT_ON_DATE`, aucune notification) si le cours n'a plus lieu ce jour-là
  (créneau déplacé, version raccourcie) ; un créneau déplacé à un autre jour perd ses annulations datées.
- R2 : modification d'un événement publié : cibles finales revalidées actives ; classes et groupes visés lus
  `FOR SHARE` jusqu'au commit (publication et modification).
- N1 : publication d'un examen refusée si la classe ou le groupe de l'évaluation est archivé ou désactivé
  (`EXAM_TARGET_INACTIVE`, lu `FOR SHARE`) ; aucune notification pour un cours ou un examen d'un groupe
  désactivé (invisible du portail).
- N2 (P3) : chaque fait de créneau enregistre si la version était publiée ; le fil des enseignants
  n'affiche que les changements publiés.
- N3 (P3) : réserve, voir les limites (minuit non saisissable dans les champs horaires du navigateur).

Quatre tests d'intégration ajoutés ; quatre mutations détectées.

## Corrections après la passe 4 (NO GO, 2 P2 et 2 P3)

- Formulaire d'examen : la réponse des évaluations (`{ locked, evaluations }`) est lue correctement ; la
  preuve navigateur programme et publie désormais un examen depuis l'écran.
- Destinataires des notifications de planning et d'examen calculés comme le portail
  (`SchoolNotificationsService.portalStudents`) : inscription validée de l'année en cours, groupe actif ;
  jamais une inscription future.
- P3 : le formulaire de créneau propose un groupe pour un enseignant affecté à toute la classe ; un
  rétablissement pendant une fermeture applicable retire l'exception sans annoncer de reprise.

Deux tests d'intégration ajoutés ; deux mutations détectées ; preuve navigateur complétée (32 contrôles).

## Corrections après la passe 5 (NO GO, 1 P2 et 2 P3)

- P2 : vérification, publication, ajout et modification d'un créneau prennent la garde de l'établissement
  (`guardSchools`, celle que la clôture d'année prend en exclusif) avant tout verrou de ressource ou
  d'affectation (`guardOpenYear`), puis relisent l'année : une année clôturée entre-temps donne
  `SCHOOL_YEAR_CLOSED`. Ordre : planning → établissement et année → résultats → lignes.
- P3 : reprise du choix d'affectation à l'édition d'un cours de groupe : expression `/\|[^|]*$/` ; la clé de
  repli n'est retenue que si elle existe dans les options.
- P3 : un retrait d'annulation pendant une fermeture applicable enregistre `lesson_exception_removed`
  (absent du fil des enseignants) au lieu de `lesson_restored`.

Un test d'intégration ajouté et un complété ; deux mutations détectées (garde retirée, action unique).

## Corrections après la passe 6 (NO GO, 1 P2 et 2 P3)

- P2 : formulaire d'examen : la classe d'une nouvelle programmation est figée à l'ouverture
  (`{ newFor: classId }`, clé du formulaire incluant la classe) ; changer le filtre de classe n'interrompt
  plus la saisie.
- P3 : expression régulière effectivement corrigée (`/\|[^|]*$/` ; l'antislash avait été perdu lors de
  l'édition précédente).
- P3 : la garde de l'année (`guardOpenYear`) est prise à l'entrée de `validateSlot`, pauses comprises.

Test d'intégration complété (pause dans une année clôturée) ; mutation détectée ; preuve navigateur 32/32.

## Corrections après la passe 7 (NO GO, 1 P2 et 1 P3)

- P2 : formulaire d'examen : changer de période vide l'évaluation et la date ; seules les évaluations dont
  la période (`periodId`) est celle affichée sont proposées (une liste encore en rechargement est écartée) ;
  l'enregistrement est bloqué si l'évaluation choisie n'en fait pas partie.
- P3 (archivage manuel sans notification) : laissé en réserve, documenté dans les limites (section 14).

Preuve navigateur 32/32 (programmation et publication d'un examen depuis l'écran).

## Vérifications à rejouer (optionnel, hors production)

- `pnpm -r run typecheck`, `pnpm -r run test`, `npx eslint .`, `npx prettier --check .`.
- Intégration sur une base School de test : `npx jest --runInBand test/school-sprint7.integration.spec.ts`
  dans `apps/api` (le test de concurrence exige plusieurs connexions réelles).

## Format attendu

Verdict (GO, GO SOUS RÉSERVES, NO GO), puis anomalies classées P0 à P3 avec fichier, ligne, scénario concret
et correction proposée.
