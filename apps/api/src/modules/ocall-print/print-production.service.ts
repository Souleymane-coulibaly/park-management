import { Injectable } from '@nestjs/common';
import {
  hasControlChars,
  PRINT_ITEM_REJECTABLE,
  PRINT_ORDER_FLOW,
  PRINT_ORDER_REJECTABLE,
  PRINT_ORDER_STATUSES,
  type PrintOrderStatus,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid, printConflict, printInvalid, printNotFound } from './print-errors';
import { lockOrder, recomputeOrder } from './print-order-lines';
import {
  ORDER_INCLUDE,
  type OrderRow,
  PrintOrdersService,
  orderDetail,
  orderSummary,
} from './print-orders.service';
import { PrintPrismaService } from './print-prisma.service';

/** Compte interne Ocall (atelier de Bamako ou supervision) qui agit sur la production. */
export interface PlatformActor {
  userId: string;
}

function reason(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 3 || text.length > 200 || hasControlChars(text))
    throw printInvalid('PRINT_REASON_REQUIRED', 'Motif : de 3 à 200 caractères.');
  return text;
}

const STAMP: Partial<Record<PrintOrderStatus, string>> = {
  ACCEPTED: 'acceptedAt',
  IN_PRODUCTION: 'productionAt',
  READY: 'readyAt',
  DELIVERED: 'deliveredAt',
};

/**
 * Production des cartes à l'atelier Ocall de Bamako et supervision centrale. Seul point d'entrée qui lit
 * les commandes de toutes les organisations : réservé aux comptes internes portant la permission
 * `platform.print.production` (imprimeur) ou `platform.print.supervise` (propriétaire, administrateurs).
 * Chaque action est inscrite au journal de la commande ET au journal d'audit de la plateforme.
 */
@Injectable()
export class PrintProductionService {
  constructor(
    private readonly db: PrintPrismaService,
    private readonly core: PrismaService,
    private readonly orders: PrintOrdersService,
    private readonly audit: AuditService,
  ) {}

  private async organizations(ids: string[]) {
    const orgs = await this.core.organization.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(orgs.map((o) => [o.id, o.name]));
  }

  async queue(filter: { status?: string }) {
    const status = PRINT_ORDER_STATUSES.includes(filter.status as PrintOrderStatus)
      ? (filter.status as PrintOrderStatus)
      : undefined;
    const rows = await this.db.printOrder.findMany({
      // Par défaut : la file de travail (commandes ni livrées, ni annulées, ni refusées).
      where: status
        ? { status }
        : { status: { in: ['SUBMITTED', 'ACCEPTED', 'IN_PRODUCTION', 'READY'] } },
      orderBy: { submittedAt: 'asc' },
      take: 500,
    });
    const names = await this.organizations(rows.map((r) => r.organizationId));
    return rows.map((r) => ({
      ...orderSummary(r),
      organizationName: names.get(r.organizationId) ?? '—',
      contactName: r.contactName,
      contactPhone: r.contactPhone,
    }));
  }

  private async load(id: string): Promise<OrderRow> {
    if (!isUuid(id)) throw printNotFound('Commande');
    const order = await this.db.printOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw printNotFound('Commande');
    return order;
  }

  async detail(id: string) {
    const order = await this.load(id);
    const names = await this.organizations([order.organizationId]);
    return { ...orderDetail(order), organizationName: names.get(order.organizationId) ?? '—' };
  }

  private async record(
    actor: PlatformActor,
    order: { id: string; organizationId: string; number: string },
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.record({
      organizationId: order.organizationId,
      actorUserId: actor.userId,
      action: `print.${action}`,
      targetType: 'PrintOrder',
      targetId: order.id,
      metadata: { number: order.number, ...details },
    });
  }

