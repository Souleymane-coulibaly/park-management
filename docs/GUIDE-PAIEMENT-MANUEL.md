# Guide du paiement manuel des abonnements

Règle obligatoire : **le client paie Ocall directement, hors plateforme**. Aucun prestataire de
paiement, aucun prélèvement, aucun renouvellement automatique. Le logiciel ne fait que tracer.

## Rôles

| Action                          | Rôle Ocall requis                                 |
| ------------------------------- | ------------------------------------------------- |
| Émettre ou annuler une facture  | Facturation, administrateur délégué, propriétaire |
| Saisir un règlement             | Facturation, administrateur délégué, propriétaire |
| Valider ou rejeter un règlement | Facturation, administrateur délégué, propriétaire |
| Consulter                       | + Consultation et audit                           |

Toutes ces actions exigent la double authentification et sont journalisées.

## Déroulé

1. **Le client contacte Ocall** (téléphone, WhatsApp) pour souscrire ou renouveler.
2. **Ocall émet la facture** (`/admin/factures` → « Émettre une facture ») : mise en service, nombre
   de mensualités, ajustement motivé éventuel. Les montants viennent du tarif accepté par le client
   (figé à sa première activation). Communiquer au client le **numéro de facture** (OCP-AAAA-NNNNN)
   et les modalités : virement (RIB Ocall), dépôt d'espèces, mobile money vers le compte marchand
   Ocall, avec le numéro de facture en référence.
3. **Le client paie hors plateforme.**
4. **Ocall vérifie la réception effective** : relevé bancaire, reçu signé pour les espèces,
   historique du compte mobile money. Ne jamais se fier à une capture d'écran seule.
5. **Ocall saisit le règlement** (`/admin/reglements` → « Saisir un règlement ») : organisation,
   facture, montant **égal au reste à payer**, moyen, référence de la transaction, date, période.
6. **Une seconde vérification** (idéalement une autre personne) **valide** le règlement en cochant
   « Activer / prolonger l'abonnement » : la facture passe à « Payée », l'abonnement est activé ou
   prolongé jusqu'à la fin de la période. Sans la case, rien n'est prolongé.
7. En cas de doute (paiement non retrouvé, montant différent) : **rejeter** avec un motif ; le client
   est recontacté.

## Cas particuliers

- **Paiement partiel** : non accepté contre une facture (le montant doit égaler le reste à payer).
  Annuler la facture et en émettre une plus juste, ou attendre le complément.
- **Erreur de facture** : l'annuler avec un motif tant qu'aucun règlement n'y est rattaché.
- **Remise commerciale** : ligne « Ajustement » négative avec motif obligatoire.
- **Changement de tarif** : modifier l'offre n'affecte pas les clients déjà activés (tarif figé), ni
  les factures émises.
- **Échéance proche** : le tableau de bord commercial liste les renouvellements à 30 jours ; le
  rappel au client se fait manuellement (aucun envoi automatique à ce jour).
- **Double saisie** : le serveur refuse un second règlement identique et une double validation.

## Contrôle mensuel

Comparer « Encaissé (validé) » du tableau de bord commercial avec les relevés bancaires et mobile
money du mois ; toute différence doit être expliquée avant la clôture comptable.
