import {
  SITE_THEME_CATALOG,
  canonicalSiteUrl,
  contentMediaIds,
  isAccessibleAccentColor,
  withContentDefaults,
  contrastRatio,
  emptySiteContent,
  hasPermission,
  inspectImage,
  isAccessibleBrandColor,
  navigationFor,
  normalizeCustomDomain,
  sectionsFor,
  siteSlugError,
  slugFromHost,
  slugify,
  validateSiteContent,
} from './index';

describe('Sites — adresses publiques', () => {
  it('format, longueur, noms réservés', () => {
    expect(siteSlugError('maquis-le-baobab')).toBeNull();
    expect(siteSlugError('ab')).toBe('SLUG_LENGTH');
    expect(siteSlugError('-maquis')).toBe('SLUG_FORMAT');
    expect(siteSlugError('maquis--x')).toBe('SLUG_FORMAT');
    expect(siteSlugError('Maquis')).toBe('SLUG_FORMAT');
    for (const reserved of ['www', 'admin', 'api', 'app', 'mail', 'ocallpark']) {
      expect(siteSlugError(reserved)).toBe('SLUG_RESERVED');
    }
  });

  it('proposition à partir du nom', () => {
    expect(slugify('Maquis Le Baobab — Bamako')).toBe('maquis-le-baobab-bamako');
    expect(slugify('Parc Aquatique « Été »')).toBe('parc-aquatique-ete');
  });

  it('sous-domaine → slug ; hôtes réservés ou imbriqués ignorés', () => {
    expect(slugFromHost('maquis-baobab.ocallpark.com', 'ocallpark.com')).toBe('maquis-baobab');
    expect(slugFromHost('MAQUIS-BAOBAB.ocallpark.com:443', 'ocallpark.com')).toBe('maquis-baobab');
    expect(slugFromHost('www.ocallpark.com', 'ocallpark.com')).toBeNull();
    expect(slugFromHost('a.b.ocallpark.com', 'ocallpark.com')).toBeNull();
    expect(slugFromHost('evil-ocallpark.com', 'ocallpark.com')).toBeNull();
    expect(slugFromHost('maquis.ocallpark.com', null)).toBeNull();
  });

  it('adresse canonique : domaine actif > sous-domaine > /e/slug', () => {
    const base = {
      slug: 'maquis',
      sitesBaseDomain: 'ocallpark.com',
      publicOrigin: 'https://app.ocallpark.com/',
    };
    expect(
      canonicalSiteUrl({ ...base, activeDomain: 'www.maquis.ml', subdomainsEnabled: true }),
    ).toBe('https://www.maquis.ml');
    expect(canonicalSiteUrl({ ...base, activeDomain: null, subdomainsEnabled: true })).toBe(
      'https://maquis.ocallpark.com',
    );
    expect(canonicalSiteUrl({ ...base, activeDomain: null, subdomainsEnabled: false })).toBe(
      'https://app.ocallpark.com/e/maquis',
    );
  });
});

describe('Sites — domaines personnalisés', () => {
  it('normalise ; refuse IP, domaine local, domaine de la plateforme, format invalide', () => {
    expect(normalizeCustomDomain(' https://WWW.MonResto.ml/menu ')).toEqual({
      hostname: 'www.monresto.ml',
    });
    expect(normalizeCustomDomain('xn--caf-dma.ml')).toEqual({ hostname: 'xn--caf-dma.ml' });
    expect(normalizeCustomDomain('192.168.1.10')).toEqual({ error: 'DOMAIN_IP' });
    expect(normalizeCustomDomain('monresto.localhost')).toEqual({ error: 'DOMAIN_LOCAL' });
    expect(normalizeCustomDomain('maquis.ocallpark.com', ['ocallpark.com'])).toEqual({
      error: 'DOMAIN_PLATFORM',
    });
    expect(normalizeCustomDomain('mon_resto.ml')).toEqual({ error: 'DOMAIN_FORMAT' });
    expect(normalizeCustomDomain('monresto')).toEqual({ error: 'DOMAIN_FORMAT' });
  });
});

