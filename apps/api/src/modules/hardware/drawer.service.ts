import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { hasOrganizationWideScope, hasPermission } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { visibleSalesWhere } from '../pos/pos-scope';
import type { CreateDrawerEventDto, DrawerEventsQueryDto, HardwareResultDto } from './hardware.dto';
import { type TerminalRow, TerminalsService, printerTarget } from './terminals.service';

/** Fenêtre pendant laquelle un paiement en espèces peut encore déclencher l'ouverture automatique. */
export const AUTO_OPEN_WINDOW_MS = 10 * 60 * 1000;
/** Délai minimal entre deux ouvertures manuelles sur un même poste (protection contre les répétitions). */
export const MANUAL_COOLDOWN_MS = 10 * 1000;

const EVENT_SELECT = {
  id: true,
  reason: true,
  status: true,
  paymentId: true,
  justification: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
  terminalId: true,
  terminal: { select: { name: true } },
  requestedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
} as const;

type EventRow = Prisma.DrawerEventGetPayload<{ select: typeof EVENT_SELECT }>;

const toEvent = ({ requestedBy, terminal, ...event }: EventRow) => ({
  ...event,
  terminalName: terminal.name,
  requestedByName: `${requestedBy.user.firstName} ${requestedBy.user.lastName}`,
});

