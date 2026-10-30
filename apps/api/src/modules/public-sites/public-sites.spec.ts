import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimulatedDomainVerifier, createDomainVerifier } from './domain-verifier';
import { LocalMediaStorage } from './media-storage';
import { loadSitesConfig } from './sites.config';
import { siteAvailability } from './sites.service';

describe('Sites — configuration (aucun domaine ni stockage supposé acquis)', () => {
  it('par défaut : stockage local, pas de sous-domaines, origine du frontend', () => {
    const c = loadSitesConfig({ WEB_ORIGIN: 'https://app.example.ml' }, 'development');
    expect(c).toMatchObject({
      publicOrigin: 'https://app.example.ml',
      baseDomain: null,
      subdomainsEnabled: false,
      storage: { driver: 'local' },
    });
  });

  it('sous-domaines annoncés seulement si explicitement activés ET domaine de base défini', () => {
    expect(
      loadSitesConfig({ SITES_SUBDOMAINS_ENABLED: 'true' }, 'development').subdomainsEnabled,
    ).toBe(false);
    expect(
      loadSitesConfig(
        { SITES_BASE_DOMAIN: 'OcallPark.com', SITES_SUBDOMAINS_ENABLED: 'true' },
        'development',
      ),
    ).toMatchObject({ baseDomain: 'ocallpark.com', subdomainsEnabled: true });
  });

  it('Cloudflare R2 (compatible S3) : point d’accès et région « auto »', () => {
    const c = loadSitesConfig(
      {
        MEDIA_STORAGE: 's3',
        S3_BUCKET: 'ocall-sites',
        S3_REGION: 'auto',
        S3_ENDPOINT: 'https://compte.r2.cloudflarestorage.com',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      },
      'production',
    );
    expect(c.storage).toMatchObject({
      driver: 's3',
      region: 'auto',
      endpoint: 'https://compte.r2.cloudflarestorage.com',
    });
  });

  it('refus : S3 incomplet, stockage local sans volume en production, simulé en production', () => {
    expect(() => loadSitesConfig({ MEDIA_STORAGE: 's3', S3_BUCKET: 'x' }, 'development')).toThrow(
      /S3_REGION/,
    );
    expect(() => loadSitesConfig({}, 'production')).toThrow(/MEDIA_STORAGE_DIR/);
    expect(() =>
      createDomainVerifier({ SITES_DOMAIN_VERIFIER: 'simulated' }, 'production'),
    ).toThrow();
  });
});

describe('Sites — stockage local des médias', () => {
  it('clés générées uniquement (aucun chemin), écriture sans écrasement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ocall-media-'));
    const storage = new LocalMediaStorage(dir);
    const key = '0b2f6c1e-1d2a-4b4e-9a7c-2f1d3c4b5a69.png';
    await storage.put(key, Buffer.from('img'));
    expect((await storage.get(key))?.toString()).toBe('img');
    await expect(storage.put(key, Buffer.from('autre'))).rejects.toThrow();
    for (const bad of ['../../etc/passwd', 'x.svg', '..\\a.png', 'a/b.png']) {
      await expect(storage.get(bad)).rejects.toThrow('Clé de média invalide.');
    }
    await storage.delete(key);
    expect(await readdir(dir)).toEqual([]);
    expect(await storage.get(key)).toBeNull();
  });
});

describe('Sites — disponibilité selon l’abonnement (contenu jamais supprimé)', () => {
  it('suspension ou expiration → hors ligne ; actif, non activé, en retard → en ligne', () => {
    expect(siteAvailability('ACTIVE', 'ACTIVE')).toBe(true);
    expect(siteAvailability('ACTIVE', 'NOT_ACTIVATED')).toBe(true);
    expect(siteAvailability('ACTIVE', 'PAST_DUE')).toBe(true);
    expect(siteAvailability('SUSPENDED', 'ACTIVE')).toBe(false);
    expect(siteAvailability('ACTIVE', 'EXPIRED')).toBe(false);
    expect(siteAvailability('ACTIVE', 'CANCELED')).toBe(false);
  });
});

describe('Sites — vérificateur de domaines simulé (séparé des vérifications réelles)', () => {
  it('TXT et HTTPS fournis par le test ; site différent refusé', async () => {
    const v = new SimulatedDomainVerifier();
    expect(await v.resolveTxt('_ocallpark-verify.www.resto.ml')).toEqual([]);
    v.setTxt('_ocallpark-verify.WWW.resto.ml', ['ocallpark-site-verification=abc']);
    expect(await v.resolveTxt('_ocallpark-verify.www.resto.ml')).toEqual([
      'ocallpark-site-verification=abc',
    ]);
    expect(await v.checkHttps('www.resto.ml', 'site-1')).toMatchObject({ ok: false });
    v.setHttps('www.resto.ml', 'site-2');
    expect(await v.checkHttps('www.resto.ml', 'site-1')).toEqual({
      ok: false,
      error: 'Le domaine ne sert pas ce site.',
    });
    v.setHttps('www.resto.ml', 'site-1');
    expect(await v.checkHttps('www.resto.ml', 'site-1')).toEqual({ ok: true });
  });
});
