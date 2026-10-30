import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  LOYALTY_ACTIVITIES,
  type LoyaltyActivity,
  coversActivity,
  decideRedemption,
  formatSaleNumber,
  hasPermission,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { LoyaltyEarningService } from '../loyalty-earning/loyalty-earning.service';
import { lockRow, visibleSalesWhere } from '../pos/pos-scope';
import { SalesService } from '../pos/sales.service';
import type { LoyaltyAdjustmentDto, LoyaltyRuleDto } from './loyalty.dto';

const DEFAULT_RULE = {
  isActive: false,
  earnAmountStep: 1000,
  redeemValue: 10,
  minRedeemPoints: 100,
};

const REDEMPTION_MESSAGES: Record<string, string> = {
  INVALID_POINTS: 'Nombre de points invalide.',
  BELOW_MINIMUM: 'Le nombre de points est inférieur au minimum d’utilisation.',
  INSUFFICIENT_POINTS: 'Solde de points insuffisant.',
  EXCEEDS_TOTAL: 'La remise dépasserait le total de la vente.',
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Programmes de fidélité Parc et Restaurant (portefeuilles distincts, sans transfert).
 *
 * Règles garanties :
 * - crédit uniquement à la confirmation du paiement (LoyaltyEarningService, dans la transaction) ;
 * - utilisation = remise calculée par le serveur sur une vente NON payée, plafonnée au total, avec
 *   débit conditionnel (`balance >= points`) : jamais de solde négatif, même en concurrence ; une
 *   contrainte CHECK en base est le dernier rempart ;
 * - chaque mouvement porte une clé d'idempotence unique ; corrections manuelles motivées et auditées.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    private readonly earning: LoyaltyEarningService,
  ) {}

  /** Règles des activités du métier (règle inactive par défaut tant qu'elle n'est pas configurée). */
  async rules(auth: TenantContext) {
    const rows = await this.prisma.loyaltyRule.findMany({
      where: { organizationId: auth.membership.organizationId },
      select: {
        activity: true,
        isActive: true,
        earnAmountStep: true,
        redeemValue: true,
        minRedeemPoints: true,
      },
    });
    return this.activities(auth).map(
      (activity) => rows.find((r) => r.activity === activity) ?? { activity, ...DEFAULT_RULE },
    );
  }

  async putRule(auth: TenantContext, activity: LoyaltyActivity, dto: LoyaltyRuleDto) {
    if (!this.activities(auth).includes(activity)) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_IN_PLAN',
        message: "Cette activité n'est pas incluse dans le métier de votre organisation.",
      });
    }
    const organizationId = auth.membership.organizationId;
    const rule = await this.prisma.loyaltyRule.upsert({
      where: { organizationId_activity: { organizationId, activity } },
      create: { organizationId, activity, ...dto },
      update: dto,
      select: {
        activity: true,
        isActive: true,
        earnAmountStep: true,
        redeemValue: true,
        minRedeemPoints: true,
      },
    });
    await this.audit.record({
      organizationId,
      actorUserId: auth.user.id,
      action: 'loyalty.rule_updated',
      targetType: 'LoyaltyRule',
      targetId: activity,
      metadata: { ...dto },
    });
    return rule;
  }

  /** Correction manuelle : portefeuille créé au besoin ; un débit ne peut pas rendre le solde négatif. */
  async adjust(auth: TenantContext, dto: LoyaltyAdjustmentDto) {
    const organizationId = auth.membership.organizationId;
    if (!this.activities(auth).includes(dto.activity)) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_IN_PLAN',
        message: 'Activité non incluse.',
      });
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId, anonymizedAt: null },
      select: { id: true },
    });
    if (!customer)
      throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Client introuvable.' });
    const key = `adjust:${dto.clientRequestId}`;
    const replay = await this.findTransaction(organizationId, key);
    if (replay) return replay;
    try {
      await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.loyaltyWallet.upsert({
          where: { customerId_activity: { customerId: dto.customerId, activity: dto.activity } },
          create: { organizationId, customerId: dto.customerId, activity: dto.activity },
          update: {},
          select: { id: true },
        });
        const changed = await tx.loyaltyWallet.updateMany({
          where: { id: wallet.id, ...(dto.points < 0 ? { balance: { gte: -dto.points } } : {}) },
          data: { balance: { increment: dto.points } },
        });
        if (changed.count === 0) {
          throw new ConflictException({
            code: 'INSUFFICIENT_POINTS',
            message: 'La correction rendrait le solde négatif.',
          });
        }
        const { balance } = await tx.loyaltyWallet.findUniqueOrThrow({
          where: { id: wallet.id },
          select: { balance: true },
        });
        await tx.loyaltyTransaction.create({
          data: {
            organizationId,
            walletId: wallet.id,
            kind: 'ADJUST',
            points: dto.points,
            balanceAfter: balance,
            reason: dto.reason,
            actorMembershipId: auth.membership.id,
            idempotencyKey: key,
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'loyalty.adjusted',
            targetType: 'Customer',
            targetId: dto.customerId,
            metadata: { activity: dto.activity, points: dto.points, reason: dto.reason },
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findTransaction(organizationId, key);
        if (again) return again;
      }
      throw error;
    }
    return this.findTransaction(organizationId, key);
  }

  /**
   * Rattache (ou détache) un client à une vente. Sur une vente déjà payée, le rattachement crédite les
   * points une seule fois ; le client d'une vente payée ou avec remise fidélité ne change plus.
   */
  async setSaleCustomer(auth: TenantContext, saleId: string, customerId: string | null) {
    this.requireCustomerRead(auth);
    const organizationId = auth.membership.organizationId;
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, organizationId, anonymizedAt: null },
        select: { id: true },
      });
      if (!customer)
        throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Client introuvable.' });
    }
    await this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, auth, saleId);
      if (sale.status === 'CANCELLED') throw this.cancelled();
      if (sale.customerId === customerId) return;
      if (sale.loyaltyPointsRedeemed > 0) {
        throw new ConflictException({
          code: 'LOYALTY_APPLIED',
          message: 'Des points sont utilisés sur cette vente : retirez d’abord la remise.',
        });
      }
      if (sale.paymentStatus === 'PAID' && sale.customerId) {
        throw new ConflictException({
          code: 'CUSTOMER_LOCKED',
          message: 'Le client d’une vente payée ne peut plus être changé.',
        });
      }
      await tx.sale.update({ where: { id: saleId }, data: { customerId } });
      // Vente déjà payée sans client : le rattachement tardif crédite les points (une seule fois).
      if (sale.paymentStatus === 'PAID' && customerId) {
        await this.earning.onPaidSale(tx, saleId, auth.membership.id);
      }
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'sale.customer_set',
          targetType: 'Sale',
          targetId: saleId,
          metadata: { number: sale.number, customerId, paid: sale.paymentStatus === 'PAID' },
        },
        tx,
      );
    });
    return this.sales.get(auth, saleId);
  }

  /** Utilisation de points sur une vente non payée : remise calculée par le serveur. */
  async redeem(auth: TenantContext, saleId: string, points: number) {
    this.requireCustomerRead(auth);
    const organizationId = auth.membership.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, auth, saleId);
      if (sale.status === 'CANCELLED') throw this.cancelled();
      if (sale.paymentStatus === 'PAID') {
        throw new ConflictException({
          code: 'SALE_ALREADY_PAID',
          message: 'Cette vente est déjà payée.',
        });
      }
      if (!sale.customerId) {
        throw new BadRequestException({
          code: 'CUSTOMER_REQUIRED',
          message: 'Rattachez d’abord un client.',
        });
      }
      if (sale.loyaltyPointsRedeemed > 0) {
        throw new ConflictException({
          code: 'LOYALTY_ALREADY_APPLIED',
          message: 'Des points sont déjà utilisés sur cette vente.',
        });
      }
      const rule = await tx.loyaltyRule.findUnique({
        where: { organizationId_activity: { organizationId, activity: sale.activity } },
        select: { isActive: true, redeemValue: true, minRedeemPoints: true },
      });
      if (!rule?.isActive) {
        throw new ConflictException({
          code: 'LOYALTY_INACTIVE',
          message: 'Le programme de fidélité de cette activité n’est pas actif.',
        });
      }
      const wallet = await tx.loyaltyWallet.findUnique({
        where: { customerId_activity: { customerId: sale.customerId, activity: sale.activity } },
        select: { id: true, balance: true },
      });
      const decision = decideRedemption(points, wallet?.balance ?? 0, rule, sale.total);
      if (!decision.ok) {
        throw new ConflictException({
          code: decision.code,
          message: REDEMPTION_MESSAGES[decision.code],
        });
      }
      // Débit conditionnel : deux utilisations simultanées ne peuvent pas rendre le solde négatif.
      const debited = await tx.loyaltyWallet.updateMany({
        where: { id: wallet!.id, balance: { gte: decision.points } },
        data: { balance: { decrement: decision.points } },
      });
      if (debited.count === 0) {
        throw new ConflictException({
          code: 'INSUFFICIENT_POINTS',
          message: REDEMPTION_MESSAGES.INSUFFICIENT_POINTS,
        });
      }
      const { balance } = await tx.loyaltyWallet.findUniqueOrThrow({
        where: { id: wallet!.id },
        select: { balance: true },
      });
      const redeemCount = await tx.loyaltyTransaction.count({ where: { saleId, kind: 'REDEEM' } });
      await tx.loyaltyTransaction.create({
        data: {
          organizationId,
          walletId: wallet!.id,
          kind: 'REDEEM',
          points: -decision.points,
          balanceAfter: balance,
          saleId,
          reason: `Remise sur la vente n° ${formatSaleNumber(sale.number)}`,
          actorMembershipId: auth.membership.id,
          idempotencyKey: `redeem:${saleId}:${redeemCount + 1}`,
        },
      });
      await tx.sale.update({
        where: { id: saleId },
        data: {
          total: { decrement: decision.discount },
          loyaltyDiscount: decision.discount,
          loyaltyPointsRedeemed: decision.points,
        },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'loyalty.redeemed',
          targetType: 'Sale',
          targetId: saleId,
          metadata: { number: sale.number, points: decision.points, discount: decision.discount },
        },
        tx,
      );
    });
    return this.sales.get(auth, saleId);
  }

  /** Retrait de la remise avant paiement : points recrédités, total rétabli. */
  async cancelRedemption(auth: TenantContext, saleId: string) {
    await this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, auth, saleId);
      if (sale.paymentStatus === 'PAID') {
        throw new ConflictException({
          code: 'SALE_ALREADY_PAID',
          message: 'Cette vente est déjà payée.',
        });
      }
      await this.earning.reverseRedemption(tx, saleId, auth.membership.id);
    });
    return this.sales.get(auth, saleId);
  }

  private activities(auth: TenantContext): LoyaltyActivity[] {
    return LOYALTY_ACTIVITIES.filter((a) => coversActivity(auth.membership.businessType, a));
  }

  private requireCustomerRead(auth: TenantContext) {
    if (!hasPermission(auth.membership.role, 'customer.read')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
  }

  private async lockSale(tx: Prisma.TransactionClient, auth: TenantContext, saleId: string) {
    const visible = await tx.sale.findFirst({
      where: { ...visibleSalesWhere(auth), id: saleId },
      select: { id: true },
    });
    if (!visible)
      throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' });
    await lockRow(tx, 'Sale', saleId);
    return tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        status: true,
        paymentStatus: true,
        customerId: true,
        activity: true,
        total: true,
        number: true,
        loyaltyPointsRedeemed: true,
      },
    });
  }

  private cancelled() {
    return new ConflictException({ code: 'SALE_CANCELLED', message: 'Cette vente a été annulée.' });
  }

  private findTransaction(organizationId: string, idempotencyKey: string) {
    return this.prisma.loyaltyTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
      select: {
        id: true,
        kind: true,
        points: true,
        balanceAfter: true,
        reason: true,
        createdAt: true,
      },
    });
  }
}
