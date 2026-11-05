import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import type { SchoolContext } from './school-access';
import type { RoomDto, RoomQueryDto, RoomUpdateDto } from './school-planning.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const ROOM_SELECT = {
  id: true,
  schoolId: true,
  name: true,
  nameAr: true,
  capacity: true,
  isActive: true,
} as const;

/**
 * Salles d'un établissement (Sprint 7) : nom, capacité, activation. Une salle n'est jamais supprimée
 * (historique des créneaux et examens) : elle se désactive et n'est plus proposée.
 */
@Injectable()
export class SchoolRoomsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
  ) {}

  async list(ctx: SchoolContext, q: RoomQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    return this.db.schoolRoom.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: q.schoolId,
        ...(q.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: ROOM_SELECT,
    });
  }

  async create(ctx: SchoolContext, dto: RoomDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    try {
      const room = await this.db.schoolRoom.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: dto.schoolId,
          name: dto.name,
          nameAr: dto.nameAr ?? null,
          capacity: dto.capacity ?? null,
        },
        select: ROOM_SELECT,
      });
      await this.school.log(ctx, 'school.room_created', 'SchoolRoom', room.id, {});
      return room;
    } catch (error) {
      throw duplicate(error);
    }
  }

  async update(ctx: SchoolContext, id: string, dto: RoomUpdateDto) {
    const found = await this.db.schoolRoom.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { schoolId: true },
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, found.schoolId);
    try {
      const room = await this.db.schoolRoom.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
          ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: ROOM_SELECT,
      });
      await this.school.log(ctx, 'school.room_updated', 'SchoolRoom', id, {
        isActive: room.isActive ? 'true' : 'false',
      });
      return room;
    } catch (error) {
      throw duplicate(error);
    }
  }
}

function duplicate(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException({
      code: 'ROOM_NAME_TAKEN',
      message: 'Une salle porte déjà ce nom dans l’établissement.',
    });
  }
  return error;
}
