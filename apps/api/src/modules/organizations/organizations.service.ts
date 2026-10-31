import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BUSINESS_TYPE_LABELS, canChangeBusinessType, PARK_APP_PRODUCTS } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { parkSubscriptionWhere } from '../../common/park-subscription';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { recordPriceChange } from '../../common/subscription-billing';
import type { ChangeBusinessTypeDto, UpdateOrganizationDto } from './organizations.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** L'organisation est toujours celle de la session, jamais un identifiant fourni par le client. */
  async current(auth: TenantContext) {
    const org = await this.prisma.organization.findUnique({
      where: { id: auth.membership.organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        businessType: true,
        countryCode: true,
        currency: true,
        timezone: true,
        status: true,
        createdAt: true,
      },
    });
    if (!org) throw new NotFoundException();
    return org;
  }

  async update(auth: TenantContext, dto: UpdateOrganizationDto) {
    const organizationId = auth.membership.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { name: dto.name, timezone: dto.timezone },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'organization.updated',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { ...dto },
        },
        tx,
      );
    });
    return this.current(auth);
  }

  /**
   * Évolution du métier (PARK ou RESTAURANT → PARK_RESTAURANT). Aucune donnée n'est supprimée :
   * établissements, employés et historique sont conservés ; l'abonnement bascule sur l'offre du
   * nouveau métier en gardant son statut, et le changement est historisé.
   */
  async changeBusinessType(auth: TenantContext, dto: ChangeBusinessTypeDto) {
    const organizationId = auth.membership.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { businessType: true },
      });
      if (!canChangeBusinessType(org.businessType, dto.businessType)) {
        throw new BadRequestException({
          code: 'BUSINESS_TYPE_CHANGE_NOT_ALLOWED',
          message: `Évolution impossible de « ${BUSINESS_TYPE_LABELS[org.businessType]} » vers « ${BUSINESS_TYPE_LABELS[dto.businessType]} ».`,
        });
      }
      const plan = await tx.subscriptionPlan.findFirstOrThrow({
        where: { product: { code: PARK_APP_PRODUCTS[dto.businessType] }, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      await tx.organization.update({
        where: { id: organizationId },
        data: { businessType: dto.businessType },
      });

      // L'abonnement Ocall Park change de produit et d'offre ; le tarif précédemment accepté est
      // conservé dans l'historique et sera refigé à la prochaine facture ou activation.
      const current = await tx.subscription.findFirst({
        where: parkSubscriptionWhere(organizationId),
      });
      if (current) {
        const product = await tx.saasProduct.findUniqueOrThrow({
          where: { code: PARK_APP_PRODUCTS[dto.businessType] },
          select: { id: true },
        });
        await tx.subscription.update({
          where: { id: current.id },
          data: {
            planId: plan.id,
            productId: product.id,
            agreedSetupFee: null,
            agreedMonthlyPrice: null,
            agreedAt: null,
            activationMode: plan.activationMode,
          },
        });
        await recordPriceChange(tx, {
          subscriptionId: current.id,
          planId: plan.id,
          setupFee: null,
          monthlyPrice: null,
          currency: plan.currency,
          actorUserId: auth.user.id,
          reason: `Changement de métier ${org.businessType} → ${dto.businessType}`,
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: current.id,
            type: 'PLAN_CHANGED',
            fromPlanId: current.planId,
            toPlanId: plan.id,
            actorUserId: auth.user.id,
            reason:
              `Évolution du métier ${org.businessType} → ${dto.businessType}` +
              (current.agreedMonthlyPrice !== null
                ? ` (tarif accepté précédent : ${current.agreedSetupFee ?? 0} + ${current.agreedMonthlyPrice}/mois)`
                : ''),
          },
        });
      }
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'organization.business_type_changed',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { from: org.businessType, to: dto.businessType },
        },
        tx,
      );
    });
    return this.current(auth);
  }
}
