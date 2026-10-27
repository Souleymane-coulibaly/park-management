/**
 * Point d'extension des paiements d'abonnement (Wave Checkout en premier).
 * Aucune implémentation au Sprint 1 : aucun paiement réel n'est traité.
 *
 * Règle de sécurité pour l'implémentation future : un abonnement n'est jamais activé
 * sur la foi d'une redirection ou d'un appel du frontend. Seule une notification serveur
 * à serveur dont la signature a été vérifiée (`parseVerifiedEvent`), puis rapprochée
 * de la session de paiement créée par l'API, peut faire passer un abonnement à ACTIVE.
 */
export interface CheckoutSession {
  providerSessionId: string;
  /** URL de paiement vers laquelle rediriger l'utilisateur. */
  checkoutUrl: string;
  expiresAt: Date;
}

export interface CreateCheckoutInput {
  organizationId: string;
  planId: string;
  /** Montant entier en FCFA, lu depuis SubscriptionPlan côté serveur, jamais depuis le client. */
  amount: number;
  currency: 'XOF';
  successUrl: string;
  errorUrl: string;
}

export interface VerifiedPaymentEvent {
  providerSessionId: string;
  status: 'succeeded' | 'failed';
  amount: number;
  currency: string;
  occurredAt: Date;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Vérifie la signature du webhook ; lève une erreur si elle est invalide. */
  parseVerifiedEvent(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<VerifiedPaymentEvent>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
