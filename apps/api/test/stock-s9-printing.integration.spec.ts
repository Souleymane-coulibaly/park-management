import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  STOCK_LABEL_FORMATS,
  STOCK_LABEL_SIZES,
  STOCK_PRODUCT_CODE,
  charsPerLine,
  containsDrawerKick,
  fromBase64,
} from '@ocall/shared';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { type Agent, type SignedUpOwner, cleanup, createTestApp, signup } from './helpers';

/**
 * Ocall Stock — S9, impression : étiquettes d'articles et d'emplacements à la taille exacte de chaque
 * format (une par page, copies comptées), tickets thermiques 58 et 80 mm (aucune ligne plus large que le
 * papier, accents dans la page de code de l'imprimante, coupe en fin de ticket, jamais d'ouverture de
 * tiroir), ticket PDF à la largeur du rouleau, bons de commande et rapports d'inventaire longs paginés,
 * export CSV protégé contre les formules. Le matériel réel reste à valider sur place (protocole de la
 * documentation). Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');
const PT_PER_MM = 72 / 25.4;
const LONG = 'Peinture glycéro brillante extérieure « blanc cassé » qualité supérieure 5 L';

/** Tailles des pages d'un PDF, en millimètres. */
function pageSizes(pdf: Buffer): { w: number; h: number }[] {
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  const boxes = [...text.matchAll(/\/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)];
  expect(boxes.length).toBe((text.match(/\/Type \/Page\b/g) ?? []).length);
  return boxes.map((m) => ({
    w: Math.round((Number(m[1]) / PT_PER_MM) * 10) / 10,
    h: Math.round((Number(m[2]) / PT_PER_MM) * 10) / 10,
  }));
}

