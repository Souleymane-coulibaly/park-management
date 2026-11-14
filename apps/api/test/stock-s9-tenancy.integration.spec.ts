import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { type Agent, RUN, type SignedUpOwner, cleanup, createTestApp, signup } from './helpers';

/**
 * Ocall Stock — S9, isolation multi-organisations sur TOUTES les routes : l'organisation B (propriétaire,
 * tous les droits, offre avec vitrine) tente chaque route avec les identifiants de l'organisation A.
 * Attendu : 404 (jamais un succès, jamais une erreur serveur), aucune donnée de A dans les réponses et rien
 * de modifié chez A. Une garde relit les contrôleurs : toute nouvelle route à identifiant doit être ajoutée
 * ici (ou exemptée avec sa raison). Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

type Ids = Record<string, string>;
type Case = [route: string, call: (b: Agent, ids: Ids) => ReturnType<Agent['get']>];

/** Routes à identifiant : B → A doit répondre 404. */
const PATH_CASES: Case[] = [
  [
    'POST ocall-stock/ai/products/:id/illustration',
    (b, i) => b.post(api(`/ocall-stock/ai/products/${i.product}/illustration`)),
  ],
  [
    'GET ocall-stock/ai/proposals/:id/image',
    (b, i) => b.get(api(`/ocall-stock/ai/proposals/${i.proposal}/image`)),
  ],
  [
    'POST ocall-stock/ai/proposals/:id/apply',
    (b, i) => b.post(api(`/ocall-stock/ai/proposals/${i.proposal}/apply`)).send({}),
  ],
  [
    'POST ocall-stock/ai/proposals/:id/reject',
    (b, i) => b.post(api(`/ocall-stock/ai/proposals/${i.proposal}/reject`)),
  ],
  [
    'PATCH ocall-stock/categories/:id',
    (b, i) => b.patch(api(`/ocall-stock/categories/${i.category}`)).send({ name: 'Piraté' }),
  ],
  [
    'PATCH ocall-stock/brands/:id',
    (b, i) => b.patch(api(`/ocall-stock/brands/${i.brand}`)).send({ name: 'Piraté' }),
  ],
  ['GET ocall-stock/products/:id', (b, i) => b.get(api(`/ocall-stock/products/${i.product}`))],
  [
    'PATCH ocall-stock/products/:id',
    (b, i) => b.patch(api(`/ocall-stock/products/${i.product}`)).send({ name: 'Piraté' }),
  ],
  [
    'GET ocall-stock/products/:id/history',
    (b, i) => b.get(api(`/ocall-stock/products/${i.product}/history`)),
  ],
  [
    'POST ocall-stock/products/:id/variants',
    (b, i) =>
      b
        .post(api(`/ocall-stock/products/${i.product}/variants`))
        .send({ name: '10 L', salePrice: 1000 }),
  ],
  [
    'PATCH ocall-stock/variants/:id',
    (b, i) => b.patch(api(`/ocall-stock/variants/${i.variant}`)).send({ salePrice: 1 }),
  ],
  [
    'POST ocall-stock/variants/:id/barcodes',
    (b, i) =>
      b
        .post(api(`/ocall-stock/variants/${i.variant}/barcodes`))
        .send({ type: 'EAN13', code: '9780201379624' }),
  ],
  [
    'POST ocall-stock/variants/:id/internal-code',
    (b, i) => b.post(api(`/ocall-stock/variants/${i.variant}/internal-code`)),
  ],
  [
    'DELETE ocall-stock/barcodes/:id',
    (b, i) => b.delete(api(`/ocall-stock/barcodes/${i.barcode}`)),
  ],
  [
    'POST ocall-stock/products/:id/images',
    (b, i) =>
      b
        .post(api(`/ocall-stock/products/${i.product}/images`))
        .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' }),
  ],
  [
    'GET ocall-stock/products/:id/images/:imageId',
    (b, i) => b.get(api(`/ocall-stock/products/${i.product}/images/${i.image}`)),
  ],
  [
    'DELETE ocall-stock/products/:id/images/:imageId',
    (b, i) => b.delete(api(`/ocall-stock/products/${i.product}/images/${i.image}`)),
  ],
  ['GET ocall-stock/suppliers/:id', (b, i) => b.get(api(`/ocall-stock/suppliers/${i.supplier}`))],
  [
    'PATCH ocall-stock/suppliers/:id',
    (b, i) => b.patch(api(`/ocall-stock/suppliers/${i.supplier}`)).send({ name: 'Piraté' }),
  ],
  [
    'PATCH ocall-stock/registers/:id',
    (b, i) => b.patch(api(`/ocall-stock/registers/${i.register}`)).send({ name: 'Piraté' }),
  ],
  [
    'POST ocall-stock/registers/:id/sessions',
    (b, i) =>
      b.post(api(`/ocall-stock/registers/${i.register2}/sessions`)).send({ openingFloat: 0 }),
  ],
  [
    'GET ocall-stock/cash-sessions/:id',
    (b, i) => b.get(api(`/ocall-stock/cash-sessions/${i.session}`)),
  ],
  [
    'POST ocall-stock/cash-sessions/:id/close',
    (b, i) =>
      b
        .post(api(`/ocall-stock/cash-sessions/${i.session}/close`))
        .send({ countedCash: 0, differenceReason: 'Piraté' }),
  ],
  [
    'GET ocall-stock/registers/:id/items',
    (b, i) => b.get(api(`/ocall-stock/registers/${i.register}/items?q=Peinture`)),
  ],
  [
    'GET ocall-stock/registers/:id/scan',
    (b, i) => b.get(api(`/ocall-stock/registers/${i.register}/scan?code=4006381333931`)),
  ],
  [
    'GET ocall-stock/registers/:id/held-carts',
    (b, i) => b.get(api(`/ocall-stock/registers/${i.register}/held-carts`)),
  ],
  [
    'POST ocall-stock/registers/:id/held-carts',
    (b, i) =>
      b
        .post(api(`/ocall-stock/registers/${i.register}/held-carts`))
        .send({ label: 'Piraté', lines: [{ variantId: i.variant, quantity: 1 }] }),
  ],
  [
    'DELETE ocall-stock/held-carts/:id',
    (b, i) => b.delete(api(`/ocall-stock/held-carts/${i.heldCart}`)),
  ],
  ['GET ocall-stock/sales/:id', (b, i) => b.get(api(`/ocall-stock/sales/${i.sale}`))],
  [
    'GET ocall-stock/sales/:id/receipt',
    (b, i) => b.get(api(`/ocall-stock/sales/${i.sale}/receipt`)),
  ],
  [
    'POST ocall-stock/sales/:id/reprint',
    (b, i) => b.post(api(`/ocall-stock/sales/${i.sale}/reprint`)),
  ],
  [
    'GET ocall-stock/sales/:id/receipt.pdf',
    (b, i) => b.get(api(`/ocall-stock/sales/${i.sale}/receipt.pdf`)),
  ],
  [
    'POST ocall-stock/sales/:id/returns',
    (b, i) =>
      b.post(api(`/ocall-stock/sales/${i.sale}/returns`)).send({
        idempotencyKey: key(),
        registerId: i.register,
        reason: 'Piraté',
        restock: true,
        refundMethod: 'CASH',
        lines: [{ saleLineId: i.saleLine, quantity: 1 }],
      }),
  ],
  ['GET ocall-stock/customers/:id', (b, i) => b.get(api(`/ocall-stock/customers/${i.customer}`))],
  [
    'PATCH ocall-stock/customers/:id',
    (b, i) => b.patch(api(`/ocall-stock/customers/${i.customer}`)).send({ name: 'Piraté' }),
  ],
  [
    'GET ocall-stock/purchase-orders/:id',
    (b, i) => b.get(api(`/ocall-stock/purchase-orders/${i.order}`)),
  ],
  [
    'PATCH ocall-stock/purchase-orders/:id',
    (b, i) => b.patch(api(`/ocall-stock/purchase-orders/${i.draft}`)).send({ note: 'Piraté' }),
  ],
  [
    'POST ocall-stock/purchase-orders/:id/order',
    (b, i) => b.post(api(`/ocall-stock/purchase-orders/${i.draft}/order`)),
  ],
  [
    'POST ocall-stock/purchase-orders/:id/close',
    (b, i) => b.post(api(`/ocall-stock/purchase-orders/${i.order}/close`)),
  ],
  [
    'POST ocall-stock/purchase-orders/:id/cancel',
    (b, i) => b.post(api(`/ocall-stock/purchase-orders/${i.draft}/cancel`)),
  ],
  [
    'GET ocall-stock/purchase-orders/:id/pdf',
    (b, i) => b.get(api(`/ocall-stock/purchase-orders/${i.order}/pdf`)),
  ],
  [
    'POST ocall-stock/purchase-orders/:id/receive',
    (b, i) =>
      b.post(api(`/ocall-stock/purchase-orders/${i.order}/receive`)).send({
        idempotencyKey: key(),
        lines: [{ orderLineId: i.orderLine, quantity: 1, locationId: i.general }],
      }),
  ],
  [
    'POST ocall-stock/receipts/:id/cancel',
    (b, i) => b.post(api(`/ocall-stock/receipts/${i.receipt}/cancel`)).send({ reason: 'Piraté' }),
  ],
  [
    'GET ocall-stock/variants/:id/purchase-prices',
    (b, i) => b.get(api(`/ocall-stock/variants/${i.variant}/purchase-prices`)),
  ],
  [
    'GET ocall-stock/documents/:ownerType/:ownerId',
    (b, i) => b.get(api(`/ocall-stock/documents/PURCHASE_ORDER/${i.order}`)),
  ],
  [
    'POST ocall-stock/documents/:ownerType/:ownerId',
    (b, i) =>
      b
        .post(api(`/ocall-stock/documents/PURCHASE_ORDER/${i.order}`))
        .attach('file', PDF, { filename: 'bl.pdf', contentType: 'application/pdf' }),
  ],
  ['GET ocall-stock/documents/:id', (b, i) => b.get(api(`/ocall-stock/documents/${i.document}`))],
  [
    'DELETE ocall-stock/documents/:id',
    (b, i) => b.delete(api(`/ocall-stock/documents/${i.document}`)),
  ],
  [
    'GET ocall-stock/showcase/media/:id',
    (b, i) => b.get(api(`/ocall-stock/showcase/media/${i.media}`)),
  ],
  [
    'DELETE ocall-stock/showcase/media/:id',
    (b, i) => b.delete(api(`/ocall-stock/showcase/media/${i.media}`)),
  ],
  [
    'PUT ocall-stock/showcase/products/:id',
    (b, i) => b.put(api(`/ocall-stock/showcase/products/${i.product}`)).send({ published: true }),
  ],
  [
    'POST ocall-stock/showcase/domains/:id/verify',
    (b, i) => b.post(api(`/ocall-stock/showcase/domains/${i.domain}/verify`)),
  ],
  [
    'DELETE ocall-stock/showcase/domains/:id',
    (b, i) => b.delete(api(`/ocall-stock/showcase/domains/${i.domain}`)),
  ],
  [
    'PATCH ocall-stock/showcase/requests/:id',
    (b, i) => b.patch(api(`/ocall-stock/showcase/requests/${i.request}`)).send({ status: 'SPAM' }),
  ],
  ['GET ocall-stock/sites/:id', (b, i) => b.get(api(`/ocall-stock/sites/${i.site}`))],
  [
    'PATCH ocall-stock/sites/:id',
    (b, i) => b.patch(api(`/ocall-stock/sites/${i.site}`)).send({ name: 'Piraté' }),
  ],
  [
    'POST ocall-stock/sites/:id/locations',
    (b, i) =>
      b
        .post(api(`/ocall-stock/sites/${i.site}/locations`))
        .send({ kind: 'ZONE', code: 'Z', name: 'Piraté' }),
  ],
  [
    'PATCH ocall-stock/locations/:id',
    (b, i) => b.patch(api(`/ocall-stock/locations/${i.bin}`)).send({ name: 'Piraté' }),
  ],
  [
    'POST ocall-stock/sites/:id/location-labels.pdf',
    (b, i) =>
      b
        .post(api(`/ocall-stock/sites/${i.site}/location-labels.pdf`))
        .send({ format: '50x30', locationIds: [i.bin] }),
  ],
  [
    'PUT ocall-stock/members/:id/sites',
    (b, i) => b.put(api(`/ocall-stock/members/${i.member}/sites`)).send({ siteIds: [] }),
  ],
  [
    'GET ocall-stock/products/:id/levels',
    (b, i) => b.get(api(`/ocall-stock/products/${i.product}/levels`)),
  ],
  ['GET ocall-stock/transfers/:id', (b, i) => b.get(api(`/ocall-stock/transfers/${i.transfer}`))],
  [
    'POST ocall-stock/transfers/:id/prepare',
    (b, i) =>
      b
        .post(api(`/ocall-stock/transfers/${i.transfer}/prepare`))
        .send({ lines: [{ lineId: i.transferLine, fromLocationId: i.general }] }),
  ],
  [
    'POST ocall-stock/transfers/:id/ship',
    (b, i) => b.post(api(`/ocall-stock/transfers/${i.transfer}/ship`)),
  ],
  [
    'POST ocall-stock/transfers/:id/receive',
    (b, i) =>
      b.post(api(`/ocall-stock/transfers/${i.transfer}/receive`)).send({
        idempotencyKey: key(),
        lines: [{ lineId: i.transferLine, quantity: 1, toLocationId: i.general2 }],
      }),
  ],
  [
    'POST ocall-stock/transfers/:id/loss',
    (b, i) =>
      b
        .post(api(`/ocall-stock/transfers/${i.transfer}/loss`))
        .send({ lines: [{ lineId: i.transferLine, reason: 'Piraté' }] }),
  ],
  [
    'POST ocall-stock/transfers/:id/cancel',
    (b, i) => b.post(api(`/ocall-stock/transfers/${i.transfer}/cancel`)),
  ],
  ['GET ocall-stock/counts/:id', (b, i) => b.get(api(`/ocall-stock/counts/${i.count}`))],
  [
    'PUT ocall-stock/counts/:id/lines',
    (b, i) =>
      b
        .put(api(`/ocall-stock/counts/${i.count}/lines`))
        .send({ variantId: i.variant, locationId: i.general, quantity: 99, mode: 'SET' }),
  ],
  [
    'DELETE ocall-stock/counts/:id/lines/:lineId',
    (b, i) => b.delete(api(`/ocall-stock/counts/${i.count}/lines/${i.countLine}`)),
  ],
  [
    'POST ocall-stock/counts/:id/validate',
    (b, i) => b.post(api(`/ocall-stock/counts/${i.count}/validate`)),
  ],
  [
    'POST ocall-stock/counts/:id/cancel',
    (b, i) => b.post(api(`/ocall-stock/counts/${i.count}/cancel`)),
  ],
  [
    'GET ocall-stock/counts/:id/report.csv',
    (b, i) => b.get(api(`/ocall-stock/counts/${i.count}/report.csv`)),
  ],
  [
    'GET ocall-stock/counts/:id/report.pdf',
    (b, i) => b.get(api(`/ocall-stock/counts/${i.count}/report.pdf`)),
  ],
  [
    'PATCH ocall-stock/members/:id',
    (b, i) => b.patch(api(`/ocall-stock/members/${i.member}`)).send({ role: 'CASHIER' }),
  ],
  [
    'PUT ocall-stock/members/:id/permissions',
    (b, i) => b.put(api(`/ocall-stock/members/${i.member}/permissions`)).send({ overrides: [] }),
  ],
];

