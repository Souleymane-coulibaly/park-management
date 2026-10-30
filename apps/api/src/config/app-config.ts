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
  /** Intervalle des battements des flux temps réel (et de revérification de la session), en ms. */
  realtimeHeartbeatMs: number;
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
    realtimeHeartbeatMs: int(env, 'REALTIME_HEARTBEAT_MS', 25_000),
  };
}
