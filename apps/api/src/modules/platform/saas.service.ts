import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  SAAS_RENEWAL_WINDOW_DAYS,
  SUBSCRIPTION_PAYMENT_MAX_PERIOD_DAYS,
  type SaasStats,
  type SubscriptionPaymentView,
  addDays,
  localMoment,
  zonedMidnight,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import type {
  RecordSubscriptionPaymentDto,
  RejectSubscriptionPaymentDto,
  SubscriptionPaymentsQueryDto,
  ValidateSubscriptionPaymentDto,
} from './platform.dto';

/** Fuseau de référence d'Ocall pour les mois d'encaissement SaaS. */
const PLATFORM_TIMEZONE = 'Africa/Bamako';
const DAY_MS = 86_400_000;

const isRealDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  currency: true,
  method: true,
  reference: true,
  paidAt: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  note: true,
  validatedAt: true,
  rejectionReason: true,
  subscriptionExtended: true,
  createdAt: true,
  organization: { select: { id: true, name: true } },
  plan: { select: { id: true, name: true } },
  recordedBy: { select: { firstName: true, lastName: true } },
  validatedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.SubscriptionPaymentSelect;

type PaymentRow = Prisma.SubscriptionPaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

function toView(p: PaymentRow): SubscriptionPaymentView {
  const name = (u: { firstName: string; lastName: string } | null) =>
    u ? `${u.firstName} ${u.lastName}` : null;
  return {
    id: p.id,
    organization: p.organization,
    plan: p.plan,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    reference: p.reference,
    paidAt: dateOnly(p.paidAt),
    periodStart: dateOnly(p.periodStart),
    periodEnd: dateOnly(p.periodEnd),
    status: p.status,
    note: p.note,
    recordedBy: name(p.recordedBy)!,
    validatedBy: name(p.validatedBy),
    validatedAt: p.validatedAt?.toISOString() ?? null,
    rejectionReason: p.rejectionReason,
    subscriptionExtended: p.subscriptionExtended,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * Registre des règlements d'abonnement SaaS et statistiques du Super Admin (Sprint 9B).
 *
 * Les abonnements sont payés directement à Ocall, hors plateforme : le Super Admin saisit chaque
 * règlement, le vérifie, puis le valide ou le rejette. La validation ne modifie l'abonnement que
 * si le Super Admin le demande explicitement (activation / prolongation jusqu'à la fin de la
 * période couverte) — jamais de paiement ni de renouvellement automatique. Toutes les actions sont
 * journalisées ; ces encaissements restent séparés des recettes des établissements.
 */
@Injectable()
export class SaasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listPayments(query: SubscriptionPaymentsQueryDto): Promise<SubscriptionPaymentView[]> {
    const rows = await this.prisma.subscriptionPayment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      },
      select: PAYMENT_SELECT,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(toView);
  }

  async recordPayment(
    auth: AuthContext,
    dto: RecordSubscriptionPaymentDto,
  ): Promise<SubscriptionPaymentView> {
    for (const d of [dto.paidAt, dto.periodStart, dto.periodEnd]) {
      if (!isRealDate(d)) {
        throw new BadRequestException({ code: 'INVALID_DATE', message: `Date invalide : ${d}.` });
      }
    }
    if (dto.periodEnd < dto.periodStart) {
      throw new BadRequestException({
        code: 'PERIOD_INVERTED',
        message: 'La fin de période précède son début.',
      });
    }
    const span =
      (Date.parse(`${dto.periodEnd}T00:00:00Z`) - Date.parse(`${dto.periodStart}T00:00:00Z`)) /
        DAY_MS +
      1;
    if (span > SUBSCRIPTION_PAYMENT_MAX_PERIOD_DAYS) {
      throw new BadRequestException({
        code: 'PERIOD_TOO_LONG',
        message: 'La période couverte ne peut pas dépasser 3 ans.',
      });
    }
    const today = localMoment(new Date(), PLATFORM_TIMEZONE).date;
    if (dto.paidAt > addDays(today, 1)) {
      throw new BadRequestException({
        code: 'PAID_IN_FUTURE',
        message: 'La date du règlement ne peut pas être dans le futur.',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: dto.organizationId },
        select: { id: true, subscription: { select: { id: true, planId: true } } },
      });
      if (!org) {
        throw new NotFoundException({
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'Organisation introuvable.',
        });
      }
      if (!org.subscription) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_MISSING',
          message: "Cette organisation n'a pas d'abonnement.",
        });
      }
      // Même référence déjà saisie pour ce client (hors rejetés) : doublon probable.
      if (dto.reference) {
        const duplicate = await tx.subscriptionPayment.findFirst({
          where: {
            organizationId: org.id,
            reference: { equals: dto.reference, mode: 'insensitive' },
            status: { not: 'REJECTED' },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException({
            code: 'PAYMENT_DUPLICATE',
            message: 'Un règlement avec cette référence est déjà enregistré pour ce client.',
          });
        }
      }
      const payment = await tx.subscriptionPayment.create({
        data: {
          organizationId: org.id,
          subscriptionId: org.subscription.id,
          planId: org.subscription.planId,
          amount: dto.amount,
          method: dto.method,
          reference: dto.reference ?? null,
          paidAt: new Date(`${dto.paidAt}T12:00:00Z`),
          periodStart: new Date(`${dto.periodStart}T00:00:00Z`),
          periodEnd: new Date(`${dto.periodEnd}T00:00:00Z`),
          note: dto.note ?? null,
          recordedById: auth.user.id,
        },
        select: PAYMENT_SELECT,
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_payment_recorded',
          targetType: 'SubscriptionPayment',
          targetId: payment.id,
          metadata: {
            organizationId: org.id,
            amount: dto.amount,
            method: dto.method,
            reference: dto.reference ?? null,
            period: [dto.periodStart, dto.periodEnd],
          },
        },
        tx,
      );
      return payment;
    });
    return toView(created);
  }

  /**
   * Validation manuelle d'un règlement à vérifier. Transition conditionnelle (À vérifier → Validé) :
   * deux validations simultanées n'en appliquent qu'une. Avec `extendSubscription`, l'abonnement
   * passe Actif et son échéance est portée à la fin de la période couverte — jamais raccourcie.
   */
  async validatePayment(auth: AuthContext, id: string, dto: ValidateSubscriptionPaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'VALIDATED',
          validatedById: auth.user.id,
          validatedAt: new Date(),
          subscriptionExtended: dto.extendSubscription,
        },
      });
      if (claimed.count === 0) await this.notPending(tx, id);
      const payment = await tx.subscriptionPayment.findUniqueOrThrow({
        where: { id },
        select: {
          ...PAYMENT_SELECT,
          subscription: {
            select: {
              id: true,
              status: true,
              startedAt: true,
              expiresAt: true,
              organization: { select: { timezone: true } },
            },
          },
        },
      });

      let subscription: { status: string; expiresAt: string | null; changed: boolean } | null =
        null;
      if (dto.extendSubscription) {
        const s = payment.subscription;
        const tz = s.organization.timezone;
        const periodEnd = dateOnly(payment.periodEnd);
        const target = zonedMidnight(addDays(periodEnd, 1), tz);
        const expiresAt = s.expiresAt && s.expiresAt > target ? s.expiresAt : target;
        const changed = s.status !== 'ACTIVE' || s.expiresAt?.getTime() !== expiresAt.getTime();
        if (changed) {
          await tx.subscription.update({
            where: { id: s.id },
            data: {
              status: 'ACTIVE',
              startedAt: s.startedAt ?? zonedMidnight(dateOnly(payment.periodStart), tz),
              expiresAt,
            },
          });
          await tx.subscriptionEvent.create({
            data: {
              subscriptionId: s.id,
              type: 'STATUS_CHANGED',
              fromStatus: s.status,
              toStatus: 'ACTIVE',
              actorUserId: auth.user.id,
              reason: `Règlement ${payment.reference ?? payment.id} validé manuellement : échéance au ${periodEnd} inclus.`,
            },
          });
        }
        subscription = { status: 'ACTIVE', expiresAt: expiresAt.toISOString(), changed };
      }

      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_payment_validated',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: {
            organizationId: payment.organization.id,
            amount: payment.amount,
            extendSubscription: dto.extendSubscription,
            subscription,
          },
        },
        tx,
      );
      return { payment: toView(payment), subscription };
    });
  }

  async rejectPayment(auth: AuthContext, id: string, dto: RejectSubscriptionPaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          validatedById: auth.user.id,
          validatedAt: new Date(),
          rejectionReason: dto.reason,
        },
      });
      if (claimed.count === 0) await this.notPending(tx, id);
      const payment = await tx.subscriptionPayment.findUniqueOrThrow({
        where: { id },
        select: PAYMENT_SELECT,
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_payment_rejected',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: { organizationId: payment.organization.id, reason: dto.reason },
        },
        tx,
      );
      return toView(payment);
    });
  }

  private async notPending(tx: Prisma.TransactionClient, id: string): Promise<never> {
    const exists = await tx.subscriptionPayment.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!exists) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Règlement introuvable.' });
    }
    throw new ConflictException({
      code: 'PAYMENT_ALREADY_PROCESSED',
      message: 'Ce règlement a déjà été validé ou rejeté.',
    });
  }

  /** Statistiques SaaS : organisations, abonnements, offres, encaissements validés, échéances. */
  async stats(now = new Date()): Promise<SaasStats> {
    const monthStart = zonedMidnight(
      `${localMoment(now, PLATFORM_TIMEZONE).date.slice(0, 8)}01`,
      PLATFORM_TIMEZONE,
    );
    const firstMonth = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 11, 1),
    );
    const horizon = new Date(now.getTime() + SAAS_RENEWAL_WINDOW_DAYS * DAY_MS);

    const [orgs, subs, overdue, plans, subsByPlan, validated, thisMonth, pending, rejected] =
      await Promise.all([
        this.prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.subscription.count({ where: { status: 'ACTIVE', expiresAt: { lt: now } } }),
        this.prisma.subscriptionPlan.findMany({ orderBy: { monthlyPrice: 'asc' } }),
        this.prisma.subscription.groupBy({ by: ['planId', 'status'], _count: { _all: true } }),
        this.prisma.subscriptionPayment.aggregate({
          where: { status: 'VALIDATED' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.subscriptionPayment.aggregate({
          where: { status: 'VALIDATED', paidAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        this.prisma.subscriptionPayment.aggregate({
          where: { status: 'PENDING' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.subscriptionPayment.count({ where: { status: 'REJECTED' } }),
      ]);
    const months = await this.prisma.$queryRaw<{ month: string; amount: bigint; count: bigint }[]>`
      SELECT to_char(p."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PLATFORM_TIMEZONE}, 'YYYY-MM') AS month,
        SUM(p."amount") AS amount, COUNT(*) AS count
      FROM "SubscriptionPayment" p
      WHERE p."status" = 'VALIDATED' AND p."paidAt" >= ${firstMonth}
      GROUP BY 1`;
    const renewalRows = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: horizon } },
      orderBy: { expiresAt: 'asc' },
      take: 50,
      select: {
        id: true,
        expiresAt: true,
        organization: { select: { id: true, name: true, status: true } },
        plan: { select: { name: true, monthlyPrice: true } },
        payments: {
          where: { status: 'VALIDATED' },
          orderBy: { periodEnd: 'desc' },
          take: 1,
          select: { paidAt: true, periodEnd: true, amount: true },
        },
      },
    });
    const events = await this.prisma.subscriptionEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        createdAt: true,
        type: true,
        fromStatus: true,
        toStatus: true,
        fromPlanId: true,
        toPlanId: true,
        reason: true,
        subscription: { select: { organization: { select: { name: true } } } },
      },
    });
    const activeSubs = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      select: { plan: { select: { monthlyPrice: true } } },
    });

    const planName = new Map(plans.map((p) => [p.id, p.name]));
    const count = (rows: { _count: { _all: number } }[]) =>
      rows.reduce((s, r) => s + r._count._all, 0);
    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1));
      const month = d.toISOString().slice(0, 7);
      const row = months.find((m) => m.month === month);
      return { month, amount: Number(row?.amount ?? 0), count: Number(row?.count ?? 0) };
    });

    return {
      generatedAt: now.toISOString(),
      organizations: {
        total: count(orgs),
        active: count(orgs.filter((o) => o.status === 'ACTIVE')),
        suspended: count(orgs.filter((o) => o.status === 'SUSPENDED')),
      },
      subscriptions: {
        byStatus: Object.fromEntries(subs.map((s) => [s.status, s._count._all])),
        activeButOverdue: overdue,
      },
      plans: plans.map((p) => ({
        planId: p.id,
        name: p.name,
        businessType: p.businessType,
        monthlyPrice: p.monthlyPrice,
        subscriptions: count(subsByPlan.filter((s) => s.planId === p.id)),
        active: count(subsByPlan.filter((s) => s.planId === p.id && s.status === 'ACTIVE')),
      })),
      payments: {
        validatedTotal: validated._sum.amount ?? 0,
        validatedThisMonth: thisMonth._sum.amount ?? 0,
        validatedCount: validated._count._all,
        pending: { count: pending._count._all, amount: pending._sum.amount ?? 0 },
        rejectedCount: rejected,
        byMonth,
      },
      theoreticalMonthlyRevenue: activeSubs.reduce((s, x) => s + x.plan.monthlyPrice, 0),
      renewals: renewalRows.map((r) => ({
        subscriptionId: r.id,
        organization: r.organization,
        plan: r.plan.name,
        monthlyPrice: r.plan.monthlyPrice,
        expiresAt: r.expiresAt!.toISOString(),
        daysLeft: Math.floor((r.expiresAt!.getTime() - now.getTime()) / DAY_MS),
        lastValidatedPayment: r.payments[0]
          ? {
              paidAt: dateOnly(r.payments[0].paidAt),
              periodEnd: dateOnly(r.payments[0].periodEnd),
              amount: r.payments[0].amount,
            }
          : null,
      })),
      history: events.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        organization: e.subscription.organization.name,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        fromPlan: e.fromPlanId ? (planName.get(e.fromPlanId) ?? null) : null,
        toPlan: e.toPlanId ? (planName.get(e.toPlanId) ?? null) : null,
        reason: e.reason,
      })),
    };
  }
}
