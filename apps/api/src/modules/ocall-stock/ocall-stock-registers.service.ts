import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_MAX_HELD_CARTS,
  type StockPaymentMethod,
  stockCashSessionNumber,
  stockSaleNumber,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type StockContext, stockSiteAllowed, stockSiteWhere } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import type {
  CloseStockCashSessionDto,
  HoldStockCartDto,
  OpenStockCashSessionDto,
  StockRegisterDto,
  UpdateStockRegisterDto,
} from './ocall-stock.dto';

type Tx = Prisma.TransactionClient;
type Db = Tx | OcallStockPrismaService;

const REGISTER_NOT_FOUND = { code: 'STOCK_REGISTER_NOT_FOUND', message: 'Caisse introuvable.' };
const SESSION_NOT_FOUND = {
  code: 'STOCK_CASH_SESSION_NOT_FOUND',
  message: 'Session de caisse introuvable.',
};
const METHODS: StockPaymentMethod[] = ['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'];

/** Panier en attente : lignes sans prix (relus à l'encaissement) et client facultatif. */
export interface StockHeldCartView {
  id: string;
  registerId: string;
  label: string;
  createdAt: Date;
  payload: {
    customerId: string | null;
    lines: { variantId: string; quantity: number; discount: number }[];
  };
}

const heldView = (c: {
  id: string;
  registerId: string;
  label: string;
  createdAt: Date;
  payload: Prisma.JsonValue;
}): StockHeldCartView => ({
  id: c.id,
  registerId: c.registerId,
  label: c.label,
  createdAt: c.createdAt,
  payload: c.payload as unknown as StockHeldCartView['payload'],
});

/** Résumé d'une session : encaissements et remboursements par moyen, espèces attendues dans le tiroir. */
export interface StockSessionSummary {
  salesCount: number;
  returnsCount: number;
  salesTotal: number;
  discountTotal: number;
  /** Encaissé par moyen (paiements des ventes, monnaie déjà déduite). */
  received: Record<StockPaymentMethod, number>;
  /** Remboursé par moyen (retours). */
  refunded: Record<StockPaymentMethod, number>;
  /** Fond de caisse + espèces encaissées − espèces remboursées. */
  expectedCash: number;
}

/**
 * Caisses (S4) : une caisse appartient à un site et vend depuis un de ses emplacements. Sessions : fond de
 * caisse à l'ouverture, une seule session ouverte par caisse (garanti par la base) ; à la clôture, espèces
 * comptées comparées aux espèces attendues, écart enregistré avec son motif. Paniers en attente par caisse.
 */
