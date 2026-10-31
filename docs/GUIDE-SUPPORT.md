# Guide du support Ocall

## Côté client

- Menu **Support Ocall** (propriétaire, administrateur, superviseur) → « Nouvelle demande » : objet,
  catégorie, urgence, établissement concerné, description, jusqu'à 3 pièces jointes (photo, capture,
  PDF, 5 Mo chacune).
- Le propriétaire et l'administrateur voient toutes les demandes de l'organisation ; un superviseur
  voit les siennes. Aucune organisation ne voit les demandes d'une autre.
- Les réponses d'Ocall s'affichent dans la demande. **Aucun e-mail n'est envoyé** : prévenir le
  client par WhatsApp pour les urgences.

## Côté Ocall (`/admin/support`)

Rôles : assistance, administrateur délégué, propriétaire.

1. **Trier** : filtre par statut, produit, « Mes demandes ». Traiter d'abord les urgences
   (« Urgente » = activité bloquée), puis par ancienneté du dernier message.
2. **Prendre en charge** : la première réponse affecte la demande à l'agent ; réaffecter si besoin.
3. **Répondre** : message visible du client (statut automatique « En attente de votre réponse »),
   ou **note interne** (jamais visible du client) pour le suivi entre collègues.
4. **Clore** : « Résolue » quand la solution est confirmée ; « Fermée » empêche toute nouvelle
   réponse du client (il crée alors une nouvelle demande).

## Délais cibles pendant le pilote

| Urgence | Prise en charge | Exemples                                      |
| ------- | --------------- | --------------------------------------------- |
| Urgente | 2 h ouvrées     | Caisse inutilisable, billets refusés en masse |
| Haute   | 4 h ouvrées     | Imprimante en panne avec contournement        |
| Normale | 1 jour ouvré    | Question d'utilisation, paramétrage           |
| Faible  | 3 jours ouvrés  | Suggestion                                    |

## Bonnes pratiques

- Demander au client l'heure exacte et, pour une erreur affichée, l'identifiant de requête
  (`X-Request-Id`, visible dans les outils du navigateur) pour retrouver la ligne dans les journaux.
- Ne jamais demander un mot de passe. Pour un accès perdu : réinitialisation par e-mail, ou par le
  propriétaire de l'organisation pour un employé.
- Les pièces jointes sont privées : ouvertes par lien temporaire (5 minutes), chaque ouverture est
  journalisée. Elles sont conservées 365 jours puis purgées.
- Toute action (réponse, note, changement de statut, d'urgence ou d'affectation) est journalisée.
