import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  type BenefitRule,
  type SchoolCurrency,
  type SchoolPlanInput,
  SCHOOL_MAX_AMOUNT,
  benefitValueError,
  buildInstallments,
  chargeBalance,
  chargeDiscount,
  chargeDue,
  chargeStatus,
  hasSchoolPermission,
  isSchoolCurrency,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import type {
  AdjustChargeDto,
  BenefitQueryDto,
  CreateBenefitDto,
  CreateFeeDto,
  FeePlanDto,
  FinanceSettingsDto,
  GenerateChargesDto,
  UpdateFeeDto,
} from './school-finance.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { today } from './school-report-cards.service';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | SchoolPrismaService;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
/** Élèves sortis proposés par recherche, au plus (au-delà : affiner la recherche). */
const LEAVERS_PAGE = 50;
const day = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);

export interface FinanceSettingsView {
  currency: SchoolCurrency;
  receiptPrefix: string;
  secretaryCanCollect: boolean;
}

/** Avantage tel qu'il s'applique : nature, valeur et portée (catégorie ou frais, sinon tout). */
interface BenefitScope extends BenefitRule {
  category: string | null;
  feeId: string | null;
}

/**
 * Gestion financière (Sprint 5) : réglages, catalogue des frais et leur historique, échéanciers,
 * génération des échéances (jamais deux fois), situation d'un élève, ajustements et avantages.
 * Montants entiers en unités mineures de la devise de l'établissement. Verrous, dans cet ordre :
 * établissement (partagé, la clôture d'année l'attend), frais, élève, puis ses échéances.
 */
