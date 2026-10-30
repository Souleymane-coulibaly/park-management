# Checkpoint CP-05 — préparation (Sprints 1 à 6)

Ce document prépare l'audit indépendant Codex CP-05. Il ne constitue pas l'audit lui-même.

## Contexte de décision

- **CP-03** (Sprints 1 à 4) : GO SOUS RÉSERVES, avec « Sprint 5 : NON » tant que A1, A2 et A5
  restaient ouvertes. Le commanditaire a explicitement démarré le Sprint 5 malgré ce NON.
- **CP-04** (Sprints 1 à 5) n'a pas été réalisé. Le **30/10/2026**, le commanditaire a décidé de
  démarrer le Sprint 6 sans cet audit : **CP-05 couvre donc aussi tout le périmètre de CP-04**.
  - Préparation détaillée du Sprint 5 : [CP-04-preparation.md](CP-04-preparation.md).
  - Elle doit être auditée avec le présent document.
- Aucune réserve de CP-03 (A1, A2, A5) n'a été levée. Elles restent ouvertes, avec des éléments
  nouveaux pour A1 (voir CP-04).

## Référentiel

- Dépôt local `C:\Users\couli\park-management`.
- Branche `claude/sprint-6`, créée depuis `claude/sprint-5` (`8f97a5d`).
- Aucune de ces deux branches n'est poussée sans autorisation.
- Base de développement préservée ; tests sur la branche Neon `test` uniquement ; pas de production ;
  pas de fusion dans `main`.

## Commandes de vérification

```powershell
pnpm install
pnpm format:check; pnpm lint; pnpm typecheck
pnpm db:migrate:check
pnpm test
pnpm db:migrate:deploy:test
pnpm test:integration            # Sprints 1 à 6 — journal complet dans test-logs/
pnpm build; pnpm test:e2e        # Sprints 1 à 6 — journal complet dans test-logs/
```

## Points à vérifier — Sprint 6

1. **Bornes** (`apps/api/src/modules/kiosk/`) :
   - code d'appairage à usage unique et expirant ; consommation par mise à jour conditionnelle ;
   - jeton de 256 bits haché, transmis dans un cookie `httpOnly`, `SameSite=Strict`, limité au
     chemin `/api/v1/kiosk` ;
   - expiration et révocation ;
   - `KioskGuard` indépendant des sessions d'employés ;
   - le jeton n'ouvre aucune route d'employé (test 4) ;
   - établissement contrôlé à chaque requête : actif, restaurant, organisation active ;
   - une commande par session (`kioskSessionId` unique, session close dans la transaction) ;
   - plafond de 30 commandes par borne et par 10 minutes ;
   - numéro affiché par compteur atomique ;
   - aucun paiement ni aucune préparation automatique (tests 1 à 5).
2. **Commandes de borne** : `QrOrdersService.submitFromKiosk`, qui réutilise le parcours de demande
   du Sprint 5. La validation crée une vente sur le canal `KIOSK`.
3. **CRM** (`modules/crm/`) :
   - consentement obligatoire, champs facultatifs ;
   - accès restreint du caissier : recherche seule, sans remarques ni historique ;
   - isolation entre organisations ;
   - anonymisation irréversible avec annulation des points ;
   - règle de conservation de 36 mois ;
   - aucune donnée personnelle dans l'audit (tests 6 et 7).
4. **Fidélité** :
   - crédit dans la transaction du paiement (`LoyaltyEarningService`), sur le montant payé ;
   - idempotence `earn:<vente>` ;
   - portefeuilles par activité, sans transfert ;
   - remise calculée par le serveur et plafonnée au total ;
   - débit conditionnel et contrainte CHECK `balance >= 0` ;
   - annulation (`REVERSAL`) ;
   - articles figés tant qu'une remise est appliquée (tests 8 à 13).
5. **Planning** (`modules/planning/`) :
   - chevauchement contrôlé sous verrou de l'adhésion, tous établissements confondus ;
   - CHECK fin > début ;
   - affectation à l'établissement exigée ;
   - planning personnel visible par chaque employé ;
   - audit (tests 14 à 18).