describe('Sites — thèmes, sections, contraste', () => {
  it('sections selon le métier', () => {
    expect(sectionsFor('RESTAURANT')).toContain('menu');
    expect(sectionsFor('RESTAURANT')).not.toContain('prices');
    expect(sectionsFor('PARK')).toEqual(
      expect.arrayContaining(['attractions', 'prices', 'safety']),
    );
    expect(sectionsFor('PARK')).not.toContain('menu');
    expect(sectionsFor('PARK_RESTAURANT')).toEqual(expect.arrayContaining(['menu', 'prices']));
  });

  it('couleur principale lisible avec du texte blanc (WCAG AA)', () => {
    expect(isAccessibleBrandColor('#176B53')).toBe(true);
    expect(isAccessibleBrandColor('#D99B38')).toBe(false); // or savane : trop clair
    expect(isAccessibleBrandColor('red')).toBe(false);
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
  });
});

describe('Sites — validation du contenu', () => {
  const valid = () => emptySiteContent('Maquis Le Baobab', 'RESTAURANT');

  it('contenu par défaut valide ; texte avec balises conservé comme texte', () => {
    const c = { ...valid(), description: '<script>alert(1)</script> Grillades' };
    const r = validateSiteContent(c, 'RESTAURANT');
    expect('content' in r && r.content.description).toBe('<script>alert(1)</script> Grillades');
  });

  it('refuse champ inconnu, lien non https, horaires invalides, section d’un autre métier', () => {
    const errors = (patch: Record<string, unknown>) => {
      const r = validateSiteContent({ ...valid(), ...patch }, 'RESTAURANT');
      return 'errors' in r ? r.errors : [];
    };
    expect(errors({ costPrice: 1 })).toEqual(['Champ inconnu : costPrice.']);
    expect(
      errors({
        socials: {
          facebook: 'javascript:alert(1)',
          instagram: '',
          tiktok: '',
          website: 'http://x.ml',
        },
      }),
    ).toHaveLength(2);
    expect(
      errors({ hours: valid().hours.map((h) => ({ ...h, opens: '25:00' })) }).length,
    ).toBeGreaterThan(0);
    expect(errors({ sections: { order: sectionsFor('PARK'), hidden: [] } })).toEqual([
      'sections : ordre invalide pour ce type d’établissement.',
    ]);
    expect(errors({ publicName: '  ' })).toEqual(['publicName : obligatoire.']);
    expect(errors({ menu: [{ productId: 'pas-un-uuid', displayPrice: 100 }] })).toHaveLength(1);
  });
});

describe('Sites — images (type et dimensions lus dans le contenu)', () => {
  it('PNG, JPEG, WebP ; autre format refusé', () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    png.set([0, 0, 0x04, 0x00, 0, 0, 0x03, 0x00], 16);
    expect(inspectImage(png)).toEqual({ mime: 'image/png', width: 1024, height: 768 });

    // JPEG : SOI, segment APP0, puis SOF0 (hauteur 600, largeur 800).
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58,
      0x03, 0x20, 0x03, 0x01, 0x22, 0x00,
    ]);
    expect(inspectImage(jpeg)).toEqual({ mime: 'image/jpeg', width: 800, height: 600 });

    const webp = new Uint8Array(32);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([0x1f, 0x03, 0x00, 0x57, 0x02, 0x00], 24); // 800 × 600
    expect(inspectImage(webp)).toEqual({ mime: 'image/webp', width: 800, height: 600 });

    expect(inspectImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(inspectImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull(); // GIF
  });
});

