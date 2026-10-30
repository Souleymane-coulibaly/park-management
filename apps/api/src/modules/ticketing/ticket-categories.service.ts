import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { fromDbDate, ParkScheduleService, toDbDate } from './park-schedule.service';
import type { CreateTicketCategoryDto, UpdateTicketCategoryDto } from './ticketing.dto';

export const CATEGORY_SELECT = {
  id: true,
  establishmentId: true,
  kind: true,
  name: true,
  description: true,
  price: true,
  peopleIncluded: true,
  conditions: true,
  availableFrom: true,
  availableUntil: true,
  validityDays: true,
  sortOrder: true,
  isActive: true,
} as const;

type CategoryRow = Prisma.TicketCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

export function toCategory(row: CategoryRow) {
  return {
    ...row,
    availableFrom: row.availableFrom ? fromDbDate(row.availableFrom) : null,
    availableUntil: row.availableUntil ? fromDbDate(row.availableUntil) : null,
  };
}

const NAME_TAKEN = {
  code: 'TICKET_CATEGORY_NAME_TAKEN',
  message: 'Une catégorie porte déjà ce nom dans cet établissement.',
};

/** null efface la date, undefined la laisse inchangée. */
const dateOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : toDbDate(value.slice(0, 10));

/** Tarifs de la billetterie. Une catégorie vendue n'est jamais supprimée : elle est désactivée. */
@Injectable()
export class TicketCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly schedule: ParkScheduleService,
  ) {}

  async list(auth: TenantContext, establishmentId: string) {
    await this.schedule.findParkEstablishment(auth, establishmentId);
    const rows = await this.prisma.ticketCategory.findMany({
      where: { organizationId: auth.membership.organizationId, establishmentId },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: CATEGORY_SELECT,
    });
    return rows.map(toCategory);
  }

  /**
   * `inactive` : catégorie créée désactivée (import IA) ; elle ne se vend qu'après activation
   * explicite par un responsable.
   */
  async create(
    auth: TenantContext,
    dto: CreateTicketCategoryDto,
    options: { inactive?: boolean; source?: string } = {},
  ) {
    const establishment = await this.schedule.findParkEstablishment(auth, dto.establishmentId);
    assertWindow(dto.availableFrom, dto.availableUntil);
    const organizationId = auth.membership.organizationId;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.ticketCategory.create({
          data: {
            organizationId,
            establishmentId: establishment.id,
            kind: dto.kind,
            name: dto.name,
            description: dto.description || null,
            price: dto.price,
            peopleIncluded: dto.peopleIncluded ?? 1,
            conditions: dto.conditions || null,
            availableFrom: dateOrNull(dto.availableFrom),
            availableUntil: dateOrNull(dto.availableUntil),
            validityDays: dto.validityDays ?? 1,
            sortOrder: dto.sortOrder ?? 0,
            ...(options.inactive ? { isActive: false } : {}),
          },
          select: CATEGORY_SELECT,
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'ticket_category.created',
            targetType: 'TicketCategory',
            targetId: created.id,
            metadata: {
              name: created.name,
              kind: created.kind,
              price: created.price,
              ...(options.source ? { source: options.source } : {}),
            },
          },
          tx,
        );
        return created;
      });
      return toCategory(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
      throw error;
    }
  }

  async update(auth: TenantContext, id: string, dto: UpdateTicketCategoryDto) {
    const existing = await this.prisma.ticketCategory.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: CATEGORY_SELECT,
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'TICKET_CATEGORY_NOT_FOUND',
        message: 'Catégorie de billet introuvable.',
      });
    }
    const current = toCategory(existing);
    assertWindow(
      dto.availableFrom === undefined ? current.availableFrom : dto.availableFrom,
      dto.availableUntil === undefined ? current.availableUntil : dto.availableUntil,
    );
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.ticketCategory.update({
          where: { id },
          data: {
            kind: dto.kind,
            name: dto.name,
            description: dto.description === undefined ? undefined : dto.description || null,
            price: dto.price,
            peopleIncluded: dto.peopleIncluded,
            conditions: dto.conditions === undefined ? undefined : dto.conditions || null,
            availableFrom: dateOrNull(dto.availableFrom),
            availableUntil: dateOrNull(dto.availableUntil),
            validityDays: dto.validityDays,
            sortOrder: dto.sortOrder,
            isActive: dto.isActive,
          },
          select: CATEGORY_SELECT,
        });
        // Les billets déjà émis gardent leur prix payé : seul le tarif des ventes futures change.
        await this.audit.record(
          {
            organizationId: auth.membership.organizationId,
            actorUserId: auth.user.id,
            action: 'ticket_category.updated',
            targetType: 'TicketCategory',
            targetId: id,
            metadata: {
              name: updated.name,
              changes: Object.keys(dto),
              previousPrice: existing.price,
              price: updated.price,
            },
          },
          tx,
        );
        return updated;
      });
      return toCategory(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
      throw error;
    }
  }
}

function assertWindow(from?: string | null, until?: string | null) {
  if (from && until && from.slice(0, 10) > until.slice(0, 10)) {
    throw new BadRequestException({
      code: 'INVALID_AVAILABILITY',
      message: 'La date de début de vente doit précéder la date de fin.',
    });
  }
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
