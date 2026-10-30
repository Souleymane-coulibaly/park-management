import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  BLOCKING_RESERVATION_STATUSES,
  DEFAULT_RESERVATION_MINUTES,
  type ReservationStatus,
  addDays,
  localMoment,
  zonedMidnight,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { findSellingEstablishment, lockRow } from '../pos/pos-scope';
import { DiningService } from '../restaurant/dining.service';
import type {
  CreateReservationDto,
  ReservationsQueryDto,
  UpdateReservationDto,
} from './reservations.dto';

const NOT_FOUND = { code: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' };

const SELECT = {
  id: true,
  customerName: true,
  customerPhone: true,
  partySize: true,
  startsAt: true,
  endsAt: true,
  status: true,
  notes: true,
  createdAt: true,
  table: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
} as const satisfies Prisma.ReservationSelect;

const isBlocking = (status: ReservationStatus) =>
  (BLOCKING_RESERVATION_STATUSES as readonly string[]).includes(status);

/**
 * Réservations du restaurant. Deux réservations actives (en attente ou confirmées) ne peuvent pas
 * occuper la même table sur des créneaux qui se chevauchent : le contrôle se fait sous verrou de la
 * table, dans la transaction d'écriture, ce qui le rend sûr face à deux saisies simultanées.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dining: DiningService,
  ) {}

  async list(auth: TenantContext, query: ReservationsQueryDto) {
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      query.establishmentId,
      'RESTAURANT',
    );
    const today = localMoment(new Date(), establishment.timezone).date;
    const from = query.from ? new Date(query.from) : zonedMidnight(today, establishment.timezone);
    const to = query.to
      ? new Date(query.to)
      : zonedMidnight(addDays(today, 7), establishment.timezone);
    return this.prisma.reservation.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: establishment.id,
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
      select: SELECT,
    });
  }

  async create(auth: TenantContext, dto: CreateReservationDto) {
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId, 'RESTAURANT');
    const location = await this.dining.resolveLocation(
      auth,
      dto.establishmentId,
      dto.tableId,
      dto.zoneId,
    );
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(
      startsAt.getTime() + (dto.durationMinutes ?? DEFAULT_RESERVATION_MINUTES) * 60_000,
    );
    const status = dto.status ?? 'PENDING';
    const id = await this.prisma.$transaction(async (tx) => {
      if (location.tableId && isBlocking(status)) {
        await this.assertNoConflict(tx, location.tableId, startsAt, endsAt, null);
      }
      const created = await tx.reservation.create({
        data: {
          organizationId: auth.membership.organizationId,
          establishmentId: dto.establishmentId,
          tableId: location.tableId,
          zoneId: location.zoneId,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone ?? null,
          partySize: dto.partySize,
          startsAt,
          endsAt,
          status,
          notes: dto.notes ?? null,
          createdById: auth.membership.id,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action: 'reservation.created',
          targetType: 'Reservation',
          targetId: created.id,
          metadata: {
            startsAt: startsAt.toISOString(),
            partySize: dto.partySize,
            tableId: location.tableId,
            status,
          },
        },
        tx,
      );
      return created.id;
    });
    return this.get(auth, id);
  }

  async update(auth: TenantContext, id: string, dto: UpdateReservationDto) {
    const current = await this.prisma.reservation.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: {
        establishmentId: true,
        tableId: true,
        zoneId: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    });
    if (!current) throw new NotFoundException(NOT_FOUND);
    await findSellingEstablishment(this.prisma, auth, current.establishmentId, 'RESTAURANT');

    const location =
      dto.tableId !== undefined || dto.zoneId !== undefined
        ? await this.dining.resolveLocation(
            auth,
            current.establishmentId,
            dto.tableId === undefined ? current.tableId : dto.tableId,
            dto.zoneId === undefined && dto.tableId === undefined ? current.zoneId : dto.zoneId,
          )
        : { tableId: current.tableId, zoneId: current.zoneId };
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const duration =
      dto.durationMinutes ?? (current.endsAt.getTime() - current.startsAt.getTime()) / 60_000;
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (endsAt <= startsAt) {
      throw new BadRequestException({ code: 'INVALID_SLOT', message: 'Créneau invalide.' });
    }
    const status = dto.status ?? current.status;

    await this.prisma.$transaction(async (tx) => {
      if (location.tableId && isBlocking(status)) {
        await this.assertNoConflict(tx, location.tableId, startsAt, endsAt, id);
      }
      await tx.reservation.update({
        where: { id },
        data: {
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          partySize: dto.partySize,
          notes: dto.notes,
          tableId: location.tableId,
          zoneId: location.zoneId,
          startsAt,
          endsAt,
          status,
        },
      });
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action:
            dto.status && dto.status !== current.status
              ? 'reservation.status_changed'
              : 'reservation.updated',
          targetType: 'Reservation',
          targetId: id,
          metadata: { from: current.status, to: status, startsAt: startsAt.toISOString() },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  private async get(auth: TenantContext, id: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: SELECT,
    });
    if (!reservation) throw new NotFoundException(NOT_FOUND);
    return reservation;
  }

  /** Verrouille la table puis cherche une réservation active qui chevauche [début, fin[. */
  private async assertNoConflict(
    tx: Prisma.TransactionClient,
    tableId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId: string | null,
  ) {
    await lockRow(tx, 'DiningTable', tableId);
    const conflict = await tx.reservation.findFirst({
      where: {
        tableId,
        status: { in: [...BLOCKING_RESERVATION_STATUSES] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, startsAt: true, endsAt: true, customerName: true },
    });
    if (conflict) {
      throw new ConflictException({
        code: 'RESERVATION_CONFLICT',
        message: 'Cette table est déjà réservée sur un créneau qui chevauche celui-ci.',
        details: { startsAt: conflict.startsAt, endsAt: conflict.endsAt },
      });
    }
  }
}