describe('Sites — permissions', () => {
  it('site : propriétaire et administrateur ; domaine : propriétaire seul', () => {
    expect(hasPermission('OWNER', 'site.manage')).toBe(true);
    expect(hasPermission('ADMIN', 'site.publish')).toBe(true);
    expect(hasPermission('ADMIN', 'site.domain')).toBe(false);
    expect(hasPermission('OWNER', 'site.domain')).toBe(true);
    for (const role of ['SUPERVISOR', 'CASHIER', 'KITCHEN', 'GATE_AGENT'] as const) {
      expect(hasPermission(role, 'site.manage')).toBe(false);
    }
    expect(navigationFor('PARK', 'OWNER').map((m) => m.key)).toContain('site');
  });
});

describe('Sites — thème Ocall Aqua Premium (compatibilité et nouveaux champs)', () => {
  const base = () => emptySiteContent('Parc Aqua', 'PARK_RESTAURANT');

  it('un contenu enregistré avant le thème premium reste valide (champs absents → valeurs par défaut)', () => {
    const legacy = { ...base() } as Record<string, unknown>;
    delete legacy.heroHighlights;
    delete legacy.keyFacts;
    delete legacy.restaurant;
    legacy.attractions = [{ name: 'Toboggan', description: 'Géant' }];
    const r = validateSiteContent(legacy, 'PARK_RESTAURANT');
    expect('content' in r && r.content).toMatchObject({
      heroHighlights: [],
      keyFacts: [],
      restaurant: { description: '', mediaIds: [] },
      attractions: [{ name: 'Toboggan', description: 'Géant', mediaId: null }],
    });
    expect(withContentDefaults(legacy as never).restaurant).toEqual({
      description: '',
      mediaIds: [],
    });
  });

  it('étiquettes, chiffres clés, photos d’attractions et du restaurant validés', () => {
    const photo = '0b2f6c1e-1d2a-4b4e-9a7c-2f1d3c4b5a69';
    const ok = validateSiteContent(
      {
        ...base(),
        heroHighlights: ['Familles', ' ', 'Anniversaires'],
        keyFacts: [
          { label: 'Entrée', value: '3 000 FCFA' },
          { label: '', value: '' },
        ],
        attractions: [{ name: 'Toboggan', description: '', mediaId: photo }],
        restaurant: { description: 'Grillades', mediaIds: [photo, photo] },
      },
      'PARK_RESTAURANT',
    );
    expect('content' in ok && ok.content).toMatchObject({
      heroHighlights: ['Familles', 'Anniversaires'],
      keyFacts: [{ label: 'Entrée', value: '3 000 FCFA' }],
      restaurant: { mediaIds: [photo] },
    });
    expect('content' in ok && contentMediaIds(ok.content)).toEqual([photo]);
    const errors = (patch: Record<string, unknown>) => {
      const r = validateSiteContent({ ...base(), ...patch }, 'PARK_RESTAURANT');
      return 'errors' in r ? r.errors.length : 0;
    };
    expect(errors({ heroHighlights: ['a', 'b', 'c', 'd', 'e'] })).toBe(1);
    expect(errors({ keyFacts: [{ label: 'Entrée', value: '' }] })).toBe(1);
    expect(errors({ attractions: [{ name: 'X', description: '', mediaId: 'pas-un-id' }] })).toBe(1);
    expect(errors({ restaurant: { description: 'x', mediaIds: Array(7).fill(photo) } })).toBe(1);
  });

  it('catalogue des thèmes : Aqua Premium disponible, futurs thèmes annoncés non sélectionnables', () => {
    expect(SITE_THEME_CATALOG.find((t) => t.key === 'AQUA_PREMIUM')?.available).toBe(true);
    expect(SITE_THEME_CATALOG.filter((t) => !t.available).map((t) => t.key)).toEqual([
      'AQUA_FAMILY',
      'AQUA_LUXURY',
      'AQUA_TROPICAL',
    ]);
    expect(isAccessibleAccentColor('#F5C94B')).toBe(true);
    expect(isAccessibleAccentColor('#0B1F2E')).toBe(false);
  });
});
