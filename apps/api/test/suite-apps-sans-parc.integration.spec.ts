import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FACTURE_PRODUCT_CODE, STOCK_PRODUCT_CODE } from '@ocall/shared';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RUN, type SignedUpOwner, cleanup, createTestApp, signup } from './helpers';

/**
 * Applications Ocall sans droit Ocall Park : une organisation dont l'essai Park est échu (ou qui n'a
 * jamais eu Park) doit pouvoir écrire dans Ocall Facture et Ocall Stock tant que leur propre essai ou
 * abonnement est actif. La lecture seule Park ne s'applique qu'aux routes métier Park ; Facture et Stock
 * appliquent leur propre lecture seule. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(
  process.env.TEST_FACTURE_DATABASE_URL && process.env.TEST_STOCK_DATABASE_URL,
);

(enabled ? describe : describe.skip)('Applications Ocall sans droit Park (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: SignedUpOwner;
  const planIds: string[] = [];

  /** Essai d'une application ouvert directement en base (offre de test inactive). */
  async function trial(code: string, endsAt: Date) {
    const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code } });
    const name = `${code} sans Park ${RUN}`;
    const plan = await prisma.subscriptionPlan.upsert({
      where: { productId_name: { productId: product.id, name } },
      create: { productId: product.id, name, monthlyPrice: 50_000, setupFee: 0, isActive: false },
      update: {},
    });
    if (!planIds.includes(plan.id)) planIds.push(plan.id);
    const organizationId = org.organizationId;
    await prisma.productTrial.upsert({
      where: { organizationId_productId: { organizationId, productId: product.id } },
      create: {
        organizationId,
        productId: product.id,
        startedAt: new Date(),
        endsAt,
        startedByOcall: true,
      },
      update: { endsAt },
    });
    await prisma.subscription.upsert({
      where: { organizationId_productId: { organizationId, productId: product.id } },
      create: { organizationId, productId: product.id, planId: plan.id, status: 'TRIALING' },
      update: { status: 'TRIALING' },
    });
  }

  const parkWrite = async () =>
    org.agent.post(api('/ticketing/categories')).send({
      establishmentId: (
        await prisma.establishment.findFirstOrThrow({
          where: { organizationId: org.organizationId },
        })
      ).id,
      kind: 'ADULT',
      name: `Entrée ${randomUUID().slice(0, 6)}`,
      price: 2_000,
    });
  const factureWrite = () =>
    org.agent.put(api('/facture/settings')).send({
      legalName: `Froid Services ${RUN} SARL`,
      address: 'Rue 310, ACI 2000',
      city: 'Bamako',
      phone: '+223 70 00 00 00',
      defaultVatRate: 18,
      paymentTermsDays: 30,
    });
  const stockWrite = () =>
    org.agent
      .post(api('/ocall-stock/categories'))
      .send({ name: `Peintures ${randomUUID().slice(0, 6)}` });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    org = await signup(app, 'sansPark', 'PARK');
    // Essai Ocall Park échu : toutes les écritures métier Park passent en lecture seule.
    await prisma.productTrial.updateMany({
      where: { organizationId: org.organizationId },
      data: { endsAt: new Date(Date.now() - DAY) },
    });
  }, 300_000);

  afterAll(async () => {
    try {
      if (org && prisma) {
        const ids = [org.organizationId];
        const { purgeFactureOrganizations } = await import('@ocall/facture-database');
        await purgeFactureOrganizations(app.get(FacturePrismaService), ids);
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(app.get(OcallStockPrismaService), ids);
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('préalable : essai Park échu → écritures Park refusées (PARK_READ_ONLY)', async () => {
    const res = await parkWrite();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PARK_READ_ONLY');
  });

  it('essais Facture et Stock en cours : écritures acceptées malgré Park échu', async () => {
    await trial(FACTURE_PRODUCT_CODE, new Date(Date.now() + 14 * DAY));
    await trial(STOCK_PRODUCT_CODE, new Date(Date.now() + 14 * DAY));
    const facture = await factureWrite();
    expect(facture.body.code).not.toBe('PARK_READ_ONLY');
    expect(facture.status).toBe(200);
    const stock = await stockWrite();
    expect(stock.body.code).not.toBe('PARK_READ_ONLY');
    expect(stock.status).toBe(201);
    // Park reste en lecture seule : l'exemption ne s'étend pas aux routes métier Park.
    expect((await parkWrite()).body.code).toBe('PARK_READ_ONLY');
  });

  it('essais Facture et Stock échus : leur propre lecture seule s’applique', async () => {
    await trial(FACTURE_PRODUCT_CODE, new Date(Date.now() - DAY));
    await trial(STOCK_PRODUCT_CODE, new Date(Date.now() - DAY));
    const facture = await factureWrite();
    expect(facture.status).toBe(403);
    expect(facture.body.code).not.toBe('PARK_READ_ONLY');
    const stock = await stockWrite();
    expect(stock.status).toBe(403);
    expect(stock.body.code).not.toBe('PARK_READ_ONLY');
    // Les lectures restent ouvertes.
    await org.agent.get(api('/facture/settings')).expect(200);
    await org.agent.get(api('/ocall-stock/categories')).expect(200);
  });
});
