import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import { SCHOOL_SUBJECT_CATALOG, findCatalogSubject, hasSchoolPermission } from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolStudentsService } from './school-students.service';
import type {
  AssignmentQueryDto,
  CreateAssignmentDto,
  CreateGroupDto,
  EndAssignmentDto,
  GroupStudentsDto,
  ReplaceAssignmentDto,
  SubjectLevelsDto,
  TeacherQueryDto,
  TeacherSubjectsDto,
  UpdateClassDto,
  UpdateGroupDto,
  UpdateSubjectDto,
} from './school-teaching.dto';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };

const MEMBER_NAMES = {
  id: true,
  firstName: true,
  lastName: true,
  firstNameAr: true,
  lastNameAr: true,
  isActive: true,
} as const;
const NAMED = { id: true, name: true, nameAr: true } as const;

/** Affectation telle qu'elle est restituée : classe, groupe, matière, enseignant, dates. */
const ASSIGNMENT_VIEW = {
  id: true,
  isHomeroom: true,
  startedAt: true,
  endedAt: true,
  endReason: true,
  class: {
    select: { ...NAMED, year: { select: { id: true, label: true, status: true, schoolId: true } } },
  },
  group: { select: NAMED },
  subject: { select: NAMED },
  member: { select: MEMBER_NAMES },
} satisfies Prisma.SchoolTeachingAssignmentSelect;

/** Classe visée par une affectation, lue avec ce qui fonde son contrôle. */
interface ClassScope {
  id: string;
  levelId: string;
  schoolId: string;
  schoolYearId: string;
}

/**
 * Équipe pédagogique (Sprint 3B) : catalogue et niveaux des matières, classes et groupes, enseignants,
 * affectations d'enseignement. Une affectation terminée reste dans l'historique ; le lien d'accès
 * SchoolClassTeacher, qui fonde la lecture des élèves par l'enseignant, vit tant qu'il garde au moins
 * une affectation active dans la classe. Verrous dans l'ordre établi : établissement (partagé), classe,
 * membre.
 */
