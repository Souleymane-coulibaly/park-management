import { encodeReceiptLines, previewLines } from './hardware';
import { stockEffectivePermissions } from './stock';
import {
  layoutStockReceipt,
  stockCheckPayments,
  stockDiscountCap,
  stockDiscountError,
  stockLineAmounts,
  stockRefundAmount,
  stockSaleNumber,
  stockSaleTotals,
} from './stock-sales';

describe('Ocall Stock — caisse : montants', () => {
  it('ligne : quantité × prix TTC moins la remise, TVA extraite du TTC', () => {
    expect(stockLineAmounts(3, 1180, 18)).toEqual({ gross: 3540, total: 3540, vat: 540 });
    expect(stockLineAmounts(2, 5000, 18, 1000)).toEqual({ gross: 10000, total: 9000, vat: 1373 });
    expect(stockLineAmounts(1.5, 1000, 0)).toEqual({ gross: 1500, total: 1500, vat: 0 });
  });

  it('totaux d’une vente', () => {
    expect(
      stockSaleTotals([
        { quantity: 2, unitPrice: 5000, vatRate: 18, discount: 500 },
        { quantity: 1, unitPrice: 1000, vatRate: 0 },
      ]),
    ).toEqual({ gross: 11000, discount: 500, total: 10500, vat: 1449 });
  });

  it('remise : droit, plafond, dépassement autorisé sans plafond', () => {
    const rules = { canDiscount: true, unlimited: false, maxPercent: 10 };
    expect(stockDiscountCap(10000, 10)).toBe(1000);
    expect(stockDiscountError(0, 10000, { ...rules, canDiscount: false })).toBeNull();
    expect(stockDiscountError(500, 10000, { ...rules, canDiscount: false })).toMatch(/pouvez pas/);
    expect(stockDiscountError(1000, 10000, rules)).toBeNull();
    expect(stockDiscountError(1001, 10000, rules)).toMatch(/10 %/);
    expect(stockDiscountError(5000, 10000, { ...rules, unlimited: true })).toBeNull();
    expect(stockDiscountError(10001, 10000, { ...rules, unlimited: true })).toMatch(/dépasse/);
    expect(stockDiscountError(-1, 10000, rules)).toMatch(/invalide/);
  });
});

describe('Ocall Stock — caisse : paiements', () => {
  it('espèces avec monnaie rendue, paiements mixtes', () => {
    expect(stockCheckPayments(7500, [{ method: 'CASH', amount: 7500, tendered: 10000 }])).toEqual({
      change: 2500,
      error: null,
    });
    expect(
      stockCheckPayments(10000, [
        { method: 'MOBILE_MONEY', amount: 6000, reference: 'OM-1' },
        { method: 'CASH', amount: 4000, tendered: 5000 },
      ]),
    ).toEqual({ change: 1000, error: null });
  });

  it('refus : somme différente du total, monnaie hors espèces, deux espèces, montant invalide', () => {
    expect(stockCheckPayments(1000, []).error).toMatch(/Ajoutez/);
    expect(stockCheckPayments(1000, [{ method: 'CARD', amount: 900 }]).error).toMatch(/inférieurs/);
    expect(stockCheckPayments(1000, [{ method: 'CARD', amount: 1100 }]).error).toMatch(
      /supérieurs/,
    );
    expect(
      stockCheckPayments(1000, [{ method: 'CARD', amount: 1000, tendered: 2000 }]).error,
    ).toMatch(/espèces/);
    expect(
      stockCheckPayments(1000, [{ method: 'CASH', amount: 1000, tendered: 500 }]).error,
    ).toMatch(/inférieure/);
    expect(
      stockCheckPayments(1000, [
        { method: 'CASH', amount: 500 },
        { method: 'CASH', amount: 500 },
      ]).error,
    ).toMatch(/Un seul/);
    expect(stockCheckPayments(1000, [{ method: 'CASH', amount: 0.5 }]).error).toMatch(/invalide/);
    expect(stockCheckPayments(0, [])).toEqual({ change: 0, error: null });
  });
});

