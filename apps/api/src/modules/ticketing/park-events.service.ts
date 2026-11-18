import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  eventTicketWindow,
  PARK_EVENT_LIMITS,
  placesLeft,
  sessionInstants,
  sessionLabel,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { lockEventSession, soldBySession } from '../ticket-issuance/event-capacity';
import { fromDbDate, ParkScheduleService, toDbDate } from './park-schedule.service';
import type {
  CancelEventSessionDto,
  CreateEventSessionDto,
  CreateEventTariffDto,
  CreateParkEventDto,
  ParkEventsQueryDto,
  UpdateEventSessionDto,
  UpdateEventTariffDto,
  UpdateParkEventDto,
} from './park-events.dto';
import { CATEGORY_SELECT, TicketCategoriesService, toCategory } from './ticket-categories.service';
import type { CreateTicketCategoryDto } from './ticketing.dto';

const EVENT_NOT_FOUND = { code: 'PARK_EVENT_NOT_FOUND', message: 'Événement introuvable.' };
const SESSION_NOT_FOUND = { code: 'EVENT_SESSION_NOT_FOUND', message: 'Séance introuvable.' };

const EVENT_SELECT = {
  id: true,
  organizationId: true,
  establishmentId: true,
  name: true,
  description: true,
  conditions: true,
  status: true,
  entryOpensBeforeMinutes: true,
  entryClosesAfterMinutes: true,
  showOnSite: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SESSION_SELECT = {
  id: true,
  eventId: true,
  date: true,
  startTime: true,
  endTime: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  salesOpen: true,
  status: true,
  cancelledAt: true,
  cancelReason: true,
} as const;

type SessionRow = Prisma.ParkEventSessionGetPayload<{ select: typeof SESSION_SELECT }>;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const toSession = ({ date, ...s }: SessionRow) => ({ ...s, date: fromDbDate(date) });

/**
 * Événements du parc : création, séances (date, horaires, capacité), tarifs (catégories de billet
 * rattachées à l'événement), publication, annulation d'une séance avec la liste des acheteurs, suivi.
 * La vente et l'émission réutilisent la billetterie (TicketSalesService, TicketIssuanceService).
 */
@Injectable()
export class ParkEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly schedule: ParkScheduleService,
    private readonly categories: TicketCategoriesService,
  ) {}

  // ─── Lecture ───

  async list(auth: TenantContext, query: ParkEventsQueryDto) {
    await this.schedule.findParkEstablishment(auth, query.establishmentId);
    const events = await this.prisma.parkEvent.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: query.establishmentId,
        ...(query.includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        ...EVENT_SELECT,
        sessions: { orderBy: { startsAt: 'asc' }, select: SESSION_SELECT },
        _count: { select: { tariffs: { where: { isActive: true } } } },
      },
    });
    const sold = await soldBySession(
      this.prisma,
      events.flatMap((e) => e.sessions.map((s) => s.id)),
    );
    const now = new Date();
    return events.map(({ sessions, _count, ...e }) => {
      const scheduled = sessions.filter((s) => s.status === 'SCHEDULED');
      const next = scheduled.find((s) => s.endsAt > now) ?? null;
      return {
        ...e,
        activeTariffs: _count.tariffs,
        sessionCount: scheduled.length,
        nextSession: next ? toSession(next) : null,
        capacity: scheduled.reduce((sum, s) => sum + s.capacity, 0),
        sold: scheduled.reduce((sum, s) => sum + sold.get(s.id)!.total, 0),
      };
    });
  }

  async get(auth: TenantContext, id: string) {
    const event = await this.findEvent(auth, id);
    const [sessions, tariffs] = await Promise.all([
      this.prisma.parkEventSession.findMany({
        where: { eventId: id },
        orderBy: { startsAt: 'asc' },
        select: SESSION_SELECT,
      }),
      this.prisma.ticketCategory.findMany({
        where: { eventId: id },
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        select: CATEGORY_SELECT,
      }),
    ]);
    const sold = await soldBySession(
      this.prisma,
      sessions.map((s) => s.id),
    );
    return {
      ...event,
      tariffs: tariffs.map(toCategory),
      sessions: sessions.map((s) => {
        const sales = sold.get(s.id)!;
        return {
          ...toSession(s),
          sold: sales.total,
          placesLeft: placesLeft(s.capacity, sales.total),
          byTariff: tariffs.map((t) => ({
            ticketCategoryId: t.id,
            sold: sales.byCategory.get(t.id) ?? 0,
          })),
        };
      }),
    };
  }

  // ─── Événement ───

  async create(auth: TenantContext, dto: CreateParkEventDto) {
    const establishment = await this.schedule.findParkEstablishment(auth, dto.establishmentId);
    const organizationId = auth.membership.organizationId;
    try {
      const event = await this.prisma.$transaction(async (tx) => {
        const created = await tx.parkEvent.create({
          data: {
            organizationId,
            establishmentId: establishment.id,
            name: dto.name,
            description: dto.description ?? '',
            conditions: dto.conditions ?? '',
            entryOpensBeforeMinutes: dto.entryOpensBeforeMinutes ?? 60,
            entryClosesAfterMinutes: dto.entryClosesAfterMinutes ?? 0,
            showOnSite: dto.showOnSite ?? true,
            createdById: auth.membership.id,
          },
          select: EVENT_SELECT,
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'park_event.created',
            targetType: 'ParkEvent',
            targetId: created.id,
            metadata: { name: created.name, establishmentId: establishment.id },
          },
          tx,
        );
        return created;
      });
      return this.get(auth, event.id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(this.nameTaken());
      throw error;
    }
  }

  /**
   * Modification et changement de statut. Publier exige au moins une séance programmée et un tarif
   * actif. Une nouvelle tolérance d'entrée s'applique aussi aux billets valides déjà émis.
   */
  async update(auth: TenantContext, id: string, dto: UpdateParkEventDto) {
    const existing = await this.findEvent(auth, id);
    if (dto.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
      const [sessions, tariffs] = await Promise.all([
        this.prisma.parkEventSession.count({
          where: { eventId: id, status: 'SCHEDULED', endsAt: { gt: new Date() } },
        }),
        this.prisma.ticketCategory.count({ where: { eventId: id, isActive: true } }),
      ]);
      if (sessions === 0 || tariffs === 0) {
        throw new BadRequestException({
          code: 'PARK_EVENT_NOT_READY',
          message: 'Pour publier, ajoutez au moins une séance à venir et un tarif actif.',
        });
      }
    }
    const toleranceChanged =
      (dto.entryOpensBeforeMinutes !== undefined &&
        dto.entryOpensBeforeMinutes !== existing.entryOpensBeforeMinutes) ||
      (dto.entryClosesAfterMinutes !== undefined &&
        dto.entryClosesAfterMinutes !== existing.entryClosesAfterMinutes);
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.parkEvent.update({
          where: { id },
          data: {
            name: dto.name,
            description: dto.description,
            conditions: dto.conditions,
            entryOpensBeforeMinutes: dto.entryOpensBeforeMinutes,
            entryClosesAfterMinutes: dto.entryClosesAfterMinutes,
            showOnSite: dto.showOnSite,
            status: dto.status,
          },
          select: EVENT_SELECT,
        });
        let ticketsUpdated = 0;
        if (toleranceChanged) {
          const sessions = await tx.parkEventSession.findMany({
            where: { eventId: id, status: 'SCHEDULED' },
            select: { id: true, startsAt: true, endsAt: true },
          });
          for (const s of sessions) {
            ticketsUpdated += await this.refreshTicketWindows(tx, s, updated);
          }
        }
        await this.audit.record(
          {
            organizationId: existing.organizationId,
            actorUserId: auth.user.id,
            action: 'park_event.updated',
            targetType: 'ParkEvent',
            targetId: id,
            metadata: {
              name: updated.name,
              changes: Object.keys(dto),
              ...(dto.status && dto.status !== existing.status
                ? { previousStatus: existing.status, status: dto.status }
                : {}),
              ...(toleranceChanged ? { ticketsUpdated } : {}),
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(this.nameTaken());
      throw error;
    }
    return this.get(auth, id);
  }

  // ─── Séances ───

  async createSession(auth: TenantContext, eventId: string, dto: CreateEventSessionDto) {
    const event = await this.findEvent(auth, eventId);
    const timezone = await this.timezoneOf(event.establishmentId);
    const instants = this.instants(dto.date, dto.startTime, dto.endTime, timezone);
    const count = await this.prisma.parkEventSession.count({ where: { eventId } });
    if (count >= PARK_EVENT_LIMITS.maxSessions) {
      throw new BadRequestException({
        code: 'EVENT_SESSION_LIMIT',
        message: `Un événement compte au plus ${PARK_EVENT_LIMITS.maxSessions} séances.`,
      });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.parkEventSession.create({
          data: {
            organizationId: event.organizationId,
            establishmentId: event.establishmentId,
            eventId,
            date: toDbDate(dto.date),
            startTime: dto.startTime,
            endTime: dto.endTime,
            ...instants,
            capacity: dto.capacity,
            salesOpen: dto.salesOpen ?? true,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            organizationId: event.organizationId,
            actorUserId: auth.user.id,
            action: 'park_event_session.created',
            targetType: 'ParkEventSession',
            targetId: created.id,
            metadata: {
              eventId,
              session: sessionLabel(dto),
              capacity: dto.capacity,
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(this.sessionTaken());
      throw error;
    }
    return this.get(auth, eventId);
  }

  /**
   * Modification d'une séance programmée. La capacité ne descend jamais sous les places vendues ; de
   * nouveaux horaires s'appliquent aussi aux billets valides déjà émis (validité recalculée).
   */
  async updateSession(
    auth: TenantContext,
    eventId: string,
    sessionId: string,
    dto: UpdateEventSessionDto,
  ) {
    const event = await this.findEvent(auth, eventId);
    const timezone = await this.timezoneOf(event.establishmentId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const session = await this.lockedSession(tx, eventId, sessionId);
        if (session.status !== 'SCHEDULED') {
          throw new ConflictException({
            code: 'EVENT_SESSION_CANCELLED',
            message: 'Une séance annulée ne peut plus être modifiée.',
          });
        }
        const date = dto.date ?? fromDbDate(session.date);
        const startTime = dto.startTime ?? session.startTime;
        const endTime = dto.endTime ?? session.endTime;
        const timesChanged =
          date !== fromDbDate(session.date) ||
          startTime !== session.startTime ||
          endTime !== session.endTime;
        const instants = timesChanged
          ? this.instants(date, startTime, endTime, timezone)
          : { startsAt: session.startsAt, endsAt: session.endsAt };
        if (dto.capacity !== undefined) {
          const sold = (await soldBySession(tx, [sessionId])).get(sessionId)!.total;
          if (dto.capacity < sold) {
            throw new ConflictException({
              code: 'EVENT_CAPACITY_BELOW_SOLD',
              message: `${sold} place(s) déjà vendue(s) : la capacité ne peut pas être inférieure.`,
              details: { sold },
            });
          }
        }
        await tx.parkEventSession.update({
          where: { id: sessionId },
          data: {
            date: toDbDate(date),
            startTime,
            endTime,
            ...instants,
            capacity: dto.capacity,
            salesOpen: dto.salesOpen,
          },
        });
        const ticketsUpdated = timesChanged
          ? await this.refreshTicketWindows(tx, { id: sessionId, ...instants }, event)
          : 0;
        await this.audit.record(
          {
            organizationId: event.organizationId,
            actorUserId: auth.user.id,
            action: 'park_event_session.updated',
            targetType: 'ParkEventSession',
            targetId: sessionId,
            metadata: {
              eventId,
              changes: Object.keys(dto),
              session: sessionLabel({ date, startTime, endTime }),
              ...(timesChanged ? { ticketsUpdated } : {}),
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(this.sessionTaken());
      throw error;
    }
    return this.get(auth, eventId);
  }

  /**
   * Annulation d'une séance : motif obligatoire, vente fermée, billets encore valides annulés en une
   * seule transaction (un billet déjà utilisé reste tel quel). Ocall Parc ne rembourse pas : la liste
   * des acheteurs concernés est renvoyée pour le remboursement ou la prise de contact.
   */
  async cancelSession(
    auth: TenantContext,
    eventId: string,
    sessionId: string,
    dto: CancelEventSessionDto,
  ) {
    const event = await this.findEvent(auth, eventId);
    await this.prisma.$transaction(async (tx) => {
      const session = await this.lockedSession(tx, eventId, sessionId);
      if (session.status === 'CANCELLED') {
        throw new ConflictException({
          code: 'EVENT_SESSION_ALREADY_CANCELLED',
          message: 'Cette séance est déjà annulée.',
        });
      }
      const now = new Date();
      await tx.parkEventSession.update({
        where: { id: sessionId },
        data: {
          status: 'CANCELLED',
          salesOpen: false,
          cancelledAt: now,
          cancelledById: auth.membership.id,
          cancelReason: dto.reason,
        },
      });
      const { count } = await tx.ticket.updateMany({
        where: { eventSessionId: sessionId, status: 'VALID' },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledById: auth.membership.id,
          cancelReason: `Séance annulée : ${dto.reason}`,
        },
      });
      await this.audit.record(
        {
          organizationId: event.organizationId,
          actorUserId: auth.user.id,
          action: 'park_event_session.cancelled',
          targetType: 'ParkEventSession',
          targetId: sessionId,
          metadata: {
            eventId,
            session: sessionLabel({
              date: fromDbDate(session.date),
              startTime: session.startTime,
              endTime: session.endTime,
            }),
            reason: dto.reason,
            ticketsCancelled: count,
          },
        },
        tx,
      );
    });
    return this.buyers(auth, eventId, sessionId);
  }

  /**
   * Acheteurs d'une séance, par vente : numéro, date, caissier, fiche client éventuelle, prénoms,
   * billets par statut et montant payé. Sert au remboursement manuel après une annulation.
   */
  async buyers(auth: TenantContext, eventId: string, sessionId: string) {
    const event = await this.findEvent(auth, eventId);
    const session = await this.prisma.parkEventSession.findFirst({
      where: { id: sessionId, eventId },
      select: SESSION_SELECT,
    });
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);
    const tickets = await this.prisma.ticket.findMany({
      where: { eventSessionId: sessionId, organizationId: event.organizationId },
      orderBy: [{ createdAt: 'asc' }, { position: 'asc' }],
      select: {
        visitorName: true,
        status: true,
        pricePaid: true,
        ticketCategory: { select: { name: true } },
        sale: {
          select: {
            id: true,
            number: true,
            createdAt: true,
            cashier: { select: { user: { select: { firstName: true, lastName: true } } } },
            customer: {
              select: { firstName: true, lastName: true, phone: true, anonymizedAt: true },
            },
          },
        },
      },
    });
    const bySale = new Map<
      string,
      {
        saleId: string;
        saleNumber: number;
        soldAt: Date;
        cashier: string;
        customer: { name: string; phone: string | null } | null;
        visitorNames: string[];
        tariffs: Record<string, number>;
        tickets: number;
        valid: number;
        used: number;
        cancelled: number;
        amount: number;
      }
    >();
    for (const t of tickets) {
      const s = t.sale;
      const entry = bySale.get(s.id) ?? {
        saleId: s.id,
        saleNumber: s.number,
        soldAt: s.createdAt,
        cashier: `${s.cashier.user.firstName} ${s.cashier.user.lastName}`,
        customer:
          s.customer && !s.customer.anonymizedAt
            ? {
                name: [s.customer.firstName, s.customer.lastName].filter(Boolean).join(' '),
                phone: s.customer.phone,
              }
            : null,
        visitorNames: [],
        tariffs: {},
        tickets: 0,
        valid: 0,
        used: 0,
        cancelled: 0,
        amount: 0,
      };
      if (t.visitorName) entry.visitorNames.push(t.visitorName);
      entry.tariffs[t.ticketCategory.name] = (entry.tariffs[t.ticketCategory.name] ?? 0) + 1;
      entry.tickets++;
      entry.amount += t.pricePaid;
      if (t.status === 'USED') entry.used++;
      else if (t.status === 'CANCELLED') entry.cancelled++;
      else entry.valid++;
      bySale.set(s.id, entry);
    }
    const sales = [...bySale.values()];
    return {
      event: { id: event.id, name: event.name },
      session: toSession(session),
      sales,
      totals: {
        sales: sales.length,
        tickets: tickets.length,
        amount: sales.reduce((sum, s) => sum + s.amount, 0),
        cancelled: sales.reduce((sum, s) => sum + s.cancelled, 0),
      },
    };
  }

  // ─── Tarifs (catégories de billet rattachées à l'événement) ───

  async createTariff(auth: TenantContext, eventId: string, dto: CreateEventTariffDto) {
    const event = await this.findEvent(auth, eventId);
    const { sessionQuota, requiresVisitorName, ...base } = dto;
    await this.categories.create(
      auth,
      { ...base, establishmentId: event.establishmentId } as CreateTicketCategoryDto,
      {
        event: {
          eventId,
          establishmentId: event.establishmentId,
          sessionQuota: sessionQuota ?? null,
          requiresVisitorName: requiresVisitorName ?? false,
        },
      },
    );
    return this.get(auth, eventId);
  }

  async updateTariff(
    auth: TenantContext,
    eventId: string,
    tariffId: string,
    dto: UpdateEventTariffDto,
  ) {
    await this.findEvent(auth, eventId);
    const { sessionQuota, requiresVisitorName, ...base } = dto;
    await this.categories.update(auth, tariffId, base, {
      eventId,
      sessionQuota,
      requiresVisitorName,
    });
    return this.get(auth, eventId);
  }

  // ─── Suivi (lot E4) ───

  /**
   * Suivi d'un événement par séance et par tarif : capacité, places vendues et restantes, taux de
   * remplissage, entrées, absents (billets valides d'une séance terminée), annulations, chiffre
   * d'affaires (part du prix des billets non annulés).
   */
  async dashboard(auth: TenantContext, eventId: string) {
    const event = await this.findEvent(auth, eventId);
    const now = new Date();
    const [sessions, tariffs, groups] = await Promise.all([
      this.prisma.parkEventSession.findMany({
        where: { eventId },
        orderBy: { startsAt: 'asc' },
        select: SESSION_SELECT,
      }),
      this.prisma.ticketCategory.findMany({
        where: { eventId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, sessionQuota: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['eventSessionId', 'ticketCategoryId', 'status'],
        where: { eventSession: { eventId }, organizationId: event.organizationId },
        _count: { _all: true },
        _sum: { pricePaid: true },
      }),
    ]);
    const empty = () => ({ sold: 0, entered: 0, waiting: 0, cancelled: 0, revenue: 0 });
    const rows = sessions.map((s) => {
      const ended = s.endsAt <= now;
      const perTariff = new Map(tariffs.map((t) => [t.id, empty()]));
      for (const g of groups.filter((x) => x.eventSessionId === s.id)) {
        const bucket = perTariff.get(g.ticketCategoryId) ?? empty();
        const n = g._count._all;
        if (g.status === 'CANCELLED') bucket.cancelled += n;
        else {
          bucket.sold += n;
          bucket.revenue += g._sum.pricePaid ?? 0;
          if (g.status === 'USED') bucket.entered += n;
          else bucket.waiting += n;
        }
        perTariff.set(g.ticketCategoryId, bucket);
      }
      const totals = [...perTariff.values()].reduce(
        (a, b) => ({
          sold: a.sold + b.sold,
          entered: a.entered + b.entered,
          waiting: a.waiting + b.waiting,
          cancelled: a.cancelled + b.cancelled,
          revenue: a.revenue + b.revenue,
        }),
        empty(),
      );
      return {
        ...toSession(s),
        ended,
        sold: totals.sold,
        placesLeft: s.status === 'CANCELLED' ? 0 : placesLeft(s.capacity, totals.sold),
        fillRate: s.capacity > 0 ? Math.round((totals.sold / s.capacity) * 1000) / 10 : 0,
        entered: totals.entered,
        /** Billets valides non utilisés : « attendus » avant la fin, « absents » après. */
        expected: ended ? 0 : totals.waiting,
        absent: ended ? totals.waiting : 0,
        cancelled: totals.cancelled,
        revenue: totals.revenue,
        byTariff: tariffs.map((t) => ({
          ticketCategoryId: t.id,
          name: t.name,
          sessionQuota: t.sessionQuota,
          ...perTariff.get(t.id)!,
        })),
      };
    });
    const active = rows.filter((r) => r.status === 'SCHEDULED');
    return {
      event: { id: event.id, name: event.name, status: event.status },
      totals: {
        sessions: active.length,
        capacity: active.reduce((sum, r) => sum + r.capacity, 0),
        sold: rows.reduce((sum, r) => sum + r.sold, 0),
        entered: rows.reduce((sum, r) => sum + r.entered, 0),
        absent: rows.reduce((sum, r) => sum + r.absent, 0),
        cancelled: rows.reduce((sum, r) => sum + r.cancelled, 0),
        revenue: rows.reduce((sum, r) => sum + r.revenue, 0),
      },
      sessions: rows,
    };
  }

  // ─── Outils ───

  private async findEvent(auth: TenantContext, id: string) {
    const event = await this.prisma.parkEvent.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: EVENT_SELECT,
    });
    if (!event) throw new NotFoundException(EVENT_NOT_FOUND);
    return event;
  }

  private async lockedSession(tx: Prisma.TransactionClient, eventId: string, sessionId: string) {
    const exists = await tx.parkEventSession.findFirst({
      where: { id: sessionId, eventId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(SESSION_NOT_FOUND);
    await lockEventSession(tx, sessionId);
    return tx.parkEventSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: SESSION_SELECT,
    });
  }

  private async timezoneOf(establishmentId: string) {
    const e = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: establishmentId },
      select: { timezone: true },
    });
    return e.timezone;
  }

  private instants(date: string, startTime: string, endTime: string, timezone: string) {
    const instants = sessionInstants(date, startTime, endTime, timezone);
    if (instants.endsAt <= new Date()) {
      throw new BadRequestException({
        code: 'EVENT_SESSION_IN_PAST',
        message: 'Cette séance serait déjà terminée : choisissez une date et des horaires à venir.',
      });
    }
    return instants;
  }

  /** Validité des billets encore valides d'une séance, recalculée après un changement d'horaire. */
  private async refreshTicketWindows(
    tx: Prisma.TransactionClient,
    session: { id: string; startsAt: Date; endsAt: Date },
    event: { entryOpensBeforeMinutes: number; entryClosesAfterMinutes: number },
  ): Promise<number> {
    const window = eventTicketWindow(
      session,
      event.entryOpensBeforeMinutes,
      event.entryClosesAfterMinutes,
    );
    const { count } = await tx.ticket.updateMany({
      where: { eventSessionId: session.id, status: 'VALID' },
      data: window,
    });
    return count;
  }

  private nameTaken() {
    return {
      code: 'PARK_EVENT_NAME_TAKEN',
      message: 'Un événement porte déjà ce nom dans cet établissement.',
    };
  }

  private sessionTaken() {
    return {
      code: 'EVENT_SESSION_DUPLICATE',
      message: 'Une séance de cet événement commence déjà à cette date et à cette heure.',
    };
  }
}
