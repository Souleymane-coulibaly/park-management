/**
 * Gabarit commun des e-mails transactionnels : texte brut et HTML simple, en français. Toute valeur
 * saisie par un utilisateur est échappée dans le HTML.
 */
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Assemble un e-mail : en-tête (marque), paragraphes, bouton facultatif, signature. */
export function composeMail(
  frame: { brand: string; signature: string },
  subject: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): MailContent {
  const text = [
    ...paragraphs,
    ...(action ? [`${action.label} : ${action.url}`] : []),
    frame.signature,
  ].join('\n\n');
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1f6f4a;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#555">Si le bouton ne fonctionne pas, copiez ce lien : ${escapeHtml(action.url)}</p>`
    : '';
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f4ee;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b"><div style="max-width:560px;margin:0 auto;padding:32px 24px"><p style="font-weight:700;font-size:18px;margin:0 0 24px">${escapeHtml(frame.brand)}</p>${body}${button}<p style="margin:24px 0 0">${escapeHtml(frame.signature)}</p></div></body></html>`;
  return { subject, text, html };
}