/** Identifiants de A passés dans le corps d'une requête de B : refusés (jamais un succès ni une erreur serveur). */
const BODY_CASES: Case[] = [
  [
    'movements',
    (b, i) =>
      b.post(api('/ocall-stock/movements')).send({
        kind: 'IN',
        variantId: i.variant,
        locationId: i.bGeneral,
        quantity: 1,
        idempotencyKey: key(),
      }),
  ],
  [
    'movements (emplacement de A)',
    (b, i) =>
      b.post(api('/ocall-stock/movements')).send({
        kind: 'IN',
        variantId: i.bVariant,
        locationId: i.general,
        quantity: 1,
        idempotencyKey: key(),
      }),
  ],
  [
    'moves',
    (b, i) =>
      b.post(api('/ocall-stock/moves')).send({
        variantId: i.bVariant,
        fromLocationId: i.general,
        toLocationId: i.bGeneral,
        quantity: 1,
        idempotencyKey: key(),
      }),
  ],
  [
    'transfers',
    (b, i) =>
      b.post(api('/ocall-stock/transfers')).send({
        fromSiteId: i.site,
        toSiteId: i.bSite,
        lines: [{ variantId: i.bVariant, quantity: 1 }],
      }),
  ],
  [
    'counts',
    (b, i) =>
      b.post(api('/ocall-stock/counts')).send({ siteId: i.site, name: 'Piraté', scope: 'FULL' }),
  ],
  [
    'products (catégorie de A)',
    (b, i) =>
      b
        .post(api('/ocall-stock/products'))
        .send({ name: 'Piraté', salePrice: 1, categoryId: i.category }),
  ],
  [
    'products (marque de A)',
    (b, i) =>
      b.post(api('/ocall-stock/products')).send({ name: 'Piraté', salePrice: 1, brandId: i.brand }),
  ],
  [
    'registers',
    (b, i) =>
      b
        .post(api('/ocall-stock/registers'))
        .send({ code: 'PIR', name: 'Piraté', locationId: i.general }),
  ],
  [
    'sales (article de A)',
    (b, i) =>
      b.post(api('/ocall-stock/sales')).send({
        idempotencyKey: key(),
        registerId: i.bRegister,
        lines: [{ variantId: i.variant, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 11_800 }],
      }),
  ],
  [
    'sales (caisse de A)',
    (b, i) =>
      b.post(api('/ocall-stock/sales')).send({
        idempotencyKey: key(),
        registerId: i.register,
        lines: [{ variantId: i.bVariant, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 11_800 }],
      }),
  ],
  [
    'sales (client de A)',
    (b, i) =>
      b.post(api('/ocall-stock/sales')).send({
        idempotencyKey: key(),
        registerId: i.bRegister,
        customerId: i.customer,
        lines: [{ variantId: i.bVariant, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 11_800 }],
      }),
  ],
  [
    'purchase-orders (fournisseur de A)',
    (b, i) =>
      b.post(api('/ocall-stock/purchase-orders')).send({
        supplierId: i.supplier,
        siteId: i.bSite,
        lines: [{ variantId: i.bVariant, quantity: 1, unitCost: 1, vatRate: 18 }],
      }),
  ],
  [
    'purchase-orders (site de A)',
    (b, i) =>
      b.post(api('/ocall-stock/purchase-orders')).send({
        supplierId: i.bSupplier,
        siteId: i.site,
        lines: [{ variantId: i.bVariant, quantity: 1, unitCost: 1, vatRate: 18 }],
      }),
  ],
  [
    'purchase-orders (article de A)',
    (b, i) =>
      b.post(api('/ocall-stock/purchase-orders')).send({
        supplierId: i.bSupplier,
        siteId: i.bSite,
        lines: [{ variantId: i.variant, quantity: 1, unitCost: 1, vatRate: 18 }],
      }),
  ],
  [
    'supplier-returns',
    (b, i) =>
      b.post(api('/ocall-stock/supplier-returns')).send({
        supplierId: i.bSupplier,
        siteId: i.bSite,
        reason: 'Piraté',
        idempotencyKey: key(),
        lines: [{ variantId: i.variant, locationId: i.general, quantity: 1 }],
      }),
  ],
  [
    'labels.pdf',
    (b, i) =>
      b.post(api('/ocall-stock/labels.pdf')).send({
        format: '40x30',
        fields: ['productName', 'price'],
        items: [{ variantId: i.variant, copies: 1 }],
      }),
  ],
  [
    'members/:id/sites (sites de A)',
    (b, i) => b.put(api(`/ocall-stock/members/${i.bMember}/sites`)).send({ siteIds: [i.site] }),
  ],
  [
    'ai/restock',
    (b, i) =>
      b.post(api('/ocall-stock/ai/restock')).send({ siteId: i.bSite, supplierId: i.supplier }),
  ],
  ['ai/stockouts', (b, i) => b.post(api('/ocall-stock/ai/stockouts')).send({ siteId: i.site })],
];

