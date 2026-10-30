import { Prisma } from '@ocall/database';
import type { Activity, AnalyticsRange } from '@ocall/shared';
import type { AnalyticsScope } from './analytics-scope';

/**
 * Primitives SQL des analyses. Toutes :
 * - sont paramétrées (aucune valeur concaténée ; seuls des noms de colonnes fixes passent par
 *   Prisma.raw) ;
 * - filtrent l'organisation de la session ET les établissements du périmètre ;
 * - comparent l'heure LOCALE de l'établissement (colonne `timezone`) aux bornes de la période ;
 * - préfiltrent en instants UTC, avec un jour de marge pour tous les fuseaux, afin d'utiliser les
 *   index sur les dates ;
 * - agrègent dans PostgreSQL : aucune ligne de vente n'est rapatriée une à une (pas de N+1).
 *
 * CA encaissé = paiements RÉUSSIS de ventes non annulées, datés à l'encaissement : un paiement est
 * créé réussi au moment où il est encaissé (seul chemin d'écriture : SalesService.pay), et la base
 * garantit un seul paiement par vente (clé d'idempotence, vente déjà payée refusée).
 */

type Db = Prisma.TransactionClient;
type Row = Record<string, unknown>;
const DAY_MS = 86_400_000;

/** Bigint, Decimal ou null renvoyés par PostgreSQL → nombre. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const local = (col: string) => Prisma.raw(`(${col} AT TIME ZONE 'UTC' AT TIME ZONE e."timezone")`);

function within(col: string, r: AnalyticsRange): Prisma.Sql {
  const l = local(col);
  return Prisma.sql`(${l} >= ${r.from}::timestamp AND ${l} < ${r.to}::timestamp)`;
}

function coarse(col: string, ...ranges: AnalyticsRange[]): Prisma.Sql {
  const from = Math.min(...ranges.map((r) => Date.parse(`${r.from}:00Z`))) - DAY_MS;
  const to = Math.max(...ranges.map((r) => Date.parse(`${r.to}:00Z`))) + DAY_MS;
  const c = Prisma.raw(col);
  return Prisma.sql`${c} >= ${new Date(from)} AND ${c} < ${new Date(to)}`;
}

/** Jour local AAAA-MM-JJ et heure locale d'une colonne horodatée. */
const dayOf = (col: string) => Prisma.sql`to_char(${local(col)}, 'YYYY-MM-DD')`;
const hourOf = (col: string) => Prisma.sql`EXTRACT(HOUR FROM ${local(col)})::int`;

export const isEmptyScope = (scope: AnalyticsScope, activities: Activity[] = scope.activities) =>
  scope.establishmentIds.length === 0 || activities.length === 0;

/** Ventes du périmètre (organisation, établissements, activités). */
function saleScope(scope: AnalyticsScope, activities: Activity[]): Prisma.Sql {
  return Prisma.sql`s."organizationId" = ${scope.organizationId}::uuid
    AND s."establishmentId" = ANY(${scope.establishmentIds}::uuid[])
    AND s."activity"::text = ANY(${activities}::text[])`;
}

const PAID_FROM = Prisma.sql`FROM "Payment" p
  JOIN "Sale" s ON s."id" = p."saleId"
  JOIN "Establishment" e ON e."id" = s."establishmentId"`;

/** Quantité d'articles de chaque vente, calculée par vente (pas de multiplication du montant). */
const SALE_QTY = Prisma.sql`CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(l."quantity"), 0) AS qty FROM "SaleLine" l WHERE l."saleId" = s."id"
) q`;

function paidWhere(scope: AnalyticsScope, activities: Activity[]): Prisma.Sql {
  return Prisma.sql`p."organizationId" = ${scope.organizationId}::uuid
    AND p."status" = 'SUCCEEDED' AND s."status" = 'OPEN'
    AND ${saleScope(scope, activities)}`;
}

/** Commandes : ventes non annulées, payées ou non, datées à leur création. */
function orderWhere(scope: AnalyticsScope): Prisma.Sql {
  return Prisma.sql`s."status" = 'OPEN' AND ${saleScope(scope, ['RESTAURANT'])}`;
}

