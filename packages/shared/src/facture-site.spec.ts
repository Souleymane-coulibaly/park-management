import {
  type FactureSitePublished,
  factureSiteCanonicalUrl,
  factureSiteJsonLd,
} from './facture-site';

const site: FactureSitePublished = {
  businessName: 'Froid Services',
  headline: 'Climatisation à Bamako',
  tagline: 'Installation et entretien',
  about: null,
  services: [
    { itemId: 'a', name: 'Entretien', description: null, unit: 'intervention', priceTtc: 29_500 },
    { itemId: 'b', name: 'Dépannage', description: null, unit: 'intervention', priceTtc: null },
  ],
  phone: '+223 20 22 00 00',
  whatsapp: null,
  email: 'contact@froid.ml',
  address: 'Rue 310',
  city: 'Bamako',
  hours: 'Lun–Ven 8 h–18 h',
  mapUrl: null,
  seoDescription: null,
  forms: ['CONTACT'],
  logo: 'logo.jpg',
  cover: null,
  gallery: [],
  publishedAt: '2026-11-11T08:00:00.000Z',
};

describe('Ocall Facture — site vitrine (F5)', () => {
  it('adresse canonique : domaine actif, puis sous-domaine Facture, puis /v/<slug>', () => {
    const base = {
      slug: 'froid',
      baseDomain: 'vitrine.ocall.ml',
      publicOrigin: 'https://app.ocall.ml/',
    };
    expect(
      factureSiteCanonicalUrl({ ...base, activeDomain: 'www.froid.ml', subdomainsEnabled: true }),
    ).toBe('https://www.froid.ml');
    expect(factureSiteCanonicalUrl({ ...base, activeDomain: null, subdomainsEnabled: true })).toBe(
      'https://froid.vitrine.ocall.ml',
    );
    expect(factureSiteCanonicalUrl({ ...base, activeDomain: null, subdomainsEnabled: false })).toBe(
      'https://app.ocall.ml/v/froid',
    );
  });

  it('LocalBusiness : données publiées seulement, prix seulement s’ils sont affichés', () => {
    const ld = factureSiteJsonLd(
      site,
      'https://www.froid.ml',
      (k) => `https://www.froid.ml/m/${k}`,
    );
    expect(ld).toMatchObject({
      '@type': 'LocalBusiness',
      name: 'Froid Services',
      url: 'https://www.froid.ml',
      description: 'Installation et entretien',
      telephone: '+223 20 22 00 00',
      address: { streetAddress: 'Rue 310', addressLocality: 'Bamako', addressCountry: 'ML' },
      logo: 'https://www.froid.ml/m/logo.jpg',
    });
    expect(ld.makesOffer).toEqual([
      {
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: 'Entretien' },
        price: 29_500,
        priceCurrency: 'XOF',
      },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Dépannage' } },
    ]);
  });
});