@Injectable()
export class SchoolFinanceService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
  ) {}

  // ─── Réglages ───

  async settings(ctx: SchoolContext, schoolId: string): Promise<FinanceSettingsView> {
    await this.school.assertSchool(ctx, schoolId);
    return this.settingsOf(this.db, schoolId);
  }

  async settingsOf(db: Db, schoolId: string): Promise<FinanceSettingsView> {
    const row = await db.schoolFinanceSettings.findUnique({ where: { schoolId } });
    const currency = row?.currency ?? 'XOF';
    return {
      currency: isSchoolCurrency(currency) ? currency : 'XOF',
      receiptPrefix: row?.receiptPrefix ?? 'REC',
      secretaryCanCollect: row?.secretaryCanCollect ?? false,
    };
  }

  /** La devise ne change plus dès qu'un frais existe : aucun montant ne changerait d'unité. */
  async saveSettings(ctx: SchoolContext, dto: FinanceSettingsDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${dto.schoolId}::uuid FOR UPDATE`;
      const current = await this.settingsOf(tx, dto.schoolId);
      if (dto.currency && dto.currency !== current.currency) {
        // Frais ou réduction fixe (même retirée, pour son historique) : montants exprimés dans la devise.
        const [fees, fixed] = await Promise.all([
          tx.schoolFee.count({ where: { schoolId: dto.schoolId } }),
          tx.schoolBenefit.count({ where: { schoolId: dto.schoolId, kind: 'FIXED' } }),
        ]);
        if (fees > 0 || fixed > 0) {
          throw new ConflictException({
            code: 'CURRENCY_LOCKED',
            message:
              'La devise ne peut plus changer : des frais ou des réductions fixes sont déjà définis.',
          });
        }
      }
      await tx.schoolFinanceSettings.upsert({
        where: { schoolId: dto.schoolId },
        create: {
          schoolId: dto.schoolId,
          organizationId: ctx.organizationId,
          currency: dto.currency ?? current.currency,
          receiptPrefix: dto.receiptPrefix ?? current.receiptPrefix,
          secretaryCanCollect: dto.secretaryCanCollect ?? current.secretaryCanCollect,
          updatedByUserId: ctx.userId,
        },
        update: {
          ...(dto.currency ? { currency: dto.currency } : {}),
          ...(dto.receiptPrefix ? { receiptPrefix: dto.receiptPrefix } : {}),
          ...(dto.secretaryCanCollect !== undefined
            ? { secretaryCanCollect: dto.secretaryCanCollect }
            : {}),
          updatedByUserId: ctx.userId,
        },
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.finance_settings_changed',
        'School',
        dto.schoolId,
        {
          fields: Object.keys(dto).filter((k) => k !== 'schoolId'),
        },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.settingsOf(this.db, dto.schoolId);
  }

  // ─── Catalogue des frais ───

  async listFees(ctx: SchoolContext, schoolYearId: string) {
    const year = await this.school.findYear(ctx, schoolYearId);
    const fees = await this.db.schoolFee.findMany({
      where: { organizationId: ctx.organizationId, schoolYearId: year.id },
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      include: {
        installments: { orderBy: { position: 'asc' } },
        level: { select: { id: true, name: true, nameAr: true } },
        class: { select: { id: true, name: true, nameAr: true } },
        _count: { select: { charges: true } },
      },
    });
    return fees.map(({ _count, ...f }) => ({ ...f, charges: _count.charges }));
  }

  async createFee(ctx: SchoolContext, dto: CreateFeeDto) {
    const year = await this.school.findYear(ctx, dto.schoolYearId);
    await this.assertFeeTarget(
      ctx,
      year.schoolId,
      year.id,
      dto.levelId ?? null,
      dto.classId ?? null,
    );
    const plan = this.planInput(dto.plan);
    const installments = this.installments(plan, dto.amount);
    const fee = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [year.schoolId]);
      await this.assertYearOpen(tx, year.id);
      const { currency } = await this.settingsOf(tx, year.schoolId);
      const created = await tx.schoolFee.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: year.schoolId,
          schoolYearId: year.id,
          levelId: dto.levelId ?? null,
          classId: dto.classId ?? null,
          category: dto.category,
          name: dto.name,
          nameAr: dto.nameAr ?? null,
          amount: dto.amount,
          currency,
          effectiveFrom: toDate(dto.effectiveFrom),
          mandatory: dto.mandatory ?? true,
          planKind: plan.kind,
          plan: plan as unknown as Prisma.InputJsonObject,
          createdByUserId: ctx.userId,
          installments: {
            create: installments.map((i) => ({
              position: i.position,
              dueOn: toDate(i.dueOn),
              amount: i.amount,
            })),
          },
        },
      });
      const full = await tx.schoolFee.findUniqueOrThrow({
        where: { id: created.id },
        include: { installments: { orderBy: { position: 'asc' } } },
      });
      await this.feeEvent(tx, ctx, created.id, 'created', null, this.feeSnapshot(full));
      return created;
    });
    await this.school.log(ctx, 'school.fee_created', 'SchoolFee', fee.id, {
      category: fee.category,
    });
    return fee;
  }

  /**
   * Modification d'un tarif. Un nouveau montant ne vaut que pour les échéances générées ensuite (chaque
   * échéance garde sa copie) ; l'échéancier d'un frais déjà facturé garde ses rangs, pour qu'une
   * nouvelle génération ne double jamais une échéance.
   */
  async updateFee(ctx: SchoolContext, id: string, dto: UpdateFeeDto) {
    const fee = await this.findFee(ctx, id);
    const updated = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [fee.schoolId]);
      await tx.$queryRaw`SELECT id FROM "SchoolFee" WHERE id = ${id}::uuid FOR UPDATE`;
      await this.assertYearOpen(tx, fee.schoolYearId);
      const current = await tx.schoolFee.findUniqueOrThrow({
        where: { id },
        include: { installments: { orderBy: { position: 'asc' } } },
      });
      const amount = dto.amount ?? current.amount;
      const planChanged = dto.plan !== undefined;
      let installments: { position: number; dueOn: string; amount: number }[] | null = null;
      if (planChanged || amount !== current.amount) {
        const plan = dto.plan
          ? this.planInput(dto.plan)
          : (current.plan as unknown as SchoolPlanInput);
        if (plan.kind === 'CUSTOM' && !planChanged) {
          throw new BadRequestException({
            code: 'INVALID_PLAN',
            message: 'Un échéancier personnalisé doit être repris avec le nouveau montant.',
          });
        }
        installments = this.installments(plan, amount);
        const billed = await tx.schoolCharge.count({ where: { feeId: id } });
        if (
          billed > 0 &&
          (plan.kind !== current.planKind || installments.length !== current.installments.length)
        ) {
          throw new ConflictException({
            code: 'FEE_PLAN_LOCKED',
            message:
              'Des échéances sont déjà générées : l’échéancier garde son type et son nombre d’échéances.',
          });
        }
        await tx.schoolFeeInstallment.deleteMany({ where: { feeId: id } });
        await tx.schoolFeeInstallment.createMany({
          data: installments.map((i) => ({
            organizationId: ctx.organizationId,
            feeId: id,
            position: i.position,
            dueOn: toDate(i.dueOn),
            amount: i.amount,
          })),
        });
        if (planChanged) {
          await tx.schoolFee.update({
            where: { id },
            data: { planKind: plan.kind, plan: plan as unknown as Prisma.InputJsonObject },
          });
        }
      }
      const next = await tx.schoolFee.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
          ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
          ...(dto.effectiveFrom !== undefined ? { effectiveFrom: toDate(dto.effectiveFrom) } : {}),
          ...(dto.mandatory !== undefined ? { mandatory: dto.mandatory } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedByUserId: ctx.userId,
        },
      });
      const after = await tx.schoolFee.findUniqueOrThrow({
        where: { id },
        include: { installments: { orderBy: { position: 'asc' } } },
      });
      await this.feeEvent(
        tx,
        ctx,
        id,
        'updated',
        this.feeSnapshot(current),
        this.feeSnapshot(after),
      );
      return next;
    });
    await this.school.log(ctx, 'school.fee_updated', 'SchoolFee', id, { fields: Object.keys(dto) });
    return updated;
  }

  async feeHistory(ctx: SchoolContext, id: string) {
    await this.findFee(ctx, id);
    return this.db.schoolFeeEvent.findMany({
      where: { organizationId: ctx.organizationId, feeId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Élèves concernés par un frais et état de sa génération. */
  async feeDetail(ctx: SchoolContext, id: string) {
    const fee = await this.findFee(ctx, id);
    return this.students.snapshot(async (tx) => {
      const row = await tx.schoolFee.findUniqueOrThrow({
        where: { id },
        include: { installments: { orderBy: { position: 'asc' } } },
      });
      const eligible = await this.eligibleStudents(tx, ctx, row);
      const billed = await tx.schoolCharge.groupBy({
        by: ['studentId'],
        where: { feeId: id },
        _count: { _all: true },
      });
      const billedIds = new Set(billed.map((b) => b.studentId));
      return {
        fee: row,
        schoolId: fee.schoolId,
        students: eligible.map((s) => ({ ...s, billed: billedIds.has(s.id) })),
      };
    });
  }

  /**
   * Génération des échéances d'un frais : une par élève et par rang de l'échéancier, avec la réduction
   * de ses avantages actifs. Idempotente : l'unicité (élève, frais, rang) écarte ce qui existe déjà.
   * Frais facultatif (cantine, transport…) : seulement pour les élèves désignés.
   */
  async generateCharges(ctx: SchoolContext, id: string, dto: GenerateChargesDto) {
    const fee = await this.findFee(ctx, id);
    const result = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [fee.schoolId]);
      // Frais en partage : un changement de montant (exclusif) ne peut pas croiser la génération.
      await tx.$queryRaw`SELECT id FROM "SchoolFee" WHERE id = ${id}::uuid FOR SHARE`;
      await this.assertYearOpen(tx, fee.schoolYearId);
      const row = await tx.schoolFee.findUniqueOrThrow({
        where: { id },
        include: { installments: { orderBy: { position: 'asc' } } },
      });
      if (!row.isActive) {
        throw new ConflictException({ code: 'FEE_INACTIVE', message: 'Ce frais est désactivé.' });
      }
      if (!row.mandatory && !dto.studentIds?.length) {
        throw new BadRequestException({
          code: 'STUDENTS_REQUIRED',
          message: 'Frais facultatif : désignez les élèves concernés.',
        });
      }
      // Date d'application : un tarif ne se facture qu'à partir d'elle (règle explicite du Sprint 5).
      if ((await this.todayFor(row.schoolId, tx)) < day(row.effectiveFrom)) {
        throw new ConflictException({
          code: 'FEE_NOT_YET_EFFECTIVE',
          message:
            'Ce tarif ne s’applique pas encore : la génération attend sa date d’application.',
        });
      }
      const candidates = (
        dto.studentIds?.length
          ? [...new Set(dto.studentIds)]
          : (await this.eligibleStudents(tx, ctx, row)).map((s) => s.id)
      ).sort();
      if (candidates.length === 0) return { created: 0, students: 0 };
      // Élèves exclusifs, triés, bornés à l'établissement du frais : deux générations (même frais ou
      // non) se suivent élève par élève, sans attente croisée ni cumul lu de part et d'autre ; un
      // transfert, un changement de classe ou un avantage attend la génération, ou la précède et se voit.
      const locked = new Set(
        (
          await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "SchoolStudent"
            WHERE id = ANY(${candidates}::uuid[]) AND "organizationId" = ${ctx.organizationId}::uuid
              AND "schoolId" = ${row.schoolId}::uuid
            ORDER BY id FOR UPDATE`
        ).map((r) => r.id),
      );
      // Éligibilité relue sous ces verrous : inscription, classe et niveau à jour.
      const eligible = new Set(
        (await this.eligibleStudents(tx, ctx, row)).map((s) => s.id).filter((s) => locked.has(s)),
      );
      if (dto.studentIds?.length && candidates.some((s) => !eligible.has(s))) {
        throw new BadRequestException({
          code: 'STUDENT_NOT_ELIGIBLE',
          message: 'Un élève désigné n’est pas inscrit dans le périmètre de ce frais.',
        });
      }
      const targets = candidates.filter((s) => eligible.has(s));
      if (targets.length === 0) return { created: 0, students: 0 };
      await this.assertTotalsWithin(tx, ctx, row.schoolYearId, targets, row.id, row.amount);
      const benefits = await this.activeBenefits(tx, ctx, row.schoolYearId, targets);
      const data = targets.flatMap((studentId) =>
        row.installments.map((i) => {
          const rules = this.applicable(benefits.get(studentId) ?? [], row.id, row.category);
          return {
            organizationId: ctx.organizationId,
            schoolId: row.schoolId,
            schoolYearId: row.schoolYearId,
            studentId,
            feeId: row.id,
            position: i.position,
            category: row.category,
            label:
              row.installments.length > 1
                ? `${row.name} (${i.position}/${row.installments.length})`
                : row.name,
            labelAr: row.nameAr,
            dueOn: i.dueOn,
            amount: i.amount,
            discount: chargeDiscount(i.amount, rules),
            currency: row.currency,
            createdByUserId: ctx.userId,
          };
        }),
      );
      const { count } = await tx.schoolCharge.createMany({ data, skipDuplicates: true });
      return { created: count, students: targets.length };
    });
    await this.school.log(ctx, 'school.charges_generated', 'SchoolFee', id, {
      created: result.created,
      students: result.students,
    });
    return result;
  }

  // ─── Situation d'un élève ───

  /**
   * Élèves sortis de l'établissement (aucune inscription validée pour l'année) qui y doivent encore une
   * échéance de l'année : leur situation et leur caisse restent accessibles. Recherche par nom, prénom
   * ou matricule ; `LEAVERS_PAGE` au plus, dans un ordre total, `truncated` invitant à affiner. Le
   * transfert vers un autre établissement n'en fait pas partie (élève rattaché ailleurs).
   */
  async leavers(ctx: SchoolContext, schoolYearId: string, q?: string) {
    const year = await this.school.findYear(ctx, schoolYearId);
    // Motif « contient », caractères spéciaux de LIKE neutralisés.
    const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "SchoolStudent" s
      WHERE s."organizationId" = ${ctx.organizationId}::uuid AND s."schoolId" = ${year.schoolId}::uuid
        AND EXISTS (
          SELECT 1 FROM "SchoolCharge" c
          WHERE c."studentId" = s.id AND c."schoolYearId" = ${year.id}::uuid
            AND c."amount" - c."discount" + c."adjustment" > c."paid")
        AND NOT EXISTS (
          SELECT 1 FROM "SchoolEnrollment" e
          WHERE e."studentId" = s.id AND e."schoolYearId" = ${year.id}::uuid
            AND e."status" = 'VALIDATED')
        AND (${pattern}::text IS NULL OR s."lastName" ILIKE ${pattern} OR s."firstName" ILIKE ${pattern}
          OR s."matricule" ILIKE ${pattern} OR s."lastNameAr" ILIKE ${pattern}
          OR s."firstNameAr" ILIKE ${pattern})
      ORDER BY s."lastName", s."firstName", s.id
      LIMIT ${LEAVERS_PAGE + 1}`;
    const ids = rows.slice(0, LEAVERS_PAGE).map((r) => r.id);
    const students = await this.db.schoolStudent.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        matricule: true,
        lastName: true,
        firstName: true,
        lastNameAr: true,
        firstNameAr: true,
      },
    });
    const byId = new Map(students.map((s) => [s.id, s]));
    return { items: ids.map((id) => byId.get(id)!), truncated: rows.length > LEAVERS_PAGE };
  }

  async studentSituation(ctx: SchoolContext, studentId: string, schoolYearId: string) {
    const year = await this.school.findYear(ctx, schoolYearId);
    const student = await this.students.findStudent(ctx, studentId);
    if (student.schoolId !== year.schoolId) throw new NotFoundException(NOT_FOUND);
    const now = await this.todayFor(year.schoolId);
    return this.students.snapshot(async (tx) => {
      const identity = await tx.schoolStudent.findFirst({
        where: {
          id: studentId,
          organizationId: ctx.organizationId,
          schoolId: year.schoolId,
        },
        select: {
          id: true,
          matricule: true,
          lastName: true,
          firstName: true,
          lastNameAr: true,
          firstNameAr: true,
        },
      });
      if (!identity) throw new NotFoundException(NOT_FOUND);
      const { currency } = await this.settingsOf(tx, year.schoolId);
      const charges = await tx.schoolCharge.findMany({
        where: { organizationId: ctx.organizationId, studentId, schoolYearId: year.id },
        orderBy: [{ dueOn: 'asc' }, { label: 'asc' }],
        include: { adjustments: { orderBy: { createdAt: 'desc' } } },
      });
      const benefits = await tx.schoolBenefit.findMany({
        where: { organizationId: ctx.organizationId, studentId, schoolYearId: year.id },
        orderBy: { createdAt: 'desc' },
      });
      const payments = await tx.schoolPayment.findMany({
        where: { organizationId: ctx.organizationId, studentId, schoolYearId: year.id },
        orderBy: { paidAt: 'desc' },
        include: { allocations: { select: { chargeId: true, amount: true } } },
      });
      const rows = charges.map((c) => ({
        ...c,
        dueOn: day(c.dueOn),
        due: chargeDue(c),
        balance: chargeBalance(c),
        status: chargeStatus({ ...c, dueOn: day(c.dueOn) }, now),
      }));
      return {
        student: identity,
        currency,
        today: now,
        totals: {
          amount: rows.reduce((s, c) => s + c.amount, 0),
          discount: rows.reduce((s, c) => s + c.discount, 0),
          adjustment: rows.reduce((s, c) => s + c.adjustment, 0),
          due: rows.reduce((s, c) => s + c.due, 0),
          paid: rows.reduce((s, c) => s + c.paid, 0),
          balance: rows.reduce((s, c) => s + c.balance, 0),
          overdue: rows.filter((c) => c.status === 'OVERDUE').reduce((s, c) => s + c.balance, 0),
        },
        charges: rows,
        benefits,
        payments,
      };
    });
  }

  /** Ajustement justifié d'une échéance : jamais sous le montant déjà payé, jamais négative. */
  async adjustCharge(ctx: SchoolContext, id: string, dto: AdjustChargeDto) {
    if (dto.amount === 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Ajustement nul.' });
    }
    const charge = await this.findCharge(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [charge.schoolId]);
      // Droit contrôlé sur l'établissement de l'échéance (findCharge) : elle reste ajustable après un
      // transfert de l'élève.
      await this.lockStudentById(tx, ctx, charge.studentId);
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SchoolCharge"
        WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid
        FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException(NOT_FOUND);
      const current = await tx.schoolCharge.findUniqueOrThrow({ where: { id } });
      const adjustment = current.adjustment + dto.amount;
      if (
        Math.abs(adjustment) > SCHOOL_MAX_AMOUNT ||
        current.amount + adjustment > SCHOOL_MAX_AMOUNT
      ) {
        throw new BadRequestException({
          code: 'AMOUNT_TOO_LARGE',
          message: 'Le montant de l’échéance dépasserait la limite autorisée.',
        });
      }
      if (chargeDue({ ...current, adjustment }) < current.paid) {
        throw new ConflictException({
          code: 'ADJUSTMENT_BELOW_PAID',
          message: 'L’ajustement ramènerait l’échéance sous le montant déjà payé.',
        });
      }
      await tx.schoolChargeAdjustment.create({
        data: {
          organizationId: ctx.organizationId,
          chargeId: id,
          amount: dto.amount,
          reason: dto.reason,
          actorUserId: ctx.userId,
        },
      });
      await tx.schoolCharge.update({ where: { id }, data: { adjustment } });
      await this.assertTotalsWithin(tx, ctx, current.schoolYearId, [current.studentId], null, 0);
      await this.school.recordDecision(tx, ctx, 'school.charge_adjusted', 'SchoolCharge', id, {
        studentId: charge.studentId,
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { adjusted: true };
  }

  // ─── Réductions, bourses et exonérations ───

  async listBenefits(ctx: SchoolContext, q: BenefitQueryDto) {
    const year = await this.school.findYear(ctx, q.schoolYearId);
    return this.db.schoolBenefit.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: year.id,
        ...(q.studentId ? { studentId: q.studentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        student: {
          select: {
            id: true,
            matricule: true,
            lastName: true,
            firstName: true,
            lastNameAr: true,
            firstNameAr: true,
          },
        },
        fee: { select: { id: true, name: true, nameAr: true } },
      },
    });
  }

  /**
   * Avantage accordé par la direction, justifié et tracé, puis appliqué aux échéances de l'année. Refusé
   * s'il ramenait une échéance sous ce qui est déjà payé : les réductions restent distinctes des
   * encaissements et ne créent jamais de trop-perçu.
   */
  async grantBenefit(ctx: SchoolContext, dto: CreateBenefitDto) {
    const error = benefitValueError(dto.kind, dto.value);
    if (error) throw new BadRequestException({ code: 'INVALID_BENEFIT', message: error });
    const year = await this.school.findYear(ctx, dto.schoolYearId);
    const student = await this.students.findStudent(ctx, dto.studentId);
    if (student.schoolId !== year.schoolId) throw new NotFoundException(NOT_FOUND);
    if (dto.feeId) {
      const fee = await this.findFee(ctx, dto.feeId);
      if (fee.schoolYearId !== year.id) throw new NotFoundException(NOT_FOUND);
    }
    const benefit = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [year.schoolId]);
      await this.lockStudent(tx, ctx, year.schoolId, dto.studentId);
      const created = await tx.schoolBenefit.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: year.schoolId,
          schoolYearId: year.id,
          studentId: dto.studentId,
          kind: dto.kind,
          value: dto.kind === 'EXEMPTION' ? 10_000 : dto.value,
          category: dto.feeId ? null : (dto.category ?? null),
          feeId: dto.feeId ?? null,
          reason: dto.reason,
          approvedByUserId: ctx.userId,
        },
      });
      await this.recomputeDiscounts(tx, ctx, year.id, dto.studentId);
      await this.school.recordDecision(
        tx,
        ctx,
        'school.benefit_granted',
        'SchoolStudent',
        dto.studentId,
        {
          benefitId: created.id,
          kind: dto.kind,
        },
      );
      return created;
    });
    await this.school.publishDecisions(ctx.organizationId);
    return benefit;
  }

  async revokeBenefit(ctx: SchoolContext, id: string, reason: string) {
    const benefit = await this.db.schoolBenefit.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true, schoolYearId: true, studentId: true },
    });
    if (!benefit) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, benefit.schoolId);
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [benefit.schoolId]);
      // Droit contrôlé sur l'établissement de l'avantage : il reste retirable après un transfert.
      await this.lockStudentById(tx, ctx, benefit.studentId);
      const { count } = await tx.schoolBenefit.updateMany({
        where: { id, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByUserId: ctx.userId,
          revokeReason: reason,
        },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'BENEFIT_REVOKED',
          message: 'Cet avantage est déjà retiré.',
        });
      }
      await this.recomputeDiscounts(tx, ctx, benefit.schoolYearId, benefit.studentId);
      await this.school.recordDecision(
        tx,
        ctx,
        'school.benefit_revoked',
        'SchoolStudent',
        benefit.studentId,
        { benefitId: id },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { revoked: true };
  }

  // ─── Outils partagés avec les encaissements ───

  /**
   * Encaisser : comptabilité et direction ; secrétariat seulement si la direction l'a autorisé. Appelé
   * avant la transaction puis dans celle-ci (sous le verrou de l'établissement, que le changement de
   * réglages prend en exclusif) : une autorisation retirée entre-temps n'est jamais utilisée.
   */
  async assertCanCollect(ctx: SchoolContext, schoolId: string, db: Db = this.db) {
    if (hasSchoolPermission(ctx.role, 'school.finance.collect')) return;
    if (ctx.role === 'SECRETARY' && (await this.settingsOf(db, schoolId)).secretaryCanCollect) {
      return;
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires.",
    });
  }

  /**
   * Verrou exclusif de l'élève, borné à l'organisation et à l'établissement : un identifiant étranger
   * n'est jamais verrouillé et donne 404. Sérialise encaissements, annulations et avantages d'un élève.
   */
  async lockStudent(tx: Tx, ctx: SchoolContext, schoolId: string, studentId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SchoolStudent"
      WHERE id = ${studentId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid
        AND "schoolId" = ${schoolId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException(NOT_FOUND);
  }

  /**
   * Verrou exclusif d'un élève pour une correction d'écriture historique (annulation, ajustement,
   * retrait d'avantage), quel que soit son établissement actuel : le droit vient du périmètre de
   * l'écriture, déjà contrôlé.
   */
  async lockStudentById(tx: Tx, ctx: SchoolContext, studentId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SchoolStudent"
      WHERE id = ${studentId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException(NOT_FOUND);
  }

  /**
   * Cumul dû par élève et par année borné (unités mineures) : soldes, contraintes et reçus restent
   * dans la plage des entiers. `feeId`/`extra` : montant d'un frais sur le point d'être facturé.
   */
  private async assertTotalsWithin(
    tx: Tx,
    ctx: SchoolContext,
    schoolYearId: string,
    studentIds: string[],
    feeId: string | null,
    extra: number,
  ) {
    const rows = await tx.schoolCharge.groupBy({
      by: ['studentId'],
      where: { organizationId: ctx.organizationId, schoolYearId, studentId: { in: studentIds } },
      _sum: { amount: true, adjustment: true },
    });
    const billed = feeId
      ? new Set(
          (
            await tx.schoolCharge.findMany({
              where: { feeId, studentId: { in: studentIds } },
              select: { studentId: true },
              distinct: ['studentId'],
            })
          ).map((r) => r.studentId),
        )
      : new Set<string>();
    for (const studentId of studentIds) {
      const r = rows.find((x) => x.studentId === studentId);
      const total =
        (r?._sum.amount ?? 0) + (r?._sum.adjustment ?? 0) + (billed.has(studentId) ? 0 : extra);
      if (total > SCHOOL_MAX_AMOUNT) {
        throw new ConflictException({
          code: 'TOTAL_TOO_LARGE',
          message: 'Le total dû par cet élève pour l’année dépasserait la limite autorisée.',
        });
      }
    }
  }

  /** Date du jour dans le fuseau de l'établissement ; `db` : la transaction en cours, s'il y en a une. */
  async todayFor(schoolId: string, db: Db = this.db): Promise<string> {
    return today(await this.timezoneOf(schoolId, db));
  }

  /** Fuseau de l'établissement (UTC à défaut). */
  async timezoneOf(schoolId: string, db: Db = this.db): Promise<string> {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { timezone: true },
    });
    return school?.timezone ?? 'UTC';
  }

  // ─── Outils ───

  /** Réductions recalculées sur toutes les échéances de l'élève pour l'année, sous leur verrou. */
  private async recomputeDiscounts(
    tx: Tx,
    ctx: SchoolContext,
    schoolYearId: string,
    studentId: string,
  ) {
    await tx.$queryRaw`
      SELECT id FROM "SchoolCharge"
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "studentId" = ${studentId}::uuid
        AND "schoolYearId" = ${schoolYearId}::uuid
      ORDER BY id FOR UPDATE`;
    const charges = await tx.schoolCharge.findMany({
      where: { organizationId: ctx.organizationId, studentId, schoolYearId },
    });
    const benefits =
      (await this.activeBenefits(tx, ctx, schoolYearId, [studentId])).get(studentId) ?? [];
    for (const c of charges) {
      const discount = chargeDiscount(c.amount, this.applicable(benefits, c.feeId, c.category));
      if (discount === c.discount) continue;
      if (chargeDue({ ...c, discount }) < c.paid) {
        throw new ConflictException({
          code: 'BENEFIT_EXCEEDS_PAID',
          message:
            'Cet avantage ramènerait une échéance sous le montant déjà payé : annulez d’abord l’encaissement concerné.',
        });
      }
      await tx.schoolCharge.update({ where: { id: c.id }, data: { discount } });
    }
  }

  private async activeBenefits(
    tx: Tx,
    ctx: SchoolContext,
    schoolYearId: string,
    studentIds: string[],
  ): Promise<Map<string, BenefitScope[]>> {
    const rows = await tx.schoolBenefit.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId,
        studentId: { in: studentIds },
        status: 'ACTIVE',
      },
      select: { studentId: true, kind: true, value: true, category: true, feeId: true },
    });
    const byStudent = new Map<string, BenefitScope[]>();
    for (const r of rows) {
      byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
    }
    return byStudent;
  }

  /** Avantages qui s'appliquent à une échéance : ceux de son frais, de sa catégorie, ou de tout. */
  private applicable(benefits: BenefitScope[], feeId: string, category: string): BenefitRule[] {
    return benefits.filter((b) =>
      b.feeId ? b.feeId === feeId : b.category ? b.category === category : true,
    );
  }

  /** Élèves inscrits (inscription validée) dans le périmètre du frais : année, niveau ou classe. */
  private async eligibleStudents(
    db: Db,
    ctx: SchoolContext,
    fee: { schoolYearId: string; levelId: string | null; classId: string | null },
  ) {
    return db.schoolStudent.findMany({
      where: {
        organizationId: ctx.organizationId,
        enrollments: {
          some: {
            schoolYearId: fee.schoolYearId,
            status: 'VALIDATED',
            ...(fee.classId ? { classId: fee.classId } : {}),
            ...(fee.levelId ? { levelId: fee.levelId } : {}),
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        matricule: true,
        lastName: true,
        firstName: true,
        lastNameAr: true,
        firstNameAr: true,
      },
    });
  }

  private async assertFeeTarget(
    ctx: SchoolContext,
    schoolId: string,
    schoolYearId: string,
    levelId: string | null,
    classId: string | null,
  ) {
    if (levelId) {
      const level = await this.db.level.findFirst({
        where: { id: levelId, organizationId: ctx.organizationId, cycle: { schoolId } },
        select: { id: true },
      });
      if (!level) throw new NotFoundException(NOT_FOUND);
    }
    if (classId) {
      const cls = await this.db.schoolClass.findFirst({
        where: { id: classId, organizationId: ctx.organizationId, schoolYearId },
        select: { levelId: true },
      });
      if (!cls) throw new NotFoundException(NOT_FOUND);
      if (levelId && cls.levelId !== levelId) {
        throw new BadRequestException({
          code: 'CLASS_LEVEL_MISMATCH',
          message: 'Cette classe n’est pas de ce niveau.',
        });
      }
    }
  }

  private planInput(plan: FeePlanDto): SchoolPlanInput {
    if (plan.kind === 'ANNUAL') {
      if (!plan.dueOn) throw this.invalidPlan('Date limite requise.');
      return { kind: 'ANNUAL', dueOn: plan.dueOn };
    }
    if (plan.kind === 'CUSTOM') {
      if (!plan.installments?.length) throw this.invalidPlan('Échéances requises.');
      return {
        kind: 'CUSTOM',
        installments: plan.installments.map((i) => ({ dueOn: i.dueOn, amount: i.amount })),
      };
    }
    if (!plan.firstMonth || !plan.lastMonth || !plan.dueDay) {
      throw this.invalidPlan('Premier mois, dernier mois et jour limite requis.');
    }
    return {
      kind: plan.kind,
      firstMonth: plan.firstMonth,
      lastMonth: plan.lastMonth,
      dueDay: plan.dueDay,
    };
  }

  private installments(plan: SchoolPlanInput, amount: number) {
    try {
      return buildInstallments(plan, amount);
    } catch (error) {
      throw this.invalidPlan((error as Error).message);
    }
  }

  private invalidPlan(message: string) {
    return new BadRequestException({ code: 'INVALID_PLAN', message });
  }

  /** État historisé d'un tarif : attributs, échéancier saisi et échéances calculées. */
  private feeSnapshot(f: {
    name: string;
    nameAr: string | null;
    amount: number;
    effectiveFrom: Date;
    mandatory: boolean;
    isActive: boolean;
    planKind: string;
    plan: Prisma.JsonValue;
    installments: { position: number; dueOn: Date; amount: number }[];
  }) {
    return {
      name: f.name,
      nameAr: f.nameAr,
      amount: f.amount,
      effectiveFrom: day(f.effectiveFrom),
      mandatory: f.mandatory,
      isActive: f.isActive,
      planKind: f.planKind,
      plan: f.plan,
      installments: f.installments.map((i) => ({
        position: i.position,
        dueOn: day(i.dueOn),
        amount: i.amount,
      })),
    };
  }

  private async feeEvent(
    tx: Tx,
    ctx: SchoolContext,
    feeId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    await tx.schoolFeeEvent.create({
      data: {
        organizationId: ctx.organizationId,
        feeId,
        action,
        before: (before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonObject,
        actorUserId: ctx.userId,
      },
    });
  }

  async findFee(ctx: SchoolContext, id: string) {
    const fee = await this.db.schoolFee.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true, schoolYearId: true },
    });
    if (!fee) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, fee.schoolId);
    return fee;
  }

  private async findCharge(ctx: SchoolContext, id: string) {
    const charge = await this.db.schoolCharge.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true, studentId: true },
    });
    if (!charge) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, charge.schoolId);
    return charge;
  }

  private async assertYearOpen(tx: Tx, schoolYearId: string) {
    const { status } = await tx.schoolYear.findUniqueOrThrow({
      where: { id: schoolYearId },
      select: { status: true },
    });
    if (status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
  }
}
