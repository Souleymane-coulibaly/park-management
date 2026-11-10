import { PARTNER_INVITATION_TTL_DAYS, PARTNER_TYPE_LABELS, formatXof } from '@ocall/shared';

/**
 * Gabarits des e-mails Ocall Partner (Sprint S3) : texte brut et HTML simple, en français. Toute valeur
 * saisie par un utilisateur est échappée dans le HTML. Aucun mot de passe, aucune donnée métier client.
 */
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

type PartnerType = keyof typeof PARTNER_TYPE_LABELS;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SIGNATURE = 'L’équipe Ocall';

/** Assemble un e-mail : paragraphes (texte brut), bouton facultatif. */
function compose(
  subject: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): MailContent {
  const text = [
    ...paragraphs,
    ...(action ? [`${action.label} : ${action.url}`] : []),
    SIGNATURE,
  ].join('\n\n');
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1f6f4a;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#555">Si le bouton ne fonctionne pas, copiez ce lien : ${escapeHtml(action.url)}</p>`
    : '';
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f4ee;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b"><div style="max-width:560px;margin:0 auto;padding:32px 24px"><p style="font-weight:700;font-size:18px;margin:0 0 24px">Ocall Partner</p>${body}${button}<p style="margin:24px 0 0">${SIGNATURE}</p></div></body></html>`;
  return { subject, text, html };
}

export function applicationReceivedMail(a: {
  firstName: string;
  number: string;
  type: PartnerType;
}) {
  return compose(`Candidature Ocall Partner reçue (${a.number})`, [
    `Bonjour ${a.firstName},`,
    `Nous avons bien reçu votre candidature de ${PARTNER_TYPE_LABELS[a.type].toLowerCase()} (référence ${a.number}).`,
    'L’équipe Ocall l’examine et revient vers vous. Si elle est retenue, vous recevrez un lien pour créer votre espace partenaire.',
  ]);
}

export function applicationRejectedMail(a: { firstName: string; number: string }, reason: string) {
  return compose(`Votre candidature Ocall Partner (${a.number})`, [
    `Bonjour ${a.firstName},`,
    'Merci pour l’intérêt que vous portez à Ocall. Après examen, nous ne pouvons pas donner suite à votre candidature pour le moment.',
    `Motif : ${reason}`,
    'Vos informations seront anonymisées à l’issue de la durée de conservation indiquée dans notre politique de confidentialité.',
  ]);
}

export function invitationMail(
  a: { firstName: string; type: PartnerType },
  url: string,
  expiresAt: Date,
) {
  return compose(
    'Bienvenue chez Ocall Partner : créez votre espace',
    [
      `Bonjour ${a.firstName},`,
      `Votre candidature de ${PARTNER_TYPE_LABELS[a.type].toLowerCase()} est retenue.`,
      `Choisissez votre mot de passe avec le lien ci-dessous. Il est personnel, à usage unique et valable ${PARTNER_INVITATION_TTL_DAYS} jours (jusqu’au ${expiresAt.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}).`,
      'À la première connexion, vous configurerez la double authentification avec une application sur votre téléphone.',
      'Ne transférez pas cet e-mail. Si vous n’êtes pas à l’origine de cette candidature, ignorez-le.',
    ],
    { label: 'Créer mon espace partenaire', url },
  );
}

export function newApplicationAlertMail(
  a: { number: string; type: PartnerType; city: string; country: string },
  url: string,
) {
  return compose(
    `Nouvelle candidature partenaire ${a.number}`,
    [
      `Une candidature de ${PARTNER_TYPE_LABELS[a.type].toLowerCase()} a été déposée (${a.number}, ${a.city}, ${a.country}).`,
      'Elle est à examiner dans l’administration Ocall.',
    ],
    { label: 'Examiner les candidatures', url },
  );
}

export function payoutConfirmedMail(
  p: { contactName: string },
  payout: { number: string; total: number; method: string },
  url: string,
) {
  return compose(
    `Règlement de vos primes ${payout.number}`,
    [
      `Bonjour ${p.contactName},`,
      `Le règlement ${payout.number} de ${formatXof(payout.total)} (${payout.method}) est confirmé par Ocall.`,
      'Le détail des primes réglées est disponible dans votre espace partenaire.',
    ],
    { label: 'Voir mes primes', url },
  );
}

export function payoutRequestDecidedMail(
  p: { contactName: string },
  request: { amount: number },
  outcome: 'PROCESSED' | 'REJECTED',
  note: string | null,
  url: string,
) {
  return compose(
    outcome === 'PROCESSED'
      ? 'Votre demande de règlement est traitée'
      : 'Votre demande de règlement n’a pas été retenue',
    [
      `Bonjour ${p.contactName},`,
      outcome === 'PROCESSED'
        ? `Votre demande de règlement de ${formatXof(request.amount)} est traitée : le versement correspondant est confirmé.`
        : `Votre demande de règlement de ${formatXof(request.amount)} n’a pas été retenue.${note ? `\nMotif : ${note}` : ''}`,
    ],
    { label: 'Voir mes primes', url },
  );
}
