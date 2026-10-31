import {
  DEMO_FORM_MIN_FILL_MS,
  canConfirmPayment,
  canSubscribeToProduct,
  demoSpamReason,
  formatDemoRequestNumber,
  formatReceiptNumber,
  formatRemittanceNumber,
  invoiceRemaining,
  isProductBillable,
  isProductSlug,
  isPublicProductStatus,
  isSubscriptionCurrent,
} from './index';

describe('Sprint 12A — règles de commercialisation, règlements et démonstrations', () => {
  it('seul un produit commercialisé est souscriptible ; le pilote seulement par Ocall', () => {
    expect(canSubscribeToProduct('ACTIVE', 'customer')).toBe(true);
    expect(canSubscribeToProduct('PILOT', 'customer')).toBe(false);
    expect(canSubscribeToProduct('PILOT', 'ocall')).toBe(true);
    for (const s of ['PLANNED', 'COMING_SOON', 'SUSPENDED', 'RETIRED'] as const) {
      expect(canSubscribeToProduct(s, 'ocall')).toBe(false);
      expect(isProductBillable(s)).toBe(false);
    }
    expect(isPublicProductStatus('COMING_SOON')).toBe(true);
    expect(isPublicProductStatus('PLANNED')).toBe(false);
    expect(isPublicProductStatus('RETIRED')).toBe(false);
  });

  it('identifiant public d’un produit', () => {
    expect(isProductSlug('ocall-park')).toBe(true);
    expect(isProductSlug('Ocall_Park')).toBe(false);
    expect(isProductSlug('ocall--park')).toBe(false);
  });

  it('quatre yeux : ni le déclarant ni le collecteur ne confirment', () => {
    const p = { recordedById: 'a', collectedById: 'b' };
    expect(canConfirmPayment('a', p)).toBe(false);
    expect(canConfirmPayment('b', p)).toBe(false);
    expect(canConfirmPayment('c', p)).toBe(true);
    expect(canConfirmPayment('c', { recordedById: 'a', collectedById: null })).toBe(true);
  });

  it('reste dû : confirmés et en cours réservent la facture, pas les rejetés ni annulés', () => {
    expect(
      invoiceRemaining(15000, [
        { amount: 5000, status: 'CONFIRMED' },
        { amount: 3000, status: 'PENDING_VERIFICATION' },
        { amount: 1000, status: 'DECLARED' },
        { amount: 9000, status: 'REJECTED' },
        { amount: 9000, status: 'CANCELLED' },
        { amount: 9000, status: 'REFUNDED' },
      ]),
    ).toBe(6000);
    expect(invoiceRemaining(1000, [{ amount: 1500, status: 'CONFIRMED' }])).toBe(0);
  });

  it('abonnement en cours de validité', () => {
    const now = new Date('2026-11-15T00:00:00Z');
    expect(
      isSubscriptionCurrent({ status: 'ACTIVE', expiresAt: '2026-12-01T00:00:00Z' }, now),
    ).toBe(true);
    expect(
      isSubscriptionCurrent({ status: 'ACTIVE', expiresAt: '2026-11-01T00:00:00Z' }, now),
    ).toBe(false);
    expect(
      isSubscriptionCurrent({ status: 'SUSPENDED', expiresAt: '2026-12-01T00:00:00Z' }, now),
    ).toBe(false);
  });

  it('anti-spam : champ piège, envoi trop rapide, formulaire trop ancien', () => {
    const now = 1_000_000_000;
    expect(demoSpamReason({ website: 'x', startedAt: now - 10_000 }, now)).toBe('HONEYPOT');
    expect(demoSpamReason({ website: ' ', startedAt: now - 10_000 }, now)).toBeNull();
    expect(demoSpamReason({ startedAt: now - DEMO_FORM_MIN_FILL_MS + 1 }, now)).toBe('TOO_FAST');
    expect(demoSpamReason({ startedAt: now - 25 * 3600_000 }, now)).toBe('EXPIRED');
    expect(demoSpamReason({ startedAt: now - 30_000 }, now)).toBeNull();
  });

  it('numérotations', () => {
    expect(formatReceiptNumber(2026, 42)).toBe('REC-2026-00042');
    expect(formatRemittanceNumber(2026, 7)).toBe('RCA-2026-00007');
    expect(formatDemoRequestNumber(2026, 12)).toBe('DEM-2026-00012');
  });
});
