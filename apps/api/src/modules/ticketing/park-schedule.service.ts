import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  addDays,
  type CalendarException,
  coversActivity,
  evaluateOpening,
  isOpenDay,
  localMoment,
  type LocalMoment,
  parseTime,
  type WeeklyOpening,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import type { CreateCalendarExceptionDto, PutWeeklyScheduleDto } from './ticketing.dto';

type Db = Pick<Prisma.TransactionClient, 'parkOpeningSchedule' | 'parkCalendarException'>;

/** Date locale AAAA-MM-JJ ↔ colonne PostgreSQL `date` (stockée à minuit UTC par Prisma). */
export const toDbDate = (date: string) => new Date(`${date}T00:00:00Z`);
export const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

export interface OpeningContext {
  timezone: string;
  moment: LocalMoment;
  weekly: WeeklyOpening[];
  exceptions: CalendarException[];
}

const PARK_CLOSED = {
  code: 'PARK_CLOSED',
  message: 'Le parc est fermé aujourd’hui : la vente de billets est suspendue.',
};

/**
 * Horaires du parc : semaine type et dates particulières. Ils ne concernent QUE la billetterie et le
 * contrôle d'accès : dans un établissement parc + restaurant, fermer le parc ne ferme jamais le restaurant.
 */
@Injectable()
export class ParkScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Horaires applicables autour de l'instant (veille, jour, lendemain) dans le fuseau de l'établissement. */
  async openingContext(
    db: Db,
    establishmentId: string,
    timezone: string,
    at = new Date(),
  ): Promise<OpeningContext> {
    const moment = localMoment(at, timezone);
    const [weekly, exceptions] = await Promise.all([
      db.parkOpeningSchedule.findMany({
        where: { establishmentId },
        select: { weekday: true, isClosed: true, opensAt: true, closesAt: true },
      }),
      db.parkCalendarException.findMany({
        where: {
          establishmentId,
          date: { gte: toDbDate(addDays(moment.date, -1)), lte: toDbDate(addDays(moment.date, 1)) },
        },
        select: { date: true, isClosed: true, opensAt: true, closesAt: true, label: true },
      }),
    ]);
    return {
      timezone,
      moment,
      weekly,
      exceptions: exceptions.map((e) => ({ ...e, date: fromDbDate(e.date) })),
    };
  }

  /** Vente du jour : refusée si le parc n'ouvre pas aujourd'hui (fermeture hebdomadaire ou exceptionnelle). */
  async assertOpenToday(db: Db, establishmentId: string, timezone: string): Promise<void> {
    const ctx = await this.openingContext(db, establishmentId, timezone);
    if (!isOpenDay(ctx.weekly, ctx.exceptions, ctx.moment))
      throw new ConflictException(PARK_CLOSED);
  }

  /** Établissement parc du périmètre du membre (actif ou non : la configuration reste consultable). */
  async findParkEstablishment(auth: TenantContext, establishmentId: string) {
    const establishment = await this.prisma.establishment.findFirst({
      where: { ...establishmentScope(auth), id: establishmentId },
      select: { id: true, name: true, businessType: true, timezone: true },
    });
    if (!establishment) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }
    if (!coversActivity(establishment.businessType, 'PARK')) {
      throw new BadRequestException({
        code: 'ESTABLISHMENT_NOT_PARK',
        message:
          "La billetterie n'est disponible que dans un établissement avec une activité parc.",
      });
    }
    return establishment;
  }

  async get(auth: TenantContext, establishmentId: string) {
    const establishment = await this.findParkEstablishment(auth, establishmentId);
    const ctx = await this.openingContext(this.prisma, establishment.id, establishment.timezone);
    const [weekly, exceptions] = await Promise.all([
      this.prisma.parkOpeningSchedule.findMany({
        where: { establishmentId },
        orderBy: { weekday: 'asc' },
        select: { weekday: true, isClosed: true, opensAt: true, closesAt: true },
      }),
      this.prisma.parkCalendarException.findMany({
        where: { establishmentId, date: { gte: toDbDate(addDays(ctx.moment.date, -7)) } },
        orderBy: { date: 'asc' },
        take: 200,
        select: {
          id: true,
          date: true,
          isClosed: true,
          opensAt: true,
          closesAt: true,
          label: true,
        },
      }),
    ]);
    return {
      timezone: establishment.timezone,
      today: ctx.moment.date,
      status: evaluateOpening(ctx.weekly, ctx.exceptions, ctx.moment),
      openToday: isOpenDay(ctx.weekly, ctx.exceptions, ctx.moment),
      weekly,
      exceptions: exceptions.map((e) => ({ ...e, date: fromDbDate(e.date) })),
    };
  }

  /** Remplace la semaine type (liste vide = aucune restriction horaire). */
  async putWeekly(auth: TenantContext, dto: PutWeeklyScheduleDto) {
    const establishment = await this.findParkEstablishment(auth, dto.establishmentId);
    const weekdays = dto.days.map((d) => d.weekday);
    if (new Set(weekdays).size !== weekdays.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_WEEKDAY',
        message: 'Un même jour apparaît deux fois.',
      });
    }
    dto.days.forEach((d) => assertHours(d.isClosed, d.opensAt, d.closesAt));
    const organizationId = auth.membership.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await tx.parkOpeningSchedule.deleteMany({ where: { establishmentId: establishment.id } });
      await tx.parkOpeningSchedule.createMany({
        data: dto.days.map((d) => ({
          organizationId,
          establishmentId: establishment.id,
          weekday: d.weekday,
          isClosed: d.isClosed,
          opensAt: d.isClosed ? null : (d.opensAt ?? null),
          closesAt: d.isClosed ? null : (d.closesAt ?? null),
        })),
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'park.schedule.updated',
          targetType: 'Establishment',
          targetId: establishment.id,
          metadata: { days: dto.days.length },
        },
        tx,
      );
    });
    return this.get(auth, establishment.id);
  }

  /** Crée ou remplace la date particulière (fermeture, horaires spéciaux, nocturne…). */
  async upsertException(auth: TenantContext, dto: CreateCalendarExceptionDto) {
    const establishment = await this.findParkEstablishment(auth, dto.establishmentId);
    assertHours(dto.isClosed, dto.opensAt, dto.closesAt);
    const organizationId = auth.membership.organizationId;
    const values = {
      isClosed: dto.isClosed,
      opensAt: dto.isClosed ? null : (dto.opensAt ?? null),
      closesAt: dto.isClosed ? null : (dto.closesAt ?? null),
      label: dto.label || null,
    };
    const date = toDbDate(dto.date.slice(0, 10));
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.parkCalendarException.upsert({
        where: { establishmentId_date: { establishmentId: establishment.id, date } },
        create: { organizationId, establishmentId: establishment.id, date, ...values },
        update: values,
        select: { id: true },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'park.exception.saved',
          targetType: 'ParkCalendarException',
          targetId: row.id,
          metadata: { date: dto.date.slice(0, 10), isClosed: dto.isClosed },
        },
        tx,
      );
    });
    return this.get(auth, establishment.id);
  }

  async removeException(auth: TenantContext, id: string) {
    const exception = await this.prisma.parkCalendarException.findFirst({
      where: { id, establishment: establishmentScope(auth) },
      select: { id: true, establishmentId: true, date: true },
    });
    if (!exception) {
      throw new NotFoundException({
        code: 'EXCEPTION_NOT_FOUND',
        message: 'Date particulière introuvable.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.parkCalendarException.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action: 'park.exception.removed',
          targetType: 'ParkCalendarException',
          targetId: id,
          metadata: { date: fromDbDate(exception.date) },
        },
        tx,
      );
    });
    return this.get(auth, exception.establishmentId);
  }
}

/** Un jour ouvert a des heures cohérentes (ouverture avant fermeture) ; heures absentes = toute la journée. */
function assertHours(isClosed: boolean, opensAt?: string | null, closesAt?: string | null) {
  if (isClosed) return;
  const start = opensAt ? parseTime(opensAt) : 0;
  const end = closesAt ? parseTime(closesAt) : 24 * 60;
  if (start === null || end === null || start >= end) {
    throw new BadRequestException({
      code: 'INVALID_HOURS',
      message: "L'heure d'ouverture doit précéder l'heure de fermeture.",
    });
  }
}