describe('Ocall Stock — caisse : remboursements', () => {
  it('au prorata, le dernier retour rembourse exactement le reste', () => {
    const line = { quantity: 3, total: 1000, returnedQuantity: 0, refundedAmount: 0 };
    expect(stockRefundAmount(line, 1)).toBe(333);
    expect(stockRefundAmount({ ...line, returnedQuantity: 1, refundedAmount: 333 }, 1)).toBe(333);
    expect(stockRefundAmount({ ...line, returnedQuantity: 2, refundedAmount: 666 }, 1)).toBe(334);
    expect(stockRefundAmount(line, 3)).toBe(1000);
  });
});

describe('Ocall Stock — caisse : ticket', () => {
  const data = {
    storeName: 'Quincaillerie du Fleuve',
    address: 'Rue 12, Bamako',
    phone: '+223 70 00 00 00',
    footer: null,
    currency: 'XOF',
    timezone: 'Africa/Bamako',
    saleLabel: stockSaleNumber(42),
    date: '2026-11-13T10:15:00.000Z',
    registerName: 'Caisse 1',
    cashierName: 'Awa Traoré',
    customerName: 'Moussa Diarra',
    lines: [
      {
        label: 'Ciment 50 kg',
        quantity: 2,
        unitPrice: 6000,
        discount: 1000,
        total: 11000,
        vatRate: 18,
        vatAmount: 1678,
      },
    ],
    grossTotal: 12000,
    discountTotal: 1000,
    total: 11000,
    payments: [
      { method: 'MOBILE_MONEY' as const, amount: 6000, reference: 'OM-778' },
      { method: 'CASH' as const, amount: 5000, tendered: 10000 },
    ],
    changeGiven: 5000,
    duplicate: false,
  };

  it.each([58, 80] as const)('ticket %i mm : en-tête, lignes, remises, TVA, paiements, QR', (w) => {
    const lines = layoutStockReceipt(data, w);
    const text = previewLines(lines, w).join('\n');
    expect(text).toContain('VTE-000042');
    expect(text).toContain('13/11/2026 10:15');
    expect(text).toContain('Client : Moussa Diarra');
    expect(text).toContain('Remise');
    expect(text).toMatch(/dont TVA 18 %\s+1 678 FCFA/);
    expect(text).toContain('Réf. OM-778');
    expect(text).toMatch(/Monnaie rendue\s+5 000 FCFA/);
    expect(lines.find((l) => l.qr)?.qr).toBe('VTE-000042');
    expect(text).not.toContain('DUPLICATA');
    for (const l of previewLines(lines, w))
      expect(l.length).toBeLessThanOrEqual(w === 58 ? 32 : 48);
    expect(encodeReceiptLines(lines).length).toBeGreaterThan(100);
  });

  it('réimpression : mention DUPLICATA', () => {
    expect(previewLines(layoutStockReceipt({ ...data, duplicate: true }, 80), 80)[0]).toContain(
      'DUPLICATA',
    );
  });
});

describe('Ocall Stock — caisse : droits par rôle', () => {
  it('caissier : encaisse sans remise ; commercial : remise plafonnée ; responsable : sans plafond', () => {
    const cashier = stockEffectivePermissions('CASHIER');
    expect(cashier).toEqual(expect.arrayContaining(['stock.sales.create', 'stock.cash.session']));
    expect(cashier).not.toContain('stock.sales.discount');
    expect(cashier).not.toContain('stock.sales.refund');
    expect(stockEffectivePermissions('SALES')).toContain('stock.sales.discount');
    expect(stockEffectivePermissions('SALES')).not.toContain('stock.sales.discount.unlimited');
    expect(stockEffectivePermissions('STORE_MANAGER')).toContain('stock.sales.discount.unlimited');
    expect(stockEffectivePermissions('STOREKEEPER')).not.toContain('stock.sales.create');
    // Remise accordée à un caissier par ajustement.
    expect(
      stockEffectivePermissions('CASHIER', [{ permission: 'stock.sales.discount', granted: true }]),
    ).toContain('stock.sales.discount');
    // La gestion des caisses reste liée au rôle.
    expect(
      stockEffectivePermissions('CASHIER', [
        { permission: 'stock.registers.manage', granted: true },
      ]),
    ).not.toContain('stock.registers.manage');
  });
});
