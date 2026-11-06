import {
  SCHOOL_SITE_LIMITS,
  emptySchoolSiteContent,
  localizedText,
  parseSchoolSitePath,
  safeHttpsUrl,
  schoolSiteAvailability,
  schoolSiteMediaIds,
  schoolSitePath,
  schoolSiteSlugError,
  validateSchoolSiteContent,
  validateSchoolSiteLink,
  whatsappDigits,
} from './school-site';

describe('Sites des établissements — adresses et pages', () => {
  it('slug : mêmes règles que les sites Park, noms réservés refusés', () => {
    expect(schoolSiteSlugError('medersa-annour')).toBeNull();
    expect(schoolSiteSlugError('www')).toBe('SLUG_RESERVED');
    expect(schoolSiteSlugError('ecole')).toBe('SLUG_RESERVED');
    expect(schoolSiteSlugError('Ecole')).toBe('SLUG_FORMAT');
    expect(schoolSiteSlugError('a--b')).toBe('SLUG_FORMAT');
    expect(schoolSiteSlugError('ab')).toBe('SLUG_LENGTH');
  });

  it('chemins publics exacts, en français à la racine et en arabe sous /ar', () => {
    expect(parseSchoolSitePath('/')).toEqual({ lang: 'fr', page: 'home', newsSlug: null });
    expect(parseSchoolSitePath('/ar')).toEqual({ lang: 'ar', page: 'home', newsSlug: null });
    expect(parseSchoolSitePath('/ar/')).toEqual({ lang: 'ar', page: 'home', newsSlug: null });
    expect(parseSchoolSitePath('/a-propos')).toEqual({ lang: 'fr', page: 'about', newsSlug: null });
    expect(parseSchoolSitePath('/ar/galerie')).toEqual({
      lang: 'ar',
      page: 'gallery',
      newsSlug: null,
    });
    expect(parseSchoolSitePath('/actualites/rentree-2026')).toEqual({
      lang: 'fr',
      page: 'news',
      newsSlug: 'rentree-2026',
    });
    for (const bad of [
      '/school',
      '/connexion',
      '/app',
      '/a-propos/x',
      '/galerie/x',
      '/actualites/Rentree',
      '/actualites/a/b',
      '/ar/ar',
      '/api/v1/school/students',
      '/a-propos/',
      '//a-propos',
    ]) {
      expect(parseSchoolSitePath(bad)).toBeNull();
    }
  });

  it('construction des chemins : réciproque de l’analyse', () => {
    expect(schoolSitePath('fr', 'home')).toBe('/');
    expect(schoolSitePath('ar', 'home')).toBe('/ar');
    expect(schoolSitePath('ar', 'news', 'rentree')).toBe('/ar/actualites/rentree');
    for (const page of ['about', 'teaching', 'gallery', 'news', 'practical', 'contact'] as const) {
      for (const lang of ['fr', 'ar'] as const) {
        expect(parseSchoolSitePath(schoolSitePath(lang, page))).toEqual({
          lang,
          page,
          newsSlug: null,
        });
      }
    }
  });
});

describe('Repli de langue explicite', () => {
  it('langue demandée, sinon l’autre langue avec SA langue, sinon rien', () => {
    expect(localizedText({ fr: 'Bonjour', ar: 'مرحبا' }, 'ar')).toEqual({
      text: 'مرحبا',
      lang: 'ar',
      fallback: false,
    });
    expect(localizedText({ fr: 'Bonjour', ar: '  ' }, 'ar')).toEqual({
      text: 'Bonjour',
      lang: 'fr',
      fallback: true,
    });
    expect(localizedText({ fr: '', ar: '' }, 'fr')).toBeNull();
  });
});

describe('Contenu du brouillon', () => {
  it('contenu vide valide ; aucune coordonnée reprise d’office', () => {
    const r = validateSchoolSiteContent(emptySchoolSiteContent());
    expect(r).toEqual({ content: emptySchoolSiteContent() });
  });

  it('champ inconnu, HTML de contrôle, lien http et téléphone invalides refusés', () => {
    const c = emptySchoolSiteContent() as unknown as Record<string, any>;
    c.students = [{ name: 'Awa' }];
    c.practical.mapUrl = 'http://maps.example.com';
    c.practical.phone = 'appelez-nous';
    c.home.tagline.fr = 'x\u0007';
    const r = validateSchoolSiteContent(c);
    expect('errors' in r && r.errors).toEqual(
      expect.arrayContaining([
        'contenu.students : champ inconnu.',
        'practical.mapUrl : adresse https:// valide attendue.',
        'practical.phone : numéro invalide.',
        'home.tagline.fr : caractères non autorisés.',
      ]),
    );
  });

  it('longueurs bornées ; galerie dédoublonnée ; médias cités listés', () => {
    const c = emptySchoolSiteContent();
    c.home.tagline.fr = 'x'.repeat(SCHOOL_SITE_LIMITS.short + 1);
    expect('errors' in validateSchoolSiteContent(c)).toBe(true);
    const id = '6f1c1d0e-8a8b-4c4d-9e9f-0a1b2c3d4e5f';
    const ok = emptySchoolSiteContent();
    ok.media.logoId = id;
    ok.media.gallery = [
      { mediaId: id, caption: { fr: 'Cour', ar: '' } },
      { mediaId: id.toUpperCase(), caption: { fr: 'Doublon', ar: '' } },
    ];
    const r = validateSchoolSiteContent(ok);
    expect('content' in r && r.content.media.gallery).toHaveLength(1);
    expect('content' in r && schoolSiteMediaIds(r.content)).toEqual([id, id]);
  });
});