@Injectable()
export class SchoolTeachingService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
  ) {}

  // ─── Matières ───

  /** Catalogue commun, avec la matière déjà activée par l'établissement le cas échéant. */
  async catalog(ctx: SchoolContext, schoolId: string) {
    await this.school.assertSchool(ctx, schoolId);
    const activated = await this.db.subject.findMany({
      where: { organizationId: ctx.organizationId, schoolId, catalogKey: { not: null } },
      select: { id: true, catalogKey: true, isActive: true },
    });
    const byKey = new Map(activated.map((s) => [s.catalogKey, s]));
    return SCHOOL_SUBJECT_CATALOG.map((entry) => ({
      ...entry,
      subjectId: byKey.get(entry.key)?.id ?? null,
      isActive: byKey.get(entry.key)?.isActive ?? false,
    }));
  }

  /**
   * Active une matière du catalogue : l'établissement en reçoit sa propre copie, qu'il adapte sans toucher
   * au catalogue ni aux autres écoles. Une matière déjà activée puis désactivée est réactivée.
   */
  async activateCatalogSubject(ctx: SchoolContext, key: string, schoolId: string) {
    const entry = findCatalogSubject(key);
    if (!entry) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, schoolId);
    const subject = await this.school.unique(
      () =>
        this.db.$transaction(async (tx) => {
          const existing = await tx.subject.findFirst({
            where: { organizationId: ctx.organizationId, schoolId, catalogKey: key },
          });
          if (existing) {
            return tx.subject.update({ where: { id: existing.id }, data: { isActive: true } });
          }
          return tx.subject.create({
            data: {
              organizationId: ctx.organizationId,
              schoolId,
              catalogKey: key,
              name: entry.name,
              nameAr: entry.nameAr,
              isReligious: entry.isReligious,
            },
          });
        }),
      'SCHOOL_NAME_USED',
      'Une matière de l’établissement porte déjà ce nom.',
    );
    await this.school.log(ctx, 'school.subject_activated', 'Subject', subject.id, { key });
    return subject;
  }

  async updateSubject(ctx: SchoolContext, id: string, dto: UpdateSubjectDto) {
    await this.findSubject(ctx, id);
    const subject = await this.school.unique(
      () => this.db.subject.update({ where: { id }, data: dto }),
      'SCHOOL_NAME_USED',
      'Une matière de l’établissement porte déjà ce nom.',
    );
    await this.school.log(ctx, 'school.subject_updated', 'Subject', id, {
      fields: Object.keys(dto),
    });
    return subject;
  }

  /** Niveaux où la matière est enseignée : tous doivent appartenir à l'établissement de la matière. */
  async setSubjectLevels(ctx: SchoolContext, id: string, dto: SubjectLevelsDto) {
    const subject = await this.findSubject(ctx, id);
    const levelIds = [...new Set(dto.levels.map((l) => l.levelId))];
    if (levelIds.length !== dto.levels.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Un niveau figure deux fois.',
      });
    }
    const owned = await this.db.level.count({
      where: {
        id: { in: levelIds },
        organizationId: ctx.organizationId,
        cycle: { schoolId: subject.schoolId },
      },
    });
    if (owned !== levelIds.length) throw this.otherSchool();
    await this.db.$transaction(async (tx) => {
      // Deux remplacements simultanés se succèdent : sans ce verrou, chacun supprimerait l'ancienne
      // liste avant d'insérer la sienne, et la matière cumulerait les deux.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Subject"
        WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid
          AND "schoolId" = ${subject.schoolId}::uuid
        FOR UPDATE`;
      if (!locked.length) throw new NotFoundException(NOT_FOUND);
      await tx.subjectLevel.deleteMany({
        where: { organizationId: ctx.organizationId, subjectId: id },
      });
      await tx.subjectLevel.createMany({
        data: dto.levels.map((l) => ({
          organizationId: ctx.organizationId,
          subjectId: id,
          levelId: l.levelId,
          coefficient: l.coefficient ?? null,
          weeklyHours: l.weeklyHours ?? null,
        })),
      });
    });
    await this.school.log(ctx, 'school.subject_levels_set', 'Subject', id, {
      levels: levelIds.length,
    });
    return this.db.subjectLevel.findMany({
      where: { organizationId: ctx.organizationId, subjectId: id },
      include: { level: { select: NAMED } },
    });
  }

  // ─── Classes et groupes ───

  /**
   * Fiche de classe ; un enseignant ne voit que les classes qui lui sont confiées. L'équipe pédagogique n'est
   * restituée qu'avec la lecture de l'équipe (`school.teaching.read`), ou à l'enseignant de cette classe.
   */
  async classDetail(ctx: SchoolContext, id: string) {
    const scope = await this.findClass(ctx, id);
    // Droits et restitution lus dans un même instantané, comme les autres lectures School.
    return this.students.snapshot(async (tx) => {
      const own = await this.students.ownClasses(ctx, tx);
      if (own && !own.includes(id)) throw new NotFoundException(NOT_FOUND);
      const canSeeTeam = own !== null || hasSchoolPermission(ctx.role, 'school.teaching.read');
      const cls = await tx.schoolClass.findUniqueOrThrow({
        where: { id },
        select: {
          ...NAMED,
          capacity: true,
          isActive: true,
          year: { select: { id: true, label: true, status: true, schoolId: true } },
          level: { select: NAMED },
          track: { select: NAMED },
          groups: {
            orderBy: { name: 'asc' },
            select: { ...NAMED, isActive: true, _count: { select: { students: true } } },
          },
        },
      });
      const enrolled = await tx.schoolEnrollment.count({
        where: { organizationId: ctx.organizationId, classId: id, status: 'VALIDATED' },
      });
      const teaching = canSeeTeam
        ? await tx.schoolTeachingAssignment.findMany({
            where: { organizationId: ctx.organizationId, classId: id, endedAt: null },
            orderBy: [{ subject: { name: 'asc' } }],
            select: ASSIGNMENT_VIEW,
          })
        : null;
      // Accès hérités d'avant le Sprint 3B (sans affectation) : visibles pour pouvoir être retirés.
      const legacyAccess =
        own === null && canSeeTeam
          ? await tx.schoolClassTeacher.findMany({
              where: {
                organizationId: ctx.organizationId,
                classId: id,
                member: { teaching: { none: { classId: id, endedAt: null } } },
              },
              select: { member: { select: MEMBER_NAMES } },
            })
          : [];
      return {
        ...cls,
        schoolId: scope.schoolId,
        enrolled,
        teaching,
        legacyAccess: legacyAccess.map((l) => l.member),
      };
    });
  }

  /** Modification ou archivage ; la capacité ne descend jamais sous l'effectif inscrit. */
  async updateClass(ctx: SchoolContext, id: string, dto: UpdateClassDto) {
    const scope = await this.findClass(ctx, id);
    const updated = await this.school.unique(
      () =>
        this.db.$transaction(async (tx) => {
          await this.school.guardSchools(tx, [scope.schoolId]);
          await this.assertYearOpen(tx, scope.schoolYearId);
          await this.lockClass(tx, id);
          if (dto.capacity != null) {
            const enrolled = await tx.schoolEnrollment.count({
              where: { organizationId: ctx.organizationId, classId: id, status: 'VALIDATED' },
            });
            if (dto.capacity < enrolled) {
              throw new ConflictException({
                code: 'CAPACITY_BELOW_ENROLLED',
                message: `La capacité ne peut pas être inférieure à l’effectif inscrit (${enrolled}).`,
              });
            }
          }
          return tx.schoolClass.update({ where: { id }, data: dto });
        }),
      'SCHOOL_NAME_USED',
      'Cette classe existe déjà pour cette année.',
    );
    await this.school.log(ctx, 'school.class_updated', 'SchoolClass', id, {
      fields: Object.keys(dto),
    });
    return updated;
  }

  /** Droits et données lus dans un même instantané : un transfert simultané ne fuit pas dans la réponse. */
  async listGroups(ctx: SchoolContext, classId: string) {
    await this.findClass(ctx, classId);
    return this.students.snapshot(async (tx) => {
      const own = await this.students.ownClasses(ctx, tx);
      if (own && !own.includes(classId)) throw new NotFoundException(NOT_FOUND);
      return tx.schoolClassGroup.findMany({
        where: { organizationId: ctx.organizationId, classId },
        orderBy: { name: 'asc' },
        select: {
          ...NAMED,
          isActive: true,
          students: {
            // Seuls les élèves encore inscrits dans la classe, et visibles de l'utilisateur.
            where: {
              student: {
                enrollments: { some: { classId, status: 'VALIDATED' } },
                ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
              },
            },
            orderBy: { student: { lastName: 'asc' } },
            select: {
              student: {
                select: {
                  id: true,
                  matricule: true,
                  lastName: true,
                  firstName: true,
                  lastNameAr: true,
                  firstNameAr: true,
                },
              },
            },
          },
        },
      });
    });
  }

  async createGroup(ctx: SchoolContext, classId: string, dto: CreateGroupDto) {
    const scope = await this.findClass(ctx, classId);
    const group = await this.school.unique(
      () =>
        this.db.$transaction(async (tx) => {
          await this.school.guardSchools(tx, [scope.schoolId]);
          await this.assertYearOpen(tx, scope.schoolYearId);
          await this.assertClassActive(tx, classId);
          return tx.schoolClassGroup.create({
            data: {
              organizationId: ctx.organizationId,
              classId,
              name: dto.name,
              nameAr: dto.nameAr ?? null,
            },
          });
        }),
      'GROUP_NAME_USED',
      'Un groupe de cette classe porte déjà ce nom.',
    );
    await this.school.log(ctx, 'school.group_created', 'SchoolClassGroup', group.id, { classId });
    return group;
  }

  async updateGroup(ctx: SchoolContext, id: string, dto: UpdateGroupDto) {
    await this.findGroup(ctx, id);
    const group = await this.school.unique(
      () => this.db.schoolClassGroup.update({ where: { id }, data: dto }),
      'GROUP_NAME_USED',
      'Un groupe de cette classe porte déjà ce nom.',
    );
    await this.school.log(ctx, 'school.group_updated', 'SchoolClassGroup', id, {
      fields: Object.keys(dto),
    });
    return group;
  }

  /** Élèves d'un groupe : tous inscrits (inscription validée) dans la classe du groupe. */
  async setGroupStudents(ctx: SchoolContext, id: string, dto: GroupStudentsDto) {
    const group = await this.findGroup(ctx, id);
    const studentIds = [...new Set(dto.studentIds)];
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [group.schoolId]);
      await this.assertYearOpen(tx, group.schoolYearId);
      // Même ordre que les inscriptions (établissement, élève, classe, inscription) : les élèves d'abord, en
      // partagé et dans un ordre fixe ; une sortie ou un transfert simultané attend cette transaction.
      // Verrou borné au périmètre : un identifiant étranger n'immobilise jamais le dossier d'une autre école.
      const students = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SchoolStudent"
        WHERE id = ANY(${studentIds}::uuid[])
          AND "organizationId" = ${ctx.organizationId}::uuid AND "schoolId" = ${group.schoolId}::uuid
        ORDER BY id FOR SHARE`;
      if (students.length !== studentIds.length) throw this.notInClass();
      await this.lockClass(tx, group.classId);
      // Inscriptions lues en lecture verrouillée : un changement de classe, une sortie ou un transfert
      // simultané attend la fin de cette transaction, ou bien l'élève déjà parti n'est plus compté.
      const enrolled = await tx.$queryRaw<{ studentId: string }[]>`
        SELECT "studentId" FROM "SchoolEnrollment"
        WHERE "organizationId" = ${ctx.organizationId}::uuid AND "classId" = ${group.classId}::uuid
          AND "status" = 'VALIDATED' AND "studentId" = ANY(${studentIds}::uuid[])
        FOR SHARE`;
      if (new Set(enrolled.map((e) => e.studentId)).size !== studentIds.length) {
        throw this.notInClass();
      }
      await tx.schoolClassGroupStudent.deleteMany({
        where: { organizationId: ctx.organizationId, groupId: id },
      });
      await tx.schoolClassGroupStudent.createMany({
        data: studentIds.map((studentId) => ({
          organizationId: ctx.organizationId,
          groupId: id,
          studentId,
        })),
      });
    });
    await this.school.log(ctx, 'school.group_students_set', 'SchoolClassGroup', id, {
      students: studentIds.length,
    });
    return { groupId: id, studentIds };
  }

  // ─── Enseignants ───

  async listTeachers(ctx: SchoolContext, q: TeacherQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    const search = q.q
      ? {
          OR: (['firstName', 'lastName', 'firstNameAr', 'lastNameAr', 'loginId'] as const).map(
            (field) => ({ [field]: { contains: q.q, mode: 'insensitive' as const } }),
          ),
        }
      : {};
    const teachers = await this.db.schoolMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        role: 'TEACHER',
        assignments: { some: { schoolId: q.schoolId } },
        ...(q.active !== undefined ? { isActive: q.active } : {}),
        // Filtres contraints à l'établissement demandé : un identifiant d'une autre école ne révèle rien.
        ...(q.subjectId
          ? { subjects: { some: { subjectId: q.subjectId, subject: { schoolId: q.schoolId } } } }
          : {}),
        ...(q.classId
          ? {
              teaching: {
                some: {
                  classId: q.classId,
                  endedAt: null,
                  class: { year: { schoolId: q.schoolId } },
                },
              },
            }
          : {}),
        ...search,
      },
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        ...MEMBER_NAMES,
        loginId: true,
        subjects: {
          where: { subject: { schoolId: q.schoolId } },
          select: { subject: { select: NAMED } },
        },
        teaching: {
          where: { endedAt: null, class: { year: { schoolId: q.schoolId } } },
          select: {
            class: { select: NAMED },
            subject: { select: NAMED },
            group: { select: NAMED },
          },
        },
      },
    });
    return teachers.map(({ subjects, ...t }) => ({
      ...t,
      subjects: subjects.map((s) => s.subject),
    }));
  }

  /** Fiche enseignant : matières, établissements du périmètre et historique complet des affectations. */
  async teacherDetail(ctx: SchoolContext, id: string) {
    // Contrôle et restitution dans un même instantané : un déplacement concurrent hors du périmètre ne
    // peut pas laisser passer des valeurs écrites après.
    return this.students.snapshot(async (tx) => {
      const scopeSchools = await this.teacherSchools(ctx, id, tx);
      const teacher = await tx.schoolMember.findUniqueOrThrow({
        where: { id },
        select: {
          ...MEMBER_NAMES,
          loginId: true,
          subjects: {
            where: { subject: { schoolId: { in: scopeSchools } } },
            select: { subject: { select: { ...NAMED, schoolId: true } } },
          },
          teaching: {
            where: { class: { year: { schoolId: { in: scopeSchools } } } },
            orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, { startedAt: 'desc' }],
            select: ASSIGNMENT_VIEW,
          },
        },
      });
      const { subjects, ...rest } = teacher;
      return { ...rest, schoolIds: scopeSchools, subjects: subjects.map((s) => s.subject) };
    });
  }

  /**
   * Matières enseignables. Seules celles des établissements du périmètre de l'utilisateur changent ; une
   * matière doit appartenir à un établissement où l'enseignant est affecté.
   */
  async setTeacherSubjects(ctx: SchoolContext, id: string, dto: TeacherSubjectsDto) {
    const subjectIds = [...new Set(dto.subjectIds)];
    // Périmètre vérifié avant tout verrou ; le verrou lui-même reste borné au périmètre.
    await this.teacherSchools(ctx, id);
    await this.db.$transaction(async (tx) => {
      if (!(await this.school.lockMemberInScope(tx, ctx, id))) {
        throw new NotFoundException(NOT_FOUND);
      }
      const schools = await this.teacherSchools(ctx, id, tx);
      const owned = await tx.subject.count({
        where: {
          id: { in: subjectIds },
          organizationId: ctx.organizationId,
          schoolId: { in: schools },
        },
      });
      if (owned !== subjectIds.length) throw this.otherSchool();
      await tx.schoolTeacherSubject.deleteMany({
        where: {
          organizationId: ctx.organizationId,
          memberId: id,
          subject: { schoolId: { in: schools } },
        },
      });
      await tx.schoolTeacherSubject.createMany({
        data: subjectIds.map((subjectId) => ({
          organizationId: ctx.organizationId,
          memberId: id,
          subjectId,
        })),
      });
    });
    await this.school.log(ctx, 'school.teacher_subjects_set', 'SchoolMember', id, {
      subjects: subjectIds.length,
    });
    return { memberId: id, subjectIds };
  }

  /** Affectations actives de l'enseignant connecté (« mes classes »). */
  async mine(ctx: SchoolContext) {
    const memberId = ctx.memberId;
    if (!memberId) return [];
    // Sélection et relations chargées dans un même instantané : jamais une classe relue après le retrait.
    return this.students.snapshot((tx) =>
      tx.schoolTeachingAssignment.findMany({
        where: {
          organizationId: ctx.organizationId,
          memberId,
          endedAt: null,
          class: {
            year: {
              status: { not: 'CLOSED' },
              ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
            },
          },
        },
        orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }],
        select: ASSIGNMENT_VIEW,
      }),
    );
  }

  // ─── Affectations ───

  async listAssignments(ctx: SchoolContext, q: AssignmentQueryDto) {
    if (!q.classId && !q.memberId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Précisez une classe ou un enseignant.',
      });
    }
    // L'établissement d'une classe ne change pas ; celui d'un enseignant, si. Son périmètre et la
    // restitution (noms compris) sont donc lus dans un même instantané.
    const classSchool = q.classId ? (await this.findClass(ctx, q.classId)).schoolId : null;
    return this.students.snapshot(async (tx) => {
      const schools = classSchool ? [classSchool] : [];
      if (q.memberId) schools.push(...(await this.teacherSchools(ctx, q.memberId, tx)));
      return tx.schoolTeachingAssignment.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(q.classId ? { classId: q.classId } : {}),
          ...(q.memberId ? { memberId: q.memberId } : {}),
          ...(q.history ? {} : { endedAt: null }),
          class: { year: { schoolId: { in: schools } } },
        },
        orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, { startedAt: 'desc' }],
        select: ASSIGNMENT_VIEW,
      });
    });
  }

  async createAssignment(ctx: SchoolContext, dto: CreateAssignmentDto) {
    const scope = await this.findClass(ctx, dto.classId);
    const created = await this.conflicts(scope.id, dto.isHomeroom ?? false, () =>
      this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [scope.schoolId]);
        await this.assertYearOpen(tx, scope.schoolYearId);
        await this.lockClass(tx, scope.id);
        await this.assertClassActive(tx, scope.id);
        return this.assignInTx(tx, ctx, scope, dto);
      }),
    );
    await this.school.publishDecisions(ctx.organizationId);
    return created;
  }

  /** Fin d'une affectation : elle reste dans l'historique ; l'accès s'arrête avec la dernière. */
  async endAssignment(ctx: SchoolContext, id: string, dto: EndAssignmentDto) {
    const { scope } = await this.findAssignment(ctx, id);
    const ended = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [scope.schoolId]);
      await this.lockClass(tx, scope.id);
      return this.endInTx(tx, ctx, id, dto.reason ?? null);
    });
    await this.school.publishDecisions(ctx.organizationId);
    return ended;
  }

  /**
   * Remplacement : l'affectation en cours se termine et la même place (classe, groupe, matière, rôle de
   * professeur principal) est confiée au remplaçant, dans une seule transaction.
   */
  async replaceAssignment(ctx: SchoolContext, id: string, dto: ReplaceAssignmentDto) {
    const { scope, assignment } = await this.findAssignment(ctx, id);
    if (assignment.memberId === dto.memberId) {
      throw new BadRequestException({
        code: 'SAME_TEACHER',
        message: 'Le remplaçant est déjà l’enseignant de cette affectation.',
      });
    }
    const created = await this.conflicts(scope.id, assignment.isHomeroom, () =>
      this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [scope.schoolId]);
        await this.assertYearOpen(tx, scope.schoolYearId);
        await this.lockClass(tx, scope.id);
        await this.assertClassActive(tx, scope.id);
        // Les deux enseignants verrouillés avant toute écriture, dans un ordre fixe : une modification de
        // membre simultanée (verrou exclusif, puis affectations) ne peut pas former de cycle.
        const locked = await this.lockTeachers(tx, ctx, scope.schoolId, [
          assignment.memberId,
          dto.memberId,
        ]);
        if (!locked.includes(dto.memberId)) throw this.teacherNotInSchool();
        await this.endInTx(tx, ctx, id, dto.reason ?? null);
        return this.assignInTx(tx, ctx, scope, {
          classId: scope.id,
          groupId: assignment.groupId ?? undefined,
          subjectId: assignment.subjectId,
          memberId: dto.memberId,
          isHomeroom: assignment.isHomeroom,
        });
      }),
    );
    await this.school.publishDecisions(ctx.organizationId);
    return created;
  }

  /** Contrôles et écriture d'une affectation, sous les verrous établissement et classe déjà pris. */
  private async assignInTx(
    tx: Tx,
    ctx: SchoolContext,
    scope: ClassScope,
    dto: CreateAssignmentDto,
  ) {
    if (dto.groupId) {
      const group = await tx.schoolClassGroup.findFirst({
        where: { id: dto.groupId, organizationId: ctx.organizationId, classId: scope.id },
        select: { isActive: true },
      });
      if (!group?.isActive) {
        throw new BadRequestException({
          code: 'GROUP_NOT_IN_CLASS',
          message: 'Ce groupe n’est pas un groupe actif de cette classe.',
        });
      }
    }
    const subject = await tx.subject.findFirst({
      where: { id: dto.subjectId, organizationId: ctx.organizationId, schoolId: scope.schoolId },
      select: {
        isActive: true,
        levels: { where: { levelId: scope.levelId }, select: { levelId: true } },
      },
    });
    if (!subject?.isActive) {
      throw new BadRequestException({
        code: 'SUBJECT_UNAVAILABLE',
        message: 'Cette matière n’est pas une matière active de l’établissement.',
      });
    }
    if (subject.levels.length === 0) {
      throw new BadRequestException({
        code: 'SUBJECT_NOT_IN_LEVEL',
        message: 'Cette matière n’est pas enseignée au niveau de cette classe.',
      });
    }
    // Verrou partagé : une désactivation ou un retrait de l'établissement (verrou exclusif) attend la fin
    // de cette affectation, et l'enseignant est relu ici après toute modification concurrente.
    const locked = await this.lockTeachers(tx, ctx, scope.schoolId, [dto.memberId]);
    if (locked.length === 0) throw this.teacherNotInSchool();
    const member = await tx.schoolMember.findFirst({
      where: {
        id: dto.memberId,
        organizationId: ctx.organizationId,
        role: 'TEACHER',
        isActive: true,
        assignments: { some: { schoolId: scope.schoolId } },
      },
      // Matières enseignables de cet établissement seulement : l'alerte ne révèle rien d'une autre école.
      select: {
        id: true,
        subjects: { where: { subject: { schoolId: scope.schoolId } }, select: { subjectId: true } },
      },
    });
    if (!member) throw this.teacherNotInSchool();
    const slot = await tx.schoolTeachingAssignment.findFirst({
      where: {
        organizationId: ctx.organizationId,
        classId: scope.id,
        groupId: dto.groupId ?? null,
        subjectId: dto.subjectId,
        endedAt: null,
      },
      select: { id: true },
    });
    if (slot) throw this.slotTaken();
    if (dto.isHomeroom) {
      const homeroom = await tx.schoolTeachingAssignment.findFirst({
        where: {
          organizationId: ctx.organizationId,
          classId: scope.id,
          isHomeroom: true,
          endedAt: null,
        },
        select: { id: true },
      });
      if (homeroom) throw this.homeroomTaken();
    }
    const assignment = await tx.schoolTeachingAssignment.create({
      data: {
        organizationId: ctx.organizationId,
        classId: scope.id,
        groupId: dto.groupId ?? null,
        memberId: dto.memberId,
        subjectId: dto.subjectId,
        isHomeroom: dto.isHomeroom ?? false,
        createdByUserId: ctx.userId,
      },
      select: ASSIGNMENT_VIEW,
    });
    // Le lien d'accès existe déjà si l'enseignant a une autre affectation dans la classe.
    await tx.schoolClassTeacher.createMany({
      data: [{ organizationId: ctx.organizationId, classId: scope.id, memberId: dto.memberId }],
      skipDuplicates: true,
    });
    await this.school.recordDecision(tx, ctx, 'school.teaching_assigned', 'SchoolClass', scope.id, {
      assignmentId: assignment.id,
      memberId: dto.memberId,
      subjectId: dto.subjectId,
      groupId: dto.groupId ?? null,
      isHomeroom: dto.isHomeroom ?? false,
    });
    // Alerte seulement : des matières enseignables sont définies et celle-ci n'en fait pas partie.
    const qualified = member.subjects.map((s) => s.subjectId);
    return {
      ...assignment,
      outsideQualifications: qualified.length > 0 && !qualified.includes(dto.subjectId),
    };
  }

  /** Termine une affectation active ; retire le lien d'accès si c'était la dernière dans la classe. */
  private async endInTx(tx: Tx, ctx: SchoolContext, id: string, reason: string | null) {
    const current = await tx.schoolTeachingAssignment.findUniqueOrThrow({
      where: { id },
      select: { classId: true, memberId: true },
    });
    // Fin conditionnelle : une fin concurrente (désactivation du membre, clôture) n'est jamais écrasée.
    const { count } = await tx.schoolTeachingAssignment.updateMany({
      where: { id, endedAt: null },
      data: { endedAt: new Date(), endedByUserId: ctx.userId, endReason: reason },
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'ASSIGNMENT_ENDED',
        message: 'Cette affectation est déjà terminée.',
      });
    }
    const ended = await tx.schoolTeachingAssignment.findUniqueOrThrow({
      where: { id },
      select: ASSIGNMENT_VIEW,
    });
    const remaining = await tx.schoolTeachingAssignment.count({
      where: {
        organizationId: ctx.organizationId,
        classId: current.classId,
        memberId: current.memberId,
        endedAt: null,
      },
    });
    if (remaining === 0) {
      await tx.schoolClassTeacher.deleteMany({
        where: {
          organizationId: ctx.organizationId,
          classId: current.classId,
          memberId: current.memberId,
        },
      });
    }
    await this.school.recordDecision(
      tx,
      ctx,
      'school.teaching_ended',
      'SchoolClass',
      current.classId,
      {
        assignmentId: id,
        memberId: current.memberId,
        accessRemoved: remaining === 0,
      },
    );
    return ended;
  }

  // ─── Outils ───

  private async findSubject(ctx: SchoolContext, id: string) {
    const subject = await this.db.subject.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true },
    });
    if (!subject) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, subject.schoolId);
    return subject;
  }

  private async findClass(ctx: SchoolContext, id: string): Promise<ClassScope> {
    const cls = await this.db.schoolClass.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, levelId: true, schoolYearId: true, year: { select: { schoolId: true } } },
    });
    if (!cls) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, cls.year.schoolId);
    return {
      id: cls.id,
      levelId: cls.levelId,
      schoolYearId: cls.schoolYearId,
      schoolId: cls.year.schoolId,
    };
  }

  private async findGroup(ctx: SchoolContext, id: string) {
    const group = await this.db.schoolClassGroup.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { classId: true },
    });
    if (!group) throw new NotFoundException(NOT_FOUND);
    const scope = await this.findClass(ctx, group.classId);
    return { classId: scope.id, schoolId: scope.schoolId, schoolYearId: scope.schoolYearId };
  }

  private async findAssignment(ctx: SchoolContext, id: string) {
    const assignment = await this.db.schoolTeachingAssignment.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { classId: true, groupId: true, subjectId: true, memberId: true, isHomeroom: true },
    });
    if (!assignment) throw new NotFoundException(NOT_FOUND);
    return { scope: await this.findClass(ctx, assignment.classId), assignment };
  }

  /** Établissements de l'enseignant compris dans le périmètre de l'utilisateur ; aucun = introuvable. */
  private async teacherSchools(
    ctx: SchoolContext,
    id: string,
    db: Tx | SchoolPrismaService = this.db,
  ) {
    const member = await db.schoolMember.findFirst({
      where: { id, organizationId: ctx.organizationId, role: 'TEACHER' },
      select: { assignments: { select: { schoolId: true } } },
    });
    const schools = (member?.assignments ?? [])
      .map((a) => a.schoolId)
      .filter((schoolId) => !ctx.schoolIds || ctx.schoolIds.includes(schoolId));
    if (schools.length === 0) throw new NotFoundException(NOT_FOUND);
    return schools;
  }

  private async lockClass(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SchoolClass" WHERE id = ${id}::uuid FOR UPDATE`;
  }

  private async assertClassActive(tx: Tx, id: string) {
    const { isActive } = await tx.schoolClass.findUniqueOrThrow({
      where: { id },
      select: { isActive: true },
    });
    if (!isActive) {
      throw new ConflictException({
        code: 'CLASS_ARCHIVED',
        message: 'Cette classe est archivée.',
      });
    }
  }

  /** Relue sous le verrou partagé de l'établissement : la clôture, exclusive, ne peut pas s'intercaler. */
  private async assertYearOpen(tx: Tx, schoolYearId: string) {
    const { status } = await tx.schoolYear.findUniqueOrThrow({
      where: { id: schoolYearId },
      select: { status: true },
    });
    if (status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
  }

  /**
   * Les index partiels tranchent les écritures simultanées. Prisma ne nomme pas l'index violé (sa cible est
   * « classId » pour les deux) : la base est relue pour restituer le bon conflit.
   */
  private async conflicts<T>(
    classId: string,
    isHomeroom: boolean,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const homeroom =
          isHomeroom &&
          (await this.db.schoolTeachingAssignment.count({
            where: { classId, isHomeroom: true, endedAt: null },
          })) > 0;
        throw homeroom ? this.homeroomTaken() : this.slotTaken();
      }
      throw error;
    }
  }

  private slotTaken() {
    return new ConflictException({
      code: 'TEACHING_SLOT_TAKEN',
      message: 'Un enseignant est déjà affecté à cette matière pour cette classe ou ce groupe.',
    });
  }

  private homeroomTaken() {
    return new ConflictException({
      code: 'HOMEROOM_TAKEN',
      message: 'Cette classe a déjà un professeur principal.',
    });
  }

  /**
   * Verrou partagé des enseignants, borné à l'organisation et à l'établissement : un identifiant étranger
   * n'immobilise jamais un compte d'un autre client ou d'une autre école. Ordre fixe par identifiant.
   * Renvoie les comptes effectivement verrouillés.
   */
  private async lockTeachers(tx: Tx, ctx: SchoolContext, schoolId: string, ids: string[]) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM "SchoolMember" m
      WHERE m.id = ANY(${ids}::uuid[]) AND m."organizationId" = ${ctx.organizationId}::uuid
        AND EXISTS (
          SELECT 1 FROM "SchoolMemberAssignment" a
          WHERE a."memberId" = m.id AND a."schoolId" = ${schoolId}::uuid
        )
      ORDER BY m.id FOR SHARE OF m`;
    return rows.map((r) => r.id);
  }

  private teacherNotInSchool() {
    return new BadRequestException({
      code: 'TEACHER_NOT_IN_SCHOOL',
      message: 'Ce compte n’est pas un enseignant actif de cet établissement.',
    });
  }

  private notInClass() {
    return new BadRequestException({
      code: 'STUDENT_NOT_IN_CLASS',
      message: 'Chaque élève du groupe doit être inscrit dans sa classe.',
    });
  }

  private otherSchool() {
    return new BadRequestException({
      code: 'OTHER_SCHOOL',
      message: 'Cet élément appartient à un autre établissement.',
    });
  }
}
