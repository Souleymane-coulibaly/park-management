import { join } from 'node:path';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  PRINT_CARD_SIZE_MM,
  type PrintCardData,
  type PrintLayout,
  printFieldLabel,
  printFieldValue,
} from '@ocall/shared';
import { FONTS_DIR } from '../../common/pdf/pdf-document';
import { hasArabic, visualOrderRtl, visualRuns, words } from '../../common/pdf/rtl-text';

/**
 * Moteur de rendu COMMUN des cartes Ocall Print (School, Parc, Sabatii, accès autonome).
 *
 * Une seule mise en page, calculée en points (1/72 de pouce) à partir du modèle et des données de la
 * carte, produit une liste de primitives (rectangles, textes déjà ajustés, images, QR). Deux rendus la
 * dessinent sans rien recalculer : PDF (bon à tirer A4, fichier de production au format CR80) et SVG
 * (aperçu à l'écran). L'aperçu montre donc exactement ce qui sera imprimé, aux polices près.
 */

const MM = 72 / 25.4;
const MUTED = '#6B7280';
const PLACEHOLDER = '#E5E7EB';
const WHITE = '#FFFFFF';

export interface CardAssets {
  /** Photo du titulaire, déjà réencodée (JPEG) ; null : emplacement vide. */
  photo: Buffer | null;
  /** Logo du modèle (PNG) ; null : pas de logo. */
  logo: Buffer | null;
}

export interface RenderCard {
  layout: PrintLayout;
  data: PrintCardData;
  assets: CardAssets;
}

type Align = 'left' | 'center' | 'right';

export type Primitive =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string }
  | {
      t: 'text';
      x: number;
      w: number;
      /** Ligne de base du texte. */
      baseline: number;
      size: number;
      bold: boolean;
      color: string;
      text: string;
      align: Align;
      arabic: boolean;
    }
  | { t: 'image'; ref: 'photo' | 'logo'; x: number; y: number; w: number; h: number }
  | { t: 'photoSlot'; x: number; y: number; w: number; h: number }
  | { t: 'qr'; x: number; y: number; size: number; value: string };

export interface Side {
  width: number;
  height: number;
  prims: Primitive[];
}

// ─── Mesure du texte (polices Noto embarquées, identiques au PDF) ───

let measurer: PDFKit.PDFDocument | null = null;

function registerFonts(doc: PDFKit.PDFDocument) {
  doc.registerFont('sans', join(FONTS_DIR, 'NotoSans-Regular.ttf'));
  doc.registerFont('sansBold', join(FONTS_DIR, 'NotoSans-Bold.ttf'));
  doc.registerFont('naskh', join(FONTS_DIR, 'NotoNaskhArabic-Regular.ttf'));
  doc.registerFont('naskhBold', join(FONTS_DIR, 'NotoNaskhArabic-Bold.ttf'));
}

function measureDoc(): PDFKit.PDFDocument {
  if (!measurer) {
    measurer = new PDFDocument({ autoFirstPage: false });
    registerFonts(measurer);
  }
  return measurer;
}

const fontName = (arabicRun: boolean, bold: boolean) =>
  arabicRun ? (bold ? 'naskhBold' : 'naskh') : bold ? 'sansBold' : 'sans';

/** Morceaux d'une ligne dans l'ordre visuel (arabe de droite à gauche, latin conservé). */
function visualPieces(text: string, arabic: boolean) {
  if (!arabic) return [{ kind: 'ltr', text }];
  const placed = visualOrderRtl(words(text));
  const out: { kind: string; text: string }[] = [];
  placed.forEach((p, i) => {
    if (i > 0) out.push({ kind: 'neutral', text: ' ' });
    out.push(...visualRuns(p.word, p.rtl));
  });
  return out;
}

function widthOf(text: string, size: number, bold: boolean, arabic: boolean): number {
  const doc = measureDoc();
  return visualPieces(text, arabic).reduce((sum, piece) => {
    doc.font(fontName(piece.kind === 'arabic', bold)).fontSize(size);
    return sum + doc.widthOfString(piece.text);
  }, 0);
}

