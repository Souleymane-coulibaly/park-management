import { factureLegalMissing } from '@ocall/shared';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';
import type { FacturePrismaService } from './facture-prisma.service';

/**
 * Charte des documents Ocall Facture (devis, pro forma, bons de commande, factures, rapports) : en-tête
 * (jusqu'à 3 logos, nom, activité, coordonnées), pied de chaque page (jusqu'à 6 logos encadrant les
 * mentions légales et bancaires, numéro de page). Tous les documents Facture passent par ce module.
 */

export const FACTURE_INK = '#1d2a33';
export const FACTURE_MUTED = '#5a6670';
export const FACTURE_LINE = '#d8dee4';
export const FACTURE_ZEBRA = '#f6f8fa';

export interface FactureLetterheadIdentity {
  legalName: string;
  tradeName: string | null;
  /** Activité ou slogan, sous le nom de l'entreprise. */
  description?: string | null;
  address: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  nif: string | null;
  rccm: string | null;
  taxRegime: string | null;
  bankDetails: string | null;
  legalFooter: string | null;
}

/** Logos d'une organisation, prêts à imprimer. */
export interface FactureLogos {
  /** En-tête : logo principal d'abord, 3 au plus. */
  header: Buffer[];
  /** Pied de page : 6 au plus, répartis à gauche et à droite des mentions. */
  footer: Buffer[];
  /** Cachet ou signature, dans la case « Le fournisseur ». */
  stamp: Buffer | null;
}

export const NO_FACTURE_LOGOS: FactureLogos = { header: [], footer: [], stamp: null };

