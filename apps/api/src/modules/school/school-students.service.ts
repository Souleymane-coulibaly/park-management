import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  DEFAULT_MATRICULE_FORMAT,
  SCHOOL_CUSTOM_VALUE_MAX,
  buildMatricule,
  hasSchoolPermission,
  isLimitedToOwnClasses,
  isValidMatricule,
  normalizeSearch,
  studentIdentityKey,
  studentSearchText,
  validateCustomFields,
  type SchoolCustomField,
  type SchoolDocumentCategory,
  type SchoolPermission,
} from '@ocall/shared';
import { decryptSecret, encryptSecret } from '../../common/security/totp';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import type {
  CorrectMatriculeDto,
  CreateStudentDto,
  StudentInputDto,
  StudentSettingsDto,
  StudentsQueryDto,
  UpdateStudentDto,
} from './school-students.dto';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
/** Message volontairement neutre : ni l'élève, ni l'établissement, ni l'existence d'un dossier. */
export const STUDENT_REVIEW_MESSAGE =
  'Ce dossier nécessite une vérification par l’administrateur du groupe.';
const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** Inscription en cours : une année clôturée n'appartient plus qu'à l'historique. */
const CURRENT_ENROLLMENT = {
  where: {
    status: { in: ['DRAFT', 'PENDING', 'VALIDATED'] },
    year: { status: { not: 'CLOSED' } },
  },
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: {
    id: true,
    status: true,
    schoolYearId: true,
    level: { select: { id: true, name: true, nameAr: true } },
    class: { select: { id: true, name: true, nameAr: true } },
  },
} satisfies Prisma.SchoolStudent$enrollmentsArgs;

/** Liste restreinte, seule vue de l'enseignant, du surveillant et du comptable. */
const LIMITED_SELECT = {
  id: true,
  schoolId: true,
  matricule: true,
  lastName: true,
  firstName: true,
  lastNameAr: true,
  firstNameAr: true,
  status: true,
  enrollments: CURRENT_ENROLLMENT,
} satisfies Prisma.SchoolStudentSelect;

/** Dossier complet : `specialNeedsEnc` n'en fait jamais partie, il a sa route et son journal. */
const FULL_SELECT = {
  ...LIMITED_SELECT,
  birthDate: true,
  birthPlace: true,
  sex: true,
  nationality: true,
  address: true,
  adminNotes: true,
  customFields: true,
  createdAt: true,
} satisfies Prisma.SchoolStudentSelect;

/** Saisie d'un dossier, depuis un formulaire ou une ligne d'import. */
export interface StudentCreation extends StudentInputDto {
  schoolId: string;
  matricule?: string | null;
  matriculeYearNumber?: number;
  confirmHomonym?: boolean;
}

export interface StudentSettingsView {
  matriculeScope: 'SCHOOL' | 'GROUP';
  matriculePrefix: string;
  matriculeYear: boolean;
  matriculePadding: number;
  requiredDocuments: SchoolDocumentCategory[];
  customFields: SchoolCustomField[];
}