/** Entrées réelles : scans ACCEPTÉS uniquement (au plus un par billet, contrainte unique). */
function entryWhere(scope: AnalyticsScope): Prisma.Sql {
  return Prisma.sql`t."organizationId" = ${scope.organizationId}::uuid
    AND t."establishmentId" = ANY(${scope.establishmentIds}::uuid[])
    AND t."result" = 'ACCEPTED'`;
}

// ─── Encaissements ───

export interface PaymentTotalsRow {
  establishmentId: string;
  activity: Activity;
  revenue: number;
  sales: number;
  loyalty: number;
  quantity: number;
  prevRevenue: number;
  prevSales: number;
  prevQuantity: number;
}

/** Totaux encaissés par établissement et activité, période courante et précédente. */
export async function paymentTotals(
  db: Db,
  scope: AnalyticsScope,
  activities: Activity[],
): Promise<PaymentTotalsRow[]> {
  if (isEmptyScope(scope, activities)) return [];
  const { current: cur, previous: prev } = scope.period;
  const isCur = within('p."createdAt"', cur);
  const isPrev = within('p."createdAt"', prev);
  const rows = await db.$queryRaw<Row[]>`
    SELECT s."establishmentId"::text AS "establishmentId", s."activity"::text AS activity,
      SUM(p."amount") FILTER (WHERE ${isCur}) AS revenue,
      COUNT(*) FILTER (WHERE ${isCur}) AS sales,
      SUM(s."loyaltyDiscount") FILTER (WHERE ${isCur}) AS loyalty,
      SUM(q.qty) FILTER (WHERE ${isCur}) AS quantity,
      SUM(p."amount") FILTER (WHERE ${isPrev}) AS "prevRevenue",
      COUNT(*) FILTER (WHERE ${isPrev}) AS "prevSales",
      SUM(q.qty) FILTER (WHERE ${isPrev}) AS "prevQuantity"
    ${PAID_FROM}
    ${SALE_QTY}
    WHERE ${paidWhere(scope, activities)}
      AND ${coarse('p."createdAt"', cur, prev)}
      AND (${isCur} OR ${isPrev})
    GROUP BY 1, 2`;
  return rows.map((r) => ({
    establishmentId: String(r.establishmentId),
    activity: r.activity as Activity,
    revenue: num(r.revenue),
    sales: num(r.sales),
    loyalty: num(r.loyalty),
    quantity: num(r.quantity),
    prevRevenue: num(r.prevRevenue),
    prevSales: num(r.prevSales),
    prevQuantity: num(r.prevQuantity),
  }));
}

export interface GridRow {
  activity: Activity;
  day: string;
  hour: number;
  revenue: number;
  sales: number;
  quantity: number;
}

/** Encaissements par jour et heure locale (évolutions, histogrammes, carte thermique). */
export async function paymentGrid(
  db: Db,
  scope: AnalyticsScope,
  activities: Activity[],
  range: AnalyticsRange,
): Promise<GridRow[]> {
  if (isEmptyScope(scope, activities)) return [];
  const rows = await db.$queryRaw<Row[]>`
    SELECT s."activity"::text AS activity, ${dayOf('p."createdAt"')} AS day,
      ${hourOf('p."createdAt"')} AS hour,
      SUM(p."amount") AS revenue, COUNT(*) AS sales, SUM(q.qty) AS quantity
    ${PAID_FROM}
    ${SALE_QTY}
    WHERE ${paidWhere(scope, activities)}
      AND ${coarse('p."createdAt"', range)}
      AND ${within('p."createdAt"', range)}
    GROUP BY 1, 2, 3`;
  return rows.map((r) => ({
    activity: r.activity as Activity,
    day: String(r.day),
    hour: num(r.hour),
    revenue: num(r.revenue),
    sales: num(r.sales),
    quantity: num(r.quantity),
  }));
}

// ─── Commandes restaurant (création) ───

export interface CountRow {
  establishmentId: string;
  current: number;
  previous: number;
}

export async function orderCounts(db: Db, scope: AnalyticsScope): Promise<CountRow[]> {
  if (isEmptyScope(scope, ['RESTAURANT'])) return [];
  const { current: cur, previous: prev } = scope.period;
  const isCur = within('s."createdAt"', cur);
  const isPrev = within('s."createdAt"', prev);
  const rows = await db.$queryRaw<Row[]>`
    SELECT s."establishmentId"::text AS "establishmentId",
      COUNT(*) FILTER (WHERE ${isCur}) AS current, COUNT(*) FILTER (WHERE ${isPrev}) AS previous
    FROM "Sale" s JOIN "Establishment" e ON e."id" = s."establishmentId"
    WHERE ${orderWhere(scope)}
      AND ${coarse('s."createdAt"', cur, prev)}
      AND (${isCur} OR ${isPrev})
    GROUP BY 1`;
  return rows.map((r) => ({
    establishmentId: String(r.establishmentId),
    current: num(r.current),
    previous: num(r.previous),
  }));
}

