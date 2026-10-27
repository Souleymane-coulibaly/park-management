import { config } from 'dotenv';

// Les tests d'intégration utilisent la base de développement de apps/api/.env.
config();
process.env.NODE_ENV = 'test';
process.env.SWAGGER_ENABLED = 'false';
// Limites relâchées : les tests créent de nombreux comptes depuis la même IP.
process.env.LOGIN_THROTTLE_LIMIT = '10000';
process.env.ACCOUNT_LOCK_THRESHOLD = '3';
