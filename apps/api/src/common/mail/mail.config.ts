/**
 * Configuration de l'envoi d'e-mails (Sprint S3). Fournisseur Resend en préproduction / production ;
 * fournisseur SIMULÉ (aucun envoi, messages gardés en mémoire) pour les tests ; désactivé par défaut.
 * Aucune clé dans le dépôt : `RESEND_API_KEY` vient de l'environnement (Railway).
 */
export type MailProvider = 'resend' | 'simulated' | 'disabled';

export interface MailConfig {
  provider: MailProvider;
  resendApiKey: string | null;
  /** Expéditeur, ex. `Ocall <partenaires@ocall.example>` (domaine vérifié chez Resend). */
  from: string;
  /** Adresses de l'équipe Ocall alertées des nouvelles candidatures partenaires. */
  partnerAlertRecipients: string[];
  /** Origine publique du site web, pour les liens des e-mails (sans barre finale). */
  webBaseUrl: string;
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function loadMailConfig(
  env: NodeJS.ProcessEnv,
  nodeEnv: string,
  webOrigins: string[],
): MailConfig {
  const raw = (env.MAIL_PROVIDER ?? 'disabled').trim();
  if (raw !== 'resend' && raw !== 'simulated' && raw !== 'disabled') {
    throw new Error('MAIL_PROVIDER invalide : resend, simulated ou disabled.');
  }
  const provider: MailProvider = raw;
  if (provider === 'simulated' && nodeEnv === 'production') {
    throw new Error('MAIL_PROVIDER=simulated est interdit en production.');
  }
  const resendApiKey = env.RESEND_API_KEY?.trim() || null;
  const from = env.MAIL_FROM?.trim() || 'Ocall <no-reply@localhost>';
  if (provider === 'resend' && (!resendApiKey || !env.MAIL_FROM?.trim())) {
    throw new Error('MAIL_PROVIDER=resend exige RESEND_API_KEY et MAIL_FROM.');
  }
  const partnerAlertRecipients = (env.PARTNER_ALERT_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const invalid = partnerAlertRecipients.filter((e) => !EMAIL.test(e));
  if (invalid.length > 0) {
    throw new Error('PARTNER_ALERT_EMAILS invalide : adresses séparées par des virgules.');
  }
  const webBaseUrl = (
    env.PUBLIC_WEB_URL?.trim() ||
    webOrigins[0] ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  return { provider, resendApiKey, from, partnerAlertRecipients, webBaseUrl };
}