export interface SimpleGridRow {
  day: string;
  hour: number;
  count: number;
}

export async function orderGrid(
  db: Db,
  scope: AnalyticsScope,
  range: AnalyticsRange,
): Promise<SimpleGridRow[]> {
  if (isEmptyScope(scope, ['RESTAURANT'])) return [];
  const rows = await db.$queryRaw<Row[]>`
    SELECT ${dayOf('s."createdAt"')} AS day, ${hourOf('s."createdAt"')} AS hour, COUNT(*) AS count
    FROM "Sale" s JOIN "Establishment" e ON e."id" = s."establishmentId"
    WHERE ${orderWhere(scope)}
      AND ${coarse('s."createdAt"', range)}
      AND ${within('s."createdAt"', range)}
    GROUP BY 1, 2`;
  return rows.map((r) => ({ day: String(r.day), hour: num(r.hour), count: num(r.count) }));
}

// ─── Entrées du parc (scans acceptés) ───

export async function entryCounts(db: Db, scope: AnalyticsScope): Promise<CountRow[]> {
  if (isEmptyScope(scope, ['PARK'])) return [];
  const { current: cur, previous: prev } = scope.period;
  const isCur = within('t."createdAt"', cur);
  const isPrev = within('t."createdAt"', prev);
  const rows = await db.$queryRaw<Row[]>`
    SELECT t."establishmentId"::text AS "establishmentId",
      COUNT(*) FILTER (WHERE ${isCur}) AS current, COUNT(*) FILTER (WHERE ${isPrev}) AS previous
    FROM "TicketScan" t JOIN "Establishment" e ON e."id" = t."establishmentId"
    WHERE ${entryWhere(scope)}
      AND ${coarse('t."createdAt"', cur, prev)}
      AND (${isCur} OR ${isPrev})
    GROUP BY 1`;
  return rows.map((r) => ({
    establishmentId: String(r.establishmentId),
    current: num(r.current),
    previous: num(r.previous),
  }));
}

export async function entryGrid(
  db: Db,
  scope: AnalyticsScope,
  range: AnalyticsRange,
): Promise<SimpleGridRow[]> {
  if (isEmptyScope(scope, ['PARK'])) return [];
  const rows = await db.$queryRaw<Row[]>`
    SELECT ${dayOf('t."createdAt"')} AS day, ${hourOf('t."createdAt"')} AS hour, COUNT(*) AS count
    FROM "TicketScan" t JOIN "Establishment" e ON e."id" = t."establishmentId"
    WHERE ${entryWhere(scope)}
      AND ${coarse('t."createdAt"', range)}
      AND ${within('t."createdAt"', range)}
    GROUP BY 1, 2`;
  return rows.map((r) => ({ day: String(r.day), hour: num(r.hour), count: num(r.count) }));
}

/** Tentatives refusées par motif (information ; jamais comptées comme entrées). */
export async function refusedScans(db: Db, scope: AnalyticsScope): Promise<Record<string, number>> {
  if (isEmptyScope(scope, ['PARK'])) return {};
  const range = scope.period.current;
  const rows = await db.$queryRaw<Row[]>`
    SELECT COALESCE(t."refusalReason"::text, 'UNKNOWN') AS reason, COUNT(*) AS count
    FROM "TicketScan" t JOIN "Establishment" e ON e."id" = t."establishmentId"
    WHERE t."organizationId" = ${scope.organizationId}::uuid
      AND t."establishmentId" = ANY(${scope.establishmentIds}::uuid[])
      AND t."result" = 'REFUSED'
      AND ${coarse('t."createdAt"', range)}
      AND ${within('t."createdAt"', range)}
    GROUP BY 1`;
  return Object.fromEntries(rows.map((r) => [String(r.reason), num(r.count)]));
}

// ─── Ventes restaurant par produit ───

