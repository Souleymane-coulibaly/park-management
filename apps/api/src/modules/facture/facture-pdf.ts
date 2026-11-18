import { factureLegalMissing } from '@ocall/shared';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';
import {
  FACTURE_INK,
  FACTURE_MUTED,
  type FactureLetterheadIdentity,
  type FactureLogos,
  drawFooter,
  drawLetterhead,
} from '../../common/pdf/letterhead';
import type { FacturePrismaService } from './facture-prisma.service';

/**
 * Charte des documents Ocall Facture : la charte commune (common/pdf/letterhead), plus les logos de
 * l'organisation et l'aperçu de l'en-tête. Tous les documents Facture passent par ce module.
 */
export * from '../../common/pdf/letterhead';

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