/** Routes à identifiant volontairement hors de ce balayage. */
const EXEMPT: Record<string, string> = {
  'GET public/stock-sites/:slug': 'public par conception (vitrine publiée), testé au S7',
  'GET public/stock-sites/:slug/catalogue': 'public par conception, testé au S7',
  'GET public/stock-sites/:slug/articles/:id': 'public par conception, testé au S7',
  'GET public/stock-media/:key': 'public par conception, testé au S7',
  'GET public/stock-images/:id': 'public par conception, testé au S7 et au S8',
  'POST public/stock-sites/:slug/requests': 'public par conception, testé au S7',
  'POST platform/stock-site-domains/:id/activate': 'plateforme Ocall (super-administrateur)',
  'POST platform/stock-site-domains/:id/suspend': 'plateforme Ocall (super-administrateur)',
};

const PNG_PROMISE = sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } })
  .png()
  .toBuffer();
let PNG: Buffer;

/** Routes déclarées par les contrôleurs Stock (lecture des sources). */
function declaredRoutes(): string[] {
  const dir = join(__dirname, '../src/modules/ocall-stock');
  const routes: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.controller.ts'))) {
    let prefix = '';
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      const c = /@Controller\('([^']*)'\)/.exec(line);
      if (c) prefix = c[1]!;
      const r = /@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/.exec(line);
      if (r)
        routes.push(`${r[1]!.toUpperCase()} ${[prefix, r[2] ?? ''].filter(Boolean).join('/')}`);
    }
  }
  return routes;
}