/** Texte tenu sur une ligne : police réduite jusqu'au minimum, puis coupé avec « … ». */
function fit(
  text: string,
  width: number,
  size: number,
  minSize: number,
  bold: boolean,
): { text: string; size: number; arabic: boolean } {
  const clean = text.replace(/\s+/g, ' ').trim();
  const arabic = hasArabic(clean);
  let s = size;
  while (s > minSize && widthOf(clean, s, bold, arabic) > width) s = Math.max(minSize, s - 0.25);
  if (widthOf(clean, s, bold, arabic) <= width) return { text: clean, size: s, arabic };
  let cut = clean;
  while (cut.length > 1 && widthOf(`${cut}…`, s, bold, arabic) > width) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, size: s, arabic };
}

function text(
  prims: Primitive[],
  value: string | null,
  o: {
    x: number;
    w: number;
    top: number;
    size: number;
    min?: number;
    bold?: boolean;
    color: string;
    align?: Align;
  },
) {
  if (!value || !value.trim()) return;
  const f = fit(value, o.w, o.size, o.min ?? Math.min(o.size, 4.5), o.bold ?? false);
  prims.push({
    t: 'text',
    x: o.x,
    w: o.w,
    baseline: o.top + f.size * 0.95,
    size: f.size,
    bold: o.bold ?? false,
    color: o.color,
    text: f.text,
    align: f.arabic && o.align === undefined ? 'right' : (o.align ?? 'left'),
    arabic: f.arabic,
  });
}

// ─── Mise en page ───

export function cardSize(layout: PrintLayout): { width: number; height: number } {
  const w = PRINT_CARD_SIZE_MM.width * MM;
  const h = PRINT_CARD_SIZE_MM.height * MM;
  return layout.orientation === 'LANDSCAPE' ? { width: w, height: h } : { width: h, height: w };
}

/** Bandeau du recto : logo et nom de l'émetteur. */
function header(prims: Primitive[], card: RenderCard, W: number, bandH: number) {
  const { layout, data, assets } = card;
  const pad = 3 * MM;
  prims.push({ t: 'rect', x: 0, y: 0, w: W, h: bandH, fill: layout.colors.primary });
  let x = pad;
  if (layout.front.showLogo && assets.logo) {
    const s = bandH - 3 * MM;
    prims.push({ t: 'image', ref: 'logo', x: pad, y: (bandH - s) / 2, w: s, h: s });
    x = pad + s + 2 * MM;
  }
  if (!layout.front.showIssuer) return;
  const w = W - x - pad;
  if (data.issuer.nameAr) {
    text(prims, data.issuer.name, { x, w, top: bandH / 2 - 8, size: 7, bold: true, color: WHITE });
    text(prims, data.issuer.nameAr, {
      x,
      w,
      top: bandH / 2 + 0.5,
      size: 6.5,
      color: WHITE,
      align: 'left',
    });
  } else {
    text(prims, data.issuer.name, {
      x,
      w,
      top: bandH / 2 - 4.5,
      size: 8,
      bold: true,
      color: WHITE,
    });
  }
}

function photo(prims: Primitive[], card: RenderCard, x: number, y: number, w: number, h: number) {
  if (card.assets.photo) prims.push({ t: 'image', ref: 'photo', x, y, w, h });
  else prims.push({ t: 'photoSlot', x, y, w, h });
}

/** Champs du recto : libellé discret, valeur en gras. */
function fields(
  prims: Primitive[],
  card: RenderCard,
  o: { x: number; w: number; top: number; bottom: number; align: Align },
) {
  const { layout, data } = card;
  const list = layout.front.fields
    .map((f) => ({ f, value: printFieldValue(f, data) }))
    .filter((e) => e.value);
  if (list.length === 0) return;
  const step = Math.min(8 * MM, (o.bottom - o.top) / list.length);
  list.forEach(({ f, value }, i) => {
    const top = o.top + i * step;
    text(prims, printFieldLabel(f, data.kind), {
      x: o.x,
      w: o.w,
      top,
      size: 4.8,
      color: MUTED,
      align: o.align,
    });
    text(prims, value, {
      x: o.x,
      w: o.w,
      top: top + 6.2,
      size: f === 'fullName' ? 8.5 : 7.5,
      min: 5,
      bold: true,
      color: layout.colors.text,
      align: o.align,
    });
  });
}

