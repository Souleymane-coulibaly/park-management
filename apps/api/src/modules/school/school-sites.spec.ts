import sharp from 'sharp';
import { loadSchoolSitesConfig } from './school.config';
import { SubdomainHostResolver, normalizeHost, schoolSiteCanonicalUrl } from './school-site-host';
import { SCHOOL_SITE_IMAGE_FULL, processSchoolSiteImage } from './school-site-image';

/** Tests unitaires des sites vitrines School : sans base, sans réseau. */

/** Photo JPEG portant des métadonnées EXIF, dont une position GPS (IFD3) et l'appareil. */
async function photoWithGps(width = 2400, height = 1600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3a7' } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Make: 'TelephoneTest', Model: 'Modele-123', Copyright: 'Famille Ba' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '14/1 41/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '17/1 26/1 0/1',
        },
      },
    })
    .toBuffer();
}

describe('Images des sites : réencodage et suppression des métadonnées', () => {
  it('la photo d’origine porte bien des métadonnées EXIF (contrôle du test)', async () => {
    const original = await photoWithGps();
    const meta = await sharp(original).metadata();
    expect(meta.exif).toBeDefined();
    expect(original.toString('latin1')).toContain('TelephoneTest');
  });

  it('réencodée en WebP : ni EXIF, ni GPS, ni appareil ; deux tailles bornées', async () => {
    const r = await processSchoolSiteImage(await photoWithGps());
    if ('code' in r) throw new Error(r.message);
    for (const v of [r.full, r.thumb]) {
      const meta = await sharp(v.body).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(v.body.toString('latin1')).not.toContain('TelephoneTest');
      expect(v.body.toString('latin1')).not.toContain('Famille Ba');
    }
    expect([r.full.width, r.full.height]).toEqual([SCHOOL_SITE_IMAGE_FULL, 1067]);
    expect(Math.max(r.thumb.width, r.thumb.height)).toBe(480);
  });

  it('type réel lu dans le contenu : SVG, GIF, faux JPEG refusés ; trop petit refusé', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(await processSchoolSiteImage(svg)).toMatchObject({ code: 'MEDIA_TYPE_REFUSED' });
    const gif = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#fff' },
    })
      .gif()
      .toBuffer();
    expect(await processSchoolSiteImage(gif)).toMatchObject({ code: 'MEDIA_TYPE_REFUSED' });
    // En-tête JPEG valide suivi de données illisibles : refusé, jamais stocké.
    const fake = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x01, 0x00]),
      Buffer.alloc(200, 0x41),
    ]);
    expect(await processSchoolSiteImage(fake)).toMatchObject({ code: 'MEDIA_TYPE_REFUSED' });
    const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect(await processSchoolSiteImage(tiny)).toMatchObject({ code: 'MEDIA_DIMENSIONS' });
  });

  it('fichier de plus de 5 Mo refusé avant tout décodage', async () => {
    expect(await processSchoolSiteImage(Buffer.alloc(5 * 1024 * 1024 + 1))).toMatchObject({
      code: 'MEDIA_TOO_LARGE',
    });
  });
});

describe('Sous-domaines et configuration', () => {
  const config = loadSchoolSitesConfig({
    SCHOOL_SITES_BASE_DOMAIN: 'ocall.school',
    SCHOOL_SITES_SUBDOMAINS_ENABLED: 'true',
  } as NodeJS.ProcessEnv);

  it('configuration par défaut : sous-domaines désactivés, maintien de 30 jours', () => {
    expect(loadSchoolSitesConfig({} as NodeJS.ProcessEnv)).toEqual({
      baseDomain: null,
      subdomainsEnabled: false,
      publicOrigin: 'http://localhost:3000',
      graceDays: 30,
    });
    expect(() =>
      loadSchoolSitesConfig({ SCHOOL_SITES_GRACE_DAYS: '-1' } as NodeJS.ProcessEnv),
    ).toThrow(/SCHOOL_SITES_GRACE_DAYS/);
    expect(() =>
      loadSchoolSitesConfig({ SCHOOL_SITES_BASE_DOMAIN: 'https://x' } as NodeJS.ProcessEnv),
    ).toThrow(/SCHOOL_SITES_BASE_DOMAIN/);
  });

  it('résolution stricte : un seul niveau, slug valide, noms réservés exclus, autre domaine ignoré', async () => {
    const r = new SubdomainHostResolver(config);
    expect(await r.slugForHost('medersa-annour.ocall.school')).toBe('medersa-annour');
    expect(await r.slugForHost('MEDERSA-ANNOUR.OCALL.SCHOOL:443')).toBe('medersa-annour');
    expect(await r.slugForHost('www.ocall.school')).toBeNull();
    expect(await r.slugForHost('api.ocall.school')).toBeNull();
    expect(await r.slugForHost('a.b.ocall.school')).toBeNull();
    expect(await r.slugForHost('ocall.school')).toBeNull();
    expect(await r.slugForHost('medersa.ocall.school.evil.io')).toBeNull();
    expect(await r.slugForHost('medersa.ocallpark.com')).toBeNull();
    expect(normalizeHost('bad host')).toBeNull();
  });

  it('sous-domaines non activés : aucune résolution, adresse canonique /s/<slug>', async () => {
    const off = loadSchoolSitesConfig({
      SCHOOL_SITES_BASE_DOMAIN: 'ocall.school',
    } as NodeJS.ProcessEnv);
    expect(await new SubdomainHostResolver(off).slugForHost('medersa.ocall.school')).toBeNull();
    expect(schoolSiteCanonicalUrl(off, 'medersa')).toBe('http://localhost:3000/s/medersa');
    expect(schoolSiteCanonicalUrl(config, 'medersa')).toBe('https://medersa.ocall.school');
  });
});
