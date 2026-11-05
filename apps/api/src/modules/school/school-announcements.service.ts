import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_ANNOUNCEMENTS_PAGE,
  SchoolPermission,
  type SchoolAnnouncementAudience,
  hasSchoolPermission,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { SchoolContext } from './school-access';
import { SchoolNotificationsService } from './school-notifications.service';
import type { PortalChild } from './school-portal-accounts.service';
import type { AnnouncementDto, AnnouncementQueryDto } from './school-portal.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { today } from './school-report-cards.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);

const ANNOUNCEMENT_SELECT = {
  id: true,
  schoolId: true,
  title: true,
  body: true,
  titleAr: true,
  bodyAr: true,
  audience: true,
  status: true,
  expiresOn: true,
  publishedAt: true,
  archivedAt: true,
  createdAt: true,
  createdByUserId: true,
} as const;

/**
 * Annonces aux familles (Sprint 6) : brouillon, publication, archivage, expiration facultative, historique.
 * Publics : tout l'établissement, des classes, des élèves ou des responsables choisis. Sans la permission
 * de gestion (enseignant), seulement ses classes. À la publication, chaque compte du portail concerné
 * reçoit une notification ; les familles ne voient que ce qui vise leurs enfants.
 */
@Injectable()
export class SchoolAnnouncementsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly school: SchoolService,
    private readonly notifications: SchoolNotificationsService,
  ) {}

  async list(ctx: SchoolContext, q: AnnouncementQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    const rows = await this.db.schoolAnnouncement.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: q.schoolId,
        ...(q.status ? { status: q.status } : {}),
        // Enseignant : ses propres annonces de classe.
        ...(this.manages(ctx) ? {} : { createdByUserId: ctx.userId }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SCHOOL_ANNOUNCEMENTS_PAGE,
      skip: (q.page ?? 0) * SCHOOL_ANNOUNCEMENTS_PAGE,
      select: { ...ANNOUNCEMENT_SELECT, _count: { select: { targets: true } } },
    });
    return rows.map((r) => ({ ...r, expiresOn: day(r.expiresOn) }));
  }

  async get(ctx: SchoolContext, id: string) {
    const found = await this.find(ctx, id);
    const [targets, events] = await Promise.all([
      this.db.schoolAnnouncementTarget.findMany({
        where: { organizationId: ctx.organizationId, announcementId: id },
        select: { classId: true, studentId: true, guardianId: true },
      }),
      this.db.schoolAnnouncementEvent.findMany({
        where: { organizationId: ctx.organizationId, announcementId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, action: true, actorUserId: true, createdAt: true },
      }),
    ]);
    const actors = await this.core.user.findMany({
      where: { id: { in: [...new Set(events.map((e) => e.actorUserId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    return {
      ...found,
      expiresOn: day(found.expiresOn),
      targetIds: targets.map((t) => t.classId ?? t.studentId ?? t.guardianId!),
      events: events.map(({ actorUserId, ...e }) => ({
        ...e,
        actor: names.get(actorUserId) ?? null,
      })),
    };
  }

  async create(ctx: SchoolContext, dto: AnnouncementDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    const targets = await this.targets(ctx, dto);
    const id = await this.db.$transaction(async (tx) => {
      const created = await tx.schoolAnnouncement.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: dto.schoolId,
          title: dto.title,
          body: dto.body,
          titleAr: dto.titleAr ?? null,
          bodyAr: dto.bodyAr ?? null,
          audience: dto.audience,
          expiresOn: dto.expiresOn ? toDate(dto.expiresOn) : null,
          createdByUserId: ctx.userId,
          targets: { create: targets },
        },
      });
      await this.event(tx, ctx, created.id, 'created');
      return created.id;
    });
    return this.get(ctx, id);
  }

  /** Modification d'un brouillon seulement : une annonce publiée ne se réécrit pas, elle s'archive. */
  async update(ctx: SchoolContext, id: string, dto: AnnouncementDto) {
    const found = await this.find(ctx, id);
    if (dto.schoolId !== found.schoolId) throw new NotFoundException(NOT_FOUND);
    const targets = await this.targets(ctx, dto);
    await this.db.$transaction(async (tx) => {
      await this.lockDraft(tx, id);
      await tx.schoolAnnouncementTarget.deleteMany({
        where: { organizationId: ctx.organizationId, announcementId: id },
      });
      await tx.schoolAnnouncement.update({
        where: { id },
        data: {
          title: dto.title,
          body: dto.body,
          titleAr: dto.titleAr ?? null,
          bodyAr: dto.bodyAr ?? null,
          audience: dto.audience,
          expiresOn: dto.expiresOn ? toDate(dto.expiresOn) : null,
          targets: { create: targets.map((t) => ({ ...t })) },
        },
      });
      await this.event(tx, ctx, id, 'updated');
    });
    return this.get(ctx, id);
  }

  /**
   * Publication : notification de chaque compte du portail concerné (une seule par compte). Contenu,
   * public, expiration et cibles sont relus sous le verrou du brouillon : une modification concurrente
   * ne peut pas désaccorder l'annonce publiée et ses destinataires.
   */
  async publish(ctx: SchoolContext, id: string) {
    await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      const found = await this.lockDraft(tx, id);
      // Enseignant : ses classes au moment de publier, et non à la rédaction du brouillon.
      if (!this.manages(ctx)) await this.assertOwnTargets(tx, ctx, id, found.audience);
      const school = await tx.school.findUniqueOrThrow({
        where: { id: found.schoolId },
        select: { timezone: true },
      });
      if (found.expiresOn && day(found.expiresOn)! < today(school.timezone)) {
        throw new BadRequestException({
          code: 'ANNOUNCEMENT_EXPIRED',
          message: 'La date d’expiration est déjà passée.',
        });
      }
      await tx.schoolAnnouncement.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId: ctx.userId },
      });
      await this.event(tx, ctx, id, 'published');
      const users = await this.recipients(
        tx,
        ctx.organizationId,
        found.schoolId,
        found.audience,
        id,
      );
      await this.notifications.notifyUsers(
        tx,
        users.map((userId) => ({
          organizationId: ctx.organizationId,
          schoolId: found.schoolId,
          userId,
          studentId: null,
          kind: 'ANNOUNCEMENT' as const,
          resourceId: id,
          dedupeKey: `announcement:${id}`,
          params: { title: found.title },
        })),
      );
      await this.school.recordDecision(
        tx,
        ctx,
        'school.announcement_published',
        'SchoolAnnouncement',
        id,
        {
          audience: found.audience,
          recipients: users.length,
        },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  async archive(ctx: SchoolContext, id: string) {
    await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SchoolAnnouncement" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.schoolAnnouncement.findUniqueOrThrow({ where: { id } });
      if (current.status === 'ARCHIVED') {
        throw new ConflictException({
          code: 'ANNOUNCEMENT_ARCHIVED',
          message: 'Cette annonce est déjà archivée.',
        });
      }
      await tx.schoolAnnouncement.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await this.event(tx, ctx, id, 'archived');
    });
    return this.get(ctx, id);
  }

  // ─── Portail parents ───

  /** Annonces visibles des enfants autorisés : publiées, non expirées, ciblant l'un d'eux. */
  async visibleFor(children: PortalChild[], take = 50, skip = 0) {
    if (children.length === 0) return [];
    const rows = await this.db.schoolAnnouncement.findMany({
      where: this.visibleWhere(children),
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take,
      skip,
      select: {
        id: true,
        schoolId: true,
        title: true,
        body: true,
        titleAr: true,
        bodyAr: true,
        publishedAt: true,
        expiresOn: true,
      },
    });
    return rows.map((r) => ({ ...r, expiresOn: day(r.expiresOn) }));
  }

  /**
   * Identifiants des annonces visibles aujourd'hui : la notification d'une annonce n'est consultable que
   * tant que l'annonce vise encore un enfant autorisé (un enfant retiré emporte ses notifications).
   */
  async visibleIds(children: PortalChild[]): Promise<string[]> {
    if (children.length === 0) return [];
    const rows = await this.db.schoolAnnouncement.findMany({
      where: this.visibleWhere(children),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private visibleWhere(children: PortalChild[]): Prisma.SchoolAnnouncementWhereInput {
    const bySchool = new Map<string, PortalChild[]>();
    for (const c of children) bySchool.set(c.schoolId, [...(bySchool.get(c.schoolId) ?? []), c]);
    const filters: Prisma.SchoolAnnouncementWhereInput[] = [...bySchool].map(([schoolId, kids]) => {
      const tz = kids[0]!.school.timezone;
      return {
        organizationId: kids[0]!.organizationId,
        schoolId,
        status: 'PUBLISHED',
        OR: [{ expiresOn: null }, { expiresOn: { gte: toDate(today(tz)) } }],
        AND: [
          {
            OR: [
              { audience: 'SCHOOL' },
              {
                audience: 'CLASS',
                targets: {
                  some: {
                    classId: { in: kids.map((k) => k.class?.id).filter((x): x is string => !!x) },
                  },
                },
              },
              {
                audience: 'STUDENTS',
                targets: { some: { studentId: { in: kids.map((k) => k.id) } } },
              },
              {
                audience: 'GUARDIANS',
                targets: { some: { guardianId: { in: kids.flatMap((k) => k.guardianIds) } } },
              },
            ],
          },
        ],
      };
    });
    return { OR: filters };
  }

  // ─── Outils ───

  private manages(ctx: SchoolContext) {
    return hasSchoolPermission(ctx.role, SchoolPermission.ANNOUNCEMENTS_MANAGE);
  }

  /** Destinataires vérifiés : appartenance à l'établissement, classes de l'enseignant. */
  private async targets(ctx: SchoolContext, dto: AnnouncementDto) {
    const ids = [...new Set(dto.targetIds ?? [])];
    if (!this.manages(ctx) && dto.audience !== 'CLASS') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Vous ne pouvez publier que pour vos classes.',
      });
    }
    if (dto.audience === 'SCHOOL') {
      if (ids.length > 0) throw this.invalidTargets();
      return [];
    }
    if (ids.length === 0) throw this.invalidTargets();
    const org = ctx.organizationId;
    let found = 0;
    if (dto.audience === 'CLASS') {
      found = await this.db.schoolClass.count({
        where: { organizationId: org, id: { in: ids }, year: { schoolId: dto.schoolId } },
      });
      const own = await this.school.ownClasses(ctx);
      if (own && ids.some((id) => !own.includes(id))) throw new NotFoundException(NOT_FOUND);
    } else if (dto.audience === 'STUDENTS') {
      found = await this.db.schoolStudent.count({
        where: { organizationId: org, id: { in: ids }, schoolId: dto.schoolId },
      });
    } else {
      found = await this.db.schoolGuardian.count({
        where: { organizationId: org, id: { in: ids }, schoolId: dto.schoolId },
      });
    }
    if (found !== ids.length) throw this.invalidTargets();
    const key = { CLASS: 'classId', STUDENTS: 'studentId', GUARDIANS: 'guardianId' }[
      dto.audience as Exclude<SchoolAnnouncementAudience, 'SCHOOL'>
    ];
    // Création imbriquée : l'organisation se déduit de l'annonce (relation composée).
    return ids.map((id) => ({ [key]: id }));
  }

  /** Comptes actifs du portail visés par une annonce (liens autorisés du même établissement). */
  private async recipients(
    tx: Tx,
    organizationId: string,
    schoolId: string,
    audience: SchoolAnnouncementAudience,
    announcementId: string,
  ): Promise<string[]> {
    const targets = await tx.schoolAnnouncementTarget.findMany({
      where: { organizationId, announcementId },
      select: { classId: true, studentId: true, guardianId: true },
    });
    let guardianFilter: Prisma.SchoolGuardianWhereInput;
    if (audience === 'GUARDIANS') {
      guardianFilter = { id: { in: targets.map((t) => t.guardianId!) } };
    } else {
      const student: Prisma.SchoolStudentWhereInput =
        audience === 'SCHOOL'
          ? { schoolId }
          : audience === 'STUDENTS'
            ? { id: { in: targets.map((t) => t.studentId!) } }
            : {
                enrollments: {
                  some: {
                    status: 'VALIDATED',
                    classId: { in: targets.map((t) => t.classId!) },
                    year: { status: 'ACTIVE' },
                  },
                },
              };
      guardianFilter = {
        links: { some: { canViewSchoolInfo: true, student: { ...student, schoolId } } },
      };
    }
    const guardians = await tx.schoolGuardian.findMany({
      where: { organizationId, schoolId, portalUserId: { not: null }, ...guardianFilter },
      select: { portalUserId: true },
    });
    const users = [...new Set(guardians.map((g) => g.portalUserId!))];
    const active = await tx.schoolPortalAccount.findMany({
      where: { organizationId, userId: { in: users }, status: 'ACTIVE' },
      select: { userId: true },
    });
    return active.map((a) => a.userId);
  }

  private async find(ctx: SchoolContext, id: string) {
    const found = await this.db.schoolAnnouncement.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        ...(this.manages(ctx) ? {} : { createdByUserId: ctx.userId }),
      },
      select: ANNOUNCEMENT_SELECT,
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, found.schoolId);
    return found;
  }

  /** Verrouille le brouillon et renvoie son état relu sous ce verrou. */
  private async lockDraft(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SchoolAnnouncement" WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.schoolAnnouncement.findUniqueOrThrow({
      where: { id },
      select: ANNOUNCEMENT_SELECT,
    });
    if (current.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'ANNOUNCEMENT_NOT_DRAFT',
        message: 'Seul un brouillon peut être modifié ou publié.',
      });
    }
    return current;
  }

  /** Toutes les classes visées sont encore confiées à l'auteur sans permission de gestion (enseignant). */
  private async assertOwnTargets(
    tx: Tx,
    ctx: SchoolContext,
    id: string,
    audience: SchoolAnnouncementAudience,
  ) {
    const targets = await tx.schoolAnnouncementTarget.findMany({
      where: { organizationId: ctx.organizationId, announcementId: id },
      select: { classId: true },
    });
    const classIds = targets.map((t) => t.classId!);
    if (audience !== 'CLASS' || !(await this.school.holdsClasses(tx, ctx, classIds))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Vous ne pouvez publier que pour vos classes.',
      });
    }
  }

  private async event(tx: Tx, ctx: SchoolContext, announcementId: string, action: string) {
    await tx.schoolAnnouncementEvent.create({
      data: { organizationId: ctx.organizationId, announcementId, action, actorUserId: ctx.userId },
    });
  }

  private invalidTargets() {
    return new BadRequestException({
      code: 'INVALID_TARGETS',
      message: 'Destinataires invalides pour ce public.',
    });
  }
}
