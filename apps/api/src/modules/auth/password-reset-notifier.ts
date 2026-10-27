import { Logger } from '@nestjs/common';

/**
 * Point d'extension pour la remise du lien de réinitialisation (e-mail, SMS, WhatsApp…).
 * Aucun fournisseur n'est intégré au Sprint 1.
 */
export interface PasswordResetNotifier {
  send(
    recipient: { userId: string; email: string; firstName: string },
    resetUrlPath: string,
  ): Promise<void>;
}

export const PASSWORD_RESET_NOTIFIER = Symbol('PASSWORD_RESET_NOTIFIER');

/**
 * Adaptateur de développement : écrit le lien dans la console, et UNIQUEMENT lorsque
 * NODE_ENV vaut explicitement « development ». Dans tout autre environnement (production,
 * pré-production, test, variable absente), ni le lien, ni le jeton, ni l'e-mail ne sont
 * journalisés : seul l'identifiant interne de l'utilisateur apparaît.
 */
export class LoggingPasswordResetNotifier implements PasswordResetNotifier {
  private readonly logger = new Logger('PasswordReset');

  constructor(private readonly nodeEnv: string | undefined = process.env.NODE_ENV) {}

  async send(recipient: { userId: string; email: string }, resetUrlPath: string): Promise<void> {
    if (this.nodeEnv !== 'development') {
      this.logger.warn(
        `Demande de réinitialisation pour l'utilisateur ${recipient.userId} : aucun fournisseur de remise configuré.`,
      );
      return;
    }
    this.logger.log(`[DEV] Lien de réinitialisation pour ${recipient.email} : ${resetUrlPath}`);
  }
}
