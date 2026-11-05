import { databaseIdentity } from '@ocall/database';

/** Configuration d'Ocall School : désactivé par défaut, jamais sur la base Ocall Suite. */
export interface SchoolConfig {
  enabled: boolean;
  databaseUrl: string | null;
  /** Clé AES-256 des données sensibles des élèves ; obligatoire en production. */
  dataKey: Buffer | null;
  /** Adresse publique du portail parents (liens d'invitation envoyés par SMS) ; facultative. */
  portalBaseUrl: string | null;
  sms: SchoolSmsConfig;
}

/**
 * Fournisseur SMS (Sprint 6). Seul le fournisseur simulé est livré : aucun SMS réel n'est envoyé. Un
 * fournisseur réel s'ajoute par un adaptateur ; sa clé ne vient que de l'environnement.
 */
export interface SchoolSmsConfig {
  provider: 'simulated';
  apiKey: string | null;
  sender: string | null;
}

const SMS_PROVIDERS = ['simulated'] as const;

function loadSmsConfig(env: NodeJS.ProcessEnv): SchoolSmsConfig {
  const provider = (env.SCHOOL_SMS_PROVIDER?.trim() || 'simulated') as SchoolSmsConfig['provider'];
  if (!SMS_PROVIDERS.includes(provider)) {
    throw new Error(`SCHOOL_SMS_PROVIDER inconnu : ${provider} (disponible : simulated).`);
  }
  return {
    provider,
    apiKey: env.SCHOOL_SMS_API_KEY?.trim() || null,
    sender: env.SCHOOL_SMS_SENDER?.trim() || null,
  };
}

function loadPortalBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.SCHOOL_PORTAL_BASE_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' && env.NODE_ENV === 'production') {
    throw new Error('SCHOOL_PORTAL_BASE_URL doit être en https en production.');
  }
  return url.origin;
}

function loadDataKey(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.SCHOOL_DATA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SCHOOL_ENABLED=true exige SCHOOL_DATA_ENCRYPTION_KEY en production.');
    }
    return null;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SCHOOL_DATA_ENCRYPTION_KEY invalide : 32 octets en base64.');
  }
  return key;
}

export function loadSchoolConfig(env: NodeJS.ProcessEnv): SchoolConfig {
  const enabled = env.SCHOOL_ENABLED === 'true';
  const databaseUrl = env.SCHOOL_DATABASE_URL?.trim() || null;
  if (!enabled) {
    return {
      enabled,
      databaseUrl: null,
      dataKey: null,
      portalBaseUrl: null,
      sms: loadSmsConfig({}),
    };
  }
  if (!databaseUrl) {
    throw new Error('SCHOOL_ENABLED=true exige SCHOOL_DATABASE_URL.');
  }
  if (env.DATABASE_URL && databaseIdentity(env.DATABASE_URL) === databaseIdentity(databaseUrl)) {
    throw new Error('SCHOOL_DATABASE_URL doit désigner une base distincte de DATABASE_URL.');
  }
  return {
    enabled,
    databaseUrl,
    dataKey: loadDataKey(env),
    portalBaseUrl: loadPortalBaseUrl(env),
    sms: loadSmsConfig(env),
  };
}
