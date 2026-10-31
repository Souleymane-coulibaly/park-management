import { randomBytes } from 'node:crypto';
import { type AiConfig, loadAiConfig } from '../modules/ai/ai.config';
import { type SitesConfig, loadSitesConfig } from '../modules/public-sites/sites.config';
import {
  type OnlinePaymentsConfig,
  loadOnlinePaymentsConfig,
} from '../modules/online-payments/online-payments.config';

/**
 * Configuration typée, lue une seule fois depuis l'environnement.
 * Toute valeur manquante ou invalide arrête le démarrage plutôt que de dégrader la sécurité.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  webOrigins: string[];
  sessionTtlHours: number;
  cookieSecure: boolean;
  loginThrottleLimit: number;
  loginThrottleTtlSeconds: number;
  accountLockThreshold: number;
  accountLockMinutes: number;
  passwordResetTtlMinutes: number;
  swaggerEnabled: boolean;
  /** Nombre de proxys de confiance devant l'API (Railway, proxy Next.js) pour déterminer l'IP réelle. */
  trustProxyHops: number;
  /** Demandes de commande publiques (QR code) acceptées par IP sur 10 minutes. */
  publicOrderThrottleLimit: number;
  /** Demandes de démonstration du site public acceptées par IP sur 10 minutes (Sprint 12A). */
  publicLeadThrottleLimit: number;
  /** Paiement en ligne des factures SaaS (Sprint 12A). */
  onlinePayments: OnlinePaymentsConfig;
  /** Intervalle des battements des flux temps réel (et de revérification de la session), en ms. */
  realtimeHeartbeatMs: number;
  /** Fournisseur IA, modèles et garde-fous des appels réels (Sprint 8). */
  ai: AiConfig;
  /** Sites vitrines : adresses publiques, domaines, stockage des médias (Sprint 10). */
  sites: SitesConfig;
  /**
   * Clé de chiffrement des secrets de double authentification (AES-256-GCM, 32 octets en base64).
   * Obligatoire en production ; absente en développement, l'enrôlement MFA est indisponible.
   */
  mfaEncryptionKey: Buffer | null;
  /**
   * Clé de signature des liens temporaires de téléchargement (HMAC-SHA256, 32 octets au moins en
   * base64). Obligatoire en production ; aléatoire par démarrage ailleurs (liens invalidés au
   * redémarrage).
   */
  storageSigningKey: Buffer;
  /** Format des journaux : json (production, par défaut) ou texte lisible (développement). */
  logFormat: 'json' | 'text';
}

function storageSigningKey(env: NodeJS.ProcessEnv, nodeEnv: string): Buffer {
  const raw = env.STORAGE_SIGNING_SECRET?.trim();
  if (!raw) {
    if (nodeEnv === 'production') {
      throw new Error(
        'STORAGE_SIGNING_SECRET est obligatoire en production (32 octets en base64).',
      );
    }
    return randomBytes(32);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length < 32) {
    throw new Error('STORAGE_SIGNING_SECRET invalide : 32 octets au moins, en base64.');
  }
  return key;
}

function mfaKey(env: NodeJS.ProcessEnv, nodeEnv: string): Buffer | null {
  const raw = env.MFA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (nodeEnv === 'production') {
      throw new Error('MFA_ENCRYPTION_KEY est obligatoire en production (32 octets en base64).');
    }
    return null;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32)
    throw new Error('MFA_ENCRYPTION_KEY invalide : 32 octets en base64 attendus.');
  return key;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export const SESSION_COOKIE = 'ocp_session';

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Variable d'environnement ${key} invalide : entier positif attendu.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL est obligatoire.');
  const nodeEnv =
    env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development';
  const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : nodeEnv === 'production';
  if (nodeEnv === 'production' && !cookieSecure) {
    throw new Error('COOKIE_SECURE doit valoir true en production.');
  }
  return {
    nodeEnv,
    // Railway injecte PORT ; API_PORT sert en local.
    port: int(env, 'PORT', int(env, 'API_PORT', 4000)),
    webOrigins: (env.WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    sessionTtlHours: int(env, 'SESSION_TTL_HOURS', 12),
    cookieSecure,
    loginThrottleLimit: int(env, 'LOGIN_THROTTLE_LIMIT', 10),
    loginThrottleTtlSeconds: int(env, 'LOGIN_THROTTLE_TTL_SECONDS', 60),
    accountLockThreshold: int(env, 'ACCOUNT_LOCK_THRESHOLD', 5),
    accountLockMinutes: int(env, 'ACCOUNT_LOCK_MINUTES', 15),
    passwordResetTtlMinutes: int(env, 'PASSWORD_RESET_TTL_MINUTES', 30),
    swaggerEnabled: env.SWAGGER_ENABLED ? env.SWAGGER_ENABLED === 'true' : nodeEnv !== 'production',
    trustProxyHops: int(env, 'TRUST_PROXY_HOPS', 1),
    publicOrderThrottleLimit: int(env, 'PUBLIC_ORDER_THROTTLE_LIMIT', 30),
    publicLeadThrottleLimit: int(env, 'PUBLIC_LEAD_THROTTLE_LIMIT', 5),
    realtimeHeartbeatMs: int(env, 'REALTIME_HEARTBEAT_MS', 25_000),
    ai: loadAiConfig(env, nodeEnv),
    onlinePayments: loadOnlinePaymentsConfig(env, nodeEnv),
    sites: loadSitesConfig(env, nodeEnv),
    mfaEncryptionKey: mfaKey(env, nodeEnv),
    storageSigningKey: storageSigningKey(env, nodeEnv),
    logFormat:
      env.LOG_FORMAT === 'text' || env.LOG_FORMAT === 'json'
        ? env.LOG_FORMAT
        : nodeEnv === 'production'
          ? 'json'
          : 'text',
  };
}
