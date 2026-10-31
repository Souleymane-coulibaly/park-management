/**
 * Prestataire de paiement en ligne des factures SaaS (Sprint 12A). L'adaptateur CinetPay réel
 * implémentera cette interface ; le simulateur sert aux tests et à la démonstration.
 *
 * Règle de sécurité : une notification n'est qu'un signal. Elle doit être authentifiée, puis la
 * transaction est TOUJOURS revérifiée par un appel serveur (`verify`) avant toute confirmation.
 */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type OnlineChannel = 'ALL' | 'MOBILE_MONEY' | 'CREDIT_CARD';

export interface InitiateInput {
  reference: string;
  amount: number;
  currency: string;
  description: string;
  channels: OnlineChannel;
  notifyUrl: string;
  returnUrl: string;
  customer: { name: string; email: string | null; phone: string | null };
}

export interface InitiateResult {
  paymentUrl: string;
  providerTransactionId: string | null;
}

/** Résultat d'une vérification serveur : seule source de vérité sur l'issue d'un paiement. */
export interface VerifyResult {
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'PENDING';
  amount: number | null;
  currency: string | null;
  /** Canal effectivement utilisé, s'il est connu. */
  method: 'CARD' | 'MOBILE_MONEY' | null;
  providerTransactionId: string | null;
  /** Code brut du prestataire (journalisé, jamais affiché tel quel au client). */
  providerCode: string | null;
}

export interface OnlinePaymentProvider {
  readonly name: 'SIMULATED' | 'CINETPAY';
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(reference: string): Promise<VerifyResult>;
  /**
   * Authentifie une notification reçue et en extrait la référence marchand ; null si la
   * notification n'est pas authentique (elle est alors journalisée et ignorée).
   */
  authenticateNotification(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): string | null;
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED',
    message: string,
  ) {
    super(message);
  }
}
