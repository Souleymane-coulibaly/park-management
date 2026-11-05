# Ocall School — feuille de route

Ordre validé. Aucun sprint ne démarre sans autorisation explicite.

| Étape     | Contenu                                                                             | État                                                                      |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Sprint 1  | Socle, contrats Suite, portail, base School distincte                               | Livré                                                                     |
| Sprint 2  | Élèves, responsables, inscriptions, imports, exports, documents                     | Livré (c9f6589) ; migration Neon `decisions_acces` en attente             |
| Sprint 3A | Langues : réglage par établissement, interface arabe RTL, écrans des Sprints 1 et 2 | Livré (audit Codex GO sous réserves)                                      |
| Sprint 3B | Enseignants, classes et groupes, matières, affectations                             | Livré (1d03903, audit Codex GO sous réserves) ; migration Neon en attente |
| Sprint 4  | Évaluations, notes, bulletins, module facultatif « Mémorisation du Coran »          | Livré (720f5c3, audit Codex GO sous réserves)                             |
| Sprint 5  | Gestion financière : frais, échéanciers, encaissements, reçus, impayés              | Livré (ca13fc8, audit Codex GO, passe 9)                                  |
| Sprint 6  | Portail parents, présences, communication, notifications, SMS (simulés)             | Livré (692e4c4, audit Codex GO sous réserves, passe 5)                    |
| Sprint 7  | Emplois du temps, salles, calendrier scolaire, examens                              | Livré sur `claude/school-sprint-7` (Codex passe 8 : GO SOUS RÉSERVES)     |

## Règles linguistiques (toutes les étapes)

- Français par défaut pour tout nouvel établissement ; l'arabe est un choix de l'établissement.
- Français : aucun champ arabe affiché. Arabe : interface et documents en arabe, de droite à gauche.
  Bilingue : interface française, contenus pédagogiques, matières, bulletins et documents en deux langues.
- Changement réservé à la direction, journalisé, sans perte de données.
- Le menu général d'Ocall Suite reste en français (Ocall Park n'est pas modifié).

## Module « Mémorisation du Coran » (facultatif)

Réservé aux établissements en mode Bilingue ayant activé l'enseignement coranique ; totalement masqué
(interface et API) pour les établissements en Français.

- Catalogue fixe des 114 sourates : numéro, nom arabe, translittération française, repris d'une source de
  référence et vérifié.
- Suivi sourate par sourate, sans suivi verset par verset.
- Statuts : Non commencée, En cours, Mémorisée, À réviser.
- Historique conservé de chaque évaluation et révision (date, enseignant, statut, remarque facultative).
- Progression individuelle et tableau de suivi par classe.
- Saisie par l'enseignant affecté à la matière Coran de la classe ; consultation par la direction ; lecture
  seule dans le futur portail parents.
- Isolation stricte entre établissements, permissions par rôle, respect de la langue de l'établissement.

Dépendances : matière et affectations du Sprint 3B, langue du Sprint 3A.

Points à trancher au cadrage :

1. Établissements configurés en Arabe seul : **exclus** (cahier des charges du Sprint 4 : Bilingue seulement).
2. Données d'enseignement religieux de mineurs (catégorie sensible, RGPD article 9 et lois équivalentes) :
   accès restreint, pas d'export, consultation journalisée (appliqué au Sprint 4) ; information des familles et
   validation juridique encore requises avant toute vraie donnée.
