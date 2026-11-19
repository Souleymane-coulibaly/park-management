import sharp from 'sharp';
import { type PrintCardData, defaultPrintLayout } from '@ocall/shared';
import {
  type RenderCard,
  cardSize,
  layoutBack,
  layoutFront,
  renderCardSvgs,
  renderProductionPdf,
  renderProofPdf,
} from './print-render';

const data = (over: Partial<PrintCardData['holder']> = {}): PrintCardData => ({
  format: 'ocall-print/card@1',
  kind: 'STUDENT',
  issuer: {
    name: 'Groupe scolaire Les Baobabs',
    nameAr: 'مجمع المدارس',
    contact: '+223 20 00 00 00',
  },
  holder: {
    firstName: 'Aminata',
    lastName: 'Diallo',
    firstNameAr: 'أميناتا',
    lastNameAr: 'ديالو',
    reference: '2026-000123',
    group: '6e A',
    jobTitle: null,
    birthDate: '2014-03-12',
    ...over,
  },
  period: '2026-2027',
  validUntil: '2027-07-31',
  cardNumber: 'ABCD-EFGH-JKMN',
  qr: 'OCP1.ABCD-EFGH-JKMN.signature',
});

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('moteur de rendu des cartes', () => {
  let photo: Buffer;
  let logo: Buffer;
  beforeAll(async () => {
    photo = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#8899AA' } })
      .jpeg()
      .toBuffer();
    logo = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 4,
        background: { r: 200, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
  });

  const card = (over: Partial<RenderCard> = {}): RenderCard => ({
    layout: defaultPrintLayout('STUDENT'),
    data: data(),
    assets: { photo, logo },
    ...over,
  });

  it('format CR80 exact, paysage et portrait', () => {
    const l = cardSize(defaultPrintLayout('STUDENT'));
    expect(l.width).toBeCloseTo((85.6 / 25.4) * 72, 1);
    expect(l.height).toBeCloseTo((53.98 / 25.4) * 72, 1);
    const p = cardSize({ ...defaultPrintLayout('STUDENT'), orientation: 'PORTRAIT' });
    expect(p.width).toBeCloseTo(l.height, 5);
  });

  it('tous les éléments restent dans la carte, même avec des textes très longs', () => {
    for (const orientation of ['LANDSCAPE', 'PORTRAIT'] as const) {
      const c = card({
        layout: { ...defaultPrintLayout('STUDENT'), orientation },
        data: data({
          lastName: 'Nom-de-famille-extrêmement-long-'.repeat(4),
          group: 'Terminale '.repeat(9),
        }),
      });
      for (const side of [layoutFront(c), layoutBack(c)]) {
        for (const p of side.prims) {
          if (p.t === 'text') {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x + p.w).toBeLessThanOrEqual(side.width + 0.01);
            expect(p.baseline).toBeLessThanOrEqual(side.height);
            expect(p.size).toBeGreaterThanOrEqual(4.5);
          } else if (p.t === 'qr') {
            expect(p.x + p.size).toBeLessThanOrEqual(side.width + 0.01);
            expect(p.y + p.size).toBeLessThanOrEqual(side.height + 0.01);
          } else {
            expect(p.x + p.w).toBeLessThanOrEqual(side.width + 0.01);
            expect(p.y + p.h).toBeLessThanOrEqual(side.height + 0.01);
          }
        }
      }
      const long = layoutFront(c).prims.find(
        (p) => p.t === 'text' && p.text.startsWith('NOM-DE-FAMILLE'),
      );
      expect(long && long.t === 'text' && long.text.endsWith('…')).toBe(true);
    }
  });

  it('le nom arabe est repéré comme arabe ; sans photo, un emplacement vide est dessiné', () => {
    const base = defaultPrintLayout('STUDENT');
    const c = card({
      layout: { ...base, front: { ...base.front, fields: ['fullName', 'fullNameAr'] } },
      assets: { photo: null, logo: null },
    });
    const front = layoutFront(c);
    expect(front.prims.some((p) => p.t === 'text' && p.arabic && p.text.includes('ديالو'))).toBe(
      true,
    );
    expect(front.prims.some((p) => p.t === 'photoSlot')).toBe(true);
    expect(front.prims.some((p) => p.t === 'image')).toBe(false);
  });

  it('fichier de production : deux pages (recto, verso) par carte, au format de la carte', async () => {
    const pdf = await renderProductionPdf('Production', [
      card(),
      card({ data: data({ firstName: 'Ali' }) }),
    ]);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(4);
    expect(pdf.toString('latin1')).toMatch(/MediaBox \[0 0 242\.6\d* 153\.0\d*\]/);
  });

  it('bon à tirer A4 : plusieurs cartes réparties sur plusieurs planches', async () => {
    const cards = Array.from({ length: 6 }, () => card());
    const pdf = await renderProofPdf('BAT', 'Commande IMP-2026-00001', cards);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBeGreaterThanOrEqual(2);
  });

  it('aperçu SVG : textes échappés, images embarquées, aucun script ni ressource externe', async () => {
    const svg = await renderCardSvgs(
      card({ data: data({ firstName: '<script>alert(1)</script>"&' }) }),
    );
    for (const side of [svg.front, svg.back]) {
      expect(side.startsWith('<svg')).toBe(true);
      expect(side).not.toMatch(/<script/i);
      expect(side).not.toMatch(/href="http/i);
    }
    expect(svg.front).toContain('&lt;script&gt;');
    expect(svg.front).toContain('data:image/jpeg;base64,');
    expect(svg.back).toContain('Valable jusqu’au 31/07/2027');
    expect(svg.back).toContain('N° ABCD-EFGH-JKMN');
  });
});
