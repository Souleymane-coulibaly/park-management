import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { type BusinessType, DEFAULT_TIMEZONE, SUPPORTED_COUNTRIES } from '@ocall/shared';
import { randomInt } from 'node:crypto';

export interface ProvisionOrganizationInput {
  organizationName: string;
  businessType: BusinessType;
  countryCode: string;
  timezone?: string;
  establishmentName: string;
  owner: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    mustChangePassword: boolean;
  };
}

export interface ProvisionedOrganization {
  organizationId: string;
  userId: string;
  membershipId: string;
  loginId: string;
}

/**
 * Création d'une organisation cliente complète, dans une transaction :
 * organisation, premier établissement, propriétaire, adhésion OWNER et abonnement non activé.
 * Partagé par l'inscription publique et la création par le Super Admin.
 */
@Injectable()
export class OrganizationProvisioningService {
  async provision(
    tx: Prisma.TransactionClient,
    input: ProvisionOrganizationInput,
  ): Promise<ProvisionedOrganization> {
    const country = SUPPORTED_COUNTRIES.find((c) => c.code === input.countryCode);
    if (!country)
      throw new BadRequestException({
        code: 'UNSUPPORTED_COUNTRY',
        message: 'Pays non pris en charge.',
      });
    const timezone = input.timezone ?? country.timezone ?? DEFAULT_TIMEZONE;

    const plan = await tx.subscriptionPlan.findUnique({
      where: { businessType: input.businessType },
    });
    if (!plan)
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'Aucune offre pour ce métier.',
      });

    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        code: await this.uniqueCode(tx, input.organizationName),
        businessType: input.businessType,
        countryCode: country.code,
        currency: 'XOF',
        timezone,
      },
    });

    await tx.establishment.create({
      data: {
        organizationId: organization.id,
        name: input.establishmentName,
        businessType: input.businessType,
        timezone,
      },
    });

    const loginId = await this.allocateLoginId(tx, organization.id);
    const user = await tx.user.create({
      data: {
        firstName: input.owner.firstName,
        lastName: input.owner.lastName,
        email: input.owner.email,
        loginId,
        passwordHash: input.owner.passwordHash,
        mustChangePassword: input.owner.mustChangePassword,
        passwordChangedAt: input.owner.mustChangePassword ? null : new Date(),
      },
    });
    const membership = await tx.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
    });

    const subscription = await tx.subscription.create({
      data: { organizationId: organization.id, planId: plan.id, status: 'NOT_ACTIVATED' },
    });
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        type: 'CREATED',
        toPlanId: plan.id,
        toStatus: 'NOT_ACTIVATED',
        actorUserId: user.id,
      },
    });

    return {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      loginId,
    };
  }

  /** Identifiant employé unique : CODE-0001, CODE-0002… (compteur atomique par organisation). */
  async allocateLoginId(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    const org = await tx.organization.update({
      where: { id: organizationId },
      data: { employeeSeq: { increment: 1 } },
      select: { code: true, employeeSeq: true },
    });
    return `${org.code}-${String(org.employeeSeq).padStart(4, '0')}`;
  }

  /** Code court dérivé du nom (« Aqua Splash Bamako » → « AQUASP »), suffixé en cas de collision. */
  private async uniqueCode(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 6) || 'ORG';
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = attempt === 0 ? base : `${base.slice(0, 4)}${randomInt(10, 99)}`;
      const taken = await tx.organization.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base.slice(0, 3)}${randomInt(1000, 9999)}`;
  }
}
