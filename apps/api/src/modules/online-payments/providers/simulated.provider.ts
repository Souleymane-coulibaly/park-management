import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  InitiateInput,
  InitiateResult,
  OnlinePaymentProvider,
  VerifyResult,
} from './payment-provider';

export type SimulatedOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'PENDING';

interface SimulatedTransaction {
  amount: number;
  currency: string;
  status: SimulatedOutcome;
  method: 'CARD' | 'MOBILE_MONEY' | null;
  providerTransactionId: string;
}

/**
 * Prestataire simulé (tests, démonstration ; interdit en production). Il tient ses transactions
 * en mémoire comme le ferait le prestataire, signe ses notifications (HMAC-SHA256 de la référence)
 * et répond aux vérifications. Aucun appel réseau, aucun coût.
 */
export class SimulatedPaymentProvider implements OnlinePaymentProvider {
  readonly name = 'SIMULATED' as const;
  private readonly transactions = new Map<string, SimulatedTransaction>();

  constructor(
    private readonly secret: Buffer,
    private readonly checkoutBaseUrl: string,
  ) {}

  initiate(input: InitiateInput): Promise<InitiateResult> {
    const providerTransactionId = `SIM-${randomBytes(6).toString('hex')}`;
    this.transactions.set(input.reference, {
      amount: input.amount,
      currency: input.currency,
      status: 'PENDING',
      method: null,
      providerTransactionId,
    });
    return Promise.resolve({
      paymentUrl: `${this.checkoutBaseUrl}/paiement-simule/${encodeURIComponent(input.reference)}`,
      providerTransactionId,
    });
  }

  verify(reference: string): Promise<VerifyResult> {
    const t = this.transactions.get(reference);
    if (!t) {
      return Promise.resolve({
        status: 'FAILED',
        amount: null,
        currency: null,
        method: null,
        providerTransactionId: null,
        providerCode: 'UNKNOWN_TRANSACTION',
      });
    }
    return Promise.resolve({
      status: t.status,
      amount: t.amount,
      currency: t.currency,
      method: t.method,
      providerTransactionId: t.providerTransactionId,
      providerCode: `SIM_${t.status}`,
    });
  }

  /**
   * Issue choisie sur la page de paiement simulée. `amount` permet de simuler un prestataire qui
   * annonce un montant différent (contrôle de cohérence côté serveur).
   */
  complete(
    reference: string,
    outcome: SimulatedOutcome,
    options: { method?: 'CARD' | 'MOBILE_MONEY'; amount?: number } = {},
  ): boolean {
    const t = this.transactions.get(reference);
    if (!t) return false;
    t.status = outcome;
    t.method = outcome === 'SUCCEEDED' ? (options.method ?? 'MOBILE_MONEY') : null;
    if (options.amount !== undefined) t.amount = options.amount;
    return true;
  }

  /** Jeton de notification : HMAC-SHA256 de la référence (en-tête x-simulated-token). */
  sign(reference: string): string {
    return createHmac('sha256', this.secret).update(`notify:${reference}`).digest('hex');
  }

  authenticateNotification(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): string | null {
    const reference =
      typeof body === 'object' && body !== null && 'reference' in body
        ? (body as { reference: unknown }).reference
        : null;
    const token = headers['x-simulated-token'];
    if (typeof reference !== 'string' || typeof token !== 'string' || reference.length > 64) {
      return null;
    }
    const expected = Buffer.from(this.sign(reference), 'hex');
    const received = Buffer.from(token, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    return reference;
  }
}
