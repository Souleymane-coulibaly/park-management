import { Injectable, Logger } from '@nestjs/common';

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
 * Adaptateur de développement : écrit le lien dans les journaux du serveur.
 * Désactivé en production (aucune remise tant qu'un fournisseur n'est pas branché),
 * pour ne jamais exposer un jeton dans des journaux de production.
 */
@Injectable()
export class LoggingPasswordResetNotifier implements PasswordResetNotifier {
  private readonly logger = new Logger('PasswordReset');

  async send(recipient: { userId: string; email: string }, resetUrlPath: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(`Aucun fournisseur de remise configuré (utilisateur ${recipient.userId}).`);
      return;
    }
    this.logger.log(`[DEV] Lien de réinitialisation pour ${recipient.email} : ${resetUrlPath}`);
  }
}