const NOT_FOUND = { code: 'DRAWER_EVENT_NOT_FOUND', message: 'Ouverture de tiroir introuvable.' };

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Ouvertures du tiroir-caisse. Règles :
 * - automatique UNIQUEMENT après un paiement en espèces confirmé, par l'employé qui l'a encaissé,
 *   et une seule fois par paiement (contrainte d'unicité en base) ;
 * - jamais pour un paiement Wave ;
 * - manuelle réservée aux rôles autorisés, avec justification et délai minimal entre deux ouvertures ;
 * - chaque ouverture est auditée.
 */
@Injectable()
export class DrawerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly terminals: TerminalsService,
  ) {}

  async create(auth: TenantContext, dto: CreateDrawerEventDto) {
    const replay = await this.findReplay(auth, dto.clientRequestId);
    if (replay) return replay;

    const terminal = await this.terminals.find(this.prisma, auth, dto.terminalId);
    if (!terminal.isActive || !terminal.drawerEnabled || terminal.printerConnection === 'NONE') {
      throw new ConflictException({
        code: 'DRAWER_NOT_CONFIGURED',
        message: 'Aucun tiroir-caisse n’est configuré pour ce poste.',
      });
    }

    try {
      const eventId = await this.prisma.$transaction(async (tx) => {
        if (dto.reason === 'CASH_PAYMENT')
          await this.assertAutomaticOpening(tx, auth, terminal, dto.paymentId);
        else await this.assertManualOpening(tx, auth, terminal, dto.justification);
        const event = await tx.drawerEvent.create({
          data: {
            organizationId: auth.membership.organizationId,
            establishmentId: terminal.establishment.id,
            terminalId: terminal.id,
            reason: dto.reason,
            paymentId: dto.reason === 'CASH_PAYMENT' ? dto.paymentId : null,
            justification: dto.reason === 'MANUAL' ? dto.justification : null,
            requestedById: auth.membership.id,
            clientRequestId: dto.clientRequestId,
          },
        });
        await this.audit.record(
          {
            organizationId: auth.membership.organizationId,
            actorUserId: auth.user.id,
            action:
              dto.reason === 'MANUAL'
                ? 'drawer.manual_open_requested'
                : 'drawer.cash_open_requested',
            targetType: 'DrawerEvent',
            targetId: event.id,
            metadata: {
              terminalId: terminal.id,
              paymentId: dto.paymentId ?? null,
              justification: dto.justification ?? null,
            },
          },
          tx,
        );
        return event.id;
      });
      return this.withCommand(auth, eventId, terminal);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findReplay(auth, dto.clientRequestId);
        if (again) return again;
        // Le paiement a déjà déclenché une ouverture (autre requête) : on ne rouvre pas.
        if (dto.reason === 'CASH_PAYMENT' && dto.paymentId)
          return this.alreadyOpenedFor(auth, dto.paymentId, terminal);
      }
      throw error;
    }
  }

  async reportResult(auth: TenantContext, id: string, dto: HardwareResultDto) {
    const event = await this.prisma.drawerEvent.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        requestedById: auth.membership.id,
      },
      select: { status: true, reason: true },
    });
    if (!event) throw new NotFoundException(NOT_FOUND);
    if (event.status !== 'PENDING') {
      if (event.status === dto.status) return this.get(auth, id);
      throw new ConflictException({
        code: 'DRAWER_EVENT_COMPLETED',
        message: 'Le résultat de cette ouverture est déjà enregistré.',
      });
    }
    if (dto.status === 'FAILED' && !dto.errorCode) {
      throw new BadRequestException({
        code: 'ERROR_CODE_REQUIRED',
        message: 'Code d’erreur obligatoire pour un échec.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.drawerEvent.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: dto.status,
          errorCode: dto.status === 'FAILED' ? dto.errorCode : null,
          errorMessage: dto.status === 'FAILED' ? (dto.errorMessage ?? null) : null,
          completedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action: dto.status === 'SUCCEEDED' ? 'drawer.opened' : 'drawer.open_failed',
          targetType: 'DrawerEvent',
          targetId: id,
          metadata: { reason: event.reason, errorCode: dto.errorCode ?? null },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  async list(auth: TenantContext, query: DrawerEventsQueryDto) {
    const events = await this.prisma.drawerEvent.findMany({
      where: { ...this.visibleWhere(auth), terminalId: query.terminalId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: EVENT_SELECT,
    });
    return events.map(toEvent);
  }

  private async get(auth: TenantContext, id: string) {
    const event = await this.prisma.drawerEvent.findFirst({
      where: { ...this.visibleWhere(auth), id },
      select: EVENT_SELECT,
    });
    if (!event) throw new NotFoundException(NOT_FOUND);
    return toEvent(event);
  }

  private visibleWhere(auth: TenantContext): Prisma.DrawerEventWhereInput {
    const where: Prisma.DrawerEventWhereInput = { organizationId: auth.membership.organizationId };
    if (!hasPermission(auth.membership.role, 'cash.supervise'))
      where.requestedById = auth.membership.id;
    if (!hasOrganizationWideScope(auth.membership.role)) {
      where.establishment = { assignments: { some: { membershipId: auth.membership.id } } };
    }
    return where;
  }

  private async assertAutomaticOpening(
    tx: Prisma.TransactionClient,
    auth: TenantContext,
    terminal: TerminalRow,
    paymentId: string | undefined,
  ) {
    if (!paymentId)
      throw new BadRequestException({
        code: 'PAYMENT_REQUIRED',
        message: 'Indiquez le paiement en espèces.',
      });
    const payment = await tx.payment.findFirst({
      where: {
        id: paymentId,
        organizationId: auth.membership.organizationId,
        sale: visibleSalesWhere(auth),
      },
      select: {
        method: true,
        status: true,
        receivedById: true,
        createdAt: true,
        sale: { select: { establishmentId: true } },
      },
    });
    if (!payment)
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Paiement introuvable.' });
    if (payment.method !== 'CASH') {
      throw new ConflictException({
        code: 'DRAWER_NOT_ALLOWED_FOR_METHOD',
        message: 'Le tiroir ne s’ouvre automatiquement que pour un paiement en espèces.',
      });
    }
    if (payment.status !== 'SUCCEEDED') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_CONFIRMED',
        message: 'Le paiement n’est pas confirmé.',
      });
    }
    if (payment.receivedById !== auth.membership.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Seul l’employé qui a encaissé peut ouvrir le tiroir pour ce paiement.',
      });
    }
    if (payment.sale.establishmentId !== terminal.establishment.id) {
      throw new BadRequestException({
        code: 'TERMINAL_ESTABLISHMENT_MISMATCH',
        message: 'Ce poste n’appartient pas à l’établissement de la vente.',
      });
    }
    if (Date.now() - payment.createdAt.getTime() > AUTO_OPEN_WINDOW_MS) {
      throw new ConflictException({
        code: 'PAYMENT_TOO_OLD',
        message:
          'Paiement trop ancien pour une ouverture automatique : utilisez l’ouverture manuelle justifiée.',
      });
    }
  }

  private async assertManualOpening(
    tx: Prisma.TransactionClient,
    auth: TenantContext,
    terminal: TerminalRow,
    justification: string | undefined,
  ) {
    if (!hasPermission(auth.membership.role, 'drawer.open_manual')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'L’ouverture manuelle du tiroir est réservée aux responsables.',
      });
    }
    if (!justification)
      throw new BadRequestException({
        code: 'JUSTIFICATION_REQUIRED',
        message: 'Justifiez l’ouverture manuelle du tiroir.',
      });
    // Verrou par poste : deux demandes simultanées ne passent pas toutes les deux le délai minimal.
    await tx.$queryRaw`SELECT id FROM "PosTerminal" WHERE id = ${terminal.id}::uuid FOR UPDATE`;
    const recent = await tx.drawerEvent.count({
      where: {
        terminalId: terminal.id,
        reason: 'MANUAL',
        createdAt: { gte: new Date(Date.now() - MANUAL_COOLDOWN_MS) },
      },
    });
    if (recent > 0) {
      throw new HttpException(
        {
          code: 'DRAWER_COOLDOWN',
          message: 'Le tiroir vient d’être ouvert : patientez quelques secondes.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async findReplay(auth: TenantContext, clientRequestId: string) {
    const existing = await this.prisma.drawerEvent.findFirst({
      where: { organizationId: auth.membership.organizationId, clientRequestId },
      select: { id: true, requestedById: true, terminalId: true },
    });
    if (!existing) return null;
    if (existing.requestedById !== auth.membership.id) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Clé de requête déjà utilisée.',
      });
    }
    const terminal = await this.terminals.find(this.prisma, auth, existing.terminalId);
    return this.withCommand(auth, existing.id, terminal);
  }

  /** Le paiement a déjà ouvert le tiroir : on renvoie l'ouverture existante, sans nouvelle commande. */
  private async alreadyOpenedFor(auth: TenantContext, paymentId: string, terminal: TerminalRow) {
    const existing = await this.prisma.drawerEvent.findUniqueOrThrow({
      where: { paymentId },
      select: { id: true },
    });
    const event = await this.prisma.drawerEvent.findFirstOrThrow({
      where: { id: existing.id },
      select: EVENT_SELECT,
    });
    return {
      event: toEvent(event),
      printer: printerTarget(terminal),
      command: null,
      alreadyIssued: true,
    };
  }

  /**
   * Commande renvoyée seulement tant que l'ouverture est en attente et demandée par ce membre :
   * une requête rejouée ou concurrente n'ouvre jamais le tiroir une seconde fois.
   */
  private async withCommand(auth: TenantContext, eventId: string, terminal: TerminalRow) {
    const event = await this.get(auth, eventId);
    const pending = event.status === 'PENDING';
    return {
      event,
      printer: printerTarget(terminal),
      command: pending ? { pin: (terminal.drawerPin === 5 ? 5 : 2) as 2 | 5 } : null,
      alreadyIssued: !pending,
    };
  }
}
