/**
 * Fournisseur d'envoi de SMS (Sprint 6). L'interface isole le fournisseur réel, à brancher par un
 * adaptateur dont la clé ne vient que de l'environnement. Seul le fournisseur simulé est livré : aucun
 * SMS réel ne part, en test comme en développement.
 */

export const SCHOOL_SMS_PROVIDER = Symbol('SCHOOL_SMS_PROVIDER');

export interface SmsProvider {
  /** Envoie un SMS ; renvoie l'identifiant du fournisseur, ou lève `SmsProviderError`. */
  send(to: string, body: string): Promise<{ id: string }>;
}

export class SmsProviderError extends Error {
  constructor(
    readonly code: string,
    /** Vrai si une nouvelle tentative peut réussir (indisponibilité, limite de débit). */
    readonly transient: boolean,
  ) {
    super(code);
  }
}

/**
 * Fournisseur simulé : enregistre les messages en mémoire, sans réseau. Comportements déterministes pour
 * les essais : un numéro terminé par 0000 est refusé définitivement ; un numéro terminé par 9999 échoue
 * deux fois (indisponibilité) puis réussit.
 */
export class SimulatedSmsProvider implements SmsProvider {
  readonly sent: { to: string; body: string; id: string }[] = [];
  private readonly failures = new Map<string, number>();

  async send(to: string, body: string): Promise<{ id: string }> {
    const digits = to.replace(/\D/g, '');
    if (digits.endsWith('0000')) throw new SmsProviderError('INVALID_NUMBER', false);
    if (digits.endsWith('9999')) {
      const failed = this.failures.get(digits) ?? 0;
      if (failed < 2) {
        this.failures.set(digits, failed + 1);
        throw new SmsProviderError('PROVIDER_UNAVAILABLE', true);
      }
    }
    const id = `sim-${this.sent.length + 1}`;
    this.sent.push({ to, body, id });
    return { id };
  }
}
