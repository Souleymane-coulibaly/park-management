import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  computeSaleTotals,
  coversActivity,
  localMoment,
  MAX_VISITORS_PER_ORDER,
  TICKET_KIND_LABELS,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { findSellingEstablishment } from '../pos/pos-scope';
import type { PricedSale } from '../pos/sale-pricing.service';
import { SalesService } from '../pos/sales.service';
import { CATEGORY_SELECT, toCategory } from './ticket-categories.service';
import { ParkScheduleService, toDbDate } from './park-schedule.service';
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
    AND: [
      { OR: [{ availableFrom: null }, { availableFrom: { lte: day } }] },
      { OR: [{ availableUntil: null }, { availableUntil: { gte: day } }] },
    ],
  };
}

/**
 * Vente de billets : elle réutilise intégralement le moteur de vente de la caisse (session de caisse,
 * numérotation, idempotence, paiement). Seule la valorisation est propre à la billetterie, et elle est
 * faite par le serveur à partir des tarifs en base : aucun prix envoyé par le navigateur n'est lu.
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
    });
  }

  private async sellingPark(auth: TenantContext, establishmentId: string) {
    return findSellingEstablishment(this.prisma, auth, establishmentId, 'PARK');
  }

  /**
   * Valorisation d'une commande : tarifs lus en base, prénoms obligatoires (un par billet individuel),
   * parc ouvert ce jour. Utilisée à l'identique pour l'aperçu et l'enregistrement (dans la transaction).
   */
  private async price(
    db: Db,
    organizationId: string,
    establishment: { id: string; timezone: string },
    lines: TicketOrderLineDto[],
  ): Promise<PricedSale> {
    await this.schedule.assertOpenToday(db, establishment.id, establishment.timezone);
    const ids = lines.map((l) => l.ticketCategoryId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_LINE',
        message: 'Une même catégorie apparaît sur plusieurs lignes : regroupez les quantités.',
      });
    }
    const today = localMoment(new Date(), establishment.timezone).date;
    const categories = await db.ticketCategory.findMany({
      where: { ...sellableWhere(organizationId, establishment.id, today), id: { in: ids } },
      select: { id: true, kind: true, name: true, price: true, peopleIncluded: true },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));
    const unavailable = ids.filter((id) => !byId.has(id));
    if (unavailable.length > 0) {
      throw new BadRequestException({
        code: 'TICKET_CATEGORY_UNAVAILABLE',
        message: 'Une ou plusieurs catégories de billet ne sont pas en vente aujourd’hui.',
        details: unavailable,
      });
    }

    let visitors = 0;
    const resolved = lines.map((l) => {
      const c = byId.get(l.ticketCategoryId)!;
      const names = l.visitorNames.map((n) => n.trim());
      const expected = l.quantity * c.peopleIncluded;
      if (names.length !== expected || names.some((n) => n.length === 0)) {
        throw new BadRequestException({
          code: 'VISITOR_NAMES_MISMATCH',
          message: `« ${c.name} » : saisissez ${expected} prénom(s), un par billet.`,
        });
      }
      visitors += expected;
      return {
        ticketCategoryId: c.id,
        peoplePerUnit: c.peopleIncluded,
        visitorNames: names,
        productName: c.name,
        variantName: TICKET_KIND_LABELS[c.kind],
        unitPrice: c.price,
        quantity: l.quantity,
      };
    });
    if (visitors > MAX_VISITORS_PER_ORDER) {
      throw new BadRequestException({
        code: 'TOO_MANY_VISITORS',
        message: `Une commande est limitée à ${MAX_VISITORS_PER_ORDER} billets.`,
      });
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
