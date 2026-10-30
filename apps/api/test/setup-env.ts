import { config } from 'dotenv';

// Les tests d'intégration utilisent la base de développement de apps/api/.env.
config();
process.env.NODE_ENV = 'test';
process.env.SWAGGER_ENABLED = 'false';
// Limites relâchées : les tests créent de nombreux comptes depuis la même IP.
process.env.LOGIN_THROTTLE_LIMIT = '10000';
process.env.ACCOUNT_LOCK_THRESHOLD = '3';
// Les demandes de commande QR des tests viennent toutes de la même IP (limite testée à part).
process.env.PUBLIC_ORDER_THROTTLE_LIMIT = '10000';
// Battement rapide des flux temps réel : une session révoquée ferme le flux en ~1 s.
process.env.REALTIME_HEARTBEAT_MS = '1000';
// IA : fournisseur simulé, déterministe, sans réseau ni coût. Aucun appel réel dans les tests.
process.env.AI_PROVIDER = 'simulated';
delete process.env.AI_REAL_CALLS_ENABLED;
