import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
// Sites vitrines : vérifications DNS / HTTPS SIMULÉES (pilotées par les tests) et médias stockés
// dans un répertoire temporaire. Aucune requête DNS ou HTTPS réelle, aucun stockage d'objets.
process.env.SITES_DOMAIN_VERIFIER = 'simulated';
process.env.MEDIA_STORAGE = 'local';
process.env.MEDIA_STORAGE_DIR = join(tmpdir(), 'ocall-test-media');
process.env.SITES_BASE_DOMAIN = 'ocall-test.example.com';
process.env.SITES_SUBDOMAINS_ENABLED = 'true';
process.env.SITES_PUBLIC_ORIGIN = 'https://app.ocall-test.example.com';
delete process.env.SITES_REVALIDATE_URL;