/** Couleur mélangée au blanc (`ratio` de blanc) : fonds teintés de la couleur d'accent. */
export function tint(hex: string, ratio: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${[r, g, b].map((c) => c!.toString(16).padStart(2, '0')).join('')}`;
}

/** Image dans un cadre ; une image illisible est ignorée, jamais d'échec du document. */
export function drawImage(
  doc: PDFKit.PDFDocument,
  image: Buffer,
  x: number,
  y: number,
  fit: [number, number],
): boolean {
  try {
    doc.image(image, x, y, { fit, align: 'center', valign: 'center' });
    return true;
  } catch {
    return false;
  }
}

const addressOf = (identity: FactureLetterheadIdentity) => {
  const place = [identity.address, identity.city].filter(Boolean).join(', ');
  return place ? `${place}${identity.country === 'ML' ? ' — Mali' : ''}` : null;
};

/**
 * En-tête : filet d'accent en haut de page, logos à gauche, identité alignée à droite (nom, activité,
 * adresse, téléphone, e-mail). Sans logo, l'identité occupe toute la largeur. Renvoie l'ordonnée libre.
 */
export function drawLetterhead(
  doc: PDFKit.PDFDocument,
  identity: FactureLetterheadIdentity,
  logos: readonly Buffer[],
  accent = '#1f6f4a',
): number {
  const left = PDF_PAGE.margin;
  const right = PDF_PAGE.width - PDF_PAGE.margin;
  doc.rect(0, 0, PDF_PAGE.width, 6).fill(accent);
  const top = PDF_PAGE.margin - 6;
  let logosRight = left;
  let logosBottom = top;
  logos.slice(0, 3).forEach((logo) => {
    if (drawImage(doc, logo, logosRight, top, [84, 52])) {
      logosRight += 92;
      logosBottom = top + 52;
    }
  });
  const textLeft = logosRight === left ? left : logosRight + 8;
  const width = right - textLeft;
  const align = logosRight === left ? 'left' : 'right';
  let y = top;
  doc.font('sansBold').fontSize(17).fillColor(FACTURE_INK);
  doc.text(identity.legalName, textLeft, y, { width, align });
  y = doc.y;
  if (identity.description) {
    doc.font('sans').fontSize(9).fillColor(accent);
    doc.text(identity.description.toUpperCase(), textLeft, y + 1, {
      width,
      align,
      characterSpacing: 0.4,
    });
    y = doc.y;
  }
  doc.font('sans').fontSize(8.5).fillColor(FACTURE_MUTED);
  const lines = [
    identity.tradeName && identity.tradeName !== identity.legalName ? identity.tradeName : null,
    addressOf(identity),
    [identity.phone ? `Tél. ${identity.phone}` : null, identity.email]
      .filter(Boolean)
      .join('  ·  ') || null,
  ].filter((l): l is string => Boolean(l));
  for (const line of lines) {
    doc.text(line, textLeft, y + 2, { width, align });
    y = doc.y;
  }
  y = Math.max(y, logosBottom) + 12;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(FACTURE_LINE).lineWidth(0.8).stroke();
  return y + 14;
}

/** Hauteur réservée au pied de chaque page (logos et mentions), au-dessus de la marge basse. */
export function footerHeight(
  doc: PDFKit.PDFDocument,
  identity: FactureLetterheadIdentity,
  logos: readonly Buffer[],
): number {
  const text = footerText(identity);
  const side = logos.length > 0 ? 3 * 46 : 0;
  doc.font('sans').fontSize(7.5);
  const textHeight = text ? doc.heightOfString(text, { width: PDF_CONTENT_WIDTH - 2 * side }) : 0;
  return Math.max(textHeight, logos.length > 0 ? 38 : 0) + 18;
}

function footerText(identity: FactureLetterheadIdentity): string {
  const legal = [
    identity.legalName,
    identity.rccm ? `RCCM ${identity.rccm}` : null,
    identity.nif ? `NIF ${identity.nif}` : null,
    identity.taxRegime,
  ]
    .filter(Boolean)
    .join('  ·  ');
  return [legal, identity.bankDetails, identity.legalFooter]
    .filter((p): p is string => Boolean(p?.trim()))
    .join(String.fromCharCode(10));
}

/**
 * Pied d'une page : filet, logos répartis à gauche et à droite (3 de chaque côté), mentions légales et
 * bancaires au centre, numéro de page. La marge basse est neutralisée le temps du dessin (sinon pdfkit
 * ouvrirait une page).
 */
export function drawFooter(
  doc: PDFKit.PDFDocument,
  identity: FactureLetterheadIdentity,
  logos: readonly Buffer[],
  page?: { index: number; total: number },
): void {
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const height = footerHeight(doc, identity, logos);
  const top = PDF_PAGE.height - PDF_PAGE.margin - height + 10;
  const left = PDF_PAGE.margin;
  const right = PDF_PAGE.width - PDF_PAGE.margin;
  doc
    .moveTo(left, top - 6)
    .lineTo(right, top - 6)
    .strokeColor(FACTURE_LINE)
    .lineWidth(0.6)
    .stroke();
  const leftLogos = logos.slice(0, Math.ceil(logos.length / 2));
  const rightLogos = logos.slice(leftLogos.length);
  leftLogos.forEach((logo, i) => drawImage(doc, logo, left + i * 46, top, [42, 36]));
  rightLogos.forEach((logo, i) =>
    drawImage(doc, logo, right - (rightLogos.length - i) * 46 + 4, top, [42, 36]),
  );
  const side = logos.length > 0 ? 3 * 46 : 0;
  const text = footerText(identity);
  if (text) {
    doc.font('sans').fontSize(7.5).fillColor(FACTURE_MUTED);
    doc.text(text, left + side, top, { width: PDF_CONTENT_WIDTH - 2 * side, align: 'center' });
  }
  if (page) {
    doc.font('sans').fontSize(7).fillColor(FACTURE_MUTED);
    doc.text(`Page ${page.index} / ${page.total}`, left, PDF_PAGE.height - 24, {
      width: PDF_CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
  }
  doc.page.margins.bottom = bottomMargin;
}

/**
 * Logos d'une organisation, dans leur ordre : en-tête = logo principal puis logos d'en-tête ajoutés ;
 * bas de page ; cachet. Un fichier absent ou illisible est ignoré.
 */
export async function loadFactureLogos(
  db: FacturePrismaService,
  storage: { get: (key: string) => Promise<Buffer | null> },
  organizationId: string,
): Promise<FactureLogos> {
  const [settings, rows] = await Promise.all([
    db.factureSettings.findUnique({ where: { organizationId }, select: { logoKey: true } }),
    db.factureLogo.findMany({
      where: { organizationId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { storageKey: true, placement: true },
    }),
  ]);
  const read = (key: string) => storage.get(key).catch(() => null);
  const keys = (placement: string) =>
    rows.filter((r) => r.placement === placement).map((r) => read(r.storageKey));
  const [header, footer, stamp] = await Promise.all([
    Promise.all([...(settings?.logoKey ? [read(settings.logoKey)] : []), ...keys('HEADER')]),
    Promise.all(keys('FOOTER')),
    Promise.all(keys('STAMP')),
  ]);
  const present = (b: Buffer | null): b is Buffer => Boolean(b);
  return {
    header: header.filter(present).slice(0, 3),
    footer: footer.filter(present).slice(0, 6),
    stamp: stamp.find(present) ?? null,
  };
}

/** Aperçu de l'en-tête et du pied, avec les mentions recommandées encore manquantes. */
export function renderLetterheadPreview(
  identity: FactureLetterheadIdentity & { accentColor?: string },
  logos: FactureLogos,
): Promise<Buffer> {
  return renderPdfDocument({ title: 'Aperçu de l’en-tête', creator: 'Ocall Facture' }, (doc) => {
    doc.addPage();
    let y = drawLetterhead(doc, identity, logos.header, identity.accentColor);
    doc.font('sansBold').fontSize(12).fillColor(FACTURE_INK);
    doc.text('Aperçu de l’en-tête de vos documents', PDF_PAGE.margin, y, {
      width: PDF_CONTENT_WIDTH,
    });
    y = doc.y + 8;
    const missing = factureLegalMissing(identity);
    doc.font('sans').fontSize(10).fillColor(FACTURE_MUTED);
    doc.text(
      missing.length === 0
        ? 'Toutes les mentions recommandées sont renseignées.'
        : `Mentions recommandées encore absentes (facultatives) : ${missing.join(', ')}.`,
      PDF_PAGE.margin,
      y,
      { width: PDF_CONTENT_WIDTH },
    );
    drawFooter(doc, identity, logos.footer, { index: 1, total: 1 });
  });
}
