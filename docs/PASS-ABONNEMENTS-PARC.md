# Pass et abonnements du parc (Ocall Parc, sprint 8)

Les pass étendent la billetterie du parc ([BILLETTERIE-PARC.md](BILLETTERIE-PARC.md)) : même module
(`ticketing`), même caisse, même contrôle d'accès, même fiche client et même stockage privé. Aucun
nouveau module ni moteur parallèle. Les abonnements SaaS d'Ocall Suite ne sont pas concernés.

## Types de pass

| Type         | Durée par défaut     | Entrées par défaut | QR par défaut | Photo       | Renouvelable |
| ------------ | -------------------- | ------------------ | ------------- | ----------- | ------------ |
| Journalier   | 1 jour, date choisie | 1                  | fixe          | facultative | non          |
| Hebdomadaire | 7 jours consécutifs  | 1 par jour         | fixe          | facultative | non          |
| Mensuel      | 1 mois calendaire    | 1 par jour         | dynamique     | obligatoire | oui          |
| Annuel       | 12 mois calendaires  | illimitées         | dynamique     | obligatoire | oui          |

Tout est configurable par offre (`/app/billetterie/pass/offres`, permission `ticketing.manage`) :
durée en jours ou en mois, entrées par jour et par période, jours de la semaine autorisés, QR fixe ou
dynamique, suspension (durée maximale, prolongation de la validité), période de vente, parcs autorisés
avec un tarif propre à chaque parc. Une offre n'est jamais supprimée (désactivée). Les règles sont
**figées dans le pass à la vente** (`Pass.rules`) : modifier une offre ne change aucun pass vendu.

## Parcours

1. **Vente** (`/app/billetterie/pass`, `pos.sell`, caisse ouverte) : offre, fiche client du titulaire
   (obligatoire, recherche ou création), photo (caméra du téléphone ou de la tablette), premier jour
   de validité (aujourd'hui à +365 jours). La vente est une vente `PARK` ordinaire du moteur de caisse
   (numérotation, idempotence, paiement, reçu) ; le pass reste « en attente de paiement » jusqu'au
   paiement et **s'active dans la transaction d'encaissement**. Annuler la vente non payée annule le
   pass jamais activé.
2. **Remise** : QR fixe à l'écran ou imprimé (journalier, hebdomadaire), et/ou **lien personnel**
   (`/pass/<jeton>`) à transmettre au titulaire. Le jeton n'est montré qu'une fois ; seule son
   empreinte SHA-256 est conservée. Le lien est révocable ; en émettre un nouveau remplace l'ancien.
3. **Contrôle** (`/app/controle-acces`, `access.scan`) : le même scanner lit billets, pass et cartes.
   Résultat en très grand, **photo et nom du titulaire** affichés pour le contrôle visuel.
4. **Fiche du pass** (`/app/billetterie/pass/<id>`) : validité, entrées restantes, périodes (une par
   vente), passages, historique horodaté avec l'auteur, cartes, lien, actions.
5. **Renouvellement** (`pos.sell`, caisse ouverte, tarif actuel du parc) : vente ordinaire ; la
   nouvelle période commence le lendemain de l'échéance précédente, ou le jour du paiement si le pass a
   expiré. Jamais de chevauchement ; l'historique des périodes est conservé.
6. **Suspension / réactivation** (`pass.manage`, motif obligatoire) : refusé à l'entrée pendant la
   suspension ; à la réactivation, la validité est prolongée des jours entiers de suspension, plafonnés
   par l'offre (et décale d'autant les périodes suivantes déjà payées).
7. **Annulation** (`pass.manage`, motif obligatoire) : **aucun remboursement automatique** ; cartes et
   lien révoqués. Refusée tant qu'une vente du pass attend son paiement (annuler d'abord la vente).
