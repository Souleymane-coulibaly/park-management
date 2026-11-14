import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE, STOCK_PRODUCT_CODE } from '@ocall/shared';
import {
  STOCK_MOVEMENT_GATEWAY,
  type StockMovementGateway,
} from '../src/common/integration/stock-movements';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import { FactureStockService } from '../src/modules/facture/facture-stock.service';
import type { StockContext } from '../src/modules/ocall-stock/ocall-stock-access';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import { OcallStockService } from '../src/modules/ocall-stock/ocall-stock.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

/**
 * Ocall Stock — S5 (interconnexion Ocall Facture) : cas A (Facture seul), articles Stock dans Facture
 * (miroirs en lecture seule, prix du jour, doublons proposés et rapprochés sur décision), déclencheur
 * unique de déstockage (facture émise ; ni devis ni brouillon), vente en caisse puis facture et
 * intervention signée puis facture sans second déstockage, avoir « marchandise retournée », échecs et
 * relance, Stock échu (« stock non mis à jour »), garanties en base, isolation, concurrence.
 * Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(
  process.env.TEST_STOCK_DATABASE_URL && process.env.TEST_FACTURE_DATABASE_URL,
);
const key = () => randomUUID().replace(/-/g, '');
const TOMORROW = new Date(Date.now() + DAY).toISOString().slice(0, 10);

(enabled ? describe : describe.skip)(
  'Ocall Stock S5 — interconnexion Facture (intégration)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let stockDb: OcallStockPrismaService;
    let factureDb: FacturePrismaService;
    let sync: FactureStockService;
    let orgA: SignedUpOwner;
    let orgB: SignedUpOwner;
    let a: Agent;
    let tech: { id: string; agent: Agent };
    let sales: Agent;
    const plans = new Map<string, string>();
    let location: string;
    let siteId: string;
    let paint: { productId: string; variantId: string; sku: string };
    let glass: { productId: string; variantId: string; sku: string };
    let cutting: { productId: string; variantId: string; sku: string };
    let paintItem: string;
    let cuttingItem: string;
    let clientA: string;
    let clientB: string;
    let firstInvoice: string;

    const settings = {
      legalName: `Quincaillerie ${RUN} SARL`,
      tradeName: 'Quincaillerie du Fleuve',
      address: 'Rue 310, ACI 2000',
      city: 'Bamako',
      phone: '+223 70 00 00 00',
      email: `contact.s5.${RUN}@test.ocallpark.local`,
      nif: '084123456A',
      defaultVatRate: 18,
      paymentTermsDays: 30,
      quoteValidityDays: 15,
    };

    async function startTrial(code: string, organizationId: string, endsAt?: Date) {
      const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code } });
      let planId = plans.get(code);
      if (!planId) {
        planId = (
          await prisma.subscriptionPlan.create({
            data: {
              productId: product.id,
              name: `S5 ${code} ${RUN}`,
              monthlyPrice: 50_000,
              setupFee: 200_000,
              isActive: false,
            },
          })
        ).id;
        plans.set(code, planId);
      }
      const end = endsAt ?? new Date(Date.now() + 14 * DAY);
      await prisma.productTrial.upsert({
        where: { organizationId_productId: { organizationId, productId: product.id } },
        create: {
          organizationId,
          productId: product.id,
          startedAt: new Date(),
          endsAt: end,
          startedByOcall: true,
        },
        update: { endsAt: end },
      });
      await prisma.subscription.upsert({
        where: { organizationId_productId: { organizationId, productId: product.id } },
        create: { organizationId, productId: product.id, planId, status: 'TRIALING' },
        update: { status: 'TRIALING' },
      });
    }

    async function product(name: string, extra: Record<string, unknown> = {}) {
      const p = (
        await a
          .post(api('/ocall-stock/products'))
          .send({ name, salePrice: 11_800, purchasePrice: 7000, vatRate: 18, ...extra })
          .expect(201)
      ).body;
      return {
        productId: p.id as string,
        variantId: p.variants[0].id as string,
        sku: p.variants[0].sku as string,
      };
    }

    async function stockIn(variantId: string, quantity: number) {
      await a
        .post(api('/ocall-stock/movements'))
        .send({ kind: 'IN', variantId, locationId: location, quantity, idempotencyKey: key() })
        .expect(201);
    }

    async function onHand(variantId: string): Promise<number> {
      const level = await stockDb.stockLevel.findUnique({
        where: { locationId_variantId: { locationId: location, variantId } },
      });
      return level ? level.onHand.toNumber() : 0;
    }

    async function factureMember(role: string, lastName: string) {
      const res = await a
        .post(api('/facture/members'))
        .send({ firstName: 'Membre', lastName, role })
        .expect(201);
      const session = await login(app, res.body.member.loginId, res.body.temporaryPassword);
      await session.agent
        .post(api('/auth/change-password'))
        .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
        .expect(204);
      return { id: res.body.member.id as string, agent: session.agent };
    }

    const line = (itemId: string, quantity: number, over: Record<string, unknown> = {}) => ({
      itemId,
      label: 'Article',
      unit: 'unité',
      quantity,
      unitPrice: 10_000,
      vatRate: 18,
      ...over,
    });

    async function draft(type: string, lines: unknown[], agent: Agent = a, clientId = clientA) {
      return (
        await agent.post(api('/facture/documents')).send({ type, clientId, lines }).expect(201)
      ).body;
    }

    const issue = async (id: string, agent: Agent = a) =>
      (await agent.post(api(`/facture/documents/${id}/issue`)).expect(200)).body;

    /** Emplacement des ventes Facture, réglé dans Stock (null : aucun). */
    async function setLocation(factureLocationId: string | null) {
      const current = (await a.get(api('/ocall-stock/settings')).expect(200)).body;
      await a
        .put(api('/ocall-stock/settings'))
        .send({
          storeName: current.storeName,
          defaultVatRate: current.defaultVatRate,
          internalCodePrefix: current.internalCodePrefix,
          allowNegativeStock: false,
          maxDiscountPercent: current.maxDiscountPercent,
          factureLocationId,
        })
        .expect(200);
    }

    const doc = async (id: string) =>
      (await a.get(api(`/facture/documents/${id}`)).expect(200)).body;

    beforeAll(async () => {
      ({ app, prisma } = await createTestApp());
      stockDb = app.get(OcallStockPrismaService);
      factureDb = app.get(FacturePrismaService);
      sync = app.get(FactureStockService);
      orgA = await signup(app, 'stockS5A', 'PARK');
      orgB = await signup(app, 'stockS5B', 'PARK');
      a = orgA.agent;
      await startTrial(FACTURE_PRODUCT_CODE, orgA.organizationId);
      await startTrial(STOCK_PRODUCT_CODE, orgA.organizationId);
      // Cas A : l'organisation B n'a que Facture.
      await startTrial(FACTURE_PRODUCT_CODE, orgB.organizationId);
      await a.put(api('/facture/settings')).send(settings).expect(200);
      await orgB.agent.put(api('/facture/settings')).send(settings).expect(200);
      clientA = (
        await a
          .post(api('/facture/clients'))
          .send({ kind: 'COMPANY', name: 'BTP Sahel' })
          .expect(201)
      ).body.id;
      clientB = (
        await orgB.agent
          .post(api('/facture/clients'))
          .send({ kind: 'COMPANY', name: 'Client B' })
          .expect(201)
      ).body.id;
      const site = (
        await a
          .post(api('/ocall-stock/sites'))
          .send({ code: 'MAG1', name: 'Magasin Bamako', kind: 'STORE' })
          .expect(201)
      ).body;
      location = site.locations[0].id;
      siteId = site.id;
      paint = await product('Peinture blanche 5 L');
      glass = await product('Vitre claire 4 mm', { salePrice: 5900 });
      cutting = await product('Découpe sur mesure', { salePrice: 2360, isStockable: false });
      await stockIn(paint.variantId, 10);
      await stockIn(glass.variantId, 5);
      // Deux connexions de membres : sous la limite du compartiment « auth » (inscriptions comprises).
      tech = await factureMember('TECHNICIAN', 'Technicien');
      sales = (await factureMember('SALES', 'Commercial')).agent;
    }, 300_000);

    afterAll(async () => {
      try {
        const orgs = [orgA?.organizationId, orgB?.organizationId].filter(Boolean) as string[];
        if (factureDb && orgs.length) await purgeFactureOrganizations(factureDb, orgs);
        if (stockDb && orgs.length) {
          const { purgeStockOrganizations } = await import('@ocall/stock-database');
          await purgeStockOrganizations(stockDb, orgs);
        }
        if (prisma) {
          await cleanup(prisma);
          if (plans.size) {
            await prisma.subscriptionPlan.deleteMany({
              where: { id: { in: [...plans.values()] } },
            });
          }
        }
      } finally {
        await app?.close();
      }
    });

    it('cas A : Facture seul fonctionne, sans aucune fonction Stock', async () => {
      const status = (await orgB.agent.get(api('/facture/stock/status')).expect(200)).body;
      expect(status).toEqual({ available: false, writable: false });
      const search = await orgB.agent
        .get(api('/facture/stock/search'))
        .query({ q: 'peinture' })
        .expect(409);
      expect(search.body.code).toBe('FACTURE_STOCK_UNAVAILABLE');
      const item = (
        await orgB.agent
          .post(api('/facture/items'))
          .send({ kind: 'PRODUCT', name: 'Peinture', unitPrice: 10_000, vatRate: 18 })
          .expect(201)
      ).body;
      const d = await draft('INVOICE', [line(item.id, 2)], orgB.agent, clientB);
      const issued = await issue(d.id, orgB.agent);
      expect(issued.status).toBe('ISSUED');
      expect(issued.stockSync).toBeNull();
      // Les articles et les ventes de l'organisation A ne sont jamais visibles de B.
      const use = await orgB.agent
        .post(api('/facture/stock/items'))
        .send({ variantId: paint.variantId })
        .expect(409);
      expect(use.body.code).toBe('FACTURE_STOCK_UNAVAILABLE');
    });

    it('articles Stock dans Facture : recherche, miroir en lecture seule, prix du jour, doublon proposé', async () => {
      const status = (await a.get(api('/facture/stock/status')).expect(200)).body;
      expect(status).toEqual({ available: true, writable: true });
      // Emplacement des ventes Facture pas encore réglé : disponibilité inconnue.
      let found = (await a.get(api('/facture/stock/search')).query({ q: 'peinture' }).expect(200))
        .body;
      expect(found[0]).toMatchObject({
        variantId: paint.variantId,
        salePrice: 11_800,
        unitPriceHt: 10_000,
        vatRate: 18,
        available: null,
        mirror: null,
        duplicate: null,
      });
      await setLocation(location);
      found = (await a.get(api('/facture/stock/search')).query({ q: 'peinture' }).expect(200)).body;
      expect(found[0].available).toBe(10);
      // Un compte Facture sans droit Stock ne voit pas les quantités (droits vérifiés côté Stock).
      const blind = (
        await sales.get(api('/facture/stock/search')).query({ q: 'peinture' }).expect(200)
      ).body;
      expect(blind[0].available).toBeNull();

      const mirror = (
        await a.post(api('/facture/stock/items')).send({ variantId: paint.variantId }).expect(201)
      ).body;
      expect(mirror).toMatchObject({
        kind: 'PRODUCT',
        reference: paint.sku,
        unitPrice: 10_000,
        vatRate: 18,
        stockVariantId: paint.variantId,
        stockProductId: paint.productId,
      });
      paintItem = mirror.id;
      const again = (
        await a.post(api('/facture/stock/items')).send({ variantId: paint.variantId }).expect(201)
      ).body;
      expect(again.id).toBe(paintItem);
      // Miroir en lecture seule (archivage seul), Stock est la référence.
      const locked = await a
        .patch(api(`/facture/items/${paintItem}`))
        .send({ unitPrice: 1 })
        .expect(409);
      expect(locked.body.code).toBe('FACTURE_ITEM_STOCK_LINKED');
      await a
        .patch(api(`/facture/items/${paintItem}`))
        .send({ isArchived: true })
        .expect(200);

      // Doublon : un article Facture porte déjà la référence de la vitre → proposé, jamais lié d'office.
      const legacy = (
        await a
          .post(api('/facture/items'))
          .send({
            kind: 'PRODUCT',
            reference: glass.sku,
            name: 'Vitre (ancien)',
            unitPrice: 4000,
            vatRate: 18,
          })
          .expect(201)
      ).body;
      found = (await a.get(api('/facture/stock/search')).query({ q: 'vitre' }).expect(200)).body;
      expect(found[0].duplicate).toEqual({ id: legacy.id, name: 'Vitre (ancien)' });
      const dup = await a
        .post(api('/facture/stock/items'))
        .send({ variantId: glass.variantId })
        .expect(409);
      expect(dup.body.code).toBe('FACTURE_STOCK_DUPLICATE');
      expect(dup.body.details).toMatchObject({ itemId: legacy.id });
      const linked = (
        await a
          .post(api('/facture/stock/items'))
          .send({ variantId: glass.variantId, linkItemId: legacy.id })
          .expect(201)
      ).body;
      expect(linked).toMatchObject({
        id: legacy.id,
        name: 'Vitre claire 4 mm',
        unitPrice: 5000,
        stockVariantId: glass.variantId,
      });
      // Réversible tant qu'aucun mouvement n'en dépend.
      const unlinked = (await a.post(api(`/facture/stock/items/${legacy.id}/unlink`)).expect(200))
        .body;
      expect(unlinked.stockVariantId).toBeNull();
      await a
        .post(api('/facture/stock/items'))
        .send({ variantId: glass.variantId, linkItemId: legacy.id })
        .expect(201);

      // Prix du jour relu dans Stock à chaque ajout ; le miroir est désarchivé.
      await a
        .patch(api(`/ocall-stock/products/${paint.productId}`))
        .send({ salePrice: 12_980 })
        .expect(200);
      const repriced = (
        await a.post(api('/facture/stock/items')).send({ variantId: paint.variantId }).expect(201)
      ).body;
      expect(repriced).toMatchObject({ id: paintItem, unitPrice: 11_000, isArchived: false });
      cuttingItem = (
        await a.post(api('/facture/stock/items')).send({ variantId: cutting.variantId }).expect(201)
      ).body.id;
    });

    it('un seul déclencheur : ni devis ni brouillon, la facture émise déstocke une fois', async () => {
      const quote = await draft('QUOTE', [line(paintItem, 2)]);
      expect((await issue(quote.id)).stockSync).toBeNull();
      const inv = await draft('INVOICE', [line(paintItem, 3), line(cuttingItem, 1)]);
      // Brouillon : avertissement, rien ne bouge.
      const preview = (await a.get(api(`/facture/stock/documents/${inv.id}/preview`)).expect(200))
        .body;
      expect(preview).toMatchObject({ available: true, writable: true, availabilityKnown: true });
      // La découpe (service, non stockée) ne sort jamais du stock.
      expect(preview.lines).toEqual([
        expect.objectContaining({
          variantId: paint.variantId,
          quantity: 3,
          available: 10,
          short: false,
        }),
      ]);
      expect(await onHand(paint.variantId)).toBe(10);

      const issued = await issue(inv.id);
      firstInvoice = inv.id;
      expect(issued.stockSync).toMatchObject({ source: 'INVOICE', status: 'PENDING' });
      expect(await sync.processDue()).toMatchObject({ done: 1 });
      expect(await onHand(paint.variantId)).toBe(7);
      expect((await doc(inv.id)).stockSync).toMatchObject({ status: 'DONE', lastError: null });
      // Rejeu (bail perdu, double transmission) : sans effet.
      const gateway = app.get<StockMovementGateway>(STOCK_MOVEMENT_GATEWAY);
      const replayActor = (
        await factureDb.factureStockOutbox.findFirstOrThrow({
          where: { organizationId: orgA.organizationId, documentId: inv.id },
        })
      ).actorUserId;
      const replay = await gateway.apply({
        organizationId: orgA.organizationId,
        key: `facture-invoice:${inv.id}`,
        source: 'INVOICE',
        sourceId: inv.id,
        reference: issued.number,
        actorUserId: replayActor,
        lines: [{ variantId: paint.variantId, quantity: -3 }],
      });
      expect(replay).toEqual({ replayed: true });
      // Un service (non stocké) transmis tel quel : accepté, aucun mouvement.
      const service = await gateway.apply({
        organizationId: orgA.organizationId,
        key: `test-service:${key()}`,
        source: 'INVOICE',
        sourceId: inv.id,
        reference: 'TEST',
        actorUserId: replayActor,
        lines: [{ variantId: cutting.variantId, quantity: -1 }],
      });
      expect(service).toEqual({ replayed: false });
      expect(
        await stockDb.stockMovement.count({
          where: { organizationId: orgA.organizationId, variantId: cutting.variantId },
        }),
      ).toBe(0);
      expect(await sync.processDue()).toMatchObject({ done: 0 });
      expect(await onHand(paint.variantId)).toBe(7);
      const movements = await stockDb.stockMovement.findMany({
        where: { organizationId: orgA.organizationId, sourceId: inv.id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ kind: 'FACTURE_INVOICE', reason: issued.number });
      const events = (await a.get(api('/ocall-stock/facture-events')).expect(200)).body;
      const event = events.find((e: { reference: string }) => e.reference === issued.number);
      expect(event).toMatchObject({ source: 'INVOICE' });
      expect(event.lines).toEqual([
        expect.objectContaining({ variantId: paint.variantId, quantity: -3 }),
      ]);
      // Membre rattaché à un autre site : ces mouvements ne le concernent pas (S9).
      const otherSite = (
        await a
          .post(api('/ocall-stock/sites'))
          .send({ code: 'DEP9', name: 'Dépôt Kati', kind: 'WAREHOUSE' })
          .expect(201)
      ).body.id as string;
      const restricted = { organizationId: orgA.organizationId, siteIds: [otherSite] };
      const stockService = app.get(OcallStockService);
      expect(await stockService.factureEvents(restricted as unknown as StockContext)).toEqual([]);
      const own = { organizationId: orgA.organizationId, siteIds: [siteId] };
      expect(
        (await stockService.factureEvents(own as unknown as StockContext)).map((e) => e.reference),
      ).toContain(issued.number);
    });

    it('emplacement non réglé, puis stock insuffisant : échec visible, relance par le gérant', async () => {
      // Sans emplacement des ventes Facture : demande en échec, rien ne bouge ; relancée une fois réglé.
      await setLocation(null);
      const noPlace = await draft('INVOICE', [line(paintItem, 1)]);
      await issue(noPlace.id);
      expect(await sync.processDue()).toMatchObject({ failed: 1 });
      const unplaced = (await doc(noPlace.id)).stockSync;
      expect(unplaced).toMatchObject({ status: 'FAILED', lastError: 'STOCK_LOCATION_NOT_SET' });
      await setLocation(location);
      await a.post(api(`/facture/stock/sync/${unplaced.id}/retry`)).expect(200);
      expect(await sync.processDue()).toMatchObject({ done: 1 });
      expect(await onHand(paint.variantId)).toBe(6);
      await stockIn(paint.variantId, 1);

      const inv = await draft('INVOICE', [line(paintItem, 20)]);
      const preview = (await a.get(api(`/facture/stock/documents/${inv.id}/preview`)).expect(200))
        .body;
      expect(preview.shortages).toBe(1);
      await issue(inv.id);
      expect(await sync.processDue()).toMatchObject({ failed: 1 });
      expect(await onHand(paint.variantId)).toBe(7);
      const failed = (await doc(inv.id)).stockSync;
      expect(failed).toMatchObject({ status: 'FAILED', lastError: 'STOCK_INSUFFICIENT' });
      const list = (await a.get(api('/facture/stock/sync')).query({ status: 'FAILED' }).expect(200))
        .body;
      expect(list.map((r: { id: string }) => r.id)).toContain(failed.id);
      // Relance réservée au gérant ; une organisation tierce ne la voit pas.
      await sales.post(api(`/facture/stock/sync/${failed.id}/retry`)).expect(403);
      await orgB.agent.post(api(`/facture/stock/sync/${failed.id}/retry`)).expect(404);
      await stockIn(paint.variantId, 20);
      await a.post(api(`/facture/stock/sync/${failed.id}/retry`)).expect(200);
      expect(await sync.processDue()).toMatchObject({ done: 1 });
      expect(await onHand(paint.variantId)).toBe(7);
      const again = await a.post(api(`/facture/stock/sync/${failed.id}/retry`)).expect(409);
      expect(again.body.code).toBe('FACTURE_STOCK_SYNC_NOT_FAILED');
    });

    it('vente en caisse puis facture : la facture ne ressort que ce que la vente n’a pas sorti', async () => {
      const register = (
        await a
          .post(api('/ocall-stock/registers'))
          .send({ code: 'CAISSE1', name: 'Caisse 1', locationId: location })
          .expect(201)
      ).body.id;
      await a
        .post(api(`/ocall-stock/registers/${register}/sessions`))
        .send({ openingFloat: 0 })
        .expect(201);
      const sell = async () =>
        (
          await a
            .post(api('/ocall-stock/sales'))
            .send({
              idempotencyKey: key(),
              registerId: register,
              lines: [{ variantId: paint.variantId, quantity: 2 }],
              payments: [{ method: 'CASH', amount: 25_960 }],
            })
            .expect(201)
        ).body;
      const sale = await sell();
      expect(await onHand(paint.variantId)).toBe(5);

      // Un compte Facture sans droit Stock ne lit pas les ventes (droits vérifiés côté Stock).
      const hidden = await sales
        .post(api('/facture/stock/sales/invoice'))
        .send({ sale: 'VTE-000001', clientId: clientA })
        .expect(404);
      expect(hidden.body.code).toBe('FACTURE_STOCK_SALE_NOT_FOUND');
      await orgB.agent
        .post(api('/facture/stock/sales/invoice'))
        .send({ sale: sale.id, clientId: clientB })
        .expect(409);

      const [one, two] = await Promise.all([
        a.post(api('/facture/stock/sales/invoice')).send({ sale: 'VTE-000001', clientId: clientA }),
        a.post(api('/facture/stock/sales/invoice')).send({ sale: 'vte-1', clientId: clientA }),
      ]);
      expect(one.status).toBe(201);
      expect(two.status).toBe(201);
      expect(two.body.id).toBe(one.body.id);
      const invoice = one.body;
      expect(invoice).toMatchObject({
        type: 'INVOICE',
        status: 'DRAFT',
        stockSaleNumber: 'VTE-000001',
      });
      expect(invoice.lines).toEqual([
        expect.objectContaining({ itemId: paintItem, quantity: 2, unitPrice: 11_000, vatRate: 18 }),
      ]);
      // Le client ajoute un pot à la facture : seul ce pot sort à l'émission.
      await a
        .put(api(`/facture/documents/${invoice.id}`))
        .send({
          clientId: clientA,
          lines: [line(paintItem, 3, { unitPrice: 11_000 })],
        })
        .expect(200);
      const issued = await issue(invoice.id);
      expect(issued.stockSync).toMatchObject({ status: 'PENDING' });
      expect(issued.stockSync.lines).toEqual([{ variantId: paint.variantId, quantity: -1 }]);
      await sync.processDue();
      expect(await onHand(paint.variantId)).toBe(4);

      // Facture d'une vente telle quelle : rien à ressortir, demande close d'emblée (traçabilité).
      const second = await sell();
      expect(await onHand(paint.variantId)).toBe(2);
      const inv2 = (
        await a
          .post(api('/facture/stock/sales/invoice'))
          .send({ sale: second.id, clientId: clientA })
          .expect(201)
      ).body;
      const issued2 = await issue(inv2.id);
      expect(issued2.stockSync).toMatchObject({ status: 'DONE', lines: [] });
      expect(await sync.processDue()).toMatchObject({ done: 0 });
      expect(await onHand(paint.variantId)).toBe(2);
    });

    it('intervention signée : pièces sorties à la signature, sa facture ne les ressort pas', async () => {
      const signature = await sharp({
        create: { width: 400, height: 150, channels: 3, background: '#ffffff' },
      })
        .composite([
          {
            input: { create: { width: 220, height: 5, channels: 3, background: '#111111' } },
            top: 70,
            left: 90,
          },
        ])
        .png()
        .toBuffer();
      const id = (
        await a
          .post(api('/facture/interventions'))
          .send({
            clientId: clientA,
            title: 'Pose de vitre',
            scheduledStart: `${TOMORROW}T08:00:00Z`,
            scheduledEnd: `${TOMORROW}T10:00:00Z`,
            technicianIds: [tech.id],
          })
          .expect(201)
      ).body.id as string;
      const glassItem = (
        await factureDb.factureItem.findFirstOrThrow({
          where: { organizationId: orgA.organizationId, stockVariantId: glass.variantId },
        })
      ).id;
      await tech.agent.post(api(`/facture/interventions/${id}/start`)).expect(200);
      await tech.agent
        .post(api(`/facture/interventions/${id}/parts`))
        .send({ itemId: glassItem, quantity: 2 })
        .expect(201);
      await tech.agent
        .post(api(`/facture/interventions/${id}/complete`))
        .send({ workSummary: 'Deux vitres posées.' })
        .expect(200);
      expect(await onHand(glass.variantId)).toBe(5);
      await tech.agent
        .post(api(`/facture/interventions/${id}/sign`))
        .field('signerName', 'Awa Traoré')
        .attach('file', signature, { filename: 'signature.png', contentType: 'image/png' })
        .expect(200);
      expect(await sync.processDue()).toMatchObject({ done: 1 });
      expect(await onHand(glass.variantId)).toBe(3);
      const part = await stockDb.stockMovement.findFirstOrThrow({
        where: { organizationId: orgA.organizationId, sourceId: id },
      });
      expect(part.kind).toBe('FACTURE_PART');

      const { invoiceId } = (
        await a
          .post(api(`/facture/interventions/${id}/invoice`))
          .send({})
          .expect(201)
      ).body;
      const issued = await issue(invoiceId);
      expect(issued.stockSync).toMatchObject({ status: 'DONE', lines: [] });
      expect(await onHand(glass.variantId)).toBe(3);
      // Le lien ne se défait plus : des mouvements en dépendent.
      const inUse = await a.post(api(`/facture/stock/items/${glassItem}/unlink`)).expect(409);
      expect(inUse.body.code).toBe('FACTURE_STOCK_LINK_IN_USE');
    });

    it('avoir « marchandise retournée » : retour plafonné à ce qui est sorti ; sans la case, rien', async () => {
      const plain = (await a.post(api(`/facture/documents/${firstInvoice}/credit-note`))).body;
      await a
        .put(api(`/facture/documents/${plain.id}`))
        .send({ clientId: clientA, lines: [line(paintItem, 1)] })
        .expect(200);
      expect((await issue(plain.id)).stockSync).toBeNull();
      expect(await onHand(paint.variantId)).toBe(2);

      const note = (await a.post(api(`/facture/documents/${firstInvoice}/credit-note`))).body;
      const saved = (
        await a
          .put(api(`/facture/documents/${note.id}`))
          .send({ clientId: clientA, stockReturnGoods: true, lines: [line(paintItem, 2)] })
          .expect(200)
      ).body;
      expect(saved.stockReturnGoods).toBe(true);
      const issued = await issue(note.id);
      expect(issued.stockSync).toMatchObject({ source: 'CREDIT_NOTE', status: 'PENDING' });
      expect(issued.stockSync.lines).toEqual([{ variantId: paint.variantId, quantity: 2 }]);
      await sync.processDue();
      expect(await onHand(paint.variantId)).toBe(4);
      const back = await stockDb.stockMovement.findFirstOrThrow({
        where: { organizationId: orgA.organizationId, sourceId: note.id },
      });
      expect(back).toMatchObject({ kind: 'FACTURE_CREDIT' });

      // La facture avait sorti 3 pots : un dernier avoir de 2 n'en remet qu'un.
      const last = (await a.post(api(`/facture/documents/${firstInvoice}/credit-note`))).body;
      await a
        .put(api(`/facture/documents/${last.id}`))
        .send({
          clientId: clientA,
          stockReturnGoods: true,
          lines: [line(paintItem, 2, { unitPrice: 1 })],
        })
        .expect(200);
      const lastIssued = await issue(last.id);
      expect(lastIssued.stockSync.lines).toEqual([{ variantId: paint.variantId, quantity: 1 }]);
      await sync.processDue();
      expect(await onHand(paint.variantId)).toBe(5);

      // La case n'existe que sur un avoir.
      const inv = await draft('INVOICE', [line(paintItem, 1)]);
      const ignored = (
        await a
          .put(api(`/facture/documents/${inv.id}`))
          .send({ clientId: clientA, stockReturnGoods: true, lines: [line(paintItem, 1)] })
          .expect(200)
      ).body;
      expect(ignored.stockReturnGoods).toBe(false);
      await a.delete(api(`/facture/documents/${inv.id}`)).expect(204);
    });

    it('Stock échu : Facture continue, « stock non mis à jour », aucune demande transmise', async () => {
      await startTrial(STOCK_PRODUCT_CODE, orgA.organizationId, new Date(Date.now() - DAY));
      expect((await a.get(api('/facture/stock/status')).expect(200)).body).toEqual({
        available: true,
        writable: false,
      });
      const inv = await draft('INVOICE', [line(paintItem, 1)]);
      const issued = await issue(inv.id);
      expect(issued.stockSync).toMatchObject({ status: 'SKIPPED', lastError: 'STOCK_UNAVAILABLE' });
      expect(await sync.processDue()).toMatchObject({ done: 0, failed: 0 });
      expect(await onHand(paint.variantId)).toBe(5);
      const retry = await a
        .post(api(`/facture/stock/sync/${issued.stockSync.id}/retry`))
        .expect(409);
      expect(retry.body.code).toBe('FACTURE_STOCK_SYNC_NOT_FAILED');
      await startTrial(STOCK_PRODUCT_CODE, orgA.organizationId);
    });

    it('garanties en base : file de sortie, documents émis, journal Stock, lien cohérent', async () => {
      const row = await factureDb.factureStockOutbox.findFirstOrThrow({
        where: { organizationId: orgA.organizationId, status: 'DONE' },
      });
      await expect(factureDb.factureStockOutbox.delete({ where: { id: row.id } })).rejects.toThrow(
        'FACTURE_STOCK_OUTBOX_FROZEN',
      );
      await expect(
        factureDb.factureStockOutbox.update({ where: { id: row.id }, data: { lines: [] } }),
      ).rejects.toThrow('FACTURE_STOCK_OUTBOX_FROZEN');
      await expect(
        factureDb.factureStockOutbox.update({ where: { id: row.id }, data: { status: 'PENDING' } }),
      ).rejects.toThrow('FACTURE_STOCK_OUTBOX_FROZEN');
      const sold = await factureDb.factureDocument.findFirstOrThrow({
        where: {
          organizationId: orgA.organizationId,
          stockSaleId: { not: null },
          status: 'ISSUED',
        },
      });
      await expect(
        factureDb.factureDocument.update({
          where: { id: sold.id },
          data: { stockCovered: [] },
        }),
      ).rejects.toThrow('FACTURE_DOCUMENT_FROZEN');
      const note = await factureDb.factureDocument.findFirstOrThrow({
        where: { organizationId: orgA.organizationId, stockReturnGoods: true },
      });
      await expect(
        factureDb.factureDocument.update({
          where: { id: note.id },
          data: { stockReturnGoods: false },
        }),
      ).rejects.toThrow('FACTURE_DOCUMENT_FROZEN');
      await expect(
        factureDb.factureItem.update({
          where: { id: paintItem },
          data: { stockProductId: null },
        }),
      ).rejects.toThrow('FactureItem_stock_link_check');
      const event = await stockDb.stockInboundEvent.findFirstOrThrow({
        where: { organizationId: orgA.organizationId },
      });
      await expect(
        stockDb.stockInboundEvent.update({ where: { id: event.id }, data: { reference: 'X' } }),
      ).rejects.toThrow('STOCK_HISTORY_APPEND_ONLY');
      await expect(stockDb.stockInboundEvent.delete({ where: { id: event.id } })).rejects.toThrow(
        'STOCK_HISTORY_APPEND_ONLY',
      );
    });

    it('concurrence : deux répartiteurs simultanés transmettent chaque demande une seule fois', async () => {
      const before = await onHand(paint.variantId);
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const d = await draft('INVOICE', [line(paintItem, 1)]);
        await issue(d.id);
        ids.push(d.id);
      }
      const [r1, r2] = await Promise.all([sync.processDue(), sync.processDue()]);
      expect(r1.done + r2.done).toBe(3);
      expect(await onHand(paint.variantId)).toBe(before - 3);
      const movements = await stockDb.stockMovement.count({
        where: { organizationId: orgA.organizationId, sourceId: { in: ids } },
      });
      expect(movements).toBe(3);
    });
  },
);
