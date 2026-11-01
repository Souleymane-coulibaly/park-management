/** Configuration d'Ocall School : désactivé par défaut, jamais sur la base Ocall Suite. */
export interface SchoolConfig {
  enabled: boolean;
  databaseUrl: string | null;
}

const identity = (url: string) => {
  const u = new URL(url);
  return `${u.host.replace('-pooler.', '.')}/${u.pathname.slice(1)}`;
};

export function loadSchoolConfig(env: NodeJS.ProcessEnv): SchoolConfig {
  const enabled = env.SCHOOL_ENABLED === 'true';
  const databaseUrl = env.SCHOOL_DATABASE_URL?.trim() || null;
  if (!enabled) return { enabled, databaseUrl: null };
  if (!databaseUrl) {
    throw new Error('SCHOOL_ENABLED=true exige SCHOOL_DATABASE_URL.');
  }
  if (env.DATABASE_URL && identity(env.DATABASE_URL) === identity(databaseUrl)) {
    throw new Error('SCHOOL_DATABASE_URL doit désigner une base distincte de DATABASE_URL.');
  }
  return { enabled, databaseUrl };
}
