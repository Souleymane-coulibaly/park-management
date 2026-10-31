import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  activitiesOf,
  coversActivity,
  hasOrganizationWideScope,
  hasPermission,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { parkSubscriptionWhere } from '../../common/park-subscription';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import { establishmentScope, membershipScope } from '../../common/tenant-scope';

/**
 * Indicateurs du tableau de bord, calculés uniquement sur des données réelles.
 * Chaque bloc n'est renvoyé que si le rôle a la permission correspondante.
 */
@ApiTags('Tableau de bord')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission('dashboard.read')
  @Get()
  async summary(@CurrentAuth() auth: AuthContext) {
    const tenant = requireTenant(auth);
    const { role, organizationId, businessType } = tenant.membership;

    const [establishmentsTotal, establishmentsActive] = await Promise.all([
      this.prisma.establishment.count({ where: establishmentScope(tenant) }),
      this.prisma.establishment.count({ where: { ...establishmentScope(tenant), isActive: true } }),
    ]);

    const employees = hasPermission(role, 'employee.read')
      ? await this.prisma.organizationMembership
          .groupBy({
            by: ['role', 'isActive'],
            where: membershipScope(tenant),
            _count: { _all: true },
          })
          .then((rows) => ({
            total: rows.reduce((sum, r) => sum + r._count._all, 0),
            active: rows.filter((r) => r.isActive).reduce((sum, r) => sum + r._count._all, 0),
            byRole: rows
              .filter((r) => r.isActive)
              .reduce<Record<string, number>>(
                (acc, r) => ({ ...acc, [r.role]: (acc[r.role] ?? 0) + r._count._all }),
                {},
              ),
          }))
      : null;

    const subscription = hasPermission(role, 'subscription.read')
      ? await this.prisma.subscription.findFirst({
          where: parkSubscriptionWhere(organizationId),
          select: {
            status: true,
            expiresAt: true,
            plan: { select: { name: true, monthlyPrice: true, currency: true } },
          },
        })
      : null;

    const recentActivity = hasPermission(role, 'audit.read')
      ? await this.prisma.auditLog.findMany({
          where: { organizationId },
          select: { id: true, action: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 6,
        })
      : null;

    const revenueFor = (activity: 'RESTAURANT' | 'PARK') =>
      coversActivity(businessType, activity) && hasPermission(role, 'sale.read_all')
        ? this.revenue(
            activity,
            tenant.membership.organizationId,
            tenant.membership.timezone,
            hasOrganizationWideScope(role) ? null : tenant.membership.id,
          )
        : Promise.resolve(null);
    const [restaurantRevenue, parkRevenue] = await Promise.all([
      revenueFor('RESTAURANT'),
      revenueFor('PARK'),
    ]);

    return {
      // Revenus séparés par activité : caisse restaurant et billetterie parc ne se mélangent jamais.
      revenue: { RESTAURANT: restaurantRevenue, PARK: parkRevenue },
      activities: activitiesOf(businessType),
      establishments: { total: establishmentsTotal, active: establishmentsActive },
      employees,
      subscription,
      recentActivity,
    };
  }

  /**
   * Chiffre d'affaires encaissé d'une activité (paiements réussis de ventes non annulées, datés à
   * l'encaissement, comme les analyses du Sprint 9), aujourd'hui et sur 30 jours glissants.
   * « Aujourd'hui » suit le fuseau horaire de l'organisation.
   * Pour un superviseur, limité aux établissements qui lui sont affectés.
   */
  private async revenue(
    activity: 'RESTAURANT' | 'PARK',
    organizationId: string,
    timezone: string,
    assignedMembershipId: string | null,
  ) {
    const [row] = await this.prisma.$queryRaw<
      { today: bigint | null; last30: bigint | null; count30: bigint }[]
    >`
      SELECT
        SUM(p."amount") FILTER (WHERE p."createdAt" >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})) AS today,
        SUM(p."amount") AS last30,
        COUNT(*) AS count30
      FROM "Payment" p
      JOIN "Sale" s ON s."id" = p."saleId"
      WHERE p."organizationId" = ${organizationId}::uuid
        AND p."status" = 'SUCCEEDED'
        AND s."activity" = ${activity}::"SaleActivity"
        AND s."status" = 'OPEN'
        AND p."createdAt" >= now() - interval '30 days'
        AND (${assignedMembershipId}::uuid IS NULL OR s."establishmentId" IN (
          SELECT a."establishmentId" FROM "EstablishmentAssignment" a WHERE a."membershipId" = ${assignedMembershipId}::uuid))`;
    return {
      today: Number(row?.today ?? 0),
      last30Days: Number(row?.last30 ?? 0),
      paidSalesLast30Days: Number(row?.count30 ?? 0),
    };
  }
}
