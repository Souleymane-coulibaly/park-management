import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@ocall/school-database';
import {
  SCHOOL_PAYMENT_METHOD_LABELS,
  type SchoolLocale,
  allocateOldestFirst,
  chargeBalance,
  chargeDue,
  chargeStatus,
  paymentReferenceRequired,
  paymentVerification,
  receiptNumber,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import type {
  CreatePaymentDto,
  FinanceExportQueryDto,
  PaymentQueryDto,
  ReportQueryDto,
} from './school-finance.dto';
import { zonedDayRange, zonedMonth } from './school-dates';
import { SchoolFinanceService } from './school-finance.service';
import { SchoolImportsService } from './school-imports.service';
import { SchoolPrismaService } from './school-prisma.service';
import { type ReceiptView, renderReceipt } from './school-receipt.pdf';
import type { TableExport } from './school-spreadsheet';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const day = (d: Date) => d.toISOString().slice(0, 10);
/** Fenêtre d'alerte des encaissements semblables (même élève, montant et moyen). */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
/** Tolérance d'horloge pour la date d'un paiement saisie par l'écran. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 100;

const STUDENT_NAMES = {
  id: true,
  matricule: true,
  lastName: true,
  firstName: true,
  lastNameAr: true,
  firstNameAr: true,
} as const;

/**
 * Encaissements (Sprint 5) : caisse, annulation par contrepassation, historique, reçus PDF, tableau de
 * bord, impayés et exports. Un encaissement confirmé n'est jamais modifié ni supprimé : une erreur se
 * corrige par une annulation motivée puis une nouvelle opération. Atomicité : encaissement, affectations
 * et soldes des échéances s'écrivent dans une seule transaction, sous le verrou exclusif de l'élève
 * (deux caisses simultanées pour le même élève se suivent), puis des échéances visées.
 */
@Injectable()
export class SchoolPaymentsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
    private readonly finance: SchoolFinanceService,
    private readonly exports: SchoolImportsService,
  ) {}

  /**
   * Encaissement. Protections contre les doublons : clé d'idempotence par formulaire (une soumission
   * répétée renvoie le même encaissement), référence de transaction unique par moyen tant qu'elle est
   * confirmée (index de la base), alerte sur un encaissement semblable de moins de deux minutes.
   */
  async collect(ctx: SchoolContext, dto: CreatePaymentDto) {
    const year = await this.school.findYear(ctx, dto.schoolYearId);
    await this.finance.assertCanCollect(ctx, year.schoolId);
    if (paymentReferenceRequired(dto.method) && !dto.reference) {
      throw new BadRequestException({
        code: 'REFERENCE_REQUIRED',
        message: 'La référence de transaction est obligatoire pour ce moyen de paiement.',
      });
    }
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException({
        code: 'PAID_AT_FUTURE',
        message: 'La date du paiement ne peut pas être dans le futur.',
      });
    }
    const replay = await this.byIdempotencyKey(ctx, dto);
    if (replay) {
      await this.school.publishDecisions(ctx.organizationId);
      return { ...replay, replayed: true };
    }
    let id: string;
    try {
      id = await this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [year.schoolId]);
        // Droit de caisse relu sous le verrou de l'établissement : une autorisation retirée entre-temps
        // (changement de réglages, exclusif) n'est jamais utilisée.
        await this.finance.assertCanCollect(ctx, year.schoolId, tx);
        await this.finance.lockStudent(tx, ctx, year.schoolId, dto.studentId);
        const again = await this.byIdempotencyKey(ctx, dto, tx);
        if (again) return again.id;
        if (!dto.confirmDuplicate) await this.assertNotDuplicate(tx, ctx, dto);
        const settings = await this.finance.settingsOf(tx, year.schoolId);
        await tx.$queryRaw`
          SELECT id FROM "SchoolCharge"
          WHERE "organizationId" = ${ctx.organizationId}::uuid AND "studentId" = ${dto.studentId}::uuid
            AND "schoolYearId" = ${year.id}::uuid
          ORDER BY id FOR UPDATE`;
        const charges = await tx.schoolCharge.findMany({
          where: {
            organizationId: ctx.organizationId,
            studentId: dto.studentId,
            schoolYearId: year.id,
          },
        });
        const allocations = this.allocations(dto, charges);
        if (charges.some((c) => c.currency !== settings.currency)) {
          throw new ConflictException({
            code: 'CURRENCY_MISMATCH',
            message: 'Des échéances sont dans une autre devise que celle de l’établissement.',
          });
        }
        const sequence = await this.nextReceipt(tx, ctx, year.schoolId, paidAt);
        const totalBalance = charges.reduce((s, c) => s + chargeBalance(c), 0);
        const payment = await tx.schoolPayment.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: year.schoolId,
            schoolYearId: year.id,
            studentId: dto.studentId,
            amount: dto.amount,
            currency: settings.currency,
            method: dto.method,
            reference: dto.reference ?? null,
            verification: paymentVerification(dto.method),
            paidAt,
            receivedByUserId: ctx.userId,
            idempotencyKey: dto.idempotencyKey,
            requestFingerprint: fingerprint(dto),
            receiptNumber: receiptNumber(settings.receiptPrefix, paidAt.getUTCFullYear(), sequence),
            balanceAfter: totalBalance - dto.amount,
            classLabel: await this.classLabel(tx, ctx, dto.studentId, year.id),
            receiptSnapshot: (await this.receiptIdentity(
              tx,
              year.schoolId,
              year.id,
              dto.studentId,
            )) as unknown as Prisma.InputJsonObject,
            note: dto.note ?? null,
            allocations: {
              create: allocations.map((a) => ({
                chargeId: a.chargeId,
                amount: a.amount,
              })),
            },
          },
          select: { id: true },
        });
        for (const a of allocations) {
          await tx.schoolCharge.update({
            where: { id: a.chargeId },
            data: { paid: { increment: a.amount } },
          });
        }
        await this.school.recordDecision(
          tx,
          ctx,
          'school.payment_recorded',
          'SchoolPayment',
          payment.id,
          {
            studentId: dto.studentId,
            method: dto.method,
          },
        );
        return payment.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Soumission concurrente de la même clé : l'encaissement existe, il est renvoyé tel quel.
        const raced = await this.byIdempotencyKey(ctx, dto);
        if (raced) return { ...raced, replayed: true };
        throw new ConflictException({
          code: 'DUPLICATE_REFERENCE',
          message: 'Cette référence de transaction est déjà encaissée pour ce moyen de paiement.',
        });
      }
      throw error;
    }
    await this.school.publishDecisions(ctx.organizationId);
    return { ...(await this.paymentView(ctx, id)), replayed: false };
  }

  /**
   * Annulation motivée par la direction : contrepassation (écriture négative sur les mêmes échéances),
   * encaissement initial conservé au statut annulé avec son reçu. Jamais de suppression.
   */
  async cancel(ctx: SchoolContext, id: string, reason: string) {
    const found = await this.findPayment(ctx, id);
    if (found.kind !== 'PAYMENT') {
      throw new ConflictException({
        code: 'NOT_A_PAYMENT',
        message: 'Une contrepassation ne s’annule pas.',
      });
    }
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [found.schoolId]);
      // Élève verrouillé quel que soit son établissement actuel : un encaissement de l'établissement A
      // reste annulable après un transfert, par qui couvre A (contrôlé par findPayment).
      await this.finance.lockStudentById(tx, ctx, found.studentId);
      await tx.$queryRaw`SELECT id FROM "SchoolPayment" WHERE id = ${id}::uuid FOR UPDATE`;
      const payment = await tx.schoolPayment.findUniqueOrThrow({
        where: { id },
        include: { allocations: true },
      });
      if (payment.status !== 'CONFIRMED') {
        throw new ConflictException({
          code: 'PAYMENT_CANCELLED',
          message: 'Cet encaissement est déjà annulé.',
        });
      }
      const chargeIds = payment.allocations.map((a) => a.chargeId).sort();
      await tx.$queryRaw`SELECT id FROM "SchoolCharge" WHERE id = ANY(${chargeIds}::uuid[]) ORDER BY id FOR UPDATE`;
      for (const a of payment.allocations) {
        await tx.schoolCharge.update({
          where: { id: a.chargeId },
          data: { paid: { decrement: a.amount } },
        });
      }
      await tx.schoolPayment.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: payment.schoolId,
          schoolYearId: payment.schoolYearId,
          studentId: payment.studentId,
          kind: 'REVERSAL',
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          reference: payment.reference,
          verification: payment.verification,
          paidAt: new Date(),
          receivedByUserId: ctx.userId,
          reversalOfId: payment.id,
          note: reason,
          allocations: {
            create: payment.allocations.map((a) => ({
              chargeId: a.chargeId,
              amount: -a.amount,
            })),
          },
        },
      });
      await tx.schoolPayment.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: ctx.userId,
          cancelReason: reason,
        },
      });
      await this.school.recordDecision(tx, ctx, 'school.payment_cancelled', 'SchoolPayment', id, {
        studentId: payment.studentId,
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.paymentView(ctx, id);
  }

  /**
   * Historique des encaissements, par pages de `PAGE_SIZE` dans un ordre total (date, création,
   * identifiant) ; `cursor` : dernier encaissement de la page précédente. `receipts` : seulement ceux
   * qui portent un reçu, filtrés par la base avant la pagination.
   */
  async list(ctx: SchoolContext, q: PaymentQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    const paidAt = zonedDayRange(q.from, q.to, await this.finance.timezoneOf(q.schoolId));
    const rows = await this.db.schoolPayment.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: q.schoolId,
        ...(q.receipts ? { kind: 'PAYMENT', receiptNumber: { not: null } } : {}),
        ...(q.schoolYearId ? { schoolYearId: q.schoolYearId } : {}),
        ...(q.studentId ? { studentId: q.studentId } : {}),
        ...(q.method ? { method: q.method } : {}),
        ...(paidAt ? { paidAt } : {}),
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      take: PAGE_SIZE + 1,
      include: { student: { select: STUDENT_NAMES } },
    });
    const items = rows.slice(0, PAGE_SIZE).map(({ idempotencyKey: _key, ...p }) => p);
    return { items, nextCursor: rows.length > PAGE_SIZE ? items[items.length - 1]!.id : null };
  }

  async paymentView(ctx: SchoolContext, id: string) {
    await this.findPayment(ctx, id);
    const payment = await this.db.schoolPayment.findUniqueOrThrow({
      where: { id },
      include: {
        student: { select: STUDENT_NAMES },
        allocations: {
          orderBy: [{ charge: { dueOn: 'asc' } }, { charge: { position: 'asc' } }, { id: 'asc' }],
          include: {
            charge: {
              select: { id: true, label: true, labelAr: true, category: true, dueOn: true },
            },
          },
        },
        reversal: { select: { id: true, paidAt: true, receivedByUserId: true } },
      },
    });
    const { idempotencyKey: _key, ...view } = payment;
    return view;
  }

  /** Reçu PDF, produit à la demande derrière la garde et la permission : aucune adresse directe. */
  async receipt(ctx: SchoolContext, id: string): Promise<{ file: Buffer; filename: string }> {
    const found = await this.findPayment(ctx, id);
    if (found.kind !== 'PAYMENT' || !found.receiptNumber) throw new NotFoundException(NOT_FOUND);
    // Une seule lecture : identité figée à l'encaissement, lignes figées, statut d'annulation courant.
    const p = await this.db.schoolPayment.findUniqueOrThrow({
      where: { id },
      include: {
        allocations: {
          orderBy: [{ charge: { dueOn: 'asc' } }, { charge: { position: 'asc' } }, { id: 'asc' }],
          include: { charge: { select: { label: true, labelAr: true, category: true } } },
        },
      },
    });
    const identity = p.receiptSnapshot as unknown as ReceiptIdentity;
    const view: ReceiptView = {
      ...identity,
      receiptNumber: p.receiptNumber!,
      paidAt: p.paidAt.toISOString(),
      classLabel: p.classLabel,
      lines: p.allocations.map((a) => ({
        label: a.charge.label,
        labelAr: a.charge.labelAr,
        category: a.charge.category,
        amount: a.amount,
      })),
      amount: p.amount,
      currency: p.currency as ReceiptView['currency'],
      method: p.method,
      reference: p.reference,
      verification: p.verification,
      balanceAfter: p.balanceAfter,
      cancelled: p.status === 'CANCELLED' ? { at: p.cancelledAt!.toISOString() } : null,
    };
    const file = await renderReceipt(view);
    await this.school.log(ctx, 'school.receipt_generated', 'SchoolPayment', id, {});
    return { file, filename: `recu-${view.receiptNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf` };
  }

  // ─── Tableau de bord et impayés ───

  /**
   * Indicateurs d'une année : attendu (dû après réductions et ajustements), encaissé, solde, retards,
   * élèves en impayé, encaissements par mois et par moyen (nets des contrepassations), répartition par
   * niveau et classe. Filtres : classe, type de frais, période des encaissements.
   */
  async dashboard(ctx: SchoolContext, q: ReportQueryDto) {
    const year = await this.school.findYear(ctx, q.schoolYearId);
    const now = await this.finance.todayFor(year.schoolId);
    // Période et mois dans le fuseau de l'établissement, comme les dates de ses reçus.
    const timezone = await this.finance.timezoneOf(year.schoolId);
    const paidAt = zonedDayRange(q.from, q.to, timezone);
    return this.students.snapshot(async (tx) => {
      const { currency } = await this.finance.settingsOf(tx, year.schoolId);
      const placement = await this.placements(tx, ctx, year.id);
      const charges = (await this.charges(tx, ctx, year.id, q)).filter(
        (c) => !q.classId || placement.get(c.studentId)?.classId === q.classId,
      );
      const rows = charges.map((c) => ({
        ...c,
        due: chargeDue(c),
        balance: chargeBalance(c),
        status: chargeStatus({ ...c, dueOn: day(c.dueOn) }, now),
      }));
      const overdue = rows.filter((c) => c.status === 'OVERDUE');
      const allocations = await tx.schoolPaymentAllocation.findMany({
        where: {
          organizationId: ctx.organizationId,
          chargeId: { in: rows.map((c) => c.id) },
          ...(paidAt ? { payment: { paidAt } } : {}),
        },
        select: {
          amount: true,
          charge: { select: { studentId: true } },
          payment: { select: { paidAt: true, method: true } },
        },
      });
      const byMonth = new Map<string, number>();
      const byMethod = new Map<string, number>();
      // Encaissé sur la période (affectations datées, contrepassations comprises), par classe aussi.
      const periodByClass = new Map<string, number>();
      for (const a of allocations) {
        const month = zonedMonth(a.payment.paidAt, timezone);
        byMonth.set(month, (byMonth.get(month) ?? 0) + a.amount);
        byMethod.set(a.payment.method, (byMethod.get(a.payment.method) ?? 0) + a.amount);
        const key = placement.get(a.charge.studentId)?.classId ?? 'none';
        periodByClass.set(key, (periodByClass.get(key) ?? 0) + a.amount);
      }
      const period = Boolean(q.from || q.to);
      const byClass = new Map<
        string,
        {
          classId: string | null;
          className: string;
          levelName: string;
          expected: number;
          collected: number;
          balance: number;
        }
      >();
      for (const c of rows) {
        const p = placement.get(c.studentId);
        const key = p?.classId ?? 'none';
        const entry = byClass.get(key) ?? {
          classId: p?.classId ?? null,
          className: p?.className ?? '—',
          levelName: p?.levelName ?? '—',
          expected: 0,
          collected: 0,
          balance: 0,
        };
        entry.expected += c.due;
        entry.collected += c.paid;
        entry.balance += c.balance;
        byClass.set(key, entry);
      }
      return {
        currency,
        today: now,
        // Attendu, encaissé et solde : situation de l'année à ce jour (attendu = encaissé + solde).
        expected: rows.reduce((s, c) => s + c.due, 0),
        collected: rows.reduce((s, c) => s + c.paid, 0),
        // Encaissé entre les dates filtrées ; null sans filtre de période.
        periodCollected: period ? allocations.reduce((s, a) => s + a.amount, 0) : null,
        balance: rows.reduce((s, c) => s + c.balance, 0),
        discounts: rows.reduce((s, c) => s + c.discount, 0),
        overdueCharges: overdue.length,
        overdueAmount: overdue.reduce((s, c) => s + c.balance, 0),
        studentsInArrears: new Set(overdue.map((c) => c.studentId)).size,
        collectionsByMonth: [...byMonth].sort().map(([month, amount]) => ({ month, amount })),
        collectionsByMethod: [...byMethod].map(([method, amount]) => ({ method, amount })),
        byClass: [...byClass]
          .map(([key, entry]) => ({
            ...entry,
            periodCollected: period ? (periodByClass.get(key) ?? 0) : null,
          }))
          .sort((a, b) => a.className.localeCompare(b.className)),
      };
    });
  }

  /**
   * Élèves dont au moins une échéance est en retard, du plus gros retard au plus petit. Agrégé par la
   * base (une ligne par élève, filtres classe et type de frais compris) ; `limit` borne l'export sans
   * jamais tronquer les échéances qui forment les totaux.
   */
  async unpaid(ctx: SchoolContext, q: ReportQueryDto, limit?: number) {
    const year = await this.school.findYear(ctx, q.schoolYearId);
    const now = await this.finance.todayFor(year.schoolId);
    return this.students.snapshot(async (tx) => {
      // Reste d'une échéance : dû (montant − réduction + ajustement) − payé, jamais négatif.
      const totals = await tx.$queryRaw<
        { studentId: string; overdue: bigint; balance: bigint; oldestDue: Date; count: bigint }[]
      >`
        SELECT c."studentId",
          SUM(GREATEST(c."amount" - c."discount" + c."adjustment" - c."paid", 0)) AS "balance",
          SUM(GREATEST(c."amount" - c."discount" + c."adjustment" - c."paid", 0))
            FILTER (WHERE c."dueOn" < ${now}::date) AS "overdue",
          MIN(c."dueOn") FILTER (WHERE c."dueOn" < ${now}::date
            AND c."amount" - c."discount" + c."adjustment" > c."paid") AS "oldestDue",
          COUNT(*) FILTER (WHERE c."dueOn" < ${now}::date
            AND c."amount" - c."discount" + c."adjustment" > c."paid") AS "count"
        FROM "SchoolCharge" c
        WHERE c."organizationId" = ${ctx.organizationId}::uuid AND c."schoolYearId" = ${year.id}::uuid
          AND (${q.category ?? null}::text IS NULL OR c."category"::text = ${q.category ?? null}::text)
          AND (${q.classId ?? null}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM "SchoolEnrollment" e
            WHERE e."studentId" = c."studentId" AND e."schoolYearId" = c."schoolYearId"
              AND e."status" = 'VALIDATED' AND e."classId" = ${q.classId ?? null}::uuid))
        GROUP BY c."studentId"
        HAVING COUNT(*) FILTER (WHERE c."dueOn" < ${now}::date
          AND c."amount" - c."discount" + c."adjustment" > c."paid") > 0
        ORDER BY "overdue" DESC, c."studentId"
        LIMIT ${limit ?? null}`;
      const ids = totals.map((t) => t.studentId);
      const [students, placement] = await Promise.all([
        tx.schoolStudent.findMany({
          where: { organizationId: ctx.organizationId, id: { in: ids } },
          select: STUDENT_NAMES,
        }),
        this.placements(tx, ctx, year.id, ids),
      ]);
      const byId = new Map(students.map((s) => [s.id, s]));
      return totals
        .map((t) => ({
          student: byId.get(t.studentId)!,
          className: placement.get(t.studentId)?.className ?? null,
          overdue: Number(t.overdue),
          balance: Number(t.balance),
          oldestDue: day(t.oldestDue),
          count: Number(t.count),
        }))
        .sort(
          (a, b) => b.overdue - a.overdue || a.student.lastName.localeCompare(b.student.lastName),
        );
    });
  }

  /** Export CSV ou XLSX des impayés ou des encaissements : permission, plafond et journalisation. */
  async export(ctx: SchoolContext, q: FinanceExportQueryDto) {
    const year = await this.school.findYear(ctx, q.schoolYearId);
    const { defaultLocale } = await this.school.assertSchool(ctx, year.schoolId);
    const { file, rows } = await this.exports.exportSlot(async () => {
      const table =
        q.kind === 'unpaid'
          ? await this.unpaidTable(ctx, q, defaultLocale)
          : await this.paymentsTable(ctx, q, year.schoolId, defaultLocale);
      this.exports.assertExportSize(table.rows.length);
      const name = q.kind === 'unpaid' ? 'impayes' : 'encaissements';
      return {
        file: await this.exports.exportFile(table, q.format, name),
        rows: table.rows.length,
      };
    });
    await this.school.log(ctx, 'school.finance_exported', 'SchoolYear', year.id, {
      kind: q.kind,
      rows,
    });
    return file;
  }

  // ─── Outils ───

  private async unpaidTable(
    ctx: SchoolContext,
    q: FinanceExportQueryDto,
    locale: SchoolLocale,
  ): Promise<TableExport> {
    const rows = await this.unpaid(ctx, q, this.exports.exportMaxRows + 1);
    return {
      headers: header(locale, ['matricule', 'student', 'class', 'overdue', 'balance', 'oldestDue']),
      rows: rows.map((r) => [
        r.student.matricule,
        studentName(locale, r.student),
        r.className ?? '',
        r.overdue,
        r.balance,
        r.oldestDue ?? '',
      ]),
    };
  }

  private async paymentsTable(
    ctx: SchoolContext,
    q: FinanceExportQueryDto,
    schoolId: string,
    locale: SchoolLocale,
  ): Promise<TableExport> {
    const paidAt = zonedDayRange(q.from, q.to, await this.finance.timezoneOf(schoolId));
    const rows = await this.db.schoolPayment.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId,
        schoolYearId: q.schoolYearId,
        // Encaissement retenu s'il touche au moins une échéance du type de frais filtré, pour un élève
        // inscrit dans la classe filtrée ; son montant total est exporté.
        ...(q.category ? { allocations: { some: { charge: { category: q.category } } } } : {}),
        ...(q.classId
          ? {
              student: {
                enrollments: {
                  some: { classId: q.classId, schoolYearId: q.schoolYearId, status: 'VALIDATED' },
                },
              },
            }
          : {}),
        ...(paidAt ? { paidAt } : {}),
      },
      orderBy: { paidAt: 'asc' },
      take: this.exports.exportMaxRows + 1,
      include: { student: { select: STUDENT_NAMES } },
    });
    return {
      headers: header(locale, [
        'date',
        'receipt',
        'matricule',
        'student',
        'kind',
        'method',
        'reference',
        'amount',
        'status',
      ]),
      rows: rows.map((p) => [
        p.paidAt.toISOString(),
        p.receiptNumber ?? '',
        p.student.matricule,
        studentName(locale, p.student),
        p.kind === 'REVERSAL'
          ? EXPORT_TEXT.reversal[lang(locale)]
          : EXPORT_TEXT.payment[lang(locale)],
        SCHOOL_PAYMENT_METHOD_LABELS[p.method],
        p.reference ?? '',
        p.kind === 'REVERSAL' ? -p.amount : p.amount,
        p.status === 'CANCELLED'
          ? EXPORT_TEXT.cancelled[lang(locale)]
          : EXPORT_TEXT.confirmed[lang(locale)],
      ]),
    };
  }

  private allocations(
    dto: CreatePaymentDto,
    charges: {
      id: string;
      dueOn: Date;
      amount: number;
      discount: number;
      adjustment: number;
      paid: number;
    }[],
  ) {
    const balances = new Map(charges.map((c) => [c.id, chargeBalance(c)]));
    if (!dto.allocations) {
      const auto = allocateOldestFirst(
        dto.amount,
        charges.map((c) => ({ id: c.id, dueOn: day(c.dueOn), balance: balances.get(c.id)! })),
      );
      if (auto.remainder > 0) throw this.exceeds();
      return auto.allocations;
    }
    const ids = dto.allocations.map((a) => a.chargeId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_CHARGE',
        message: 'Une échéance figure deux fois dans l’affectation.',
      });
    }
    for (const a of dto.allocations) {
      const balance = balances.get(a.chargeId);
      if (balance === undefined) throw new NotFoundException(NOT_FOUND);
      if (a.amount > balance) throw this.exceeds();
    }
    if (dto.allocations.reduce((s, a) => s + a.amount, 0) !== dto.amount) {
      throw new BadRequestException({
        code: 'ALLOCATION_MISMATCH',
        message: 'La somme affectée doit égaler le montant encaissé.',
      });
    }
    return dto.allocations;
  }

  private exceeds() {
    return new BadRequestException({
      code: 'AMOUNT_EXCEEDS_BALANCE',
      message: 'Le montant dépasse le reste à payer des échéances visées.',
    });
  }

  private async assertNotDuplicate(tx: Tx, ctx: SchoolContext, dto: CreatePaymentDto) {
    const recent = await tx.schoolPayment.count({
      where: {
        organizationId: ctx.organizationId,
        studentId: dto.studentId,
        kind: 'PAYMENT',
        status: 'CONFIRMED',
        amount: dto.amount,
        method: dto.method,
        createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
    });
    if (recent > 0) {
      throw new ConflictException({
        code: 'POSSIBLE_DUPLICATE',
        message:
          'Un encaissement identique vient d’être enregistré pour cet élève. Confirmez s’il s’agit bien d’un second paiement.',
      });
    }
  }

  /** Encaissement déjà créé par la même clé ; une clé réutilisée pour une autre opération est refusée. */
  private async byIdempotencyKey(
    ctx: SchoolContext,
    dto: CreatePaymentDto,
    db: Tx | SchoolPrismaService = this.db,
  ) {
    const existing = await db.schoolPayment.findFirst({
      where: { organizationId: ctx.organizationId, idempotencyKey: dto.idempotencyKey },
      select: { id: true, requestFingerprint: true },
    });
    if (!existing) return null;
    if (existing.requestFingerprint !== fingerprint(dto)) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_MISMATCH',
        message: 'Cette clé de formulaire a déjà servi pour un autre encaissement.',
      });
    }
    return db === this.db ? this.paymentView(ctx, existing.id) : { id: existing.id };
  }

  /** Compteur de reçus par établissement et par année, incrémenté atomiquement (jamais MAX + 1). */
  private async nextReceipt(tx: Tx, ctx: SchoolContext, schoolId: string, paidAt: Date) {
    const key = `receipt:${schoolId}:${paidAt.getUTCFullYear()}`;
    const [row] = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "SchoolNumberCounter" ("organizationId", "counterKey", "value")
      VALUES (${ctx.organizationId}::uuid, ${key}, 1)
      ON CONFLICT ("organizationId", "counterKey")
      DO UPDATE SET "value" = "SchoolNumberCounter"."value" + 1
      RETURNING "value"`;
    return Number(row!.value);
  }

  private async classLabel(tx: Tx, ctx: SchoolContext, studentId: string, schoolYearId: string) {
    const enrollment = await tx.schoolEnrollment.findFirst({
      where: { organizationId: ctx.organizationId, studentId, schoolYearId, status: 'VALIDATED' },
      select: { class: { select: { name: true } } },
    });
    return enrollment?.class?.name ?? null;
  }

  private async charges(tx: Tx, ctx: SchoolContext, schoolYearId: string, q: ReportQueryDto) {
    return tx.schoolCharge.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId,
        ...(q.category ? { category: q.category } : {}),
      },
    });
  }

  /** Classe et niveau de chaque élève inscrit (inscription validée) pour l'année ; `studentIds` : ces élèves. */
  private async placements(
    tx: Tx,
    ctx: SchoolContext,
    schoolYearId: string,
    studentIds?: string[],
  ) {
    const rows = await tx.schoolEnrollment.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId,
        status: 'VALIDATED',
        ...(studentIds ? { studentId: { in: studentIds } } : {}),
      },
      select: {
        studentId: true,
        classId: true,
        class: { select: { name: true } },
        level: { select: { name: true } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.studentId,
        { classId: r.classId, className: r.class?.name ?? '—', levelName: r.level.name },
      ]),
    );
  }

  /** Identité figée du reçu, lue dans la transaction d'encaissement. */
  private async receiptIdentity(
    tx: Tx,
    schoolId: string,
    schoolYearId: string,
    studentId: string,
  ): Promise<ReceiptIdentity> {
    const [school, student, year] = await Promise.all([
      tx.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: {
          name: true,
          nameAr: true,
          address: true,
          phone: true,
          email: true,
          timezone: true,
          defaultLocale: true,
        },
      }),
      tx.schoolStudent.findUniqueOrThrow({
        where: { id: studentId },
        select: {
          matricule: true,
          lastName: true,
          firstName: true,
          lastNameAr: true,
          firstNameAr: true,
        },
      }),
      tx.schoolYear.findUniqueOrThrow({ where: { id: schoolYearId }, select: { label: true } }),
    ]);
    const { timezone, defaultLocale, ...contact } = school;
    return { locale: defaultLocale, timezone, school: contact, student, yearLabel: year.label };
  }

  private async findPayment(ctx: SchoolContext, id: string) {
    const payment = await this.db.schoolPayment.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true, studentId: true, kind: true, receiptNumber: true },
    });
    if (!payment) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, payment.schoolId);
    return payment;
  }
}

/** Partie du reçu figée à l'encaissement. */
type ReceiptIdentity = Pick<
  ReceiptView,
  'locale' | 'timezone' | 'school' | 'student' | 'yearLabel'
>;

// ─── Libellés des exports ───

const lang = (locale: SchoolLocale) => (locale === 'AR' ? 'ar' : 'fr');

const EXPORT_TEXT = {
  matricule: { fr: 'Matricule', ar: 'الرقم التسلسلي' },
  student: { fr: 'Élève', ar: 'التلميذ' },
  class: { fr: 'Classe', ar: 'القسم' },
  overdue: { fr: 'En retard', ar: 'متأخر' },
  balance: { fr: 'Reste à payer', ar: 'المتبقي' },
  oldestDue: { fr: 'Plus ancienne échéance', ar: 'أقدم أجل' },
  date: { fr: 'Date', ar: 'التاريخ' },
  receipt: { fr: 'Reçu', ar: 'الوصل' },
  kind: { fr: 'Opération', ar: 'العملية' },
  method: { fr: 'Moyen', ar: 'وسيلة الدفع' },
  reference: { fr: 'Référence', ar: 'المرجع' },
  amount: { fr: 'Montant', ar: 'المبلغ' },
  status: { fr: 'Statut', ar: 'الحالة' },
  payment: { fr: 'Encaissement', ar: 'تحصيل' },
  reversal: { fr: 'Contrepassation', ar: 'قيد عكسي' },
  confirmed: { fr: 'Confirmé', ar: 'مؤكد' },
  cancelled: { fr: 'Annulé', ar: 'ملغى' },
} as const;

/** En-têtes dans la langue de l'établissement ; en Bilingue, les deux. */
function header(locale: SchoolLocale, keys: (keyof typeof EXPORT_TEXT)[]): string[] {
  return keys.map((k) =>
    locale === 'BILINGUAL'
      ? `${EXPORT_TEXT[k].fr} / ${EXPORT_TEXT[k].ar}`
      : EXPORT_TEXT[k][lang(locale)],
  );
}

function studentName(
  locale: SchoolLocale,
  s: { lastName: string; firstName: string; lastNameAr: string | null; firstNameAr: string | null },
): string {
  const fr = `${s.lastName} ${s.firstName}`;
  const ar = [s.lastNameAr, s.firstNameAr].filter(Boolean).join(' ');
  if (locale === 'FR' || !ar) return fr;
  return locale === 'AR' ? ar : `${fr} / ${ar}`;
}

/**
 * Empreinte canonique d'une demande d'encaissement : tout ce qui en fait une opération métier (élève,
 * année, montant, moyen, référence, affectations triées, date saisie, remarque). Une clé de formulaire
 * réutilisée avec une autre demande est refusée.
 */
function fingerprint(dto: CreatePaymentDto): string {
  const canonical = {
    studentId: dto.studentId,
    schoolYearId: dto.schoolYearId,
    amount: dto.amount,
    method: dto.method,
    reference: dto.reference?.trim().toLowerCase() || null,
    allocations: dto.allocations
      ? [...dto.allocations]
          .sort((a, b) => a.chargeId.localeCompare(b.chargeId))
          .map((a) => [a.chargeId, a.amount])
      : null,
    paidAt: dto.paidAt ?? null,
    note: dto.note ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
