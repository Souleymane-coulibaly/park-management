import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { type Activity, computeChange } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { TicketIssuanceService } from '../ticket-issuance/ticket-issuance.service';
import type { CancelSaleDto, CreateSaleDto, PaySaleDto, QuoteDto, SalesQueryDto } from './pos.dto';
import {
  findSellingEstablishment,
  lockRow,
  requireOpenCashSession,
  visibleSalesWhere,
} from './pos-scope';
import { type PricedSale, SalePricingService } from './sale-pricing.service';

const SALE_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentStatus: true,
  preparationStatus: true,
  total: true,
  activity: true,
  createdAt: true,
  cancelledAt: true,
  cashSessionId: true,
  establishment: { select: { id: true, name: true } },
  cashier: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  lines: {
    select: {
      variantId: true,
      ticketCategoryId: true,
      peoplePerUnit: true,
      visitorNames: true,
      productName: true,
      variantName: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      method: true,
      status: true,
      amount: true,
      amountTendered: true,
      changeGiven: true,
      createdAt: true,
    },
  },
} as const;

type SaleRow = Prisma.SaleGetPayload<{ select: typeof SALE_SELECT }>;

const NOT_FOUND = { code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' };

function toSale({ cashier, ...sale }: SaleRow) {
  return {
    ...sale,
    cashier: { id: cashier.id, name: `${cashier.user.firstName} ${cashier.user.lastName}` },
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const isAlreadyPaid = (error: unknown) =>
  error instanceof ConflictException &&
  (error.getResponse() as { code?: string }).code === 'SALE_ALREADY_PAID';

/**
 * Ventes de la caisse. Règles :
 * - les montants sont calculés par le serveur (SalePricingService) ;
 * - paiement et préparation sont indépendants : encaisser une vente ne modifie JAMAIS
 *   `preparationStatus`, qui reste « NOT_SENT » jusqu'à un envoi explicite en cuisine (module KDS) ;
 * - une vente ou un paiement rejoué avec la même clé d'idempotence n'est pas dupliqué.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: SalePricingService,
    private readonly paymentMethods: PaymentMethodsService,
    private readonly ticketIssuance: TicketIssuanceService,
  ) {}

  /** Aperçu des montants d'un panier, sans rien enregistrer. */
  async quote(auth: TenantContext, dto: QuoteDto) {
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId, 'RESTAURANT');
    return this.pricing.price(
      this.prisma,
      auth.membership.organizationId,
      dto.establishmentId,
      dto.lines,
    );
  }

  /** Vente de restaurant : panier d'articles valorisé aux tarifs de l'établissement. */
  async create(auth: TenantContext, dto: CreateSaleDto) {
    return this.createSale(auth, {
      establishmentId: dto.establishmentId,
      activity: 'RESTAURANT',
      clientRequestId: dto.clientRequestId,
      price: (tx, organizationId) =>
        this.pricing.price(tx, organizationId, dto.establishmentId, dto.lines),
    });
  }

  /**
   * Création d'une vente, commune au restaurant et à la billetterie : session de caisse ouverte
   * obligatoire, montants calculés par le serveur (fonction `price`), numéro séquentiel par
   * établissement, idempotence par clé de requête, audit.
   */
  async createSale(
    auth: TenantContext,
    params: {
      establishmentId: string;
      activity: Activity;
      clientRequestId?: string;
      price: (tx: Prisma.TransactionClient, organizationId: string) => Promise<PricedSale>;
    },
  ) {
    const organizationId = auth.membership.organizationId;
    if (params.clientRequestId) {
      const replay = await this.findReplayedSale(auth, params.clientRequestId);
      if (replay) return replay;
    }
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      params.establishmentId,
      params.activity,
    );
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const session = await requireOpenCashSession(tx, auth, establishment.id);
        const priced = await params.price(tx, organizationId);
        const { saleSeq } = await tx.establishment.update({
          where: { id: establishment.id },
          data: { saleSeq: { increment: 1 } },
          select: { saleSeq: true },
        });
        const sale = await tx.sale.create({
          data: {
            organizationId,
            establishmentId: establishment.id,
            cashSessionId: session.id,
            cashierId: auth.membership.id,
            number: saleSeq,
            activity: params.activity,
            total: priced.total,
            clientRequestId: params.clientRequestId,
            lines: { create: priced.lines.map((l) => ({ ...l, organizationId })) },
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'sale.created',
            targetType: 'Sale',
            targetId: sale.id,
            metadata: {
              number: saleSeq,
              total: priced.total,
              lines: priced.lines.length,
              activity: params.activity,
            },
          },
          tx,
        );
        return sale.id;
      });
      return this.get(auth, id);
    } catch (error) {
      // Deux envois simultanés de la même vente : le second renvoie la vente déjà créée.
      if (params.clientRequestId && isUniqueViolation(error)) {
        const replay = await this.findReplayedSale(auth, params.clientRequestId);
        if (replay) return replay;
      }
      throw error;
    }
  }

  async list(auth: TenantContext, query: SalesQueryDto) {
    const createdAt =
      query.from || query.to
        ? {
            gte: query.from ? new Date(query.from) : undefined,
            lte: query.to ? new Date(query.to) : undefined,
          }
        : undefined;
    const sales = await this.prisma.sale.findMany({
      where: {
        ...visibleSalesWhere(auth),
        establishmentId: query.establishmentId,
        cashSessionId: query.cashSessionId,
        paymentStatus: query.paymentStatus,
        status: query.status,
        activity: query.activity,
        createdAt,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      select: SALE_SELECT,
    });
    return sales.map(toSale);
  }

  async get(auth: TenantContext, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { ...visibleSalesWhere(auth), id },
      select: SALE_SELECT,
    });
    if (!sale) throw new NotFoundException(NOT_FOUND);
    return toSale(sale);
  }

  /**
   * Encaissement intégral d'une vente. Seules les espèces sont disponibles : un moyen
   * électronique non branché (Wave) est refusé explicitement, sans simulation.
   */
  async pay(auth: TenantContext, id: string, dto: PaySaleDto) {
    const organizationId = auth.membership.organizationId;
    this.paymentMethods.assertAvailable(dto.method);
    if (dto.method === 'CASH' && dto.amountTendered === undefined) {
      throw new BadRequestException({
        code: 'AMOUNT_TENDERED_REQUIRED',
        message: 'Indiquez le montant remis par le client.',
      });
    }
    if (dto.clientRequestId) {
      const replay = await this.findReplayedPayment(auth, id, dto.clientRequestId);
      if (replay) return replay;
    }

    try {
      const paymentId = await this.prisma.$transaction(async (tx) => {
        const visible = await tx.sale.findFirst({
          where: { ...visibleSalesWhere(auth), id },
          select: { id: true },
        });
        if (!visible) throw new NotFoundException(NOT_FOUND);
        await lockRow(tx, 'Sale', id);
        const sale = await tx.sale.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            paymentStatus: true,
            total: true,
            establishmentId: true,
            number: true,
            activity: true,
          },
        });
        if (sale.status === 'CANCELLED') {
          throw new ConflictException({
            code: 'SALE_CANCELLED',
            message: 'Cette vente a été annulée.',
          });
        }
        if (sale.paymentStatus === 'PAID') {
          throw new ConflictException({
            code: 'SALE_ALREADY_PAID',
            message: 'Cette vente est déjà payée.',
          });
        }
        const session = await requireOpenCashSession(tx, auth, sale.establishmentId);
        const change = computeChange(sale.total, dto.amountTendered!);
        if (change === null) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_CASH',
            message: 'Le montant remis est inférieur au total de la vente.',
          });
        }
        const payment = await tx.payment.create({
          data: {
            organizationId,
            saleId: id,
            cashSessionId: session.id,
            receivedById: auth.membership.id,
            method: 'CASH',
            status: 'SUCCEEDED',
            amount: sale.total,
            amountTendered: dto.amountTendered,
            changeGiven: change,
            clientRequestId: dto.clientRequestId,
          },
        });
        // Paiement seulement : le statut de préparation n'est volontairement PAS modifié.
        await tx.sale.update({ where: { id }, data: { paymentStatus: 'PAID' } });
        // Billetterie : les billets (et leurs QR codes) ne sont émis qu'ici, dans la transaction du
        // paiement confirmé. Un paiement rejoué ne repasse jamais par ce point (vente déjà payée).
        if (sale.activity === 'PARK') await this.ticketIssuance.issueForPaidSale(tx, auth, id);
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'sale.paid',
            targetType: 'Sale',
            targetId: id,
            metadata: {
              number: sale.number,
              method: 'CASH',
              amount: sale.total,
              amountTendered: dto.amountTendered,
              changeGiven: change,
            },
          },
          tx,
        );
        return payment.id;
      });
      return this.paymentResult(auth, id, paymentId);
    } catch (error) {
      // Même paiement envoyé deux fois en même temps : le second attend le verrou de la vente puis la
      // trouve payée (ou bute sur la clé unique) ; il renvoie alors le paiement déjà enregistré.
      if (dto.clientRequestId && (isUniqueViolation(error) || isAlreadyPaid(error))) {
        const replay = await this.findReplayedPayment(auth, id, dto.clientRequestId);
        if (replay) return replay;
      }
      throw error;
    }
  }

  /** Annulation d'une vente non payée (une vente payée ne s'annule pas : le remboursement viendra plus tard). */
  async cancel(auth: TenantContext, id: string, dto: CancelSaleDto) {
    const organizationId = auth.membership.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const visible = await tx.sale.findFirst({
        where: { ...visibleSalesWhere(auth), id },
        select: { id: true },
      });
      if (!visible) throw new NotFoundException(NOT_FOUND);
      await lockRow(tx, 'Sale', id);
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id },
        select: { status: true, paymentStatus: true, number: true },
      });
      if (sale.status !== 'OPEN' || sale.paymentStatus !== 'UNPAID') {
        throw new ConflictException({
          code: 'SALE_NOT_CANCELLABLE',
          message: 'Seule une vente non payée peut être annulée.',
        });
      }
      await tx.sale.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: auth.membership.id },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'sale.cancelled',
          targetType: 'Sale',
          targetId: id,
          metadata: { number: sale.number, reason: dto.reason ?? null },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  private async paymentResult(auth: TenantContext, saleId: string, paymentId: string) {
    const sale = await this.get(auth, saleId);
    const payment = sale.payments.find((p) => p.id === paymentId)!;
    return { sale, payment };
  }

  private async findReplayedSale(auth: TenantContext, clientRequestId: string) {
    const existing = await this.prisma.sale.findFirst({
      where: { organizationId: auth.membership.organizationId, clientRequestId },
      select: { id: true, cashierId: true },
    });
    if (!existing) return null;
    if (existing.cashierId !== auth.membership.id) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Clé de requête déjà utilisée.',
      });
    }
    return this.get(auth, existing.id);
  }

  private async findReplayedPayment(auth: TenantContext, saleId: string, clientRequestId: string) {
    const existing = await this.prisma.payment.findFirst({
      where: { organizationId: auth.membership.organizationId, clientRequestId },
      select: { id: true, saleId: true, receivedById: true },
    });
    if (!existing) return null;
    if (existing.saleId !== saleId || existing.receivedById !== auth.membership.id) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Clé de requête déjà utilisée.',
      });
    }
    return this.paymentResult(auth, saleId, existing.id);
  }
}
