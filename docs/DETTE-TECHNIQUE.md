# Dette technique

Points connus, à traiter avant la mise en production des fonctions concernées. Du plus prioritaire au moins
prioritaire.

## DT-001 — Stockage objet de préproduction inutilisable (PRIORITAIRE)

- **Constat** (17/11/2026, recette du sprint 8 Ocall Parc) : tout envoi de fichier sur l'API de préproduction
  échoue en 500 (`InvalidArgument: Credential access key has length 18, should be 32`).
- **Cause** : les identifiants S3/R2 du service `api` (environnement Railway `staging`), `S3_ACCESS_KEY_ID` et
  `S3_SECRET_ACCESS_KEY`, ne sont pas de vrais identifiants Cloudflare R2. Ils font 18 caractères, alors que R2 en
  attend 32 et 64. Le problème existait avant le sprint 8 : le logo Ocall Facture échoue de la même façon. Le code
  n'est pas en cause.
- **Effets en préproduction** :
  - aucune photo de titulaire de pass, donc aucune vente de pass mensuel ou annuel (photo obligatoire, D9) ;
  - aucun logo Ocall Facture ;
  - plus largement, tout fichier stocké : pièces jointes et médias.
- **À faire** :
  1. créer de vrais identifiants R2 (jeton à droits limités au bucket de préproduction) ;
  2. les renseigner sur Railway, sans jamais les écrire dans le dépôt ;
  3. vérifier que la production a ses propres identifiants valides avant toute mise en service.
- **Tests à rejouer après correction** (non validés en préproduction) :
  - envoi de la photo du titulaire (`POST /passes/photos`) ;
  - vente d'un pass **mensuel** puis d'un pass **annuel** avec photo, paiement et activation ;
  - contrôle d'accès : photo affichée au scan (`scan-pass-photo`), lien signé de 5 minutes ;
  - changement de photo (`PUT /passes/:id/photo`), purge de l'ancienne ;
  - photo dans les données d'impression `ocall-print/pass-card@1` (lien signé) ;
  - anonymisation d'un client titulaire : photo détachée et purgée ;
  - vérification qu'un mois calendaire est bien appliqué sur un vrai pass mensuel en préproduction ;
  - parcours navigateur ordinateur d'origine (`e2e/parc-s8-pass.spec.ts`, offre mensuelle avec photo) ;
  - logo Ocall Facture (envoi, aperçu, PDF).
- Ces cas sont couverts en local (intégration, mutations, E2E) ; seule la validation sur l'environnement
  déployé manque.