export function layoutFront(card: RenderCard): Side {
  const { layout } = card;
  const { width: W, height: H } = cardSize(layout);
  const pad = 3 * MM;
  const prims: Primitive[] = [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: layout.colors.background },
  ];
  if (layout.orientation === 'LANDSCAPE') {
    const bandH = 12 * MM;
    header(prims, card, W, bandH);
    const pw = 20 * MM;
    const ph = 25.7 * MM;
    const left = layout.front.photo === 'LEFT';
    const px = left ? pad : W - pad - pw;
    photo(prims, card, px, bandH + 3 * MM, pw, ph);
    const fx = left ? px + pw + 3 * MM : pad;
    const fw = W - pw - 3 * MM - 2 * pad;
    text(prims, layout.front.title, {
      x: fx,
      w: fw,
      top: bandH + 1.6 * MM,
      size: 6.5,
      bold: true,
      color: layout.colors.primary,
    });
    fields(prims, card, { x: fx, w: fw, top: bandH + 6.5 * MM, bottom: H - 2 * MM, align: 'left' });
  } else {
    const bandH = 14 * MM;
    header(prims, card, W, bandH);
    const pw = 24 * MM;
    const ph = 30.85 * MM;
    photo(prims, card, (W - pw) / 2, bandH + 2.5 * MM, pw, ph);
    const top = bandH + 2.5 * MM + ph + 1.5 * MM;
    text(prims, layout.front.title, {
      x: pad,
      w: W - 2 * pad,
      top,
      size: 6.5,
      bold: true,
      color: layout.colors.primary,
      align: 'center',
    });
    fields(prims, card, {
      x: pad,
      w: W - 2 * pad,
      top: top + 4.5 * MM,
      bottom: H - 2.5 * MM,
      align: 'center',
    });
  }
  return { width: W, height: H, prims };
}

export function layoutBack(card: RenderCard): Side {
  const { layout, data } = card;
  const { width: W, height: H } = cardSize(layout);
  const pad = 3 * MM;
  const c = layout.colors;
  const prims: Primitive[] = [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: c.background },
    { t: 'rect', x: 0, y: 0, w: W, h: 3.5 * MM, fill: c.primary },
    { t: 'rect', x: 0, y: H - 1.5 * MM, w: W, h: 1.5 * MM, fill: c.primary },
  ];
  const b = layout.back;
  const validity = b.showValidity && data.validUntil ? printFieldValue('validUntil', data) : null;
  const contact = b.showIssuerContact ? data.issuer.contact : null;
  const number = b.showCardNumber ? `N° ${data.cardNumber}` : null;
  if (layout.orientation === 'LANDSCAPE') {
    const qs = 25 * MM;
    const qx = W - pad - qs;
    if (b.showQr) {
      prims.push({ t: 'qr', x: qx, y: 7 * MM, size: qs, value: data.qr });
      text(prims, number, {
        x: qx - 2 * MM,
        w: qs + 4 * MM,
        top: 7 * MM + qs + 1.2 * MM,
        size: 5.2,
        color: c.text,
        align: 'center',
      });
    }
    const tw = b.showQr ? qx - 3 * MM - pad : W - 2 * pad;
    let top = 7 * MM;
    for (const line of b.lines) {
      text(prims, line, { x: pad, w: tw, top, size: 6, color: c.text });
      top += 4.2 * MM;
    }
    top += 1 * MM;
    if (validity) {
      text(prims, `Valable jusqu’au ${validity}`, {
        x: pad,
        w: tw,
        top,
        size: 6.5,
        bold: true,
        color: c.primary,
      });
      top += 4.6 * MM;
    }
    text(prims, contact ? `Contact : ${contact}` : null, {
      x: pad,
      w: tw,
      top,
      size: 6,
      color: c.text,
    });
    if (!b.showQr)
      text(prims, number, { x: pad, w: tw, top: H - 7 * MM, size: 5.2, color: c.text });
  } else {
    const qs = 28 * MM;
    let top = 7 * MM;
    if (b.showQr) {
      prims.push({ t: 'qr', x: (W - qs) / 2, y: top, size: qs, value: data.qr });
      top += qs + 1.2 * MM;
    }
    text(prims, number, { x: pad, w: W - 2 * pad, top, size: 5.2, color: c.text, align: 'center' });
    top += 5 * MM;
    for (const line of b.lines) {
      text(prims, line, { x: pad, w: W - 2 * pad, top, size: 5.6, color: c.text, align: 'center' });
      top += 4 * MM;
    }
    if (validity) {
      text(prims, `Valable jusqu’au ${validity}`, {
        x: pad,
        w: W - 2 * pad,
        top: top + 0.8 * MM,
        size: 6.2,
        bold: true,
        color: c.primary,
        align: 'center',
      });
      top += 5.2 * MM;
    }
    text(prims, contact ? `Contact : ${contact}` : null, {
      x: pad,
      w: W - 2 * pad,
      top: top + 0.8 * MM,
      size: 5.6,
      color: c.text,
      align: 'center',
    });
  }
  return { width: W, height: H, prims };
}

