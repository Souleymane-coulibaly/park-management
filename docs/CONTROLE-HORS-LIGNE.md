# Contrôle d'accès hors ligne : étude (non activé)

**Statut : non développé.** Aujourd'hui, aucune entrée n'est validée sans réponse du serveur. Ce document
décrit ce qu'exigerait un contrôle réellement hors ligne, pour décision ultérieure.

## Pourquoi ce n'est pas activé

Le jeton du QR est aléatoire : sans serveur, un appareil ne peut ni savoir s'il existe, ni savoir s'il a
déjà été utilisé. Deux agents hors ligne accepteraient le même billet, et une capture d'écran ouvrirait
plusieurs entrées. L'erreur n'apparaîtrait qu'à la reconnexion, une fois les visiteurs entrés.

## Ce qu'il faudrait construire

| Besoin                | Solution envisagée                                                                 |
| --------------------- | ---------------------------------------------------------------------------------- |
| Vérifier sans serveur | QR signé par le serveur (Ed25519), clé publique sur l'appareil                     |
| Billets existants     | Double lecture des anciens QR, ou réémission                                       |
| Annulations           | Liste de révocation téléchargée, avec une date limite de fraîcheur                 |
| Double passage        | Limite par appareil seulement : affecter chaque billet à une seule entrée physique |
| Enregistrement        | File chiffrée sur l'appareil, envoyée au retour du réseau, conflits signalés       |
| Appareil perdu        | Clé d'appareil révocable, durée limitée, aucune donnée nominative stockée          |
| Sessions              | Mode hors ligne limité dans le temps, ouvert au préalable par un responsable       |

## Risques à accepter avant de lancer ce chantier

- Une fraude par double entrée reste possible entre deux appareils tant qu'ils ne sont pas resynchronisés.
- Le stockage local introduit des données sensibles sur des téléphones partagés (RGPD).
- Les règles d'ouverture du parc devraient être copiées sur l'appareil, avec un risque de décalage.

## Mesures à prendre d'abord

Avant de décider, mesurer sur un parc pilote la fréquence et la durée réelles des coupures. Une connexion
4G de secours à l'entrée coûte probablement moins cher et supprime la majorité des cas.
