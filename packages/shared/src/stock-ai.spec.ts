import {
  stockAiPhotoBarcode,
  stockDailyRate,
  stockRestockQuantity,
  stockStockoutEstimate,
} from './stock-ai';

describe('Ocall Stock — IA (calculs du serveur)', () => {
  it('rythme journalier des sorties', () => {
    expect(stockDailyRate(90, 90)).toBe(1);
    expect(stockDailyRate(0, 30)).toBe(0);
    expect(stockDailyRate(5, 0)).toBe(0);
  });

  it('quantité à commander : délai + couverture + seuil − disponible − déjà commandé', () => {
    const base = { leadTimeDays: 7, coverDays: 14, minStock: null, incoming: 0, unit: 'pot' };
    // 2/jour × 21 jours = 42 ; − 10 disponibles = 32.
    expect(stockRestockQuantity({ ...base, dailyRate: 2, available: 10 })).toBe(32);
    // Seuil d'alerte ajouté, commandes en cours déduites.
    expect(
      stockRestockQuantity({ ...base, dailyRate: 2, available: 10, minStock: 5, incoming: 20 }),
    ).toBe(17);
    // Assez de stock : rien.
    expect(stockRestockQuantity({ ...base, dailyRate: 1, available: 50 })).toBe(0);
    // Arrondi à l'unité supérieure ; au millième pour le poids.
    expect(stockRestockQuantity({ ...base, dailyRate: 0.1, available: 0 })).toBe(3);
    expect(stockRestockQuantity({ ...base, dailyRate: 0.1, available: 0, unit: 'kg' })).toBe(2.1);
    expect(stockRestockQuantity({ ...base, dailyRate: 0, available: -3 })).toBe(3);
  });

  it('rupture : fourchette prudente des deux rythmes, risque selon le délai fournisseur', () => {
    expect(
      stockStockoutEstimate({ available: 20, shortRate: 4, longRate: 1, leadTimeDays: 7 }),
    ).toEqual({
      daysMin: 5,
      daysMax: 20,
      risk: 'HIGH',
    });
    expect(
      stockStockoutEstimate({ available: 30, shortRate: 2, longRate: 2, leadTimeDays: 7 }),
    ).toEqual({ daysMin: 15, daysMax: 15, risk: 'MEDIUM' });
    expect(
      stockStockoutEstimate({ available: 100, shortRate: 1, longRate: 0.5, leadTimeDays: 7 })?.risk,
    ).toBeNull();
    expect(
      stockStockoutEstimate({ available: 5, shortRate: 0, longRate: 0, leadTimeDays: 7 }),
    ).toBeNull();
    expect(
      stockStockoutEstimate({ available: -2, shortRate: 1, longRate: 0, leadTimeDays: 7 }),
    ).toEqual({ daysMin: 0, daysMax: 0, risk: 'HIGH' });
  });
});

describe('Ocall Stock — code-barres lu sur une photo', () => {
  it('gardé seulement si la clé GTIN est juste, jamais corrigé', () => {
    expect(stockAiPhotoBarcode('4006381333931')).toBe('4006381333931');
    expect(stockAiPhotoBarcode('4 006381 333931')).toBe('4006381333931');
    expect(stockAiPhotoBarcode('4006381333932')).toBeNull();
    expect(stockAiPhotoBarcode('')).toBeNull();
    expect(stockAiPhotoBarcode('ABC')).toBeNull();
  });
});