describe('Liens externes et WhatsApp', () => {
  it('https public uniquement : ni http, ni identifiants, ni port, ni IP, ni nom local', () => {
    expect(safeHttpsUrl('https://www.facebook.com/ecole')).toBe('https://www.facebook.com/ecole');
    for (const bad of [
      'http://facebook.com/ecole',
      'javascript:alert(1)',
      'https://user:pass@facebook.com',
      'https://facebook.com:8443/x',
      'https://192.168.1.10/x',
      'https://[::1]/x',
      'https://intranet/x',
      'https://ecole.local/x',
      'https://a b.com',
      'data:text/html,x',
    ]) {
      expect(safeHttpsUrl(bad)).toBeNull();
    }
  });

  it('chaque réseau exige son propre domaine ; « autre lien » : tout https public', () => {
    expect(validateSchoolSiteLink('FACEBOOK', 'https://m.facebook.com/ecole')).toEqual({
      url: 'https://m.facebook.com/ecole',
    });
    expect(validateSchoolSiteLink('YOUTUBE', 'https://youtu.be/abc')).toEqual({
      url: 'https://youtu.be/abc',
    });
    expect(validateSchoolSiteLink('INSTAGRAM', 'https://facebook.com/x')).toEqual({
      error: 'Adresse Instagram attendue (instagram.com).',
    });
    expect(validateSchoolSiteLink('LINKEDIN', 'https://linkedin.com.evil.io/x')).toHaveProperty(
      'error',
    );
    expect(validateSchoolSiteLink('OTHER', 'https://ministere.gouv.sn/ecoles')).toEqual({
      url: 'https://ministere.gouv.sn/ecoles',
    });
  });

  it('WhatsApp : numéro international ou lien wa.me / api.whatsapp.com, normalisé vers wa.me', () => {
    expect(whatsappDigits('+221 77 000 00 00')).toBe('221770000000');
    expect(whatsappDigits('00221 77 000 00 00')).toBe('221770000000');
    // Numéro local, sans indicatif explicite : refusé (pays deviné = conversation avec un inconnu).
    expect(whatsappDigits('77 000 00 00')).toBeNull();
    expect(whatsappDigits('0770000000')).toBeNull();
    expect(whatsappDigits('+0770000000')).toBeNull();
    expect(validateSchoolSiteLink('WHATSAPP', '+221 77 000 00 00')).toEqual({
      url: 'https://wa.me/221770000000',
    });
    expect(validateSchoolSiteLink('WHATSAPP', 'https://wa.me/221770000000')).toEqual({
      url: 'https://wa.me/221770000000',
    });
    expect(
      validateSchoolSiteLink('WHATSAPP', 'https://api.whatsapp.com/send?phone=221770000000'),
    ).toEqual({ url: 'https://wa.me/221770000000' });
    expect(validateSchoolSiteLink('WHATSAPP', 'https://evil.com/221770000000')).toHaveProperty(
      'error',
    );
  });
});

describe('Disponibilité selon le contrat', () => {
  const base = { startsOn: '2026-01-01', endsOn: '2026-12-31' };
  const now = new Date('2026-11-06T12:00:00Z');

  it('contrat valide : en ligne, publication permise', () => {
    expect(
      schoolSiteAvailability({ ...base, status: 'ACTIVE', readOnlySince: null }, 30, now),
    ).toEqual({ online: true, canPublish: true, readOnlyUntil: null });
  });

  it('suspendu : maintenu en lecture seule pendant la durée configurée, puis hors ligne', () => {
    const since = new Date('2026-11-01T00:00:00Z');
    expect(
      schoolSiteAvailability({ ...base, status: 'SUSPENDED', readOnlySince: since }, 30, now),
    ).toEqual({ online: true, canPublish: false, readOnlyUntil: new Date('2026-12-01T00:00:00Z') });
    expect(
      schoolSiteAvailability({ ...base, status: 'SUSPENDED', readOnlySince: since }, 3, now),
    ).toEqual({ online: false, canPublish: false, reason: 'GRACE_ENDED' });
  });

  it('actif mais échu : lecture seule dès le lendemain de la fin', () => {
    const late = new Date('2027-01-10T00:00:00Z');
    expect(
      schoolSiteAvailability({ ...base, status: 'ACTIVE', readOnlySince: null }, 30, late),
    ).toEqual({ online: true, canPublish: false, readOnlyUntil: new Date('2027-01-31T00:00:00Z') });
  });

  it('résilié ou absent : hors ligne immédiatement ; date de suspension inconnue : refus', () => {
    expect(
      schoolSiteAvailability({ ...base, status: 'TERMINATED', readOnlySince: now }, 30, now),
    ).toEqual({ online: false, canPublish: false, reason: 'TERMINATED' });
    expect(schoolSiteAvailability(null, 30, now)).toEqual({
      online: false,
      canPublish: false,
      reason: 'NO_CONTRACT',
    });
    expect(
      schoolSiteAvailability({ ...base, status: 'EXPIRED', readOnlySince: null }, 30, now),
    ).toEqual({ online: false, canPublish: false, reason: 'GRACE_ENDED' });
  });
});
