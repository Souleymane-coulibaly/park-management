import {
  STOCK_ADJUSTABLE_PERMISSIONS,
  STOCK_PERMISSIONS,
  STOCK_ROLES,
  STOCK_SITE_ROLES,
  assignableStockRoles,
  formatStockMoney,
  isStockSiteRole,
  stockEffectivePermissions,
  stockGeneratedSku,
  stockRolePermissions,
  stockSitePermissions,
} from './stock';
import {
  barcodeProblem,
  detectBarcodeType,
  gtinCheckDigit,
  gtinEquivalents,
  isValidGtin,
  normalizeScannedCode,
  stockInternalCode,
} from './stock-barcodes';

describe('Ocall Stock — rôles et permissions', () => {
  it('l’administrateur a tout ; chaque rôle entre dans l’application', () => {
    expect(stockRolePermissions('ADMIN')).toEqual([...STOCK_PERMISSIONS]);
    for (const role of STOCK_ROLES) expect(stockRolePermissions(role)).toContain('stock.access');
  });

  it('le caissier ne voit ni les prix d’achat ni les fournisseurs, et ne change aucun prix', () => {
    const cashier = stockRolePermissions('CASHIER');
    expect(cashier).not.toContain('stock.prices.purchase.read');
    expect(cashier).not.toContain('stock.prices.manage');
    expect(cashier).not.toContain('stock.suppliers.read');
  });

  it('ajustements : accordée en plus du rôle, retirée du rôle, droits d’administration jamais ajustables', () => {
    const p = stockEffectivePermissions('CASHIER', [
      { permission: 'stock.labels.print', granted: true },
      { permission: 'stock.catalog.read', granted: false },
      { permission: 'stock.members.manage', granted: true },
      { permission: 'stock.settings.manage', granted: true },
      { permission: 'stock.inconnue', granted: true },
    ]);
    expect(p).toContain('stock.labels.print');
    expect(p).not.toContain('stock.catalog.read');
    expect(p).not.toContain('stock.members.manage');
    expect(p).not.toContain('stock.settings.manage');
    expect(
      stockEffectivePermissions('ADMIN', [{ permission: 'stock.access', granted: false }]),
    ).toContain('stock.access');
    expect(STOCK_ADJUSTABLE_PERMISSIONS).not.toContain('stock.members.manage');
  });

  it('rôle par site : restreint au rôle principal, jamais élargi ; administrateur exclu', () => {
    const manager = stockEffectivePermissions('STORE_MANAGER');
    // Sans rôle de site : rôle principal.
    expect(stockSitePermissions('STORE_MANAGER', null)).toEqual(manager);
    // Rôle de site inférieur : ses seules permissions.
    const atSite = stockSitePermissions('STORE_MANAGER', 'CASHIER');
    expect(atSite).toEqual(manager.filter((p) => stockRolePermissions('CASHIER').includes(p)));
    expect(atSite).not.toContain('stock.purchases.manage');
    // Rôle de site supérieur : jamais plus que le rôle principal.
    const cashier = stockEffectivePermissions('CASHIER');
    expect(stockSitePermissions('CASHIER', 'STORE_MANAGER')).toEqual(cashier);
    expect(stockSitePermissions('CASHIER', 'ADMIN')).toEqual(cashier);
    // Ajustements appliqués des deux côtés.
    const adj = [{ permission: 'stock.sales.discount', granted: false }];
    expect(stockSitePermissions('STORE_MANAGER', 'CASHIER', adj)).not.toContain(
      'stock.sales.discount',
    );
    expect(STOCK_SITE_ROLES).not.toContain('ADMIN');
    expect(isStockSiteRole('CASHIER')).toBe(true);
    expect(isStockSiteRole('ADMIN')).toBe(false);
  });

  it('seul l’administrateur attribue des rôles', () => {
    expect(assignableStockRoles('ADMIN')).toEqual([...STOCK_ROLES]);
    expect(assignableStockRoles('STORE_MANAGER')).toEqual([]);
  });

  it('montants et références générées', () => {
    expect(formatStockMoney(1250000)).toBe('1 250 000 FCFA');
    expect(formatStockMoney(15000, 'GNF')).toBe('15 000 GNF');
    expect(stockGeneratedSku('OC', 42)).toBe('OC-000042');
  });
});

describe('Ocall Stock — codes-barres', () => {
  it('clé de contrôle GS1 sur des codes réels', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1);
    expect(isValidGtin('EAN13', '4006381333931')).toBe(true);
    expect(isValidGtin('EAN8', '96385074')).toBe(true);
    expect(isValidGtin('UPCA', '036000291452')).toBe(true);
  });

  it('refuse une clé fausse, une longueur fausse ou des lettres', () => {
    expect(isValidGtin('EAN13', '4006381333932')).toBe(false);
    expect(barcodeProblem('EAN13', '4006381333932')).toContain('clé de contrôle');
    expect(barcodeProblem('EAN13', '40063813339')).toContain('13 chiffres');
    expect(barcodeProblem('EAN8', '9638507A')).toContain('8 chiffres');
    expect(barcodeProblem('UPCA', '036000291452')).toBeNull();
    expect(barcodeProblem('INTERNAL', 'OC00000001')).toBeNull();
    expect(barcodeProblem('INTERNAL', '4006381333931')).toContain('généré');
  });

  it('détecte le type d’un code lu et nettoie la lecture du scanner', () => {
    expect(detectBarcodeType('4006381333931')).toBe('EAN13');
    expect(detectBarcodeType('036000291452')).toBe('UPCA');
    expect(detectBarcodeType('96385074')).toBe('EAN8');
    expect(detectBarcodeType(stockInternalCode('OC', 7))).toBe('INTERNAL');
    expect(detectBarcodeType('4006381333932')).toBeNull();
    expect(normalizeScannedCode(' 4006381333931\r\n')).toBe('4006381333931');
    expect(normalizeScannedCode('\u0002OC00000007\u0003')).toBe('OC00000007');
  });

  it('UPC-A et sa forme EAN-13 (0 en tête) désignent le même code', () => {
    expect(gtinEquivalents('036000291452')).toEqual(['036000291452', '0036000291452']);
    expect(gtinEquivalents('0036000291452')).toEqual(['0036000291452', '036000291452']);
    expect(gtinEquivalents('4006381333931')).toEqual(['4006381333931']);
    expect(gtinEquivalents('OC00000007')).toEqual(['OC00000007']);
  });
});
