import { CONTENT, LINE, MUTED, PAGE, Writer, renderPdf } from '../school-pdf';

/** Hauteur maximale d'un morceau de paragraphe : bien moins qu'une page utile. */
const CHUNK_HEIGHT = 220;

/** Découpe un paragraphe, mot à mot, en morceaux dont la hauteur rendue ne dépasse pas `max`. */
export function chunks(w: Writer, text: string, max: number): string[] {
  if (w.height(text, CONTENT, { size: 10 }) <= max) return [text];
  const out: string[] = [];
  let current: string[] = [];
  for (const word of text.split(/\s+/)) {
    const next = [...current, word];
    if (current.length && w.height(next.join(' '), CONTENT, { size: 10 }) > max) {
      out.push(current.join(' '));
      current = [word];
    } else {
      current = next;
    }
  }
  if (current.length) out.push(current.join(' '));
  return out;
}

/**
 * PDF d'un contenu pédagogique validé (Ocall School AI) : socle PDF des bulletins (polices embarquées,
 * arabe de droite à gauche), A4, paginé. Produit à la demande, jamais stocké.
 */
export function renderTeachingDocument(doc: {
  arabic: boolean;
  school: string;
  title: string;
  meta: string[];
  sections: { heading: string; body: string }[];
}): Promise<Buffer> {
  const align = doc.arabic ? 'right' : 'left';
  return renderPdf(doc.title, (pdf) => {
    const w = new Writer(pdf);
    const bottom = PAGE.height - PAGE.margin;
    let y = PAGE.margin;
    pdf.addPage();
    const ensure = (height: number) => {
      if (y + height > bottom) {
        pdf.addPage();
        y = PAGE.margin;
      }
    };
    y += w.text(doc.school, PAGE.margin, y, CONTENT, { size: 9, color: MUTED, align }) + 4;
    y += w.text(doc.title, PAGE.margin, y, CONTENT, { size: 15, bold: true, align }) + 4;
    if (doc.meta.length) {
      y +=
        w.text(doc.meta.join(' · '), PAGE.margin, y, CONTENT, { size: 9, color: MUTED, align }) + 6;
    }
    pdf
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.margin + CONTENT, y)
      .strokeColor(LINE)
      .lineWidth(0.5)
      .stroke();
    y += 10;
    for (const section of doc.sections) {
      if (!section.body.trim()) continue;
      ensure(w.height(section.heading, CONTENT, { size: 11, bold: true }) + 30);
      y += w.text(section.heading, PAGE.margin, y, CONTENT, { size: 11, bold: true, align }) + 4;
      // Paragraphe par paragraphe : chacun peut passer à la page suivante.
      for (const paragraph of section.body.split(/\n+/)) {
        const text = paragraph.trim();
        if (!text) continue;
        // Un paragraphe plus haut qu'une page (l'arabe est dessiné ligne à ligne en position absolue)
        // est découpé en morceaux qui tiennent chacun dans une page : aucune ligne hors de la page.
        for (const chunk of chunks(w, text, CHUNK_HEIGHT)) {
          ensure(w.height(chunk, CONTENT, { size: 10 }));
          y += w.text(chunk, PAGE.margin, y, CONTENT, { size: 10, align }) + 3;
        }
      }
      y += 8;
    }
  });
}
