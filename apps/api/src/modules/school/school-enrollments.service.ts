import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_DOCUMENT_CATEGORY_LABELS,
  canTransitionEnrollment,
  hasSchoolPermission,
  studentSearchText,
  type SchoolExitReason,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import type {
  ChangeClassDto,
  CreateEnrollmentDto,
  EnrollmentStatusDto,
  EnrollmentsQueryDto,
  ExitDto,
  TransferDto,
} from './school-students.dto';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const today = () => toDate(new Date().toISOString().slice(0, 10));

const VIEW = {
  id: true,
  studentId: true,
  schoolId: true,
  schoolYearId: true,
  kind: true,
  status: true,
  enrolledOn: true,
  exitReason: true,
  exitedOn: true,
  statusNote: true,
  createdAt: true,
  year: { select: { id: true, label: true } },
  level: { select: { id: true, name: true, nameAr: true } },
  track: { select: { id: true, name: true, nameAr: true } },
  class: { select: { id: true, name: true, nameAr: true } },
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
} satisfies Prisma.SchoolEnrollmentSelect;

/** Inscriptions, affectations, sorties et transferts : chaque changement est historisé et contrôlé. */
@Injectable()
export class SchoolEnrollmentsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
  ) {}

  async list(ctx: SchoolContext, q: EnrollmentsQueryDto) {
    if (q.schoolId) await this.school.assertSchool(ctx, q.schoolId);
    const pageSize = 25;
    const page = q.page ?? 1;
    const where: Prisma.SchoolEnrollmentWhereInput = {
      organizationId: ctx.organizationId,
      ...(q.schoolId
        ? { schoolId: q.schoolId }
        : ctx.schoolIds
          ? { schoolId: { in: ctx.schoolIds } }
          : {}),
      ...(q.schoolYearId ? { schoolYearId: q.schoolYearId } : {}),
      ...(q.status ? { status: q.status } : {}),
      // Après un transfert, l'ancien établissement ne lit plus le dossier actuel par cette jointure.
      ...(ctx.schoolIds ? { student: { schoolId: { in: ctx.schoolIds } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.schoolEnrollment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: VIEW,
      }),
      this.db.schoolEnrollment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async forStudent(ctx: SchoolContext, studentId: string) {
    await this.students.findStudent(ctx, studentId);
    return this.db.schoolEnrollment.findMany({
      where: {
        organizationId: ctx.organizationId,
        studentId,
        ...this.students.linkedStudentScope(ctx),
      },
      orderBy: { createdAt: 'desc' },
      select: VIEW,
    });
  }

  /** Inscription ou réinscription : le même dossier, jamais un second. L'index partiel refuse le doublon. */
  async create(ctx: SchoolContext, dto: CreateEnrollmentDto) {
    const student = await this.students.findStudent(ctx, dto.studentId);
    const created = await this.school.unique(
      () =>
        this.db.$transaction(async (tx) => {
          await this.school.guardSchools(tx, [student.schoolId]);
          const locked = await this.lockStudent(tx, ctx, dto.studentId);
          if (locked.schoolId !== student.schoolId) throw this.changed();
          const { submit, ...placement } = dto;
          return this.createInTx(tx, ctx, {
            ...placement,
            schoolId: student.schoolId,
            status: submit ? 'PENDING' : 'DRAFT',
          });
        }),
      'ENROLLMENT_DUPLICATE',
      'Cet élève a déjà une inscription active pour cette année scolaire.',
    );
    await this.school.log(ctx, 'school.enrollment_created', 'SchoolEnrollment', created.id, {
      kind: created.kind,
      status: created.status,
    });
    return created;
  }

  async createInTx(
    tx: Tx,
    ctx: SchoolContext,
    input: {
      studentId: string;
      schoolId: string;
      schoolYearId: string;
      levelId: string;
      classId?: string;
      trackId?: string;
      status: 'DRAFT' | 'PENDING';
      transferIn?: boolean;
    },
  ) {
    const trackId = await this.assertPlacement(tx, ctx, input);
    const history = await tx.schoolEnrollment.count({
      where: {
        organizationId: ctx.organizationId,
        studentId: input.studentId,
        status: { in: ['VALIDATED', 'ENDED'] },
      },
    });
    const kind = input.transferIn ? 'TRANSFER_IN' : history > 0 ? 'RENEWAL' : 'NEW';
    const enrollment = await tx.schoolEnrollment.create({
      data: {
        organizationId: ctx.organizationId,
        studentId: input.studentId,
        schoolId: input.schoolId,
        schoolYearId: input.schoolYearId,
        levelId: input.levelId,
        classId: input.classId ?? null,
        trackId,
        kind,
        status: input.status,
        createdByUserId: ctx.userId,
      },
      select: VIEW,
    });
    await this.students.event(tx, ctx, input.studentId, 'ENROLLMENT_CREATED', {
      enrollmentId: enrollment.id,
      kind,
      schoolYearId: input.schoolYearId,
    });
    return enrollment;
  }

  /** La validation appartient à la direction ; le secrétariat prépare et soumet. */
  async setStatus(ctx: SchoolContext, id: string, dto: EnrollmentStatusDto) {
    const { schoolId, studentId } = await this.find(ctx, id);
    const { from, view } = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [schoolId]);
      await this.lockStudent(tx, ctx, studentId);
      // Relue sous verrou : classe et statut sont ceux que les contrôles et les écritures utilisent.
      const enrollment = await tx.schoolEnrollment.findUniqueOrThrow({ where: { id } });
      if (!canTransitionEnrollment(enrollment.status, dto.status)) {
        throw new ConflictException({
          code: 'ENROLLMENT_TRANSITION_REFUSED',
          message: 'Ce changement de statut n’est pas autorisé.',
        });
      }
      if (dto.status === 'VALIDATED' || enrollment.status === 'VALIDATED') {
        this.students.requirePermission(ctx, 'school.enrollments.validate');
      }
      if (enrollment.status === 'VALIDATED' && !dto.note) {
        throw new BadRequestException({
          code: 'NOTE_REQUIRED',
          message: 'Indiquez le motif de l’annulation.',
        });
      }
      if (dto.status === 'VALIDATED' || enrollment.status === 'VALIDATED') {
        await this.assertYearOpen(tx, ctx, enrollment.schoolYearId);
      }
      const { count } = await tx.schoolEnrollment.updateMany({
        where: { id, status: enrollment.status },
        data: {
          status: dto.status,
          statusNote: dto.note ?? null,
          ...(dto.status === 'VALIDATED' ? { enrolledOn: today() } : {}),
        },
      });
      if (count === 0) throw this.changed();
      if (dto.status === 'VALIDATED') await this.validate(tx, ctx, enrollment);
      if (enrollment.status === 'VALIDATED') {
        await this.closeAssignment(tx, ctx, studentId, enrollment.schoolYearId);
        await this.refreshStudentStatus(tx, ctx, studentId);
      }
      await this.students.event(tx, ctx, studentId, 'ENROLLMENT_STATUS', {
        enrollmentId: id,
        from: enrollment.status,
        to: dto.status,
      });
      return {
        from: enrollment.status,
        view: await tx.schoolEnrollment.findUniqueOrThrow({ where: { id }, select: VIEW }),
      };
    });
    await this.school.log(ctx, 'school.enrollment_status_changed', 'SchoolEnrollment', id, {
      from,
      to: dto.status,
    });
    return view;
  }

  /** Effectif contrôlé sous verrou de la classe : deux validations simultanées ne la dépassent pas. */
  private async validate(
    tx: Tx,
    ctx: SchoolContext,
    enrollment: {
      id: string;
      studentId: string;
      schoolId: string;
      schoolYearId: string;
      classId: string | null;
    },
  ) {
    if (!enrollment.classId) {
      throw new ConflictException({
        code: 'ENROLLMENT_CLASS_REQUIRED',
        message: 'Choisissez une classe avant de valider.',
      });
    }
    const guardians = await tx.schoolStudentGuardian.count({
      where: { organizationId: ctx.organizationId, studentId: enrollment.studentId },
    });
    if (guardians === 0) {
      throw new ConflictException({
        code: 'ENROLLMENT_GUARDIAN_REQUIRED',
        message: 'Rattachez au moins un responsable légal avant de valider.',
      });
    }
    const settings = await this.students.readSettings(tx, ctx.organizationId, enrollment.schoolId);
    if (settings.requiredDocuments.length > 0) {
      const present = await tx.schoolStudentDocument.findMany({
        where: {
          organizationId: ctx.organizationId,
          studentId: enrollment.studentId,
          deletedAt: null,
          category: { in: settings.requiredDocuments },
        },
        select: { category: true },
      });
      const missing = settings.requiredDocuments.filter(
        (c) => !present.some((d) => d.category === c),
      );
      if (missing.length > 0) {
        throw new ConflictException({
          code: 'ENROLLMENT_DOCUMENTS_MISSING',
          message: 'Des pièces obligatoires manquent au dossier.',
          details: missing.map((c) => SCHOOL_DOCUMENT_CATEGORY_LABELS[c]),
        });
      }
    }
    await this.assertRoom(tx, ctx, enrollment.classId);
    await this.openAssignment(
      tx,
      ctx,
      enrollment,
      enrollment.classId,
      'Validation de l’inscription',
    );
    await tx.schoolStudent.update({
      where: { id: enrollment.studentId },
      data: { status: 'ENROLLED' },
    });
  }

  /** Avant validation, la classe prévue change seule ; après, l'ancienne affectation reste dans l'historique. */
  async changeClass(ctx: SchoolContext, id: string, dto: ChangeClassDto) {
    const { schoolId, studentId } = await this.find(ctx, id);
    const view = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [schoolId]);
      await this.lockStudent(tx, ctx, studentId);
      const enrollment = await tx.schoolEnrollment.findUniqueOrThrow({ where: { id } });
      if (!['DRAFT', 'PENDING', 'VALIDATED'].includes(enrollment.status)) throw this.changed();
      if (enrollment.classId === dto.classId) {
        throw new ConflictException({
          code: 'SAME_CLASS',
          message: 'L’élève est déjà dans cette classe.',
        });
      }
      const target = await this.findClass(tx, ctx, dto.classId, enrollment.schoolYearId);
      // Verrou de capacité avant la référence : la clé étrangère ne peut plus croiser deux déplacements.
      await this.lockClass(tx, target.id);
      await tx.schoolEnrollment.update({
        where: { id },
        data: {
          classId: target.id,
          levelId: target.levelId,
          trackId: target.trackId,
        },
      });
      if (enrollment.status === 'VALIDATED') {
        await this.assertRoom(tx, ctx, target.id);
        await this.closeAssignment(tx, ctx, studentId, enrollment.schoolYearId);
        await this.openAssignment(tx, ctx, enrollment, target.id, dto.reason ?? null);
      }
      await this.students.event(tx, ctx, studentId, 'CLASS_CHANGED', {
        enrollmentId: id,
        from: enrollment.classId,
        to: target.id,
      });
      return tx.schoolEnrollment.findUniqueOrThrow({ where: { id }, select: VIEW });
    });
    await this.school.log(ctx, 'school.class_changed', 'SchoolEnrollment', id, {
      to: dto.classId,
    });
    return view;
  }

  /** Transfert vers l'extérieur, départ ou abandon : l'inscription se termine, le dossier reste. */
  async exit(ctx: SchoolContext, id: string, dto: ExitDto) {
    const enrollment = await this.find(ctx, id);
    if (enrollment.status !== 'VALIDATED') {
      throw new ConflictException({
        code: 'ENROLLMENT_NOT_VALIDATED',
        message: 'Seule une inscription validée peut prendre fin.',
      });
    }
    const view = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [enrollment.schoolId]);
      await this.lockStudent(tx, ctx, enrollment.studentId);
      await this.assertYearOpen(tx, ctx, enrollment.schoolYearId);
      await this.endEnrollment(tx, ctx, enrollment, dto.reason, toDate(dto.exitedOn), dto.note);
      // Encore inscrit sur une autre année (réinscription déjà validée) : le statut ne change pas.
      const others = await tx.schoolEnrollment.count({
        where: {
          organizationId: ctx.organizationId,
          studentId: enrollment.studentId,
          status: 'VALIDATED',
          year: { status: { not: 'CLOSED' } },
        },
      });
      if (others === 0) {
        // L'élève part : une inscription préparée pour une autre année n'a plus d'objet.
        await tx.schoolEnrollment.updateMany({
          where: {
            organizationId: ctx.organizationId,
            studentId: enrollment.studentId,
            status: { in: ['DRAFT', 'PENDING'] },
          },
          data: { status: 'CANCELLED', statusNote: 'Sortie de l’élève' },
        });
        await tx.schoolStudent.update({
          where: { id: enrollment.studentId },
          data: { status: dto.reason },
        });
      }
      return tx.schoolEnrollment.findUniqueOrThrow({ where: { id }, select: VIEW });
    });
    await this.school.log(ctx, 'school.enrollment_exited', 'SchoolEnrollment', id, {
      reason: dto.reason,
    });
    return view;
  }

  /**
   * Transfert entre deux établissements du groupe : réservé à qui a accès aux deux. Le dossier, ses
   * responsables et ses pièces suivent ; l'inscription d'origine se termine, une nouvelle attend validation.
   */
  async transfer(ctx: SchoolContext, studentId: string, dto: TransferDto) {
    const visible = await this.students.findStudent(ctx, studentId);
    await this.school.assertSchool(ctx, dto.targetSchoolId);
    if (visible.schoolId === dto.targetSchoolId) {
      throw new ConflictException({
        code: 'SAME_SCHOOL',
        message: 'L’élève est déjà dans cet établissement.',
      });
    }
    const result = await this.school.unique(
      () =>
        this.db.$transaction(async (tx) => {
          await this.school.guardSchools(tx, [visible.schoolId, dto.targetSchoolId]);
          const student = await this.lockStudent(tx, ctx, studentId);
          if (student.schoolId !== visible.schoolId) throw this.changed();
          // L'accès aux responsables dépend de l'établissement de l'enfant : voir leur verrou d'écriture.
          await tx.$queryRaw`
            SELECT g.id FROM "SchoolGuardian" g
            JOIN "SchoolStudentGuardian" l ON l."guardianId" = g.id
            WHERE l."studentId" = ${studentId}::uuid
            ORDER BY g.id FOR UPDATE OF g`;
          const settings = await this.students.readSettings(
            tx,
            ctx.organizationId,
            dto.targetSchoolId,
          );
          const scope = this.students.matriculeScopeKey(settings, dto.targetSchoolId);
          const collision = await tx.schoolStudent.count({
            where: {
              organizationId: ctx.organizationId,
              matriculeScope: scope,
              matricule: student.matricule,
              id: { not: studentId },
            },
          });
          const year = await this.students.matriculeYear(
            ctx.organizationId,
            dto.targetSchoolId,
            dto.targetSchoolYearId,
            tx,
          );
          const matricule =
            collision > 0
              ? await this.students.nextMatricule(
                  tx,
                  ctx.organizationId,
                  settings,
                  dto.targetSchoolId,
                  year,
                )
              : student.matricule;
          const active = await tx.schoolEnrollment.findMany({
            where: {
              organizationId: ctx.organizationId,
              studentId,
              status: { in: ['DRAFT', 'PENDING', 'VALIDATED'] },
              // Une année clôturée reste telle quelle dans l'historique.
              year: { status: { not: 'CLOSED' } },
            },
          });
          for (const enrollment of active) {
            if (enrollment.status === 'VALIDATED') {
              await this.endEnrollment(
                tx,
                ctx,
                enrollment,
                'TRANSFERRED',
                toDate(dto.effectiveOn),
                dto.reason,
              );
            } else {
              const { count } = await tx.schoolEnrollment.updateMany({
                where: { id: enrollment.id, status: enrollment.status },
                data: { status: 'CANCELLED', statusNote: dto.reason },
              });
              if (count === 0) throw this.changed();
            }
          }
          await tx.schoolStudent.update({
            where: { id: studentId },
            data: {
              schoolId: dto.targetSchoolId,
              matricule,
              matriculeScope: scope,
              searchText: studentSearchText(student, matricule),
              status: 'REGISTERED',
            },
          });
          const enrollment = await this.createInTx(tx, ctx, {
            studentId,
            schoolId: dto.targetSchoolId,
            schoolYearId: dto.targetSchoolYearId,
            levelId: dto.targetLevelId,
            classId: dto.targetClassId,
            status: 'PENDING',
            transferIn: true,
          });
          await this.students.event(tx, ctx, studentId, 'TRANSFERRED', {
            fromSchoolId: student.schoolId,
            toSchoolId: dto.targetSchoolId,
            fromMatricule: student.matricule,
            toMatricule: matricule,
            reason: dto.reason,
          });
          return { enrollment, matricule };
        }),
      'ENROLLMENT_DUPLICATE',
      'Cet élève a déjà une inscription active pour cette année scolaire.',
    );
    await this.school.log(ctx, 'school.student_transferred', 'SchoolStudent', studentId, {
      from: visible.schoolId,
      to: dto.targetSchoolId,
    });
    return result;
  }

  // ─── Classes et effectifs ───

  /** Effectifs d'une année, limités aux classes de l'enseignant pour ce rôle. */
  async rosters(ctx: SchoolContext, schoolYearId: string) {
    const year = await this.findYear(ctx, schoolYearId);
    const own = await this.students.ownClasses(ctx);
    const canSeeTeachers = hasSchoolPermission(ctx.role, 'school.structure.manage');
    const classes = await this.db.schoolClass.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: year.id,
        ...(own ? { id: { in: own } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameAr: true,
        capacity: true,
        level: { select: { id: true, name: true, nameAr: true } },
        track: { select: { id: true, name: true, nameAr: true } },
        _count: { select: { enrollments: { where: { status: 'VALIDATED' } } } },
        ...(canSeeTeachers
          ? {
              teachers: {
                select: {
                  member: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            }
          : {}),
      },
    });
    return classes.map(({ _count, ...c }) => ({ ...c, enrolled: _count.enrollments }));
  }

  /** Liste de classe : colonnes restreintes, quel que soit le rôle. */
  async roster(ctx: SchoolContext, classId: string) {
    const cls = await this.db.schoolClass.findFirst({
      where: { id: classId, organizationId: ctx.organizationId },
      select: {
        id: true,
        name: true,
        nameAr: true,
        capacity: true,
        year: { select: { schoolId: true, label: true } },
      },
    });
    if (!cls) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, cls.year.schoolId);
    const own = await this.students.ownClasses(ctx);
    if (own && !own.includes(classId)) throw new NotFoundException(NOT_FOUND);
    const enrollments = await this.db.schoolEnrollment.findMany({
      where: {
        organizationId: ctx.organizationId,
        classId,
        status: 'VALIDATED',
        ...(ctx.schoolIds ? { student: { schoolId: { in: ctx.schoolIds } } } : {}),
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      select: {
        id: true,
        student: {
          select: {
            id: true,
            matricule: true,
            lastName: true,
            firstName: true,
            lastNameAr: true,
            firstNameAr: true,
            status: true,
          },
        },
      },
    });
    return {
      class: cls,
      students: enrollments.map((e) => ({ enrollmentId: e.id, ...e.student })),
    };
  }

  /** L'enseignant doit être affecté à l'établissement de la classe. */
  async addTeacher(ctx: SchoolContext, classId: string, memberId: string) {
    const cls = await this.db.schoolClass.findFirst({
      where: { id: classId, organizationId: ctx.organizationId },
      select: { id: true, year: { select: { schoolId: true } } },
    });
    if (!cls) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, cls.year.schoolId);
    const member = await this.db.schoolMember.findFirst({
      where: {
        id: memberId,
        organizationId: ctx.organizationId,
        role: 'TEACHER',
        isActive: true,
        assignments: { some: { schoolId: cls.year.schoolId } },
      },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException({
        code: 'TEACHER_NOT_IN_SCHOOL',
        message: 'Ce compte n’est pas un enseignant de cet établissement.',
      });
    }
    await this.school.unique(
      () =>
        this.db.schoolClassTeacher.create({
          data: { organizationId: ctx.organizationId, classId, memberId },
        }),
      'TEACHER_ALREADY_ASSIGNED',
      'Cette classe est déjà confiée à cet enseignant.',
    );
    await this.school.log(ctx, 'school.class_teacher_added', 'SchoolClass', classId, { memberId });
    return { classId, memberId };
  }

  async removeTeacher(ctx: SchoolContext, classId: string, memberId: string) {
    const cls = await this.db.schoolClass.findFirst({
      where: { id: classId, organizationId: ctx.organizationId },
      select: { year: { select: { schoolId: true } } },
    });
    if (!cls) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, cls.year.schoolId);
    await this.db.schoolClassTeacher.deleteMany({
      where: { organizationId: ctx.organizationId, classId, memberId },
    });
    await this.school.log(ctx, 'school.class_teacher_removed', 'SchoolClass', classId, {
      memberId,
    });
  }

  // ─── Outils ───

  private async find(ctx: SchoolContext, id: string) {
    const enrollment = await this.db.schoolEnrollment.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { student: { schoolId: { in: ctx.schoolIds } } } : {}),
      },
    });
    if (!enrollment) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, enrollment.schoolId);
    return enrollment;
  }

  private async findYear(ctx: SchoolContext, id: string) {
    const year = await this.db.schoolYear.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true },
    });
    if (!year) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, year.schoolId);
    return year;
  }

  /** Sérialise les opérations sur un même élève, et relit son état sous ce verrou. */
  private lockStudent(tx: Tx, ctx: SchoolContext, studentId: string) {
    return this.students.lockInScope(tx, ctx, studentId);
  }

  private async assertYearOpen(tx: Tx, ctx: SchoolContext, schoolYearId: string) {
    const year = await tx.schoolYear.findFirstOrThrow({
      where: { id: schoolYearId, organizationId: ctx.organizationId },
      select: { status: true },
    });
    if (year.status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
  }

  /**
   * Année ouverte, niveau, classe et parcours du même établissement : incompatibilités refusées.
   * Renvoie le parcours à enregistrer : celui choisi, sinon celui de la classe.
   */
  async assertPlacement(
    tx: Tx,
    ctx: SchoolContext,
    input: {
      schoolId: string;
      schoolYearId: string;
      levelId: string;
      classId?: string;
      trackId?: string;
    },
  ): Promise<string | null> {
    const org = ctx.organizationId;
    const year = await tx.schoolYear.findFirst({
      where: { id: input.schoolYearId, organizationId: org, schoolId: input.schoolId },
      select: { status: true },
    });
    if (!year) throw this.otherSchool();
    if (year.status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
    const level = await tx.level.findFirst({
      where: { id: input.levelId, organizationId: org, cycle: { schoolId: input.schoolId } },
      select: { id: true },
    });
    if (!level) throw this.otherSchool();
    if (input.trackId) {
      const track = await tx.pedagogicalTrack.findFirst({
        where: { id: input.trackId, organizationId: org, schoolId: input.schoolId },
        select: { id: true },
      });
      if (!track) throw this.otherSchool();
    }
    if (input.classId) {
      const cls = await this.findClass(tx, ctx, input.classId, input.schoolYearId);
      if (cls.levelId !== input.levelId) {
        throw new BadRequestException({
          code: 'CLASS_LEVEL_MISMATCH',
          message: 'Cette classe ne correspond pas au niveau choisi.',
        });
      }
      if (input.trackId && cls.trackId && cls.trackId !== input.trackId) {
        throw new BadRequestException({
          code: 'CLASS_TRACK_MISMATCH',
          message: 'Cette classe ne correspond pas au parcours choisi.',
        });
      }
      return input.trackId ?? cls.trackId;
    }
    return input.trackId ?? null;
  }

  private async findClass(tx: Tx, ctx: SchoolContext, classId: string, schoolYearId: string) {
    const cls = await tx.schoolClass.findFirst({
      where: { id: classId, organizationId: ctx.organizationId, schoolYearId },
      select: { id: true, levelId: true, trackId: true, year: { select: { status: true } } },
    });
    if (!cls) throw this.otherSchool();
    if (cls.year.status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
    return cls;
  }

  private async lockClass(tx: Tx, classId: string) {
    const [cls] = await tx.$queryRaw<{ capacity: number | null }[]>`
      SELECT "capacity" FROM "SchoolClass" WHERE id = ${classId}::uuid FOR UPDATE`;
    return cls;
  }

  private async assertRoom(tx: Tx, ctx: SchoolContext, classId: string) {
    const cls = await this.lockClass(tx, classId);
    if (cls?.capacity == null) return;
    // L'inscription en cours est déjà enregistrée sur cette classe : elle est comptée.
    const enrolled = await tx.schoolEnrollment.count({
      where: { organizationId: ctx.organizationId, classId, status: 'VALIDATED' },
    });
    if (enrolled > cls.capacity) {
      throw new ConflictException({ code: 'CLASS_FULL', message: 'Cette classe est complète.' });
    }
  }

  private openAssignment(
    tx: Tx,
    ctx: SchoolContext,
    enrollment: { id: string; studentId: string; schoolYearId: string },
    classId: string,
    reason: string | null,
  ) {
    return tx.schoolClassAssignment.create({
      data: {
        organizationId: ctx.organizationId,
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        schoolYearId: enrollment.schoolYearId,
        classId,
        reason,
        createdByUserId: ctx.userId,
      },
    });
  }

  private closeAssignment(tx: Tx, ctx: SchoolContext, studentId: string, schoolYearId: string) {
    return tx.schoolClassAssignment.updateMany({
      where: { organizationId: ctx.organizationId, studentId, schoolYearId, endedAt: null },
      data: { endedAt: new Date() },
    });
  }

  private async endEnrollment(
    tx: Tx,
    ctx: SchoolContext,
    enrollment: { id: string; studentId: string; schoolYearId: string },
    reason: SchoolExitReason,
    exitedOn: Date,
    note?: string | null,
  ) {
    const { count } = await tx.schoolEnrollment.updateMany({
      where: { id: enrollment.id, status: 'VALIDATED' },
      data: { status: 'ENDED', exitReason: reason, exitedOn, statusNote: note ?? null },
    });
    if (count === 0) throw this.changed();
    await this.closeAssignment(tx, ctx, enrollment.studentId, enrollment.schoolYearId);
    await this.students.event(tx, ctx, enrollment.studentId, 'ENROLLMENT_ENDED', {
      enrollmentId: enrollment.id,
      reason,
    });
  }

  private async refreshStudentStatus(tx: Tx, ctx: SchoolContext, studentId: string) {
    const validated = await tx.schoolEnrollment.count({
      where: {
        organizationId: ctx.organizationId,
        studentId,
        status: 'VALIDATED',
        year: { status: { not: 'CLOSED' } },
      },
    });
    await tx.schoolStudent.update({
      where: { id: studentId },
      data: { status: validated > 0 ? 'ENROLLED' : 'REGISTERED' },
    });
  }

  private otherSchool() {
    return new BadRequestException({
      code: 'OTHER_SCHOOL',
      message: 'Ces éléments n’appartiennent pas au même établissement.',
    });
  }

  private changed() {
    return new ConflictException({
      code: 'ENROLLMENT_CHANGED',
      message: 'Cette inscription vient de changer : rechargez la page.',
    });
  }
}
