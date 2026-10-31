# Pilote Ocall — 3 à 5 établissements

**Le pilote réel ne démarre qu'avec l'autorisation du commanditaire**, après le checkpoint CP-10 et
les contrôles de [PRODUCTION.md §10](PRODUCTION.md). Guides associés :
[Super Admin](OCALL-SUITE.md), [paiement manuel](GUIDE-PAIEMENT-MANUEL.md),
[support](GUIDE-SUPPORT.md), [sauvegarde et restauration](PRODUCTION.md#5-sauvegardes).

## 1. Choix des établissements

- 3 à 5 établissements à Bamako, avec au moins un parc, un restaurant et un établissement mixte.
- Un responsable désigné par site, joignable sur WhatsApp, disponible pour la formation.
- Connexion internet sur place (4G de secours recommandée), un PC ou une tablette pour la caisse,
  le matériel prévu (imprimante thermique, tiroir-caisse, douchette QR) **apporté par le client ou
  fourni par Ocall**, à confirmer site par site.

## 2. Onboarding (par établissement, environ une demi-journée)

| Étape | Qui      | Action                                                                                                                                                        |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Ocall    | Créer l'organisation dans `/admin/organisations` (métier, pays), transmettre au propriétaire son identifiant et son mot de passe temporaire par un canal sûr. |
| 2     | Ocall    | Émettre la facture de mise en service (et la première mensualité) : `/admin/factures`. Voir [GUIDE-PAIEMENT-MANUEL.md](GUIDE-PAIEMENT-MANUEL.md).             |
| 3     | Client   | Régler hors plateforme ; Ocall vérifie la réception, saisit puis valide le règlement en cochant l'activation.                                                 |
| 4     | Client   | Première connexion du propriétaire : nouveau mot de passe ; compléter l'organisation et les établissements.                                                   |
| 5     | Client   | Créer les employés (identifiants individuels), affecter les rôles et les établissements.                                                                      |
| 6     | Ensemble | Configuration initiale (§3), puis recette sur site (§5).                                                                                                      |

## 3. Configuration initiale

- **Restaurant** : catégories et produits (import IA de la carte possible, avec relecture), prix par
  établissement, tables et zones, imprimantes de caisse et de cuisine, stocks des produits suivis.
- **Parc** : catégories de billets et tarifs, horaires et jours d'ouverture, exceptions (jours
  fériés), postes de contrôle.
- **Caisse** : terminal, moyens de paiement acceptés, fond de caisse.
- **Site vitrine** (facultatif) : thème, photos, horaires, tarifs publiés.
- **IA** (facultatif) : fonctionnalités activées, plafond mensuel (dans la limite de l'offre).

## 4. Formation (2 heures par site)

| Public                 | Contenu                                                                                       | Durée  |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------ |
| Propriétaire / admin   | Tableau de bord, analyses, employés et rôles, réglages, abonnement, **support Ocall**         | 45 min |
| Caissiers              | Ouverture et clôture de caisse, vente, encaissement, réimpression, annulation (selon le rôle) | 45 min |
| Cuisine                | Écran cuisine : réception, progression, commandes prêtes                                      | 15 min |
| Agents d'entrée (parc) | Scan des billets, refus et motifs, mode dégradé                                               | 15 min |

Remettre à chaque site : identifiants (individuels, jamais partagés), numéro WhatsApp d'Ocall,
procédure « que faire si » : panne internet, imprimante muette, billet refusé, mot de passe oublié.

## 5. Matrice de recette (à remplir sur chaque site)

| #   | Scénario                                                                       | Attendu                                                      | OK / KO | Remarque |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------- | -------- |
| R1  | Connexion de chaque rôle                                                       | Chaque rôle voit uniquement ses modules                      |         |          |
| R2  | Ouverture de caisse, vente de 3 produits, encaissement espèces, ticket         | Ticket imprimé, total exact, rendu monnaie correct           |         |          |
| R3  | Paiement mobile money **saisi** (aucun encaissement en ligne)                  | Référence enregistrée, vente soldée                          |         |          |
| R4  | Commande envoyée en cuisine, progression jusqu'à « prête »                     | Affichage en temps réel sur l'écran cuisine                  |         |          |
| R5  | Commande QR à table (si activée)                                               | Demande reçue, validée par le personnel                      |         |          |
| R6  | Vente de billets, impression, scan à l'entrée                                  | Billet accepté une fois, refusé au second passage            |         |          |
| R7  | Billet annulé puis scanné                                                      | Refus avec motif                                             |         |          |
| R8  | Clôture de caisse avec écart volontaire                                        | Écart affiché et journalisé                                  |         |          |
| R9  | Tiroir-caisse : ouverture sur encaissement et ouverture manuelle (superviseur) | Ouverture, trace dans le journal                             |         |          |
| R10 | Mouvement de stock et alerte de seuil                                          | Stock mis à jour, alerte visible                             |         |          |
| R11 | Analyses du jour comparées au total de caisse                                  | Montants identiques                                          |         |          |
| R12 | Copilote : question sur les ventes du jour                                     | Chiffres identiques aux analyses, aucune donnée inventée     |         |          |
| R13 | Demande de support avec photo                                                  | Reçue par Ocall, réponse visible dans l'espace client        |         |          |
| R14 | Coupure internet de 5 minutes pendant le service                               | Comportement constaté et noté (aucun mode hors ligne promis) |         |          |
| R15 | Site vitrine publié                                                            | Page publique à jour, sans donnée interne                    |         |          |

## 6. Critères d'acceptation du pilote

- **Bloquants** (aucun toléré) : erreur de montant, vente perdue, billet accepté deux fois, accès
  aux données d'une autre organisation, ticket ou billet non imprimable sans contournement.
- Toutes les lignes R1 à R13 « OK » sur chaque site, ou contournement documenté et accepté.
- Disponibilité mesurée de l'API ≥ 99 % sur la durée du pilote (moniteur externe).
- Demandes de support urgentes prises en charge en moins de 2 heures ouvrées.
- Retour écrit de chaque responsable de site à la fin du pilote (2 à 4 semaines).

## 7. Suivi pendant le pilote

- Point hebdomadaire par site (WhatsApp ou visite) ; anomalies consignées dans le support Ocall
  (une demande par problème, avec photo).
- Revue hebdomadaire Ocall : demandes ouvertes, alertes de quota, erreurs serveur, factures en
  attente.
- Décision de fin de pilote : **GO commercial**, **prolongation** ou **arrêt**, par le commanditaire.
