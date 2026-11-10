import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';

// Les tests d'intégration utilisent la base de développement de apps/api/.env.
config();
// Environnement d'origine gardé pour la garde des bases de test (production refusée) avant son écrasement.
process.env.OCALL_ORIGINAL_NODE_ENV = process.env.NODE_ENV ?? '';
process.env.NODE_ENV = 'test';
process.env.SWAGGER_ENABLED = 'false';
// Limites relâchées : les tests créent de nombreux comptes depuis la même IP.
process.env.LOGIN_THROTTLE_LIMIT = '10000';
process.env.ACCOUNT_LOCK_THRESHOLD = '3';
// Les demandes de commande QR des tests viennent toutes de la même IP (limite testée à part).
process.env.PUBLIC_ORDER_THROTTLE_LIMIT = '10000';
process.env.PUBLIC_LEAD_THROTTLE_LIMIT = '10000';
// Paiement en ligne : prestataire simulé uniquement (aucun appel réel).
process.env.ONLINE_PAYMENT_PROVIDER = 'simulated';
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
// E-mails : fournisseur SIMULÉ (messages gardés en mémoire), aucun envoi réel ni clé Resend.
process.env.MAIL_PROVIDER = 'simulated';
delete process.env.RESEND_API_KEY;
process.env.PARTNER_ALERT_EMAILS = 'alertes-partenaires@test.ocallpark.local';
process.env.PUBLIC_WEB_URL = 'https://app.ocall-test.example.com';
// Double authentification des comptes internes : clé de chiffrement éphémère, propre à l'exécution.
process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
