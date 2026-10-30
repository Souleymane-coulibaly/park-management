import { Injectable } from '@nestjs/common';
import { addDays, localMoment, zonedMidnight } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { ParkScheduleService } from './park-schedule.service';

interface DayRange {
  date: string;
  gte: Date;
  lt: Date;
}

/**
 * Tableau de bord du parc pour un établissement, en heure locale : billets vendus, entrées, billets non
 * utilisés, chiffre d'affaires billetterie (ventes payées non annulées), répartition par catégorie et par
 * heure, comparaison avec la veille.
 */
@Injectable()
export class TicketingDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ParkScheduleService,
  ) {}

  async get(auth: TenantContext, establishmentId: string) {
    const establishment = await this.schedule.findParkEstablishment(auth, establishmentId);
    const tz = establishment.timezone;
    const today = localMoment(new Date(), tz).date;
    const range = (date: string): DayRange => ({
      date,
      gte: zonedMidnight(date, tz),
      lt: zonedMidnight(addDays(date, 1), tz),
    });
    const [current, previous] = await Promise.all([
      this.day(auth, establishment.id, range(today)),
      this.day(auth, establishment.id, range(addDays(today, -1))),
    ]);

    const todayRange = range(today);
    const [byCategory, categories, soldAt, enteredAt, opening] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['ticketCategoryId'],
        where: {
          establishmentId,
          createdAt: { gte: todayRange.gte, lt: todayRange.lt },
          status: { not: 'CANCELLED' },
        },
        _count: { _all: true },
        _sum: { pricePaid: true },
      }),
      this.prisma.ticketCategory.findMany({
        where: { establishmentId },
        select: { id: true, name: true, kind: true },
      }),
      this.prisma.ticket.findMany({
        where: {
          establishmentId,
          createdAt: { gte: todayRange.gte, lt: todayRange.lt },
          status: { not: 'CANCELLED' },
        },
        select: { createdAt: true },
      }),
      this.prisma.ticketScan.findMany({
        where: {
          establishmentId,
          result: 'ACCEPTED',
          createdAt: { gte: todayRange.gte, lt: todayRange.lt },
        },
        select: { createdAt: true },
      }),
      this.schedule.get(auth, establishment.id),
    ]);

    const names = new Map(categories.map((c) => [c.id, c]));
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, sold: 0, entries: 0 }));
    for (const t of soldAt) hours[Math.floor(localMoment(t.createdAt, tz).minutes / 60)]!.sold++;
    for (const s of enteredAt)
      hours[Math.floor(localMoment(s.createdAt, tz).minutes / 60)]!.entries++;

    const recentEntries = await this.prisma.ticketScan.findMany({
      where: { establishmentId, createdAt: { gte: todayRange.gte } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        result: true,
        refusalReason: true,
        entryPoint: true,
        createdAt: true,
        ticket: {
          select: {
            visitorName: true,
            establishmentId: true,
            ticketCategory: { select: { name: true } },
          },
        },
      },
    });

    return {
      establishment: { id: establishment.id, name: establishment.name, timezone: tz },
      today: current,
      yesterday: previous,
      openToday: opening.openToday,
      status: opening.status,
      byCategory: byCategory
        .map((g) => ({
          ticketCategoryId: g.ticketCategoryId,
          name: names.get(g.ticketCategoryId)?.name ?? '—',
          kind: names.get(g.ticketCategoryId)?.kind ?? 'CUSTOM',
          tickets: g._count._all,
          amount: g._sum.pricePaid ?? 0,
        }))
        .sort((a, b) => b.tickets - a.tickets),
      byHour: hours.filter((h) => h.sold > 0 || h.entries > 0),
      recentScans: recentEntries.map(({ ticket, ...s }) => ({
        ...s,
        visitorName:
          ticket && ticket.establishmentId === establishmentId ? ticket.visitorName : null,
        categoryName:
          ticket && ticket.establishmentId === establishmentId ? ticket.ticketCategory.name : null,
      })),
    };
  }

  /** Indicateurs d'une journée locale. */
  private async day(auth: TenantContext, establishmentId: string, range: DayRange) {
    const createdAt = { gte: range.gte, lt: range.lt };
    const [ticketsSold, cancelled, unused, entries, refused, revenue] = await Promise.all([
      this.prisma.ticket.count({
        where: { establishmentId, createdAt, status: { not: 'CANCELLED' } },
      }),
      this.prisma.ticket.count({ where: { establishmentId, createdAt, status: 'CANCELLED' } }),
      this.prisma.ticket.count({ where: { establishmentId, createdAt, status: 'VALID' } }),
      this.prisma.ticketScan.count({ where: { establishmentId, createdAt, result: 'ACCEPTED' } }),
      this.prisma.ticketScan.count({ where: { establishmentId, createdAt, result: 'REFUSED' } }),
      this.prisma.sale.aggregate({
        where: {
          organizationId: auth.membership.organizationId,
          establishmentId,
          activity: 'PARK',
          status: 'OPEN',
          paymentStatus: 'PAID',
          createdAt,
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);
    return {
      date: range.date,
      ticketsSold,
      cancelled,
      unused,
      entries,
      refused,
      revenue: revenue._sum.total ?? 0,
      paidSales: revenue._count._all,
    };
  }
}
