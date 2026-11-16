import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/facture-database';
import {
  FACTURE_DOCUMENT_STATUS_LABELS,
  FACTURE_DOCUMENT_TYPE_LABELS,
  FACTURE_PAYMENT_METHOD_LABELS,
  type FactureVatBucket,
  canRecordFacturePayment,
  factureBalance,
  factureInvoiceStatus,
  formatXof,
  localMoment,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type CsvValue, toCsv } from '../../common/csv';
import type { FactureContext } from './facture-access';
import type { FactureClientIdentity } from './facture-document-pdf';
import { FactureDocumentsService, invoiceAmounts, todayUtc } from './facture-documents.service';
import { FacturePrismaService } from './facture-prisma.service';
import type { FactureExportQueryDto, RecordFacturePaymentDto } from './facture-commercial.dto';

const DAY = 86_400_000;
/** Période d'un export : un an au plus. */
const MAX_EXPORT_DAYS = 366;
/** Lignes d'un export : au-delà, réduire la période. */
const MAX_EXPORT_ROWS = 50_000;
const OVERDUE_LIST = 10;

const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ code, message, ...extra });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Filtre par établissement émetteur : `ids` (null = tous ceux rattachés), `unassigned` = documents sans
 * établissement. Absent : aucun filtre (toute l'organisation).
 */
export interface FactureEstablishmentFilter {
  ids: string[] | null;
  unassigned: boolean;
}

/** Paramètre `establishmentId` d'un rapport (UUID ou « none ») ; absent : aucun filtre. */
export function factureEstablishmentFilter(value?: string): FactureEstablishmentFilter | undefined {
  if (!value) return undefined;
  return value.toLowerCase() === 'none'
    ? { ids: [], unassigned: true }
    : { ids: [value.toLowerCase()], unassigned: false };
}

/** Nom de l'établissement émetteur figé à l'émission (identité du vendeur), sinon vide. */
const establishmentNameOf = (sellerSnapshot: unknown): string | null =>
  (sellerSnapshot as { establishment?: { name?: string } } | null)?.establishment?.name ?? null;

function establishmentWhere(filter?: FactureEstablishmentFilter): Prisma.FactureDocumentWhereInput {
  if (!filter || (filter.ids === null && filter.unassigned)) return {};
  const or: Prisma.FactureDocumentWhereInput[] = [];
  if (filter.ids === null) or.push({ establishmentId: { not: null } });
  else if (filter.ids.length) or.push({ establishmentId: { in: filter.ids } });
  if (filter.unassigned) or.push({ establishmentId: null });
  return or.length ? { OR: or } : { id: { in: [] } };
}

function establishmentSql(filter?: FactureEstablishmentFilter, alias?: string): Prisma.Sql {
  if (!filter || (filter.ids === null && filter.unassigned)) return Prisma.empty;
  const col = Prisma.raw(alias ? `${alias}."establishmentId"` : '"establishmentId"');
  const parts: Prisma.Sql[] = [];
  if (filter.ids === null) parts.push(Prisma.sql`${col} IS NOT NULL`);
  else if (filter.ids.length) parts.push(Prisma.sql`${col} = ANY(${filter.ids}::uuid[])`);
  if (filter.unassigned) parts.push(Prisma.sql`${col} IS NULL`);
  if (!parts.length) return Prisma.sql`AND false`;
  return Prisma.sql`AND (${Prisma.join(parts, ' OR ')})`;
}

/**
 * Période du tableau de bord : jours inclus `from`..`to` (un an au plus), sinon le mois en cours entier.
 * `month` (AAAA-MM) seulement pour le mois en cours par défaut.
 */
export function factureDashboardRange(
  today: Date,
  from?: string,
  to?: string,
): { from: Date; to: Date; month: string | null } {
  if (!from && !to) {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { from: first, to: last, month: isoDay(first).slice(0, 7) };
  }
  if (!from || !to) {
    throw new BadRequestException({
      code: 'PERIOD_MISSING_DATES',
      message: 'Indiquez la date de début et la date de fin.',
    });
  }
  const start = dayOf(from);
  const end = dayOf(to);
  const valid = (d: Date, iso: string) => !Number.isNaN(d.getTime()) && isoDay(d) === iso;
  if (!valid(start, from) || !valid(end, to)) {
    throw new BadRequestException({ code: 'PERIOD_INVALID_DATE', message: 'Date invalide.' });
  }
  if (end < start) {
    throw new BadRequestException({
      code: 'PERIOD_RANGE_INVERTED',
      message: 'La date de fin précède la date de début.',
    });
  }
  if ((end.getTime() - start.getTime()) / DAY + 1 > MAX_EXPORT_DAYS) {
    throw new BadRequestException({
      code: 'PERIOD_RANGE_TOO_LONG',
      message: `La période ne peut pas dépasser ${MAX_EXPORT_DAYS} jours.`,
    });
  }
  return { from: start, to: end, month: null };
}

interface OpenTotals {
  count: number;
  amount: bigint;
  overdueCount: number;
  overdueAmount: bigint;
}

/**
 * Facturation d'Ocall Facture (F2) : encaissements (partiels, annulables avec motif, jamais modifiés),
 * tableau de bord (facturé, encaissé, reste à encaisser, retards) et exports CSV (journal des ventes,
 * journal des encaissements). Montants et statuts recalculés sous verrou de la facture.
 */
@Injectable()
export class FactureBillingService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly documents: FactureDocumentsService,
    private readonly audit: AuditService,
  ) {}

  // ─── Encaissements ───

  /**
   * Encaissement d'une facture émise, sous verrou de la facture : jamais au-delà du reste dû (deux
   * saisies simultanées ne peuvent pas le dépasser), date au plus tard aujourd'hui. Le statut de la
   * facture est recalculé (payée en partie, soldée).
   */
  async recordPayment(
    ctx: FactureContext,
    invoiceId: string,
    dto: RecordFacturePaymentDto,
    now = new Date(),
  ) {
    const paidAt = dayOf(dto.paidAt);
    if (paidAt.getTime() > todayUtc(now).getTime()) {
      throw new BadRequestException({
        code: 'FACTURE_PAYMENT_DATE_FUTURE',
        message: 'La date de l’encaissement ne peut pas être dans le futur.',
      });
    }
    const paymentId = await this.db.$transaction(async (tx) => {
      const invoice = await this.documents.lock(tx, ctx.organizationId, invoiceId);
      const amounts = invoiceAmounts(invoice);
      if (!canRecordFacturePayment({ ...invoice, ...amounts })) {
        throw conflict(
          'FACTURE_PAYMENT_NOT_ALLOWED',
          invoice.type === 'INVOICE' && invoice.status !== 'DRAFT'
            ? 'Cette facture n’a plus rien à encaisser.'
            : 'Un encaissement s’enregistre sur une facture émise.',
        );
      }
      const balance = factureBalance(amounts);
      if (dto.amount > balance) {
        throw conflict(
          'FACTURE_PAYMENT_EXCEEDS_BALANCE',
          `Le montant dépasse le reste à payer (${formatXof(balance)}).`,
          { details: { balance } },
        );
      }
      const payment = await tx.facturePayment.create({
        data: {
          organizationId: ctx.organizationId,
          invoiceId,
          amount: BigInt(dto.amount),
          method: dto.method,
          paidAt,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      await this.settle(tx, invoice, { ...amounts, amountPaid: amounts.amountPaid + dto.amount });
      return payment.id;
    });
    await this.documents.record(ctx, 'facture.payment_recorded', invoiceId, {
      payment: paymentId,
      amount: dto.amount,
      method: dto.method,
    });
    return this.documents.get(ctx, invoiceId);
  }

  /** Annulation d'un encaissement saisi par erreur : motif conservé, reste dû et statut recalculés. */
  async cancelPayment(ctx: FactureContext, invoiceId: string, paymentId: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      const invoice = await this.documents.lock(tx, ctx.organizationId, invoiceId);
      const payment = await tx.facturePayment.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: paymentId } },
      });
      if (!payment || payment.invoiceId !== invoiceId) {
        throw new NotFoundException({
          code: 'FACTURE_PAYMENT_NOT_FOUND',
          message: 'Encaissement introuvable.',
        });
      }
      if (payment.cancelledAt) {
        throw conflict('FACTURE_PAYMENT_CANCELLED', 'Cet encaissement est déjà annulé.');
      }
      await tx.facturePayment.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: paymentId } },
        data: { cancelledAt: new Date(), cancelledByUserId: ctx.userId, cancelReason: reason },
      });
      const amounts = invoiceAmounts(invoice);
      await this.settle(tx, invoice, {
        ...amounts,
        amountPaid: amounts.amountPaid - Number(payment.amount),
      });
    });
    await this.documents.record(ctx, 'facture.payment_cancelled', invoiceId, {
      payment: paymentId,
    });
    return this.documents.get(ctx, invoiceId);
  }

  private async settle(
    tx: Prisma.TransactionClient,
    invoice: { organizationId: string; id: string; sentAt: Date | null },
    next: ReturnType<typeof invoiceAmounts>,
  ) {
    await tx.factureDocument.update({
      where: { organizationId_id: { organizationId: invoice.organizationId, id: invoice.id } },
      data: {
        amountPaid: BigInt(next.amountPaid),
        status: factureInvoiceStatus({ ...next, sent: invoice.sentAt !== null }),
      },
    });
  }

  // ─── Tableau de bord ───

  /**
   * Indicateurs d'une période (par défaut le mois en cours, dans le fuseau de l'organisation ; jours
   * d'émission et de règlement inclus) : facturé net des avoirs, encaissé — deux montants distincts, un
   * encaissement n'est pas un montant facturé ; reste à encaisser et retards sur toutes les factures
   * ouvertes ; devis en attente. Les factures de ventes en caisse Ocall Stock sont isolées
   * (`fromStockSales`) : déjà comptées comme ventes dans Stock, elles ne doivent pas l'être deux fois.
   * Filtre facultatif par établissement émetteur (`ids`) et/ou documents sans établissement
   * (`unassigned`) ; sans filtre, toute l'organisation.
   */
  async dashboard(
    ctx: FactureContext,
    options: {
      from?: string;
      to?: string;
      timezone?: string;
      establishments?: FactureEstablishmentFilter;
    } = {},
    now = new Date(),
  ) {
    const organizationId = ctx.organizationId;
    const today = options.timezone ? dayOf(localMoment(now, options.timezone).date) : todayUtc(now);
    const range = factureDashboardRange(today, options.from, options.to);
    const scope = establishmentWhere(options.establishments);
    const scopeSql = establishmentSql(options.establishments);
    const issued = { not: 'DRAFT' as const };
    const days = { gte: range.from, lte: range.to };
    const fromStock = { stockSaleId: { not: null } };
    const creditOfStock = { creditedInvoice: { stockSaleId: { not: null } } };
    const [
      invoiced,
      credited,
      collected,
      stockInvoiced,
      stockCredited,
      stockCollected,
      open,
      overdue,
      quotes,
    ] = await Promise.all([
      this.db.factureDocument.aggregate({
        where: { organizationId, type: 'INVOICE', status: issued, issueDate: days, ...scope },
        _sum: { totalHt: true, totalTtc: true },
        _count: true,
      }),
      this.db.factureDocument.aggregate({
        where: { organizationId, type: 'CREDIT_NOTE', status: issued, issueDate: days, ...scope },
        _sum: { totalHt: true, totalTtc: true },
        _count: true,
      }),
      this.db.facturePayment.aggregate({
        where: { organizationId, cancelledAt: null, paidAt: days, invoice: scope },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.factureDocument.aggregate({
        where: {
          organizationId,
          type: 'INVOICE',
          status: issued,
          issueDate: days,
          AND: [scope, fromStock],
        },
        _sum: { totalHt: true, totalTtc: true },
        _count: true,
      }),
      this.db.factureDocument.aggregate({
        where: {
          organizationId,
          type: 'CREDIT_NOTE',
          status: issued,
          issueDate: days,
          AND: [scope, creditOfStock],
        },
        _sum: { totalHt: true, totalTtc: true },
      }),
      this.db.facturePayment.aggregate({
        where: {
          organizationId,
          cancelledAt: null,
          paidAt: days,
          invoice: { AND: [scope, fromStock] },
        },
        _sum: { amount: true },
      }),
      this.db.$queryRaw<OpenTotals[]>`
        SELECT COUNT(*)::int AS "count",
               COALESCE(SUM("totalTtc" - "amountPaid" - "amountCredited"), 0)::bigint AS "amount",
               (COUNT(*) FILTER (WHERE "dueDate" < ${isoDay(today)}::date))::int AS "overdueCount",
               COALESCE(SUM("totalTtc" - "amountPaid" - "amountCredited")
                 FILTER (WHERE "dueDate" < ${isoDay(today)}::date), 0)::bigint AS "overdueAmount"
        FROM "FactureDocument"
        WHERE "organizationId" = ${organizationId}::uuid AND "type" = 'INVOICE'
          AND "status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID') ${scopeSql}`,
      this.db.factureDocument.findMany({
        where: {
          organizationId,
          type: 'INVOICE',
          status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] },
          dueDate: { lt: today },
          ...scope,
        },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
        take: OVERDUE_LIST,
        select: {
          id: true,
          number: true,
          dueDate: true,
          totalTtc: true,
          amountPaid: true,
          amountCredited: true,
          reminderCount: true,
          clientSnapshot: true,
        },
      }),
      this.db.factureDocument.aggregate({
        where: {
          organizationId,
          type: 'QUOTE',
          status: { in: ['ISSUED', 'SENT'] },
          validUntil: { gte: today },
          ...scope,
        },
        _sum: { totalTtc: true },
        _count: true,
      }),
    ]);
    const totals = open[0] ?? { count: 0, amount: 0n, overdueCount: 0, overdueAmount: 0n };
    const n = (v: bigint | null | undefined) => Number(v ?? 0n);
    return {
      month: range.month,
      period: { from: isoDay(range.from), to: isoDay(range.to) },
      invoiced: {
        count: invoiced._count,
        creditNotes: credited._count,
        // Chiffre d'affaires facturé : factures émises moins avoirs émis.
        netHt: n(invoiced._sum.totalHt) - n(credited._sum.totalHt),
        netTtc: n(invoiced._sum.totalTtc) - n(credited._sum.totalTtc),
        // Dont factures de ventes en caisse Ocall Stock (et leurs avoirs).
        fromStockSales: {
          count: stockInvoiced._count,
          netHt: n(stockInvoiced._sum.totalHt) - n(stockCredited._sum.totalHt),
          netTtc: n(stockInvoiced._sum.totalTtc) - n(stockCredited._sum.totalTtc),
        },
      },
      collected: {
        count: collected._count,
        amount: n(collected._sum.amount),
        // Dont règlements de factures de ventes Stock.
        fromStockSales: n(stockCollected._sum.amount),
      },
      outstanding: { count: totals.count, amount: n(totals.amount) },
      overdue: {
        count: totals.overdueCount,
        amount: n(totals.overdueAmount),
        invoices: overdue.map((d) => ({
          id: d.id,
          number: d.number,
          dueDate: d.dueDate,
          client: (d.clientSnapshot as unknown as FactureClientIdentity | null)?.name ?? null,
          balance: factureBalance(invoiceAmounts(d)),
          reminderCount: d.reminderCount,
        })),
      },
      quotes: { count: quotes._count, amountTtc: n(quotes._sum.totalTtc) },
    };
  }

  /**
   * Facturé net des avoirs (TTC) et encaissé, par établissement émetteur (null = sans établissement),
   * sur une période de jours inclus ; même filtre que le tableau de bord.
   */
  async byEstablishment(
    ctx: FactureContext,
    range: { from: string; to: string },
    establishments?: FactureEstablishmentFilter,
  ): Promise<{ establishmentId: string | null; invoicedTtc: number; collected: number }[]> {
    const org = ctx.organizationId;
    const scopeSql = establishmentSql(establishments, 'd');
    const [invoiced, collected] = await Promise.all([
      this.db.$queryRaw<{ establishmentId: string | null; amount: bigint }[]>`
        SELECT d."establishmentId",
               COALESCE(SUM(CASE WHEN d."type" = 'CREDIT_NOTE' THEN -d."totalTtc" ELSE d."totalTtc" END), 0)::bigint AS "amount"
        FROM "FactureDocument" d
        WHERE d."organizationId" = ${org}::uuid AND d."type" IN ('INVOICE', 'CREDIT_NOTE')
          AND d."status" <> 'DRAFT'
          AND d."issueDate" >= ${range.from}::date AND d."issueDate" <= ${range.to}::date ${scopeSql}
        GROUP BY d."establishmentId"`,
      this.db.$queryRaw<{ establishmentId: string | null; amount: bigint }[]>`
        SELECT d."establishmentId", COALESCE(SUM(p."amount"), 0)::bigint AS "amount"
        FROM "FacturePayment" p
        JOIN "FactureDocument" d ON d."organizationId" = p."organizationId" AND d."id" = p."invoiceId"
        WHERE p."organizationId" = ${org}::uuid AND p."cancelledAt" IS NULL
          AND p."paidAt" >= ${range.from}::date AND p."paidAt" <= ${range.to}::date ${scopeSql}
        GROUP BY d."establishmentId"`,
    ]);
    const rows = new Map<string | null, { invoicedTtc: number; collected: number }>();
    const row = (id: string | null) => {
      const r = rows.get(id) ?? { invoicedTtc: 0, collected: 0 };
      rows.set(id, r);
      return r;
    };
    for (const r of invoiced) row(r.establishmentId).invoicedTtc += Number(r.amount);
    for (const r of collected) row(r.establishmentId).collected += Number(r.amount);
    return [...rows].map(([establishmentId, v]) => ({ establishmentId, ...v }));
  }

  // ─── Exports ───

  /**
   * Journal des ventes de la période (dates d'émission incluses) : factures et avoirs émis, avoirs en
   * négatif, ventilation de la TVA par taux. CSV pour Excel en français (« ; », UTF-8 avec BOM), cellules
   * neutralisées contre l'injection de formules.
   */
  async salesJournal(ctx: FactureContext, query: FactureExportQueryDto) {
    const { from, to } = this.period(query);
    const rows = await this.db.factureDocument.findMany({
      where: {
        organizationId: ctx.organizationId,
        type: { in: ['INVOICE', 'CREDIT_NOTE'] },
        status: { not: 'DRAFT' },
        issueDate: { gte: from, lte: to },
        ...establishmentWhere(factureEstablishmentFilter(query.establishmentId)),
      },
      orderBy: [{ issueDate: 'asc' }, { type: 'asc' }, { sequence: 'asc' }],
      take: MAX_EXPORT_ROWS + 1,
      select: {
        type: true,
        status: true,
        number: true,
        issueDate: true,
        dueDate: true,
        totalHt: true,
        totalVat: true,
        totalTtc: true,
        amountPaid: true,
        amountCredited: true,
        vatBreakdown: true,
        clientSnapshot: true,
        sellerSnapshot: true,
        creditedInvoice: { select: { number: true } },
      },
    });
    this.assertRows(rows.length);
    const table: CsvValue[][] = [
      [
        'Date',
        'Type',
        'Numéro',
        'Facture corrigée',
        'Client',
        'NIF client',
        'Total HT',
        'TVA',
        'Total TTC',
        'Détail TVA',
        'Échéance',
        'Reste à payer',
        'Statut',
        'Établissement',
      ],
    ];
    for (const r of rows) {
      const sign = r.type === 'CREDIT_NOTE' ? -1 : 1;
      const client = r.clientSnapshot as unknown as FactureClientIdentity | null;
      const vat = r.vatBreakdown as unknown as FactureVatBucket[];
      table.push([
        isoDay(r.issueDate!),
        FACTURE_DOCUMENT_TYPE_LABELS[r.type],
        r.number,
        r.creditedInvoice?.number ?? null,
        client?.name ?? null,
        client?.nif ?? null,
        sign * Number(r.totalHt),
        sign * Number(r.totalVat),
        sign * Number(r.totalTtc),
        vat.map((b) => `${b.rate} % : ${sign * b.amount}`).join(' | '),
        r.dueDate ? isoDay(r.dueDate) : null,
        r.type === 'INVOICE' ? factureBalance(invoiceAmounts(r)) : null,
        FACTURE_DOCUMENT_STATUS_LABELS[r.status],
        establishmentNameOf(r.sellerSnapshot),
      ]);
    }
    await this.exported(ctx, 'sales', query, rows.length);
    return {
      body: Buffer.from(toCsv(table), 'utf8'),
      filename: `journal-ventes-${query.from}-${query.to}.csv`,
    };
  }

  /** Journal des encaissements de la période (dates d'encaissement incluses), annulations comprises. */
  async paymentsJournal(ctx: FactureContext, query: FactureExportQueryDto) {
    const { from, to } = this.period(query);
    const rows = await this.db.facturePayment.findMany({
      where: {
        organizationId: ctx.organizationId,
        paidAt: { gte: from, lte: to },
        invoice: establishmentWhere(factureEstablishmentFilter(query.establishmentId)),
      },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      take: MAX_EXPORT_ROWS + 1,
      include: {
        invoice: { select: { number: true, clientSnapshot: true, sellerSnapshot: true } },
      },
    });
    this.assertRows(rows.length);
    const table: CsvValue[][] = [
      [
        'Date',
        'Facture',
        'Client',
        'Montant',
        'Mode',
        'Référence',
        'Statut',
        'Motif d’annulation',
        'Établissement',
      ],
    ];
    for (const p of rows) {
      const client = p.invoice.clientSnapshot as unknown as FactureClientIdentity | null;
      table.push([
        isoDay(p.paidAt),
        p.invoice.number,
        client?.name ?? null,
        Number(p.amount),
        FACTURE_PAYMENT_METHOD_LABELS[p.method],
        p.reference,
        p.cancelledAt ? 'Annulé' : 'En vigueur',
        p.cancelReason,
        establishmentNameOf(p.invoice.sellerSnapshot),
      ]);
    }
    await this.exported(ctx, 'payments', query, rows.length);
    return {
      body: Buffer.from(toCsv(table), 'utf8'),
      filename: `journal-encaissements-${query.from}-${query.to}.csv`,
    };
  }

  private exported(
    ctx: FactureContext,
    journal: 'sales' | 'payments',
    query: FactureExportQueryDto,
    rows: number,
  ) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: `facture.${journal}_exported`,
      targetType: 'FactureExport',
      targetId: ctx.organizationId,
      metadata: {
        from: query.from,
        to: query.to,
        rows,
        ...(query.establishmentId ? { establishmentId: query.establishmentId } : {}),
      },
    });
  }

  private period(query: FactureExportQueryDto) {
    const from = dayOf(query.from);
    const to = dayOf(query.to);
    const days = (to.getTime() - from.getTime()) / DAY + 1;
    if (days < 1 || days > MAX_EXPORT_DAYS) {
      throw new BadRequestException({
        code: 'FACTURE_EXPORT_PERIOD',
        message: 'Période invalide : du premier au dernier jour, un an au plus.',
      });
    }
    return { from, to };
  }

  private assertRows(count: number) {
    if (count > MAX_EXPORT_ROWS) {
      throw new BadRequestException({
        code: 'FACTURE_EXPORT_TOO_LARGE',
        message: 'Trop de lignes pour un seul export : réduisez la période.',
      });
    }
  }
}
