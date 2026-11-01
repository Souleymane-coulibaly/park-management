/** Configuration d'Ocall School : désactivé par défaut, jamais sur la base Ocall Suite. */
export interface SchoolConfig {
  enabled: boolean;
  databaseUrl: string | null;
  /** Clé AES-256 des données sensibles des élèves ; obligatoire en production. */
  dataKey: Buffer | null;
}

const identity = (url: string) => {
  const u = new URL(url);
  return `${u.host.replace('-pooler.', '.')}/${u.pathname.slice(1)}`;
};

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
  if (!enabled) return { enabled, databaseUrl: null, dataKey: null };
  if (!databaseUrl) {
    throw new Error('SCHOOL_ENABLED=true exige SCHOOL_DATABASE_URL.');
  }
  if (env.DATABASE_URL && identity(env.DATABASE_URL) === identity(databaseUrl)) {
    throw new Error('SCHOOL_DATABASE_URL doit désigner une base distincte de DATABASE_URL.');
  }
  return { enabled, databaseUrl, dataKey: loadDataKey(env) };
}
