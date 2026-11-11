import { hasFacturePermission } from './facture';
import {
  FACTURE_MAX_QUANTITY,
  FACTURE_MAX_UNIT_PRICE,
  canAcceptFactureDocument,
  canCancelFactureDocument,
  canConvertFactureDocument,
  canCreditFactureInvoice,
  canRecordFacturePayment,
  computeFactureTotals,
  factureAmountInWords,
  factureBalance,
  factureInvoiceStatus,
  isFactureOverdue,
  lineTotalHt,
  numberToFrenchWords,
  quantityToMilli,
} from './facture-documents';

const line = (quantity: number, unitPrice: number, vatRate = 18, discountPercent = 0) => ({
  quantity,
  unitPrice,
  vatRate,
  discountPercent,
});

describe('Ocall Facture — documents commerciaux', () => {
  it('ligne : quantité décimale exacte, remise, arrondi au franc (moitié vers le haut)', () => {
    expect(lineTotalHt(line(3, 15_000))).toBe(45_000);
    expect(lineTotalHt(line(1.5, 10_001))).toBe(15_002); // 15 001,5 → 15 002
    expect(lineTotalHt(line(0.333, 1000))).toBe(333);
    expect(lineTotalHt(line(2, 999, 18, 10))).toBe(1798); // 1 798,2
    expect(lineTotalHt(line(1, 5, 18, 50))).toBe(3); // 2,5 → 3
    expect(lineTotalHt(line(4, 25_000, 18, 100))).toBe(0);
    // Pas d'erreur de virgule flottante : 0,1 × 3 = 0,3 exactement.
    expect(lineTotalHt(line(0.1, 3))).toBe(0);
    expect(lineTotalHt(line(0.1, 30))).toBe(3);
    // Extrêmes exacts (au-delà de 2^53 en calcul intermédiaire).
    expect(lineTotalHt(line(FACTURE_MAX_QUANTITY, FACTURE_MAX_UNIT_PRICE))).toBe(1e15);
    expect(() => quantityToMilli(1.0005)).toThrow();
    expect(quantityToMilli(12.345)).toBe(12_345);
  });

  it('totaux : TVA calculée par taux sur la base cumulée ; TTC = HT + TVA', () => {
    const t = computeFactureTotals([
      line(1, 333), // TVA 18 % : 59,94
      line(1, 333), // cumulé 666 → 119,88 → 120 (ligne à ligne : 60 + 60 = 120 aussi)
      line(1, 1), // 667 → 120,06 → 120
      line(2, 50_000, 0), // exonéré
      line(1, 10_000, 5),
    ]);
    expect(t.lines).toEqual([333, 333, 1, 100_000, 10_000]);
    expect(t.vat).toEqual([
      { rate: 0, base: 100_000, amount: 0 },
      { rate: 5, base: 10_000, amount: 500 },
      { rate: 18, base: 667, amount: 120 },
    ]);
    expect(t.totalHt).toBe(110_667);
    expect(t.grossHt).toBe(110_667);
    expect(t.totalDiscount).toBe(0);
    expect(t.totalVat).toBe(620);
    expect(t.totalTtc).toBe(111_287);
    // Cumul par taux plutôt que ligne à ligne : 3 × 0,18 = 0,54 → 1 (ligne à ligne : 0).
    expect(computeFactureTotals([line(1, 1), line(1, 1), line(1, 1)]).totalVat).toBe(1);
    // Remise : sous-total brut, remise cumulée, total HT.
    const discounted = computeFactureTotals([line(2, 999, 18, 10), line(1, 1000, 18, 50)]);
    expect(discounted).toMatchObject({ grossHt: 2998, totalHt: 2298, totalDiscount: 700 });
    expect(computeFactureTotals([])).toEqual({
      lines: [],
      grossHt: 0,
      totalDiscount: 0,
      totalHt: 0,
      totalVat: 0,
      totalTtc: 0,
      vat: [],
    });
  });

  it('conversions : devis → pro forma, bon ou facture ; pro forma → bon ou facture ; bon → facture', () => {
    const live = (type: 'QUOTE' | 'PRO_FORMA' | 'ORDER' | 'INVOICE') => ({
      type,
      status: 'ISSUED' as const,
    });
    expect(canConvertFactureDocument(live('QUOTE'), 'PRO_FORMA')).toBe(true);
    expect(canConvertFactureDocument(live('QUOTE'), 'ORDER')).toBe(true);
    expect(canConvertFactureDocument(live('QUOTE'), 'INVOICE')).toBe(true);
    expect(canConvertFactureDocument(live('PRO_FORMA'), 'ORDER')).toBe(true);
    expect(canConvertFactureDocument(live('ORDER'), 'INVOICE')).toBe(true);
    expect(canConvertFactureDocument(live('ORDER'), 'QUOTE')).toBe(false);
    expect(canConvertFactureDocument(live('INVOICE'), 'ORDER')).toBe(false);
    expect(canConvertFactureDocument(live('PRO_FORMA'), 'QUOTE')).toBe(false);
    for (const status of ['DRAFT', 'REFUSED', 'CANCELLED'] as const) {
      expect(canConvertFactureDocument({ type: 'QUOTE', status }, 'ORDER')).toBe(false);
    }
    expect(canConvertFactureDocument({ type: 'QUOTE', status: 'ACCEPTED' }, 'ORDER')).toBe(true);
  });

  it('acceptation (devis, pro forma émis) et annulation (émis seulement)', () => {
    expect(canAcceptFactureDocument({ type: 'QUOTE', status: 'SENT' })).toBe(true);
    expect(canAcceptFactureDocument({ type: 'ORDER', status: 'ISSUED' })).toBe(false);
    expect(canAcceptFactureDocument({ type: 'QUOTE', status: 'ACCEPTED' })).toBe(false);
    expect(canAcceptFactureDocument({ type: 'QUOTE', status: 'DRAFT' })).toBe(false);
    expect(canCancelFactureDocument({ type: 'QUOTE', status: 'DRAFT' })).toBe(false);
    expect(canCancelFactureDocument({ type: 'QUOTE', status: 'CANCELLED' })).toBe(false);
    expect(canCancelFactureDocument({ type: 'QUOTE', status: 'REFUSED' })).toBe(true);
    // Une facture ou un avoir émis ne s'annule jamais : correction par avoir.
    expect(canCancelFactureDocument({ type: 'INVOICE', status: 'ISSUED' })).toBe(false);
    expect(canCancelFactureDocument({ type: 'CREDIT_NOTE', status: 'SENT' })).toBe(false);
  });

  it('montant en toutes lettres (orthographe traditionnelle)', () => {
    const cases: [number, string][] = [
      [0, 'zéro'],
      [1, 'un'],
      [17, 'dix-sept'],
      [21, 'vingt et un'],
      [71, 'soixante et onze'],
      [72, 'soixante-douze'],
      [80, 'quatre-vingts'],
      [81, 'quatre-vingt-un'],
      [91, 'quatre-vingt-onze'],
      [100, 'cent'],
      [200, 'deux cents'],
      [201, 'deux cent un'],
      [1000, 'mille'],
      [1080, 'mille quatre-vingts'],
      [80_000, 'quatre-vingt mille'],
      [200_000, 'deux cent mille'],
      [1_200_000, 'un million deux cent mille'],
      [200_000_000, 'deux cents millions'],
      [80_000_000, 'quatre-vingts millions'],
      [2_000_001_000, 'deux milliards mille'],
      [118_000, 'cent dix-huit mille'],
      [999_999, 'neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf'],
    ];
    for (const [n, words] of cases) expect(numberToFrenchWords(n)).toBe(words);
    expect(() => numberToFrenchWords(-1)).toThrow();
    expect(() => numberToFrenchWords(1.5)).toThrow();
    expect(factureAmountInWords('QUOTE', 1_180_000)).toBe(
      'Arrêté le présent devis à la somme de un million cent quatre-vingt mille francs CFA toutes taxes comprises.',
    );
    expect(factureAmountInWords('INVOICE', 1)).toBe(
      'Arrêtée la présente facture à la somme de un franc CFA toutes taxes comprises.',
    );
  });

  it('permissions F1 : commercial et comptable gèrent les documents, le technicien non', () => {
    expect(hasFacturePermission('SALES', 'facture.documents.manage')).toBe(true);
    expect(hasFacturePermission('SALES', 'facture.catalog.manage')).toBe(true);
    expect(hasFacturePermission('ACCOUNTANT', 'facture.documents.manage')).toBe(true);
    expect(hasFacturePermission('ACCOUNTANT', 'facture.catalog.manage')).toBe(false);
    expect(hasFacturePermission('TECHNICIAN', 'facture.documents.read')).toBe(false);
    expect(hasFacturePermission('TECHNICIAN', 'facture.clients.read')).toBe(true);
    expect(hasFacturePermission('TECHNICIAN', 'facture.clients.manage')).toBe(false);
  });
});