  /** Étape suivante de production, dans l'ordre : acceptée, en production, prête, livrée. */
  async advance(actor: PlatformActor, id: string, to: string) {
    const order = await this.load(id);
    if (!PRINT_ORDER_STATUSES.includes(to as PrintOrderStatus))
      throw printInvalid('PRINT_STATUS_INVALID', 'État invalide.');
    const next = to as PrintOrderStatus;
    await this.db.$transaction(async (tx) => {
      await lockOrder(tx, order.organizationId, id);
      const fresh = await tx.printOrder.findUniqueOrThrow({ where: { id } });
      if (PRINT_ORDER_FLOW[fresh.status as PrintOrderStatus] !== next)
        throw printConflict(
          'PRINT_ORDER_TRANSITION',
          'Cette étape ne suit pas l’état actuel de la commande.',
          { status: fresh.status },
        );
      if (fresh.quantity === 0)
        throw printConflict('PRINT_ORDER_EMPTY', 'Aucune carte à produire dans cette commande.');
      if (next === 'READY')
        await tx.printOrderItem.updateMany({
          where: { organizationId: order.organizationId, orderId: id, status: 'PENDING' },
          data: { status: 'PRINTED' },
        });
      await tx.printOrder.update({
        where: { id },
        data: { status: next, [STAMP[next]!]: new Date() },
      });
      await tx.printOrderEvent.create({
        data: {
          organizationId: order.organizationId,
          orderId: id,
          type: next,
          actorKind: 'PLATFORM',
          actorUserId: actor.userId,
        },
      });
    });
    await this.record(actor, order, 'order_status', { to: next });
    return this.detail(id);
  }

