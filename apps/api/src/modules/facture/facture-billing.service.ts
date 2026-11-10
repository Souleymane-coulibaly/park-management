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
   * Indicateurs du mois en cours (UTC, heure du Mali) : facturé net des avoirs, encaissé ; reste à
   * encaisser et retards sur toutes les factures ouvertes ; devis en attente de réponse.
   */
  async dashboard(ctx: FactureContext, now = new Date()) {
    const organizationId = ctx.organizationId;
    const today = todayUtc(now);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const issuedThisMonth = { not: 'DRAFT' as const };
    const month = { gte: monthStart, lt: nextMonth };
    const [invoiced, credited, collected, open, overdue, quotes] = await Promise.all([
      this.db.factureDocument.aggregate({
        where: { organizationId, type: 'INVOICE', status: issuedThisMonth, issueDate: month },
        _sum: { totalHt: true, totalTtc: true },
        _count: true,
      }),
      this.db.factureDocument.aggregate({
        where: { organizationId, type: 'CREDIT_NOTE', status: issuedThisMonth, issueDate: month },
        _sum: { totalHt: true, totalTtc: true },
        _count: true,
      }),
      this.db.facturePayment.aggregate({
        where: { organizationId, cancelledAt: null, paidAt: month },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.$queryRaw<OpenTotals[]>`
        SELECT COUNT(*)::int AS "count",
               COALESCE(SUM("totalTtc" - "amountPaid" - "amountCredited"), 0)::bigint AS "amount",
               (COUNT(*) FILTER (WHERE "dueDate" < ${isoDay(today)}::date))::int AS "overdueCount",
               COALESCE(SUM("totalTtc" - "amountPaid" - "amountCredited")
                 FILTER (WHERE "dueDate" < ${isoDay(today)}::date), 0)::bigint AS "overdueAmount"
        FROM "FactureDocument"
        WHERE "organizationId" = ${organizationId}::uuid AND "type" = 'INVOICE'
          AND "status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID')`,
      this.db.factureDocument.findMany({
        where: {
          organizationId,
          type: 'INVOICE',
          status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] },
          dueDate: { lt: today },
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
        },
        _sum: { totalTtc: true },
        _count: true,
      }),
    ]);
    const totals = open[0] ?? { count: 0, amount: 0n, overdueCount: 0, overdueAmount: 0n };
    const n = (v: bigint | null | undefined) => Number(v ?? 0n);
    return {
      month: isoDay(monthStart).slice(0, 7),
      invoiced: {
        count: invoiced._count,
        creditNotes: credited._count,
        // Chiffre d'affaires du mois : factures émises moins avoirs émis.
        netHt: n(invoiced._sum.totalHt) - n(credited._sum.totalHt),
        netTtc: n(invoiced._sum.totalTtc) - n(credited._sum.totalTtc),
      },
      collected: { count: collected._count, amount: n(collected._sum.amount) },
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
      where: { organizationId: ctx.organizationId, paidAt: { gte: from, lte: to } },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      take: MAX_EXPORT_ROWS + 1,
      include: { invoice: { select: { number: true, clientSnapshot: true } } },
    });
    this.assertRows(rows.length);
    const table: CsvValue[][] = [
      ['Date', 'Facture', 'Client', 'Montant', 'Mode', 'Référence', 'Statut', 'Motif d’annulation'],
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
      metadata: { from: query.from, to: query.to, rows },
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
