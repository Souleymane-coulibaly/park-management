import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { MailConfig } from './mail.config';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** Type d'e-mail, seul élément journalisé (jamais destinataires, contenu ni lien). */
  tag: string;
  /** Clé d'idempotence transmise au fournisseur (un même événement n'est envoyé qu'une fois). */
  idempotencyKey?: string;
}

type FetchLike = typeof fetch;

/**
 * Envoi d'e-mails transactionnels (Sprint S3). Toujours APRÈS la validation de la transaction métier et
 * sans jamais la faire échouer : un envoi raté est journalisé (type seulement) et signalé par `false`.
 * Le contenu, les destinataires et les liens d'invitation ne sont jamais journalisés.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  /** Fournisseur simulé : messages « envoyés », pour les tests (aucun envoi réel). */
  readonly outbox: MailMessage[] = [];
  private readonly mail: MailConfig;
  /** Client HTTP (remplaçable dans les tests unitaires du fournisseur Resend). */
  fetchImpl: FetchLike = (input, init) => fetch(input, init);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.mail = config.mail;
  }

  get enabled(): boolean {
    return this.mail.provider !== 'disabled';
  }

  get webBaseUrl(): string {
    return this.mail.webBaseUrl;
  }

  get partnerAlertRecipients(): string[] {
    return this.mail.partnerAlertRecipients;
  }

  async send(message: MailMessage): Promise<boolean> {
    const to = message.to.filter(Boolean);
    if (to.length === 0 || this.mail.provider === 'disabled') return false;
    if (this.mail.provider === 'simulated') {
      this.outbox.push({ ...message, to });
      return true;
    }
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.mail.resendApiKey}`,
          'Content-Type': 'application/json',
          ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.mail.from,
          to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          tags: [{ name: 'type', value: message.tag.replace(/[^A-Za-z0-9_-]/g, '_') }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(
          `E-mail « ${message.tag} » refusé par le fournisseur (HTTP ${res.status}).`,
        );
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(
        `E-mail « ${message.tag} » non envoyé (${e instanceof Error ? e.name : 'erreur'}).`,
      );
      return false;
    }
  }
}