  async rejectOrder(actor: PlatformActor, id: string, reasonInput: unknown) {
    const why = reason(reasonInput);
    const order = await this.load(id);
    await this.db.$transaction(async (tx) => {
      await lockOrder(tx, order.organizationId, id);
      const fresh = await tx.printOrder.findUniqueOrThrow({ where: { id } });
      if (!PRINT_ORDER_REJECTABLE.includes(fresh.status as PrintOrderStatus))
        throw printConflict('PRINT_ORDER_TRANSITION', 'Cette commande ne peut plus être refusée.', {
          status: fresh.status,
        });
      await tx.printOrderItem.updateMany({
        where: { organizationId: order.organizationId, orderId: id, status: 'PENDING' },
        data: { status: 'REJECTED', rejectReason: why },
      });
      await tx.printOrder.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          closedReason: why,
          quantity: 0,
          totalAmount: 0,
        },
      });
      await tx.printOrderEvent.create({
        data: {
          organizationId: order.organizationId,
          orderId: id,
          type: 'REJECTED',
          actorKind: 'PLATFORM',
          actorUserId: actor.userId,
          details: { reason: why },
        },
      });
    });
    await this.record(actor, order, 'order_rejected', { reason: why });
    return this.detail(id);
  }

  /** Refus d'une carte (photo illisible…) : la carte redevient commandable, la commande est recalculée. */
  async rejectItem(actor: PlatformActor, id: string, itemId: string, reasonInput: unknown) {
    const why = reason(reasonInput);
    const order = await this.load(id);
    if (!order.items.some((i) => i.id === itemId)) throw printNotFound('Carte');
    await this.db.$transaction(async (tx) => {
      await lockOrder(tx, order.organizationId, id);
      const fresh = await tx.printOrder.findUniqueOrThrow({ where: { id } });
      if (!PRINT_ITEM_REJECTABLE.includes(fresh.status as PrintOrderStatus))
        throw printConflict(
          'PRINT_ORDER_TRANSITION',
          'La production de cette commande est terminée.',
        );
      const { count } = await tx.printOrderItem.updateMany({
        where: { id: itemId, orderId: id, status: 'PENDING' },
        data: { status: 'REJECTED', rejectReason: why },
      });
      if (count === 0)
        throw printConflict('PRINT_ITEM_NOT_PENDING', 'Cette carte n’est plus à imprimer.');
      const quantity = await recomputeOrder(tx, order.organizationId, id);
      await tx.printOrderEvent.create({
        data: {
          organizationId: order.organizationId,
          orderId: id,
          type: 'ITEM_REJECTED',
          actorKind: 'PLATFORM',
          actorUserId: actor.userId,
          details: { itemId, reason: why },
        },
      });
      if (quantity === 0) {
        await tx.printOrder.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectedAt: new Date(),
            closedReason: 'Toutes les cartes ont été refusées.',
          },
        });
        await tx.printOrderEvent.create({
          data: {
            organizationId: order.organizationId,
            orderId: id,
            type: 'REJECTED',
            actorKind: 'SYSTEM',
            details: { reason: 'ALL_ITEMS_REJECTED' },
          },
        });
      }
    });
    await this.record(actor, order, 'item_rejected', { itemId, reason: why });
    return this.detail(id);
  }

  /**
   * Encaissement en espèces à la livraison (V1, aucun paiement en ligne) : montant égal au total dû,
   * référence du reçu remis. Une commande prête ou livrée seulement.
   */
  async recordPayment(
    actor: PlatformActor,
    id: string,
    input: { amount: unknown; reference: unknown },
  ) {
    const order = await this.load(id);
    const amount = Number(input.amount);
    const reference = typeof input.reference === 'string' ? input.reference.trim() : '';
    if (!Number.isInteger(amount) || amount < 0)
      throw printInvalid('PRINT_PAYMENT_INVALID', 'Montant invalide.');
    if (reference.length < 2 || reference.length > 60 || hasControlChars(reference))
      throw printInvalid('PRINT_PAYMENT_INVALID', 'Référence du reçu : de 2 à 60 caractères.');
    await this.db.$transaction(async (tx) => {
      await lockOrder(tx, order.organizationId, id);
      const fresh = await tx.printOrder.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'READY' && fresh.status !== 'DELIVERED')
        throw printConflict(
          'PRINT_PAYMENT_TOO_EARLY',
          'Le règlement s’enregistre à la livraison (commande prête ou livrée).',
        );
      if (fresh.paymentStatus === 'PAID')
        throw printConflict('PRINT_ALREADY_PAID', 'Le règlement est déjà enregistré.');
      if (amount !== fresh.totalAmount || fresh.totalAmount === 0)
        throw printConflict('PRINT_PAYMENT_AMOUNT', 'Le montant doit être égal au total dû.', {
          totalAmount: fresh.totalAmount,
        });
      await tx.printOrder.update({
        where: { id },
        data: {
          paymentStatus: 'PAID',
          paidAmount: amount,
          paidAt: new Date(),
          paymentReference: reference,
          paymentRecordedByUserId: actor.userId,
        },
      });
      await tx.printOrderEvent.create({
        data: {
          organizationId: order.organizationId,
          orderId: id,
          type: 'PAYMENT_RECORDED',
          actorKind: 'PLATFORM',
          actorUserId: actor.userId,
          details: { amount, method: 'CASH', reference },
        },
      });
    });
    await this.record(actor, order, 'payment_recorded', { amount, method: 'CASH', reference });
    return this.detail(id);
  }

  /** Supervision : annulation d'un règlement saisi par erreur (motif obligatoire, tracé). */
  async cancelPayment(actor: PlatformActor, id: string, reasonInput: unknown) {
    const why = reason(reasonInput);
    const order = await this.load(id);
    await this.db.$transaction(async (tx) => {
      await lockOrder(tx, order.organizationId, id);
      const fresh = await tx.printOrder.findUniqueOrThrow({ where: { id } });
      if (fresh.paymentStatus !== 'PAID')
        throw printConflict('PRINT_NOT_PAID', 'Aucun règlement enregistré.');
      await tx.printOrder.update({
        where: { id },
        data: {
          paymentStatus: 'UNPAID',
          paidAmount: null,
          paidAt: null,
          paymentReference: null,
          paymentRecordedByUserId: null,
        },
      });
      await tx.printOrderEvent.create({
        data: {
          organizationId: order.organizationId,
          orderId: id,
          type: 'PAYMENT_CANCELLED',
          actorKind: 'PLATFORM',
          actorUserId: actor.userId,
          details: { reason: why, amount: fresh.paidAmount, reference: fresh.paymentReference },
        },
      });
    });
    await this.record(actor, order, 'payment_cancelled', { reason: why });
    return this.detail(id);
  }

  async productionPdf(actor: PlatformActor, id: string) {
    const order = await this.load(id);
    const pdf = await this.orders.productionPdf(order);
    await this.record(actor, order, 'production_file_downloaded', {});
    return { pdf, number: order.number };
  }

  /** Tableau de suivi central : commandes et montants par état, encaissé et restant dû. */
  async overview() {
    const rows = await this.db.printOrder.groupBy({
      by: ['status', 'paymentStatus'],
      _count: { _all: true },
      _sum: { totalAmount: true, quantity: true, paidAmount: true },
    });
    return rows.map((r) => ({
      status: r.status,
      paymentStatus: r.paymentStatus,
      orders: r._count._all,
      cards: r._sum.quantity ?? 0,
      totalAmount: r._sum.totalAmount ?? 0,
      paidAmount: r._sum.paidAmount ?? 0,
    }));
  }
}