// ─── Images (préparées une fois par carte) ───

const px = (pt: number) => Math.max(1, Math.round((pt / 72) * 300));

interface Prepared {
  images: Map<string, Buffer>;
  qrs: Map<string, Buffer>;
}

const imageKey = (ref: string, w: number, h: number) => `${ref}:${px(w)}x${px(h)}`;

async function prepare(sides: Side[], assets: CardAssets): Promise<Prepared> {
  const images = new Map<string, Buffer>();
  const qrs = new Map<string, Buffer>();
  for (const side of sides) {
    for (const p of side.prims) {
      if (p.t === 'image') {
        const key = imageKey(p.ref, p.w, p.h);
        if (images.has(key)) continue;
        const source = p.ref === 'photo' ? assets.photo : assets.logo;
        if (!source) continue;
        images.set(
          key,
          p.ref === 'photo'
            ? await sharp(source)
                .rotate()
                .resize(px(p.w), px(p.h), { fit: 'cover', position: 'centre' })
                .jpeg({ quality: 90 })
                .toBuffer()
            : await sharp(source)
                .resize(px(p.w), px(p.h), {
                  fit: 'contain',
                  background: { r: 0, g: 0, b: 0, alpha: 0 },
                })
                .png()
                .toBuffer(),
        );
      } else if (p.t === 'qr' && !qrs.has(p.value)) {
        qrs.set(
          p.value,
          await bwipjs.toBuffer({
            bcid: 'qrcode',
            text: p.value,
            scale: 6,
            paddingwidth: 0,
            paddingheight: 0,
          }),
        );
      }
    }
  }
  return { images, qrs };
}

// ─── Rendu PDF ───

