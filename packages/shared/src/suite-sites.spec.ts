import {
  ESTABLISHMENT_KINDS,
  ESTABLISHMENT_KIND_LABELS,
  isEstablishmentKind,
  normalizeSiteText,
  siteMatchReason,
} from './suite-sites';

describe('Ocall Suite — référentiel des sites', () => {
  it('natures de lieu : toutes libellées, valeur inconnue refusée', () => {
    for (const k of ESTABLISHMENT_KINDS) expect(ESTABLISHMENT_KIND_LABELS[k]).toBeTruthy();
    expect(isEstablishmentKind('SHOP')).toBe(true);
    expect(isEstablishmentKind('shop')).toBe(false);
    expect(isEstablishmentKind(null)).toBe(false);
  });

  it('texte comparable : accents, casse et ponctuation ignorés', () => {
    expect(normalizeSiteText('  Boutique  Ségou — Centre! ')).toBe('boutique segou centre');
    expect(normalizeSiteText(null)).toBe('');
  });

  it('suggestion : même nom (villes compatibles), sinon même ville, sinon rien', () => {
    expect(
      siteMatchReason({ name: 'Boutique Ségou' }, { name: 'boutique segou', city: 'Ségou' }),
    ).toBe('same-name');
    expect(
      siteMatchReason(
        { name: 'Boutique Ségou', city: 'Ségou' },
        { name: 'Boutique Ségou', city: 'Bamako' },
      ),
    ).toBeNull();
    expect(
      siteMatchReason({ name: 'Dépôt', city: 'Kayes' }, { name: 'Magasin Kayes', city: 'kayes' }),
    ).toBe('same-city');
    expect(siteMatchReason({ name: 'A' }, { name: 'B' })).toBeNull();
    expect(siteMatchReason({ name: '' }, { name: '' })).toBeNull();
  });
});
