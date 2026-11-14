import {
  type StockShowcaseProduct,
  type StockShowcasePublished,
  parseStockShowcasePath,
  stockShowcaseCanonicalUrl,
  stockShowcaseProductJsonLd,
  stockShowcaseStoreJsonLd,
} from './stock-showcase';

const site: StockShowcasePublished = {
  businessName: 'Quincaillerie du Fleuve',
  headline: 'Tout pour bâtir',
  tagline: 'Peinture, carrelage, outillage',
  about: null,
  phone: '+223 70 00 00 00',
  whatsapp: null,
  email: null,
  address: 'Rue 310',
  city: 'Bamako',
  hours: 'Lun–Sam 8 h–19 h',
  mapUrl: null,
  seoDescription: null,
  showCatalog: true,
  showPrices: true,
  forms: ['QUOTE'],
  logo: 'l.jpg',
  cover: null,
  gallery: [],
  publishedAt: '2026-11-13T00:00:00.000Z',
};

const product: StockShowcaseProduct = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Peinture blanche 5 L',
  description: null,
  category: { id: 'c', name: 'Peintures' },
  brand: 'Seigneurie',
  unit: 'pot',
  priceTtc: 11_800,
  priceFrom: false,
  availability: 'AVAILABLE',
  images: ['i1'],
  illustrations: [],
};

describe('Ocall Stock — vitrine', () => {
  it('adresse canonique : domaine actif, sous-domaine, sinon /m/<slug>', () => {
    const base = {
      slug: 'quinca',
      activeDomain: null,
      baseDomain: 'boutique.ocall.ml',
      subdomainsEnabled: false,
      publicOrigin: 'https://app.ocall.ml/',
    };
    expect(stockShowcaseCanonicalUrl(base)).toBe('https://app.ocall.ml/m/quinca');
    expect(stockShowcaseCanonicalUrl({ ...base, subdomainsEnabled: true })).toBe(
      'https://quinca.boutique.ocall.ml',
    );
    expect(stockShowcaseCanonicalUrl({ ...base, activeDomain: 'www.quinca.ml' })).toBe(
      'https://www.quinca.ml',
    );
  });

  it('pages servies sur l’hôte de la vitrine, rien d’autre', () => {
    expect(parseStockShowcasePath('/')).toEqual({ page: 'home' });
    expect(parseStockShowcasePath('/catalogue/')).toEqual({ page: 'catalog' });
    expect(parseStockShowcasePath(`/article/${product.id.toUpperCase()}`)).toEqual({
      page: 'product',
      id: product.id,
    });
    expect(parseStockShowcasePath('/stock')).toBeNull();
    expect(parseStockShowcasePath('/article/42')).toBeNull();
  });

  it('données structurées : magasin, produit et offre ; prix seulement s’il est affiché', () => {
    const store = stockShowcaseStoreJsonLd(site, 'https://x', (k) => `https://x/${k}`);
    expect(store).toMatchObject({
      '@type': 'Store',
      name: 'Quincaillerie du Fleuve',
      address: { addressLocality: 'Bamako' },
      logo: 'https://x/l.jpg',
    });
    const p = stockShowcaseProductJsonLd(site, product, 'https://x/a', (i) => `https://x/i/${i}`);
    expect(p).toMatchObject({
      '@type': 'Product',
      brand: { name: 'Seigneurie' },
      offers: { price: 11_800, priceCurrency: 'XOF', availability: 'https://schema.org/InStock' },
    });
    const hidden = stockShowcaseProductJsonLd(
      site,
      { ...product, priceTtc: null, availability: 'ON_ORDER' },
      'u',
      (i) => i,
    );
    expect(hidden.offers).not.toHaveProperty('price');
    expect(hidden.offers.availability).toBe('https://schema.org/BackOrder');
  });
});
