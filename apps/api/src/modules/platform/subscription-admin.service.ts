import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { recordPriceChange } from '../../common/subscription-billing';

type Tx = Prisma.TransactionClient;
const EXPIRY_INTERVAL_MS = 60 * 60_000;

/**
 * Actions d'administration d'un abonnement (Sprint 12A, A49) : suspendre, réactiver, résilier,
 * changer d'offre ; historique des tarifs ; passage automatique en « expiré » des abonnements
 * échus (A28). Aucune de ces actions n'encaisse ni ne prolonge quoi que ce soit : la prolongation
 * reste liée à un encaissement confirmé.
 */
@Injectable()
export class SubscriptionAdminService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Subscriptions');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // Hors tests : vérification horaire. Idempotente ; chaque instance peut l'exécuter.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.expireDue().catch((e: unknown) => this.logger.error(`Expiration : ${String(e)}`));
    }, EXPIRY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Abonnements actifs dont l'échéance est passée → « expiré » (A28). Transition conditionnelle :
   * deux exécutions simultanées ne journalisent chaque abonnement qu'une fois.
   */
  async expireDue(now = new Date()): Promise<{ expired: number }> {
    const due = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      select: { id: true, expiresAt: true },
      take: 500,
    });
    let expired = 0;
    for (const sub of due) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.subscription.updateMany({
          where: { id: sub.id, status: 'ACTIVE', expiresAt: { lt: now } },
          data: { status: 'EXPIRED' },
        });
        if (claimed.count === 0) return;
        expired += 1;
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            type: 'STATUS_CHANGED',
            fromStatus: 'ACTIVE',
            toStatus: 'EXPIRED',
            reason: `Échéance du ${sub.expiresAt!.toISOString().slice(0, 10)} dépassée.`,
          },
        });
      });
    }
    if (expired > 0) {
      await this.audit.record({
        organizationId: null,
        actorUserId: null,
        action: 'platform.subscriptions_expired',
        targetType: 'Subscription',
        targetId: null,
        metadata: { expired },
      });
    }
    return { expired };
  }

  async suspend(auth: AuthContext, id: string, reason: string) {
    return this.transition(
      auth,
      id,
      ['ACTIVE', 'PAST_DUE', 'PENDING_ACTIVATION', 'NOT_ACTIVATED'],
      () => 'SUSPENDED',
      reason,
      'platform.subscription_suspended',
    );
  }

  /** Réactivation d'un abonnement suspendu : actif si son échéance n'est pas passée, sinon expiré. */
  async reactivate(auth: AuthContext, id: string, reason: string) {
    return this.transition(
      auth,
      id,
      ['SUSPENDED'],
      (s) =>
        s.expiresAt && s.expiresAt > new Date()
          ? 'ACTIVE'
          : s.startedAt
            ? 'EXPIRED'
            : 'NOT_ACTIVATED',
      reason,
      'platform.subscription_reactivated',
    );
  }

  /** Résiliation : définitive ; un règlement ne peut plus le réactiver. */
  async cancel(auth: AuthContext, id: string, reason: string) {
    return this.transition(
      auth,
      id,
      ['NOT_ACTIVATED', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'SUSPENDED', 'PENDING_ACTIVATION'],
      () => 'CANCELED',
      reason,
      'platform.subscription_canceled',
    );
  }

  /**
   * Changement d'offre (même produit, offre active) : le tarif de la nouvelle offre devient le
   * tarif accepté (historisé) et son mode d'activation est figé. Refusé avec une activation en
   * attente (décider d'abord) ou sur un abonnement résilié.
   */
  async changePlan(auth: AuthContext, id: string, planId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const sub = await this.find(tx, id);
      if (sub.status === 'CANCELED') {
        throw new ConflictException({
          code: 'SUBSCRIPTION_CANCELED',
          message: 'Abonnement résilié : son offre ne peut plus être changée.',
        });
      }
      if (sub.planId === planId) {
        throw new BadRequestException({ code: 'PLAN_UNCHANGED', message: 'C’est déjà son offre.' });
      }
      const plan = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!plan || plan.productId !== sub.productId || !plan.isActive) {
        throw new BadRequestException({
          code: 'PLAN_INVALID',
          message: 'Offre inconnue, inactive ou d’un autre produit.',
        });
      }
      const pending = await tx.subscriptionPayment.count({
        where: { subscriptionId: id, activationStatus: 'PENDING' },
      });
      if (pending > 0) {
        throw new ConflictException({
          code: 'ACTIVATION_PENDING',
          message: 'Une activation attend une décision : approuvez-la ou refusez-la d’abord.',
        });
      }
      const now = new Date();
      await tx.subscription.update({
        where: { id },
        data: {
          planId,
          activationMode: plan.activationMode,
          agreedSetupFee: plan.setupFee,
          agreedMonthlyPrice: plan.monthlyPrice,
          agreedAt: now,
        },
      });
      await recordPriceChange(tx, {
        subscriptionId: id,
        planId,
        setupFee: plan.setupFee,
        monthlyPrice: plan.monthlyPrice,
        currency: plan.currency,
        actorUserId: auth.user.id,
        reason: `Changement d'offre : ${reason}`,
        at: now,
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: id,
          type: 'PLAN_CHANGED',
          fromPlanId: sub.planId,
          toPlanId: planId,
          actorUserId: auth.user.id,
          reason,
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_plan_changed',
          targetType: 'Subscription',
          targetId: id,
          metadata: {
            organizationId: sub.organizationId,
            fromPlanId: sub.planId,
            toPlanId: planId,
            monthlyPrice: plan.monthlyPrice,
            activationMode: plan.activationMode,
            reason,
          },
        },
        tx,
      );
      return { id, planId, activationMode: plan.activationMode };
    });
  }

  /** Historique d'un abonnement : tarifs appliqués et évènements. */
  async history(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        activationMode: true,
        priceHistory: {
          orderBy: { effectiveFrom: 'desc' },
          select: {
            id: true,
            setupFee: true,
            monthlyPrice: true,
            currency: true,
            effectiveFrom: true,
            effectiveTo: true,
            reason: true,
            plan: { select: { name: true } },
          },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            type: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
    if (!sub) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Abonnement introuvable.',
      });
    }
    return sub;
  }

  private async transition(
    auth: AuthContext,
    id: string,
    from: readonly string[],
    to: (s: { expiresAt: Date | null; startedAt: Date | null }) => string,
    reason: string,
    action: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const sub = await this.find(tx, id);
      if (!from.includes(sub.status)) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_STATUS_CONFLICT',
          message: `Action impossible depuis le statut ${sub.status}.`,
          status: sub.status,
        });
      }
      const target = to(sub) as 'ACTIVE';
      await tx.subscription.update({ where: { id }, data: { status: target } });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: id,
          type: 'STATUS_CHANGED',
          fromStatus: sub.status,
          toStatus: target,
          actorUserId: auth.user.id,
          reason,
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action,
          targetType: 'Subscription',
          targetId: id,
          metadata: { organizationId: sub.organizationId, from: sub.status, to: target, reason },
        },
        tx,
      );
      return { id, status: target };
    });
  }

  private async find(tx: Tx, id: string) {
    const sub = await tx.subscription.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        planId: true,
        productId: true,
        organizationId: true,
        expiresAt: true,
        startedAt: true,
      },
    });
    if (!sub) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Abonnement introuvable.',
      });
    }
    return sub;
  }
}