(enabled ? describe : describe.skip)(
  'Ocall Stock S9 — isolation multi-organisations (intégration)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let db: OcallStockPrismaService;
    let orgA: SignedUpOwner;
    let orgB: SignedUpOwner;
    const ids: Ids = {};

    async function subscribe(organizationId: string) {
      const product = await prisma.saasProduct.findUniqueOrThrow({
        where: { code: STOCK_PRODUCT_CODE },
      });
      const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
        where: { productId_name: { productId: product.id, name: 'Ocall Stock — Avec vitrine' } },
      });
      await prisma.productTrial.create({
        data: {
          organizationId,
          productId: product.id,
          startedAt: new Date(),
          endsAt: new Date(Date.now() + 14 * DAY),
          startedByOcall: true,
        },
      });
      await prisma.subscription.create({
        data: { organizationId, productId: product.id, planId: plan.id, status: 'TRIALING' },
      });
    }

    /** Empreinte des données de A : toute écriture de B la changerait. */
    async function fingerprint() {
      const org = { organizationId: orgA.organizationId };
      const tables = [
        db.stockCategory.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockBrand.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockProduct.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockVariant.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockBarcode.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockProductImage.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockSupplier.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockSite.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockLocation.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockLevel.findMany({
          where: org,
          orderBy: [{ variantId: 'asc' }, { locationId: 'asc' }],
        }),
        db.stockMovement.count({ where: org }),
        db.stockTransfer.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockCount.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockCountLine.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockPurchaseOrder.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockReceipt.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockDocument.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockRegister.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockCashSession.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockSale.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockHeldCart.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockCustomer.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockMember.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockShowcaseMedia.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockShowcaseDomain.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockShowcaseRequest.findMany({ where: org, orderBy: { id: 'asc' } }),
        db.stockAiProposal.findMany({ where: org, orderBy: { id: 'asc' } }),
      ];
      return JSON.stringify(await Promise.all(tables));
    }

    beforeAll(async () => {
      PNG = await PNG_PROMISE;
      ({ app, prisma } = await createTestApp());
      db = app.get(OcallStockPrismaService);
      orgA = await signup(app, 'stockS9A', 'PARK');
      orgB = await signup(app, 'stockS9B', 'PARK');
      await subscribe(orgA.organizationId);
      await subscribe(orgB.organizationId);
      const a = orgA.agent;
      const b = orgB.agent;
      const ok = async <T = Record<string, unknown>>(
        req: ReturnType<Agent['get']>,
        status = 201,
      ) => {
        const res = await req;
        if (res.status !== status) {
          throw new Error(`${status} attendu, ${res.status} : ${res.text.slice(0, 300)}`);
        }
        return res.body as T & Record<string, any>;
      };

      // ── Organisation A : un objet de chaque sorte ──
      const site = await ok(
        a.post(api('/ocall-stock/sites')).send({ code: 'MAG1', name: 'Magasin A', kind: 'STORE' }),
      );
      const site2 = await ok(
        a
          .post(api('/ocall-stock/sites'))
          .send({ code: 'DEP1', name: 'Dépôt A', kind: 'WAREHOUSE' }),
      );
      ids.site = site.id;
      ids.general = site.locations[0].id;
      ids.general2 = site2.locations[0].id;
      ids.bin = (
        await ok(
          a
            .post(api(`/ocall-stock/sites/${site.id}/locations`))
            .send({ kind: 'ZONE', code: 'A', name: 'Zone A' }),
        )
      ).id;
      ids.category = (
        await ok(a.post(api('/ocall-stock/categories')).send({ name: 'Peintures' }))
      ).id;
      ids.brand = (await ok(a.post(api('/ocall-stock/brands')).send({ name: 'Seigneurie' }))).id;
      const paint = await ok(
        a.post(api('/ocall-stock/products')).send({
          name: 'Peinture A',
          salePrice: 11_800,
          purchasePrice: 5000,
          vatRate: 18,
          categoryId: ids.category,
          brandId: ids.brand,
        }),
      );
      ids.product = paint.id;
      ids.variant = paint.variants[0].id;
      ids.barcode = (
        await ok(
          a
            .post(api(`/ocall-stock/variants/${ids.variant}/barcodes`))
            .send({ type: 'EAN13', code: '4006381333931' }),
        )
      ).id;
      ids.barcode = (
        await db.stockBarcode.findFirstOrThrow({
          where: { organizationId: orgA.organizationId, code: '4006381333931' },
        })
      ).id;
      const img = await ok(
        a
          .post(api(`/ocall-stock/products/${ids.product}/images`))
          .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' }),
      );
      expect(img).toBeTruthy();
      ids.image = (
        await db.stockProductImage.findFirstOrThrow({ where: { productId: ids.product } })
      ).id;
      ids.supplier = (
        await ok(
          a.post(api('/ocall-stock/suppliers')).send({ name: 'Grossiste A', leadTimeDays: 7 }),
        )
      ).id;
      await ok(
        a.post(api('/ocall-stock/movements')).send({
          kind: 'IN',
          variantId: ids.variant,
          locationId: ids.general,
          quantity: 50,
          idempotencyKey: key(),
        }),
      );

      const order = await ok(
        a.post(api('/ocall-stock/purchase-orders')).send({
          supplierId: ids.supplier,
          siteId: ids.site,
          lines: [{ variantId: ids.variant, quantity: 10, unitCost: 5000, vatRate: 18 }],
        }),
      );
      ids.order = order.id;
      ids.orderLine = order.lines[0].id;
      await ok(a.post(api(`/ocall-stock/purchase-orders/${order.id}/order`)), 200);
      const receipt = await ok(
        a.post(api(`/ocall-stock/purchase-orders/${order.id}/receive`)).send({
          idempotencyKey: key(),
          lines: [{ orderLineId: ids.orderLine, quantity: 5, locationId: ids.general }],
        }),
        200,
      );
      expect(receipt).toBeTruthy();
      ids.receipt = (
        await db.stockReceipt.findFirstOrThrow({ where: { organizationId: orgA.organizationId } })
      ).id;
      ids.draft = (
        await ok(
          a.post(api('/ocall-stock/purchase-orders')).send({
            supplierId: ids.supplier,
            siteId: ids.site,
            lines: [{ variantId: ids.variant, quantity: 1, unitCost: 5000, vatRate: 18 }],
          }),
        )
      ).id;
      ids.document = (
        await ok(
          a
            .post(api(`/ocall-stock/documents/PURCHASE_ORDER/${ids.order}`))
            .attach('file', PDF, { filename: 'bl.pdf', contentType: 'application/pdf' }),
        )
      ).id;

      ids.register = (
        await ok(
          a
            .post(api('/ocall-stock/registers'))
            .send({ code: 'CAISSE1', name: 'Caisse 1', locationId: ids.general }),
        )
      ).id;
      ids.register2 = (
        await ok(
          a
            .post(api('/ocall-stock/registers'))
            .send({ code: 'CAISSE2', name: 'Caisse 2', locationId: ids.general }),
        )
      ).id;
      ids.session = (
        await ok(
          a.post(api(`/ocall-stock/registers/${ids.register}/sessions`)).send({ openingFloat: 0 }),
        )
      ).id;
      ids.customer = (
        await ok(
          a
            .post(api('/ocall-stock/customers'))
            .send({ name: 'Client A', phone: '+223 76 00 00 09' }),
        )
      ).id;
      const sale = await ok(
        a.post(api('/ocall-stock/sales')).send({
          idempotencyKey: key(),
          registerId: ids.register,
          customerId: ids.customer,
          lines: [{ variantId: ids.variant, quantity: 2 }],
          payments: [{ method: 'CASH', amount: 23_600 }],
        }),
      );
      ids.sale = sale.id;
      ids.saleLine = sale.lines[0].id;
      ids.heldCart = (
        await ok(
          a
            .post(api(`/ocall-stock/registers/${ids.register}/held-carts`))
            .send({ label: 'En attente', lines: [{ variantId: ids.variant, quantity: 1 }] }),
        )
      ).id;

      const transfer = await ok(
        a.post(api('/ocall-stock/transfers')).send({
          fromSiteId: ids.site,
          toSiteId: site2.id,
          lines: [{ variantId: ids.variant, quantity: 2 }],
        }),
      );
      ids.transfer = transfer.id;
      ids.transferLine = transfer.lines[0].id;
      const count = await ok(
        a
          .post(api('/ocall-stock/counts'))
          .send({ siteId: site2.id, name: 'Inventaire A', scope: 'FULL' }),
      );
      ids.count = count.id;
      const counted = await ok(
        a
          .put(api(`/ocall-stock/counts/${count.id}/lines`))
          .send({ variantId: ids.variant, locationId: ids.general2, quantity: 1, mode: 'SET' }),
        200,
      );
      expect(counted).toBeTruthy();
      ids.countLine = (
        await db.stockCountLine.findFirstOrThrow({ where: { countId: count.id } })
      ).id;

      const member = await ok(
        a
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Membre', lastName: 'A', role: 'CASHIER' }),
      );
      ids.member = member.member.id;
      for (const [agent, name] of [
        [a, 'tenant-a'],
        [b, 'tenant-b'],
      ] as const) {
        await ok(
          agent
            .put(api('/ocall-stock/showcase/slug'))
            .send({ slug: `${name}-${RUN}`.toLowerCase().slice(0, 40) }),
          200,
        );
      }
      await ok(
        a
          .post(api('/ocall-stock/showcase/media'))
          .field('kind', 'GALLERY')
          .attach('file', PNG, { filename: 'g.png', contentType: 'image/png' }),
      );
      ids.media = (
        await db.stockShowcaseMedia.findFirstOrThrow({
          where: { organizationId: orgA.organizationId },
        })
      ).id;
      ids.domain = (
        await ok(
          a
            .post(api('/ocall-stock/showcase/domains'))
            .send({ hostname: `www.tenant-a-${RUN}.ml`.toLowerCase() }),
        )
      ).id;
      ids.request = (
        await db.stockShowcaseRequest.create({
          data: {
            organizationId: orgA.organizationId,
            kind: 'QUOTE',
            name: 'Visiteur',
            phone: '+223 76 00 00 08',
            message: 'Devis',
          },
        })
      ).id;
      ids.proposal = (
        await db.stockAiProposal.create({
          data: {
            organizationId: orgA.organizationId,
            feature: 'STOCK_ILLUSTRATION',
            targetType: 'StockProduct',
            targetId: ids.product,
            input: {},
            output: { storageKey: 'aucune' },
            model: 'simulated',
            createdByUserId: randomUUID(),
          },
        })
      ).id;

      // ── Organisation B : ses propres objets, pour les identifiants croisés dans les corps ──
      const bSite = await ok(
        b.post(api('/ocall-stock/sites')).send({ code: 'MAG1', name: 'Magasin B', kind: 'STORE' }),
      );
      ids.bSite = bSite.id;
      ids.bGeneral = bSite.locations[0].id;
      ids.bVariant = (
        await ok(
          b.post(api('/ocall-stock/products')).send({ name: 'Article B', salePrice: 11_800 }),
        )
      ).variants[0].id;
      ids.bSupplier = (
        await ok(b.post(api('/ocall-stock/suppliers')).send({ name: 'Fournisseur B' }))
      ).id;
      ids.bRegister = (
        await ok(
          b
            .post(api('/ocall-stock/registers'))
            .send({ code: 'CAISSE1', name: 'Caisse B', locationId: ids.bGeneral }),
        )
      ).id;
      await ok(
        b.post(api(`/ocall-stock/registers/${ids.bRegister}/sessions`)).send({ openingFloat: 0 }),
      );
      await ok(
        b.post(api('/ocall-stock/movements')).send({
          kind: 'IN',
          variantId: ids.bVariant,
          locationId: ids.bGeneral,
          quantity: 50,
          idempotencyKey: key(),
        }),
      );
      ids.bMember = (
        await ok(
          b
            .post(api('/ocall-stock/members'))
            .send({ firstName: 'Membre', lastName: 'B', role: 'CASHIER' }),
        )
      ).member.id;
      await ok(
        b.put(api('/ocall-stock/ai/settings')).send({
          enabled: true,
          restockEnabled: true,
          stockoutEnabled: true,
          analysisEnabled: true,
          photoEnabled: true,
          illustrationEnabled: true,
          restockMonthlyLimit: 50,
          stockoutMonthlyLimit: 50,
          analysisMonthlyLimit: 30,
          photoMonthlyLimit: 100,
          illustrationMonthlyLimit: 20,
        }),
        200,
      );
      for (const [name, id] of Object.entries(ids))
        expect([name, id]).toEqual([name, expect.any(String)]);
    }, 600_000);

    afterAll(async () => {
      try {
        if (db && orgA && orgB) {
          const { purgeStockOrganizations } = await import('@ocall/stock-database');
          await purgeStockOrganizations(db, [orgA.organizationId, orgB.organizationId]);
        }
        if (prisma) await cleanup(prisma);
      } finally {
        await app?.close();
      }
    });

    it('chaque route à identifiant est couverte ou exemptée avec sa raison', () => {
      const covered = new Set(PATH_CASES.map(([r]) => r));
      const withId = declaredRoutes().filter((r) => r.includes(':'));
      expect(withId.length).toBeGreaterThan(70);
      expect(withId.filter((r) => !covered.has(r) && !(r in EXEMPT))).toEqual([]);
      // Pas d'entrée périmée : chaque cas correspond à une route réelle.
      expect([...covered, ...Object.keys(EXEMPT)].filter((r) => !withId.includes(r))).toEqual([]);
    });

    it('identifiant de A dans le chemin : 404 sur toutes les routes, rien ne change chez A', async () => {
      const before = await fingerprint();
      const wrong: string[] = [];
      for (const [route, call] of PATH_CASES) {
        const res = await call(orgB.agent, ids);
        const text = typeof res.text === 'string' ? res.text : '';
        if (res.status !== 404) wrong.push(`${route} → ${res.status} ${text.slice(0, 160)}`);
      }
      expect(wrong).toEqual([]);
      expect(await fingerprint()).toBe(before);
    });

    it('identifiant de A dans le corps : refusé, jamais un succès ni une erreur serveur, rien ne change chez A', async () => {
      const before = await fingerprint();
      const wrong: string[] = [];
      for (const [route, call] of BODY_CASES) {
        const res = await call(orgB.agent, ids);
        if (![400, 404].includes(res.status))
          wrong.push(`${route} → ${res.status} ${res.text?.slice(0, 160)}`);
      }
      expect(wrong).toEqual([]);
      expect(await fingerprint()).toBe(before);
    });

    it('listes et recherches de B : aucune donnée de A', async () => {
      const lists = [
        '/ocall-stock/categories',
        '/ocall-stock/brands',
        '/ocall-stock/products',
        '/ocall-stock/suppliers',
        '/ocall-stock/search?q=Peinture',
        '/ocall-stock/lookup?code=4006381333931',
        '/ocall-stock/registers',
        '/ocall-stock/cash-sessions',
        '/ocall-stock/sales',
        '/ocall-stock/customers?q=Client',
        '/ocall-stock/purchase-orders',
        '/ocall-stock/supplier-returns',
        '/ocall-stock/sites',
        '/ocall-stock/locations/lookup?code=A',
        '/ocall-stock/levels',
        '/ocall-stock/movements',
        '/ocall-stock/transfers',
        '/ocall-stock/counts',
        '/ocall-stock/members',
        '/ocall-stock/facture-events',
        '/ocall-stock/reports/dashboard',
        '/ocall-stock/reports/alerts',
        '/ocall-stock/showcase',
        '/ocall-stock/showcase/products',
        '/ocall-stock/showcase/requests',
        '/ocall-stock/ai/proposals',
      ];
      const secrets = Object.entries(ids)
        .filter(([n]) => !n.startsWith('b'))
        .map(([, v]) => v);
      const leaks: string[] = [];
      for (const path of lists) {
        const res = await orgB.agent.get(api(path));
        if (res.status >= 500) leaks.push(`${path} → ${res.status}`);
        const found = secrets.filter((s) => res.text.includes(s));
        if (found.length > 0 || res.text.includes('Peinture A'))
          leaks.push(`${path} : ${found.join(',')}`);
      }
      expect(leaks).toEqual([]);
    });
  },
);
