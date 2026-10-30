import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { PasswordService } from '../../common/security/password.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import type {
  CreateOrganizationByAdminDto,
  SetOrganizationStatusDto,
  UpdatePlanDto,
} from './platform.dto';

/**
 * Administration du SaaS. Le Super Admin voit des métadonnées et des agrégats
 * (statut, métier, nombre d'établissements et de comptes, abonnement), jamais
 * les données commerciales des clients ni la liste nominative de leurs employés.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly provisioning: OrganizationProvisioningService,
  ) {}

  async overview() {
    const [byStatus, byBusinessType, subscriptionsByStatus, activeSubscriptions, activeAccounts] =
      await Promise.all([
        this.prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.organization.groupBy({ by: ['businessType'], _count: { _all: true } }),
        this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.subscription.findMany({
          where: { status: 'ACTIVE' },
          select: { plan: { select: { monthlyPrice: true } } },
        }),
        this.prisma.organizationMembership.count({
          where: { isActive: true, organization: { status: 'ACTIVE' } },
        }),
      ]);
    const count = <K extends string>(
      rows: ({ _count: { _all: number } } & Record<string, unknown>)[],
      key: K,
    ) => Object.fromEntries(rows.map((r) => [r[key] as string, r._count._all]));
    return {
      organizations: {
        total: byStatus.reduce((s, r) => s + r._count._all, 0),
        byStatus: count(byStatus, 'status'),
        byBusinessType: count(byBusinessType, 'businessType'),
      },
      subscriptions: { byStatus: count(subscriptionsByStatus, 'status') },
      /** Revenu mensuel récurrent des abonnements actifs, en FCFA. */
      monthlyRecurringRevenue: activeSubscriptions.reduce((s, sub) => s + sub.plan.monthlyPrice, 0),
      activeAccounts,
    };
  }

  async organizations() {
    const rows = await this.prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        businessType: true,
        countryCode: true,
        status: true,
        createdAt: true,
        subscription: {
          select: {
            status: true,
            expiresAt: true,
            plan: { select: { name: true, monthlyPrice: true } },
          },
        },
        _count: { select: { establishments: true, memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ _count, ...org }) => ({
      ...org,
      establishmentsCount: _count.establishments,
      accountsCount: _count.memberships,
    }));
  }

  /** Crée une organisation et son premier propriétaire, avec un mot de passe temporaire affiché une seule fois. */
  async createOrganization(auth: AuthContext, dto: CreateOrganizationByAdminDto) {
    if (
      await this.prisma.user.findUnique({ where: { email: dto.ownerEmail }, select: { id: true } })
    ) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Un compte existe déjà avec cet e-mail.',
      });
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const created = await this.prisma.$transaction(async (tx) => {
      const result = await this.provisioning.provision(tx, {
        organizationName: dto.organizationName,
        businessType: dto.businessType,
        countryCode: dto.countryCode,
        establishmentName: dto.establishmentName,
        owner: {
          firstName: dto.ownerFirstName,
          lastName: dto.ownerLastName,
          email: dto.ownerEmail,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.organization_created',
          targetType: 'Organization',
          targetId: result.organizationId,
        },
        tx,
      );
      return result;
    });
    return {
      organizationId: created.organizationId,
      ownerLoginId: created.loginId,
      ownerEmail: dto.ownerEmail,
      temporaryPassword,
    };
  }

  /** La suspension révoque immédiatement toutes les sessions des membres de l'organisation. */
  async setStatus(auth: AuthContext, id: string, dto: SetOrganizationStatusDto) {
    await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({ where: { id }, select: { status: true } });
      if (!org)
        throw new NotFoundException({
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'Organisation introuvable.',
        });
      await tx.organization.update({ where: { id }, data: { status: dto.status } });
      if (dto.status === 'SUSPENDED') {
        await tx.session.updateMany({
          where: { membership: { organizationId: id }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.organization_status_changed',
          targetType: 'Organization',
          targetId: id,
          metadata: { from: org.status, to: dto.status },
        },
        tx,
      );
    });
    return { id, status: dto.status };
  }

  subscriptions() {
    return this.prisma.subscription.findMany({
      select: {
        id: true,
        status: true,
        startedAt: true,
        expiresAt: true,
        organization: { select: { id: true, name: true, businessType: true } },
        plan: { select: { name: true, monthlyPrice: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  plans() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { monthlyPrice: 'asc' } });
  }

  async updatePlan(auth: AuthContext, id: string, dto: UpdatePlanDto) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.findUnique({ where: { id } });
      if (!plan)
        throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Offre introuvable.' });
      const updated = await tx.subscriptionPlan.update({ where: { id }, data: dto });
      // Historique des prix : l'ancienne et la nouvelle valeur sont conservées dans l'audit.
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.plan_updated',
          targetType: 'SubscriptionPlan',
          targetId: id,
          metadata: {
            before: {
              name: plan.name,
              monthlyPrice: plan.monthlyPrice,
              setupFee: plan.setupFee,
              isActive: plan.isActive,
            },
            after: { ...dto },
          },
        },
        tx,
      );
      return updated;
    });
  }
}