@Injectable()
export class OcallStockRegistersService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly sites: OcallStockSitesService,
    private readonly audit: AuditService,
  ) {}

  // ─── Caisses ───

  async list(ctx: StockContext, opts: { archived?: boolean } = {}) {
    const rows = await this.db.stockRegister.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...stockSiteWhere(ctx),
        ...(opts.archived ? {} : { isArchived: false }),
      },
      orderBy: [{ isArchived: 'asc' }, { code: 'asc' }],
      include: {
        site: { select: { id: true, code: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
        sessions: {
          where: { status: 'OPEN' },
          select: { id: true, number: true, openedAt: true, openedByUserId: true },
        },
      },
    });
    const names = await this.userNames(
      rows.flatMap((r) => r.sessions.map((s) => s.openedByUserId)),
    );
    return rows.map(({ sessions, ...r }) => ({
      ...r,
      openSession: sessions[0]
        ? {
            ...sessions[0],
            label: stockCashSessionNumber(sessions[0].number),
            openedBy: names.get(sessions[0].openedByUserId) ?? null,
          }
        : null,
    }));
  }

  /** Caisse accessible (site du membre), éventuellement verrouillée dans la transaction. */
  async register(ctx: StockContext, id: string, db: Db = this.db) {
    const register = await db.stockRegister.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: {
        site: { select: { id: true, code: true, name: true, isArchived: true } },
        location: { select: { id: true, code: true, name: true, isArchived: true } },
      },
    });
    if (!register || !stockSiteAllowed(ctx, register.siteId))
      throw new NotFoundException(REGISTER_NOT_FOUND);
    return register;
  }

  async create(ctx: StockContext, dto: StockRegisterDto) {
    const location = await this.sites.location(ctx, dto.locationId, { active: true });
    try {
      const register = await this.db.stockRegister.create({
        data: {
          organizationId: ctx.organizationId,
          siteId: location.siteId,
          locationId: location.id,
          code: dto.code,
          name: dto.name,
          paperWidth: dto.paperWidth ?? 80,
          printerConnection: dto.printerConnection ?? 'NONE',
          printerAddress: dto.printerAddress ?? null,
        },
      });
      await this.record(ctx, 'stock.register_created', 'StockRegister', register.id);
      return register;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  async update(ctx: StockContext, id: string, dto: UpdateStockRegisterDto) {
    const current = await this.register(ctx, id);
    const open = await this.openSession(this.db, ctx, id);
    if (open && (dto.locationId !== undefined || dto.isArchived)) {
      throw new ConflictException({
        code: 'STOCK_REGISTER_SESSION_OPEN',
        message: 'Clôturez la session de cette caisse avant de la déplacer ou de l’archiver.',
      });
    }
    let siteId = current.siteId;
    if (dto.locationId !== undefined && dto.locationId !== current.locationId) {
      siteId = (await this.sites.location(ctx, dto.locationId, { active: true })).siteId;
    }
    try {
      const register = await this.db.stockRegister.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: { ...dto, siteId },
      });
      await this.record(ctx, 'stock.register_updated', 'StockRegister', id, {
        fields: Object.keys(dto),
      });
      return register;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  // ─── Sessions ───

  /** Session ouverte d'une caisse ; `lock` : verrou partagé (une vente) ou exclusif (la clôture). */
  async openSession(db: Db, ctx: StockContext, registerId: string, lock?: 'share' | 'update') {
    const rows = lock
      ? await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "StockCashSession"
          WHERE "organizationId" = ${ctx.organizationId}::uuid AND "registerId" = ${registerId}::uuid
            AND "status" = 'OPEN'
          ${lock === 'share' ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`
      : await db.stockCashSession.findMany({
          where: { organizationId: ctx.organizationId, registerId, status: 'OPEN' },
          select: { id: true },
        });
    if (!rows[0]) return null;
    return db.stockCashSession.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  async open(ctx: StockContext, registerId: string, dto: OpenStockCashSessionDto) {
    const register = await this.register(ctx, registerId);
    if (register.isArchived || register.site.isArchived || register.location.isArchived) {
      throw new ConflictException({
        code: 'STOCK_REGISTER_ARCHIVED',
        message: 'Caisse, site ou emplacement archivé.',
      });
    }
    try {
      const session = await this.db.$transaction(async (tx) => {
        const counter = await tx.stockNumberCounter.upsert({
          where: {
            organizationId_kind: { organizationId: ctx.organizationId, kind: 'CASH_SESSION' },
          },
          create: { organizationId: ctx.organizationId, kind: 'CASH_SESSION', value: 1 },
          update: { value: { increment: 1 } },
        });
        return tx.stockCashSession.create({
          data: {
            organizationId: ctx.organizationId,
            number: counter.value,
            registerId,
            siteId: register.siteId,
            openingFloat: dto.openingFloat,
            openedByUserId: ctx.userId,
          },
        });
      });
      await this.record(ctx, 'stock.cash_session_opened', 'StockCashSession', session.id, {
        openingFloat: String(dto.openingFloat),
      });
      return this.session(ctx, session.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'STOCK_CASH_SESSION_ALREADY_OPEN',
          message: 'Une session est déjà ouverte sur cette caisse.',
        });
      }
      throw e;
    }
  }

  /**
   * Clôture : espèces comptées contre espèces attendues (fond + encaissé − remboursé). Un écart est
   * enregistré avec son motif (obligatoire) ; la session se clôt quand même et l'écart figure au rapport.
   * Verrou exclusif sur la session : aucune vente ne peut s'y ajouter pendant le calcul.
   */
  async close(ctx: StockContext, sessionId: string, dto: CloseStockCashSessionDto) {
    const closed = await this.db.$transaction(async (tx) => {
      const head = await tx.stockCashSession.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: sessionId } },
        select: { registerId: true, siteId: true },
      });
      if (!head || !stockSiteAllowed(ctx, head.siteId))
        throw new NotFoundException(SESSION_NOT_FOUND);
      const session = await this.openSession(tx, ctx, head.registerId, 'update');
      if (!session || session.id !== sessionId) {
        throw new ConflictException({
          code: 'STOCK_CASH_SESSION_CLOSED',
          message: 'Cette session est déjà clôturée.',
        });
      }
      const summary = await this.summary(tx, ctx, session);
      const difference = dto.countedCash - summary.expectedCash;
      const reason = dto.differenceReason?.trim() || null;
      if (difference !== 0 && (!reason || reason.length < 3)) {
        throw new BadRequestException({
          code: 'STOCK_CASH_DIFFERENCE_REASON',
          message: `Écart de ${difference > 0 ? '+' : ''}${difference} : indiquez-en le motif.`,
        });
      }
      await tx.stockCashSession.update({
        where: { id: sessionId },
        data: {
          status: 'CLOSED',
          expectedCash: summary.expectedCash,
          countedCash: dto.countedCash,
          difference,
          differenceReason: difference === 0 ? null : reason,
          closedByUserId: ctx.userId,
          closedAt: new Date(),
        },
      });
      return { difference };
    });
    await this.record(ctx, 'stock.cash_session_closed', 'StockCashSession', sessionId, {
      difference: String(closed.difference),
    });
    return this.session(ctx, sessionId);
  }

  async sessions(ctx: StockContext, registerId?: string) {
    const rows = await this.db.stockCashSession.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...stockSiteWhere(ctx),
        ...(registerId ? { registerId } : {}),
      },
      orderBy: { number: 'desc' },
      take: 100,
      include: { register: { select: { id: true, code: true, name: true } } },
    });
    const names = await this.userNames(rows.map((r) => r.openedByUserId));
    return rows.map((s) => ({
      ...s,
      label: stockCashSessionNumber(s.number),
      openedBy: names.get(s.openedByUserId) ?? null,
    }));
  }

  /** Session et son rapport (encaissements par moyen, remboursements, espèces attendues, ventes). */
  async session(ctx: StockContext, id: string) {
    const session = await this.db.stockCashSession.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: { register: { select: { id: true, code: true, name: true } } },
    });
    if (!session || !stockSiteAllowed(ctx, session.siteId))
      throw new NotFoundException(SESSION_NOT_FOUND);
    const [summary, sales] = await Promise.all([
      this.summary(this.db, ctx, session),
      this.db.stockSale.findMany({
        where: { organizationId: ctx.organizationId, sessionId: id },
        orderBy: { number: 'desc' },
        take: 500,
        select: { id: true, number: true, total: true, createdAt: true, cashierName: true },
      }),
    ]);
    const names = await this.userNames(
      [session.openedByUserId, session.closedByUserId].filter((x): x is string => Boolean(x)),
    );
    return {
      ...session,
      label: stockCashSessionNumber(session.number),
      openedBy: names.get(session.openedByUserId) ?? null,
      closedBy: session.closedByUserId ? (names.get(session.closedByUserId) ?? null) : null,
      summary,
      sales: sales.map((s) => ({ ...s, label: stockSaleNumber(s.number) })),
    };
  }

  async summary(
    db: Db,
    ctx: StockContext,
    session: { id: string; openingFloat: number },
  ): Promise<StockSessionSummary> {
    const [payments, sales, returnsCount] = await Promise.all([
      db.stockPayment.groupBy({
        by: ['method', 'returnId'],
        where: { organizationId: ctx.organizationId, sessionId: session.id },
        _sum: { amount: true },
      }),
      db.stockSale.aggregate({
        where: { organizationId: ctx.organizationId, sessionId: session.id },
        _count: { _all: true },
        _sum: { total: true, discountTotal: true },
      }),
      db.stockSaleReturn.count({
        where: { organizationId: ctx.organizationId, sessionId: session.id },
      }),
    ]);
    const received = Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<
      StockPaymentMethod,
      number
    >;
    const refunded = { ...received };
    for (const p of payments) {
      const amount = p._sum.amount ?? 0;
      if (p.returnId) refunded[p.method] += -amount;
      else received[p.method] += amount;
    }
    return {
      salesCount: sales._count._all,
      returnsCount,
      salesTotal: sales._sum.total ?? 0,
      discountTotal: sales._sum.discountTotal ?? 0,
      received,
      refunded,
      expectedCash: session.openingFloat + received.CASH - refunded.CASH,
    };
  }

  // ─── Paniers en attente ───

  async heldCarts(ctx: StockContext, registerId: string): Promise<StockHeldCartView[]> {
    await this.register(ctx, registerId);
    const carts = await this.db.stockHeldCart.findMany({
      where: { organizationId: ctx.organizationId, registerId },
      orderBy: { createdAt: 'asc' },
    });
    return carts.map(heldView);
  }

  async hold(
    ctx: StockContext,
    registerId: string,
    dto: HoldStockCartDto,
  ): Promise<StockHeldCartView> {
    await this.register(ctx, registerId);
    const count = await this.db.stockHeldCart.count({
      where: { organizationId: ctx.organizationId, registerId },
    });
    if (count >= STOCK_MAX_HELD_CARTS) {
      throw new ConflictException({
        code: 'STOCK_HELD_CARTS_LIMIT',
        message: `${STOCK_MAX_HELD_CARTS} paniers en attente au plus par caisse.`,
      });
    }
    const cart = await this.db.stockHeldCart.create({
      data: {
        organizationId: ctx.organizationId,
        registerId,
        label: dto.label,
        payload: {
          customerId: dto.customerId ?? null,
          lines: dto.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            discount: l.discount ?? 0,
          })),
        },
        createdByUserId: ctx.userId,
      },
    });
    return heldView(cart);
  }

  /** Reprise : le panier est retiré de l'attente et rendu à la caisse (une seule fois). */
  async resume(ctx: StockContext, cartId: string): Promise<StockHeldCartView> {
    const cart = await this.db.stockHeldCart.findFirst({
      where: { organizationId: ctx.organizationId, id: cartId },
    });
    if (cart) await this.register(ctx, cart.registerId);
    // Deux caisses qui reprennent le même panier : une seule suppression aboutit.
    const deleted = cart
      ? await this.db.stockHeldCart.deleteMany({
          where: { organizationId: ctx.organizationId, id: cartId },
        })
      : { count: 0 };
    if (!cart || deleted.count === 0) {
      throw new NotFoundException({
        code: 'STOCK_HELD_CART_NOT_FOUND',
        message: 'Panier en attente introuvable (déjà repris ?).',
      });
    }
    return heldView(cart);
  }

  // ─── Outils ───

  async userNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, string>();
    const users = await this.core.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  private duplicate(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException({
        code: 'STOCK_REGISTER_CODE_TAKEN',
        message: 'Ce code de caisse est déjà utilisé.',
      });
    }
    return e;
  }

  private async record(
    ctx: StockContext,
    action: string,
    targetType: string,
    id: string,
    metadata?: Record<string, string | string[]>,
  ) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId: id,
      ...(metadata ? { metadata } : {}),
    });
  }
}
