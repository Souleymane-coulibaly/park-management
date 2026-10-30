import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  type PreparationAction,
  type PreparationStatus,
  addDays,
  decidePreparationTransition,
  hasOrganizationWideScope,
  localMoment,
  zonedMidnight,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { recordOrderEvent } from '../pos/order-events';
import { findSellingEstablishment, lockRow, visibleSalesWhere } from '../pos/pos-scope';
import { SalePricingService } from '../pos/sale-pricing.service';
import { SALE_LINE_ORDER, SALE_SELECT, SalesService, toSale } from '../pos/sales.service';
import { RestaurantEventsService } from '../realtime/restaurant-events.service';
import { StockConsumptionService } from '../stock-consumption/stock-consumption.service';
import { DiningService } from './dining.service';
import type { CreateOrderDto, OrdersQueryDto, UpdateOrderDto } from './restaurant.dto';

const NOT_FOUND = { code: 'ORDER_NOT_FOUND', message: 'Commande introuvable.' };

/** Champ horodaté à chaque étape de préparation. */
const STAMP: Partial<Record<PreparationStatus, keyof Prisma.SaleUpdateManyMutationInput>> = {
  SENT: 'sentToKitchenAt',
  IN_PREPARATION: 'preparationStartedAt',
  READY: 'readyAt',
  SERVED: 'servedAt',
};

const EVENT: Record<PreparationAction, { history: string; realtime: string }> = {
  send: { history: 'sent_to_kitchen', realtime: 'order.sent' },
  start: { history: 'preparation_started', realtime: 'order.started' },
  ready: { history: 'ready', realtime: 'order.ready' },
  serve: { history: 'served', realtime: 'order.served' },
};

/** Une commande prête reste affichée en cuisine jusqu'au service, au plus 6 heures. */
const READY_DISPLAY_MS = 6 * 60 * 60 * 1000;

const KITCHEN_SELECT = {
  id: true,
  number: true,
  channel: true,
  notes: true,
  preparationStatus: true,
  sentToKitchenAt: true,
  preparationStartedAt: true,
  readyAt: true,
  table: { select: { name: true } },
  zone: { select: { name: true } },
  // Aucun prix : la cuisine n'en a pas besoin.
  lines: {
    orderBy: SALE_LINE_ORDER,
    select: { id: true, productName: true, variantName: true, quantity: true, notes: true },
  },
} as const satisfies Prisma.SaleSelect;

/**
 * Commandes du restaurant, construites sur le moteur de vente commun (Sprint 2) :
 * - paiement et préparation sont deux statuts indépendants ;
 * - seule l'action explicite « Envoyer en cuisine » (permission order.send_kitchen) fait entrer une
 *   commande en cuisine ; payer ne l'y envoie jamais ;
 * - chaque transition est idempotente (une action rejouée ne modifie rien), verrouillée, historisée
 *   (OrderEvent) et diffusée en temps réel après validation de la transaction.
 */
