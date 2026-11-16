import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  type BusinessType,
  DEFAULT_TIMEZONE,
  PARK_PRODUCT_CODE,
  SUPPORTED_COUNTRIES,
  parkProductCode,
  productsForBusinessType,
  trialEndsAt,
} from '@ocall/shared';
import { randomInt } from 'node:crypto';
import { notifyOrganization } from '../../common/suite-notify';
import { isRestaurantOpen, keepCombinedBeforeOpening } from '../../common/park-subscription';

/** Offre d'essai d'une application de la famille Park (sprint 7). */
export interface ParkFamilyOffer {
  code: string;
  productId: string;
  productName: string;
  plan: { id: string; trialDays: number };
}

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

    // Vérifie que le métier relève de Park. Sprint 7 : avant l'ouverture d'Ocall Restaurant, une seule
    // application Ocall Park (contrat combiné parc et restaurant, comme le socle S1) ; après, une
    // application par activité du métier (Ocall Parc et/ou Ocall Restaurant, décision D2) — deux
    // abonnements distincts, une seule inscription, une seule session.
    parkProductCode(input.businessType);
    const restaurantOpen = await isRestaurantOpen(tx);
    const productCodes = restaurantOpen
      ? productsForBusinessType(input.businessType)
      : [PARK_PRODUCT_CODE];
    // Étape 6 : jamais d'offre par site choisie automatiquement (le prix le plus bas n'est pas une règle
    // commerciale) ; elle n'est attribuée que par un changement d'offre explicite validé par Ocall.
    const offers: ParkFamilyOffer[] = [];
    for (const code of productCodes) offers.push(await this.parkFamilyOffer(tx, code));

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

    // Abonnements de la famille Park : l'essai gratuit démarre à l'activation effective du compte (socle
    // S1), une seule fois par organisation et application (unicité en base), dates calculées en UTC.
    const now = new Date();
    for (const offer of offers) {
      await this.startParkFamilyTrialTx(tx, {
        organizationId: organization.id,
        userId: user.id,
        offer,
        combined: !restaurantOpen,
        now,
      });
    }

    return {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      loginId,
    };
  }

  /**
   * Essai d'une application de la famille Park (abonnement en essai, évènement, notification). Sprint 7 :
   * `combined` (avant l'ouverture d'Ocall Restaurant) garde l'abonnement Ocall Park combiné.
   */
  async startParkFamilyTrialTx(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      userId: string;
      offer: ParkFamilyOffer;
      combined: boolean;
      now: Date;
    },
  ): Promise<string> {
    const { offer } = input;
    const endsAt = trialEndsAt(input.now, offer.plan.trialDays);
    await tx.productTrial.create({
      data: {
        organizationId: input.organizationId,
        productId: offer.productId,
        startedAt: input.now,
        endsAt,
        startedByUserId: input.userId,
      },
    });
    const subscription = await tx.subscription.create({
      data: {
        organizationId: input.organizationId,
        productId: offer.productId,
        planId: offer.plan.id,
        status: 'TRIALING',
      },
    });
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        type: 'CREATED',
        toPlanId: offer.plan.id,
        toStatus: 'TRIALING',
        actorUserId: input.userId,
        reason: `Essai gratuit de ${offer.plan.trialDays} jours.`,
      },
    });
    if (input.combined) {
      await keepCombinedBeforeOpening(tx, {
        id: subscription.id,
        organizationId: input.organizationId,
        productCode: offer.code,
      });
    }
    // Sprint S2 : le propriétaire est prévenu dans le portail Ocall Suite.
    await notifyOrganization(tx, {
      organizationId: input.organizationId,
      kind: 'TRIAL_STARTED',
      productCode: offer.code,
      params: { productName: offer.productName, endsAt: endsAt.toISOString() },
      dedupeKey: `trial-start:${subscription.id}`,
    });
    return subscription.id;
  }

  /** Offre forfaitaire d'essai d'une application de la famille Park (jamais une offre par site). */
  async parkFamilyOffer(tx: Prisma.TransactionClient, code: string): Promise<ParkFamilyOffer> {
    const plan = await tx.subscriptionPlan.findFirst({
      where: { product: { code }, isActive: true, pricingMode: 'FLAT' },
      orderBy: [{ includesShowcase: 'asc' }, { monthlyPrice: 'asc' }],
      select: { id: true, trialDays: true, product: { select: { id: true, name: true } } },
    });
    if (!plan)
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'Aucune offre pour ce métier.',
      });
    return {
      code,
      productId: plan.product!.id,
      productName: code === PARK_PRODUCT_CODE ? 'Ocall Park' : plan.product!.name,
      plan: { id: plan.id, trialDays: plan.trialDays },
    };
  }

  /**
   * Client d'un produit vendu sur contrat (ex. Ocall School) : organisation sans activité Ocall Park,
   * sans établissement Park ni abonnement, et propriétaire au mot de passe temporaire.
   */
  async provisionContractClient(
    tx: Prisma.TransactionClient,
    input: {
      organizationName: string;
      countryCode: string;
      owner: { firstName: string; lastName: string; email: string; passwordHash: string };
    },
  ): Promise<{ organizationId: string; userId: string; loginId: string }> {
    const country = SUPPORTED_COUNTRIES.find((c) => c.code === input.countryCode);
    if (!country)
      throw new BadRequestException({
        code: 'UNSUPPORTED_COUNTRY',
        message: 'Pays non pris en charge.',
      });
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        code: await this.uniqueCode(tx, input.organizationName),
        businessType: 'NONE',
        countryCode: country.code,
        currency: 'XOF',
        timezone: country.timezone ?? DEFAULT_TIMEZONE,
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
        mustChangePassword: true,
      },
    });
    await tx.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
    });
    return { organizationId: organization.id, userId: user.id, loginId };
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