(enabled ? describe : describe.skip)('Ocall Stock S9 — impression (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let org: SignedUpOwner;
  let a: Agent;
  let site: { id: string; general: string };
  let long: { productId: string; variantId: string };
  let plain: { productId: string; variantId: string };

  async function ok<T = Record<string, any>>(req: ReturnType<Agent['get']>, status = 201) {
    const res = await req;
    if (res.status !== status) {
      throw new Error(`${status} attendu, ${res.status} : ${String(res.text).slice(0, 300)}`);
    }
    return res.body as T & Record<string, any>;
  }

  async function product(name: string, extra: Record<string, unknown> = {}) {
    const p = await ok(
      a.post(api('/ocall-stock/products')).send({ name, salePrice: 11_800, vatRate: 18, ...extra }),
    );
    return { productId: p.id as string, variantId: p.variants[0].id as string };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    org = await signup(app, 'stockS9P', 'PARK');
    a = org.agent;
    const saas = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
    });
    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
      where: { productId_name: { productId: saas.id, name: 'Ocall Stock — Sans vitrine' } },
    });
    await prisma.productTrial.create({
      data: {
        organizationId: org.organizationId,
        productId: saas.id,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 14 * DAY),
        startedByOcall: true,
      },
    });
    await prisma.subscription.create({
      data: {
        organizationId: org.organizationId,
        productId: saas.id,
        planId: plan.id,
        status: 'TRIALING',
      },
    });
    const s = await ok(
      a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'MAG1', name: 'Quincaillerie Élégance', kind: 'STORE' }),
    );
    site = { id: s.id, general: s.locations[0].id };
    long = await product(LONG, { purchasePrice: 5000, unit: 'pot' });
    await ok(
      a
        .post(api(`/ocall-stock/variants/${long.variantId}/barcodes`))
        .send({ type: 'EAN13', code: '4006381333931' }),
    );
    plain = await product('=SUM(A1:A9)', { unit: 'kg' });
    await ok(
      a.post(api('/ocall-stock/movements')).send({
        kind: 'IN',
        variantId: long.variantId,
        locationId: site.general,
        quantity: 100,
        idempotencyKey: key(),
      }),
    );
    await ok(
      a.post(api('/ocall-stock/movements')).send({
        kind: 'IN',
        variantId: plain.variantId,
        locationId: site.general,
        quantity: 50,
        idempotencyKey: key(),
      }),
    );
  }, 300_000);

  afterAll(async () => {
    try {
      if (db && org) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(db, [org.organizationId]);
      }
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('étiquettes d’articles : taille exacte de chaque format, une par page, copies comptées', async () => {
    for (const format of STOCK_LABEL_FORMATS) {
      const res = await a
        .post(api('/ocall-stock/labels.pdf'))
        .send({
          format,
          fields: [
            'storeName',
            'productName',
            'variant',
            'reference',
            'barcode',
            'qrCode',
            'price',
          ],
          items: [
            { variantId: long.variantId, copies: 2 },
            { variantId: plain.variantId, copies: 1 },
          ],
        })
        .buffer(true)
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      const { widthMm, heightMm } = STOCK_LABEL_SIZES[format];
      expect(pageSizes(res.body as Buffer)).toEqual(
        Array.from({ length: 3 }, () => ({ w: widthMm, h: heightMm })),
      );
    }
  });

  it('étiquettes d’emplacements : taille du format, une par emplacement', async () => {
    const bins = [];
    for (const code of ['A1', 'A2', 'B1']) {
      bins.push(
        (
          await ok(
            a
              .post(api(`/ocall-stock/sites/${site.id}/locations`))
              .send({ kind: 'BIN', code, name: `Casier ${code}` }),
          )
        ).id as string,
      );
    }
    for (const format of ['40x30', '50x30', '60x40'] as const) {
      const res = await a
        .post(api(`/ocall-stock/sites/${site.id}/location-labels.pdf`))
        .send({ format, locationIds: bins })
        .buffer(true)
        .expect(200);
      const { widthMm, heightMm } = STOCK_LABEL_SIZES[format];
      expect(pageSizes(res.body as Buffer)).toEqual(
        Array.from({ length: 3 }, () => ({ w: widthMm, h: heightMm })),
      );
    }
  });

  it('tickets thermiques 58 et 80 mm : largeur du papier, accents PC858, coupe, jamais de tiroir', async () => {
    const register = (
      await ok(
        a
          .post(api('/ocall-stock/registers'))
          .send({ code: 'CAISSE1', name: 'Caisse principale', locationId: site.general }),
      )
    ).id;
    await ok(a.post(api(`/ocall-stock/registers/${register}/sessions`)).send({ openingFloat: 0 }));
    const sale = await ok(
      a.post(api('/ocall-stock/sales')).send({
        idempotencyKey: key(),
        registerId: register,
        lines: [
          { variantId: long.variantId, quantity: 3 },
          { variantId: plain.variantId, quantity: 2.5 },
        ],
        payments: [{ method: 'CASH', amount: 64_900 }],
      }),
    );
    for (const width of [58, 80] as const) {
      const receipt = await ok(
        a.get(api(`/ocall-stock/sales/${sale.id}/receipt?width=${width}`)),
        200,
      );
      expect(receipt.paperWidth).toBe(width);
      const preview = receipt.preview as string[];
      expect(preview.filter((l) => l.length > charsPerLine(width))).toEqual([]);
      const text = preview.join('\n');
      // Nom long découpé sur plusieurs lignes, rien de perdu.
      expect(text.replace(/\s+/g, ' ')).toContain('qualité supérieure 5 L');
      expect(text).toMatch(/TOTAL/);
      const bytes = fromBase64(receipt.data as string);
      // Initialisation, page de code PC858 (19), accents encodés sur un octet, coupe finale.
      expect([...bytes.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
      expect(bytes.includes(0x82)).toBe(true); // é
      expect(bytes.includes(0xc3)).toBe(false); // aucun UTF-8 brut
      expect([...bytes.subarray(bytes.length - 3)]).toEqual([0x56, 0x42, 0x00]);
      expect(containsDrawerKick(bytes)).toBe(false);

      const pdf = await a
        .get(api(`/ocall-stock/sales/${sale.id}/receipt.pdf?width=${width}`))
        .buffer(true)
        .expect(200);
      const pages = pageSizes(pdf.body as Buffer);
      expect(pages.length).toBeGreaterThanOrEqual(1);
      expect(pages.every((p) => p.w === width)).toBe(true);
    }
    const dup = await ok(a.post(api(`/ocall-stock/sales/${sale.id}/reprint?width=58`)));
    expect((dup.preview as string[])[0]).toContain('DUPLICATA');
    expect((dup.preview as string[]).filter((l) => l.length > charsPerLine(58))).toEqual([]);
  });

  it('bon de commande et inventaire longs : paginés ; CSV protégé contre les formules', async () => {
    const supplierId = (await ok(a.post(api('/ocall-stock/suppliers')).send({ name: 'Grossiste' })))
      .id;
    const variants: string[] = [];
    for (let i = 0; i < 45; i++) {
      variants.push(
        (await product(`Article de test numéro ${i + 1} — ${LONG.slice(0, 30)}`)).variantId,
      );
    }
    const order = await ok(
      a.post(api('/ocall-stock/purchase-orders')).send({
        supplierId,
        siteId: site.id,
        lines: variants.map((variantId, i) => ({
          variantId,
          quantity: i + 1,
          unitCost: 1000 + i,
          vatRate: 18,
        })),
      }),
    );
    const po = await a
      .get(api(`/ocall-stock/purchase-orders/${order.id}/pdf`))
      .buffer(true)
      .expect(200);
    const poPages = pageSizes(po.body as Buffer);
    expect(poPages.length).toBeGreaterThanOrEqual(2);
    // A4 portrait.
    expect(poPages.every((p) => Math.abs(p.w - 210) < 1 && Math.abs(p.h - 297) < 1)).toBe(true);

    const count = await ok(
      a
        .post(api('/ocall-stock/counts'))
        .send({ siteId: site.id, name: 'Inventaire long', scope: 'FULL' }),
    );
    await ok(
      a.put(api(`/ocall-stock/counts/${count.id}/lines`)).send({
        variantId: plain.variantId,
        locationId: site.general,
        quantity: 49,
        mode: 'SET',
      }),
      200,
    );
    const report = await a
      .get(api(`/ocall-stock/counts/${count.id}/report.pdf`))
      .buffer(true)
      .expect(200);
    expect(pageSizes(report.body as Buffer).length).toBeGreaterThanOrEqual(1);
    const csv = (await a.get(api(`/ocall-stock/counts/${count.id}/report.csv`)).expect(200)).text;
    // Un nom d'article qui commence par « = » n'est jamais interprété comme une formule par le tableur.
    expect(csv).not.toMatch(/(^|;)=SUM/m);
    expect(csv).toContain('SUM(A1:A9)');
  });
});