export interface LineFilters {
  hourFrom?: number;
  hourTo?: number;
  weekday?: number | null;
  productId?: string | null;
}

function lineFilters(f: LineFilters): Prisma.Sql {
  const h = hourOf('p."createdAt"');
  const parts: Prisma.Sql[] = [];
  if (f.hourFrom !== undefined && f.hourFrom > 0) parts.push(Prisma.sql`${h} >= ${f.hourFrom}`);
  if (f.hourTo !== undefined && f.hourTo < 24) parts.push(Prisma.sql`${h} < ${f.hourTo}`);
  if (f.weekday) {
    parts.push(Prisma.sql`EXTRACT(ISODOW FROM ${local('p."createdAt"')})::int = ${f.weekday}`);
  }
  if (f.productId) parts.push(Prisma.sql`pr."id" = ${f.productId}::uuid`);
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

const LINES_JOIN = Prisma.sql`JOIN "SaleLine" l ON l."saleId" = s."id" AND l."variantId" IS NOT NULL
  LEFT JOIN "ProductVariant" v ON v."id" = l."variantId"
  LEFT JOIN "Product" pr ON pr."id" = v."productId"
  LEFT JOIN "ProductCategory" c ON c."id" = pr."categoryId"`;

export interface ProductLineRow {
  productId: string | null;
  product: string;
  category: string;
  /** Heure locale (regroupement par heure) ou établissement (regroupement par établissement). */
  hour: number | null;
  establishmentId: string | null;
  quantity: number;
  revenue: number;
}

/**
 * Lignes vendues et encaissées sur la période courante, par produit (prix des lignes, avant remise
 * fidélité), éventuellement par heure locale d'encaissement ou par établissement.
 */
export async function productLines(
  db: Db,
  scope: AnalyticsScope,
  groupBy: 'product' | 'hour' | 'establishment',
  filters: LineFilters = {},
): Promise<ProductLineRow[]> {
  if (isEmptyScope(scope, ['RESTAURANT'])) return [];
  const range = scope.period.current;
  const extra =
    groupBy === 'hour'
      ? Prisma.sql`${hourOf('p."createdAt"')}`
      : groupBy === 'establishment'
        ? Prisma.sql`s."establishmentId"::text`
        : Prisma.sql`NULL`;
  const rows = await db.$queryRaw<Row[]>`
    SELECT pr."id"::text AS "productId", COALESCE(pr."name", MIN(l."productName")) AS product,
      COALESCE(c."name", '—') AS category, ${extra} AS extra,
      SUM(l."quantity") AS quantity, SUM(l."lineTotal") AS revenue
    ${PAID_FROM}
    ${LINES_JOIN}
    WHERE ${paidWhere(scope, ['RESTAURANT'])}
      AND ${coarse('p."createdAt"', range)}
      AND ${within('p."createdAt"', range)}
      ${lineFilters(filters)}
    GROUP BY pr."id", pr."name", c."name", 4
    ORDER BY revenue DESC, product ASC`;
  return rows.map((r) => ({
    productId: r.productId === null ? null : String(r.productId),
    product: String(r.product),
    category: String(r.category),
    hour: groupBy === 'hour' ? num(r.extra) : null,
    establishmentId: groupBy === 'establishment' ? String(r.extra) : null,
    quantity: num(r.quantity),
    revenue: num(r.revenue),
  }));
}

/** Totaux par heure (commandes distinctes, quantités, CA des lignes) avec les mêmes filtres. */
export async function hourTotals(
  db: Db,
  scope: AnalyticsScope,
  filters: LineFilters,
): Promise<{ hour: number; orders: number; quantity: number; revenue: number }[]> {
  if (isEmptyScope(scope, ['RESTAURANT'])) return [];
  const range = scope.period.current;
  const rows = await db.$queryRaw<Row[]>`
    SELECT ${hourOf('p."createdAt"')} AS hour, COUNT(DISTINCT s."id") AS orders,
      SUM(l."quantity") AS quantity, SUM(l."lineTotal") AS revenue
    ${PAID_FROM}
    ${LINES_JOIN}
    WHERE ${paidWhere(scope, ['RESTAURANT'])}
      AND ${coarse('p."createdAt"', range)}
      AND ${within('p."createdAt"', range)}
      ${lineFilters(filters)}
    GROUP BY 1`;
  return rows.map((r) => ({
    hour: num(r.hour),
    orders: num(r.orders),
    quantity: num(r.quantity),
    revenue: num(r.revenue),
  }));
}

export interface VariantSalesRow {
  establishmentId: string;
  establishment: string;
  variantId: string;
  product: string;
  variant: string;
  category: string;
  quantity: number;
  revenue: number;
}

/** Ventes encaissées par établissement et variante (calcul des marges). */
export async function variantSales(db: Db, scope: AnalyticsScope): Promise<VariantSalesRow[]> {
  if (isEmptyScope(scope, ['RESTAURANT'])) return [];
  const range = scope.period.current;
  const rows = await db.$queryRaw<Row[]>`
    SELECT s."establishmentId"::text AS "establishmentId", e."name" AS establishment,
      l."variantId"::text AS "variantId",
      COALESCE(pr."name", MIN(l."productName")) AS product,
      COALESCE(v."name", MIN(l."variantName")) AS variant,
      COALESCE(c."name", '—') AS category,
      SUM(l."quantity") AS quantity, SUM(l."lineTotal") AS revenue
    ${PAID_FROM}
    ${LINES_JOIN}
    WHERE ${paidWhere(scope, ['RESTAURANT'])}
      AND ${coarse('p."createdAt"', range)}
      AND ${within('p."createdAt"', range)}
    GROUP BY s."establishmentId", e."name", l."variantId", pr."name", v."name", c."name"
    ORDER BY revenue DESC`;
  return rows.map((r) => ({
    establishmentId: String(r.establishmentId),
    establishment: String(r.establishment),
    variantId: String(r.variantId),
    product: String(r.product),
    variant: String(r.variant),
    category: String(r.category),
    quantity: num(r.quantity),
    revenue: num(r.revenue),
  }));
}

// ─── Billetterie ───

export interface TicketCategoryRow {
  categoryId: string;
  category: string;
  soldUnits: number;
  prevSoldUnits: number;
  paidUnits: number;
  prevPaidUnits: number;
  revenue: number;
  issued: number;
  prevIssued: number;
  cancelled: number;
  used: number;
  scanned: number;
  prevScanned: number;
}

/**
 * Billetterie par catégorie, en distinguant :
 * - vendu : unités des ventes parc non annulées créées sur la période (payées ou non) ;
 * - payé : unités des ventes parc encaissées sur la période ;
 * - émis : billets individuels créés sur la période (non annulés) ; utilisés parmi eux ;
 * - scanné : scans acceptés sur la période.
 */
export async function ticketCategories(
  db: Db,
  scope: AnalyticsScope,
): Promise<TicketCategoryRow[]> {
  if (isEmptyScope(scope, ['PARK'])) return [];
  const { current: cur, previous: prev } = scope.period;
  const sold = await db.$queryRaw<Row[]>`
    SELECT l."ticketCategoryId"::text AS id,
      SUM(l."quantity") FILTER (WHERE ${within('s."createdAt"', cur)}) AS cur,
      SUM(l."quantity") FILTER (WHERE ${within('s."createdAt"', prev)}) AS prev
    FROM "Sale" s JOIN "Establishment" e ON e."id" = s."establishmentId"
    JOIN "SaleLine" l ON l."saleId" = s."id" AND l."ticketCategoryId" IS NOT NULL
    WHERE s."status" = 'OPEN' AND ${saleScope(scope, ['PARK'])}
      AND ${coarse('s."createdAt"', cur, prev)}
    GROUP BY 1`;
  const paid = await db.$queryRaw<Row[]>`
    SELECT l."ticketCategoryId"::text AS id,
      SUM(l."quantity") FILTER (WHERE ${within('p."createdAt"', cur)}) AS cur,
      SUM(l."quantity") FILTER (WHERE ${within('p."createdAt"', prev)}) AS prev,
      SUM(l."lineTotal") FILTER (WHERE ${within('p."createdAt"', cur)}) AS revenue
    ${PAID_FROM}
    JOIN "SaleLine" l ON l."saleId" = s."id" AND l."ticketCategoryId" IS NOT NULL
    WHERE ${paidWhere(scope, ['PARK'])}
      AND ${coarse('p."createdAt"', cur, prev)}
    GROUP BY 1`;
  const tickets = await db.$queryRaw<Row[]>`
    SELECT k."ticketCategoryId"::text AS id,
      COUNT(*) FILTER (WHERE ${within('k."createdAt"', cur)} AND k."status" <> 'CANCELLED') AS issued,
      COUNT(*) FILTER (WHERE ${within('k."createdAt"', prev)} AND k."status" <> 'CANCELLED') AS "prevIssued",
      COUNT(*) FILTER (WHERE ${within('k."createdAt"', cur)} AND k."status" = 'CANCELLED') AS cancelled,
      COUNT(*) FILTER (WHERE ${within('k."createdAt"', cur)} AND k."status" = 'USED') AS used
    FROM "Ticket" k JOIN "Establishment" e ON e."id" = k."establishmentId"
    WHERE k."organizationId" = ${scope.organizationId}::uuid
      AND k."establishmentId" = ANY(${scope.establishmentIds}::uuid[])
      AND ${coarse('k."createdAt"', cur, prev)}
    GROUP BY 1`;
  const scans = await db.$queryRaw<Row[]>`
    SELECT k."ticketCategoryId"::text AS id,
      COUNT(*) FILTER (WHERE ${within('t."createdAt"', cur)}) AS cur,
      COUNT(*) FILTER (WHERE ${within('t."createdAt"', prev)}) AS prev
    FROM "TicketScan" t JOIN "Establishment" e ON e."id" = t."establishmentId"
    JOIN "Ticket" k ON k."id" = t."ticketId"
    WHERE ${entryWhere(scope)}
      AND ${coarse('t."createdAt"', cur, prev)}
    GROUP BY 1`;

  const ids = new Set([...sold, ...paid, ...tickets, ...scans].map((r) => String(r.id)));
  const names = await db.ticketCategory.findMany({
    where: { organizationId: scope.organizationId, id: { in: [...ids] } },
    select: { id: true, name: true, sortOrder: true },
  });
  const by = (rows: Row[], id: string) => rows.find((r) => String(r.id) === id) ?? {};
  return names
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((c) => {
      const s = by(sold, c.id);
      const p = by(paid, c.id);
      const t = by(tickets, c.id);
      const k = by(scans, c.id);
      return {
        categoryId: c.id,
        category: c.name,
        soldUnits: num(s.cur),
        prevSoldUnits: num(s.prev),
        paidUnits: num(p.cur),
        prevPaidUnits: num(p.prev),
        revenue: num(p.revenue),
        issued: num(t.issued),
        prevIssued: num(t.prevIssued),
        cancelled: num(t.cancelled),
        used: num(t.used),
        scanned: num(k.cur),
        prevScanned: num(k.prev),
      };
    });
}

// ─── Coûts d'achat ───

export interface CostMovementRow {
  stockItemId: string;
  stockItem: string;
  unit: string;
  currentUnitCost: number | null;
  establishment: string;
  day: string;
  unitCost: number;
}

/** Coûts saisis sur les entrées de stock de la période (évolution des coûts). */
export async function costMovements(db: Db, scope: AnalyticsScope): Promise<CostMovementRow[]> {
  if (isEmptyScope(scope, ['RESTAURANT'])) return [];
  const range = scope.period.current;
  const rows = await db.$queryRaw<Row[]>`
    SELECT m."stockItemId"::text AS "stockItemId", i."name" AS "stockItem", i."unit"::text AS unit,
      i."unitCost" AS "currentUnitCost", e."name" AS establishment,
      ${dayOf('m."createdAt"')} AS day, m."unitCost" AS "unitCost"
    FROM "StockMovement" m
    JOIN "StockItem" i ON i."id" = m."stockItemId"
    JOIN "Establishment" e ON e."id" = m."establishmentId"
    WHERE m."organizationId" = ${scope.organizationId}::uuid
      AND m."establishmentId" = ANY(${scope.establishmentIds}::uuid[])
      AND m."kind" = 'IN' AND m."unitCost" IS NOT NULL
      AND ${coarse('m."createdAt"', range)}
      AND ${within('m."createdAt"', range)}
    ORDER BY i."name", m."createdAt"`;
  return rows.map((r) => ({
    stockItemId: String(r.stockItemId),
    stockItem: String(r.stockItem),
    unit: String(r.unit),
    currentUnitCost: r.currentUnitCost === null ? null : num(r.currentUnitCost),
    establishment: String(r.establishment),
    day: String(r.day),
    unitCost: num(r.unitCost),
  }));
}
