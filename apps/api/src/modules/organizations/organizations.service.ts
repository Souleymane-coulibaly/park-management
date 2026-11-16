import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  BUSINESS_TYPE_LABELS,
  type BusinessType,
  canChangeBusinessType,
  productsForBusinessType,
} from '@ocall/shared';
import { isRestaurantOpen } from '../../common/park-subscription';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import type { ChangeBusinessTypeDto, UpdateOrganizationDto } from './organizations.dto';
import { OrganizationProvisioningService } from './organization-provisioning.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provisioning: OrganizationProvisioningService,
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
   * établissements, employés et historique sont conservés ; l'abonnement existant est inchangé (offre,
   * tarif, statut) et le changement est historisé.
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
      await tx.organization.update({
        where: { id: organizationId },
        data: { businessType: dto.businessType },
      });
      // L'évolution du métier ne change ni l'abonnement existant, ni son offre, ni son tarif accepté (aucune
      // modification rétroactive). Sprint 7 (décision D2) : une fois Ocall Restaurant ouvert, l'activité
      // ajoutée démarre l'essai de son application (Ocall Parc ou Ocall Restaurant), sauf contrat combiné
      // (il la couvre déjà), abonnement existant ou essai déjà utilisé.
      const started = await this.startTrialsForAddedActivities(tx, {
        organizationId,
        userId: auth.user.id,
        from: org.businessType,
        to: dto.businessType,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'organization.business_type_changed',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { from: org.businessType, to: dto.businessType, trialsStarted: started },
        },
        tx,
      );
    });
    return this.current(auth);
  }

  private async startTrialsForAddedActivities(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; userId: string; from: BusinessType; to: BusinessType },
  ): Promise<string[]> {
    if (!(await isRestaurantOpen(tx))) return [];
    const combined = await tx.parkCombinedContract.count({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
    });
    if (combined > 0) return [];
    const before = new Set(productsForBusinessType(input.from));
    const started: string[] = [];
    for (const code of productsForBusinessType(input.to).filter((c) => !before.has(c))) {
      const product = await tx.saasProduct.findUniqueOrThrow({
        where: { code },
        select: { id: true },
      });
      const [sub, trial] = await Promise.all([
        tx.subscription.count({
          where: { organizationId: input.organizationId, productId: product.id },
        }),
        tx.productTrial.count({
          where: { organizationId: input.organizationId, productId: product.id },
        }),
      ]);
      if (sub > 0 || trial > 0) continue;
      await this.provisioning.startParkFamilyTrialTx(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        offer: await this.provisioning.parkFamilyOffer(tx, code),
        combined: false,
        now: new Date(),
      });
      started.push(code);
    }
    return started;
  }
}
