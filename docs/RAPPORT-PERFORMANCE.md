# Rapport de performance — Sprint 11B

**Portée honnête** : aucun test de charge n'a pu être exécuté (base Neon `test` inaccessible, A11 ;
aucune base de production). Ce rapport est un **audit statique** complété des mesures réellement
disponibles. Il ne vaut pas preuve de tenue en charge.

## 1. Mesures disponibles

| Mesure                                      | Valeur                                                                         | Source                         |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| JavaScript partagé par toutes les pages     | 103 kB (premier chargement)                                                    | `next build`                   |
| Page la plus lourde                         | contrôle des entrées : 197 kB (lecteur QR caméra)                              | `next build`                   |
| Pages d'administration du Sprint 11         | 111 à 142 kB au premier chargement                                             | `next build`                   |
| Latence base de développement (`us-east-2`) | ≈ 300 ms par aller-retour depuis l'Europe / l'Afrique de l'Ouest               | constat des sprints précédents |
| Suites d'intégration (PostgreSQL embarqué)  | toutes vertes ; durées non représentatives (base locale, pool d'une connexion) | Jest                           |

## 2. Audit par composant

| Composant                  | Constat                                                                                                                                                                       | Risque    | Action                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| PostgreSQL / région        | Le temps d'une requête est dominé par la distance à la base, pas par le calcul                                                                                                | **Élevé** | Base de production et API dans la même région européenne (validée) |
| Pool Prisma                | URL _pooled_ (PgBouncer) à l'exécution ; une requête hors transaction pendant une transaction ouverte consomme deux connexions (trouvée et corrigée : commande vocale)        | Moyen     | Vérifier `connection_limit` (10 par instance) sur Neon `test`      |
| Transactions               | Verrous ciblés (`FOR UPDATE` organisation, facture, quotas) ; borne serveur des transactions inactives à 60 s                                                                 | Faible    | Observer sur Neon                                                  |
| Index                      | Nouveaux index : fichiers (organisation + suppression, conservation), support (organisation + date, statut + dernier message), factures ; IA par organisation + date existant | Faible    | Relever les plans d'exécution (`EXPLAIN`) sur données de pilote    |
| Rapports plateforme        | Consommation IA et stockage : faisaient plusieurs requêtes **par organisation** → **corrigé** : nombre de requêtes constant (agrégations groupées)                            | Résolu    | —                                                                  |
| Tableau de bord commercial | Agrégations groupées, nombre de requêtes constant                                                                                                                             | Faible    | —                                                                  |
| POS (vente, encaissement)  | Une transaction par vente ; verrous sur la session de caisse                                                                                                                  | Moyen     | Test de charge : 5 caisses simultanées par site                    |
| KDS (cuisine)              | Flux temps réel (SSE), battement 25 s, revérification de session                                                                                                              | Moyen     | Test : 3 écrans par site, 200 commandes / heure                    |
| Contrôle d'accès           | Scan = une transaction (refus du double passage) ; page la plus lourde côté navigateur                                                                                        | Moyen     | Test : 2 postes, pointe d'ouverture d'un parc                      |
| Sites vitrines             | Données publiées mises en cache ; images optimisées par Next.js (`sharp`)                                                                                                     | Faible    | Mesurer en charge (A34)                                            |
| Fichiers privés            | Fichier lu entièrement en mémoire avant envoi (5 Mo au plus)                                                                                                                  | Faible    | Passer en flux si les tailles augmentent                           |

## 3. Plan de test de charge (à exécuter sur Neon `test`, avec accord)

- Outil : k6 (binaire autonome, **aucune dépendance ajoutée au dépôt**), exécuté depuis un poste en
  Europe, contre une API déployée dans la région cible.
- Scénarios et seuils proposés :

| Scénario                                 | Charge                     | Seuil (p95)    |
| ---------------------------------------- | -------------------------- | -------------- |
| Connexion                                | 20 connexions / minute     | < 800 ms       |
| Vente + encaissement                     | 5 caisses × 1 vente / 30 s | < 1 s          |
| Scan de billets                          | 2 postes × 1 scan / 3 s    | < 500 ms       |
| Écran cuisine (SSE)                      | 3 écrans connectés 30 min  | aucune coupure |
| Tableau de bord commercial (Super Admin) | 2 consultations / minute   | < 2 s          |
| Page publique d'un site                  | 20 visites / seconde       | < 300 ms       |

- Résultats à consigner dans le dossier CP-10 avec la version testée.