/** Dossiers élèves : isolation par client et établissement, enseignants limités à leurs classes. */
@Injectable()
export class SchoolStudentsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Réglages ───

  async settings(ctx: SchoolContext, schoolId: string): Promise<StudentSettingsView> {
    await this.school.assertSchool(ctx, schoolId);
    return this.readSettings(this.db, ctx.organizationId, schoolId);
  }

  async saveSettings(ctx: SchoolContext, schoolId: string, dto: StudentSettingsDto) {
    await this.school.assertSchool(ctx, schoolId);
    const current = await this.readSettings(this.db, ctx.organizationId, schoolId);
    if (current.matriculeScope !== dto.matriculeScope) {
      const students = await this.db.schoolStudent.count({
        where: { organizationId: ctx.organizationId, schoolId },
      });
      if (students > 0) {
        throw new ConflictException({
          code: 'MATRICULE_SCOPE_LOCKED',
          message: 'Le périmètre du matricule ne change plus une fois des dossiers créés.',
        });
      }
    }
    const errors = validateCustomFields(dto.customFields);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_CUSTOM_FIELDS',
        message: 'Champs complémentaires invalides.',
        details: errors,
      });
    }
    const data = {
      matriculeScope: dto.matriculeScope,
      matriculePrefix: dto.matriculePrefix,
      matriculeYear: dto.matriculeYear,
      matriculePadding: dto.matriculePadding,
      requiredDocuments: dto.requiredDocuments,
      customFields: dto.customFields as unknown as Prisma.InputJsonArray,
    };
    await this.db.schoolStudentSettings.upsert({
      where: { schoolId },
      update: data,
      create: { ...data, schoolId, organizationId: ctx.organizationId },
    });
    await this.school.log(ctx, 'school.student_settings_updated', 'School', schoolId, {});
    return this.readSettings(this.db, ctx.organizationId, schoolId);
  }

  async readSettings(
    db: Tx | SchoolPrismaService,
    organizationId: string,
    schoolId: string,
  ): Promise<StudentSettingsView> {
    const row = await db.schoolStudentSettings.findFirst({ where: { organizationId, schoolId } });
    return {
      matriculeScope: row?.matriculeScope ?? 'SCHOOL',
      matriculePrefix: row?.matriculePrefix ?? DEFAULT_MATRICULE_FORMAT.prefix,
      matriculeYear: row?.matriculeYear ?? DEFAULT_MATRICULE_FORMAT.includeYear,
      matriculePadding: row?.matriculePadding ?? DEFAULT_MATRICULE_FORMAT.padding,
      requiredDocuments: row?.requiredDocuments ?? [],
      customFields: (row?.customFields ?? []) as unknown as SchoolCustomField[],
    };
  }

  // ─── Matricule ───

  matriculeScopeKey(settings: StudentSettingsView, schoolId: string) {
    return settings.matriculeScope === 'GROUP' ? 'GROUP' : schoolId;
  }

  /**
   * Compteur incrémenté par une seule instruction atomique : la ligne reste verrouillée jusqu'à la fin de
   * la transaction, deux inscriptions simultanées ne lisent donc jamais la même valeur. Un numéro déjà
   * pris par un matricule importé est sauté.
   */
  async nextMatricule(
    tx: Tx,
    organizationId: string,
    settings: StudentSettingsView,
    schoolId: string,
    year: number,
  ): Promise<string> {
    const scope = this.matriculeScopeKey(settings, schoolId);
    const counterKey = settings.matriculeYear ? `${scope}:${year}` : scope;
    for (;;) {
      const rows = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO "SchoolNumberCounter" ("organizationId", "counterKey", "value")
        VALUES (${organizationId}::uuid, ${counterKey}, 1)
        ON CONFLICT ("organizationId", "counterKey")
        DO UPDATE SET "value" = "SchoolNumberCounter"."value" + 1
        RETURNING "value"`;
      const matricule = buildMatricule(
        {
          prefix: settings.matriculePrefix,
          includeYear: settings.matriculeYear,
          padding: settings.matriculePadding,
        },
        year,
        rows[0]!.value,
      );
      const taken = await tx.schoolStudent.count({
        where: { organizationId, matriculeScope: scope, matricule },
      });
      if (taken === 0) return matricule;
    }
  }

  /** Année du matricule : celle choisie, sinon l'année scolaire en cours, sinon l'année civile. */
  async matriculeYear(
    organizationId: string,
    schoolId: string,
    schoolYearId?: string,
    db: Tx | SchoolPrismaService = this.db,
  ) {
    const year = await db.schoolYear.findFirst({
      where: {
        organizationId,
        schoolId,
        ...(schoolYearId ? { id: schoolYearId } : { status: 'ACTIVE' }),
      },
      select: { startsOn: true },
    });
    if (schoolYearId && !year) throw new NotFoundException(NOT_FOUND);
    return (year?.startsOn ?? new Date()).getUTCFullYear();
  }

  // ─── Dossiers ───

  async create(ctx: SchoolContext, dto: CreateStudentDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    const matriculeYearNumber = await this.matriculeYear(
      ctx.organizationId,
      dto.schoolId,
      dto.schoolYearId,
    );
    const { schoolYearId: _year, ...input } = dto;
    const created = await this.school.unique(
      () =>
        this.db.$transaction((tx) => this.createInTx(tx, ctx, { ...input, matriculeYearNumber })),
      'MATRICULE_USED',
      'Ce matricule est déjà utilisé.',
    );
    await this.school.log(ctx, 'school.student_created', 'SchoolStudent', created.id, {
      schoolId: created.schoolId,
    });
    return created;
  }

  /** Un dossier par personne : le doublon est contrôlé sous verrou, pour résister au double envoi. */
  async createInTx(tx: Tx, ctx: SchoolContext, input: StudentCreation) {
    const settings = await this.readSettings(tx, ctx.organizationId, input.schoolId);
    const identityKey = studentIdentityKey(input, input.birthDate);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.organizationId}|${identityKey}`}))`;
    const twins = await tx.schoolStudent.findMany({
      where: { organizationId: ctx.organizationId, identityKey },
      select: { id: true, schoolId: true },
    });
    await this.assertNoTwin(ctx, input.schoolId, twins, input.confirmHomonym === true);
    if (input.matricule && !isValidMatricule(input.matricule)) {
      throw new BadRequestException({
        code: 'MATRICULE_INVALID',
        message: 'Matricule invalide : lettres, chiffres, tirets, points ou barres obliques.',
      });
    }
    const matricule =
      input.matricule ??
      (await this.nextMatricule(
        tx,
        ctx.organizationId,
        settings,
        input.schoolId,
        input.matriculeYearNumber ?? new Date().getUTCFullYear(),
      ));
    const student = await tx.schoolStudent.create({
      data: {
        organizationId: ctx.organizationId,
        schoolId: input.schoolId,
        matricule,
        matriculeScope: this.matriculeScopeKey(settings, input.schoolId),
        lastName: input.lastName,
        firstName: input.firstName,
        lastNameAr: input.lastNameAr ?? null,
        firstNameAr: input.firstNameAr ?? null,
        birthDate: toDate(input.birthDate),
        birthPlace: input.birthPlace ?? null,
        sex: input.sex ?? null,
        nationality: input.nationality ?? null,
        address: input.address ?? null,
        adminNotes: input.adminNotes ?? null,
        customFields: this.checkedCustomValues(settings, input.customFields),
        searchText: studentSearchText(input, matricule),
        identityKey,
        createdByUserId: ctx.userId,
      },
      select: FULL_SELECT,
    });
    await this.event(tx, ctx, student.id, 'CREATED', { matricule });
    return student;
  }

  /**
   * Un dossier hors du périmètre de l'utilisateur, ou dans une autre école sans droit de transfert,
   * n'est jamais révélé : seule une personne habilitée peut constater le doublon et le confirmer.
   */
  needsGroupReview(ctx: SchoolContext, schoolId: string, twins: { schoolId: string }[]) {
    return twins.some(
      (t) =>
        (ctx.schoolIds !== null && !ctx.schoolIds.includes(t.schoolId)) ||
        (t.schoolId !== schoolId && !hasSchoolPermission(ctx.role, 'school.students.transfer')),
    );
  }

  private async assertNoTwin(
    ctx: SchoolContext,
    schoolId: string,
    twins: { id: string; schoolId: string }[],
    confirmed: boolean,
  ) {
    if (twins.length === 0) return;
    if (this.needsGroupReview(ctx, schoolId, twins)) {
      await this.school.log(ctx, 'school.student_review_required', 'SchoolStudent', null, {
        schoolId,
      });
      throw new ConflictException({
        code: 'STUDENT_REVIEW_REQUIRED',
        message: STUDENT_REVIEW_MESSAGE,
      });
    }
    if (confirmed) return;
    throw new ConflictException({
      code: 'STUDENT_DUPLICATE',
      message: 'Un dossier existe déjà avec ces nom, prénom et date de naissance.',
      details: [twins[0]!.id],
    });
  }

  async list(ctx: SchoolContext, q: StudentsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = await this.listWhere(ctx, q);
    const [items, total] = await Promise.all([
      this.db.schoolStudent.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: LIMITED_SELECT,
      }),
      this.db.schoolStudent.count({ where }),
    ]);
    const own = await this.ownClasses(ctx);
    return { items: items.map((s) => hideOtherClass(flatten(s), own)), total, page, pageSize };
  }

  async get(ctx: SchoolContext, id: string) {
    const full = hasSchoolPermission(ctx.role, 'school.students.read_full');
    await this.findStudent(ctx, id);
    const student = await this.db.schoolStudent.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
      },
      select: full ? FULL_SELECT : LIMITED_SELECT,
    });
    if (!student) throw new NotFoundException(NOT_FOUND);
    if (full) {
      await this.school.log(ctx, 'school.student_viewed', 'SchoolStudent', id, {});
    }
    return hideOtherClass(flatten(student), await this.ownClasses(ctx));
  }

  /** Une modification garde le matricule : sa correction a sa propre route, motivée et journalisée. */
  async update(ctx: SchoolContext, id: string, dto: UpdateStudentDto) {
    for (const required of ['lastName', 'firstName', 'birthDate'] as const) {
      if (dto[required] === null) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Le nom, le prénom et la date de naissance sont obligatoires.',
        });
      }
    }
    const { birthDate: _birth, customFields, ...fields } = dto;
    const updated = await this.db.$transaction(async (tx) => {
      const current = await this.lockInScope(tx, ctx, id);
      const names = {
        lastName: dto.lastName ?? current.lastName,
        firstName: dto.firstName ?? current.firstName,
        lastNameAr: dto.lastNameAr === undefined ? current.lastNameAr : dto.lastNameAr,
        firstNameAr: dto.firstNameAr === undefined ? current.firstNameAr : dto.firstNameAr,
      };
      const identityKey = studentIdentityKey(names, dto.birthDate ?? toDay(current.birthDate));
      if (identityKey !== current.identityKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.organizationId}|${identityKey}`}))`;
        const twins = await tx.schoolStudent.findMany({
          where: { organizationId: ctx.organizationId, identityKey, id: { not: id } },
          select: { id: true, schoolId: true },
        });
        await this.assertNoTwin(ctx, current.schoolId, twins, false);
      }
      const settings = await this.readSettings(tx, ctx.organizationId, current.schoolId);
      const student = await tx.schoolStudent.update({
        where: { id },
        data: {
          ...fields,
          ...(dto.birthDate ? { birthDate: toDate(dto.birthDate) } : {}),
          ...(customFields
            ? { customFields: this.checkedCustomValues(settings, customFields) }
            : {}),
          searchText: studentSearchText(names, current.matricule),
          identityKey,
        },
        select: FULL_SELECT,
      });
      await this.event(tx, ctx, id, 'UPDATED', { fields: Object.keys(dto) });
      return student;
    });
    await this.school.log(ctx, 'school.student_updated', 'SchoolStudent', id, {
      fields: Object.keys(dto),
    });
    return flatten(updated);
  }

  async correctMatricule(ctx: SchoolContext, id: string, dto: CorrectMatriculeDto) {
    await this.findStudent(ctx, id);
    if (!isValidMatricule(dto.matricule)) {
      throw new BadRequestException({
        code: 'MATRICULE_INVALID',
        message: 'Matricule invalide : lettres, chiffres, tirets, points ou barres obliques.',
      });
    }
    await this.school.unique(
      () =>
        this.db.$transaction(async (tx) => {
          const full = await this.lockInScope(tx, ctx, id);
          await tx.schoolStudent.update({
            where: { id },
            data: {
              matricule: dto.matricule,
              searchText: studentSearchText(full, dto.matricule),
            },
          });
          await this.event(tx, ctx, id, 'MATRICULE_CORRECTED', {
            from: full.matricule,
            to: dto.matricule,
            reason: dto.reason,
          });
        }),
      'MATRICULE_USED',
      'Ce matricule est déjà utilisé.',
    );
    await this.school.log(ctx, 'school.matricule_corrected', 'SchoolStudent', id, {});
    return { id, matricule: dto.matricule };
  }

  // ─── Besoins particuliers : chiffrés, consultation journalisée ───

  async readSensitive(ctx: SchoolContext, id: string) {
    await this.findStudent(ctx, id);
    const row = await this.db.schoolStudent.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
      },
      select: { specialNeedsEnc: true },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    await this.school.log(ctx, 'school.student_sensitive_viewed', 'SchoolStudent', id, {});
    return {
      specialNeeds: row.specialNeedsEnc ? decryptSecret(row.specialNeedsEnc, this.dataKey()) : null,
    };
  }

  async saveSensitive(ctx: SchoolContext, id: string, specialNeeds: string | null) {
    await this.findStudent(ctx, id);
    const specialNeedsEnc = specialNeeds ? encryptSecret(specialNeeds, this.dataKey()) : null;
    await this.db.$transaction(async (tx) => {
      await this.lockInScope(tx, ctx, id);
      await tx.schoolStudent.update({ where: { id }, data: { specialNeedsEnc } });
      await this.event(tx, ctx, id, 'SENSITIVE_UPDATED', {});
    });
    await this.school.log(ctx, 'school.student_sensitive_updated', 'SchoolStudent', id, {});
    return { specialNeeds };
  }

  private dataKey(): Buffer {
    if (!this.config.school.dataKey) {
      throw new ServiceUnavailableException({
        code: 'SCHOOL_DATA_KEY_MISSING',
        message: 'Le chiffrement des données sensibles n’est pas configuré.',
      });
    }
    return this.config.school.dataKey;
  }

  // ─── Historique et tableau de bord ───

  async history(ctx: SchoolContext, id: string) {
    await this.findStudent(ctx, id);
    const [events, assignments] = await Promise.all([
      this.db.schoolStudentEvent.findMany({
        where: { organizationId: ctx.organizationId, studentId: id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, type: true, details: true, createdAt: true },
      }),
      this.db.schoolClassAssignment.findMany({
        where: { organizationId: ctx.organizationId, studentId: id },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          reason: true,
          class: { select: { id: true, name: true, nameAr: true } },
        },
      }),
    ]);
    return { events, assignments };
  }

  /** Chiffres agrégés uniquement. Le périmètre est celui du rôle, jamais plus large. */
  async dashboard(ctx: SchoolContext, schoolId?: string) {
    if (schoolId) await this.school.assertSchool(ctx, schoolId);
    const scope = {
      organizationId: ctx.organizationId,
      ...(schoolId ? { schoolId } : ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
    };
    // Année en cours seulement : un élève réinscrit ne compte pas deux fois.
    const current = {
      ...scope,
      status: 'VALIDATED' as const,
      year: { status: 'ACTIVE' as const },
    };
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [bySchool, byLevel, byClass, pending, recent, students] = await Promise.all([
      this.db.schoolEnrollment.groupBy({
        by: ['schoolId'],
        where: { ...current },
        _count: true,
      }),
      this.db.schoolEnrollment.groupBy({
        by: ['levelId'],
        where: { ...current },
        _count: true,
      }),
      this.db.schoolEnrollment.groupBy({
        by: ['classId'],
        where: { ...current, classId: { not: null } },
        _count: true,
      }),
      this.db.schoolEnrollment.count({ where: { ...scope, status: 'PENDING' } }),
      this.db.schoolEnrollment.count({
        where: { ...current, enrolledOn: { gte: since } },
      }),
      this.db.schoolStudent.count({ where: scope }),
    ]);
    const [schools, levels, classes] = await Promise.all([
      this.db.school.findMany({
        where: { organizationId: ctx.organizationId, id: { in: bySchool.map((r) => r.schoolId) } },
        select: { id: true, name: true, nameAr: true },
      }),
      this.db.level.findMany({
        where: { organizationId: ctx.organizationId, id: { in: byLevel.map((r) => r.levelId) } },
        select: { id: true, name: true, nameAr: true },
      }),
      this.db.schoolClass.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: byClass.flatMap((r) => (r.classId ? [r.classId] : [])) },
        },
        select: { id: true, name: true, nameAr: true, capacity: true },
      }),
    ]);
    const enrolled = bySchool.reduce((sum, r) => sum + r._count, 0);
    return {
      students,
      enrolled,
      pending,
      recent,
      bySchool: schools.map((s) => ({
        ...s,
        count: bySchool.find((r) => r.schoolId === s.id)?._count ?? 0,
      })),
      byLevel: levels.map((l) => ({
        ...l,
        count: byLevel.find((r) => r.levelId === l.id)?._count ?? 0,
      })),
      byClass: classes.map((c) => ({
        ...c,
        count: byClass.find((r) => r.classId === c.id)?._count ?? 0,
      })),
    };
  }

  // ─── Outils partagés avec les autres services élèves ───

  /** Introuvable plutôt qu'interdit hors périmètre : un identifiant ne révèle rien. */
  async findStudent(ctx: SchoolContext, id: string) {
    const student = await this.db.schoolStudent.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        ...this.ownClassesFilter(await this.ownClasses(ctx)),
      },
      select: { id: true, schoolId: true, status: true, matricule: true },
    });
    if (!student) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, student.schoolId);
    return student;
  }

  /**
   * Sérialise les écritures sur un dossier et relit son établissement sous verrou : l'autorisation lue
   * avant ne vaut plus si un transfert concurrent l'a déplacé hors du périmètre de l'utilisateur.
   */
  async lockInScope(tx: Tx, ctx: SchoolContext, id: string) {
    await tx.$queryRaw`SELECT id FROM "SchoolStudent" WHERE id = ${id}::uuid FOR UPDATE`;
    const student = await tx.schoolStudent.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!student || (ctx.schoolIds && !ctx.schoolIds.includes(student.schoolId))) {
      throw new NotFoundException(NOT_FOUND);
    }
    return student;
  }

  /** Classes de l'enseignant ; null pour les rôles qui ne sont pas limités à leurs classes. */
  async ownClasses(ctx: SchoolContext): Promise<string[] | null> {
    if (!isLimitedToOwnClasses(ctx.role)) return null;
    if (!ctx.memberId) return [];
    const rows = await this.db.schoolClassTeacher.findMany({
      where: {
        organizationId: ctx.organizationId,
        memberId: ctx.memberId,
        class: { year: { status: { not: 'CLOSED' } } },
      },
      select: { classId: true },
    });
    return rows.map((r) => r.classId);
  }

  ownClassesFilter(classIds: string[] | null): Prisma.SchoolStudentWhereInput {
    return classIds
      ? { enrollments: { some: { classId: { in: classIds }, status: 'VALIDATED' } } }
      : {};
  }

  requirePermission(ctx: SchoolContext, permission: SchoolPermission) {
    if (!hasSchoolPermission(ctx.role, permission)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
  }

  /** Une ligne d'historique, dans la transaction de l'opération qu'elle décrit. */
  async event(
    tx: Tx,
    ctx: SchoolContext,
    studentId: string,
    type: string,
    details: Record<string, string | string[] | null>,
  ): Promise<void> {
    await tx.schoolStudentEvent.create({
      data: {
        organizationId: ctx.organizationId,
        studentId,
        type,
        details,
        actorUserId: ctx.userId,
      },
    });
  }

  private async listWhere(
    ctx: SchoolContext,
    q: StudentsQueryDto,
  ): Promise<Prisma.SchoolStudentWhereInput> {
    if (q.schoolId) await this.school.assertSchool(ctx, q.schoolId);
    const enrollment: Prisma.SchoolEnrollmentWhereInput = {
      ...(q.schoolYearId ? { schoolYearId: q.schoolYearId } : {}),
      ...(q.levelId ? { levelId: q.levelId } : {}),
      ...(q.classId ? { classId: q.classId } : {}),
    };
    const words = q.q ? normalizeSearch(q.q).split(' ').filter(Boolean) : [];
    return {
      organizationId: ctx.organizationId,
      ...(q.schoolId
        ? { schoolId: q.schoolId }
        : ctx.schoolIds
          ? { schoolId: { in: ctx.schoolIds } }
          : {}),
      ...(q.status ? { status: q.status } : {}),
      AND: [
        this.ownClassesFilter(await this.ownClasses(ctx)),
        ...(Object.keys(enrollment).length > 0
          ? [
              {
                enrollments: {
                  some: { ...enrollment, status: { in: ['DRAFT', 'PENDING', 'VALIDATED'] } },
                },
              } satisfies Prisma.SchoolStudentWhereInput,
            ]
          : []),
        ...words.map((word) => ({ searchText: { contains: word } })),
      ],
    };
  }

  private checkedCustomValues(
    settings: StudentSettingsView,
    values: Record<string, string> | undefined,
  ): Prisma.InputJsonObject {
    const allowed = new Set(settings.customFields.map((f) => f.key));
    const checked: Record<string, string> = {};
    for (const [key, value] of Object.entries(values ?? {})) {
      if (!allowed.has(key)) {
        throw new BadRequestException({
          code: 'CUSTOM_FIELD_UNKNOWN',
          message: `Champ non défini par l’établissement : ${key}.`,
        });
      }
      if (typeof value !== 'string' || value.length > SCHOOL_CUSTOM_VALUE_MAX) {
        throw new BadRequestException({
          code: 'CUSTOM_FIELD_INVALID',
          message: `Valeur invalide pour le champ ${key}.`,
        });
      }
      if (value.trim()) checked[key] = value.trim();
    }
    return checked;
  }
}

/** Un enseignant ne voit pas la classe d'un élève quand ce n'est pas la sienne. */
function hideOtherClass<T extends { enrollment: unknown }>(student: T, own: string[] | null): T {
  if (!own) return student;
  const enrollment = student.enrollment as { class: { id: string } | null } | null;
  return enrollment?.class && own.includes(enrollment.class.id)
    ? student
    : { ...student, enrollment: null };
}

/** Sort l'inscription en cours de sa liste, et ramène la naissance à une date simple. */
function flatten<T extends { enrollments: unknown[]; birthDate?: Date }>(student: T) {
  const { enrollments, birthDate, ...rest } = student;
  return {
    ...rest,
    ...(birthDate ? { birthDate: toDay(birthDate) } : {}),
    enrollment: enrollments[0] ?? null,
  };
}