6. **Modifications transverses du moteur de vente** :
   - `SalesService.pay` appelle `LoyaltyEarningService.onPaidSale` ;
   - `SalesService.cancel` appelle `reverseRedemption` ;
   - le ticket de caisse affiche la remise fidélité.
7. **Migration** `20261030142337_bornes_crm_fidelite_planning` : additive, avec deux contraintes
   CHECK ajoutées à la main (non gérées par Prisma, conservées par les diffs).
8. **Impression directe PWA et ticket de borne** (extension approuvée en cours de sprint) :
   - connexions `WEBUSB` et `WEBBLUETOOTH` (`apps/web/src/lib/hardware/browser-printers.ts`) ;
   - flux ESC/POS produit par le serveur et contrôlé avant envoi (`validatePrintBytes`) ;
   - impulsion de tiroir générée par l'appareil, après autorisation du serveur seulement ;
   - ticket de borne : `PrintJob` `KIOSK_TICKET` sans employé, sans réimpression au renvoi réseau ;
   - poste du même établissement avec imprimante ; une borne ne rapporte que ses propres tickets ;
   - migration additive `20261030152753_impression_pwa_ticket_borne` ; `PrintJob.requestedById`
     devient facultatif (vérifier que tous les lecteurs le traitent).

## Anomalies et limites

### Reportées (ouvertes)

A1 à A10 : voir [CP-04-preparation.md](CP-04-preparation.md). A1 (arrêts silencieux), A2
(transaction de 732 s) et A5 (matériel) restent les réserves bloquantes de CP-03.

### Nouvelles au Sprint 6

| Sujet                                                        | Gravité                          | Détail                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11 — indisponibilité répétée de la branche Neon `test`      | **Haute (pour la vérification)** | Le 30/10/2026 : coupure d'environ 75 min (13 h 06–14 h 21), puis branche injoignable à partir d'environ 14 h 39, alors que la base de développement et le réseau répondaient. Cause probable : quota de calcul des branches secondaires de l'offre Neon, non vérifiable depuis le poste. Les résultats de tests du Sprint 6 dépendent de son rétablissement (voir SPRINT_STATUS.md) |
| A12 — règle de conservation appliquée à la main              | Moyenne                          | Aucune tâche planifiée n'existe : un administrateur doit appliquer la règle des 36 mois. À automatiser (tâche planifiée Railway) avant la production                                                                                                                                                                                                                                |
| A13 — photos produits par URL externe                        | Basse                            | Pas de stockage de fichiers : l'URL https est fournie par l'établissement. Le navigateur du client contacte un hôte tiers (`referrerPolicy="no-referrer"` sur la borne)                                                                                                                                                                                                             |
| A14 — plateforme de la borne                                 | Moyenne                          | Le mode kiosque (épinglage d'écran Android, navigateur en mode kiosque) dépend de l'appareil et n'est pas testé sur matériel (lié à A5)                                                                                                                                                                                                                                             |
| A15 — remboursements et fidélité                             | Basse                            | Pas de remboursement dans le produit : aucun débit de points n'est prévu pour ce cas. À traiter avec la future fonctionnalité de remboursement                                                                                                                                                                                                                                      |
| A16 — impression directe navigateur non validée sur matériel | Moyenne                          | WebUSB et Web Bluetooth BLE ne sont testés qu'en simulation. Les services BLE ne sont pas normalisés (cinq profils essayés). Une réassociation peut être nécessaire après rechargement. Bluetooth classique (SPP) et port 9100 restent réservés au connecteur Android. Pas de support iOS/Safari. Protocole de `MATERIEL-POS.md` §7 à dérouler (lié à A5)                           |

## Critères proposés pour un GO

- Toutes les commandes de vérification au vert, y compris les suites du Sprint 6 sur la branche Neon
  `test` rétablie.
- Aucune anomalie critique de sécurité : bornes publiques, jeton d'appareil, CRM et données
  personnelles, idempotence de la fidélité, soldes, isolation.
- A1, A2 et A5 : cause établie ou plan accepté ; validation matérielle planifiée.
