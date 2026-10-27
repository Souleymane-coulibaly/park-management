import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { activitiesOf, hasPermission } from '@ocall/shared';
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

    return {
      // Les revenus Parc et Restaurant seront séparés par activité dès l'arrivée des modules de vente.
      activities: activitiesOf(businessType),
      establishments: { total: establishmentsTotal, active: establishmentsActive },
      employees,
      subscription,
      recentActivity,
    };
  }
}
