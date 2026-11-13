import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import {
  STOCK_CATALOG_READER,
  type StockCatalogReader,
} from '../src/common/integration/catalog-integration';
import { OcallStockCatalogService } from '../src/modules/ocall-stock/ocall-stock-catalog.service';
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
 * Ocall Stock — S1 (socle et catalogue) : accès par abonnement et essai, lecture seule, rôles et
 * ajustements de permissions, catégories sur deux niveaux, articles, variantes, codes-barres validés
 * (clé de contrôle, doublons, UPC-A ↔ EAN-13), codes internes, lecture des scanners, recherche tolérante
 * (fautes, accents), photos, fournisseurs, étiquettes, historiques en ajout seul, contrat de lecture du
 * catalogue, isolation entre organisations. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);

const EAN13 = '4006381333931';
const UPCA = '036000291452';

(enabled ? describe : describe.skip)('Ocall Stock S1 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let productId: string;
  let defaultVariantId: string;

  async function startTrial(organizationId: string, endsAt = new Date(Date.now() + 14 * DAY)) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
    });
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
      create: { organizationId, productId: product.id, planId, status: 'TRIALING' },
      update: { status: 'TRIALING' },
    });
  }

  async function connect(identifier: string, temporaryPassword: string): Promise<Agent> {
    const session = await login(app, identifier, temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  const png = (color: string) =>
    sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
      .png()
      .toBuffer();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
    });
    // Offre de test INACTIVE : le catalogue public de Stock reste vide.
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `Stock test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'stockA', 'PARK');
    orgB = await signup(app, 'stockB', 'PARK');
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

  it('sans essai : application fermée et absente du portail ; offres Stock inactives', async () => {
    const res = await orgA.agent.get(api('/ocall-stock/context'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRODUCT_NOT_ENABLED');
    const apps = (await orgA.agent.get(api('/suite/apps')).expect(200)).body;
    expect(apps.map((a: { code: string }) => a.code)).not.toContain(STOCK_PRODUCT_CODE);
    const plans = await prisma.subscriptionPlan.findMany({
      where: { product: { code: STOCK_PRODUCT_CODE }, name: { startsWith: 'Ocall Stock — ' } },
      select: {
        name: true,
        monthlyPrice: true,
        setupFee: true,
        trialDays: true,
        isActive: true,
        includesShowcase: true,
      },
      orderBy: { monthlyPrice: 'asc' },
    });
    expect(plans).toEqual([
      {
        name: 'Ocall Stock — Sans vitrine',
        monthlyPrice: 50000,
        setupFee: 200000,
        trialDays: 14,
        isActive: false,
        includesShowcase: false,
      },
      {
        name: 'Ocall Stock — Avec vitrine',
        monthlyPrice: 65000,
        setupFee: 200000,
        trialDays: 14,
        isActive: false,
        includesShowcase: true,
      },
    ]);
  });

  it('essai : propriétaire administrateur d’office, application au portail, réglages', async () => {
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    const ctx = (await orgA.agent.get(api('/ocall-stock/context')).expect(200)).body;
    expect(ctx).toMatchObject({ access: 'full', role: 'ADMIN', currency: 'XOF' });
    expect(ctx.permissions).toContain('stock.members.manage');
    const apps = (await orgA.agent.get(api('/suite/apps')).expect(200)).body;
    expect(apps).toContainEqual(
      expect.objectContaining({ code: STOCK_PRODUCT_CODE, href: '/stock' }),
    );
    const overview = (await orgA.agent.get(api('/suite/overview')).expect(200)).body;
    expect(overview.find((a: { code: string }) => a.code === STOCK_PRODUCT_CODE)).toMatchObject({
      href: '/stock',
      access: 'full',
    });

    const draft = (await orgA.agent.get(api('/ocall-stock/settings')).expect(200)).body;
    expect(draft).toMatchObject({ saved: false, defaultVatRate: 18, internalCodePrefix: 'OC' });
    await orgA.agent
      .put(api('/ocall-stock/settings'))
      .send({ storeName: 'Quincaillerie Démo', defaultVatRate: 18, internalCodePrefix: 'abc1' })
      .expect(400);
    const saved = (
      await orgA.agent
        .put(api('/ocall-stock/settings'))
        .send({ storeName: 'Quincaillerie Démo', defaultVatRate: 18, internalCodePrefix: 'qd' })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ saved: true, internalCodePrefix: 'QD' });
  });

  it('catégories sur deux niveaux, noms uniques sans tenir compte de la casse ; marques', async () => {
    const top = (
      await orgA.agent.post(api('/ocall-stock/categories')).send({ name: 'Peintures' }).expect(201)
    ).body;
    const sub = (
      await orgA.agent
        .post(api('/ocall-stock/categories'))
        .send({ name: 'Acryliques', parentId: top.id })
        .expect(201)
    ).body;
    const third = await orgA.agent
      .post(api('/ocall-stock/categories'))
      .send({ name: 'Mates', parentId: sub.id })
      .expect(409);
    expect(third.body.code).toBe('STOCK_CATEGORY_DEPTH');
    const twin = await orgA.agent
      .post(api('/ocall-stock/categories'))
      .send({ name: ' peintures ' })
      .expect(409);
    expect(twin.body.code).toBe('STOCK_CATEGORY_NAME_TAKEN');
    // Même nom sous une autre catégorie : admis.
    const other = (
      await orgA.agent.post(api('/ocall-stock/categories')).send({ name: 'Outillage' }).expect(201)
    ).body;
    await orgA.agent
      .post(api('/ocall-stock/categories'))
      .send({ name: 'Acryliques', parentId: other.id })
      .expect(201);
    // Une catégorie qui a des sous-catégories reste au premier niveau.
    const moved = await orgA.agent
      .patch(api(`/ocall-stock/categories/${top.id}`))
      .send({ parentId: other.id })
      .expect(409);
    expect(moved.body.code).toBe('STOCK_CATEGORY_DEPTH');
    // Catégorie d'une autre organisation : introuvable.
    await orgB.agent
      .post(api('/ocall-stock/categories'))
      .send({ name: 'X', parentId: top.id })
      .expect(400);

    await orgA.agent.post(api('/ocall-stock/brands')).send({ name: 'Seigneurie' }).expect(201);
    const dup = await orgA.agent
      .post(api('/ocall-stock/brands'))
      .send({ name: 'SEIGNEURIE' })
      .expect(409);
    expect(dup.body.code).toBe('STOCK_BRAND_NAME_TAKEN');
  });

  it('article : référence générée, variante par défaut, historiques des prix et des modifications', async () => {
    const categories = (await orgA.agent.get(api('/ocall-stock/categories')).expect(200)).body;
    const acryl = categories.find(
      (c: { name: string; parentId: string | null }) => c.name === 'Acryliques' && c.parentId,
    );
    const brands = (await orgA.agent.get(api('/ocall-stock/brands')).expect(200)).body;
    const created = (
      await orgA.agent
        .post(api('/ocall-stock/products'))
        .send({
          name: 'Peinture acrylique blanche mate',
          categoryId: acryl.id,
          brandId: brands[0].id,
          unit: 'pot',
          salePrice: 12_500,
          purchasePrice: 9_000,
          minStock: 5,
        })
        .expect(201)
    ).body;
    productId = created.id;
    expect(created).toMatchObject({
      sku: 'QD-000001',
      vatRate: 18,
      salePrice: 12_500,
      purchasePrice: 9_000,
      minStock: 5,
    });
    expect(created.variants).toHaveLength(1);
    expect(created.variants[0]).toMatchObject({ isDefault: true, name: null, sku: 'QD-000001' });
    defaultVariantId = created.variants[0].id;

    // Référence saisie déjà prise ; catégorie d'une autre organisation refusée.
    // Référence identique à la casse près : même référence.
    const taken = await orgA.agent
      .post(api('/ocall-stock/products'))
      .send({ sku: 'qd-000001', name: 'Doublon', salePrice: 1 })
      .expect(409);
    expect(taken.body.code).toBe('STOCK_SKU_TAKEN');
    const dupe = await orgA.agent
      .post(api('/ocall-stock/products'))
      .send({ sku: 'QD-000001', name: 'Doublon 2', salePrice: 1 });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('STOCK_SKU_TAKEN');
    await orgB.agent
      .post(api('/ocall-stock/products'))
      .send({ name: 'Intrus', salePrice: 1, categoryId: acryl.id })
      .expect(400);

    await orgA.agent
      .patch(api(`/ocall-stock/products/${productId}`))
      .send({ salePrice: 13_000, name: 'Peinture acrylique blanche mate intérieure' })
      .expect(200);
    const history = (
      await orgA.agent.get(api(`/ocall-stock/products/${productId}/history`)).expect(200)
    ).body;
    expect(
      history.prices.map((p: { kind: string; oldPrice: number | null; newPrice: number }) => [
        p.kind,
        p.oldPrice,
        p.newPrice,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['SALE', null, 12_500],
        ['PURCHASE', null, 9_000],
        ['SALE', 12_500, 13_000],
      ]),
    );
    expect(history.changes[0]).toMatchObject({ action: 'updated' });
    expect(history.changes[0].changes.salePrice).toEqual([12_500, 13_000]);

    // Historiques en ajout seul : la base refuse modification et suppression.
    await expect(
      db.$executeRaw`UPDATE "StockPriceHistory" SET "newPrice" = 1 WHERE "variantId" = ${defaultVariantId}::uuid`,
    ).rejects.toThrow(/STOCK_HISTORY_APPEND_ONLY/);
    await expect(db.stockProductHistory.deleteMany({ where: { productId } })).rejects.toThrow(
      /STOCK_HISTORY_APPEND_ONLY/,
    );
  });

  it('codes-barres : clé de contrôle, doublons (UPC-A ↔ EAN-13), code interne unique par variante', async () => {
    const bad = await orgA.agent
      .post(api(`/ocall-stock/variants/${defaultVariantId}/barcodes`))
      .send({ type: 'EAN13', code: '4006381333932' })
      .expect(400);
    expect(bad.body.code).toBe('STOCK_BARCODE_INVALID');
    expect(bad.body.message).toContain('clé de contrôle');
    await orgA.agent
      .post(api(`/ocall-stock/variants/${defaultVariantId}/barcodes`))
      .send({ type: 'EAN13', code: EAN13 })
      .expect(201);
    const twin = await orgA.agent
      .post(api(`/ocall-stock/variants/${defaultVariantId}/barcodes`))
      .send({ type: 'EAN13', code: EAN13 })
      .expect(409);
    expect(twin.body.code).toBe('STOCK_BARCODE_TAKEN');
    // Même code dans une autre organisation : admis (codes propres à chaque client).
    const otherProduct = (
      await orgB.agent
        .post(api('/ocall-stock/products'))
        .send({ name: 'Produit B', salePrice: 500 })
        .expect(201)
    ).body;
    await orgB.agent
      .post(api(`/ocall-stock/variants/${otherProduct.variants[0].id}/barcodes`))
      .send({ type: 'EAN13', code: EAN13 })
      .expect(201);

    const upcProduct = (
      await orgA.agent
        .post(api('/ocall-stock/products'))
        .send({ name: 'Colle importée', salePrice: 3_000 })
        .expect(201)
    ).body;
    await orgA.agent
      .post(api(`/ocall-stock/variants/${upcProduct.variants[0].id}/barcodes`))
      .send({ type: 'UPCA', code: UPCA })
      .expect(201);
    const sameAsEan = await orgA.agent
      .post(api(`/ocall-stock/variants/${defaultVariantId}/barcodes`))
      .send({ type: 'EAN13', code: `0${UPCA}` })
      .expect(409);
    expect(sameAsEan.body.message).toContain('Colle importée');

    const internal = (
      await orgA.agent
        .post(api(`/ocall-stock/variants/${defaultVariantId}/internal-code`))
        .expect(201)
    ).body;
    expect(internal).toMatchObject({ type: 'INTERNAL', code: 'QD00000001' });
    const again = await orgA.agent
      .post(api(`/ocall-stock/variants/${defaultVariantId}/internal-code`))
      .expect(409);
    expect(again.body.code).toBe('STOCK_INTERNAL_CODE_EXISTS');

    // La base refuse elle-même un EAN invalide écrit sans passer par l'API.
    await expect(
      db.stockBarcode.create({
        data: {
          organizationId: orgA.organizationId,
          variantId: defaultVariantId,
          type: 'EAN13',
          code: '4006381333939',
          createdByUserId: orgA.organizationId,
        },
      }),
    ).rejects.toThrow(/StockBarcode_code_check/);
  });

  it('lecture d’un scanner : code exact, forme EAN-13 d’un UPC-A, référence, bruit retiré, code inconnu', async () => {
    const byEan = (
      await orgA.agent
        .get(api('/ocall-stock/lookup'))
        .query({ code: ` ${EAN13}\r` })
        .expect(200)
    ).body;
    expect(byEan).toMatchObject({ found: true, matchedBy: 'barcode', product: { id: productId } });
    const byUpcAsEan = (
      await orgA.agent
        .get(api('/ocall-stock/lookup'))
        .query({ code: `0${UPCA}` })
        .expect(200)
    ).body;
    expect(byUpcAsEan).toMatchObject({ found: true, product: { name: 'Colle importée' } });
    const bySku = (
      await orgA.agent.get(api('/ocall-stock/lookup')).query({ code: 'qd-000001' }).expect(200)
    ).body;
    expect(bySku).toMatchObject({ found: true, matchedBy: 'sku' });
    const unknown = (
      await orgA.agent.get(api('/ocall-stock/lookup')).query({ code: '96385074' }).expect(200)
    ).body;
    expect(unknown).toEqual({ found: false, code: '96385074', detectedType: 'EAN8' });
    // Le code d'une autre organisation n'existe pas pour elle.
    const internalOfA = (
      await orgB.agent.get(api('/ocall-stock/lookup')).query({ code: 'QD00000001' }).expect(200)
    ).body;
    expect(internalOfA.found).toBe(false);
  });

  it('recherche : fautes, accents, référence, code ; pagination ; jamais une autre organisation', async () => {
    await orgA.agent
      .post(api('/ocall-stock/products'))
      .send({ name: 'Eau minérale Diago 1,5 L', salePrice: 400 })
      .expect(201);
    for (const q of ['eau minerale', 'EAU MINÉRALE', 'mineralle']) {
      const res = (await orgA.agent.get(api('/ocall-stock/products')).query({ q }).expect(200))
        .body;
      expect(res.items.map((p: { name: string }) => p.name)).toContain('Eau minérale Diago 1,5 L');
    }
    const typo = (
      await orgA.agent.get(api('/ocall-stock/products')).query({ q: 'acrilique' }).expect(200)
    ).body;
    expect(typo.items[0]?.id).toBe(productId);
    const bySku = (
      await orgA.agent.get(api('/ocall-stock/products')).query({ q: 'QD-0000' }).expect(200)
    ).body;
    expect(bySku.total).toBeGreaterThanOrEqual(2);
    const byCode = (
      await orgA.agent.get(api('/ocall-stock/products')).query({ q: EAN13 }).expect(200)
    ).body;
    expect(byCode.items.map((p: { id: string }) => p.id)).toEqual([productId]);
    const page = (
      await orgA.agent.get(api('/ocall-stock/products')).query({ pageSize: 2, page: 2 }).expect(200)
    ).body;
    // Trois articles (peinture, colle, eau) : la deuxième page de deux en contient un.
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.items).toHaveLength(1);

    const global = (
      await orgA.agent.get(api('/ocall-stock/search')).query({ q: EAN13 }).expect(200)
    ).body;
    expect(global.exact).toMatchObject({ found: true, product: { id: productId } });
    const brands = (
      await orgA.agent.get(api('/ocall-stock/search')).query({ q: 'seigneuri' }).expect(200)
    ).body;
    expect(brands.groups.brands.map((b: { label: string }) => b.label)).toContain('Seigneurie');

    // La requête de recherche elle-même est limitée à l'organisation (sinon les articles des autres
    // occuperaient la limite de résultats).
    const catalog = app.get(OcallStockCatalogService);
    expect(await catalog.searchProductIds(orgB.organizationId, 'peinture', 10)).toEqual([]);
    expect(await catalog.searchProductIds(orgA.organizationId, 'peinture', 10)).toContain(
      productId,
    );
    const fromB = (
      await orgB.agent.get(api('/ocall-stock/products')).query({ q: 'peinture' }).expect(200)
    ).body;
    expect(fromB.total).toBe(0);
    const globalB = (
      await orgB.agent.get(api('/ocall-stock/search')).query({ q: 'seigneurie' }).expect(200)
    ).body;
    expect(globalB.groups.brands).toEqual([]);
    await orgB.agent.get(api(`/ocall-stock/products/${productId}`)).expect(404);
    await orgB.agent
      .patch(api(`/ocall-stock/products/${productId}`))
      .send({ name: 'Volé' })
      .expect(404);
    await orgB.agent
      .post(api(`/ocall-stock/variants/${defaultVariantId}/barcodes`))
      .send({ type: 'EAN8', code: '96385074' })
      .expect(404);
  });

  it('variantes : nom unique par article, prix propre, variante par défaut liée à l’article', async () => {
    const withVariant = (
      await orgA.agent
        .post(api(`/ocall-stock/products/${productId}/variants`))
        .send({ name: '5 L', salePrice: 55_000 })
        .expect(201)
    ).body;
    const five = withVariant.variants.find((v: { name: string | null }) => v.name === '5 L');
    expect(five).toMatchObject({ salePrice: 55_000, effectiveSalePrice: 55_000, sku: 'QD-000004' });
    const dup = await orgA.agent
      .post(api(`/ocall-stock/products/${productId}/variants`))
      .send({ name: '5 l' })
      .expect(409);
    expect(dup.body.code).toBe('STOCK_VARIANT_NAME_TAKEN');
    const rename = await orgA.agent
      .patch(api(`/ocall-stock/variants/${defaultVariantId}`))
      .send({ name: 'Standard' })
      .expect(400);
    expect(rename.body.code).toBe('STOCK_DEFAULT_VARIANT');
  });

  it('équipe : caissier sans prix d’achat ni écriture ; ajustements accordés et retirés ; jamais sur soi', async () => {
    const created = (
      await orgA.agent
        .post(api('/ocall-stock/members'))
        .send({ firstName: 'Awa', lastName: 'Caisse', role: 'CASHIER' })
        .expect(201)
    ).body;
    const cashier = await connect(created.member.loginId, created.temporaryPassword);
    const ctx = (await cashier.get(api('/ocall-stock/context')).expect(200)).body;
    expect(ctx).toMatchObject({ role: 'CASHIER', roleLabel: 'Caissier' });
    const seen = (await cashier.get(api(`/ocall-stock/products/${productId}`)).expect(200)).body;
    expect(seen.salePrice).toBe(13_000);
    expect(seen).not.toHaveProperty('purchasePrice');
    const history = (
      await cashier.get(api(`/ocall-stock/products/${productId}/history`)).expect(200)
    ).body;
    expect(history.prices.every((p: { kind: string }) => p.kind === 'SALE')).toBe(true);
    await cashier
      .post(api('/ocall-stock/products'))
      .send({ name: 'Interdit', salePrice: 1 })
      .expect(403);
    await cashier
      .patch(api(`/ocall-stock/products/${productId}`))
      .send({ salePrice: 1 })
      .expect(403);
    await cashier.get(api('/ocall-stock/suppliers')).expect(403);
    await cashier.get(api('/ocall-stock/members')).expect(403);

    // Ajustement : le caissier peut changer les prix de vente, et seulement eux.
    const granted = (
      await orgA.agent
        .put(api(`/ocall-stock/members/${created.member.id}/permissions`))
        .send({ overrides: [{ permission: 'stock.prices.manage', granted: true }] })
        .expect(200)
    ).body;
    expect(granted.effectivePermissions).toContain('stock.prices.manage');
    await cashier
      .patch(api(`/ocall-stock/products/${productId}`))
      .send({ salePrice: 13_500 })
      .expect(200);
    await cashier
      .patch(api(`/ocall-stock/products/${productId}`))
      .send({ salePrice: 13_600, name: 'Renommé' })
      .expect(403);
    await cashier
      .patch(api(`/ocall-stock/products/${productId}`))
      .send({ purchasePrice: 1 })
      .expect(403);
    // Droits d'administration jamais ajustables ; permission inconnue refusée.
    await orgA.agent
      .put(api(`/ocall-stock/members/${created.member.id}/permissions`))
      .send({ overrides: [{ permission: 'stock.members.manage', granted: true }] })
      .expect(400);
    // Retrait : plus de catalogue.
    await orgA.agent
      .put(api(`/ocall-stock/members/${created.member.id}/permissions`))
      .send({ overrides: [{ permission: 'stock.catalog.read', granted: false }] })
      .expect(200);
    await cashier.get(api('/ocall-stock/products')).expect(403);

    // Un administrateur membre ne modifie pas son propre accès.
    const admin = (
      await orgA.agent
        .post(api('/ocall-stock/members'))
        .send({ firstName: 'Moussa', lastName: 'Admin', role: 'ADMIN' })
        .expect(201)
    ).body;
    const adminAgent = await connect(admin.member.loginId, admin.temporaryPassword);
    const self = await adminAgent
      .patch(api(`/ocall-stock/members/${admin.member.id}`))
      .send({ isActive: false })
      .expect(403);
    expect(self.body.code).toBe('SELF_CHANGE_REFUSED');
    // Désactivation : sessions fermées aussitôt.
    await adminAgent
      .patch(api(`/ocall-stock/members/${created.member.id}`))
      .send({ isActive: false })
      .expect(200);
    await cashier.get(api('/ocall-stock/context')).expect(401);
    // Un rôle Stock ne donne rien sur Ocall Park.
    await adminAgent.get(api('/dashboard')).expect(403);
  });

  it('photos : réencodées en JPEG, quatre au plus, invisibles d’une autre organisation', async () => {
    const ids: string[] = [];
    for (const color of ['#ff0000', '#00ff00', '#0000ff', '#ffff00']) {
      const res = await orgA.agent
        .post(api(`/ocall-stock/products/${productId}/images`))
        .attach('file', await png(color), { filename: 'photo.png', contentType: 'image/png' })
        .expect(201);
      ids.push(res.body.id);
    }
    const fifth = await orgA.agent
      .post(api(`/ocall-stock/products/${productId}/images`))
      .attach('file', await png('#000000'), { filename: 'photo.png', contentType: 'image/png' })
      .expect(409);
    expect(fifth.body.code).toBe('STOCK_IMAGES_LIMIT');
    const image = await orgA.agent
      .get(api(`/ocall-stock/products/${productId}/images/${ids[0]}`))
      .buffer(true)
      .expect(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect((image.body as Buffer).subarray(0, 2).toString('hex')).toBe('ffd8');
    await orgB.agent.get(api(`/ocall-stock/products/${productId}/images/${ids[0]}`)).expect(404);
    const notImage = await orgA.agent
      .post(api(`/ocall-stock/products/${productId}/images`))
      .attach('file', Buffer.from('pas une image'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
    expect(notImage.body.code).toBe('STOCK_IMAGE_REFUSED');
    await orgA.agent.delete(api(`/ocall-stock/products/${productId}/images/${ids[1]}`)).expect(204);
    const list = (
      await orgA.agent.get(api('/ocall-stock/products')).query({ q: 'acrylique' }).expect(200)
    ).body;
    expect(list.items[0].imageId).toBe(ids[0]);
  });

  it('fournisseurs : fiche, recherche, isolation', async () => {
    const supplier = (
      await orgA.agent
        .post(api('/ocall-stock/suppliers'))
        .send({
          name: 'Grossiste Sahel Distribution',
          phone: '+223 70 00 00 01',
          city: 'Bamako',
          leadTimeDays: 7,
        })
        .expect(201)
    ).body;
    expect(supplier).toMatchObject({ country: 'ML', leadTimeDays: 7 });
    await orgA.agent
      .post(api('/ocall-stock/suppliers'))
      .send({ name: 'X', leadTimeDays: 400 })
      .expect(400);
    const found = (
      await orgA.agent.get(api('/ocall-stock/search')).query({ q: 'grosiste sahel' }).expect(200)
    ).body;
    expect(found.groups.suppliers.map((s: { id: string }) => s.id)).toContain(supplier.id);
    await orgB.agent.get(api(`/ocall-stock/suppliers/${supplier.id}`)).expect(404);
  });

  it('étiquettes : PDF au format, une page par étiquette ; plafonds et autre organisation refusés', async () => {
    const product = (await orgA.agent.get(api(`/ocall-stock/products/${productId}`)).expect(200))
      .body;
    const five = product.variants.find((v: { name: string | null }) => v.name === '5 L');
    const res = await orgA.agent
      .post(api('/ocall-stock/labels.pdf'))
      .send({
        format: '40x30',
        fields: ['storeName', 'productName', 'variant', 'barcode', 'qrCode', 'price'],
        items: [
          { variantId: defaultVariantId, copies: 3 },
          { variantId: five.id, copies: 1 },
        ],
      })
      .buffer(true)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const text = (res.body as Buffer).toString('latin1');
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(4);
    await orgA.agent
      .post(api('/ocall-stock/labels.pdf'))
      .send({
        format: '40x30',
        fields: ['price'],
        items: [{ variantId: defaultVariantId, copies: 0 }],
      })
      .expect(400);
    await orgA.agent
      .post(api('/ocall-stock/labels.pdf'))
      .send({
        format: '45x30',
        fields: ['price'],
        items: [{ variantId: defaultVariantId, copies: 1 }],
      })
      .expect(400);
    await orgB.agent
      .post(api('/ocall-stock/labels.pdf'))
      .send({
        format: '40x30',
        fields: ['price'],
        items: [{ variantId: defaultVariantId, copies: 1 }],
      })
      .expect(404);
  });

  it('contrat de lecture du catalogue : articles de l’organisation, rien pour une autre ni sans Stock', async () => {
    const reader = app.get<StockCatalogReader>(STOCK_CATALOG_READER);
    const entries = await reader.search(orgA.organizationId, 'peinture acrylique', 10);
    const five = entries.find((e) => e.label.endsWith('— 5 L'));
    expect(five).toMatchObject({ salePrice: 55_000, vatRate: 18, unit: 'pot', isStockable: true });
    const base = entries.find((e) => e.variantId === defaultVariantId);
    expect(base).toMatchObject({ salePrice: 13_500, barcode: EAN13 });
    expect(await reader.variants(orgB.organizationId, [defaultVariantId])).toEqual([]);
    const outsider = await signup(app, 'stockC', 'PARK');
    expect(await reader.isAvailable(outsider.organizationId)).toBe(false);
    expect(await reader.search(outsider.organizationId, 'peinture', 10)).toEqual([]);
  });

  it('essai échu : consultation seulement, aucune donnée supprimée', async () => {
    await startTrial(orgA.organizationId, new Date(Date.now() - DAY));
    const ctx = (await orgA.agent.get(api('/ocall-stock/context')).expect(200)).body;
    expect(ctx.access).toBe('read_only');
    await orgA.agent.get(api(`/ocall-stock/products/${productId}`)).expect(200);
    const blocked = await orgA.agent
      .post(api('/ocall-stock/products'))
      .send({ name: 'Après échéance', salePrice: 1 })
      .expect(403);
    expect(blocked.body.code).toBe('SUBSCRIPTION_READ_ONLY');
    await startTrial(orgA.organizationId);
  });
});
