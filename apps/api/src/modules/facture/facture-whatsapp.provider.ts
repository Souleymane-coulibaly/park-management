/**
 * Fournisseur WhatsApp des notifications de rendez-vous (F4). L'interface isole le fournisseur réel (API
 * Cloud de Meta ou prestataire, encore à choisir), à brancher par un adaptateur dont la clé ne viendra
 * que de l'environnement. Seuls les fournisseurs désactivé et simulé sont livrés : aucun message réel.
 */

export const FACTURE_WHATSAPP_PROVIDER = Symbol('FACTURE_WHATSAPP_PROVIDER');

export interface WhatsAppMessage {
  /** Numéro au format international (+223 …). */
  to: string;
  /** Modèle approuvé par Meta et ses paramètres ; `body` en est le rendu, gardé dans l'historique. */
  template: string;
  body: string;
  /** Une même notification n'est jamais acceptée deux fois par le fournisseur. */
  idempotencyKey: string;
}

export interface WhatsAppProvider {
  /** Faux : aucun fournisseur branché, aucune notification WhatsApp programmée (e-mail en secours). */
  readonly enabled: boolean;
  /** Envoie un message ; renvoie l'identifiant du fournisseur, ou lève `WhatsAppProviderError`. */
  send(message: WhatsAppMessage): Promise<{ id: string }>;
}

export class WhatsAppProviderError extends Error {
  constructor(
    readonly code: string,
    /** Vrai si une nouvelle tentative peut réussir (indisponibilité, limite de débit). */
    readonly transient: boolean,
  ) {
    super(code);
  }
}

/** Aucun fournisseur : rien n'est envoyé par WhatsApp. */
export class DisabledWhatsAppProvider implements WhatsAppProvider {
  readonly enabled = false;
  send(): Promise<{ id: string }> {
    return Promise.reject(new WhatsAppProviderError('WHATSAPP_DISABLED', false));
  }
}

/**
 * Fournisseur simulé : messages gardés en mémoire, sans réseau. Comportements déterministes pour les
 * essais : un numéro terminé par 0000 est refusé définitivement ; un numéro terminé par 9999 échoue deux
 * fois (indisponibilité) puis réussit.
 */
export class SimulatedWhatsAppProvider implements WhatsAppProvider {
  readonly enabled = true;
  readonly sent: (WhatsAppMessage & { id: string })[] = [];
  private readonly failures = new Map<string, number>();

  async send(message: WhatsAppMessage): Promise<{ id: string }> {
    const digits = message.to.replace(/\D/g, '');
    if (digits.endsWith('0000')) throw new WhatsAppProviderError('NOT_ON_WHATSAPP', false);
    if (digits.endsWith('9999')) {
      const failed = this.failures.get(digits) ?? 0;
      if (failed < 2) {
        this.failures.set(digits, failed + 1);
        throw new WhatsAppProviderError('PROVIDER_UNAVAILABLE', true);
      }
    }
    const id = `wa-sim-${this.sent.length + 1}`;
    this.sent.push({ ...message, id });
    return { id };
  }
}
