import { Injectable } from '@nestjs/common';
import {
  SAAS_RENEWAL_WINDOW_DAYS,
  type SaasStats,
  localMoment,
  zonedMidnight,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

/** Fuseau de référence d'Ocall pour les mois d'encaissement SaaS. */
const PLATFORM_TIMEZONE = 'Africa/Bamako';
const DAY_MS = 86_400_000;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Statistiques SaaS du Super Admin (Sprint 9B). Les règlements eux-mêmes (déclaration,
 * confirmation, activation) relèvent de SubscriptionPaymentsService (Sprint 12A). Ces
 * encaissements restent séparés des recettes des établissements.
 */
@Injectable()
export class SaasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
          where: { status: 'CONFIRMED' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.subscriptionPayment.aggregate({
          where: { status: 'CONFIRMED', paidAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        this.prisma.subscriptionPayment.aggregate({
          where: { status: { in: ['DECLARED', 'PENDING_VERIFICATION'] } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.subscriptionPayment.count({ where: { status: 'REJECTED' } }),
      ]);
    const months = await this.prisma.$queryRaw<{ month: string; amount: bigint; count: bigint }[]>`
      SELECT to_char(p."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PLATFORM_TIMEZONE}, 'YYYY-MM') AS month,
        SUM(p."amount") AS amount, COUNT(*) AS count
      FROM "SubscriptionPayment" p
      WHERE p."status" = 'CONFIRMED' AND p."paidAt" >= ${firstMonth}
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
          where: { status: 'CONFIRMED' },
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
      select: { agreedMonthlyPrice: true, plan: { select: { monthlyPrice: true } } },
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
      theoreticalMonthlyRevenue: activeSubs.reduce(
        (s, x) => s + (x.agreedMonthlyPrice ?? x.plan.monthlyPrice),
        0,
      ),
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
