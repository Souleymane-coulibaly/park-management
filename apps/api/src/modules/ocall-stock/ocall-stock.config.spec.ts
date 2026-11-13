import { loadStockConfig } from './ocall-stock.config';

describe('loadStockConfig', () => {
  const suite = 'postgresql://u:p@ep-suite-pooler.neon.tech/neondb';
  const facture = 'postgresql://u:p@ep-facture-pooler.neon.tech/neondb';
  const stock = 'postgresql://u:p@ep-stock-pooler.neon.tech/neondb';

  it('désactivée par défaut : aucune base exigée', () => {
    expect(loadStockConfig({})).toEqual({
      enabled: false,
      databaseUrl: null,
      sites: { baseDomain: null, subdomainsEnabled: false },
    });
    expect(
      loadStockConfig({
        STOCK_SITES_BASE_DOMAIN: 'Boutique.Ocall.ml',
        STOCK_SITES_SUBDOMAINS_ENABLED: 'true',
      }).sites,
    ).toEqual({ baseDomain: 'boutique.ocall.ml', subdomainsEnabled: true });
    expect(
      loadStockConfig({ STOCK_SITES_SUBDOMAINS_ENABLED: 'true' }).sites.subdomainsEnabled,
    ).toBe(false);
  });

  it('activée : base exigée, distincte des bases Suite, School et Facture', () => {
    expect(() => loadStockConfig({ STOCK_ENABLED: 'true' })).toThrow('STOCK_DATABASE_URL');
    expect(() =>
      loadStockConfig({ STOCK_ENABLED: 'true', DATABASE_URL: suite, STOCK_DATABASE_URL: suite }),
    ).toThrow('distincte');
    expect(() =>
      loadStockConfig({
        STOCK_ENABLED: 'true',
        FACTURE_DATABASE_URL: facture,
        STOCK_DATABASE_URL: 'postgresql://x:y@EP-FACTURE-POOLER.neon.tech:5432/neondb',
      }),
    ).toThrow('distincte');
    expect(
      loadStockConfig({
        STOCK_ENABLED: 'true',
        DATABASE_URL: suite,
        FACTURE_DATABASE_URL: facture,
        STOCK_DATABASE_URL: stock,
      }),
    ).toEqual({
      enabled: true,
      databaseUrl: stock,
      sites: { baseDomain: null, subdomainsEnabled: false },
    });
  });
});
