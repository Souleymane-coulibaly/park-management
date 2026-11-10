import type { AppConfig } from '../../config/app-config';
import { loadMailConfig } from './mail.config';
import { MailService } from './mail.service';
import { applicationRejectedMail, invitationMail } from './partner-mails';

const ORIGINS = ['https://app.example.com'];
const service = (env: NodeJS.ProcessEnv) =>
  new MailService({ mail: loadMailConfig(env, 'development', ORIGINS) } as AppConfig);
const message = {
  to: ['candidat@example.com'],
  subject: 'Sujet',
  text: 'Texte',
  html: '<p>Texte</p>',
  tag: 'partner-invitation',
  idempotencyKey: 'partner-invitation/abc',
};

describe('configuration des e-mails', () => {
  it('désactivé par défaut ; Resend exige clé et expéditeur ; simulé interdit en production', () => {
    expect(loadMailConfig({}, 'production', ORIGINS)).toMatchObject({
      provider: 'disabled',
      webBaseUrl: 'https://app.example.com',
    });
    expect(() => loadMailConfig({ MAIL_PROVIDER: 'resend' }, 'production', ORIGINS)).toThrow(
      'RESEND_API_KEY',
    );
    expect(() => loadMailConfig({ MAIL_PROVIDER: 'simulated' }, 'production', ORIGINS)).toThrow(
      'interdit en production',
    );
    expect(() => loadMailConfig({ MAIL_PROVIDER: 'smtp' }, 'development', ORIGINS)).toThrow(
      'MAIL_PROVIDER invalide',
    );
    expect(() =>
      loadMailConfig(
        { PARTNER_ALERT_EMAILS: 'ok@example.com, pas-une-adresse' },
        'development',
        [],
      ),
    ).toThrow('PARTNER_ALERT_EMAILS');
    expect(
      loadMailConfig(
        {
          MAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 're_test',
          MAIL_FROM: 'Ocall <partenaires@example.com>',
          PARTNER_ALERT_EMAILS: 'a@example.com, b@example.com',
          PUBLIC_WEB_URL: 'https://ocall.example.com/',
        },
        'production',
        ORIGINS,
      ),
    ).toMatchObject({
      provider: 'resend',
      partnerAlertRecipients: ['a@example.com', 'b@example.com'],
      webBaseUrl: 'https://ocall.example.com',
    });
  });
});

describe('MailService', () => {
  it('désactivé : rien n’est envoyé ; simulé : message gardé en mémoire', async () => {
    expect(await service({}).send(message)).toBe(false);
    const simulated = service({ MAIL_PROVIDER: 'simulated' });
    expect(await simulated.send(message)).toBe(true);
    expect(simulated.outbox).toHaveLength(1);
    expect(await simulated.send({ ...message, to: [] })).toBe(false);
  });

  it('Resend : requête authentifiée, idempotente ; un échec ne lève jamais d’exception', async () => {
    const mail = service({
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_secret',
      MAIL_FROM: 'Ocall <partenaires@example.com>',
    });
    const calls: { url: string; init: RequestInit }[] = [];
    mail.fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    expect(await mail.send(message)).toBe(true);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_secret');
    expect(headers['Idempotency-Key']).toBe('partner-invitation/abc');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      from: 'Ocall <partenaires@example.com>',
      to: ['candidat@example.com'],
      subject: 'Sujet',
    });
    mail.fetchImpl = (async () => new Response('{}', { status: 422 })) as typeof fetch;
    expect(await mail.send(message)).toBe(false);
    mail.fetchImpl = (async () => {
      throw new TypeError('réseau');
    }) as typeof fetch;
    expect(await mail.send(message)).toBe(false);
  });
});

describe('gabarits Ocall Partner', () => {
  it('échappe les valeurs saisies dans le HTML ; le lien d’invitation figure dans le message', () => {
    const rejected = applicationRejectedMail(
      { firstName: '<script>alert(1)</script>', number: 'CAND-2026-00001' },
      'Zone "déjà couverte" & complète',
    );
    expect(rejected.html).not.toContain('<script>');
    expect(rejected.html).toContain('&lt;script&gt;');
    expect(rejected.html).toContain('&quot;déjà couverte&quot; &amp; complète');
    expect(rejected.text).toContain('Motif : Zone "déjà couverte" & complète');
    const url = 'https://app.example.com/activation-partenaire?token=abc_DEF-123';
    const invitation = invitationMail(
      { firstName: 'Awa', type: 'RESELLER' },
      url,
      new Date('2026-11-17T10:00:00Z'),
    );
    expect(invitation.text).toContain(url);
    expect(invitation.html).toContain(url);
    expect(invitation.text).toContain('17/11/2026');
  });
});
