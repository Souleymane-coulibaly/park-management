import { Injectable } from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  type StockSearchGroup,
  normalizeScannedCode,
  stockPurchaseNumber,
  stockSaleNumber,
} from '@ocall/shared';
import { type StockContext, stockCan } from './ocall-stock-access';
import { FUZZY_THRESHOLD, OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const PER_GROUP = 8;
const PAGE_SIZE = 20;

export interface StockSearchHit {
  id: string;
  label: string;
  detail: string | null;
  isArchived: boolean;
  /** Fiche liée quand elle diffère du résultat (emplacement → son site). */
  targetId?: string;
}

/** Filtre SQL des sites du membre (colonne `alias."<column>"`), paramétré. */
function siteSql(alias: string, ctx: StockContext, column = 'siteId') {
  if (ctx.siteIds === null) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(`${alias}."${column}"`)} = ANY(${ctx.siteIds}::uuid[])`;
}

/** Condition « nom proche » (contient, ou trigrammes), sans accents ni casse. */
const near = (column: Prisma.Sql, q: string) =>
  Prisma.sql`("stock_search_text"(${column}) LIKE '%' || "stock_search_text"(${q}) || '%'
    OR word_similarity("stock_search_text"(${q}), "stock_search_text"(${column})) >= ${FUZZY_THRESHOLD})`;

const rank = (column: Prisma.Sql, q: string) =>
  Prisma.sql`word_similarity("stock_search_text"(${q}), "stock_search_text"(${column}))`;

/** Numéro saisi (« VTE-000012 », « 12 ») : la partie numérique, sinon -1 (aucun numéro). */
function numberOf(q: string, prefix: string): number {
  const m = new RegExp(`^(?:${prefix}-?)?0*(\\d{1,9})$`, 'i').exec(q.trim());
  return m ? Number(m[1]) : -1;
}

/**
 * Recherche globale d'Ocall Stock (S1, complétée en S6) : articles (nom, référence, code-barres, avec le
 * disponible par site), catégories, marques, fournisseurs, clients, ventes, commandes fournisseurs, sites et
 * emplacements. Sans accents ni casse, tolérante aux fautes (trigrammes PostgreSQL), requêtes paramétrées
 * et limitées. Toujours limitée à l'organisation, aux droits et aux sites de l'utilisateur. Un type choisi
 * (`type`) est paginé ; sans type, chaque groupe montre ses premiers résultats.
 */
@Injectable()
export class OcallStockSearchService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly catalog: OcallStockCatalogService,
  ) {}

  async search(
    ctx: StockContext,
    raw: string,
    options: { type?: StockSearchGroup; page?: number; limit?: number } = {},
  ) {
    const q = raw.trim();
    const page = options.type ? Math.max(0, options.page ?? 0) : 0;
    const take = options.type ? PAGE_SIZE : Math.min(options.limit ?? PER_GROUP, PER_GROUP);
    const skip = page * take;
    // Un de plus que demandé : indique s'il reste des résultats.
    const lim = take + 1;
    const want = (g: StockSearchGroup) => !options.type || options.type === g;
    const code = normalizeScannedCode(q);
    const lookup = code && !options.type ? await this.catalog.lookup(ctx, code) : null;

    const groups: Partial<Record<StockSearchGroup, StockSearchHit[]>> = {};
    if (want('products')) groups.products = await this.products(ctx, q, skip, lim);
    if (want('categories'))
      groups.categories = await this.named(ctx, 'StockCategory', q, skip, lim);
    if (want('brands')) groups.brands = await this.named(ctx, 'StockBrand', q, skip, lim);
    if (want('suppliers') && stockCan(ctx, 'stock.suppliers.read')) {
      groups.suppliers = await this.named(ctx, 'StockSupplier', q, skip, lim);
    }
    if (want('customers') && stockCan(ctx, 'stock.customers.read')) {
      groups.customers = await this.customers(ctx, q, skip, lim);
    }
    if (want('sales') && stockCan(ctx, 'stock.sales.read')) {
      groups.sales = await this.sales(ctx, q, skip, lim);
    }
    if (want('orders') && stockCan(ctx, 'stock.purchases.read')) {
      groups.orders = await this.orders(ctx, q, skip, lim);
    }
    if (want('sites')) groups.sites = await this.sites(ctx, q, skip, lim);
    if (want('locations')) groups.locations = await this.locations(ctx, q, skip, lim);

    const more: Partial<Record<StockSearchGroup, boolean>> = {};
    for (const [g, hits] of Object.entries(groups) as [StockSearchGroup, StockSearchHit[]][]) {
      more[g] = hits.length > take;
      groups[g] = hits.slice(0, take);
    }
    const stock =
      groups.products && stockCan(ctx, 'stock.levels.read')
        ? await this.availability(
            ctx,
            groups.products.map((p) => p.id),
          )
        : {};
    return {
      // Un code lu exactement (scanner) mène directement à sa fiche.
      exact: lookup?.found ? lookup : null,
      page,
      pageSize: take,
      groups,
      more,
      /** Disponible par article et par site (multi-entrepôts), avec le droit de voir les stocks. */
      stock,
    };
  }

  // ─── Groupes ───

  private async products(
    ctx: StockContext,
    q: string,
    skip: number,
    lim: number,
  ): Promise<StockSearchHit[]> {
    const ids = await this.catalog.searchProductIds(ctx.organizationId, q, skip + lim);
    const slice = ids.slice(skip, skip + lim);
    if (slice.length === 0) return [];
    const rows = await this.db.stockProduct.findMany({
      where: { organizationId: ctx.organizationId, id: { in: slice } },
      select: { id: true, sku: true, name: true, isArchived: true },
    });
    return slice
      .map((id) => rows.find((p) => p.id === id))
      .filter((p): p is (typeof rows)[number] => Boolean(p))
      .map((p) => ({ id: p.id, label: p.name, detail: p.sku, isArchived: p.isArchived }));
  }

  /** Noms proches ; table choisie dans une liste fermée, valeurs paramétrées. */
  private named(
    ctx: StockContext,
    table: 'StockCategory' | 'StockBrand' | 'StockSupplier',
    q: string,
    skip: number,
    lim: number,
  ): Promise<StockSearchHit[]> {
    const source = Prisma.raw(`"${table}"`);
    return this.db.$queryRaw<StockSearchHit[]>`
      SELECT id, name AS label, NULL AS detail, "isArchived" FROM ${source}
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND ${near(Prisma.sql`name`, q)}
      ORDER BY "isArchived", ${rank(Prisma.sql`name`, q)} DESC, name
      LIMIT ${lim} OFFSET ${skip}`;
  }

  /** Clients : nom proche, ou chiffres du téléphone (4 au moins). */
  private customers(
    ctx: StockContext,
    q: string,
    skip: number,
    lim: number,
  ): Promise<StockSearchHit[]> {
    const digits = q.replace(/\D/g, '');
    const phone =
      digits.length >= 4
        ? Prisma.sql`OR regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE '%' || ${digits} || '%'`
        : Prisma.empty;
    return this.db.$queryRaw<StockSearchHit[]>`
      SELECT id, name AS label, phone AS detail, "isArchived" FROM "StockCustomer"
      WHERE "organizationId" = ${ctx.organizationId}::uuid
        AND (${near(Prisma.sql`name`, q)} ${phone})
      ORDER BY "isArchived", ${rank(Prisma.sql`name`, q)} DESC, name
      LIMIT ${lim} OFFSET ${skip}`;
  }

  /** Ventes : par numéro (« VTE-000012 »), sinon par nom de client ; les plus récentes d'abord. */
  private async sales(
    ctx: StockContext,
    q: string,
    skip: number,
    lim: number,
  ): Promise<StockSearchHit[]> {
    const number = numberOf(q, 'VTE');
    const rows = await this.db.$queryRaw<
      { id: string; number: number; createdAt: Date; customer: string | null }[]
    >`
      SELECT s.id, s.number, s."createdAt", c.name AS customer
      FROM "StockSale" s LEFT JOIN "StockCustomer" c ON c.id = s."customerId"
      WHERE s."organizationId" = ${ctx.organizationId}::uuid ${siteSql('s', ctx)}
        AND (s.number = ${number} OR (c.name IS NOT NULL AND ${near(Prisma.sql`c.name`, q)}))
      ORDER BY (s.number = ${number}) DESC, s."createdAt" DESC
      LIMIT ${lim} OFFSET ${skip}`;
    return rows.map((r) => ({
      id: r.id,
      label: stockSaleNumber(r.number),
      detail: [r.customer, r.createdAt.toISOString().slice(0, 10)].filter(Boolean).join(' · '),
      isArchived: false,
    }));
  }

  /** Commandes fournisseurs : par numéro (« BC-000004 »), sinon par fournisseur. */
  private async orders(
    ctx: StockContext,
    q: string,
    skip: number,
    lim: number,
  ): Promise<StockSearchHit[]> {
    const number = numberOf(q, 'BC');
    const rows = await this.db.$queryRaw<
      { id: string; number: number; status: string; supplier: string }[]
    >`
      SELECT o.id, o.number, o.status::text AS status, sp.name AS supplier
      FROM "StockPurchaseOrder" o JOIN "StockSupplier" sp ON sp.id = o."supplierId"
      WHERE o."organizationId" = ${ctx.organizationId}::uuid ${siteSql('o', ctx)}
        AND (o.number = ${number} OR ${near(Prisma.sql`sp.name`, q)})
      ORDER BY (o.number = ${number}) DESC, o."createdAt" DESC
      LIMIT ${lim} OFFSET ${skip}`;
    return rows.map((r) => ({
      id: r.id,
      label: stockPurchaseNumber(r.number),
      detail: r.supplier,
      isArchived: r.status === 'CANCELLED',
    }));
  }

  private sites(
    ctx: StockContext,
    q: string,
    skip: number,
    lim: number,
  ): Promise<StockSearchHit[]> {
    return this.db.$queryRaw<StockSearchHit[]>`
      SELECT s.id, s.name AS label, s.code AS detail, s."isArchived" FROM "StockSite" s
      WHERE s."organizationId" = ${ctx.organizationId}::uuid ${siteSql('s', ctx, 'id')}
        AND (upper(s.code) = upper(${q}) OR ${near(Prisma.sql`s.name`, q)})
      ORDER BY s."isArchived", (upper(s.code) = upper(${q})) DESC,
        ${rank(Prisma.sql`s.name`, q)} DESC, s.name
      LIMIT ${lim} OFFSET ${skip}`;
  }

  /** Emplacements : code exact ou nom proche ; le lien mène à la fiche du site. */
  private async locations(ctx: StockContext, q: string, skip: number, lim: number) {
    const rows = await this.db.$queryRaw<
      {
        id: string;
        label: string;
        code: string;
        site: string;
        siteId: string;
        isArchived: boolean;
      }[]
    >`
      SELECT l.id, l.name AS label, l.code, s.code AS site, s.id AS "siteId", l."isArchived"
      FROM "StockLocation" l JOIN "StockSite" s ON s.id = l."siteId"
      WHERE l."organizationId" = ${ctx.organizationId}::uuid ${siteSql('l', ctx)}
        AND (upper(l.code) = upper(${q}) OR ${near(Prisma.sql`l.name`, q)})
      ORDER BY l."isArchived", (upper(l.code) = upper(${q})) DESC,
        ${rank(Prisma.sql`l.name`, q)} DESC, l.name
      LIMIT ${lim} OFFSET ${skip}`;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      detail: `${r.site} · ${r.code}`,
      isArchived: r.isArchived,
      targetId: r.siteId,
    }));
  }

  /** Disponible (en stock − réservé) par article et par site, dans les sites du membre. */
  private async availability(ctx: StockContext, productIds: string[]) {
    if (productIds.length === 0) return {};
    const rows = await this.db.$queryRaw<
      { productId: string; site: string; available: Prisma.Decimal }[]
    >`
      SELECT v."productId", s.code AS site, sum(l."onHand" - l."reserved") AS available
      FROM "StockLevel" l
      JOIN "StockVariant" v ON v.id = l."variantId"
      JOIN "StockSite" s ON s.id = l."siteId"
      WHERE l."organizationId" = ${ctx.organizationId}::uuid
        AND v."productId" = ANY(${productIds}::uuid[]) ${siteSql('l', ctx)}
      GROUP BY v."productId", s.code
      ORDER BY s.code`;
    const out: Record<string, { site: string; available: number }[]> = {};
    for (const r of rows) {
      (out[r.productId] ??= []).push({ site: r.site, available: Number(r.available) });
    }
    return out;
  }
}