8. **Cartes physiques** (`pass.manage`) : une seule carte active par pass, identifiant fixe signé ;
   perte → révocation ; remplacement lié à l'ancienne carte. « Préparer l'impression » renvoie les
   données au format `ocall-print/pass-card@1` : **Ocall Parc n'imprime pas**, Ocall Print le fera.

## Règles garanties par le serveur

| Règle                            | Mise en œuvre                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signature des QR                 | HMAC-SHA256, clé dérivée de la clé serveur (`ocall-pass-qr-v1`) ; **jamais envoyée au navigateur** ; comparaison en temps constant                                               |
| QR dynamique                     | fenêtre de 30 s, tolérance ±1 fenêtre ; périmé → `QR_EXPIRED` ; même fenêtre déjà utilisée → `QR_REUSED` (clé unique `passWindowKey`)                                            |
| QR falsifié / autre organisation | `UNKNOWN`, sans aucun détail                                                                                                                                                     |
| Quotas (jour, période)           | partagés entre tous les parcs autorisés ; **verrou de ligne** (`SELECT … FOR UPDATE`) sur le pass : deux scans simultanés, même dans deux parcs, sont traités l'un après l'autre |
| Jour du parc                     | minuit dans le fuseau du parc qui scanne (`TicketScan.localDate`) ; heure d'été comprise                                                                                         |
| Parc non autorisé                | `OTHER_ESTABLISHMENT` ; aucun détail du titulaire montré hors des parcs autorisés                                                                                                |
| Photo                            | réencodée en JPEG sans métadonnées, stockage privé, lien signé de 5 min ; non rattachée : purgée sous 30 jours ; rattachée : conservée jusqu'à la fin du pass + 365 jours        |
| Anonymisation du client          | nom remplacé, photo détachée et purgée, lien révoqué                                                                                                                             |
| Droits                           | hors propriétaire et administrateur, un membre ne voit que les pass valables dans un de ses parcs                                                                                |

## API (`/api/v1`, Swagger : « Pass et abonnements »)

| Méthode        | Route                                                                   | Permission         |
| -------------- | ----------------------------------------------------------------------- | ------------------ |
| GET/POST/PATCH | `/pass-offers`, `/pass-offers/:id`                                      | `ticketing.manage` |
| GET            | `/passes/offers?establishmentId=`                                       | `pos.sell`         |
| POST           | `/passes/orders`, `/passes/photos`                                      | `pos.sell`         |
| GET            | `/passes`, `/passes/:id`                                                | `pos.sell`         |
| PUT            | `/passes/:id/photo`                                                     | `pos.sell`         |
| POST           | `/passes/:id/renew`, `/passes/:id/link`                                 | `pos.sell`         |
| DELETE         | `/passes/:id/link`                                                      | `pass.manage`      |
| POST           | `/passes/:id/suspend` · `reactivate` · `cancel`                         | `pass.manage`      |
| POST           | `/passes/:id/cards`, `/cards/:cardId/replace` · `revoke` · `print-data` | `pass.manage`      |
| GET            | `/public/passes/:token` (public, sans compte)                           | —                  |
| POST           | `/access/scans` (billets, pass et cartes)                               | `access.scan`      |

## Données (migration `20261217000000_parc_s8_pass_abonnements`, additive)

`PassOffer`, `PassOfferSite`, `Pass`, `PassPeriod`, `PassEvent`, `PassCard` ; colonnes ajoutées à
`TicketScan` (`passId`, `cardId`, `localDate`, `passWindowKey`) et à `SaleLine` (`passOfferId`).
Les billets et scans existants ne changent pas.

## Évolutions préparées

- **Ocall Print** : contrat `ocall-print/pass-card@1` (numéro de carte, QR signé, titulaire, offre,
  validité, photo en lien signé) ; `PassCard.printRequestedAt` marque la demande.
- **Événements** : un pass peut porter un jour unique (journalier daté) et des jours autorisés ; une
  offre « événement » réutilisera les mêmes règles, quotas et contrôle d'accès.
- Hors périmètre (décision D11) : vente et renouvellement en ligne.
