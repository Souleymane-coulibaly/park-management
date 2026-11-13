import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { Prisma } from '@ocall/stock-database';
import { OcallStockLedgerService } from '../src/modules/ocall-stock/ocall-stock-ledger.service';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
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
 * Ocall Stock — S2 (sites et entreposage) : sites et emplacements (arborescence, QR codes), moteur de
 * stock (idempotence, stock négatif refusé ou autorisé, deux sorties simultanées du dernier article),
 * déplacements, transferts (réservation, transit, réception partielle et rejouée, manque, annulation),
 * inventaires (écart calculé à la validation, complet = non compté à 0, rapports), périmètre des sites,
 * registre en ajout seul, isolation entre organisations. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');

(enabled ? describe : describe.skip)('Ocall Stock S2 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let a: Agent;
  let paint: { productId: string; variantId: string };
  let glue: { productId: string; variantId: string };
  let service: { productId: string; variantId: string };
  let ent: { id: string; general: string };
  let mag: { id: string; general: string };
  let bin: string;

  async function startTrial(organizationId: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
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
      data: { organizationId, productId: product.id, planId, status: 'TRIALING' },
    });
  }

  async function product(name: string, extra: Record<string, unknown> = {}) {
    const p = (
      await a
        .post(api('/ocall-stock/products'))
        .send({ name, salePrice: 1000, ...extra })
        .expect(201)
    ).body;
    return { productId: p.id as string, variantId: p.variants[0].id as string };
  }

  const move = (body: Record<string, unknown>, agent: Agent = a) =>
    agent.post(api('/ocall-stock/movements')).send({ idempotencyKey: key(), ...body });

  async function onHand(locationId: string, variantId: string): Promise<number> {
    const level = await db.stockLevel.findUnique({
      where: { locationId_variantId: { locationId, variantId } },
    });
    return level ? level.onHand.toNumber() : 0;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    const p = await prisma.saasProduct.findUniqueOrThrow({ where: { code: STOCK_PRODUCT_CODE } });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: p.id,
          name: `Stock S2 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'stockS2A', 'PARK');
    orgB = await signup(app, 'stockS2B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    a = orgA.agent;
    paint = await product('Peinture blanche 5 L', { minStock: 10 });
    glue = await product('Colle à bois');
    service = await product('Pose de carrelage', { isStockable: false });
  }, 300_000);

  afterAll(async () => {
    try {
      if (db && orgA && orgB) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(db, [orgA.organizationId, orgB.organizationId]);
      }
      if (prisma) {
        await cleanup(prisma);
        if (planId) await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
      }
    } finally {
      await app?.close();
    }
  });

  it('sites et emplacements : « Général » d’office, arborescence ordonnée, QR codes, étiquettes', async () => {
    const e = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'ent1', name: 'Entrepôt Bamako', kind: 'WAREHOUSE' })
        .expect(201)
    ).body;
    const m = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'MAG1', name: 'Magasin ACI 2000', kind: 'STORE' })
        .expect(201)
    ).body;
    expect(e.code).toBe('ENT1');
    expect(e.locations).toEqual([
      expect.objectContaining({ kind: 'DEFAULT', code: 'GENERAL', qr: 'L:ENT1/GENERAL' }),
    ]);
    ent = { id: e.id, general: e.locations[0].id };
    mag = { id: m.id, general: m.locations[0].id };
    const dup = await a
      .post(api('/ocall-stock/sites'))
      .send({ code: 'ENT1', name: 'Doublon', kind: 'DEPOT' })
      .expect(409);
    expect(dup.body.code).toBe('STOCK_SITE_CODE_TAKEN');

    const zone = (
      await a
        .post(api(`/ocall-stock/sites/${ent.id}/locations`))
        .send({ kind: 'ZONE', code: 'A', name: 'Zone A' })
        .expect(201)
    ).body;
    const aisle = (
      await a
        .post(api(`/ocall-stock/sites/${ent.id}/locations`))
        .send({ kind: 'AISLE', code: 'A-01', name: 'Allée 01', parentId: zone.id })
        .expect(201)
    ).body;
    const b = (
      await a
        .post(api(`/ocall-stock/sites/${ent.id}/locations`))
        .send({ kind: 'BIN', code: 'a-01-03', name: 'Emplacement A-01-03', parentId: aisle.id })
        .expect(201)
    ).body;
    bin = b.id;
    expect(b.qr).toBe('L:ENT1/A-01-03');
    const wrong = await a
      .post(api(`/ocall-stock/sites/${ent.id}/locations`))
      .send({ kind: 'ZONE', code: 'Z', name: 'Z', parentId: bin })
      .expect(400);
    expect(wrong.body.code).toBe('STOCK_LOCATION_TREE');
    // Parent dans un autre site : refusé.
    await a
      .post(api(`/ocall-stock/sites/${mag.id}/locations`))
      .send({ kind: 'AISLE', code: 'X', name: 'X', parentId: zone.id })
      .expect(400);
    // La base refuse elle-même un ordre inversé écrit sans passer par l'API.
    await expect(
      db.stockLocation.create({
        data: {
          organizationId: orgA.organizationId,
          siteId: ent.id,
          parentId: bin,
          kind: 'AISLE',
          code: 'BAD',
          name: 'Bad',
        },
      }),
    ).rejects.toThrow(/STOCK_LOCATION_TREE/);

    const found = (
      await a
        .get(api('/ocall-stock/locations/lookup'))
        .query({ code: 'l:ent1/a-01-03' })
        .expect(200)
    ).body;
    expect(found).toMatchObject({ found: true, location: { id: bin, site: { code: 'ENT1' } } });
    expect(
      (
        await orgB.agent
          .get(api('/ocall-stock/locations/lookup'))
          .query({ code: 'L:ENT1/A-01-03' })
          .expect(200)
      ).body.found,
    ).toBe(false);

    const pdf = await a
      .post(api(`/ocall-stock/sites/${ent.id}/location-labels.pdf`))
      .send({ format: '50x30', locationIds: [bin, ent.general] })
      .buffer(true)
      .expect(200);
    expect((pdf.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  });

  it('mouvements : entrée rejouée une seule fois, motif exigé, stock insuffisant refusé, service refusé', async () => {
    const k = key();
    const first = (
      await move({
        kind: 'IN',
        variantId: paint.variantId,
        locationId: bin,
        quantity: 10,
        unitCost: 9000,
        idempotencyKey: k,
      }).expect(201)
    ).body;
    expect(first).toMatchObject({ replayed: false, quantityAfter: 10 });
    const again = (
      await move({
        kind: 'IN',
        variantId: paint.variantId,
        locationId: bin,
        quantity: 10,
        idempotencyKey: k,
      }).expect(201)
    ).body;
    expect(again).toMatchObject({ replayed: true, movementId: first.movementId });
    expect(await onHand(bin, paint.variantId)).toBe(10);

    const noReason = await move({
      kind: 'OUT',
      variantId: paint.variantId,
      locationId: bin,
      quantity: 1,
    }).expect(400);
    expect(noReason.body.code).toBe('STOCK_REASON_REQUIRED');
    await move({
      kind: 'OUT',
      variantId: paint.variantId,
      locationId: bin,
      quantity: 3,
      reason: 'Casse',
    }).expect(201);
    const tooMuch = await move({
      kind: 'OUT',
      variantId: paint.variantId,
      locationId: bin,
      quantity: 20,
      reason: 'Erreur',
    }).expect(409);
    expect(tooMuch.body.code).toBe('STOCK_INSUFFICIENT');
    await move({
      kind: 'ADJUSTMENT',
      variantId: paint.variantId,
      locationId: bin,
      quantity: -1,
      reason: 'Pot abîmé',
    }).expect(201);
    expect(await onHand(bin, paint.variantId)).toBe(6);
    const svc = await move({
      kind: 'IN',
      variantId: service.variantId,
      locationId: bin,
      quantity: 1,
    }).expect(409);
    expect(svc.body.code).toBe('STOCK_NOT_STOCKABLE');

    // Déplacement interne : deux mouvements, même site seulement.
    await a
      .post(api('/ocall-stock/moves'))
      .send({
        variantId: paint.variantId,
        fromLocationId: bin,
        toLocationId: ent.general,
        quantity: 2,
        idempotencyKey: key(),
      })
      .expect(201);
    expect([
      await onHand(bin, paint.variantId),
      await onHand(ent.general, paint.variantId),
    ]).toEqual([4, 2]);
    const other = await a
      .post(api('/ocall-stock/moves'))
      .send({
        variantId: paint.variantId,
        fromLocationId: bin,
        toLocationId: mag.general,
        quantity: 1,
        idempotencyKey: key(),
      })
      .expect(400);
    expect(other.body.code).toBe('STOCK_MOVE_OTHER_SITE');

    // Niveaux par site : 6 en stock, sous le seuil de 10.
    const levels = (
      await a.get(api('/ocall-stock/levels')).query({ siteId: ent.id, belowMin: true }).expect(200)
    ).body;
    expect(levels.items).toEqual([
      expect.objectContaining({ onHand: 6, available: 6, minStock: 10, belowMin: true }),
    ]);

    // Registre en ajout seul : la base refuse modification et suppression.
    await expect(
      db.$executeRaw`UPDATE "StockMovement" SET quantity = 99 WHERE "organizationId" = ${orgA.organizationId}::uuid`,
    ).rejects.toThrow(/STOCK_HISTORY_APPEND_ONLY/);
    // Un article qui a du stock ne devient pas « non stocké ».
    const unstock = await a
      .patch(api(`/ocall-stock/products/${paint.productId}`))
      .send({ isStockable: false })
      .expect(409);
    expect(unstock.body.code).toBe('STOCK_PRODUCT_HAS_STOCK');
  });

  it('dernier article : une vente qui arrive pendant une autre attend le verrou, puis est refusée', async () => {
    // Déterministe : une première opération verrouille la ligne de stock (transaction ouverte, pas encore
    // écrite) pendant qu'une seconde sortie arrive par l'API ; la seconde doit attendre le verrou, puis voir
    // le stock à 0 une fois la première sortie enregistrée.
    const ledger = app.get(OcallStockLedgerService);
    await move({
      kind: 'IN',
      variantId: glue.variantId,
      locationId: ent.general,
      quantity: 1,
    }).expect(201);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const first = db.$transaction(
      async (tx) => {
        const k = `hold-${key()}`;
        // Comme une opération à plusieurs lignes : la ligne de stock est verrouillée d'abord, écrite ensuite.
        await tx.$queryRaw`
          SELECT 1 FROM "StockLevel"
          WHERE "locationId" = ${ent.general}::uuid AND "variantId" = ${glue.variantId}::uuid FOR UPDATE`;
        locked();
        await gate;
        await ledger.apply(
          tx,
          { organizationId: orgA.organizationId, userId: orgA.organizationId },
          k,
          [
            {
              variantId: glue.variantId,
              locationId: ent.general,
              kind: 'OUT',
              quantity: new Prisma.Decimal(-1),
              idempotencyKey: k,
              sourceType: 'MANUAL',
              reason: 'Vente en cours',
            },
          ],
        );
      },
      { timeout: 20_000 },
    );
    await holding;
    const second = move({
      kind: 'OUT',
      variantId: glue.variantId,
      locationId: ent.general,
      quantity: 1,
      reason: 'Vente',
    }).then((r) => r);
    await new Promise((r) => setTimeout(r, 700));
    release();
    await first;
    const res = await second;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STOCK_INSUFFICIENT');
    expect(await onHand(ent.general, glue.variantId)).toBe(0);
  });

  it('dernier article : deux sorties simultanées, une seule passe ; même clé envoyée deux fois en même temps', async () => {
    await move({
      kind: 'IN',
      variantId: glue.variantId,
      locationId: mag.general,
      quantity: 1,
    }).expect(201);
    const results = await Promise.all(
      [1, 2].map(() =>
        move({
          kind: 'OUT',
          variantId: glue.variantId,
          locationId: mag.general,
          quantity: 1,
          reason: 'Vente comptoir',
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await onHand(mag.general, glue.variantId)).toBe(0);

    const same = key();
    const twin = await Promise.all(
      [1, 2].map(() =>
        move({
          kind: 'IN',
          variantId: glue.variantId,
          locationId: mag.general,
          quantity: 5,
          idempotencyKey: same,
        }),
      ),
    );
    expect(twin.map((r) => r.status)).toEqual([201, 201]);
    expect(twin.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    expect(
      await db.stockMovement.count({
        where: { organizationId: orgA.organizationId, idempotencyKey: `manual:${same}` },
      }),
    ).toBe(1);
    expect(await onHand(mag.general, glue.variantId)).toBe(5);
  });

  it('stock négatif : refusé par défaut, autorisé par le réglage', async () => {
    const settings = { storeName: 'Quincaillerie', defaultVatRate: 18, internalCodePrefix: 'QS' };
    await a
      .put(api('/ocall-stock/settings'))
      .send({ ...settings, allowNegativeStock: true })
      .expect(200);
    const neg = (
      await move({
        kind: 'OUT',
        variantId: glue.variantId,
        locationId: mag.general,
        quantity: 7,
        reason: 'Vente avant réception',
      }).expect(201)
    ).body;
    expect(neg.quantityAfter).toBe(-2);
    await move({
      kind: 'IN',
      variantId: glue.variantId,
      locationId: mag.general,
      quantity: 2,
    }).expect(201);
    await a
      .put(api('/ocall-stock/settings'))
      .send({ ...settings, allowNegativeStock: false })
      .expect(200);
    await move({
      kind: 'OUT',
      variantId: glue.variantId,
      locationId: mag.general,
      quantity: 1,
      reason: 'Vente',
    }).expect(409);
  });

  it('transfert : réservé, expédié une fois, en transit, reçu en partie (rejeu sans effet), manque, clos', async () => {
    const t = (
      await a
        .post(api('/ocall-stock/transfers'))
        .send({
          fromSiteId: ent.id,
          toSiteId: mag.id,
          lines: [{ variantId: paint.variantId, quantity: 4 }],
        })
        .expect(201)
    ).body;
    expect(t).toMatchObject({ status: 'REQUESTED', label: 'TR-000001' });
    const lineId = t.lines[0].id;
    await a
      .post(api(`/ocall-stock/transfers/${t.id}/prepare`))
      .send({ lines: [{ lineId, fromLocationId: bin }] })
      .expect(200);
    // Réservé : plus disponible pour une sortie.
    const reserved = await move({
      kind: 'OUT',
      variantId: paint.variantId,
      locationId: bin,
      quantity: 1,
      reason: 'Vente',
    }).expect(409);
    expect(reserved.body.code).toBe('STOCK_INSUFFICIENT');

    await a.post(api(`/ocall-stock/transfers/${t.id}/ship`)).expect(200);
    const replayShip = (await a.post(api(`/ocall-stock/transfers/${t.id}/ship`)).expect(200)).body;
    expect(replayShip.status).toBe('SHIPPED');
    expect(
      await db.stockMovement.count({
        where: { organizationId: orgA.organizationId, kind: 'TRANSFER_OUT' },
      }),
    ).toBe(1);
    expect(await onHand(bin, paint.variantId)).toBe(0);
    const level = await db.stockLevel.findUniqueOrThrow({
      where: { locationId_variantId: { locationId: bin, variantId: paint.variantId } },
    });
    expect(level.reserved.toNumber()).toBe(0);
    const inTransit = (
      await a.get(api('/ocall-stock/levels')).query({ siteId: mag.id }).expect(200)
    ).body;
    expect(
      inTransit.items.find((i: { variant: { id: string } }) => i.variant.id === paint.variantId),
    ).toMatchObject({ onHand: 0, inTransit: 4 });

    const r = key();
    const part = (
      await a
        .post(api(`/ocall-stock/transfers/${t.id}/receive`))
        .send({ idempotencyKey: r, lines: [{ lineId, quantity: 3, toLocationId: mag.general }] })
        .expect(200)
    ).body;
    expect(part).toMatchObject({
      status: 'PARTIALLY_RECEIVED',
      lines: [expect.objectContaining({ receivedQuantity: 3, inTransit: 1 })],
    });
    const replay = (
      await a
        .post(api(`/ocall-stock/transfers/${t.id}/receive`))
        .send({ idempotencyKey: r, lines: [{ lineId, quantity: 3, toLocationId: mag.general }] })
        .expect(200)
    ).body;
    expect(replay.lines[0].receivedQuantity).toBe(3);
    expect(await onHand(mag.general, paint.variantId)).toBe(3);
    const over = await a
      .post(api(`/ocall-stock/transfers/${t.id}/receive`))
      .send({ idempotencyKey: key(), lines: [{ lineId, quantity: 2, toLocationId: mag.general }] })
      .expect(409);
    expect(over.body.code).toBe('STOCK_TRANSFER_OVER_RECEIPT');
    const wrongSite = await a
      .post(api(`/ocall-stock/transfers/${t.id}/receive`))
      .send({ idempotencyKey: key(), lines: [{ lineId, quantity: 1, toLocationId: ent.general }] })
      .expect(400);
    expect(wrongSite.body.code).toBe('STOCK_TRANSFER_PUT_SITE');

    const lost = (
      await a
        .post(api(`/ocall-stock/transfers/${t.id}/loss`))
        .send({ lines: [{ lineId, reason: 'Pot cassé pendant le transport' }] })
        .expect(200)
    ).body;
    expect(lost).toMatchObject({
      status: 'RECEIVED',
      lines: [expect.objectContaining({ lostQuantity: 1, inTransit: 0 })],
    });
    // La base refuse elle-même une réception au-delà de l'expédié, écrite sans passer par l'API.
    await expect(
      db.stockTransferLine.update({ where: { id: lineId }, data: { receivedQuantity: 9 } }),
    ).rejects.toThrow(/StockTransferLine_quantities_check/);

    // Annulation d'un transfert préparé : réservation libérée.
    await move({ kind: 'IN', variantId: paint.variantId, locationId: bin, quantity: 2 }).expect(
      201,
    );
    const t2 = (
      await a
        .post(api('/ocall-stock/transfers'))
        .send({
          fromSiteId: ent.id,
          toSiteId: mag.id,
          lines: [{ variantId: paint.variantId, quantity: 2 }],
        })
        .expect(201)
    ).body;
    await a
      .post(api(`/ocall-stock/transfers/${t2.id}/prepare`))
      .send({ lines: [{ lineId: t2.lines[0].id, fromLocationId: bin }] })
      .expect(200);
    await a.post(api(`/ocall-stock/transfers/${t2.id}/cancel`)).expect(200);
    const released = await db.stockLevel.findUniqueOrThrow({
      where: { locationId_variantId: { locationId: bin, variantId: paint.variantId } },
    });
    expect(released.reserved.toNumber()).toBe(0);
    await a.post(api(`/ocall-stock/transfers/${t2.id}/ship`)).expect(409);
    await a
      .post(api('/ocall-stock/transfers'))
      .send({
        fromSiteId: ent.id,
        toSiteId: ent.id,
        lines: [{ variantId: paint.variantId, quantity: 1 }],
      })
      .expect(400);
  });

  it('inventaire complet : écart calculé à la validation, non compté ramené à 0, rapports, une seule validation', async () => {
    // ENT1 : peinture 2 à GENERAL, 2 à A-01-03 ; colle 3 à A-01-03 (ne sera pas comptée).
    await move({ kind: 'IN', variantId: glue.variantId, locationId: bin, quantity: 3 }).expect(201);
    const c = (
      await a
        .post(api('/ocall-stock/counts'))
        .send({ siteId: ent.id, name: 'Inventaire annuel', scope: 'FULL' })
        .expect(201)
    ).body;
    expect(c).toMatchObject({ status: 'OPEN', label: 'INV-000001' });
    const overlap = await a
      .post(api('/ocall-stock/counts'))
      .send({ siteId: ent.id, name: 'Doublon', scope: 'PARTIAL', locationIds: [bin] })
      .expect(409);
    expect(overlap.body.code).toBe('STOCK_COUNT_OVERLAP');

    await a
      .put(api(`/ocall-stock/counts/${c.id}/lines`))
      .send({ variantId: paint.variantId, locationId: ent.general, quantity: 1, mode: 'SET' })
      .expect(200);
    // Comptage par scan : un scan = +1.
    for (let i = 0; i < 2; i++) {
      await a
        .put(api(`/ocall-stock/counts/${c.id}/lines`))
        .send({ variantId: paint.variantId, locationId: bin, quantity: 1, mode: 'ADD' })
        .expect(200);
    }
    // Mouvement pendant le comptage : il n'est pas perdu (écart calculé à la validation).
    await move({
      kind: 'IN',
      variantId: paint.variantId,
      locationId: ent.general,
      quantity: 5,
    }).expect(201);
    const preview = (await a.get(api(`/ocall-stock/counts/${c.id}`)).expect(200)).body;
    const at = (loc: string, variant: string) =>
      preview.lines.find(
        (l: { locationId: string; variantId: string }) =>
          l.locationId === loc && l.variantId === variant,
      );
    expect(at(ent.general, paint.variantId)).toMatchObject({
      counted: 1,
      onHand: 7,
      difference: -6,
    });
    expect(at(bin, paint.variantId)).toMatchObject({ counted: 2, onHand: 2, difference: 0 });
    expect(at(bin, glue.variantId)).toMatchObject({ counted: null, onHand: 3, difference: -3 });

    // Le magasinier compte mais ne valide pas.
    const keeper = (
      await a
        .post(api('/ocall-stock/members'))
        .send({ firstName: 'Ibra', lastName: 'Magasin', role: 'STOREKEEPER' })
        .expect(201)
    ).body;
    const session = await login(app, keeper.member.loginId, keeper.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: keeper.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    await session.agent.post(api(`/ocall-stock/counts/${c.id}/validate`)).expect(403);

    const done = (await a.post(api(`/ocall-stock/counts/${c.id}/validate`)).expect(200)).body;
    expect(done.status).toBe('VALIDATED');
    expect([
      await onHand(ent.general, paint.variantId),
      await onHand(bin, paint.variantId),
      await onHand(bin, glue.variantId),
    ]).toEqual([1, 2, 0]);
    const frozen = done.lines.find(
      (l: { locationId: string; variantId: string }) =>
        l.locationId === ent.general && l.variantId === paint.variantId,
    );
    expect(frozen).toMatchObject({ counted: 1, onHand: 7, difference: -6 });
    expect(
      await db.stockMovement.count({
        where: { organizationId: orgA.organizationId, kind: 'COUNT' },
      }),
    ).toBe(2);
    await a.post(api(`/ocall-stock/counts/${c.id}/validate`)).expect(409);

    const csv = await a.get(api(`/ocall-stock/counts/${c.id}/report.csv`)).expect(200);
    const text = csv.text;
    expect(text).toContain('Inventaire;Site;Emplacement;Référence;Article;Stock;Compté;Écart');
    expect(text).toContain('INV-000001;Entrepôt Bamako;GENERAL');
    const pdf = await a
      .get(api(`/ocall-stock/counts/${c.id}/report.pdf`))
      .buffer(true)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // Un site qui contient du stock ne s'archive pas.
    const archive = await a
      .patch(api(`/ocall-stock/sites/${ent.id}`))
      .send({ isArchived: true })
      .expect(409);
    expect(archive.body.code).toBe('STOCK_NOT_EMPTY');
  });

  it('périmètre : un membre rattaché au magasin ne voit ni ne touche l’entrepôt ; ajuster exige le droit', async () => {
    const created = (
      await a
        .post(api('/ocall-stock/members'))
        .send({ firstName: 'Awa', lastName: 'Magasin', role: 'STOREKEEPER' })
        .expect(201)
    ).body;
    await a
      .put(api(`/ocall-stock/members/${created.member.id}/sites`))
      .send({ siteIds: [mag.id] })
      .expect(200);
    const session = await login(app, created.member.loginId, created.temporaryPassword);
    const k = session.agent;
    await k
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    const sites = (await k.get(api('/ocall-stock/sites')).expect(200)).body;
    expect(sites.map((s: { code: string }) => s.code)).toEqual(['MAG1']);
    await k.get(api(`/ocall-stock/sites/${ent.id}`)).expect(404);
    const levels = (await k.get(api('/ocall-stock/levels')).query({ siteId: ent.id }).expect(200))
      .body;
    expect(levels.total).toBe(0);
    await move(
      { kind: 'IN', variantId: glue.variantId, locationId: ent.general, quantity: 1 },
      k,
    ).expect(404);
    await move(
      { kind: 'IN', variantId: glue.variantId, locationId: mag.general, quantity: 1 },
      k,
    ).expect(201);
    const adjust = await move(
      {
        kind: 'ADJUSTMENT',
        variantId: glue.variantId,
        locationId: mag.general,
        quantity: -1,
        reason: 'Test',
      },
      k,
    ).expect(403);
    expect(adjust.body.code).toBe('FORBIDDEN');
    const members = (await a.get(api('/ocall-stock/members')).expect(200)).body;
    expect(members.find((m: { id: string }) => m.id === created.member.id).siteIds).toEqual([
      mag.id,
    ]);
  });

  it('isolation : une autre organisation ne voit ni ne touche rien', async () => {
    const b = orgB.agent;
    await b.get(api(`/ocall-stock/sites/${ent.id}`)).expect(404);
    await move({ kind: 'IN', variantId: paint.variantId, locationId: bin, quantity: 1 }, b).expect(
      404,
    );
    const transfers = (await a.get(api('/ocall-stock/transfers')).expect(200)).body;
    await b.get(api(`/ocall-stock/transfers/${transfers[0].id}`)).expect(404);
    await b.post(api(`/ocall-stock/transfers/${transfers[0].id}/cancel`)).expect(404);
    const counts = (await a.get(api('/ocall-stock/counts')).expect(200)).body;
    await b.get(api(`/ocall-stock/counts/${counts[0].id}`)).expect(404);
    expect((await b.get(api('/ocall-stock/levels')).expect(200)).body.total).toBe(0);
    expect((await b.get(api('/ocall-stock/movements')).expect(200)).body.total).toBe(0);
  });
});
