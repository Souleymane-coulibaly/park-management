import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { parkSubscriptionWhere } from '../../common/park-subscription';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, Public, RequirePermission } from '../../common/decorators';

@ApiTags('Abonnements')
@Controller()
export class SubscriptionsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Offres publiques : la page Tarifs lit les prix ici, jamais en dur dans le frontend. */
  @Public()
  @Get('plans')
  plans() {
    return this.prisma.subscriptionPlan.findMany({
      // Page Tarifs : offres actives des produits Ocall Park commercialisés.
      where: { isActive: true, businessType: { not: null }, product: { status: 'AVAILABLE' } },
      select: {
        id: true,
        businessType: true,
        name: true,
        monthlyPrice: true,
        setupFee: true,
        currency: true,
      },
      orderBy: { monthlyPrice: 'asc' },
    });
  }

  /** Abonnement de l'organisation courante, en lecture seule. */
  @RequirePermission('subscription.read')
  @Get('subscription')
  async current(@CurrentAuth() auth: AuthContext) {
    const { membership } = requireTenant(auth);
    const subscription = await this.prisma.subscription.findFirst({
      where: parkSubscriptionWhere(membership.organizationId),
      select: {
        status: true,
        startedAt: true,
        expiresAt: true,
        plan: { select: { name: true, businessType: true, monthlyPrice: true, currency: true } },
        events: {
          select: { type: true, fromStatus: true, toStatus: true, reason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!subscription)
      throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Aucun abonnement.' });
    return subscription;
  }
}
