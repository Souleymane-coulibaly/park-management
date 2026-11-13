import {
  STOCK_ADJUSTABLE_PERMISSIONS,
  stockEffectivePermissions,
  stockRolePermissions,
} from './stock';
import {
  formatStockQuantity,
  parseStockLocationQr,
  stockCountNumber,
  stockLocationNests,
  stockLocationQr,
  stockTransferNumber,
} from './stock-warehouse';

describe('Ocall Stock S2 — emplacements', () => {
  it('QR code d’emplacement : écrit puis relu, casse ignorée, rien d’autre accepté', () => {
    expect(stockLocationQr('ENT1', 'A-01-03')).toBe('L:ENT1/A-01-03');
    expect(parseStockLocationQr('l:ent1/a-01-03')).toEqual({
      siteCode: 'ENT1',
      locationCode: 'A-01-03',
    });
    expect(parseStockLocationQr('4006381333931')).toBeNull();
    expect(parseStockLocationQr('L:ENT1')).toBeNull();
    expect(parseStockLocationQr('L:E/A')).toBeNull();
  });

  it('ordre des niveaux : zone → allée → rayonnage → emplacement ; « Général » à part', () => {
    expect(stockLocationNests('ZONE', 'AISLE')).toBe(true);
    expect(stockLocationNests('ZONE', 'BIN')).toBe(true);
    expect(stockLocationNests('BIN', 'ZONE')).toBe(false);
    expect(stockLocationNests('AISLE', 'AISLE')).toBe(false);
    expect(stockLocationNests('DEFAULT', 'ZONE')).toBe(false);
  });

  it('numéros et quantités affichés', () => {
    expect(stockTransferNumber(12)).toBe('TR-000012');
    expect(stockCountNumber(3)).toBe('INV-000003');
    expect(formatStockQuantity(2.5)).toBe('2,5');
    expect(formatStockQuantity('0.125')).toBe('0,125');
  });
});

describe('Ocall Stock S2 — permissions', () => {
  it('le caissier consulte le stock sans le modifier ; le magasinier compte sans valider', () => {
    const cashier = stockRolePermissions('CASHIER');
    expect(cashier).toContain('stock.levels.read');
    expect(cashier).not.toContain('stock.movements.create');
    const keeper = stockRolePermissions('STOREKEEPER');
    expect(keeper).toContain('stock.counts.count');
    expect(keeper).not.toContain('stock.counts.validate');
    expect(keeper).not.toContain('stock.adjust');
  });

  it('la gestion des sites reste liée au rôle (jamais ajustée par membre)', () => {
    expect(STOCK_ADJUSTABLE_PERMISSIONS).not.toContain('stock.sites.manage');
    expect(
      stockEffectivePermissions('STOREKEEPER', [
        { permission: 'stock.sites.manage', granted: true },
      ]),
    ).not.toContain('stock.sites.manage');
    expect(
      stockEffectivePermissions('STOREKEEPER', [{ permission: 'stock.adjust', granted: true }]),
    ).toContain('stock.adjust');
  });
});
