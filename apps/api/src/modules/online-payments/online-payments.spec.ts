import { randomBytes } from 'node:crypto';
import { loadOnlinePaymentsConfig } from './online-payments.config';
import { SimulatedPaymentProvider } from './providers/simulated.provider';

describe('Paiement en ligne (Sprint 12A)', () => {
  describe('configuration', () => {
    it('désactivé par défaut ; simulé interdit en production ; adaptateur réel non livré', () => {
      expect(loadOnlinePaymentsConfig({}, 'development').provider).toBe('none');
      expect(
        loadOnlinePaymentsConfig({ ONLINE_PAYMENT_PROVIDER: 'simulated' }, 'test').provider,
      ).toBe('simulated');
      expect(() =>
        loadOnlinePaymentsConfig({ ONLINE_PAYMENT_PROVIDER: 'simulated' }, 'production'),
      ).toThrow(/interdit en production/);
      expect(() =>
        loadOnlinePaymentsConfig({ ONLINE_PAYMENT_PROVIDER: 'cinetpay' }, 'development'),
      ).toThrow(/non livré/);
      expect(() =>
        loadOnlinePaymentsConfig({ ONLINE_PAYMENT_PROVIDER: 'wave' }, 'development'),
      ).toThrow();
    });
  });

  describe('prestataire simulé', () => {
    const provider = new SimulatedPaymentProvider(randomBytes(32), 'http://web.test');
    const input = {
      reference: 'OCS0123456789ABCDEF01',
      amount: 15000,
      currency: 'XOF',
      description: 'Facture',
      channels: 'ALL' as const,
      notifyUrl: 'http://api.test/notify',
      returnUrl: 'http://web.test/retour',
      customer: { name: 'Client', email: null, phone: null },
    };

    it('initialisation : en attente ; vérification fidèle à l’issue choisie', async () => {
      const init = await provider.initiate(input);
      expect(init.paymentUrl).toBe(`http://web.test/paiement-simule/${input.reference}`);
      expect((await provider.verify(input.reference)).status).toBe('PENDING');
      provider.complete(input.reference, 'SUCCEEDED', { method: 'CARD' });
      expect(await provider.verify(input.reference)).toMatchObject({
        status: 'SUCCEEDED',
        amount: 15000,
        currency: 'XOF',
        method: 'CARD',
      });
      expect((await provider.verify('OCSINCONNU')).status).toBe('FAILED');
    });

    it('notification : jeton HMAC exigé, comparaison à temps constant', () => {
      const token = provider.sign(input.reference);
      expect(
        provider.authenticateNotification(
          { 'x-simulated-token': token },
          { reference: input.reference },
        ),
      ).toBe(input.reference);
      expect(
        provider.authenticateNotification(
          { 'x-simulated-token': 'ab'.repeat(32) },
          { reference: input.reference },
        ),
      ).toBeNull();
      expect(provider.authenticateNotification({}, { reference: input.reference })).toBeNull();
      expect(
        provider.authenticateNotification({ 'x-simulated-token': token }, { reference: 'AUTRE' }),
      ).toBeNull();
      expect(provider.authenticateNotification({ 'x-simulated-token': token }, null)).toBeNull();
    });
  });
});
