import { Injectable } from '@nestjs/common';
import { addDays, isStockLow, localMoment, zonedMidnight } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { findSellingEstablishment } from '../pos/pos-scope';

const TOP_PRODUCTS = 5;

/**
 * Tableau de bord opérationnel du restaurant, pour un établissement et la journée locale :
 * - CA encaissé = somme des paiements RÉUSSIS du jour sur les ventes restaurant (un paiement par
 *   vente, contrainte d'idempotence) : une vente impayée n'y figure jamais, une vente n'y compte
 *   qu'une fois ;
 * - commandes du jour (non annulées), panier moyen (CA encaissé / ventes encaissées) ;
 * - commandes en attente (envoyées, pas commencées) et en préparation ; demandes QR à valider ;
 * - temps moyen de préparation (envoi en cuisine → prête) des commandes prêtes du jour ;
 * - produits les plus vendus (quantités des ventes encaissées du jour) ;
 * - alertes de stock de l'établissement.
 * Les analyses avancées (par produit, par heure, sur période) relèvent du Sprint 9.
 */
@Injectable()
export class RestaurantDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(auth: TenantContext, establishmentId: string) {
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      establishmentId,
      'RESTAURANT',
    );
    const tz = establishment.timezone;
    const today = localMoment(new Date(), tz).date;
    const day = { gte: zonedMidnight(today, tz), lt: zonedMidnight(addDays(today, 1), tz) };
    const restaurantSales = {
      organizationId: auth.membership.organizationId,
      establishmentId: establishment.id,
      activity: 'RESTAURANT' as const,
    };

    const [revenue, orders, queue, qrPending, ready, topLines, stockItems] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          status: 'SUCCEEDED',
          createdAt: day,
          sale: { ...restaurantSales, status: 'OPEN' },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.sale.count({ where: { ...restaurantSales, status: 'OPEN', createdAt: day } }),
      this.prisma.sale.groupBy({
        by: ['preparationStatus'],
        where: {
          ...restaurantSales,
          status: 'OPEN',
          preparationStatus: { in: ['SENT', 'IN_PREPARATION'] },
          createdAt: { gte: zonedMidnight(addDays(today, -1), tz) },
        },
        _count: { _all: true },
      }),
      this.prisma.qrOrderRequest.count({
        where: {
          establishmentId: establishment.id,
          status: 'PENDING_VALIDATION',
          createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
        },
      }),
      this.prisma.sale.findMany({
        where: {
          ...restaurantSales,
          readyAt: day,
          sentToKitchenAt: { not: null },
        },
        select: { sentToKitchenAt: true, readyAt: true },
      }),
      this.prisma.saleLine.groupBy({
        by: ['productName'],
        where: {
          sale: { ...restaurantSales, status: 'OPEN', paymentStatus: 'PAID', createdAt: day },
        },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: TOP_PRODUCTS,
      }),
      this.prisma.stockItem.findMany({
        where: { establishmentId: establishment.id, isActive: true, alertThreshold: { not: null } },
        select: { id: true, name: true, unit: true, quantity: true, alertThreshold: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const collected = revenue._sum.amount ?? 0;
    const paidSales = revenue._count._all;
    const prepMinutes = ready.map(
      (s) => (s.readyAt!.getTime() - s.sentToKitchenAt!.getTime()) / 60_000,
    );
    const count = (status: 'SENT' | 'IN_PREPARATION') =>
      queue.find((q) => q.preparationStatus === status)?._count._all ?? 0;

    return {
      date: today,
      establishment: { id: establishment.id, name: establishment.name },
      revenueCollected: collected,
      paidSales,
      orders,
      averageBasket: paidSales > 0 ? Math.round(collected / paidSales) : null,
      waiting: count('SENT'),
      inPreparation: count('IN_PREPARATION'),
      qrPending,
      averagePreparationMinutes:
        prepMinutes.length > 0
          ? Math.round((prepMinutes.reduce((a, b) => a + b, 0) / prepMinutes.length) * 10) / 10
          : null,
      topProducts: topLines.map((l) => ({
        productName: l.productName,
        quantity: l._sum.quantity ?? 0,
        revenue: l._sum.lineTotal ?? 0,
      })),
      stockAlerts: stockItems
        .map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          quantity: i.quantity.toNumber(),
          alertThreshold: i.alertThreshold!.toNumber(),
        }))
        .filter((i) => isStockLow(i.quantity, i.alertThreshold)),
    };
  }
}
