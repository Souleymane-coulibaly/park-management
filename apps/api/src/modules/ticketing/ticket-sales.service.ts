import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  computeSaleTotals,
  coversActivity,
  localMoment,
  MAX_VISITORS_PER_ORDER,
  sessionLabel,
  TICKET_KIND_LABELS,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { findSellingEstablishment } from '../pos/pos-scope';
import type { PricedSale, PricedSaleLine } from '../pos/sale-pricing.service';
import { SalesService } from '../pos/sales.service';
import { assertPlaces, soldBySession } from '../ticket-issuance/event-capacity';
import { CATEGORY_SELECT, toCategory } from './ticket-categories.service';
import { fromDbDate, ParkScheduleService, toDbDate } from './park-schedule.service';
import type { CreateTicketOrderDto, TicketOrderLineDto, TicketQuoteDto } from './ticketing.dto';

type Db = Prisma.TransactionClient;

/** Catégories vendables aujourd'hui : actives et dans leur fenêtre de vente (dates locales). */
function sellableWhere(
  organizationId: string,
  establishmentId: string,
  today: string,
): Prisma.TicketCategoryWhereInput {
  const day = toDbDate(today);
  return {
    organizationId,
    establishmentId,
    isActive: true,
    eventId: null,
    AND: [
      { OR: [{ availableFrom: null }, { availableFrom: { lte: day } }] },
      { OR: [{ availableUntil: null }, { availableUntil: { gte: day } }] },
    ],
  };
}

/** Séance en vente : programmée, vente ouverte, événement publié, pas encore terminée. */
export function sessionOnSaleWhere(now: Date): Prisma.ParkEventSessionWhereInput {
  return {
    status: 'SCHEDULED',
    salesOpen: true,
    endsAt: { gt: now },
    event: { status: 'PUBLISHED' },
  };
}

const NOT_ON_SALE = {
  code: 'EVENT_SESSION_NOT_ON_SALE',
  message: 'Cette séance n’est pas en vente (annulée, fermée, terminée ou événement non publié).',
};

/**
 * Vente de billets : elle réutilise intégralement le moteur de vente de la caisse (session de caisse,
 * numérotation, idempotence, paiement). Seule la valorisation est propre à la billetterie, et elle est
 * faite par le serveur à partir des tarifs en base : aucun prix envoyé par le navigateur n'est lu.
 * Billets classiques (jour de la vente) et billets d'événement (séance datée) passent par la même
 * commande ; la capacité d'une séance est garantie au paiement (TicketIssuanceService).
 */