function drawSide(doc: PDFKit.PDFDocument, side: Side, prep: Prepared, ox: number, oy: number) {
  for (const p of side.prims) {
    if (p.t === 'rect') {
      doc
        .save()
        .rect(ox + p.x, oy + p.y, p.w, p.h)
        .fill(p.fill)
        .restore();
    } else if (p.t === 'photoSlot') {
      doc
        .save()
        .rect(ox + p.x, oy + p.y, p.w, p.h)
        .fill(PLACEHOLDER)
        .restore();
      doc
        .font('sans')
        .fontSize(5)
        .fillColor(MUTED)
        .text('PHOTO', ox + p.x, oy + p.y + p.h / 2 - 3, { width: p.w, align: 'center' });
    } else if (p.t === 'image') {
      const buf = prep.images.get(imageKey(p.ref, p.w, p.h));
      if (buf) doc.image(buf, ox + p.x, oy + p.y, { width: p.w, height: p.h });
    } else if (p.t === 'qr') {
      const buf = prep.qrs.get(p.value);
      if (buf) doc.image(buf, ox + p.x, oy + p.y, { width: p.size, height: p.size });
    } else {
      const pieces = visualPieces(p.text, p.arabic);
      const widths = pieces.map((piece) => {
        doc.font(fontName(piece.kind === 'arabic', p.bold)).fontSize(p.size);
        return doc.widthOfString(piece.text);
      });
      const total = widths.reduce((a, b) => a + b, 0);
      let cursor =
        p.align === 'left'
          ? p.x
          : p.align === 'center'
            ? p.x + (p.w - total) / 2
            : p.x + p.w - total;
      pieces.forEach((piece, i) => {
        doc.font(fontName(piece.kind === 'arabic', p.bold)).fontSize(p.size);
        const ascent =
          ((doc as unknown as { _font: { ascender: number } })._font.ascender / 1000) * p.size;
        doc
          .fillColor(p.color)
          .text(piece.text, ox + cursor, oy + p.baseline - ascent, { lineBreak: false });
        cursor += widths[i]!;
      });
    }
  }
}

function newPdf(title: string, size: [number, number] | 'A4'): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size,
    margin: 0,
    autoFirstPage: false,
    info: { Title: title, Creator: 'Ocall Print', Producer: 'Ocall Print' },
  });
  registerFonts(doc);
  return doc;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/**
 * Fichier de production : une page au format exact de la carte par face, recto puis verso, carte après
 * carte (imprimantes à cartes CR80 recto verso). Aucune marque : la page EST la carte.
 */
export async function renderProductionPdf(title: string, cards: RenderCard[]): Promise<Buffer> {
  const prepared = await Promise.all(
    cards.map(async (card) => {
      const sides = [layoutFront(card), layoutBack(card)];
      return { sides, prep: await prepare(sides, card.assets) };
    }),
  );
  const doc = newPdf(title, 'A4');
  const done = collect(doc);
  for (const { sides, prep } of prepared) {
    for (const side of sides) {
      doc.addPage({ size: [side.width, side.height], margin: 0 });
      drawSide(doc, side, prep, 0, 0);
    }
  }
  doc.end();
  return done;
}

/**
 * Bon à tirer : planches A4, recto et verso côte à côte à taille réelle, bordure fine, mention
 * « BON À TIRER » en filigrane. Sert à la validation, jamais à l'impression des cartes.
 */
export async function renderProofPdf(
  title: string,
  heading: string,
  cards: RenderCard[],
): Promise<Buffer> {
  const A4 = { width: 595.28, height: 841.89, margin: 36 };
  const prepared = await Promise.all(
    cards.map(async (card) => {
      const sides = [layoutFront(card), layoutBack(card)];
      return { card, sides, prep: await prepare(sides, card.assets) };
    }),
  );
  const doc = newPdf(title, 'A4');
  const done = collect(doc);
  let y = Infinity;
  const newPage = () => {
    doc.addPage({ size: 'A4', margin: 0 });
    doc
      .save()
      .rotate(-35, { origin: [A4.width / 2, A4.height / 2] })
      .font('sansBold')
      .fontSize(64)
      .fillColor('#000000', 0.06)
      .text('BON À TIRER', 0, A4.height / 2 - 40, { width: A4.width, align: 'center' })
      .restore();
    doc
      .font('sansBold')
      .fontSize(11)
      .fillColor('#111827', 1)
      .text(heading, A4.margin, A4.margin, { width: A4.width - 2 * A4.margin });
    doc
      .font('sans')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        'Bon à tirer : vérifiez les textes, les photos et le QR avant la production. Cartes à taille réelle (85,6 × 54 mm).',
        A4.margin,
        A4.margin + 16,
        { width: A4.width - 2 * A4.margin },
      );
    y = A4.margin + 40;
  };
  for (const { card, sides, prep } of prepared) {
    const [front, back] = sides as [Side, Side];
    const rowH = front.height + 22;
    if (y + rowH > A4.height - A4.margin) newPage();
    const gap = 18;
    const left = (A4.width - front.width - back.width - gap) / 2;
    doc
      .font('sans')
      .fontSize(7.5)
      .fillColor('#374151', 1)
      .text(
        `${card.data.holder.lastName.toUpperCase()} ${card.data.holder.firstName} — N° ${card.data.cardNumber}`,
        left,
        y,
        { width: front.width + back.width + gap, lineBreak: false },
      );
    const top = y + 11;
    drawSide(doc, front, prep, left, top);
    drawSide(doc, back, prep, left + front.width + gap, top);
    doc.save().lineWidth(0.4).strokeColor('#9CA3AF');
    doc.rect(left, top, front.width, front.height).stroke();
    doc.rect(left + front.width + gap, top, back.width, back.height).stroke();
    doc.restore();
    y = top + front.height + 14;
  }
  if (prepared.length === 0) newPage();
  doc.end();
  return done;
}

