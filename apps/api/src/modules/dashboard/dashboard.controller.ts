import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  activitiesOf,
  coversActivity,
  hasOrganizationWideScope,
  hasPermission,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
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
      ? await this.prisma.subscription.findUnique({
          where: { organizationId },
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

    const restaurantRevenue =
      coversActivity(businessType, 'RESTAURANT') && hasPermission(role, 'sale.read_all')
        ? await this.restaurantRevenue(
            tenant.membership.organizationId,
            tenant.membership.timezone,
            hasOrganizationWideScope(role) ? null : tenant.membership.id,
          )
        : null;

    return {
      // Revenus séparés par activité : Restaurant (caisse POS) disponible, Parc avec la billetterie.
      revenue: { RESTAURANT: restaurantRevenue, PARK: null },
      activities: activitiesOf(businessType),
      establishments: { total: establishmentsTotal, active: establishmentsActive },
      employees,
      subscription,
      recentActivity,
    };
  }

  /**
   * Chiffre d'affaires restaurant encaissé (ventes payées, non annulées), aujourd'hui et sur
   * 30 jours glissants. « Aujourd'hui » suit le fuseau horaire de l'organisation.
   * Pour un superviseur, limité aux établissements qui lui sont affectés.
   */
  private async restaurantRevenue(
    organizationId: string,
    timezone: string,
    assignedMembershipId: string | null,
  ) {
    const [row] = await this.prisma.$queryRaw<
      { today: bigint | null; last30: bigint | null; count30: bigint }[]
    >`
      SELECT
        SUM(s."total") FILTER (WHERE s."createdAt" >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})) AS today,
        SUM(s."total") AS last30,
        COUNT(*) AS count30
      FROM "Sale" s
      WHERE s."organizationId" = ${organizationId}::uuid
        AND s."status" = 'OPEN' AND s."paymentStatus" = 'PAID'
        AND s."createdAt" >= now() - interval '30 days'
        AND (${assignedMembershipId}::uuid IS NULL OR s."establishmentId" IN (
          SELECT a."establishmentId" FROM "EstablishmentAssignment" a WHERE a."membershipId" = ${assignedMembershipId}::uuid))`;
    return {
      today: Number(row?.today ?? 0),
      last30Days: Number(row?.last30 ?? 0),
      paidSalesLast30Days: Number(row?.count30 ?? 0),
    };
  }
}