@Injectable()
export class TicketSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly schedule: ParkScheduleService,
  ) {}

  /** Établissements parc actifs du périmètre (vente ou contrôle d'accès). */
  async establishments(auth: TenantContext) {
    const rows = await this.prisma.establishment.findMany({
      where: { ...establishmentScope(auth), isActive: true },
      select: { id: true, name: true, businessType: true, timezone: true },
      orderBy: { name: 'asc' },
    });
    return rows
      .filter((e) => coversActivity(e.businessType, 'PARK'))
      .map(({ id, name, timezone }) => ({ id, name, timezone }));
  }

  /** Catalogue du jour et état d'ouverture du parc. */
  async catalog(auth: TenantContext, establishmentId: string) {
    const establishment = await this.sellingPark(auth, establishmentId);
    const { today, openToday, status } = await this.schedule.get(auth, establishment.id);
    const categories = await this.prisma.ticketCategory.findMany({
      where: sellableWhere(auth.membership.organizationId, establishment.id, today),
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: CATEGORY_SELECT,
    });
    return { today, openToday, status, categories: categories.map(toCategory) };
  }

  /**
   * Événements en vente au guichet : séances à venir (ou en cours) ouvertes à la vente, places
   * restantes de la séance et de chaque tarif.
   */
  async eventCatalog(auth: TenantContext, establishmentId: string) {
    const establishment = await this.sellingPark(auth, establishmentId);
    const now = new Date();
    const events = await this.prisma.parkEvent.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: establishment.id,
        status: 'PUBLISHED',
        sessions: { some: sessionOnSaleWhere(now) },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        conditions: true,
        sessions: {
          where: sessionOnSaleWhere(now),
          orderBy: { startsAt: 'asc' },
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            startsAt: true,
            endsAt: true,
            capacity: true,
          },
        },
        tariffs: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: CATEGORY_SELECT,
        },
      },
    });
    const sold = await soldBySession(
      this.prisma,
      events.flatMap((e) => e.sessions.map((s) => s.id)),
    );
    return events
      .filter((e) => e.tariffs.length > 0)
      .map(({ sessions, tariffs, ...event }) => ({
        ...event,
        tariffs: tariffs.map(toCategory),
        sessions: sessions.map(({ date, ...s }) => {
          const sales = sold.get(s.id)!;
          return {
            ...s,
            date: fromDbDate(date),
            sold: sales.total,
            placesLeft: Math.max(0, s.capacity - sales.total),
            tariffs: tariffs.map((t) => ({
              ticketCategoryId: t.id,
              placesLeft:
                t.sessionQuota === null
                  ? null
                  : Math.max(0, t.sessionQuota - (sales.byCategory.get(t.id) ?? 0)),
            })),
          };
        }),
      }));
  }

  async quote(auth: TenantContext, dto: TicketQuoteDto) {
    const establishment = await this.sellingPark(auth, dto.establishmentId);
    return this.price(this.prisma, auth.membership.organizationId, establishment, dto.lines);
  }

  /** Commande de billets : vente PARK non payée ; les billets sont émis au paiement. */
  async order(auth: TenantContext, dto: CreateTicketOrderDto) {
    const establishment = await this.sellingPark(auth, dto.establishmentId);
    return this.sales.createSale(auth, {
      establishmentId: establishment.id,
      activity: 'PARK',
      clientRequestId: dto.clientRequestId,
      price: (tx, organizationId) => this.price(tx, organizationId, establishment, dto.lines),
      // Fiche client facultative : contact de l'acheteur (ex. prévenir en cas d'annulation de séance).
      afterCreate: dto.customerId
        ? async (tx, saleId) => {
            const customer = await tx.customer.findFirst({
              where: {
                id: dto.customerId,
                organizationId: auth.membership.organizationId,
                anonymizedAt: null,
              },
              select: { id: true },
            });
            if (!customer) {
              throw new BadRequestException({
                code: 'CUSTOMER_NOT_FOUND',
                message: 'Fiche client introuvable.',
              });
            }
            await tx.sale.update({ where: { id: saleId }, data: { customerId: customer.id } });
          }
        : undefined,
    });
  }

  private async sellingPark(auth: TenantContext, establishmentId: string) {
    return findSellingEstablishment(this.prisma, auth, establishmentId, 'PARK');
  }

  /**
   * Valorisation d'une commande : tarifs lus en base, prénoms (obligatoires sauf billet d'événement
   * non nominatif), parc ouvert ce jour pour les billets classiques, séance en vente et places
   * disponibles pour les billets d'événement. Utilisée à l'identique pour l'aperçu et
   * l'enregistrement (dans la transaction). La capacité est revérifiée sous verrou au paiement.
   */
  private async price(
    db: Db,
    organizationId: string,
    establishment: { id: string; timezone: string },
    lines: TicketOrderLineDto[],
  ): Promise<PricedSale> {
    const keys = lines.map((l) => `${l.ticketCategoryId}:${l.eventSessionId ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_LINE',
        message: 'Une même catégorie apparaît sur plusieurs lignes : regroupez les quantités.',
      });
    }
    const now = new Date();
    const today = localMoment(now, establishment.timezone).date;
    const classicIds = lines.filter((l) => !l.eventSessionId).map((l) => l.ticketCategoryId);
    const eventLines = lines.filter((l) => l.eventSessionId);
    if (classicIds.length > 0) {
      await this.schedule.assertOpenToday(db, establishment.id, establishment.timezone);
    }

    const tariffSelect = {
      id: true,
      kind: true,
      name: true,
      price: true,
      peopleIncluded: true,
      eventId: true,
      sessionQuota: true,
      requiresVisitorName: true,
    } as const;
    const [classic, eventTariffs, sessions] = await Promise.all([
      classicIds.length
        ? db.ticketCategory.findMany({
            where: {
              ...sellableWhere(organizationId, establishment.id, today),
              id: { in: classicIds },
            },
            select: tariffSelect,
          })
        : [],
      eventLines.length
        ? db.ticketCategory.findMany({
            where: {
              organizationId,
              establishmentId: establishment.id,
              isActive: true,
              eventId: { not: null },
              id: { in: eventLines.map((l) => l.ticketCategoryId) },
            },
            select: tariffSelect,
          })
        : [],
      eventLines.length
        ? db.parkEventSession.findMany({
            where: {
              organizationId,
              establishmentId: establishment.id,
              id: { in: eventLines.map((l) => l.eventSessionId!) },
            },
            select: {
              id: true,
              eventId: true,
              date: true,
              startTime: true,
              endTime: true,
              status: true,
              salesOpen: true,
              endsAt: true,
              capacity: true,
              event: { select: { name: true, status: true } },
            },
          })
        : [],
    ]);
    const classicById = new Map(classic.map((c) => [c.id, c]));
    const eventById = new Map(eventTariffs.map((c) => [c.id, c]));
    const sessionById = new Map(sessions.map((s) => [s.id, s]));

    const unavailable = classicIds.filter((id) => !classicById.has(id));
    if (unavailable.length > 0) {
      // Un tarif d'événement envoyé sans séance : message explicite plutôt que « pas en vente ».
      const eventTariffWithoutSession = await db.ticketCategory.count({
        where: { id: { in: unavailable }, organizationId, eventId: { not: null } },
      });
      if (eventTariffWithoutSession > 0) {
        throw new BadRequestException({
          code: 'EVENT_SESSION_REQUIRED',
          message: 'Choisissez la séance de l’événement.',
        });
      }
      throw new BadRequestException({
        code: 'TICKET_CATEGORY_UNAVAILABLE',
        message: 'Une ou plusieurs catégories de billet ne sont pas en vente aujourd’hui.',
        details: unavailable,
      });
    }

    let visitors = 0;
    const requestedBySession = new Map<string, Map<string, number>>();
    const resolved: Omit<PricedSaleLine, 'lineTotal'>[] = lines.map((l) => {
      const session = l.eventSessionId ? sessionById.get(l.eventSessionId) : undefined;
      const found = l.eventSessionId
        ? eventById.get(l.ticketCategoryId)
        : classicById.get(l.ticketCategoryId);
      if (l.eventSessionId) {
        if (!found || !session || session.eventId !== found.eventId) {
          throw new BadRequestException({
            code: 'EVENT_TARIFF_UNAVAILABLE',
            message: 'Ce tarif n’est pas proposé pour cette séance.',
          });
        }
        if (
          session.status !== 'SCHEDULED' ||
          !session.salesOpen ||
          session.event.status !== 'PUBLISHED' ||
          session.endsAt <= now
        ) {
          throw new ConflictException(NOT_ON_SALE);
        }
      }
      const tariff = found!;
      const expected = l.quantity * tariff.peopleIncluded;
      let names = l.visitorNames.map((n) => n.trim());
      if (!tariff.requiresVisitorName && names.length === 0)
        names = Array<string>(expected).fill('');
      if (
        names.length !== expected ||
        (tariff.requiresVisitorName && names.some((n) => n.length === 0))
      ) {
        throw new BadRequestException({
          code: 'VISITOR_NAMES_MISMATCH',
          message: tariff.requiresVisitorName
            ? `« ${tariff.name} » : saisissez ${expected} prénom(s), un par billet.`
            : `« ${tariff.name} » : ${expected} billet(s) attendu(s).`,
        });
      }
      visitors += expected;
      if (session) {
        const bucket = requestedBySession.get(session.id) ?? new Map<string, number>();
        bucket.set(tariff.id, (bucket.get(tariff.id) ?? 0) + expected);
        requestedBySession.set(session.id, bucket);
      }
      return {
        ticketCategoryId: tariff.id,
        peoplePerUnit: tariff.peopleIncluded,
        visitorNames: names,
        ...(session
          ? {
              eventSessionId: session.id,
              productName: `${session.event.name} — ${tariff.name}`,
              variantName: sessionLabel({
                date: fromDbDate(session.date),
                startTime: session.startTime,
                endTime: session.endTime,
              }),
            }
          : { productName: tariff.name, variantName: TICKET_KIND_LABELS[tariff.kind] }),
        unitPrice: tariff.price,
        quantity: l.quantity,
      };
    });
    if (visitors > MAX_VISITORS_PER_ORDER) {
      throw new BadRequestException({
        code: 'TOO_MANY_VISITORS',
        message: `Une commande est limitée à ${MAX_VISITORS_PER_ORDER} billets.`,
      });
    }

    // Places : contrôle immédiat pour informer le caissier ; la garantie est posée au paiement.
    if (requestedBySession.size > 0) {
      const sold = await soldBySession(db, [...requestedBySession.keys()]);
      for (const [sessionId, requested] of requestedBySession) {
        assertPlaces(sessionById.get(sessionId)!, sold.get(sessionId)!, requested, eventById);
      }
    }

    let totals;
    try {
      totals = computeSaleTotals(resolved);
    } catch (error) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: (error as Error).message });
    }
    return {
      lines: resolved.map((l, i) => ({ ...l, lineTotal: totals.lineTotals[i]! })),
      total: totals.total,
    };
  }
}
