import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@ocall/database';
import {
  DINING_QR_TOKEN_PATTERN,
  KIOSK_MAX_ORDERS_PER_10_MIN,
  MAX_PENDING_QR_REQUESTS_PER_POINT,
  QR_REQUEST_PENDING_WINDOW_MINUTES,
  type QrOrderStatus,
  coversActivity,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { recordOrderEvent } from '../pos/order-events';
import { findSellingEstablishment, lockRow } from '../pos/pos-scope';
import { SalePricingService } from '../pos/sale-pricing.service';
import { SalesService } from '../pos/sales.service';
import { loadSellableCatalog } from '../pos/sellable-catalog';
import { RestaurantEventsService } from '../realtime/restaurant-events.service';
import type { PublicOrderDto } from './restaurant.dto';

/** Ligne d'une demande client, telle que stockée (libellés et prix indicatifs du moment). */
export interface RequestLine {
  variantId: string;
  quantity: number;
  notes: string | null;
  productName: string;
  variantName: string;
  unitPrice: number;
}

const MENU_NOT_FOUND = {
  code: 'MENU_NOT_FOUND',
  message: 'Ce QR code n’est pas ou plus valide. Adressez-vous au personnel.',
};
const REQUEST_NOT_FOUND = { code: 'QR_ORDER_NOT_FOUND', message: 'Demande introuvable.' };
const ALREADY_DECIDED = {
  code: 'QR_ORDER_ALREADY_DECIDED',
  message: 'Cette demande a déjà été traitée.',
};

/** Borne d'origine d'une commande libre-service. */
export interface KioskOrigin {
  organizationId: string;
  establishmentId: string;
  establishmentName: string;
  deviceId: string;
  deviceName: string;
  sessionId: string;
}

const REQUEST_RESULT = {
  id: true,
  publicToken: true,
  status: true,
  estimatedTotal: true,
  displayNumber: true,
} as const;

const toRequestResult = (r: {
  publicToken: string;
  status: QrOrderStatus;
  estimatedTotal: number;
  displayNumber: number | null;
}) => ({
  publicToken: r.publicToken,
  status: r.status,
  estimatedTotal: r.estimatedTotal,
  displayNumber: r.displayNumber,
});

/** Jeton de suivi remis au client : 128 bits aléatoires. */
const newPublicToken = () => randomBytes(16).toString('base64url');

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

interface OrderingPoint {
  organizationId: string;
  establishmentId: string;
  establishmentName: string;
  tableId: string | null;
  zoneId: string | null;
  label: string;
}

/**
 * Commandes des clients par QR code.
 *
 * Parcours : le client consulte le menu public et envoie une DEMANDE, sans compte. La demande n'est ni
 * payée ni envoyée en cuisine. Un employé (permission pos.sell, session de caisse ouverte) la valide :
 * elle devient une commande non payée et non envoyée, sur le canal QR ; il l'enverra en cuisine
 * explicitement, comme toute commande. Il peut aussi la refuser avec un motif.
 *
 * Protection anti-abus : jetons de 128 bits, limitation par IP (throttler « public »), plafond de
 * demandes en attente par table ou zone, taille des demandes bornée, prix toujours recalculés.
 */
@Injectable()
export class QrOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    private readonly pricing: SalePricingService,
    private readonly events: RestaurantEventsService,
  ) {}

  // ─── Côté client (public) ───

  async menu(qrToken: string) {
    const point = await this.findPoint(qrToken);
    const categories = await loadSellableCatalog(
      this.prisma,
      point.organizationId,
      point.establishmentId,
    );
    return {
      establishmentName: point.establishmentName,
      location: point.label,
      categories,
    };
  }

  async submit(qrToken: string, dto: PublicOrderDto) {
    return this.createRequest(await this.findPoint(qrToken), dto, null);
  }

  /**
   * Commande d'une borne libre-service : même parcours qu'une demande QR (validation puis
   * encaissement à la caisse, jamais de paiement ni de préparation automatique). Une session de borne
   * = une commande au plus ; le client reçoit un numéro à présenter à la caisse.
   */
  async submitFromKiosk(kiosk: KioskOrigin, dto: PublicOrderDto) {
    return this.createRequest(
      {
        organizationId: kiosk.organizationId,
        establishmentId: kiosk.establishmentId,
        establishmentName: kiosk.establishmentName,
        tableId: null,
        zoneId: null,
        label: `Borne · ${kiosk.deviceName}`,
      },
      dto,
      kiosk,
    );
  }

  private async createRequest(
    point: OrderingPoint,
    dto: PublicOrderDto,
    kiosk: KioskOrigin | null,
  ) {
    const replay = await this.findReplay(point, dto.clientRequestId);
    if (replay) return replay;

    // Montants indicatifs calculés par le serveur ; la vente sera revalorisée à la validation.
    const priced = await this.pricing.price(
      this.prisma,
      point.organizationId,
      point.establishmentId,
      dto.lines,
    );
    const lines: RequestLine[] = priced.lines.map((l) => ({
      variantId: l.variantId!,
      quantity: l.quantity,
      notes: l.notes ?? null,
      productName: l.productName,
      variantName: l.variantName,
      unitPrice: l.unitPrice,
    }));

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (kiosk) return this.insertKioskRequest(tx, point, dto, kiosk, lines, priced.total);
        // Le verrou du point de commande rend le plafond de demandes en attente strict.
        if (point.tableId) await lockRow(tx, 'DiningTable', point.tableId);
        else await lockRow(tx, 'DiningZone', point.zoneId!);
        const pending = await tx.qrOrderRequest.count({
          where: {
            establishmentId: point.establishmentId,
            ...(point.tableId
              ? { tableId: point.tableId }
              : { zoneId: point.zoneId, tableId: null }),
            status: 'PENDING_VALIDATION',
            createdAt: { gte: new Date(Date.now() - QR_REQUEST_PENDING_WINDOW_MINUTES * 60_000) },
          },
        });
        if (pending >= MAX_PENDING_QR_REQUESTS_PER_POINT) {
          throw new HttpException(
            {
              code: 'TOO_MANY_PENDING_REQUESTS',
              message:
                'Plusieurs demandes attendent déjà d’être validées pour cette table. Patientez ou appelez le personnel.',
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        return tx.qrOrderRequest.create({
          data: {
            organizationId: point.organizationId,
            establishmentId: point.establishmentId,
            tableId: point.tableId,
            zoneId: point.zoneId,
            publicToken: newPublicToken(),
            customerName: dto.customerName ?? null,
            notes: dto.notes ?? null,
            lines: lines as unknown as Prisma.InputJsonValue,
            estimatedTotal: priced.total,
            clientRequestId: dto.clientRequestId,
          },
          select: REQUEST_RESULT,
        });
      });
      this.events.publish({
        organizationId: point.organizationId,
        establishmentId: point.establishmentId,
        topics: ['orders'],
        type: 'qr.requested',
        requestId: created.id,
      });
      return toRequestResult(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findReplay(point, dto.clientRequestId);
        if (again) return again;
        // Seconde commande dans la même session de borne (clé d'unicité de la session).
        if (kiosk) throw this.kioskSessionClosed();
      }
      throw error;
    }
  }

  /** Borne : session valide, plafond anti-abus, numéro affiché, session close dans la même transaction. */
  private async insertKioskRequest(
    tx: Prisma.TransactionClient,
    point: OrderingPoint,
    dto: PublicOrderDto,
    kiosk: KioskOrigin,
    lines: RequestLine[],
    estimatedTotal: number,
  ) {
    await lockRow(tx, 'KioskDevice', kiosk.deviceId);
    const session = await tx.kioskSession.findFirst({
      where: {
        id: kiosk.sessionId,
        deviceId: kiosk.deviceId,
        endedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session) throw this.kioskSessionClosed();
    const recent = await tx.qrOrderRequest.count({
      where: {
        kioskDeviceId: kiosk.deviceId,
        createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
      },
    });
    if (recent >= KIOSK_MAX_ORDERS_PER_10_MIN) {
      throw new HttpException(
        {
          code: 'KIOSK_RATE_LIMITED',
          message: 'Trop de commandes sur cette borne en peu de temps. Adressez-vous au personnel.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { orderRequestSeq } = await tx.establishment.update({
      where: { id: point.establishmentId },
      data: { orderRequestSeq: { increment: 1 } },
      select: { orderRequestSeq: true },
    });
    await tx.kioskSession.update({ where: { id: session.id }, data: { endedAt: new Date() } });
    return tx.qrOrderRequest.create({
      data: {
        organizationId: point.organizationId,
        establishmentId: point.establishmentId,
        publicToken: newPublicToken(),
        source: 'KIOSK',
        kioskDeviceId: kiosk.deviceId,
        kioskSessionId: session.id,
        displayNumber: orderRequestSeq,
        customerName: dto.customerName ?? null,
        notes: dto.notes ?? null,
        lines: lines as unknown as Prisma.InputJsonValue,
        estimatedTotal,
        clientRequestId: dto.clientRequestId,
      },
      select: REQUEST_RESULT,
    });
  }

  private kioskSessionClosed() {
    return new ConflictException({
      code: 'KIOSK_SESSION_CLOSED',
      message: 'Cette commande est terminée. Touchez l’écran pour en commencer une nouvelle.',
    });
  }

  /** Suivi par le client : statut de la demande puis de la commande (préparation, paiement). */
  async status(publicToken: string) {
    if (!DINING_QR_TOKEN_PATTERN.test(publicToken)) throw new NotFoundException(REQUEST_NOT_FOUND);
    const request = await this.prisma.qrOrderRequest.findUnique({
      where: { publicToken },
      select: {
        status: true,
        rejectedReason: true,
        estimatedTotal: true,
        lines: true,
        createdAt: true,
        establishment: { select: { name: true } },
        table: { select: { name: true } },
        zone: { select: { name: true } },
        sale: {
          select: {
            number: true,
            status: true,
            total: true,
            paymentStatus: true,
            preparationStatus: true,
          },
        },
      },
    });
    if (!request) throw new NotFoundException(REQUEST_NOT_FOUND);
    const lines = (request.lines as unknown as RequestLine[]).map((l) => ({
      productName: l.productName,
      variantName: l.variantName,
      quantity: l.quantity,
      notes: l.notes,
    }));
    return {
      status: request.status,
      rejectedReason: request.rejectedReason,
      estimatedTotal: request.estimatedTotal,
      createdAt: request.createdAt,
      establishmentName: request.establishment.name,
      location: locationLabel(request.zone?.name ?? null, request.table?.name ?? null),
      lines,
      order: request.sale
        ? {
            number: request.sale.number,
            cancelled: request.sale.status === 'CANCELLED',
            total: request.sale.total,
            paymentStatus: request.sale.paymentStatus,
            preparationStatus: request.sale.preparationStatus,
          }
        : null,
    };
  }

  // ─── Côté personnel ───

  async list(auth: TenantContext, establishmentId: string, status: QrOrderStatus | undefined) {
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      establishmentId,
      'RESTAURANT',
    );
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.qrOrderRequest.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: establishment.id,
        status: status ?? 'PENDING_VALIDATION',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        status: true,
        customerName: true,
        notes: true,
        lines: true,
        estimatedTotal: true,
        rejectedReason: true,
        createdAt: true,
        saleId: true,
        source: true,
        displayNumber: true,
        kioskDevice: { select: { name: true } },
        table: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });
    return rows.map(({ lines, kioskDevice, ...r }) => ({
      ...r,
      lines: lines as unknown as RequestLine[],
      location: kioskDevice
        ? `Borne · ${kioskDevice.name}`
        : locationLabel(r.zone?.name ?? null, r.table?.name ?? null),
    }));
  }

  /**
   * Validation : la demande devient une commande QR non payée, non envoyée en cuisine, dans la session
   * de caisse de l'employé. Les prix sont recalculés au moment de la validation. Un double clic du même
   * employé renvoie la même commande (clé d'idempotence = identifiant de la demande).
   */
  async accept(auth: TenantContext, id: string) {
    const request = await this.findForStaff(auth, id);
    if (request.status !== 'PENDING_VALIDATION') {
      if (request.status === 'ACCEPTED' && request.saleId) {
        // Rejeu par l'employé qui l'a validée : même commande ; sinon refus explicite.
        if (request.decidedById === auth.membership.id) return this.sales.get(auth, request.saleId);
      }
      throw new ConflictException(ALREADY_DECIDED);
    }
    const lines = request.lines as unknown as RequestLine[];
    const notes =
      [request.customerName && `Client : ${request.customerName}`, request.notes]
        .filter(Boolean)
        .join(' — ') || null;
    const sale = await this.sales.createSale(auth, {
      establishmentId: request.establishmentId,
      activity: 'RESTAURANT',
      clientRequestId: request.id,
      order: {
        channel: request.source === 'KIOSK' ? 'KIOSK' : 'QR',
        tableId: request.tableId,
        zoneId: request.zoneId,
        notes,
      },
      price: (tx, organizationId) =>
        this.pricing.price(
          tx,
          organizationId,
          request.establishmentId,
          lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            notes: l.notes ?? undefined,
          })),
        ),
      afterCreate: async (tx, saleId) => {
        await lockRow(tx, 'QrOrderRequest', id);
        const decided = await tx.qrOrderRequest.updateMany({
          where: { id, status: 'PENDING_VALIDATION' },
          data: {
            status: 'ACCEPTED',
            saleId,
            decidedById: auth.membership.id,
            decidedAt: new Date(),
          },
        });
        if (decided.count === 0) throw new ConflictException(ALREADY_DECIDED);
        await recordOrderEvent(tx, {
          organizationId: auth.membership.organizationId,
          establishmentId: request.establishmentId,
          saleId,
          type: 'qr_accepted',
          actorMembershipId: auth.membership.id,
          metadata: { requestId: id, estimatedTotal: request.estimatedTotal },
        });
        await this.audit.record(
          {
            organizationId: auth.membership.organizationId,
            actorUserId: auth.user.id,
            action: 'qr_order.accepted',
            targetType: 'QrOrderRequest',
            targetId: id,
            metadata: { saleId },
          },
          tx,
        );
      },
    });
    this.events.publish({
      organizationId: auth.membership.organizationId,
      establishmentId: request.establishmentId,
      topics: ['orders'],
      type: 'qr.decided',
      requestId: id,
      saleId: sale.id,
    });
    return sale;
  }

  async reject(auth: TenantContext, id: string, reason: string) {
    const request = await this.findForStaff(auth, id);
    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.qrOrderRequest.updateMany({
        where: { id, status: 'PENDING_VALIDATION' },
        data: {
          status: 'REJECTED',
          rejectedReason: reason,
          decidedById: auth.membership.id,
          decidedAt: new Date(),
        },
      });
      if (decided.count === 0) throw new ConflictException(ALREADY_DECIDED);
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action: 'qr_order.rejected',
          targetType: 'QrOrderRequest',
          targetId: id,
          metadata: { reason },
        },
        tx,
      );
    });
    this.events.publish({
      organizationId: auth.membership.organizationId,
      establishmentId: request.establishmentId,
      topics: ['orders'],
      type: 'qr.decided',
      requestId: id,
    });
    return { id, status: 'REJECTED' as const };
  }

  // ─── Interne ───

  /**
   * Point de commande désigné par le jeton du QR code : table ou zone active, dans un établissement
   * restaurant actif d'une organisation active dont le métier couvre le restaurant. Toute autre
   * situation renvoie la même réponse « introuvable », sans détail.
   */
  private async findPoint(qrToken: string): Promise<OrderingPoint> {
    if (!DINING_QR_TOKEN_PATTERN.test(qrToken)) throw new NotFoundException(MENU_NOT_FOUND);
    const establishmentSelect = {
      select: {
        id: true,
        name: true,
        isActive: true,
        businessType: true,
        organization: { select: { id: true, status: true, businessType: true } },
      },
    } as const;
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken },
      select: {
        id: true,
        name: true,
        isActive: true,
        zone: { select: { id: true, name: true, isActive: true } },
        establishment: establishmentSelect,
      },
    });
    const zone = table
      ? null
      : await this.prisma.diningZone.findUnique({
          where: { qrToken },
          select: { id: true, name: true, isActive: true, establishment: establishmentSelect },
        });
    const establishment = table?.establishment ?? zone?.establishment;
    const usable =
      establishment &&
      establishment.isActive &&
      coversActivity(establishment.businessType, 'RESTAURANT') &&
      establishment.organization.status === 'ACTIVE' &&
      coversActivity(establishment.organization.businessType, 'RESTAURANT') &&
      (table ? table.isActive && (table.zone?.isActive ?? true) : zone!.isActive);
    if (!usable || !establishment) throw new NotFoundException(MENU_NOT_FOUND);
    return {
      organizationId: establishment.organization.id,
      establishmentId: establishment.id,
      establishmentName: establishment.name,
      tableId: table?.id ?? null,
      zoneId: table ? (table.zone?.id ?? null) : zone!.id,
      label: table
        ? locationLabel(table.zone?.name ?? null, table.name)
        : locationLabel(zone!.name, null),
    };
  }

  private async findReplay(point: OrderingPoint, clientRequestId: string) {
    const existing = await this.prisma.qrOrderRequest.findUnique({
      where: {
        establishmentId_clientRequestId: {
          establishmentId: point.establishmentId,
          clientRequestId,
        },
      },
      select: { ...REQUEST_RESULT, tableId: true, zoneId: true },
    });
    if (!existing) return null;
    if (existing.tableId !== point.tableId || existing.zoneId !== point.zoneId) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Clé de requête déjà utilisée.',
      });
    }
    return toRequestResult(existing);
  }

  private async findForStaff(auth: TenantContext, id: string) {
    const request = await this.prisma.qrOrderRequest.findFirst({
      where: { id, establishment: establishmentScope(auth) },
      select: {
        id: true,
        status: true,
        saleId: true,
        decidedById: true,
        establishmentId: true,
        tableId: true,
        zoneId: true,
        customerName: true,
        notes: true,
        lines: true,
        estimatedTotal: true,
        source: true,
      },
    });
    if (!request) throw new NotFoundException(REQUEST_NOT_FOUND);
    return request;
  }
}

/** « Terrasse · Table 4 », « Table 4 », « Bord de piscine ». */
export function locationLabel(zoneName: string | null, tableName: string | null): string {
  return [zoneName, tableName].filter(Boolean).join(' · ');
}