// ─── Rendu SVG (aperçu) ───

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Math.round(v * 100) / 100;

/** Aperçu SVG d'une face ; images embarquées en data URI, aucune ressource externe. */
export async function renderSideSvg(side: Side, assets: CardAssets): Promise<string> {
  const prep = await prepare([side], assets);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(side.width)} ${n(side.height)}" width="${n(side.width)}" height="${n(side.height)}">`,
  ];
  for (const p of side.prims) {
    if (p.t === 'rect') {
      out.push(
        `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${esc(p.fill)}"/>`,
      );
    } else if (p.t === 'photoSlot') {
      out.push(
        `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${PLACEHOLDER}"/>`,
        `<text x="${n(p.x + p.w / 2)}" y="${n(p.y + p.h / 2 + 2)}" font-family="'Noto Sans',Arial,sans-serif" font-size="5" fill="${MUTED}" text-anchor="middle">PHOTO</text>`,
      );
    } else if (p.t === 'image') {
      const buf = prep.images.get(imageKey(p.ref, p.w, p.h));
      if (!buf) continue;
      const mime = p.ref === 'photo' ? 'image/jpeg' : 'image/png';
      out.push(
        `<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="${p.ref === 'photo' ? 'xMidYMid slice' : 'xMidYMid meet'}" href="data:${mime};base64,${buf.toString('base64')}"/>`,
      );
    } else if (p.t === 'qr') {
      const svg = bwipjs.toSVG({ bcid: 'qrcode', text: p.value });
      out.push(
        svg.replace(
          /^<svg /,
          `<svg x="${n(p.x)}" y="${n(p.y)}" width="${n(p.size)}" height="${n(p.size)}" `,
        ),
      );
    } else {
      const x = p.align === 'left' ? p.x : p.align === 'center' ? p.x + p.w / 2 : p.x + p.w;
      const anchor = p.align === 'left' ? 'start' : p.align === 'center' ? 'middle' : 'end';
      const family = p.arabic
        ? "'Noto Naskh Arabic','Noto Sans Arabic',Tahoma,serif"
        : "'Noto Sans',Arial,sans-serif";
      out.push(
        `<text x="${n(x)}" y="${n(p.baseline)}" font-family="${esc(family)}" font-size="${n(p.size)}" font-weight="${p.bold ? 700 : 400}" fill="${esc(p.color)}" text-anchor="${anchor}">${esc(p.text)}</text>`,
      );
    }
  }
  out.push('</svg>');
  return out.join('');
}

export async function renderCardSvgs(card: RenderCard): Promise<{ front: string; back: string }> {
  const [front, back] = await Promise.all([
    renderSideSvg(layoutFront(card), card.assets),
    renderSideSvg(layoutBack(card), card.assets),
  ]);
  return { front, back };
}