describe('facturation : reste dû, statut, encaissement, avoir, échéance', () => {
  const invoice = (over: Partial<Parameters<typeof canRecordFacturePayment>[0]> = {}) => ({
    type: 'INVOICE' as const,
    status: 'SENT' as const,
    totalTtc: 59_000,
    amountPaid: 0,
    amountCredited: 0,
    ...over,
  });

  it('reste dû et statut déduits des encaissements et avoirs', () => {
    const s = (paid: number, credited: number, sent = true) =>
      factureInvoiceStatus({ ...invoice({ amountPaid: paid, amountCredited: credited }), sent });
    expect(s(0, 0, false)).toBe('ISSUED');
    expect(s(0, 0)).toBe('SENT');
    expect(s(20_000, 0)).toBe('PARTIALLY_PAID');
    expect(s(0, 29_500)).toBe('PARTIALLY_PAID');
    expect(s(59_000, 0)).toBe('PAID');
    expect(s(29_500, 29_500)).toBe('PAID');
    expect(s(0, 59_000)).toBe('CREDITED');
    // Avoir après paiement complet : trop-perçu (reste dû négatif), facture soldée.
    expect(factureBalance(invoice({ amountPaid: 59_000, amountCredited: 29_500 }))).toBe(-29_500);
    expect(s(59_000, 29_500)).toBe('PAID');
  });

  it('encaissement et avoir : sur une facture émise qui reste due ou créditable', () => {
    expect(canRecordFacturePayment(invoice())).toBe(true);
    expect(canRecordFacturePayment(invoice({ status: 'DRAFT' }))).toBe(false);
    expect(canRecordFacturePayment(invoice({ status: 'PAID', amountPaid: 59_000 }))).toBe(false);
    expect(canRecordFacturePayment(invoice({ type: 'QUOTE' }))).toBe(false);
    expect(canCreditFactureInvoice(invoice({ status: 'PAID', amountPaid: 59_000 }))).toBe(true);
    expect(canCreditFactureInvoice(invoice({ amountCredited: 59_000, status: 'CREDITED' }))).toBe(
      false,
    );
    expect(canCreditFactureInvoice(invoice({ status: 'DRAFT' }))).toBe(false);
  });

  it('échéance dépassée : la veille au plus tard, et seulement si un reste est dû', () => {
    const today = new Date('2026-11-10T23:30:00Z');
    expect(isFactureOverdue({ ...invoice(), dueDate: '2026-11-09' }, today)).toBe(true);
    expect(isFactureOverdue({ ...invoice(), dueDate: '2026-11-10' }, today)).toBe(false);
    expect(isFactureOverdue({ ...invoice(), dueDate: null }, today)).toBe(false);
    expect(
      isFactureOverdue(
        { ...invoice({ status: 'PAID', amountPaid: 59_000 }), dueDate: '2026-10-01' },
        today,
      ),
    ).toBe(false);
  });

  it('avoirs et encaissements réservés au gérant et au comptable', () => {
    expect(hasFacturePermission('ACCOUNTANT', 'facture.billing.manage')).toBe(true);
    expect(hasFacturePermission('MANAGER', 'facture.reports.read')).toBe(true);
    expect(hasFacturePermission('SALES', 'facture.billing.manage')).toBe(false);
    expect(hasFacturePermission('SALES', 'facture.reports.read')).toBe(false);
    expect(hasFacturePermission('TECHNICIAN', 'facture.billing.manage')).toBe(false);
  });
});
