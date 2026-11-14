import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { STORAGE_PROVIDER, type StorageProvider } from '../src/common/storage/storage-provider';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import { OcallStockShowcaseService } from '../src/modules/ocall-stock/ocall-stock-showcase.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

/**
 * Ocall Stock — S9, corrections de la revue de sécurité : prix fixés seulement avec le droit de gérer les
 * prix (un article se crée au prix 0 sans lui) ; prix d'achat jamais devinable par une modification ;
 * documents fournisseurs (avec prix d'achat) ouverts seulement avec ce droit, photos jointes sans
 * métadonnées ; nom de fichier quelconque téléchargeable ; plan du site public gardé en mémoire.
 * Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

(enabled ? describe : describe.skip)(
  'Ocall Stock S9 — corrections de sécurité (intégration)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let db: OcallStockPrismaService;
    let storage: StorageProvider;
    let org: SignedUpOwner;
    let a: Agent;
    let warehouse: Agent;
    let blindManager: Agent;
    let keeper: Agent;
    let paint: { productId: string; variantId: string };
    let orderId: string;

    async function member(
      role: string,
      lastName: string,
      overrides: { permission: string; granted: boolean }[] = [],
    ) {
      const created = (
        await a
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Membre', lastName, role })
          .expect(201)
      ).body;
      if (overrides.length > 0) {
        await a
          .put(api(`/ocall-stock/members/${created.member.id}/permissions`))
          .send({ overrides })
          .expect(200);
      }
      const session = await login(app, created.member.loginId, created.temporaryPassword);
      await session.agent
        .post(api('/auth/change-password'))
        .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
        .expect(204);
      return session.agent;
    }

    beforeAll(async () => {
      ({ app, prisma } = await createTestApp());
      db = app.get(OcallStockPrismaService);
      storage = app.get<StorageProvider>(STORAGE_PROVIDER);
      org = await signup(app, 'stockS9S', 'PARK');
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
      const site = (
        await a
          .post(api('/ocall-stock/sites'))
          .send({ code: 'MAG1', name: 'Magasin', kind: 'STORE' })
          .expect(201)
      ).body;
      const p = (
        await a
          .post(api('/ocall-stock/products'))
          .send({ name: 'Peinture blanche 5 L', salePrice: 11_800, purchasePrice: 5000 })
          .expect(201)
      ).body;
      paint = { productId: p.id, variantId: p.variants[0].id };
      const supplierId = (
        await a.post(api('/ocall-stock/suppliers')).send({ name: 'Grossiste' }).expect(201)
      ).body.id;
      orderId = (
        await a
          .post(api('/ocall-stock/purchase-orders'))
          .send({
            supplierId,
            siteId: site.id,
            lines: [{ variantId: paint.variantId, quantity: 5, unitCost: 5000, vatRate: 18 }],
          })
          .expect(201)
      ).body.id;
      warehouse = await member('WAREHOUSE_MANAGER', 'Entrepot');
      blindManager = await member('STORE_MANAGER', 'SansCouts', [
        { permission: 'stock.prices.purchase.read', granted: false },
      ]);
      keeper = await member('STOREKEEPER', 'Magasinier');
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

    it('sans le droit de gérer les prix : article créé au prix 0, jamais à un prix choisi', async () => {
      const refused = await warehouse
        .post(api('/ocall-stock/products'))
        .send({ name: 'Colle forte', salePrice: 9_999 })
        .expect(403);
      expect(refused.body.message).toContain('laissez le prix de vente à 0');
      await warehouse
        .post(api('/ocall-stock/products'))
        .send({ name: 'Colle forte', salePrice: 0, purchasePrice: 100 })
        .expect(403);
      const created = (
        await warehouse
          .post(api('/ocall-stock/products'))
          .send({ name: 'Colle forte', salePrice: 0 })
          .expect(201)
      ).body;
      expect(created).toMatchObject({ salePrice: 0 });
      // Le responsable du magasin fixe le prix.
      await a
        .patch(api(`/ocall-stock/products/${created.id}`))
        .send({ salePrice: 2_500 })
        .expect(200);
    });

    it('prix d’achat jamais devinable : refus dès que le champ est envoyé, même à sa valeur actuelle', async () => {
      for (const value of [5000, 4999]) {
        await blindManager
          .patch(api(`/ocall-stock/products/${paint.productId}`))
          .send({ purchasePrice: value })
          .expect(403);
        await blindManager
          .patch(api(`/ocall-stock/variants/${paint.variantId}`))
          .send({ purchasePrice: value })
          .expect(403);
      }
      // Même la valeur actuelle de la variante (aucun prix propre) : refusée, rien à deviner.
      await blindManager
        .patch(api(`/ocall-stock/variants/${paint.variantId}`))
        .send({ purchasePrice: null })
        .expect(403);
      // Le prix de vente reste modifiable par ce responsable.
      await blindManager
        .patch(api(`/ocall-stock/products/${paint.productId}`))
        .send({ salePrice: 12_000 })
        .expect(200);
    });

    it('documents fournisseurs : ouverts avec le droit aux prix d’achat ; photos sans métadonnées ; nom quelconque', async () => {
      const withExif = await sharp({
        create: { width: 40, height: 30, channels: 3, background: '#c0c0c0' },
      })
        .jpeg()
        .withExif({ IFD0: { Copyright: 'Position secrète', Artist: 'Téléphone de Awa' } })
        .toBuffer();
      expect((await sharp(withExif).metadata()).exif).toBeDefined();
      // Le magasinier joint la photo du bon de livraison (nom avec apostrophe typographique)…
      const photo = (
        await keeper
          .post(api(`/ocall-stock/documents/PURCHASE_ORDER/${orderId}`))
          .attach('file', withExif, { filename: 'bon’livraison.jpg', contentType: 'image/jpeg' })
          .expect(201)
      ).body;
      const stored = await db.stockDocument.findUniqueOrThrow({ where: { id: photo.id } });
      const meta = await sharp((await storage.get(stored.storageKey))!).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta).toMatchObject({ width: 40, height: 30, format: 'jpeg' });
      expect(stored.bytes).toBe((await storage.get(stored.storageKey))!.length);
      // … la voit dans la liste, mais ne l'ouvre pas (factures et bons portent les prix d'achat).
      const listed = (
        await keeper.get(api(`/ocall-stock/documents/PURCHASE_ORDER/${orderId}`)).expect(200)
      ).body;
      expect(listed.map((d: { id: string }) => d.id)).toContain(photo.id);
      expect(
        (await keeper.get(api(`/ocall-stock/documents/${photo.id}`)).expect(403)).body.code,
      ).toBe('STOCK_PRICE_FORBIDDEN');
      // Le responsable l'ouvre ; un nom non ASCII ne provoque plus d'erreur serveur.
      const file = await a
        .get(api(`/ocall-stock/documents/${photo.id}`))
        .buffer(true)
        .expect(200);
      expect(file.headers['content-disposition']).toBe(
        `attachment; filename="bon_livraison.jpg"; filename*=UTF-8''bon%E2%80%99livraison.jpg`,
      );
      const pdf = (
        await a
          .post(api(`/ocall-stock/documents/PURCHASE_ORDER/${orderId}`))
          .attach('file', PDF, {
            filename: 'Facture n°12 – été.pdf',
            contentType: 'application/pdf',
          })
          .expect(201)
      ).body;
      expect(
        (
          await a
            .get(api(`/ocall-stock/documents/${pdf.id}`))
            .buffer(true)
            .expect(200)
        ).headers['content-disposition'],
      ).toContain("filename*=UTF-8''Facture%20n%C2%B012%20%E2%80%93%20%C3%A9t%C3%A9.pdf");
      // Un fichier qui se dit JPEG mais n'en est pas un : refusé.
      const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(randomUUID())]);
      await keeper
        .post(api(`/ocall-stock/documents/PURCHASE_ORDER/${orderId}`))
        .attach('file', fake, { filename: 'faux.jpg', contentType: 'image/jpeg' })
        .expect(400);
    });

    it('plan du site public : calculé une fois par adresse servie, jamais pour une adresse inconnue', async () => {
      const showcase = app.get(OcallStockShowcaseService);
      const build = jest.spyOn(
        showcase as unknown as { buildSitemap: (h: string) => Promise<unknown> },
        'buildSitemap',
      );
      try {
        const platform = new URL(app.get<AppConfig>(APP_CONFIG).sites.publicOrigin).hostname;
        const first = await showcase.sitemap(platform);
        const again = await showcase.sitemap(`${platform.toUpperCase()}:443`);
        expect(again).toEqual(first);
        expect(build).toHaveBeenCalledTimes(1);
        await showcase.sitemap('inconnu.example');
        await showcase.sitemap('inconnu.example');
        expect(build).toHaveBeenCalledTimes(3);
      } finally {
        build.mockRestore();
      }
    });
  },
);