@Injectable()
export class RestaurantOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    private readonly pricing: SalePricingService,
    private readonly stock: StockConsumptionService,
    private readonly dining: DiningService,
    private readonly events: RestaurantEventsService,
  ) {}

  async create(auth: TenantContext, dto: CreateOrderDto) {
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId, 'RESTAURANT');
    const location = await this.dining.resolveLocation(
      auth,
      dto.establishmentId,
      dto.tableId,
      dto.zoneId,
    );
    return this.sales.createSale(auth, {
      establishmentId: dto.establishmentId,
      activity: 'RESTAURANT',
      clientRequestId: dto.clientRequestId,
      order: { channel: dto.channel, ...location, notes: dto.notes ?? null },
      price: (tx, organizationId) =>
        this.pricing.price(tx, organizationId, dto.establishmentId, dto.lines),
    });
  }

  async list(auth: TenantContext, query: OrdersQueryDto) {
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      query.establishmentId,
      'RESTAURANT',
    );
    const today = localMoment(new Date(), establishment.timezone).date;
    const where: Prisma.SaleWhereInput = {
      ...visibleSalesWhere(auth),
      establishmentId: establishment.id,
      activity: 'RESTAURANT',
      tableId: query.tableId,
    };
    if ((query.view ?? 'active') === 'active') {
      where.status = 'OPEN';
      where.OR = [{ paymentStatus: 'UNPAID' }, { preparationStatus: { not: 'SERVED' } }];
      // Les commandes oubliées depuis plusieurs jours ne polluent pas la vue de service.
      where.createdAt = { gte: zonedMidnight(addDays(today, -1), establishment.timezone) };
    } else {
      where.createdAt = {
        gte: zonedMidnight(today, establishment.timezone),
        lt: zonedMidnight(addDays(today, 1), establishment.timezone),
      };
    }
    const rows = await this.prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: SALE_SELECT,
    });
    return rows.map(toSale);
  }

  /** Commande et son historique complet. */
  async get(auth: TenantContext, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { ...visibleSalesWhere(auth), id, activity: 'RESTAURANT' },
      select: {
        ...SALE_SELECT,
        events: {
          orderBy: { createdAt: 'asc' },
          select: {
            type: true,
            fromStatus: true,
            toStatus: true,
            createdAt: true,
            metadata: true,
            actor: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    });
    if (!sale) throw new NotFoundException(NOT_FOUND);
    const { events, ...rest } = sale;
    return {
      ...toSale(rest),
      events: events.map(({ actor, metadata, ...e }) => ({
        ...e,
        metadata: metadata as Record<string, unknown> | null,
        actorName: actor ? `${actor.user.firstName} ${actor.user.lastName}` : null,
      })),
    };
  }

  /**
   * Modification d'une commande. Interdite après paiement (ORDER_LOCKED_PAID). Les articles et les
   * instructions sont figés dès l'envoi en cuisine (ORDER_LOCKED_SENT) ; la table peut encore changer.
   * Les montants sont recalculés par le serveur.
   */
  async update(auth: TenantContext, id: string, dto: UpdateOrderDto) {
    const organizationId = auth.membership.organizationId;
    const updated = await this.prisma.$transaction(async (tx) => {
      const sale = await this.lockVisible(tx, auth, id);
      if (sale.status === 'CANCELLED') throw this.cancelled();
      if (sale.paymentStatus === 'PAID') {
        throw new ConflictException({
          code: 'ORDER_LOCKED_PAID',
          message: 'Une commande payée ne peut plus être modifiée.',
        });
      }
      const changesContent = dto.lines !== undefined || dto.notes !== undefined;
      if (changesContent && sale.preparationStatus !== 'NOT_SENT') {
        throw new ConflictException({
          code: 'ORDER_LOCKED_SENT',
          message: 'La commande est déjà en cuisine : ses articles ne peuvent plus être modifiés.',
        });
      }
      if (dto.lines !== undefined && sale.loyaltyDiscount > 0) {
        throw new ConflictException({
          code: 'LOYALTY_APPLIED',
          message:
            'Des points de fidélité sont utilisés : retirez la remise avant de modifier les articles.',
        });
      }
      const data: Prisma.SaleUncheckedUpdateInput = {};
      if (dto.tableId !== undefined || dto.zoneId !== undefined) {
        const location = await this.dining.resolveLocation(
          auth,
          sale.establishmentId,
          dto.tableId === undefined ? sale.tableId : dto.tableId,
          dto.zoneId === undefined && dto.tableId === undefined ? sale.zoneId : dto.zoneId,
        );
        data.tableId = location.tableId;
        data.zoneId = location.zoneId;
      }
      if (dto.notes !== undefined) data.notes = dto.notes;
      let total = sale.total;
      if (dto.lines) {
        const priced = await this.pricing.price(
          tx,
          organizationId,
          sale.establishmentId,
          dto.lines,
        );
        await tx.saleLine.deleteMany({ where: { saleId: id } });
        await tx.saleLine.createMany({
          data: priced.lines.map((l, lineNo) => ({ ...l, lineNo, organizationId, saleId: id })),
        });
        total = priced.total;
        data.total = total;
      }
      await tx.sale.update({ where: { id }, data });
      const metadata = {
        previousTotal: sale.total,
        total,
        linesChanged: !!dto.lines,
        tableId: data.tableId ?? null,
      };
      await recordOrderEvent(tx, {
        organizationId,
        establishmentId: sale.establishmentId,
        saleId: id,
        type: 'updated',
        actorMembershipId: auth.membership.id,
        metadata,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'order.updated',
          targetType: 'Sale',
          targetId: id,
          metadata: { number: sale.number, ...metadata },
        },
        tx,
      );
      return sale;
    });
    this.events.publish({
      organizationId,
      establishmentId: updated.establishmentId,
      topics: ['orders'],
      type: 'order.updated',
      saleId: id,
    });
    return this.sales.get(auth, id);
  }

  /**
   * Transition de préparation. « send » et « serve » : salle et caisse ; « start » et « ready » :
   * cuisine. Une action rejouée (statut déjà atteint) ne modifie rien et ne republie rien.
   */
  async transition(auth: TenantContext, id: string, action: PreparationAction) {
    const organizationId = auth.membership.organizationId;
    const kitchenSide = action === 'start' || action === 'ready';
    const result = await this.prisma.$transaction(async (tx) => {
      const sale = await this.lockVisible(tx, auth, id, kitchenSide);
      if (sale.status === 'CANCELLED') throw this.cancelled();
      const decision = decidePreparationTransition(sale.preparationStatus, action);
      if (decision.kind === 'noop') return { changed: false as const, sale };
      if (decision.kind === 'refuse') {
        throw new ConflictException({
          code: decision.code,
          message:
            decision.code === 'ORDER_NOT_SENT'
              ? 'Cette commande n’a pas été envoyée en cuisine.'
              : decision.code === 'ORDER_NOT_READY'
                ? 'La commande n’est pas encore prête.'
                : 'Transition de préparation impossible.',
        });
      }
      const now = new Date();
      const stamp = STAMP[decision.to];
      await tx.sale.update({
        where: { id },
        data: { preparationStatus: decision.to, ...(stamp ? { [stamp]: now } : {}) },
      });
      await recordOrderEvent(tx, {
        organizationId,
        establishmentId: sale.establishmentId,
        saleId: id,
        type: EVENT[action].history,
        fromStatus: sale.preparationStatus,
        toStatus: decision.to,
        actorMembershipId: auth.membership.id,
      });
      if (action === 'send') {
        // Les ingrédients sont consommés à l'envoi en cuisine (sauf déjà fait au paiement).
        await this.stock.consumeForSale(tx, id, auth.membership.id);
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'order.sent_to_kitchen',
            targetType: 'Sale',
            targetId: id,
            metadata: { number: sale.number, paymentStatus: sale.paymentStatus },
          },
          tx,
        );
      }
      return { changed: true as const, sale };
    });
    if (result.changed) {
      this.events.publish({
        organizationId,
        establishmentId: result.sale.establishmentId,
        topics: ['orders', 'kitchen'],
        type: EVENT[action].realtime,
        saleId: id,
      });
    }
    const order = kitchenSide ? await this.kitchenOrder(auth, id) : await this.sales.get(auth, id);
    return { changed: result.changed, order };
  }

  /** Écran cuisine : commandes envoyées, en préparation ou prêtes ; jamais une commande non envoyée. */
  async kitchenQueue(auth: TenantContext, establishmentId: string) {
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      establishmentId,
      'RESTAURANT',
    );
    return this.prisma.sale.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: establishment.id,
        activity: 'RESTAURANT',
        status: 'OPEN',
        OR: [
          { preparationStatus: { in: ['SENT', 'IN_PREPARATION'] } },
          {
            preparationStatus: 'READY',
            readyAt: { gte: new Date(Date.now() - READY_DISPLAY_MS) },
          },
        ],
      },
      orderBy: { sentToKitchenAt: 'asc' },
      take: 200,
      select: KITCHEN_SELECT,
    });
  }

  private async kitchenOrder(auth: TenantContext, id: string) {
    const order = await this.prisma.sale.findFirst({
      where: { ...this.kitchenWhere(auth), id },
      select: KITCHEN_SELECT,
    });
    if (!order) throw new NotFoundException(NOT_FOUND);
    return order;
  }

  /**
   * Commandes visibles en cuisine : celles de l'organisation, dans les établissements affectés au membre
   * (hors propriétaire et administrateur). La cuisine ne voit que les commandes du restaurant.
   */
  private kitchenWhere(auth: TenantContext): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {
      organizationId: auth.membership.organizationId,
      activity: 'RESTAURANT',
    };
    if (!hasOrganizationWideScope(auth.membership.role)) {
      where.establishment = { assignments: { some: { membershipId: auth.membership.id } } };
    }
    return where;
  }

  private async lockVisible(
    tx: Prisma.TransactionClient,
    auth: TenantContext,
    id: string,
    kitchenSide = false,
  ) {
    const where = kitchenSide
      ? { ...this.kitchenWhere(auth), id }
      : { ...visibleSalesWhere(auth), id, activity: 'RESTAURANT' as const };
    const visible = await tx.sale.findFirst({ where, select: { id: true } });
    if (!visible) throw new NotFoundException(NOT_FOUND);
    await lockRow(tx, 'Sale', id);
    return tx.sale.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        paymentStatus: true,
        preparationStatus: true,
        establishmentId: true,
        number: true,
        total: true,
        tableId: true,
        zoneId: true,
        loyaltyDiscount: true,
      },
    });
  }

  private cancelled() {
    return new ConflictException({
      code: 'ORDER_CANCELLED',
      message: 'Cette commande a été annulée.',
    });
  }
}
