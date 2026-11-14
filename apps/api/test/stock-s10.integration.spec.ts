import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { STOCK_PRODUCT_CODE, formatStockMoney } from '@ocall/shared';
import * as labelPdf from '../src/modules/ocall-stock/ocall-stock-label-pdf';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
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
 * Ocall Stock — S10 : prix par boutique (prix commun + exceptions) suivis par la caisse, les étiquettes et
 * la vitrine ; vitrine unique avec choix de la boutique (page « Nos boutiques », prix et disponibilité de
 * la boutique, demande adressée à la boutique). Facture garde le prix commun. Données fictives, bases
 * jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID();
const opened = () => Date.now() - 10_000;

(enabled ? describe : describe.skip)(
  'Ocall Stock S10 — prix et vitrine par boutique (intégration)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let db: OcallStockPrismaService;
    let org: SignedUpOwner;
    let other: SignedUpOwner;
    let a: Agent;
    let manager: Agent; // responsable de magasin limité à la boutique 1
    let managerId: string;
    let cashier: Agent;
    let bamako: { id: string; general: string };
    let segou: { id: string; general: string };
    let kayes: { id: string; general: string };
    let paint: { productId: string; variantId: string };
    let cement: { productId: string; small: string; large: string };
    let currency: string;
    const slug = `s10-${Date.now().toString(36)}`;

    const pub = () => request(app.getHttpServer());
    const money = (v: number) => formatStockMoney(v, currency);

    async function subscribe(organizationId: string, withShowcase: boolean) {
      const saas = await prisma.saasProduct.findUniqueOrThrow({
        where: { code: STOCK_PRODUCT_CODE },
      });
      const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
        where: {
          productId_name: {
            productId: saas.id,
            name: `Ocall Stock — ${withShowcase ? 'Avec vitrine' : 'Sans vitrine'}`,
          },
        },
      });
      await prisma.productTrial.create({
        data: {
          organizationId,
          productId: saas.id,
          startedAt: new Date(),
          endsAt: new Date(Date.now() + 14 * DAY),
          startedByOcall: true,
        },
      });
      await prisma.subscription.create({
        data: { organizationId, productId: saas.id, planId: plan.id, status: 'TRIALING' },
      });
    }

    async function member(role: string, lastName: string) {
      const created = (
        await a
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Membre', lastName, role })
          .expect(201)
      ).body;
      const session = await login(app, created.member.loginId, created.temporaryPassword);
      await session.agent
        .post(api('/auth/change-password'))
        .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
        .expect(204);
      return { agent: session.agent, id: created.member.id as string };
    }

    async function site(agent: Agent, code: string, name: string, city: string) {
      const s = (
        await agent
          .post(api('/ocall-stock/sites'))
          .send({ code, name, kind: 'STORE', address: `Rue ${code}`, city })
          .expect(201)
      ).body;
      return { id: s.id as string, general: s.locations[0].id as string };
    }

    async function stockIn(variantId: string, locationId: string, quantity: number) {
      await a
        .post(api('/ocall-stock/movements'))
        .send({ kind: 'IN', variantId, locationId, quantity, idempotencyKey: key() })
        .expect(201);
    }

    const setPrice = (agent: Agent, variantId: string, siteId: string, salePrice: number) =>
      agent
        .put(api(`/ocall-stock/variants/${variantId}/site-prices/${siteId}`))
        .send({ salePrice });

    beforeAll(async () => {
      ({ app, prisma } = await createTestApp());
      db = app.get(OcallStockPrismaService);
      org = await signup(app, 'stockS10', 'PARK');
      other = await signup(app, 'stockS10B', 'PARK');
      a = org.agent;
      await subscribe(org.organizationId, true);
      await subscribe(other.organizationId, false);
      currency = (
        await prisma.organization.findUniqueOrThrow({
          where: { id: org.organizationId },
          select: { currency: true },
        })
      ).currency;
      bamako = await site(a, 'BKO', 'Boutique Bamako', 'Bamako');
      segou = await site(a, 'SEG', 'Boutique Ségou', 'Ségou');
      kayes = await site(a, 'KAY', 'Boutique Kayes', 'Kayes');
      const p = (
        await a
          .post(api('/ocall-stock/products'))
          .send({ name: 'Peinture blanche 5 L', salePrice: 10_000 })
          .expect(201)
      ).body;
      paint = { productId: p.id, variantId: p.variants[0].id };
      const c = (
        await a
          .post(api('/ocall-stock/products'))
          .send({ name: 'Ciment', salePrice: 5_000 })
          .expect(201)
      ).body;
      const small = (
        await a
          .post(api(`/ocall-stock/products/${c.id}/variants`))
          .send({ name: '25 kg' })
          .expect(201)
      ).body.variants.find((v: { name: string }) => v.name === '25 kg').id;
      const large = (
        await a
          .post(api(`/ocall-stock/products/${c.id}/variants`))
          .send({ name: '50 kg', salePrice: 9_000 })
          .expect(201)
      ).body.variants.find((v: { name: string }) => v.name === '50 kg').id;
      cement = { productId: c.id, small, large };
      await stockIn(paint.variantId, bamako.general, 5);
      await stockIn(cement.small, segou.general, 3);
      const m = await member('STORE_MANAGER', 'Bamako');
      manager = m.agent;
      managerId = m.id;
      await a
        .put(api(`/ocall-stock/members/${managerId}/sites`))
        .send({ siteIds: [bamako.id] })
        .expect(200);
      cashier = (await member('CASHIER', 'Caisse')).agent;
    }, 300_000);

    afterAll(async () => {
      try {
        if (db && org && other) {
          const { purgeStockOrganizations } = await import('@ocall/stock-database');
          await purgeStockOrganizations(db, [org.organizationId, other.organizationId]);
        }
        if (prisma) await cleanup(prisma);
      } finally {
        await app?.close();
      }
    });

    it('prix de boutique : exception tracée, retour au prix commun, droits et boutiques contrôlés', async () => {
      const set = (await setPrice(a, paint.variantId, segou.id, 9_500).expect(200)).body;
      const variant = set.variants[0];
      expect(variant.effectiveSalePrice).toBe(10_000);
      expect(variant.sitePrices).toEqual([{ siteId: segou.id, salePrice: 9_500 }]);
      // Même prix : rien de nouveau dans l'historique.
      await setPrice(a, paint.variantId, segou.id, 9_500).expect(200);
      await setPrice(a, paint.variantId, segou.id, 9_000).expect(200);
      const history = (
        await a.get(api(`/ocall-stock/products/${paint.productId}/history`)).expect(200)
      ).body;
      expect(
        history.prices
          .filter((h: { siteId: string | null }) => h.siteId === segou.id)
          .map((h: { oldPrice: number | null; newPrice: number | null }) => [
            h.oldPrice,
            h.newPrice,
          ]),
      ).toEqual([
        [9_500, 9_000],
        [null, 9_500],
      ]);
      expect(
        history.changes.filter((c: { action: string }) => c.action === 'site_price_set'),
      ).toHaveLength(2);

      // Retour au prix commun : exception supprimée, tracée ; deuxième retrait sans effet.
      const back = (
        await a
          .delete(api(`/ocall-stock/variants/${paint.variantId}/site-prices/${segou.id}`))
          .expect(200)
      ).body;
      expect(back.variants[0].sitePrices).toEqual([]);
      await a
        .delete(api(`/ocall-stock/variants/${paint.variantId}/site-prices/${segou.id}`))
        .expect(200);
      const after = (
        await a.get(api(`/ocall-stock/products/${paint.productId}/history`)).expect(200)
      ).body;
      expect(
        after.prices.filter((h: { siteId: string | null }) => h.siteId === segou.id)[0],
      ).toMatchObject({ oldPrice: 9_000, newPrice: null });
      expect(
        after.changes.filter((c: { action: string }) => c.action === 'site_price_removed'),
      ).toHaveLength(1);

      // Prix invalide, caissier sans droit, boutique d'une autre organisation.
      await setPrice(a, paint.variantId, segou.id, -1).expect(400);
      expect((await setPrice(cashier, paint.variantId, segou.id, 1).expect(403)).body.code).toBe(
        'FORBIDDEN',
      );
      const foreign = await site(other.agent, 'AUT', 'Autre', 'Mopti');
      expect((await setPrice(a, paint.variantId, foreign.id, 1).expect(404)).body.code).toBe(
        'STOCK_SITE_NOT_FOUND',
      );
      // Responsable limité à Bamako : Ségou lui est inconnue.
      expect((await setPrice(manager, paint.variantId, segou.id, 1).expect(404)).body.code).toBe(
        'STOCK_SITE_NOT_FOUND',
      );
      await setPrice(manager, paint.variantId, bamako.id, 9_900).expect(200);
      expect(await db.stockSitePrice.count({ where: { organizationId: org.organizationId } })).toBe(
        1,
      );
      await a
        .delete(api(`/ocall-stock/variants/${paint.variantId}/site-prices/${bamako.id}`))
        .expect(200);
    });

    it('boutique archivée : aucun nouveau prix ; un membre limité ne voit que les prix de ses boutiques', async () => {
      const shut = await site(a, 'FER', 'Boutique fermée', 'Sikasso');
      await a
        .patch(api(`/ocall-stock/sites/${shut.id}`))
        .send({ isArchived: true })
        .expect(200);
      expect((await setPrice(a, paint.variantId, shut.id, 1).expect(409)).body.code).toBe(
        'STOCK_SITE_ARCHIVED',
      );

      await setPrice(a, cement.large, segou.id, 8_500).expect(200);
      await setPrice(a, cement.large, bamako.id, 9_200).expect(200);
      const seen = (await manager.get(api(`/ocall-stock/products/${cement.productId}`)).expect(200))
        .body;
      const large = seen.variants.find((v: { id: string }) => v.id === cement.large);
      expect(large.sitePrices).toEqual([{ siteId: bamako.id, salePrice: 9_200 }]);
      const history = (
        await manager.get(api(`/ocall-stock/products/${cement.productId}/history`)).expect(200)
      ).body;
      expect(history.prices.some((h: { siteId: string | null }) => h.siteId === segou.id)).toBe(
        false,
      );
      expect(history.prices.some((h: { siteId: string | null }) => h.siteId === bamako.id)).toBe(
        true,
      );
    });

    it('caisse : chaque boutique encaisse à son prix ; le prix commun ailleurs', async () => {
      await setPrice(a, paint.variantId, segou.id, 9_500).expect(200);
      const register = async (code: string, locationId: string) => {
        const id = (
          await a
            .post(api('/ocall-stock/registers'))
            .send({ code, name: code, locationId })
            .expect(201)
        ).body.id as string;
        await a
          .post(api(`/ocall-stock/registers/${id}/sessions`))
          .send({ openingFloat: 0 })
          .expect(201);
        return id;
      };
      const bko = await register('CAISSEBKO', bamako.general);
      const seg = await register('CAISSESEG', segou.general);
      await stockIn(paint.variantId, segou.general, 5);

      const items = (
        await a
          .get(api(`/ocall-stock/registers/${seg}/items`))
          .query({ q: 'Peinture' })
          .expect(200)
      ).body;
      expect(
        items.find((i: { variantId: string }) => i.variantId === paint.variantId).unitPrice,
      ).toBe(9_500);
      const scan = (
        await a
          .get(api(`/ocall-stock/registers/${bko}/items`))
          .query({ q: 'Peinture' })
          .expect(200)
      ).body;
      expect(
        scan.find((i: { variantId: string }) => i.variantId === paint.variantId).unitPrice,
      ).toBe(10_000);

      const sell = (registerId: string, amount: number) =>
        a.post(api('/ocall-stock/sales')).send({
          idempotencyKey: key(),
          registerId,
          lines: [{ variantId: paint.variantId, quantity: 2 }],
          payments: [{ method: 'CARD', amount }],
        });
      // Paiement au prix commun refusé à Ségou : le serveur compte au prix de la boutique.
      await sell(seg, 20_000).expect(400);
      const atSegou = (await sell(seg, 19_000).expect(201)).body;
      expect(atSegou.lines[0]).toMatchObject({ unitPrice: 9_500, total: 19_000 });
      const atBamako = (await sell(bko, 20_000).expect(201)).body;
      expect(atBamako.lines[0]).toMatchObject({ unitPrice: 10_000, total: 20_000 });
    });

    it('étiquettes : prix de la boutique demandée, de l’unique boutique du membre, sinon prix commun', async () => {
      const spy = jest.spyOn(labelPdf, 'renderLabelsPdf');
      try {
        const print = (agent: Agent, siteId?: string) =>
          agent
            .post(api('/ocall-stock/labels.pdf'))
            .send({
              format: '50x30',
              fields: ['productName', 'price'],
              items: [{ variantId: paint.variantId, copies: 1 }],
              ...(siteId ? { siteId } : {}),
            })
            .buffer(true);
        const printed = () => spy.mock.calls.at(-1)![2].map((l) => l.price);
        await print(a).expect(200);
        expect(printed()).toEqual([money(10_000)]);
        await print(a, segou.id).expect(200);
        expect(printed()).toEqual([money(9_500)]);
        // Responsable limité à Bamako : son prix sans le demander ; Ségou lui est refusée.
        await setPrice(a, paint.variantId, bamako.id, 9_800).expect(200);
        await print(manager).expect(200);
        expect(printed()).toEqual([money(9_800)]);
        expect((await print(manager, segou.id).expect(404)).body.code).toBe('STOCK_SITE_NOT_FOUND');
      } finally {
        spy.mockRestore();
      }
    });

    it('vitrine : boutiques présentées vérifiées, prix et disponibilité de la boutique choisie', async () => {
      await a.put(api('/ocall-stock/showcase/slug')).send({ slug }).expect(200);
      const content = (shops: unknown[]) => ({
        headline: 'Quincaillerie du Sahel',
        phone: '+223 20 22 00 00',
        whatsapp: '+223 70 11 22 33',
        city: 'Bamako',
        showCatalog: true,
        showPrices: true,
        forms: ['CONTACT', 'QUOTE'],
        shops,
      });
      const shop = (siteId: string, over: Record<string, unknown> = {}) => ({
        siteId,
        phone: null,
        whatsapp: null,
        hours: null,
        mapUrl: null,
        ...over,
      });
      const draft = (shops: unknown[]) =>
        a.put(api('/ocall-stock/showcase/draft')).send(content(shops));
      expect((await draft([shop(bamako.id), shop(bamako.id)]).expect(400)).body).toMatchObject({
        code: 'STOCK_SHOWCASE_SHOPS',
        message: 'Une boutique ne figure qu’une fois sur la vitrine.',
      });
      const foreign = (await other.agent.get(api('/ocall-stock/sites')).expect(200)).body[0].id;
      expect((await draft([shop(foreign)]).expect(400)).body.code).toBe('STOCK_SHOWCASE_SHOPS');
      expect(
        (await draft([shop(bamako.id, { mapUrl: 'javascript:alert(1)' })]).expect(400)).body.code,
      ).toBe('STOCK_SHOWCASE_MAP_URL');
      await draft([
        shop(bamako.id, { hours: 'Lun–Sam 8 h–19 h', whatsapp: '+223 70 00 00 01' }),
        shop(segou.id, { phone: '+223 21 32 00 00' }),
      ]).expect(200);
      await a
        .put(api(`/ocall-stock/showcase/products/${paint.productId}`))
        .send({ published: true })
        .expect(200);
      await a
        .put(api(`/ocall-stock/showcase/products/${cement.productId}`))
        .send({ published: true })
        .expect(200);
      // Kayes archivée après le brouillon : jamais publiée.
      await a
        .put(api('/ocall-stock/showcase/draft'))
        .send(content([shop(bamako.id), shop(segou.id), shop(kayes.id)]))
        .expect(200);
      await a
        .patch(api(`/ocall-stock/sites/${kayes.id}`))
        .send({ isArchived: true })
        .expect(200);
      await a.post(api('/ocall-stock/showcase/publish')).expect(200);

      const home = (
        await pub()
          .get(api(`/public/stock-sites/${slug}`))
          .expect(200)
      ).body;
      expect(home.shop).toBeNull();
      expect(home.site.shops).toEqual([
        expect.objectContaining({ siteId: bamako.id, name: 'Boutique Bamako', city: 'Bamako' }),
        expect.objectContaining({ siteId: segou.id, name: 'Boutique Ségou', address: 'Rue SEG' }),
      ]);

      const catalog = async (boutique?: string) =>
        (
          await pub()
            .get(api(`/public/stock-sites/${slug}/catalogue`))
            .query(boutique ? { boutique } : {})
            .expect(200)
        ).body;
      const byName = (body: { items: { name: string }[] }, name: string) =>
        body.items.find((i) => i.name === name) as unknown as {
          priceTtc: number;
          priceFrom: boolean;
          availability: string;
        };

      // Sans boutique : prix communs, stock de toutes les boutiques.
      const all = await catalog();
      expect(all.shop).toBeNull();
      expect(byName(all, 'Peinture blanche 5 L')).toMatchObject({
        priceTtc: 10_000,
        availability: 'AVAILABLE',
      });
      expect(byName(all, 'Ciment')).toMatchObject({
        priceTtc: 5_000,
        priceFrom: true,
        availability: 'AVAILABLE',
      });

      // Ségou : son prix de peinture ; ciment 25 kg en stock là-bas, 50 kg à son prix propre.
      const atSegou = await catalog(segou.id);
      expect(atSegou.shop).toMatchObject({ siteId: segou.id, name: 'Boutique Ségou' });
      expect(byName(atSegou, 'Peinture blanche 5 L')).toMatchObject({ priceTtc: 9_500 });
      expect(byName(atSegou, 'Ciment')).toMatchObject({
        priceTtc: 5_000,
        availability: 'AVAILABLE',
      });

      // Bamako : ciment hors stock là-bas (seulement à Ségou) → « Sur commande ».
      const atBamako = await catalog(bamako.id);
      expect(byName(atBamako, 'Ciment').availability).toBe('ON_ORDER');
      expect(byName(atBamako, 'Peinture blanche 5 L')).toMatchObject({
        priceTtc: 9_800,
        availability: 'AVAILABLE',
      });

      // Boutique non présentée (archivée, autre organisation, inconnue) : vitrine de l'entreprise.
      for (const id of [kayes.id, foreign, randomUUID()]) {
        const body = await catalog(id);
        expect(body.shop).toBeNull();
        expect(byName(body, 'Peinture blanche 5 L').priceTtc).toBe(10_000);
      }
      const product = (
        await pub()
          .get(api(`/public/stock-sites/${slug}/articles/${paint.productId}`))
          .query({ boutique: segou.id })
          .expect(200)
      ).body;
      expect(product.shop.siteId).toBe(segou.id);
      expect(product.product.priceTtc).toBe(9_500);
      const homeAtSegou = (
        await pub()
          .get(api(`/public/stock-sites/${slug}`))
          .query({ boutique: segou.id })
          .expect(200)
      ).body;
      expect(homeAtSegou.shop.siteId).toBe(segou.id);

      // Boutique publiée puis archivée : plus proposée au visiteur.
      const closing = await site(a, 'TMP', 'Boutique éphémère', 'Mopti');
      await a
        .put(api('/ocall-stock/showcase/draft'))
        .send(content([shop(bamako.id), shop(segou.id), shop(closing.id)]))
        .expect(200);
      await a.post(api('/ocall-stock/showcase/publish')).expect(200);
      expect((await catalog(closing.id)).shop).toMatchObject({ siteId: closing.id });
      await a
        .patch(api(`/ocall-stock/sites/${closing.id}`))
        .send({ isArchived: true })
        .expect(200);
      expect((await catalog(closing.id)).shop).toBeNull();

      // Prix masqués : jamais de prix, même par boutique.
      await a
        .put(api('/ocall-stock/showcase/draft'))
        .send({
          ...content([shop(bamako.id), shop(segou.id)]),
          showPrices: false,
        })
        .expect(200);
      await a.post(api('/ocall-stock/showcase/publish')).expect(200);
      expect(byName(await catalog(segou.id), 'Peinture blanche 5 L').priceTtc).toBeNull();

      const sitemap = (
        await pub()
          .get(api('/public/stock-sites/sitemap'))
          .query({ host: new URL(home.url).hostname })
          .expect(200)
      ).body as { url: string }[];
      expect(sitemap.map((e) => e.url)).toContain(`${home.url}/boutiques`);
    });

    it('demandes : adressées à une boutique présentée, vues par les membres de cette boutique', async () => {
      const ask = (over: Record<string, unknown>) =>
        pub()
          .post(api(`/public/stock-sites/${slug}/requests`))
          .send({
            kind: 'CONTACT',
            name: 'Awa Traoré',
            phone: '+223 76 00 00 01',
            message: 'Avez-vous de la peinture ?',
            website: '',
            startedAt: opened(),
            ...over,
          });
      expect((await ask({ siteId: kayes.id }).expect(400)).body.code).toBe(
        'STOCK_SHOWCASE_REQUEST_SHOP',
      );
      await ask({ siteId: segou.id, name: 'Client Ségou' }).expect(200);
      await ask({ siteId: bamako.id, name: 'Client Bamako' }).expect(200);
      await ask({ name: 'Client entreprise' }).expect(200);

      const owner = (await a.get(api('/ocall-stock/showcase/requests')).expect(200)).body as {
        id: string;
        name: string;
        site: { id: string; name: string } | null;
      }[];
      const segouRequest = owner.find((r) => r.name === 'Client Ségou')!;
      expect(segouRequest.site).toEqual({ id: segou.id, name: 'Boutique Ségou' });
      expect(owner.find((r) => r.name === 'Client entreprise')!.site).toBeNull();

      const seen = (await manager.get(api('/ocall-stock/showcase/requests')).expect(200)).body as {
        name: string;
      }[];
      expect(seen.map((r) => r.name).sort()).toEqual(['Client Bamako', 'Client entreprise']);
      expect(
        (
          await manager
            .patch(api(`/ocall-stock/showcase/requests/${segouRequest.id}`))
            .send({ status: 'DONE' })
            .expect(404)
        ).body.code,
      ).toBe('STOCK_SHOWCASE_REQUEST_NOT_FOUND');
      expect(
        (await db.stockShowcaseRequest.findUniqueOrThrow({ where: { id: segouRequest.id } }))
          .status,
      ).toBe('NEW');
    });

    it('Facture garde le prix commun', async () => {
      const { OcallStockCatalogReader } =
        await import('../src/modules/ocall-stock/ocall-stock-catalog-reader');
      const reader = app.get(OcallStockCatalogReader);
      const found = await reader.variants(org.organizationId, [paint.variantId]);
      expect(
        found.find((i: { variantId: string }) => i.variantId === paint.variantId),
      ).toMatchObject({
        salePrice: 10_000,
      });
    });
  },
);
