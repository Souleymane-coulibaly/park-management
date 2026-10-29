/**
 * Point d'extension des paiements électroniques (Wave en premier), commun aux abonnements
 * et à la caisse. AUCUNE implémentation n'est fournie : Ocall Park ne dispose pas encore d'un
 * accès actif à l'API Wave, et aucun paiement électronique n'est traité.
 *
 * Règles de sécurité pour l'implémentation future :
 * - le montant vient toujours du serveur (tarif, total de vente), jamais du client ;
 * - un paiement n'est confirmé (et un abonnement activé) que par une notification serveur à
 *   serveur dont la signature a été vérifiée (`parseVerifiedEvent`), rapprochée de la session
 *   de paiement créée par l'API — jamais sur la foi d'une redirection ou d'un appel du frontend ;
 * - la confirmation d'un paiement de vente ne modifie jamais le statut de préparation cuisine.
 */
export interface CheckoutSession {
  providerSessionId: string;
  /** URL ou code de paiement présenté au client. */
  checkoutUrl: string;
  expiresAt: Date;
}

export interface CreateCheckoutInput {
  organizationId: string;
  /** Référence interne rapprochée lors de la notification (identifiant de paiement ou d'abonnement). */
  reference: string;
  /** Montant entier en FCFA, calculé par le serveur. */
  amount: number;
  currency: 'XOF';
  successUrl: string;
  errorUrl: string;
}

export interface VerifiedPaymentEvent {
  providerSessionId: string;
  reference: string;
  status: 'succeeded' | 'failed';
  amount: number;
  currency: string;
  occurredAt: Date;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Vérifie la signature de la notification ; lève une erreur si elle est invalide. */
  parseVerifiedEvent(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<VerifiedPaymentEvent>;
}
