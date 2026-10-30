/**
 * Configuration des sites vitrines et du stockage des médias (Sprint 10), lue une seule fois.
 *
 * Rien n'est supposé acquis : sans `SITES_BASE_DOMAIN`, seules les adresses `/e/<slug>` existent ;
 * les sous-domaines ne sont annoncés que si `SITES_SUBDOMAINS_ENABLED=true` (DNS wildcard et
 * certificat effectivement configurés, voir docs/SITES-VITRINES.md).
 */
export interface SitesConfig {
  /** Origine des pages `/e/<slug>` (frontend), ex. https://app.ocallpark.com. */
  publicOrigin: string;
  /** Domaine des sous-domaines `<slug>.<domaine>`, ex. ocallpark.com ; null = non configuré. */
  baseDomain: string | null;
  subdomainsEnabled: boolean;
  /** Cible CNAME indiquée aux clients pour leur domaine personnalisé (fournie par l'hébergeur). */
  customDomainTarget: string | null;
  /** Revalidation des pages publiques du frontend après publication (facultative). */
  revalidateUrl: string | null;
  revalidateSecret: string | null;
  storage:
    | { driver: 'local'; directory: string }
    | {
        driver: 's3';
        bucket: string;
        region: string;
        endpoint: string | null;
        accessKeyId: string;
        secretAccessKey: string;
        forcePathStyle: boolean;
      };
}

export function loadSitesConfig(env: NodeJS.ProcessEnv, nodeEnv: string): SitesConfig {
  const driver = env.MEDIA_STORAGE?.trim() || 'local';
  if (driver !== 'local' && driver !== 's3') {
    throw new Error('MEDIA_STORAGE invalide : local ou s3.');
  }
  let storage: SitesConfig['storage'];
  if (driver === 's3') {
    const required = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    const missing = required.filter((k) => !env[k]);
    if (missing.length)
      throw new Error(`MEDIA_STORAGE=s3 : variables manquantes ${missing.join(', ')}.`);
    storage = {
      driver: 's3',
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION!,
      endpoint: env.S3_ENDPOINT || null,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    };
  } else {
    if (nodeEnv === 'production' && !env.MEDIA_STORAGE_DIR) {
      throw new Error(
        'MEDIA_STORAGE=local en production exige MEDIA_STORAGE_DIR (volume persistant) ; préférer s3.',
      );
    }
    storage = { driver: 'local', directory: env.MEDIA_STORAGE_DIR || '.media' };
  }
  const baseDomain = env.SITES_BASE_DOMAIN?.trim().toLowerCase() || null;
  return {
    publicOrigin: (
      env.SITES_PUBLIC_ORIGIN ||
      env.WEB_ORIGIN?.split(',')[0] ||
      'http://localhost:3000'
    )
      .trim()
      .replace(/\/$/, ''),
    baseDomain,
    subdomainsEnabled: env.SITES_SUBDOMAINS_ENABLED === 'true' && baseDomain !== null,
    customDomainTarget: env.SITES_CUSTOM_DOMAIN_TARGET?.trim() || null,
    revalidateUrl: env.SITES_REVALIDATE_URL?.trim() || null,
    revalidateSecret: env.SITES_REVALIDATE_SECRET?.trim() || null,
    storage,
  };
}
